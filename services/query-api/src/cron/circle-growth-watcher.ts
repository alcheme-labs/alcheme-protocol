import { PrismaClient } from '@prisma/client';

import { loadCircleGrowthAdvisorConfig } from '../services/aiOperatingLayer/growth/config';
import { collectCircleGrowthSignals } from '../services/aiOperatingLayer/growth/signals';
import { queueCircleGrowthAdvisorProposal } from '../services/aiOperatingLayer/growth/queue';
import { runSingletonTask } from '../services/runtime/queryRuntimeTaskState';

const INTERVAL_MS = 5 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

interface SingletonSchedulerOptions {
    ownerId?: string;
}

export async function runCircleGrowthWatcherSweep(
    prisma: PrismaClient,
    input: {
        now?: Date;
        limit?: number;
    } = {},
): Promise<{
    status: 'disabled' | 'processed';
    scannedCount: number;
    queuedCount: number;
    noSignalCount: number;
}> {
    if (!isCircleGrowthWatcherEnabled()) {
        return {
            status: 'disabled',
            scannedCount: 0,
            queuedCount: 0,
            noSignalCount: 0,
        };
    }

    const now = input.now ?? new Date();
    const circleIds = await listCircleGrowthCandidateCircleIds(prisma as any, {
        limit: input.limit,
    });
    let queuedCount = 0;
    let noSignalCount = 0;

    for (const circleId of circleIds) {
        const signal = await collectCircleGrowthSignals(prisma as any, {
            circleId,
            requestedByUserId: null,
            triggerSource: 'watcher',
            now,
        });
        if (signal.status === 'no_signal') {
            noSignalCount += 1;
            continue;
        }
        await queueCircleGrowthAdvisorProposal(prisma as any, {
            signal,
            actorUserId: null,
            now,
        });
        queuedCount += 1;
    }

    if (queuedCount > 0 || noSignalCount > 0) {
        console.log(
            `Circle Growth watcher scan scanned=${circleIds.length} queued=${queuedCount} noSignal=${noSignalCount}`,
        );
    }

    return {
        status: 'processed',
        scannedCount: circleIds.length,
        queuedCount,
        noSignalCount,
    };
}

export function startCircleGrowthWatcherCron(
    prisma: PrismaClient,
    options: SingletonSchedulerOptions = {},
): void {
    if (!isCircleGrowthWatcherEnabled()) {
        console.log('Circle Growth watcher cron disabled');
        return;
    }

    console.log('Circle Growth watcher cron started (interval: 5m)');
    const ownerId = options.ownerId || `query-api:${process.pid}`;
    const run = async () => {
        try {
            await runSingletonTask(prisma, {
                taskKey: 'circle_growth_watcher',
                ownerId,
                leaseMs: INTERVAL_MS,
                minIntervalMs: INTERVAL_MS,
            }, async () => {
                await runCircleGrowthWatcherSweep(prisma);
            });
        } catch (error) {
            console.error('Circle Growth watcher sweep error:', error);
        }
    };
    void run();
    intervalHandle = setInterval(() => {
        void run();
    }, INTERVAL_MS);
}

export function stopCircleGrowthWatcherCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('Circle Growth watcher cron stopped');
    }
}

async function listCircleGrowthCandidateCircleIds(
    prisma: any,
    input: {
        limit?: number;
    } = {},
): Promise<number[]> {
    if (typeof prisma?.circleSummarySnapshot?.findMany !== 'function') return [];
    const rows = await prisma.circleSummarySnapshot.findMany({
        distinct: ['circleId'],
        select: { circleId: true },
        orderBy: { createdAt: 'desc' },
        take: Math.max(1, Math.min(100, Number(input.limit ?? 25))),
    });
    return rows
        .map((row: any) => Number(row.circleId))
        .filter((value: number) => Number.isFinite(value) && value > 0);
}

function isCircleGrowthWatcherEnabled(): boolean {
    const config = loadCircleGrowthAdvisorConfig();
    return config.enabled && config.watcherEnabled;
}
