import { PrismaClient } from '@prisma/client';

import { processDueDraftWorkflowTransitions } from '../services/draftLifecycle/workflowState';
import { runSingletonTask } from '../services/runtime/queryRuntimeTaskState';

const INTERVAL_MS = 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

interface SingletonSchedulerOptions {
    ownerId?: string;
}

export async function runDraftWorkflowSweep(prisma: PrismaClient): Promise<void> {
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
}

export function startDraftWorkflowCron(
    prisma: PrismaClient,
    options: SingletonSchedulerOptions = {},
): void {
    console.log('📝 Draft workflow cron started (interval: 1m)');
    const ownerId = options.ownerId || `query-api:${process.pid}`;
    const run = async () => {
        try {
            await runSingletonTask(prisma, {
                taskKey: 'draft_workflow',
                ownerId,
                leaseMs: 45_000,
                minIntervalMs: 45_000,
            }, () => runDraftWorkflowSweep(prisma));
        } catch (error) {
            console.error('📝 Draft workflow sweep error:', error);
        }
    };
    void run();
    intervalHandle = setInterval(() => {
        void run();
    }, INTERVAL_MS);
}

export function stopDraftWorkflowCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('📝 Draft workflow cron stopped');
    }
}
