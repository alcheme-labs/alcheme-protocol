import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    claimNextAiJob,
    completeAiJob,
    failAiJob,
    getAiJobClaimLeaseMs,
    renewAiJobLease,
} from './runtime';
import type { AiJobHandlerMap, AiJobType } from './types';

export interface AiJobWorker {
    start(): void;
    stop(): Promise<void>;
    runOnce(): Promise<boolean>;
    isRunning(): boolean;
    readonly workerId: string;
}

export function createAiJobWorker(input: {
    prisma: PrismaClient;
    redis?: Redis;
    handlers: AiJobHandlerMap;
    workerId?: string;
    jobTypes?: AiJobType[];
    pollIntervalMs?: number;
    leaseMs?: number;
}): AiJobWorker {
    const workerId = input.workerId || `query-api-${process.pid}`;
    const pollIntervalMs = Math.max(50, Number(input.pollIntervalMs || process.env.AI_JOB_POLL_INTERVAL_MS || 1000));
    const leaseMs = Math.max(1_000, Number(input.leaseMs || getAiJobClaimLeaseMs()));
    const renewIntervalMs = Math.max(250, Math.floor(leaseMs / 3));
    let intervalHandle: NodeJS.Timeout | null = null;
    let activeRun: Promise<boolean> | null = null;

    const runOnce = async (): Promise<boolean> => {
        if (activeRun) {
            return activeRun;
        }

        activeRun = (async () => {
            const job = await claimNextAiJob(input.prisma as any, {
                workerId,
                jobTypes: input.jobTypes,
                leaseMs,
            });
            if (!job) {
                return false;
            }

            const handler = input.handlers[job.jobType];
            if (!handler) {
                await failAiJob(input.prisma as any, {
                    jobId: job.id,
                    claimToken: job.claimToken || '',
                    error: {
                        code: 'missing_ai_job_handler',
                        message: `No handler registered for ai job type ${job.jobType}`,
                    },
                });
                return true;
            }

            let renewHandle: NodeJS.Timeout | null = null;
            const clearRenewHandle = () => {
                if (renewHandle) {
                    clearInterval(renewHandle);
                    renewHandle = null;
                }
            };

            if (job.claimToken) {
                renewHandle = setInterval(() => {
                    void renewAiJobLease(input.prisma as any, {
                        jobId: job.id,
                        claimToken: job.claimToken || '',
                    });
                }, renewIntervalMs);
            }

            try {
                const result = await handler({
                    job,
                    prisma: input.prisma as any,
                    redis: input.redis,
                });
                clearRenewHandle();
                await completeAiJob(input.prisma as any, {
                    jobId: job.id,
                    claimToken: job.claimToken || '',
                    result: result || null,
                });
            } catch (error) {
                clearRenewHandle();
                await failAiJob(input.prisma as any, {
                    jobId: job.id,
                    claimToken: job.claimToken || '',
                    error: {
                        code: 'ai_job_handler_failed',
                        message: error instanceof Error ? error.message : String(error),
                    },
                });
            }
            return true;
        })();

        try {
            return await activeRun;
        } finally {
            activeRun = null;
        }
    };

    return {
        workerId,
        start() {
            if (intervalHandle) return;
            intervalHandle = setInterval(() => {
                void runOnce();
            }, pollIntervalMs);
            void runOnce();
        },
        async stop() {
            if (intervalHandle) {
                clearInterval(intervalHandle);
                intervalHandle = null;
            }
            if (activeRun) {
                await activeRun;
            }
        },
        runOnce,
        isRunning() {
            return intervalHandle !== null;
        },
    };
}

export function startAiJobWorker(input: {
    prisma: PrismaClient;
    redis?: Redis;
    handlers: AiJobHandlerMap;
    workerId?: string;
    jobTypes?: AiJobType[];
    pollIntervalMs?: number;
    leaseMs?: number;
}): AiJobWorker {
    const worker = createAiJobWorker(input);
    worker.start();
    return worker;
}
