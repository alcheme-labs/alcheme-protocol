export const FORK_RETENTION_CHECKPOINT_DAYS = [2, 7, 30, 90, 180] as const;

export interface CircleForkLineageSeed {
    targetCircleId: number;
    sourceCircleId: number;
    declarationId: string | null;
    createdAt: Date;
}

export interface ForkRetentionStateRecord {
    targetCircleId: number;
    sourceCircleId: number;
    declarationId: string | null;
    currentCheckpointDay: number;
    nextCheckAt: Date | null;
    inactiveStreak: number;
    markerVisible: boolean;
    permanentAt: Date | null;
    hiddenAt: Date | null;
    lastEvaluatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface CircleActivityRollupRecord {
    circleId: number;
    windowStart: Date;
    windowEnd: Date;
    memberGrowthSignal: number;
    contentGrowthSignal: number;
    crystallizationSignal: number;
    activityScore: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface ForkRetentionStore {
    listLineagesMissingRetentionState(): Promise<CircleForkLineageSeed[]>;
    createRetentionState(state: ForkRetentionStateRecord): Promise<ForkRetentionStateRecord>;
    listDueRetentionStates(now: Date, limit?: number): Promise<ForkRetentionStateRecord[]>;
    getLatestActivityRollup(circleId: number): Promise<CircleActivityRollupRecord | null>;
    saveRetentionState(state: ForkRetentionStateRecord): Promise<ForkRetentionStateRecord>;
}

function addDays(base: Date, days: number): Date {
    return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function resolveNextCheckpointDay(currentCheckpointDay: number): number | null {
    const index = FORK_RETENTION_CHECKPOINT_DAYS.findIndex((day) => day === currentCheckpointDay);
    if (index < 0 || index >= FORK_RETENTION_CHECKPOINT_DAYS.length - 1) {
        return null;
    }
    return FORK_RETENTION_CHECKPOINT_DAYS[index + 1];
}

export function computeForkActivityScore(input: {
    memberGrowthSignal: number;
    contentGrowthSignal: number;
    crystallizationSignal: number;
}): number {
    return (
        0.35 * Number(input.memberGrowthSignal || 0)
        + 0.40 * Number(input.contentGrowthSignal || 0)
        + 0.25 * Number(input.crystallizationSignal || 0)
    );
}

export function buildInitialForkRetentionState(
    lineage: CircleForkLineageSeed,
): ForkRetentionStateRecord {
    const firstCheckpointDay = FORK_RETENTION_CHECKPOINT_DAYS[0];
    return {
        targetCircleId: lineage.targetCircleId,
        sourceCircleId: lineage.sourceCircleId,
        declarationId: lineage.declarationId,
        currentCheckpointDay: firstCheckpointDay,
        nextCheckAt: addDays(lineage.createdAt, firstCheckpointDay),
        inactiveStreak: 0,
        markerVisible: true,
        permanentAt: null,
        hiddenAt: null,
        lastEvaluatedAt: null,
        createdAt: lineage.createdAt,
        updatedAt: lineage.createdAt,
    };
}

export function evaluateForkRetentionState(input: {
    state: ForkRetentionStateRecord;
    latestRollup: CircleActivityRollupRecord | null;
    now: Date;
}): ForkRetentionStateRecord {
    const activityScore = input.latestRollup
        ? computeForkActivityScore({
            memberGrowthSignal: input.latestRollup.memberGrowthSignal,
            contentGrowthSignal: input.latestRollup.contentGrowthSignal,
            crystallizationSignal: input.latestRollup.crystallizationSignal,
        })
        : 0;
    const isActive = activityScore > 0;
    const isFinalCheckpoint = input.state.currentCheckpointDay === FORK_RETENTION_CHECKPOINT_DAYS[FORK_RETENTION_CHECKPOINT_DAYS.length - 1];

    if (!isActive) {
        const inactiveStreak = input.state.inactiveStreak + 1;
        if (inactiveStreak >= 2 || isFinalCheckpoint) {
            return {
                ...input.state,
                inactiveStreak,
                markerVisible: false,
                hiddenAt: input.now,
                nextCheckAt: null,
                lastEvaluatedAt: input.now,
                updatedAt: input.now,
            };
        }

        const nextCheckpointDay = resolveNextCheckpointDay(input.state.currentCheckpointDay);
        return {
            ...input.state,
            inactiveStreak,
            nextCheckAt: nextCheckpointDay === null ? null : addDays(input.state.createdAt, nextCheckpointDay),
            currentCheckpointDay: nextCheckpointDay ?? input.state.currentCheckpointDay,
            lastEvaluatedAt: input.now,
            updatedAt: input.now,
        };
    }

    if (isFinalCheckpoint) {
        return {
            ...input.state,
            inactiveStreak: 0,
            markerVisible: true,
            permanentAt: input.now,
            nextCheckAt: null,
            lastEvaluatedAt: input.now,
            updatedAt: input.now,
        };
    }

    const nextCheckpointDay = resolveNextCheckpointDay(input.state.currentCheckpointDay);
    return {
        ...input.state,
        inactiveStreak: 0,
        markerVisible: true,
        currentCheckpointDay: nextCheckpointDay ?? input.state.currentCheckpointDay,
        nextCheckAt: nextCheckpointDay === null ? null : addDays(input.state.createdAt, nextCheckpointDay),
        lastEvaluatedAt: input.now,
        updatedAt: input.now,
    };
}

export async function runForkRetentionSweep(
    store: ForkRetentionStore,
    input: {
        now: Date;
        limit?: number;
    },
): Promise<{
    bootstrappedTargetCircleIds: number[];
    updatedTargetCircleIds: number[];
}> {
    const missingStates = await store.listLineagesMissingRetentionState();
    const bootstrappedTargetCircleIds: number[] = [];
    for (const lineage of missingStates) {
        await store.createRetentionState(buildInitialForkRetentionState(lineage));
        bootstrappedTargetCircleIds.push(lineage.targetCircleId);
    }

    const dueStates = await store.listDueRetentionStates(input.now, input.limit);
    const updatedTargetCircleIds: number[] = [];
    for (const state of dueStates) {
        const latestRollup = await store.getLatestActivityRollup(state.targetCircleId);
        const nextState = evaluateForkRetentionState({
            state,
            latestRollup,
            now: input.now,
        });
        await store.saveRetentionState(nextState);
        updatedTargetCircleIds.push(state.targetCircleId);
    }

    return {
        bootstrappedTargetCircleIds,
        updatedTargetCircleIds,
    };
}
