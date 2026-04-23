import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { authorizeDraftAction, parseAuthUserIdFromRequest } from '../services/membership/checks';
import {
    createSourceMaterial,
    SOURCE_MATERIAL_PLAINTEXT_CUSTODY,
} from '../services/sourceMaterials/ingest';
import { markCircleTopicProfileDirty } from '../services/discussion/analysis/invalidation';
import { listSourceMaterials } from '../services/sourceMaterials/readModel';

async function canAccessCircleMaterials(prisma: PrismaClient, circleId: number, userId: number): Promise<boolean> {
    const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: { creatorId: true },
    });
    if (!circle) return false;
    if (circle.creatorId === userId) return true;

    const membership = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId,
                userId,
            },
        },
        select: {
            status: true,
        },
    });

    return Boolean(membership && membership.status === 'Active');
}

function parseOptionalPositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalString(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function isSupportedTextLikeSourceMaterial(input: {
    name: string | null;
    mimeType: string | null;
}): boolean {
    const mimeType = String(input.mimeType || '').trim().toLowerCase();
    const name = String(input.name || '').trim().toLowerCase();
    if (!mimeType && !name) return false;
    if (mimeType.startsWith('text/')) return true;
    if (mimeType === 'application/json') return true;
    if (mimeType === 'application/ld+json') return true;
    if (mimeType === 'application/xml') return true;
    if (mimeType === 'text/csv') return true;
    return (
        name.endsWith('.txt')
        || name.endsWith('.md')
        || name.endsWith('.markdown')
        || name.endsWith('.json')
        || name.endsWith('.csv')
        || name.endsWith('.yaml')
        || name.endsWith('.yml')
        || name.endsWith('.xml')
    );
}

async function validateSeededSourceNodeScope(
    prisma: PrismaClient,
    input: {
        circleId: number;
        seededSourceNodeId: number | null;
    },
): Promise<{
    ok: true;
} | {
    ok: false;
    statusCode: number;
    error: string;
}> {
    if (!input.seededSourceNodeId) {
        return { ok: true };
    }

    const seededSourceNode = await (prisma as any).seededSourceNode.findUnique({
        where: { id: input.seededSourceNodeId },
        select: {
            id: true,
            circleId: true,
        },
    });
    if (!seededSourceNode) {
        return {
            ok: false,
            statusCode: 404,
            error: 'source_material_seeded_source_node_not_found',
        };
    }
    if (Number(seededSourceNode.circleId) !== input.circleId) {
        return {
            ok: false,
            statusCode: 409,
            error: 'source_material_seeded_source_circle_mismatch',
        };
    }

    return { ok: true };
}

export function sourceMaterialsRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    router.get('/:id/source-materials', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('source_materials');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = parseOptionalPositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            if (!userId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const draftPostId = parseOptionalPositiveInt(req.query?.draftPostId);
            if (draftPostId) {
                const access = await authorizeDraftAction(prisma as any, {
                    postId: draftPostId,
                    userId,
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
                if (access.post?.circleId !== circleId) {
                    return res.status(409).json({ error: 'source_material_draft_circle_mismatch' });
                }
            }

            const canAccess = await canAccessCircleMaterials(prisma, circleId, userId);
            if (!canAccess) {
                return res.status(403).json({ error: 'source_material_access_denied' });
            }

            const materials = await listSourceMaterials(prisma, {
                circleId,
                draftPostId,
                discussionThreadId: parseOptionalString(req.query?.discussionThreadId),
                seededSourceNodeId: parseOptionalPositiveInt(req.query?.seededSourceNodeId),
            });

            return res.json({
                ok: true,
                circleId,
                materials,
                custody: SOURCE_MATERIAL_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/:id/source-materials', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('source_materials');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = parseOptionalPositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            if (!userId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const canAccess = await canAccessCircleMaterials(prisma, circleId, userId);
            if (!canAccess) {
                return res.status(403).json({ error: 'source_material_access_denied' });
            }

            const name = parseOptionalString(req.body?.name);
            const content = typeof req.body?.content === 'string' ? req.body.content : '';
            const mimeType = parseOptionalString(req.body?.mimeType);
            const draftPostId = parseOptionalPositiveInt(req.body?.draftPostId);
            const seededSourceNodeId = parseOptionalPositiveInt(req.body?.seededSourceNodeId);
            const discussionThreadId = parseOptionalString(req.body?.discussionThreadId);

            if (!name) {
                return res.status(400).json({ error: 'source_material_name_required' });
            }
            if (!content.trim()) {
                return res.status(400).json({ error: 'source_material_content_required' });
            }
            if (!isSupportedTextLikeSourceMaterial({ name, mimeType })) {
                return res.status(415).json({ error: 'source_material_binary_upload_not_supported' });
            }

            if (draftPostId) {
                const access = await authorizeDraftAction(prisma as any, {
                    postId: draftPostId,
                    userId,
                    action: 'edit',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
                if (access.post?.circleId !== circleId) {
                    return res.status(409).json({ error: 'source_material_draft_circle_mismatch' });
                }
            } else {
                const canAccess = await canAccessCircleMaterials(prisma, circleId, userId);
                if (!canAccess) {
                    return res.status(403).json({ error: 'source_material_access_denied' });
                }
            }

            const seededNodeValidation = await validateSeededSourceNodeScope(prisma, {
                circleId,
                seededSourceNodeId,
            });
            if (!seededNodeValidation.ok) {
                return res.status(seededNodeValidation.statusCode).json({
                    error: seededNodeValidation.error,
                });
            }

            const material = await createSourceMaterial(prisma, {
                circleId,
                uploadedByUserId: userId,
                draftPostId,
                discussionThreadId,
                seededSourceNodeId,
                name,
                mimeType,
                content,
            });

            try {
                await markCircleTopicProfileDirty({
                    prisma,
                    redis,
                    circleId,
                    reason: 'source_material_created',
                    requestedByUserId: userId,
                });
            } catch {
                // best effort only
            }

            return res.json({
                ok: true,
                circleId,
                material,
                custody: SOURCE_MATERIAL_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            if (error instanceof Error && error.message) {
                return res.status(400).json({ error: error.message });
            }
            next(error);
        }
    });

    return router;
}
