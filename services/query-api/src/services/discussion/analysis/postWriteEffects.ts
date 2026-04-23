import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { enqueueDiscussionTriggerEvaluationJob } from '../../../ai/discussion-draft-trigger';
import { invalidateDiscussionSummaryCache } from '../summaryCache';

export async function runDiscussionAnalysisPostWriteEffects(input: {
    prisma: PrismaClient;
    redis: Redis;
    circleId: number;
    previousStatus: string | null | undefined;
    nextStatus: string;
    requestedByUserId?: number | null;
}): Promise<void> {
    try {
        await invalidateDiscussionSummaryCache(input.redis, input.circleId);
    } catch {
        // ignore cache invalidation failures
    }

    const becameReady = input.previousStatus !== 'ready' && input.nextStatus === 'ready';
    if (!becameReady) {
        return;
    }

    try {
        await enqueueDiscussionTriggerEvaluationJob(input.prisma, {
            circleId: input.circleId,
            requestedByUserId: input.requestedByUserId ?? null,
        });
    } catch {
        // best effort only
    }
}
