import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

export function userRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // GET /api/v1/users/:handle
    router.get('/:handle', async (req, res, next) => {
        try {
            const { handle } = req.params;
            const cacheKey = `user:${handle}`;

            // 检查缓存
            const cached = await redis.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
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
                where: { authorId: user.id },
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
