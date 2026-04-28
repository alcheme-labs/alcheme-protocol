import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { loadKnowledgeVersionDiff } from '../services/knowledgeVersionDiff';
import { resolveExpressRequestLocale } from '../i18n/request';

export function crystalRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    router.get('/:knowledgeId/version-diff', async (req: Request, res: Response) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            const fromVersion = Number.parseInt(String(req.query.fromVersion || ''), 10);
            const toVersion = Number.parseInt(String(req.query.toVersion || ''), 10);

            if (!knowledgeId || !Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) {
                return res.status(400).json({ error: 'invalid_version_range' });
            }

            const diff = await loadKnowledgeVersionDiff(prisma, {
                knowledgeId,
                fromVersion,
                toVersion,
                locale: resolveExpressRequestLocale(req),
            });

            if (!diff) {
                return res.status(404).json({ error: 'knowledge_version_diff_not_found' });
            }

            return res.json({
                ok: true,
                diff,
            });
        } catch (error) {
            console.error('Error fetching knowledge version diff:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // GET /crystals/:knowledgeId - 获取单个知识晶体
    router.get('/:knowledgeId', async (req: Request, res: Response) => {
        try {
            const { knowledgeId } = req.params;

            const crystal = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                include: {
                    author: true,
                    circle: true,
                    sourceCircle: true,
                },
            });

            if (!crystal) {
                return res.status(404).json({ error: 'Knowledge crystal not found' });
            }

            return res.json({
                data: {
                    ...crystal,
                    qualityScore: parseFloat(crystal.qualityScore as any) || 0,
                },
            });
        } catch (error) {
            console.error('Error fetching crystal:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // GET /crystals/circle/:circleId - 获取圈子的知识晶体列表
    router.get('/circle/:circleId', async (req: Request, res: Response) => {
        try {
            const circleId = parseInt(req.params.circleId);
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;

            if (isNaN(circleId)) {
                return res.status(400).json({ error: 'Invalid circle ID' });
            }

            const [crystals, total] = await Promise.all([
                prisma.knowledge.findMany({
                    where: { circleId },
                    take: limit,
                    skip: offset,
                    orderBy: { qualityScore: 'desc' },
                    include: {
                        author: true,
                        circle: true,
                    },
                }),
                prisma.knowledge.count({ where: { circleId } }),
            ]);

            return res.json({
                data: crystals.map((c: any) => ({
                    ...c,
                    qualityScore: parseFloat(c.qualityScore) || 0,
                })),
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: offset + limit < total,
                },
            });
        } catch (error) {
            console.error('Error fetching crystals:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
