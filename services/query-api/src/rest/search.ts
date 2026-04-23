import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

export function searchRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // GET /api/v1/search/users?q=alice
    router.get('/users', async (req, res, next) => {
        try {
            const query = req.query.q as string;
            const limit = parseInt(req.query.limit as string) || 20;

            if (!query) {
                return res.status(400).json({ error: 'Query parameter "q" is required' });
            }

            const users = await prisma.user.findMany({
                where: {
                    OR: [
                        { handle: { contains: query, mode: 'insensitive' } },
                        { displayName: { contains: query, mode: 'insensitive' } },
                    ],
                },
                take: limit,
                select: {
                    handle: true,
                    displayName: true,
                    bio: true,
                    avatarUri: true,
                    reputationScore: true,
                    followersCount: true,
                },
            });

            res.json(users);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/search/posts?q=web3&tags=defi
    router.get('/posts', async (req, res, next) => {
        try {
            const query = req.query.q as string;
            const tags = req.query.tags ? (req.query.tags as string).split(',') : [];
            const limit = parseInt(req.query.limit as string) || 20;

            const where: any = {
                status: { in: ['Active', 'Published'] },
                visibility: 'Public',
            };

            if (query) {
                where.text = { contains: query, mode: 'insensitive' };
            }

            if (tags.length > 0) {
                where.tags = { hasSome: tags };
            }

            const posts = await prisma.post.findMany({
                where,
                take: limit,
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

    return router;
}
