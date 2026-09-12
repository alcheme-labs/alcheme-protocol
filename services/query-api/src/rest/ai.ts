/**
 * AI REST Routes — Ghost Draft
 *
 * POST /api/v1/ai/ghost-drafts/generate — Generate a Ghost Draft
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { requirePrivateSidecarSurface } from '../config/services';
import { assertAiTaskAllowed } from '../ai/provider';
import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { loadGhostDraftGenerationView } from '../services/ghostDraft/readModel';
import { buildGhostDraftGenerationDedupeKey } from '../services/ghostDraft/requestKey';
import {
    attachTrendPromptJob,
    prepareTrendPromptRequest,
} from '../services/aiOperatingLayer/trends/generator';
import { loadTrendPromptView } from '../services/aiOperatingLayer/trends/readModel';

export function aiRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    function parsePositiveInt(value: unknown): number | null {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return parsed;
    }

    function parseBoolean(value: unknown): boolean {
        const normalized = String(value ?? '').trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes';
    }

    function parseSeededReference(value: unknown): { path: string; line: number } | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const path = String((value as any).path || '').trim();
        const line = Number((value as any).line || 0);
        if (!path || !Number.isFinite(line) || line <= 0) return null;
        return { path, line };
    }

    function parseSourceMaterialIds(value: unknown): number[] {
        if (!Array.isArray(value)) return [];
        return value
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0);
    }

    function normalizeLocale(value: unknown): 'en' | 'zh' | 'fr' | 'es' {
        const normalized = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
        return normalized === 'zh' || normalized === 'fr' || normalized === 'es'
            ? normalized
            : 'en';
    }

    function normalizeMode(value: unknown): 'social' | 'knowledge' | null {
        return value === 'social' || value === 'knowledge' ? value : null;
    }

    // POST /api/v1/ai/trend-prompts
    router.post('/trend-prompts', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const placeSeed = String(req.body?.placeSeed ?? req.body?.place ?? '').trim();
            if (!placeSeed) {
                return res.status(400).json({
                    error: 'invalid_place_prompt_input',
                });
            }
            const prepared = await prepareTrendPromptRequest(prisma as any, {
                placeSeed,
                locale: normalizeLocale(req.body?.locale),
                communityType: typeof req.body?.communityType === 'string' ? req.body.communityType : null,
                mode: normalizeMode(req.body?.mode),
                requestedByUserId: actor.userId,
            });

            if (prepared.status !== 'queued') {
                return res.status(200).json({
                    ok: true,
                    status: prepared.status,
                    promptId: prepared.promptId,
                    prompt: prepared.prompt,
                });
            }

            const job = await enqueueAiJob(prisma as any, {
                jobType: 'trend_prompt_generate',
                dedupeKey: `trend_prompt_generate:${prepared.promptId}`,
                scopeType: 'system',
                requestedByUserId: actor.userId,
                payload: {
                    promptId: prepared.promptId,
                    placeSeed,
                    locale: normalizeLocale(req.body?.locale),
                    communityType: typeof req.body?.communityType === 'string' ? req.body.communityType : null,
                    mode: normalizeMode(req.body?.mode),
                    requestedByUserId: actor.userId,
                },
            });
            await attachTrendPromptJob(prisma as any, {
                promptId: prepared.promptId,
                requestedByUserId: actor.userId,
                aiJobId: job.id,
            });

            return res.status(202).json({
                ok: true,
                status: 'queued',
                jobId: job.id,
                promptId: prepared.promptId,
                cacheKey: prepared.cacheKey,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/trend-prompts/:promptId', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const promptId = String(req.params.promptId || '').trim();
            if (!promptId) {
                return res.status(400).json({
                    error: 'invalid_trend_prompt_id',
                });
            }
            const prompt = await loadTrendPromptView(prisma as any, {
                promptId,
                requestedByUserId: actor.userId,
            });
            if (!prompt) {
                return res.status(404).json({
                    error: 'trend_prompt_not_found',
                });
            }
            return res.status(200).json({
                ok: true,
                status: prompt.status,
                promptId,
                prompt: prompt.prompt,
                jobId: prompt.aiJobId,
                proposalArtifactId: prompt.proposalArtifactId,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    // POST /api/v1/ai/ghost-drafts/generate
    router.post('/ghost-drafts/generate', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const { postId } = req.body;
            const parsedPostId = Number(postId);

            if (!postId || !Number.isFinite(parsedPostId) || parsedPostId <= 0) {
                return res.status(400).json({ error: 'postId required' });
            }

            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const access = await authorizeDraftActionForActor(prisma as any, {
                actor,
                postId: parsedPostId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }
            const editAccess = parseBoolean(req.body?.preferAutoApply)
                ? await authorizeDraftActionForActor(prisma as any, {
                    actor,
                    postId: parsedPostId,
                    action: 'edit',
                })
                : null;
            try {
                assertAiTaskAllowed({
                    task: 'ghost-draft',
                    dataBoundary: 'private_plaintext',
                });
            } catch (error) {
                return res.status(409).json({
                    error: (error as Error).message || 'external_ai_private_content_consent_required',
                });
            }
            const autoApplyRequested = Boolean(parseBoolean(req.body?.preferAutoApply) && editAccess?.allowed);
            const seededReference = parseSeededReference(req.body?.seededReference);
            const sourceMaterialIds = parseSourceMaterialIds(req.body?.sourceMaterialIds);
            const workingCopyHash = typeof req.body?.workingCopyHash === 'string'
                ? req.body.workingCopyHash
                : null;
            const workingCopyUpdatedAt = typeof req.body?.workingCopyUpdatedAt === 'string'
                ? req.body.workingCopyUpdatedAt
                : null;
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'ghost_draft_generate',
                dedupeKey: buildGhostDraftGenerationDedupeKey({
                    postId: parsedPostId,
                    requestedByUserId: actor.userId,
                    autoApplyRequested,
                    workingCopyHash,
                    workingCopyUpdatedAt,
                    seededReference,
                    sourceMaterialIds,
                }),
                scopeType: 'draft',
                scopeDraftPostId: parsedPostId,
                scopeCircleId: access.post?.circleId ?? null,
                requestedByUserId: actor.userId,
                payload: {
                    postId: parsedPostId,
                    autoApplyRequested,
                    actorPubkey: actor.pubkey,
                    autoApplyAuthorizedAt: autoApplyRequested ? new Date().toISOString() : null,
                    workingCopyHash,
                    workingCopyUpdatedAt,
                    seededReference,
                    sourceMaterialIds,
                },
            });

            res.json({
                jobId: job.id,
                status: job.status,
                postId: parsedPostId,
                autoApplyRequested,
            });
        } catch (error: any) {
            if (error.message?.includes('AI_MODE')) {
                return res.status(503).json({ error: error.message });
            }
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.get('/ghost-drafts/:generationId', async (req, res, next) => {
        try {
            const generationId = parsePositiveInt(req.params.generationId);
            if (!generationId) {
                return res.status(400).json({ error: 'generationId required' });
            }
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });

            const generation = await loadGhostDraftGenerationView(prisma as any, generationId);
            if (!generation) {
                return res.status(404).json({ error: 'ghost_draft_generation_not_found' });
            }

            const access = await authorizeDraftActionForActor(prisma as any, {
                actor,
                postId: generation.postId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            return res.json({
                ok: true,
                generation,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    return router;
}
