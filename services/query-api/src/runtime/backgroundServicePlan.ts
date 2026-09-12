import type { QueryApiRuntimeConfig } from '../config/services';

export type QueryBackgroundStartupPhase = 'pre_listen' | 'post_listen';

export const PRE_LISTEN_SINGLETON_SCHEDULER_SERVICE_NAMES = [
    'pending_discussion_analysis',
] as const;

export const POST_LISTEN_SINGLETON_SCHEDULER_SERVICE_NAMES = [
    'heat_decay',
    'identity_evaluation',
    'draft_workflow',
    'governance_request_reconciler',
    'fork_retention',
    'offchain_peer_sync',
    'pending_ghost_settings',
    'guardian_watcher',
    'circle_growth_watcher',
] as const;

export type QueryBackgroundServiceName =
    | 'ai_job_worker'
    | typeof PRE_LISTEN_SINGLETON_SCHEDULER_SERVICE_NAMES[number]
    | typeof POST_LISTEN_SINGLETON_SCHEDULER_SERVICE_NAMES[number];

export function listEnabledBackgroundServiceNames(
    runtime: Pick<QueryApiRuntimeConfig, 'backgroundMode' | 'backgroundServices'>,
    phase: QueryBackgroundStartupPhase,
): QueryBackgroundServiceName[] {
    const names: QueryBackgroundServiceName[] = [];

    if (phase === 'pre_listen' && runtime.backgroundServices.aiJobWorker) {
        names.push('ai_job_worker');
    }

    if (phase === 'pre_listen' && runtime.backgroundServices.singletonSchedulers) {
        names.push(...PRE_LISTEN_SINGLETON_SCHEDULER_SERVICE_NAMES);
    }

    if (phase === 'post_listen' && runtime.backgroundServices.singletonSchedulers) {
        names.push(...POST_LISTEN_SINGLETON_SCHEDULER_SERVICE_NAMES);
    }

    return names;
}
