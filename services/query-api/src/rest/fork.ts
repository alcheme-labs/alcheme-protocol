import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { parseAuthUserIdFromRequest } from '../services/membership/checks';
import { buildForkInheritanceSnapshot, loadForkLineageView } from '../services/fork/readModel';
import {
    createForkCircle,
    createPrismaForkRuntimeStore,
    resolveForkQualification,
} from '../services/fork/runtime';

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

export function forkRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const forkStore = createPrismaForkRuntimeStore(prisma);

    router.get('/circles/:circleId/lineage', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const readModel = await loadForkLineageView(prisma, circleId);
            return res.json(readModel);
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_lineage_read_failed',
            });
        }
    });

    router.get('/circles/:sourceCircleId/qualification', async (req, res) => {
        try {
            const sourceCircleId = asPositiveInteger(req.params.sourceCircleId);
            const actorUserId = parseAuthUserIdFromRequest(req);
            if (!sourceCircleId || !actorUserId) {
                return res.status(400).json({ error: 'invalid_fork_qualification_input' });
            }

            const qualificationSnapshot = await resolveForkQualification(prisma, {
                sourceCircleId,
                userId: actorUserId,
            });
            return res.json(qualificationSnapshot);
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_qualification_failed',
            });
        }
    });

    router.post('/circles/:sourceCircleId/forks', async (req, res) => {
        try {
            const sourceCircleId = asPositiveInteger(req.params.sourceCircleId);
            const actorUserId = parseAuthUserIdFromRequest(req);
            const declarationText = asOptionalString(req.body?.declarationText);

            if (!sourceCircleId || !actorUserId || !declarationText) {
                return res.status(400).json({ error: 'invalid_fork_create_input' });
            }

            const qualificationSnapshot = await resolveForkQualification(prisma, {
                sourceCircleId,
                userId: actorUserId,
            });
            if (!qualificationSnapshot.qualifies) {
                return res.status(403).json({
                    error: 'fork_qualification_not_met',
                    qualificationSnapshot,
                });
            }

            const targetCircleId = asPositiveInteger(req.body?.targetCircleId);
            const inheritanceSnapshot = asRecord(req.body?.inheritanceSnapshot)
                ?? (targetCircleId ? await buildForkInheritanceSnapshot(prisma, sourceCircleId) : undefined);
            const result = await createForkCircle(forkStore, {
                declarationId: asOptionalString(req.body?.declarationId) ?? randomUUID(),
                sourceCircleId,
                actorUserId,
                declarationText,
                originAnchorRef: asOptionalString(req.body?.originAnchorRef),
                qualificationSnapshot,
                inheritanceSnapshot,
                targetCircleId,
                executionAnchorDigest: asOptionalString(req.body?.executionAnchorDigest),
                createdAt: new Date(),
            });

            return res.json(result);
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_create_failed',
            });
        }
    });

    return router;
}
