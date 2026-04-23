import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import * as generatorService from '../services/circleSummary/generator';
import * as snapshotService from '../services/circleSummary/snapshot';
import {
    canViewCircleMembers,
    parseAuthUserIdFromRequest,
    requireCircleManagerRole,
} from '../services/membership/checks';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseBoolLike(value: unknown): boolean {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function circleSummaryRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    async function loadCircleAccess(circleId: number, userId: number | null) {
        if (!userId) {
            return {
                allowed: false,
                statusCode: 401,
                error: 'authentication_required',
                message: 'authentication is required',
            } as const;
        }

        const circle = await prisma.circle.findUnique({
            where: { id: circleId },
            select: { creatorId: true },
        });
        if (!circle) {
            return {
                allowed: false,
                statusCode: 404,
                error: 'circle_not_found',
                message: 'circle is not found',
            } as const;
        }

        const allowed = await canViewCircleMembers(prisma, {
            circleId,
            userId,
            creatorId: circle.creatorId,
        });
        if (!allowed) {
            return {
                allowed: false,
                statusCode: 403,
                error: 'circle_summary_access_denied',
                message: 'only the circle creator or an active member can access summary snapshots',
            } as const;
        }

        return {
            allowed: true,
            statusCode: 200,
            error: 'ok',
            message: 'ok',
        } as const;
    }

    router.get('/:circleId/summary-snapshots/latest', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const userId = parseAuthUserIdFromRequest(req);
            const access = await loadCircleAccess(circleId, userId);
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const forceGenerate = parseBoolLike(req.query.regenerate);
            if (forceGenerate) {
                const canRegenerate = await requireCircleManagerRole(prisma, {
                    circleId,
                    userId: Number(userId),
                });
                if (!canRegenerate) {
                    return res.status(403).json({
                        error: 'circle_summary_regenerate_forbidden',
                        message: 'only circle owners or admins can regenerate summary snapshots',
                    });
                }
            }

            const snapshot = await generatorService.ensureLatestCircleSummarySnapshot(prisma, {
                circleId,
                forceGenerate,
            });

            return res.status(200).json({
                ok: true,
                snapshot,
            });
        } catch (error) {
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
            const userId = parseAuthUserIdFromRequest(req);
            const access = await loadCircleAccess(circleId, userId);
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const snapshot = await snapshotService.loadCircleSummarySnapshotByVersion(prisma, circleId, version);
            if (!snapshot) {
                return res.status(404).json({ error: 'circle_summary_snapshot_not_found' });
            }

            return res.status(200).json({
                ok: true,
                snapshot,
            });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}
