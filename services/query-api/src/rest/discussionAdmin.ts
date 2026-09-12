import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { createDiscussionIntelligence } from '../ai/discussion-intelligence';
import { loadGhostConfig } from '../ai/ghost/config';
import {
    loadCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
} from '../ai/ghost/circle-settings';
import {
    loadLatestDiscussionTriggerDiagnostics,
} from '../ai/discussion-draft-trigger';
import {
    AuthActorError,
    requireAuthenticatedActor,
    requireCircleManagerActorForAuthActor,
    type AuthActor,
    type CircleActor,
} from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
import { loadDiscussionAnalysisDiagnostics } from '../services/discussion/scoringAudit';
import { enqueueDiscussionMessageAnalyzeJob } from '../services/discussion/analysis/enqueue';
import { loadDiscussionSummaryDiagnostics } from '../services/discussion/summaryDiagnostics';

function parseEnvelopeId(value: unknown): string | null {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBool(value: unknown, fallback = false): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function discussionAdminRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();
    const ghostConfig = loadGhostConfig();
    const discussionIntelligence = createDiscussionIntelligence({ prisma, redis });

    async function requireSidecarActor(req: any, res: any): Promise<AuthActor | null> {
        const gate = requirePrivateSidecarSurface('discussion_runtime');
        if (!gate.ok) {
            res.status(gate.statusCode).json({
                error: gate.error,
                route: gate.route,
            });
            return null;
        }

        try {
            return await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
        } catch (error) {
            if (sendAuthActorError(res, error)) return null;
            throw error;
        }
    }

    async function requireManagedCircleForActor(
        res: any,
        actor: AuthActor,
        circleId: number,
    ): Promise<CircleActor | null> {
        try {
            return await requireCircleManagerActorForAuthActor(actor, prisma as any, {
                circleId,
                allowModerator: true,
                action: 'discussion.admin',
            });
        } catch (error) {
            if (error instanceof AuthActorError && error.statusCode === 403) {
                res.status(404).json({ error: 'discussion_message_not_found' });
                return null;
            }
            if (sendAuthActorError(res, error)) return null;
            throw error;
        }
    }

    async function requireManagedCircle(req: any, res: any, circleId: number): Promise<CircleActor | null> {
        const actor = await requireSidecarActor(req, res);
        if (!actor) {
            return null;
        }

        return requireManagedCircleForActor(res, actor, circleId);
    }

    router.get('/messages/:envelopeId/analysis', async (req, res, next) => {
        try {
            const actor = await requireSidecarActor(req, res);
            if (!actor) return;

            const envelopeId = parseEnvelopeId(req.params.envelopeId);
            if (!envelopeId) {
                return res.status(400).json({ error: 'invalid_envelope_id' });
            }

            const diagnostics = await loadDiscussionAnalysisDiagnostics(prisma, envelopeId);
            if (!diagnostics) {
                return res.status(404).json({ error: 'discussion_message_not_found' });
            }

            if (!(await requireManagedCircleForActor(res, actor, diagnostics.circleId))) return;

            return res.status(200).json({
                ok: true,
                diagnostics,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/messages/:envelopeId/reanalyze', async (req, res, next) => {
        try {
            const actor = await requireSidecarActor(req, res);
            if (!actor) return;

            const envelopeId = parseEnvelopeId(req.params.envelopeId);
            if (!envelopeId) {
                return res.status(400).json({ error: 'invalid_envelope_id' });
            }

            const diagnostics = await loadDiscussionAnalysisDiagnostics(prisma, envelopeId);
            if (!diagnostics) {
                return res.status(404).json({ error: 'discussion_message_not_found' });
            }

            if (!(await requireManagedCircleForActor(res, actor, diagnostics.circleId))) return;

            const job = await enqueueDiscussionMessageAnalyzeJob(prisma, {
                envelopeId,
                circleId: diagnostics.circleId,
                requestedByUserId: actor.userId,
            });

            return res.status(200).json({
                ok: true,
                jobId: job.id,
                status: job.status,
                envelopeId,
                circleId: diagnostics.circleId,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/circles/:id/summary', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            if ((await requireManagedCircle(req, res, circleId)) === null) return;

            const circleGhostPatch = await loadCircleGhostSettingsPatch(prisma, circleId);
            const effectiveGhostSettings = resolveCircleGhostSettings(ghostConfig, circleGhostPatch);
            const diagnostics = await loadDiscussionSummaryDiagnostics(prisma, redis, circleId, {
                force: parseBool(req.query.force, false),
                windowSize: ghostConfig.summary.windowSize,
                cacheTtlSec: ghostConfig.summary.cacheTtlSec,
                summaryUseLLM: effectiveGhostSettings.summaryUseLLM,
                configSource: circleGhostPatch ? 'circle' : 'global_default',
                summarizeMessages: (input) => discussionIntelligence.summarizeMessages(input),
            });

            return res.status(200).json({
                ok: true,
                diagnostics: {
                    scope: diagnostics.scope,
                    input: {
                        circleId: diagnostics.circleId,
                        summaryUseLLM: diagnostics.config.summaryUseLLM,
                        currentSummaryUseLLM: diagnostics.currentConfig?.summaryUseLLM ?? diagnostics.config.summaryUseLLM,
                        messageWindowSize: diagnostics.windowSize,
                        sourceMessages: diagnostics.sourceMessages,
                        windowDigest: diagnostics.windowDigest,
                        inputFidelity: diagnostics.inputFidelity,
                        configSource: diagnostics.configSource,
                        currentConfigSource: diagnostics.currentConfigSource ?? diagnostics.configSource,
                    },
                    runtime: {
                        method: diagnostics.method,
                        generationMetadata: diagnostics.generationMetadata,
                        fromCache: diagnostics.fromCache,
                        generatedAt: diagnostics.generatedAt,
                        cachedSourceDigest: diagnostics.cachedSourceDigest,
                        fallback: diagnostics.fallbackDiagnostics,
                    },
                    output: {
                        summary: diagnostics.summary,
                        messageCount: diagnostics.messageCount,
                    },
                    failure: {
                        code: null,
                        message: null,
                    },
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/circles/:id/trigger', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            if ((await requireManagedCircle(req, res, circleId)) === null) return;

            const diagnostics = await loadLatestDiscussionTriggerDiagnostics(prisma, circleId);
            if (!diagnostics) {
                return res.status(404).json({ error: 'discussion_trigger_not_found' });
            }

            return res.status(200).json({
                ok: true,
                diagnostics,
            });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}
