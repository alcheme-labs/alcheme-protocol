import os from 'os';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import type { QueryApiRuntimeConfig } from '../config/services';
import { startHeatDecayCron, stopHeatDecayCron } from '../cron/heat-decay';
import { startIdentityCron, stopIdentityCron } from '../cron/identity-evaluation';
import { startDraftWorkflowCron, stopDraftWorkflowCron } from '../cron/draft-workflow';
import {
    startGovernanceRequestReconciler,
    stopGovernanceRequestReconciler,
} from '../cron/governance-request-reconciler';
import { startForkRetentionCron, stopForkRetentionCron } from '../cron/fork-retention';
import { startGuardianWatcherCron, stopGuardianWatcherCron } from '../cron/guardian-watcher';
import { startCircleGrowthWatcherCron, stopCircleGrowthWatcherCron } from '../cron/circle-growth-watcher';
import { createAiJobHandlers } from '../services/aiJobs/handlers';
import { startAiJobWorker, type AiJobWorker } from '../services/aiJobs/worker';
import {
    startPendingDiscussionAnalysisRepair,
    stopPendingDiscussionAnalysisRepair,
} from '../services/discussion/analysis/repairPending';
import { startOffchainPeerSync, stopOffchainPeerSync } from '../services/offchainPeerSync';
import {
    startPendingGhostSettingsReconciler,
    stopPendingGhostSettingsReconciler,
} from '../services/pendingGhostSettingsReconciler';
import { ensureQueryRuntimeTaskStateSchema } from '../services/runtime/queryRuntimeTaskState';
import {
    listEnabledBackgroundServiceNames,
    type QueryBackgroundServiceName,
    type QueryBackgroundStartupPhase,
} from './backgroundServicePlan';

export {
    listEnabledBackgroundServiceNames,
    type QueryBackgroundServiceName,
    type QueryBackgroundStartupPhase,
} from './backgroundServicePlan';

export interface QueryBackgroundServicesControl {
    names: QueryBackgroundServiceName[];
    aiJobWorker: AiJobWorker | null;
    ownerId: string;
    phase: QueryBackgroundStartupPhase;
    stop(): Promise<void>;
}

export function resolveBackgroundOwnerId(): string {
    return process.env.QUERY_API_INSTANCE_ID || `${os.hostname()}:${process.pid}`;
}

function wrapCleanupError(label: string, error: unknown): Error {
    const wrapped = new Error(`query_background_cleanup_failed:${label}`);
    (wrapped as Error & { cause?: unknown }).cause = error;
    return wrapped;
}

function reportBackgroundCleanupErrors(errors: Error[]): void {
    for (const error of errors) {
        console.error(error.message, (error as Error & { cause?: unknown }).cause);
    }
}

