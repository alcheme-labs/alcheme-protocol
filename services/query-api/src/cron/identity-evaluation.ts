import { PrismaClient } from '@prisma/client';

import { evaluateCircle } from '../identity/machine';
import { runSingletonTask } from '../services/runtime/queryRuntimeTaskState';

/**
 * Identity Evaluation Cron
 *
 * Periodically re-evaluates all active circle members' identity levels.
 * Runs every 6 hours to check promotions (contribution thresholds)
 * and demotions (inactivity, reputation drops).
 */

const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let intervalHandle: NodeJS.Timeout | null = null;

interface SingletonSchedulerOptions {
    ownerId?: string;
}

export async function runIdentityEvaluationPass(prisma: PrismaClient): Promise<void> {
    const start = Date.now();

    // Get all active circles
    const circles = await prisma.circle.findMany({
        select: { id: true, name: true },
    });

    let totalChanges = 0;
    for (const circle of circles) {
        const changes = await evaluateCircle(prisma, circle.id, { circleName: circle.name });
        if (changes.length > 0) {
            console.log(
                `🪪 Circle "${circle.name}" (id=${circle.id}): ${changes.length} identity changes`,
            );
            totalChanges += changes.length;
        }
    }

    const elapsed = Date.now() - start;
    console.log(
        `🪪 Identity evaluation complete: ${circles.length} circles, ${totalChanges} changes in ${elapsed}ms`,
    );
}

export function startIdentityCron(
    prisma: PrismaClient,
    options: SingletonSchedulerOptions = {},
): void {
    console.log('🪪 Identity evaluation cron started (interval: 6h)');

    const ownerId = options.ownerId || `query-api:${process.pid}`;
    const evaluate = async () => {
        try {
            await runSingletonTask(prisma, {
                taskKey: 'identity_evaluation',
                ownerId,
                leaseMs: 30 * 60 * 1000,
                minIntervalMs: 5 * 60 * 60 * 1000,
            }, () => runIdentityEvaluationPass(prisma));
        } catch (error) {
            console.error('🪪 Identity evaluation cron error:', error);
        }
    };

    // Don't run immediately on startup — wait for first interval
    intervalHandle = setInterval(evaluate, INTERVAL_MS);
}

export function stopIdentityCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('🪪 Identity evaluation cron stopped');
    }
}
