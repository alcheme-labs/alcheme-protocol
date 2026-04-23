import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { verifiedUserFilter } from '../utils/filters';
import {
    hasActiveCircleMembership,
    parseAuthUserIdFromRequest,
} from '../services/membership/checks';

function stringifyCachePayload(value: unknown): string {
    return JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue);
}

function toJsonPayload<T>(value: T): T {
    return JSON.parse(stringifyCachePayload(value)) as T;
}

function normalizeCircleMode(value: unknown): 'social' | 'knowledge' {
    return typeof value === 'string' && value.toLowerCase() === 'social'
        ? 'social'
        : 'knowledge';
}

export function postRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();
    const draftStatusPatchWindowMs = 30 * 60 * 1000;

    // POST /api/v1/posts/:contentId/circle
    // 为链上创建的内容补充圈层归属（最小绑定链路，便于圈层内动态流查询）
    router.post('/:contentId/circle', async (req, res, next) => {
        try {
            const authUserId = parseAuthUserIdFromRequest(req as any);
            if (!authUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const body = req.body ?? {};
            const contentId = String(req.params.contentId || '').trim();
            const fallbackContentIds = Array.isArray(body.fallbackContentIds)
                ? body.fallbackContentIds
                    .map((value: unknown) => String(value || '').trim())
                    .filter((value: string) => value.length > 0)
                : [];
            const contentLookupCandidates = Array.from(new Set([contentId, ...fallbackContentIds]));
            const circleId = Number(body.circleId);
            const textRaw = typeof body.text === 'string' ? body.text : undefined;
            const text = textRaw ? textRaw.trim() : undefined;
            const statusRaw = typeof body.status === 'string' ? body.status.trim() : '';

            const hasLegacyVisibilityField = Object.prototype.hasOwnProperty.call(body, 'visibility');
            const hasLegacyStatusField = Object.prototype.hasOwnProperty.call(body, 'status');
            if (hasLegacyVisibilityField) {
                return res.status(400).json({
                    error: 'deprecated_authority_fields',
                    message: 'visibility is chain-authoritative and cannot be patched via this endpoint',
                });
            }
            const applyDraftStatusPatch = hasLegacyStatusField && statusRaw === 'Draft';
            if (hasLegacyStatusField && !applyDraftStatusPatch) {
                return res.status(400).json({
                    error: 'deprecated_authority_fields',
                    message: 'status patch is only temporarily allowed for Draft workflow compatibility',
                });
            }

            if (!contentId) {
                return res.status(400).json({ error: 'invalid_content_id' });
            }
            if (!Number.isFinite(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    onChainAddress: true,
                    mode: true,
                    kind: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }

            const existing = await prisma.post.findFirst({
                where: {
                    OR: contentLookupCandidates.flatMap((candidate) => ([
                        { contentId: candidate },
                        { onChainAddress: candidate },
                    ])),
                },
                select: {
                    id: true,
                    contentId: true,
                    authorId: true,
                    circleId: true,
                    status: true,
                    createdAt: true,
                },
            });
            if (!existing) {
                return res.status(404).json({ error: 'post_not_indexed_yet' });
            }
            if (existing.authorId !== authUserId) {
                return res.status(403).json({ error: 'forbidden_post_author_mismatch' });
            }

            const isMember = await hasActiveCircleMembership(prisma, {
                circleId,
                userId: authUserId,
            });
            if (!isMember) {
                return res.status(403).json({ error: 'membership_required' });
            }

            const existingStatus = String(existing.status);
            const createdAtMs = new Date(existing.createdAt).getTime();
            const isWithinDraftPatchWindow =
                Number.isFinite(createdAtMs)
                && (Date.now() - createdAtMs) <= draftStatusPatchWindowMs;
            const canApplyDraftStatusPatch =
                applyDraftStatusPatch
                && (
                    existingStatus === 'Draft'
                    || (
                        (existingStatus === 'Active' || existingStatus === 'Published')
                        && existing.circleId === null
                        && isWithinDraftPatchWindow
                    )
                );
            if (applyDraftStatusPatch && !canApplyDraftStatusPatch) {
                return res.status(409).json({
                    error: 'draft_status_patch_not_allowed',
                    message: 'draft status patch is restricted to newly created unbound posts',
                });
            }

            const circleMode = normalizeCircleMode(circle.mode);
            const nextPostStatus = applyDraftStatusPatch ? 'Draft' : existingStatus;
            const isDraftIntent = nextPostStatus === 'Draft';
            if (circleMode === 'knowledge' && !isDraftIntent) {
                return res.status(409).json({
                    error: 'circle_mode_intent_mismatch',
                    message: 'knowledge circles only accept draft content bindings',
                });
            }
            if (circleMode === 'social' && isDraftIntent) {
                return res.status(409).json({
                    error: 'circle_mode_intent_mismatch',
                    message: 'social circles only accept feed content bindings',
                });
            }

            const post = await prisma.post.update({
                where: { id: existing.id },
                data: {
                    circleId,
                    ...(text ? { text } : {}),
                    ...(applyDraftStatusPatch ? { status: 'Draft' as any } : {}),
                },
                select: {
                    id: true,
                    contentId: true,
                    circleId: true,
                    text: true,
                    visibility: true,
                    status: true,
                    updatedAt: true,
                },
            });

            const cacheKeys = Array.from(
                new Set([existing.contentId, ...contentLookupCandidates].map((value) => `post:${value}`)),
            );
            await Promise.all(
                cacheKeys.map(async (cacheKey) => {
                    await redis.del(cacheKey);
                    await redis.publish('cache:invalidation', JSON.stringify({
                        type: 'invalidation',
                        key: cacheKey,
                    }));
                }),
            );

            return res.json({
                ok: true,
                post,
                circleAuthority: {
                    appCircleId: circle.id,
                    protocolCircleId: circle.id,
                    circleOnChainAddress: circle.onChainAddress,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/posts/feed
    router.get('/feed', async (req, res, next) => {
        try {
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const verifiedOnly = req.query.verified !== 'false'; // Default to true

            const where: any = {
                status: { in: ['Active', 'Published'] },
                visibility: 'Public',
            };

            if (verifiedOnly) {
                Object.assign(where, verifiedUserFilter);
            }

            const posts = await prisma.post.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: {
                    author: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                },
            });

            res.json(toJsonPayload(posts));
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/posts/trending
    router.get('/trending', async (req, res, next) => {
        try {
            const timeRange = (req.query.timeRange as string) || 'day';
            const limit = parseInt(req.query.limit as string) || 20;

            const timeMap: Record<string, number> = {
                hour: 60 * 60 * 1000,
                day: 24 * 60 * 60 * 1000,
                week: 7 * 24 * 60 * 60 * 1000,
                month: 30 * 24 * 60 * 60 * 1000,
            };

            const since = new Date(Date.now() - (timeMap[timeRange] || timeMap.day));

            const posts = await prisma.post.findMany({
                where: {
                    status: { in: ['Active', 'Published'] },
                    visibility: 'Public',
                    createdAt: { gte: since },
                },
                take: limit,
                orderBy: [
                    { likesCount: 'desc' },
                    { repostsCount: 'desc' },
                ],
                include: {
                    author: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                },
            });

            res.json(toJsonPayload(posts));
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/posts/:contentId
    router.get('/:contentId', async (req, res, next) => {
        try {
            const { contentId } = req.params;
            const cacheKey = `post:${contentId}`;

            // 检查缓存
            const cached = await redis.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
            }

            const post = await prisma.post.findUnique({
                where: { contentId },
                include: {
                    author: {
                        select: {
                            handle: true,
                            pubkey: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                    circle: {
                        select: {
                            id: true,
                            onChainAddress: true,
                        },
                    },
                },
            });

            const resolvedPost = post || await prisma.post.findFirst({
                where: { onChainAddress: contentId },
                include: {
                    author: {
                        select: {
                            handle: true,
                            pubkey: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                    circle: {
                        select: {
                            id: true,
                            onChainAddress: true,
                        },
                    },
                },
            });

            if (!resolvedPost) {
                return res.status(404).json({ error: 'Post not found' });
            }

            const responsePayload = toJsonPayload(resolvedPost);

            // 帖子不可变,永久缓存
            await redis.setex(cacheKey, 3600, stringifyCachePayload(resolvedPost));

            res.json(responsePayload);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