export async function startQueryBackgroundServices(input: {
    prisma: PrismaClient;
    redis: Redis;
    runtime: QueryApiRuntimeConfig;
    phase: QueryBackgroundStartupPhase;
    ownerId?: string;
}): Promise<QueryBackgroundServicesControl> {
    const names = listEnabledBackgroundServiceNames(input.runtime, input.phase);
    const ownerId = input.ownerId || resolveBackgroundOwnerId();
    let aiJobWorker: AiJobWorker | null = null;
    const startedNames: QueryBackgroundServiceName[] = [];
    let stopped = false;

    const stopStartedServices = async (): Promise<Error[]> => {
        if (stopped) return [];
        stopped = true;
        const cleanupErrors: Error[] = [];
        const runCleanup = async (label: string, action: () => void | Promise<void>) => {
            try {
                await action();
            } catch (error) {
                cleanupErrors.push(wrapCleanupError(label, error));
            }
        };

        if (startedNames.includes('pending_ghost_settings')) {
            await runCleanup('pending_ghost_settings', () => stopPendingGhostSettingsReconciler());
        }
        if (startedNames.includes('guardian_watcher')) {
            await runCleanup('guardian_watcher', () => stopGuardianWatcherCron());
        }
        if (startedNames.includes('circle_growth_watcher')) {
            await runCleanup('circle_growth_watcher', () => stopCircleGrowthWatcherCron());
        }
        if (startedNames.includes('offchain_peer_sync')) {
            await runCleanup('offchain_peer_sync', () => stopOffchainPeerSync());
        }
        if (startedNames.includes('fork_retention')) {
            await runCleanup('fork_retention', () => stopForkRetentionCron());
        }
        if (startedNames.includes('governance_request_reconciler')) {
            await runCleanup('governance_request_reconciler', () => stopGovernanceRequestReconciler());
        }
        if (startedNames.includes('draft_workflow')) {
            await runCleanup('draft_workflow', () => stopDraftWorkflowCron());
        }
        if (startedNames.includes('identity_evaluation')) {
            await runCleanup('identity_evaluation', () => stopIdentityCron());
        }
        if (startedNames.includes('heat_decay')) {
            await runCleanup('heat_decay', () => stopHeatDecayCron());
        }
        if (startedNames.includes('pending_discussion_analysis')) {
            await runCleanup('pending_discussion_analysis', () => stopPendingDiscussionAnalysisRepair());
        }
        if (aiJobWorker) {
            await runCleanup('ai_job_worker', () => aiJobWorker!.stop());
        }
        return cleanupErrors;
    };

    if (names.length === 0) {
        console.log(`Query background services disabled (${input.runtime.backgroundMode}, ${input.phase})`);
        return {
            names,
            aiJobWorker,
            ownerId,
            phase: input.phase,
            async stop() {
                await stopStartedServices();
            },
        };
    }

    try {
        if (input.runtime.backgroundServices.singletonSchedulers) {
            await ensureQueryRuntimeTaskStateSchema(input.prisma);
        }

        if (names.includes('ai_job_worker')) {
            aiJobWorker = startAiJobWorker({
                prisma: input.prisma,
                redis: input.redis,
                workerId: `query-api:${ownerId}`,
                handlers: createAiJobHandlers({
                    prisma: input.prisma,
                    redis: input.redis,
                }),
            });
            startedNames.push('ai_job_worker');
        }

        if (names.includes('pending_discussion_analysis')) {
            startPendingDiscussionAnalysisRepair(input.prisma, { ownerId });
            startedNames.push('pending_discussion_analysis');
        }

        if (names.includes('heat_decay')) {
            startHeatDecayCron(input.prisma, { ownerId });
            startedNames.push('heat_decay');
        }
        if (names.includes('identity_evaluation')) {
            startIdentityCron(input.prisma, { ownerId });
            startedNames.push('identity_evaluation');
        }
        if (names.includes('draft_workflow')) {
            startDraftWorkflowCron(input.prisma, { ownerId });
            startedNames.push('draft_workflow');
        }
        if (names.includes('governance_request_reconciler')) {
            startGovernanceRequestReconciler(input.prisma, { ownerId, redis: input.redis });
            startedNames.push('governance_request_reconciler');
        }
        if (names.includes('fork_retention')) {
            startForkRetentionCron(input.prisma, { ownerId });
            startedNames.push('fork_retention');
        }
        if (names.includes('offchain_peer_sync')) {
            startOffchainPeerSync(input.prisma, { ownerId });
            startedNames.push('offchain_peer_sync');
        }
        if (names.includes('pending_ghost_settings')) {
            startPendingGhostSettingsReconciler(input.prisma, { ownerId });
            startedNames.push('pending_ghost_settings');
        }
        if (names.includes('guardian_watcher')) {
            startGuardianWatcherCron(input.prisma, { ownerId });
            startedNames.push('guardian_watcher');
        }
        if (names.includes('circle_growth_watcher')) {
            startCircleGrowthWatcherCron(input.prisma, { ownerId });
            startedNames.push('circle_growth_watcher');
        }
    } catch (error) {
        const cleanupErrors = await stopStartedServices();
        reportBackgroundCleanupErrors(cleanupErrors);
        throw error;
    }

    console.log(
        `Query background services started (${input.runtime.backgroundMode}, ${input.phase}): ${names.join(', ')}`,
    );

    return {
        names,
        aiJobWorker,
        ownerId,
        phase: input.phase,
        async stop() {
            const cleanupErrors = await stopStartedServices();
            if (cleanupErrors.length > 0) {
                throw new AggregateError(cleanupErrors, 'query_background_services_stop_failed');
            }
        },
    };
}
