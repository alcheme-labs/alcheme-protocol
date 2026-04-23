import { PrismaClient } from '@prisma/client';

import { processDueDraftWorkflowTransitions } from '../services/draftLifecycle/workflowState';

const INTERVAL_MS = 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

async function runSweep(prisma: PrismaClient) {
    try {
        const result = await processDueDraftWorkflowTransitions(prisma, {
            now: new Date(),
            limit: 100,
        });
        if (result.transitionedCount > 0) {
            console.log(
                `📝 Draft workflow sweep moved ${result.transitionedCount} drafts into review: ${result.transitionedDraftPostIds.join(', ')}`,
            );
        }
        if (result.reviewWindowExpiredCount > 0) {
            console.log(
                `📝 Draft workflow sweep marked ${result.reviewWindowExpiredCount} reviews as expired: ${result.reviewWindowExpiredDraftPostIds.join(', ')}`,
            );
        }
    } catch (error) {
        console.error('📝 Draft workflow sweep error:', error);
    }
}

export function startDraftWorkflowCron(prisma: PrismaClient): void {
    console.log('📝 Draft workflow cron started (interval: 1m)');
    void runSweep(prisma);
    intervalHandle = setInterval(() => {
        void runSweep(prisma);
    }, INTERVAL_MS);
}

export function stopDraftWorkflowCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('📝 Draft workflow cron stopped');
    }
}
