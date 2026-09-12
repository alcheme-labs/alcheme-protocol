import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    loadNodeRuntimeConfig,
    requirePrivateSidecarSurface,
} from '../config/services';
import {
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
} from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    requireSourceMaterialAccessForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import {
    buildContextCapsule,
    persistContextCapsule,
} from '../services/aiOperatingLayer/contextFabric';
import {
    buildNoSourceAnswerText,
    buildSourceGroundedAnswerId,
    createSourceGroundedAnswer,
    digestQuestion,
    listSourceGroundedAnswers,
    loadSourceGroundedAnswer,
    normalizeLocale,
    serializeSourceGroundedAnswer,
    updateSourceGroundedAnswer,
} from '../services/aiOperatingLayer/sourceGroundedAsk/artifacts';
import {
    normalizeScopes,
    selectSourceGroundedAskEvidence,
    SourceGroundedAskError,
} from '../services/aiOperatingLayer/sourceGroundedAsk/sourceSelector';
import {
    SOURCE_GROUNDED_ASK_SCHEMA_VERSION,
    SOURCE_GROUNDED_ASK_TASK_TYPE,
    type SourceGroundedAskScope,
} from '../services/aiOperatingLayer/sourceGroundedAsk/types';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parsePositiveInts(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
        .map((item) => Math.trunc(item))));
}

function parseStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
}

function requiresSourceMaterialGate(scopes: SourceGroundedAskScope[], sourceMaterialIds: number[]): boolean {
    return sourceMaterialIds.length > 0
        || scopes.includes('source_materials')
        || scopes.includes('current_draft');
}

function requireSourceGroundedAnswerReadSurface(surface: 'ghost_draft_private' | 'source_materials' = 'ghost_draft_private') {
    return requirePrivateSidecarSurface(surface);
}

