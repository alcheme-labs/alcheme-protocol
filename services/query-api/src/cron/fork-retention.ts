import { PrismaClient } from '@prisma/client';

import {
    runForkRetentionSweep,
    type CircleActivityRollupRecord,
    type CircleForkLineageSeed,
    type ForkRetentionStateRecord,
    type ForkRetentionStore,
} from '../services/fork/retention';

const INTERVAL_MS = 6 * 60 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function mapRetentionStateRow(row: any): ForkRetentionStateRecord {
    return {
        targetCircleId: row.targetCircleId,
        sourceCircleId: row.sourceCircleId,
        declarationId: row.declarationId ?? null,
        currentCheckpointDay: row.currentCheckpointDay,
        nextCheckAt: row.nextCheckAt ?? null,
        inactiveStreak: row.inactiveStreak,
        markerVisible: row.markerVisible,
        permanentAt: row.permanentAt ?? null,
        hiddenAt: row.hiddenAt ?? null,
        lastEvaluatedAt: row.lastEvaluatedAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function mapActivityRollupRow(row: any): CircleActivityRollupRecord {
    return {
        circleId: row.circleId,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        memberGrowthSignal: toNumber(row.memberGrowthSignal),
        contentGrowthSignal: toNumber(row.contentGrowthSignal),
        crystallizationSignal: toNumber(row.crystallizationSignal),
        activityScore: toNumber(row.activityScore),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function createPrismaForkRetentionStore(prisma: PrismaClient): ForkRetentionStore {
    const prismaAny = prisma as any;
    return {
        async listLineagesMissingRetentionState() {
            const [lineages, existingStates] = await Promise.all([
                prismaAny.circleForkLineage.findMany({
                    select: {
                        targetCircleId: true,
                        sourceCircleId: true,
                        declarationId: true,
                        createdAt: true,
                    },
                }),
                prismaAny.circleForkRetentionState.findMany({
                    select: {
                        targetCircleId: true,
                    },
                }),
            ]);
            const existingTargetIds = new Set(existingStates.map((state: { targetCircleId: number }) => state.targetCircleId));
            return lineages
                .filter((lineage: { targetCircleId: number }) => !existingTargetIds.has(lineage.targetCircleId))
                .map((lineage: {
                    targetCircleId: number;
                    sourceCircleId: number;
                    declarationId?: string | null;
                    createdAt: Date;
                }): CircleForkLineageSeed => ({
                    targetCircleId: lineage.targetCircleId,
                    sourceCircleId: lineage.sourceCircleId,
                    declarationId: lineage.declarationId ?? null,
                    createdAt: lineage.createdAt,
                }));
        },
        async createRetentionState(state) {
            const row = await prismaAny.circleForkRetentionState.upsert({
                where: {
                    targetCircleId: state.targetCircleId,
                },
                create: {
                    targetCircleId: state.targetCircleId,
                    sourceCircleId: state.sourceCircleId,
                    declarationId: state.declarationId,
                    currentCheckpointDay: state.currentCheckpointDay,
                    nextCheckAt: state.nextCheckAt,
                    inactiveStreak: state.inactiveStreak,
                    markerVisible: state.markerVisible,
                    permanentAt: state.permanentAt,
                    hiddenAt: state.hiddenAt,
                    lastEvaluatedAt: state.lastEvaluatedAt,
                    createdAt: state.createdAt,
                },
                update: {
                    sourceCircleId: state.sourceCircleId,
                    declarationId: state.declarationId,
                    currentCheckpointDay: state.currentCheckpointDay,
                    nextCheckAt: state.nextCheckAt,
                    inactiveStreak: state.inactiveStreak,
                    markerVisible: state.markerVisible,
                    permanentAt: state.permanentAt,
                    hiddenAt: state.hiddenAt,
                    lastEvaluatedAt: state.lastEvaluatedAt,
                },
            });
            return mapRetentionStateRow(row);
        },
        async listDueRetentionStates(now, limit = 100) {
            const rows = await prismaAny.circleForkRetentionState.findMany({
                where: {
                    nextCheckAt: {
                        lte: now,
                    },
                    permanentAt: null,
                    hiddenAt: null,
                },
                orderBy: {
                    nextCheckAt: 'asc',
                },
                take: limit,
            });
            return rows.map(mapRetentionStateRow);
        },
        async getLatestActivityRollup(circleId) {
            const row = await prismaAny.circleActivityRollup.findFirst({
                where: {
                    circleId,
                },
                orderBy: {
                    windowEnd: 'desc',
                },
            });
            return row ? mapActivityRollupRow(row) : null;
        },
        async saveRetentionState(state) {
            const row = await prismaAny.circleForkRetentionState.update({
                where: {
                    targetCircleId: state.targetCircleId,
                },
                data: {
                    sourceCircleId: state.sourceCircleId,
                    declarationId: state.declarationId,
                    currentCheckpointDay: state.currentCheckpointDay,
                    nextCheckAt: state.nextCheckAt,
                    inactiveStreak: state.inactiveStreak,
                    markerVisible: state.markerVisible,
                    permanentAt: state.permanentAt,
                    hiddenAt: state.hiddenAt,
                    lastEvaluatedAt: state.lastEvaluatedAt,
                    updatedAt: state.updatedAt,
                },
            });
            return mapRetentionStateRow(row);
        },
    };
}

async function runSweep(prisma: PrismaClient) {
    try {
        const result = await runForkRetentionSweep(createPrismaForkRetentionStore(prisma), {
            now: new Date(),
            limit: 100,
        });
        if (result.bootstrappedTargetCircleIds.length > 0) {
            console.log(
                `🌿 Fork retention bootstrapped ${result.bootstrappedTargetCircleIds.length} markers: ${result.bootstrappedTargetCircleIds.join(', ')}`,
            );
        }
        if (result.updatedTargetCircleIds.length > 0) {
            console.log(
                `🌿 Fork retention evaluated ${result.updatedTargetCircleIds.length} markers: ${result.updatedTargetCircleIds.join(', ')}`,
            );
        }
    } catch (error) {
        console.error('🌿 Fork retention cron error:', error);
    }
}

export function startForkRetentionCron(prisma: PrismaClient): void {
    console.log('🌿 Fork retention cron started (interval: 6h)');
    void runSweep(prisma);
    intervalHandle = setInterval(() => {
        void runSweep(prisma);
    }, INTERVAL_MS);
}

export function stopForkRetentionCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('🌿 Fork retention cron stopped');
    }
}
