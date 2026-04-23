import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    loadCrystallizationOutputRecordByDraftPostId,
    loadCrystallizationOutputRecordByKnowledgeId,
} from '../services/crystallization/readModel';

export function crystallizationRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/knowledge/:knowledgeId/output', async (req, res, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) {
                return res.status(400).json({ error: 'invalid_knowledge_id' });
            }

            const record = await loadCrystallizationOutputRecordByKnowledgeId(prisma, knowledgeId);
            if (!record) {
                return res.status(404).json({ error: 'crystallization_output_not_found' });
            }

            return res.json(record);
        } catch (error) {
            next(error);
        }
    });

    router.get('/drafts/:postId/output', async (req, res, next) => {
        try {
            const postId = Number.parseInt(String(req.params.postId || ''), 10);
            if (!Number.isFinite(postId) || postId <= 0) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const record = await loadCrystallizationOutputRecordByDraftPostId(prisma, postId);
            if (!record) {
                return res.status(404).json({ error: 'crystallization_output_not_found' });
            }

            return res.json(record);
        } catch (error) {
            next(error);
        }
    });

    return router;
}
