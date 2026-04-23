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
import { authorizeDraftAction, parseAuthUserIdFromRequest } from '../services/membership/checks';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { loadGhostDraftGenerationView } from '../services/ghostDraft/readModel';
import { buildGhostDraftGenerationDedupeKey } from '../services/ghostDraft/requestKey';

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
            const userId = parseAuthUserIdFromRequest(req);

            if (!postId || !userId) {
                return res.status(400).json({ error: 'postId and authenticated userId required' });
            }

            const access = await authorizeDraftAction(prisma as any, {
                postId: Number(postId),
                userId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }
            const editAccess = parseBoolean(req.body?.preferAutoApply)
                ? await authorizeDraftAction(prisma as any, {
                    postId: Number(postId),
                    userId,
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
                    postId: Number(postId),
                    requestedByUserId: userId,
                    autoApplyRequested,
                    workingCopyHash,
                    workingCopyUpdatedAt,
                    seededReference,
                    sourceMaterialIds,
                }),
                scopeType: 'draft',
                scopeDraftPostId: Number(postId),
                scopeCircleId: access.post?.circleId ?? null,
                requestedByUserId: userId,
                payload: {
                    postId: Number(postId),
                    autoApplyRequested,
                    workingCopyHash,
                    workingCopyUpdatedAt,
                    seededReference,
                    sourceMaterialIds,
                },
            });

            res.json({
                jobId: job.id,
                status: job.status,
                postId: Number(postId),
                autoApplyRequested,
            });
        } catch (error: any) {
            if (error.message?.includes('AI_MODE')) {
                return res.status(503).json({ error: error.message });
            }
            next(error);
        }
    });

    router.get('/ghost-drafts/:generationId', async (req, res, next) => {
        try {
            const generationId = parsePositiveInt(req.params.generationId);
            const userId = parseAuthUserIdFromRequest(req);
            if (!generationId || !userId) {
                return res.status(400).json({ error: 'generationId and authenticated userId required' });
            }

            const generation = await loadGhostDraftGenerationView(prisma as any, generationId);
            if (!generation) {
                return res.status(404).json({ error: 'ghost_draft_generation_not_found' });
            }

            const access = await authorizeDraftAction(prisma as any, {
                postId: generation.postId,
                userId,
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
            next(error);
        }
    });

    return router;
}