export function sourceGroundedAskRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/source-grounded-asks', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.body?.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireCircleActorForAuthActor(actor, prisma as any, {
                circleId,
                action: 'circle.read',
            });

            const draftPostId = parsePositiveInt(req.body?.draftPostId);
            if (draftPostId) {
                const access = await authorizeDraftActionForActor(prisma as any, {
                    actor,
                    postId: draftPostId,
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
                if (access.post?.circleId && Number(access.post.circleId) !== circleId) {
                    return res.status(404).json({ error: 'draft_not_found' });
                }
            }

            const question = String(req.body?.question || '').trim();
            if (question.length < 2) {
                return res.status(400).json({ error: 'source_grounded_ask_question_required' });
            }
            const scopes = normalizeScopes(req.body?.scopes, draftPostId);
            const sourceMaterialIds = parsePositiveInts(req.body?.sourceMaterialIds);
            const knowledgeIds = parseStrings(req.body?.knowledgeIds);
            const trendReceiptIds = parseStrings(req.body?.trendReceiptIds);
            const locale = normalizeLocale(req.body?.locale);

            if (requiresSourceMaterialGate(scopes, sourceMaterialIds)) {
                const sidecar = requirePrivateSidecarSurface('source_materials');
                if (!sidecar.ok) {
                    return res.status(sidecar.statusCode).json({
                        error: sidecar.error,
                        route: sidecar.route,
                    });
                }
                await requireSourceMaterialAccessForActor(prisma as any, {
                    actor,
                    circleId,
                });
            } else {
                const sidecar = requirePrivateSidecarSurface('ghost_draft_private');
                if (!sidecar.ok) {
                    return res.status(sidecar.statusCode).json({
                        error: sidecar.error,
                        route: sidecar.route,
                    });
                }
            }

            const selection = await selectSourceGroundedAskEvidence(prisma as any, {
                circleId,
                draftPostId,
                scopes,
                sourceMaterialIds,
                knowledgeIds,
                trendReceiptIds,
                includeProviderContext: false,
            });

            if (selection.evidenceRefs.length === 0) {
                const answer = await createSourceGroundedAnswer(prisma as any, {
                    circleId,
                    draftPostId,
                    ownerUserId: actor.userId,
                    question,
                    locale,
                    status: 'no_source',
                    failureCode: 'no_accessible_source',
                    answerText: buildNoSourceAnswerText(locale),
                    limitations: [],
                    citations: [],
                    evidenceRefs: [],
                    sourceDigest: selection.sourceDigest,
                    scopeSnapshot: selection.scopeSnapshot,
                });
                return res.status(200).json({
                    ok: true,
                    status: 'no_source',
                    answer: serializeSourceGroundedAnswer(answer),
                });
            }

            const answerId = buildSourceGroundedAnswerId();
            const contextPayload = {
                kind: 'source_grounded_ask.v1',
                answerId,
                circleId,
                draftPostId: draftPostId ?? null,
                scopes,
                sourceMaterialIds,
                knowledgeIds,
                trendReceiptIds,
                questionDigest: digestQuestion(question),
                locale,
                sourceDigest: selection.sourceDigest,
            } as const;
            const runtime = loadNodeRuntimeConfig();
            const context = buildContextCapsule({
                taskType: SOURCE_GROUNDED_ASK_TASK_TYPE,
                subjectType: draftPostId ? 'draft_post' : 'circle',
                subjectId: String(draftPostId ?? circleId),
                actorUserId: actor.userId,
                visibility: 'member_visible',
                runtimeRole: runtime.runtimeRole,
                evidenceRefs: selection.evidenceRefs,
                contextPayload,
                excerptPolicy: {
                    mode: 'metadata_only',
                    redaction: 'source_grounded_ask_v1',
                    citationStyle: 'drawer',
                },
                tokenBudget: {
                    maxInputTokens: 4000,
                    maxOutputTokens: 900,
                    maxEvidenceRefs: 8,
                    maxExcerptChars: 900,
                },
                privatePlaintextMode: 'member_visible',
            });
            if (!context.ok) {
                return res.status(400).json({ error: `source_grounded_ask_context_rejected:${context.error}` });
            }
            await persistContextCapsule(prisma as any, context.capsule, {
                cacheKey: `source_grounded_ask:${answerId}`,
                expiresAt: new Date(Date.now() + 24 * 3_600_000),
            });

            await createSourceGroundedAnswer(prisma as any, {
                id: answerId,
                circleId,
                draftPostId,
                ownerUserId: actor.userId,
                question,
                locale,
                status: 'pending',
                answerText: '',
                limitations: [],
                citations: selection.citations,
                evidenceRefs: selection.evidenceRefs,
                sourceDigest: selection.sourceDigest,
                scopeSnapshot: selection.scopeSnapshot,
                contextCapsuleId: context.capsule.id,
            });
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'source_grounded_ask_generate',
                taskType: SOURCE_GROUNDED_ASK_TASK_TYPE,
                taskCatalogVersion: 'v1',
                contextCapsuleId: context.capsule.id,
                dedupeKey: `source_grounded_ask:${answerId}`,
                scopeType: draftPostId ? 'draft' : 'circle',
                scopeDraftPostId: draftPostId ?? null,
                scopeCircleId: draftPostId ? null : circleId,
                requestedByUserId: actor.userId,
                payload: {
                    answerId,
                    circleId,
                    draftPostId: draftPostId ?? null,
                    outputSchemaVersion: SOURCE_GROUNDED_ASK_SCHEMA_VERSION,
                },
            });
            await updateSourceGroundedAnswer(prisma as any, answerId, {
                aiJobId: job.id,
            });

            return res.status(202).json({
                ok: true,
                status: 'queued',
                answerId,
                jobId: job.id,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof SourceGroundedAskError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    ...error.details,
                });
            }
            return next(error);
        }
    });

    router.get('/source-grounded-asks', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.query.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireCircleActorForAuthActor(actor, prisma as any, {
                circleId,
                action: 'circle.read',
            });
            const draftPostId = parsePositiveInt(req.query.draftPostId);
            const sidecar = requireSourceGroundedAnswerReadSurface(draftPostId ? 'source_materials' : 'ghost_draft_private');
            if (!sidecar.ok) {
                return res.status(sidecar.statusCode).json({
                    error: sidecar.error,
                    route: sidecar.route,
                });
            }
            if (draftPostId) {
                const access = await authorizeDraftActionForActor(prisma as any, {
                    actor,
                    postId: draftPostId,
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
            }
            const answers = await listSourceGroundedAnswers(prisma as any, {
                circleId,
                draftPostId,
                ownerUserId: actor.userId,
                limit: parsePositiveInt(req.query.limit) ?? 20,
            });
            return res.status(200).json({
                ok: true,
                answers: answers.map(serializeSourceGroundedAnswer),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/source-grounded-asks/:answerId', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const answerId = String(req.params.answerId || '').trim();
            if (!answerId) {
                return res.status(400).json({ error: 'invalid_source_grounded_answer_id' });
            }
            const sidecar = requireSourceGroundedAnswerReadSurface();
            if (!sidecar.ok) {
                return res.status(sidecar.statusCode).json({
                    error: sidecar.error,
                    route: sidecar.route,
                });
            }
            const answer = await loadSourceGroundedAnswer(prisma as any, answerId);
            if (!answer || Number(answer.ownerUserId ?? 0) !== actor.userId) {
                return res.status(404).json({ error: 'source_grounded_answer_not_found' });
            }
            await requireCircleActorForAuthActor(actor, prisma as any, {
                circleId: Number(answer.circleId),
                action: 'circle.read',
            });
            if (answer.draftPostId) {
                const access = await authorizeDraftActionForActor(prisma as any, {
                    actor,
                    postId: Number(answer.draftPostId),
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
            }
            return res.status(200).json({
                ok: true,
                answer: serializeSourceGroundedAnswer(answer),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
