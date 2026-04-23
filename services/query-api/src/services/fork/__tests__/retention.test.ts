import { describe, expect, test } from '@jest/globals';

import {
    FORK_RETENTION_CHECKPOINT_DAYS,
    computeForkActivityScore,
    runForkRetentionSweep,
    type CircleActivityRollupRecord,
    type CircleForkLineageSeed,
    type ForkRetentionStateRecord,
    type ForkRetentionStore,
} from '../retention';

function createInMemoryStore(options?: {
    lineages?: CircleForkLineageSeed[];
    activityRollups?: CircleActivityRollupRecord[];
    retentionStates?: ForkRetentionStateRecord[];
}) {
    const lineages = new Map<number, CircleForkLineageSeed>();
    const rollups = new Map<number, CircleActivityRollupRecord>();
    const states = new Map<number, ForkRetentionStateRecord>();

    for (const lineage of options?.lineages || []) {
        lineages.set(lineage.targetCircleId, lineage);
    }
    for (const rollup of options?.activityRollups || []) {
        rollups.set(rollup.circleId, rollup);
    }
    for (const state of options?.retentionStates || []) {
        states.set(state.targetCircleId, state);
    }

    const store: ForkRetentionStore = {
        async listLineagesMissingRetentionState() {
            return Array.from(lineages.values()).filter((lineage) => !states.has(lineage.targetCircleId));
        },
        async createRetentionState(state) {
            states.set(state.targetCircleId, state);
            return state;
        },
        async listDueRetentionStates(now) {
            return Array.from(states.values()).filter((state) => (
                state.nextCheckAt !== null
                && state.nextCheckAt.getTime() <= now.getTime()
                && state.permanentAt === null
                && state.hiddenAt === null
            ));
        },
        async getLatestActivityRollup(circleId) {
            return rollups.get(circleId) ?? null;
        },
        async saveRetentionState(state) {
            states.set(state.targetCircleId, state);
            return state;
        },
    };

    return {
        store,
        states,
    };
}

describe('fork retention', () => {
    test('uses the frozen checkpoints and weighted activity formula', () => {
        expect(FORK_RETENTION_CHECKPOINT_DAYS).toEqual([2, 7, 30, 90, 180]);
        expect(computeForkActivityScore({
            memberGrowthSignal: 0.5,
            contentGrowthSignal: 0.25,
            crystallizationSignal: 0.75,
        })).toBeCloseTo(0.4625, 6);
    });

    test('hides the source marker after two consecutive inactive checks', async () => {
        const now = new Date('2026-04-05T00:00:00.000Z');
        const { store, states } = createInMemoryStore({
            retentionStates: [{
                targetCircleId: 71,
                sourceCircleId: 7,
                declarationId: 'fork-declaration-71',
                currentCheckpointDay: 7,
                nextCheckAt: now,
                inactiveStreak: 1,
                markerVisible: true,
                permanentAt: null,
                hiddenAt: null,
                lastEvaluatedAt: null,
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-03-29T00:00:00.000Z'),
            }],
            activityRollups: [{
                circleId: 71,
                windowStart: new Date('2026-03-29T00:00:00.000Z'),
                windowEnd: now,
                memberGrowthSignal: 0,
                contentGrowthSignal: 0,
                crystallizationSignal: 0,
                activityScore: 0,
                createdAt: now,
                updatedAt: now,
            }],
        });

        const result = await runForkRetentionSweep(store, { now });
        expect(result.updatedTargetCircleIds).toContain(71);

        const state = states.get(71);
        expect(state?.markerVisible).toBe(false);
        expect(state?.hiddenAt?.toISOString()).toBe(now.toISOString());
        expect(state?.nextCheckAt).toBeNull();
    });

    test('marks the source marker permanent after surviving the final checkpoint', async () => {
        const now = new Date('2026-09-18T00:00:00.000Z');
        const { store, states } = createInMemoryStore({
            retentionStates: [{
                targetCircleId: 72,
                sourceCircleId: 8,
                declarationId: 'fork-declaration-72',
                currentCheckpointDay: 180,
                nextCheckAt: now,
                inactiveStreak: 0,
                markerVisible: true,
                permanentAt: null,
                hiddenAt: null,
                lastEvaluatedAt: null,
                createdAt: new Date('2026-03-22T00:00:00.000Z'),
                updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            }],
            activityRollups: [{
                circleId: 72,
                windowStart: new Date('2026-06-20T00:00:00.000Z'),
                windowEnd: now,
                memberGrowthSignal: 0.2,
                contentGrowthSignal: 0.1,
                crystallizationSignal: 0.3,
                activityScore: 0,
                createdAt: now,
                updatedAt: now,
            }],
        });

        const result = await runForkRetentionSweep(store, { now });
        expect(result.updatedTargetCircleIds).toContain(72);

        const state = states.get(72);
        expect(state?.markerVisible).toBe(true);
        expect(state?.permanentAt?.toISOString()).toBe(now.toISOString());
        expect(state?.nextCheckAt).toBeNull();
    });
});
