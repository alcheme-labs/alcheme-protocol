import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

import { loadNodeRuntimeConfig, requirePrivateSidecarSurface } from '../config/services';
import { requireAuthenticatedActor } from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
import {
    decodeProfileAvatarUpload,
    encodeProfileAvatarUri,
    mapProfileAvatarStorageError,
    parseProfileAvatarObjectId,
    sniffProfileAvatarMime,
} from '../services/profileAvatar/objectUri';
import { createStorageFabricObjectClientFromRuntime } from '../services/sourceMaterials/storageFabricObjectClient';

export function userRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    router.post('/me/avatar', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('profile_avatar');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            let payload: ReturnType<typeof decodeProfileAvatarUpload>;
            try {
                payload = decodeProfileAvatarUpload(req.body ?? {});
            } catch (error) {
                const statusCode = Number((error as { statusCode?: number }).statusCode) || 400;
                return res.status(statusCode).json({
                    error: error instanceof Error ? error.message : 'profile_avatar_invalid',
                });
            }

            const objectClient = createStorageFabricObjectClientFromRuntime({
                runtimeRole: loadNodeRuntimeConfig().runtimeRole,
            });
            if (!objectClient) {
                return res.status(503).json({ error: 'profile_avatar_storage_unavailable' });
            }

            const uploaded = await objectClient.uploadObject({
                principalRef: actor.pubkey,
                mimeType: payload.mimeType,
                bytes: payload.bytes,
                idempotencyKey: `profile-avatar:${actor.userId}:${createHash('sha256').update(payload.bytes).digest('hex')}:${randomUUID()}`,
            });
            return res.json({
                ok: true,
                avatarUri: encodeProfileAvatarUri(uploaded.objectId),
                objectId: uploaded.objectId,
                contentDigest: uploaded.contentDigest,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            const mapped = mapProfileAvatarStorageError(error);
            if (mapped) {
                return res.status(mapped.statusCode).json({ error: mapped.error });
            }
            next(error);
        }
    });

    router.get('/:handle/avatar', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('profile_avatar');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const handle = String(req.params.handle || '').trim();
            if (!handle || handle === 'me') {
                return res.status(400).json({ error: 'invalid_handle' });
            }

            const user = await prisma.user.findUnique({
                where: { handle },
                select: { avatarUri: true },
            });
            if (!user?.avatarUri) {
                return res.status(404).json({ error: 'profile_avatar_not_found' });
            }

            if (/^https?:\/\//i.test(user.avatarUri)) {
                return res.redirect(302, user.avatarUri);
            }

            const objectId = parseProfileAvatarObjectId(user.avatarUri);
            if (!objectId) {
                return res.status(404).json({ error: 'profile_avatar_not_found' });
            }

            const objectClient = createStorageFabricObjectClientFromRuntime({
                runtimeRole: loadNodeRuntimeConfig().runtimeRole,
            });
            if (!objectClient) {
                return res.status(503).json({ error: 'profile_avatar_storage_unavailable' });
            }

            const ownerRef = String(process.env.STORAGE_FABRIC_OBJECT_OWNER_REF || '').trim();
            const result = await objectClient.readObject({
                principalRef: ownerRef || objectId,
                objectId,
            });
            const sniffed = sniffProfileAvatarMime(result.bytes);
            if (!sniffed) {
                return res.status(404).json({ error: 'profile_avatar_not_found' });
            }
            res.set('Content-Type', sniffed);
            res.set('X-Content-Type-Options', 'nosniff');
            res.set('Cache-Control', 'private, max-age=300');
            return res.send(result.bytes);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            const mapped = mapProfileAvatarStorageError(error);
            if (mapped) {
                return res.status(mapped.statusCode).json({ error: mapped.error });
            }
            next(error);
        }
    });

    // GET /api/v1/users/:handle
    router.get('/:handle', async (req, res, next) => {
        try {
            const { handle } = req.params;
            const cacheKey = `user:${handle}`;
            const skipCache = String(req.headers['cache-control'] || '').toLowerCase().includes('no-store');

            if (!skipCache) {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    return res.json(JSON.parse(cached));
                }
            }

            const user = await prisma.user.findUnique({
                where: { handle },
                select: {
                    id: true,
                    handle: true,
                    pubkey: true,
                    displayName: true,
                    bio: true,
                    avatarUri: true,
                    bannerUri: true,
                    website: true,
                    location: true,
                    reputationScore: true,
                    followersCount: true,
                    followingCount: true,
                    postsCount: true,
                    circlesCount: true,
                    createdAt: true,
                },
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // 缓存5分钟
            await redis.setex(cacheKey, 300, JSON.stringify(user));

            res.json(user);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/users/:handle/posts
    router.get('/:handle/posts', async (req, res, next) => {
        try {
            const { handle } = req.params;
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;

            const user = await prisma.user.findUnique({
                where: { handle },
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const posts = await prisma.post.findMany({
                where: { authorId: user.id, safetyQuarantined: false },
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

            res.json(posts);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/users/:handle/followers
    router.get('/:handle/followers', async (req, res, next) => {
        try {
            const { handle } = req.params;
            const limit = parseInt(req.query.limit as string) || 50;

            const user = await prisma.user.findUnique({
                where: { handle },
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const followers = await prisma.follow.findMany({
                where: { followingId: user.id },
                take: limit,
                include: {
                    follower: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                            reputationScore: true,
                        },
                    },
                },
            });

            res.json(followers.map((f) => f.follower));
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/users/:handle/following
    router.get('/:handle/following', async (req, res, next) => {
        try {
            const { handle } = req.params;
            const limit = parseInt(req.query.limit as string) || 50;

            const user = await prisma.user.findUnique({
                where: { handle },
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const following = await prisma.follow.findMany({
                where: { followerId: user.id },
                take: limit,
                include: {
                    following: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                            reputationScore: true,
                        },
                    },
                },
            });

            res.json(following.map((f) => f.following));
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/users/:handle/authority-score
    router.get('/:handle/authority-score', async (req, res, next) => {
        try {
            const { handle } = req.params;

            const user = await prisma.user.findUnique({
                where: { handle },
                select: { pubkey: true, reputationScore: true },
            });

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // 查询该用户参与的最新 authority scores (通过 settlement_history)
            const settlements = await prisma.settlementHistory.findMany({
                where: { contributorPubkey: user.pubkey },
                take: 10,
                orderBy: { settledAt: 'desc' },
            });

            // 查询 anti-gaming 标记
            const flags = await prisma.antiGamingFlag.findMany({
                where: { userPubkey: user.pubkey },
                orderBy: { createdAt: 'desc' },
            });

            res.json({
                reputationScore: user.reputationScore,
                recentSettlements: settlements,
                antiGamingFlags: flags,
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
