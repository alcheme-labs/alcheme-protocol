import { PrismaClient } from '@prisma/client';

import {
    listGuardianCandidateCircleIds,
    runGuardianFindingScan,
} from '../services/aiOperatingLayer/guardian/jobs';
import { runSingletonTask } from '../services/runtime/queryRuntimeTaskState';

const INTERVAL_MS = 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

interface SingletonSchedulerOptions {
    ownerId?: string;
}

export async function runGuardianWatcherSweep(prisma: PrismaClient): Promise<void> {
    if (!isGuardianWatcherEnabled()) {
        return;
    }

    const circleIds = await listGuardianCandidateCircleIds(prisma as any, {
        limit: 25,
    });
    let createdCount = 0;
    let dedupedCount = 0;
    let notifiedCount = 0;
    let failedNotificationCount = 0;
    for (const circleId of circleIds) {
        const result = await runGuardianFindingScan(prisma as any, {
            circleId,
            requestedByUserId: null,
            now: new Date(),
        });
        createdCount += result.createdCount;
        dedupedCount += result.dedupedCount;
        notifiedCount += result.notifiedCount;
        failedNotificationCount += result.failedNotificationCount;
    }

    if (createdCount > 0 || dedupedCount > 0 || notifiedCount > 0 || failedNotificationCount > 0) {
        console.log(
            `Guardian watcher scan created=${createdCount} deduped=${dedupedCount} notified=${notifiedCount} notificationFailed=${failedNotificationCount}`,
        );
    }
}

export function startGuardianWatcherCron(
    prisma: PrismaClient,
    options: SingletonSchedulerOptions = {},
): void {
    if (!isGuardianWatcherEnabled()) {
        console.log('Guardian watcher cron disabled');
        return;
    }

    console.log('Guardian watcher cron started (interval: 1m)');
    const ownerId = options.ownerId || `query-api:${process.pid}`;
    const run = async () => {
        try {
            await runSingletonTask(prisma, {
                taskKey: 'guardian_watcher',
                ownerId,
                leaseMs: 60_000,
                minIntervalMs: 60_000,
            }, () => runGuardianWatcherSweep(prisma));
        } catch (error) {
            console.error('Guardian watcher sweep error:', error);
        }
    };
    void run();
    intervalHandle = setInterval(() => {
        void run();
    }, INTERVAL_MS);
}

export function stopGuardianWatcherCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('Guardian watcher cron stopped');
    }
}

function isGuardianWatcherEnabled(): boolean {
    const guardianEnabled = String(process.env.AI_GUARDIAN_ENABLED ?? 'true').trim().toLowerCase();
    const watcherEnabled = String(process.env.AI_GUARDIAN_WATCHER_ENABLED ?? 'false').trim().toLowerCase();
    return !['false', '0', 'off'].includes(guardianEnabled)
        && watcherEnabled === 'true';
}
