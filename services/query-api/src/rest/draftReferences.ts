import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import * as draftReferenceReadModel from '../services/draftReferences/readModel';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

export function draftReferencesRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/:postId/reference-links', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const referenceLinks = await draftReferenceReadModel.loadDraftReferenceLinks(prisma, draftPostId);
            return res.status(200).json({
                ok: true,
                draftPostId,
                referenceLinks,
            });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}
