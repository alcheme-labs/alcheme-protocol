import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import * as generatorService from '../services/circleSummary/generator';
import * as snapshotService from '../services/circleSummary/snapshot';
import { loadCircleSummaryTopology } from '../services/circleSummary/topology';
import {
    ensureCircleCognitiveMapAiView,
} from '../services/aiOperatingLayer/cognitiveMap/explainer';
import type { CircleCognitiveMapAiView } from '../services/aiOperatingLayer/cognitiveMap/readModel';
import { resolveExpressRequestLocale } from '../i18n/request';
import { requireCircleActor, requireCircleManagerActor } from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseBoolLike(value: unknown): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function toCognitiveMapAiPayload(view: CircleCognitiveMapAiView | null): Record<string, unknown> | null {
    if (!view || view.status !== 'ready' || !view.output) return null;
    return {
        sourceDigest: view.sourceDigest,
        output: view.output,
        generatedAt: view.generatedAt,
        modelProfile: view.modelProfile,
        promptVersion: view.promptVersion,
    };
}

export function circleSummaryRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/:circleId/summary-snapshots/latest', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const circleActor = await requireCircleActor(req, prisma as any, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });

            const forceGenerate = parseBoolLike(req.query.regenerate);
            if (forceGenerate) {
                await requireCircleManagerActor(req, prisma as any, {
                    circleId,
                    requireSessionCookie: true,
                });
            }

            const locale = resolveExpressRequestLocale(req);
            const snapshot = await generatorService.ensureLatestCircleSummarySnapshot(prisma, {
                circleId,
                forceGenerate,
                locale,
            });
            const topology = await loadCircleSummaryTopology(prisma, {
                circleId,
                viewerUserId: circleActor.userId,
            });
            let cognitiveMapAi: CircleCognitiveMapAiView | null = null;
            try {
                cognitiveMapAi = await ensureCircleCognitiveMapAiView({
                    prisma: prisma as any,
                    circleId,
                    snapshot,
                    topology,
                    locale,
                });
            } catch (error) {
                console.warn('[circle cognitive map AI] enqueue/read skipped', {
                    circleId,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }

            return res.status(200).json({
                ok: true,
                snapshot,
                topology,
                cognitiveMapAi: toCognitiveMapAiPayload(cognitiveMapAi),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/:circleId/summary-snapshots/:version', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId);
            const version = parsePositiveInt(req.params.version);
            if (!circleId || !version) {
                return res.status(400).json({ error: 'invalid_snapshot_locator' });
            }
            await requireCircleActor(req, prisma as any, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });

            const snapshot = await snapshotService.loadCircleSummarySnapshotByVersion(prisma, circleId, version);
            if (!snapshot) {
                return res.status(404).json({ error: 'circle_summary_snapshot_not_found' });
            }

            return res.status(200).json({
                ok: true,
                snapshot,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
