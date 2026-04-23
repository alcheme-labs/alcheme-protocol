import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { loadConsistencyStatus } from '../consistency';

describe('loadConsistencyStatus', () => {
    const envBackup = { ...process.env };

    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-04-16T22:45:00.000Z'));
        process.env.SOLANA_RPC_URL = 'http://rpc.example.test';
        process.env.INDEXER_STALE_AFTER_MS = '120000';
        process.env.INDEXER_MAX_SLOT_LAG = '2000';
        process.env.INDEXER_RUNTIME_PROGRESS_STALE_AFTER_MS = '15000';
        process.env.OFFCHAIN_SYNC_REQUIRED = 'false';
        global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ result: 456020695 }),
        })) as any;
    });

    afterEach(() => {
        jest.useRealTimers();
        process.env = { ...envBackup };
        jest.restoreAllMocks();
    });

    function createPrismaMock(input: {
        checkpoints: Array<{
            programId: string;
            programName: string;
            lastProcessedSlot: bigint;
            lastSuccessfulSync: Date | null;
        }>;
        runtimeState?: {
            indexerId: string;
            listenerMode: string;
            phase: string;
            currentSlot: bigint | null;
            lastProgressAt: Date;
            lastError: string | null;
            updatedAt: Date;
        } | null;
    }) {
        return {
            syncCheckpoint: {
                findMany: jest.fn(async () => input.checkpoints),
            },
            indexerRuntimeState: {
                findFirst: jest.fn(async () => input.runtimeState ?? null),
            },
            $queryRaw: jest.fn(async () => []),
        } as any;
    }

    test('treats fresh program-cursor runtime progress as healthy even when checkpoints are old', async () => {
        const prisma = createPrismaMock({
            checkpoints: [{
                programId: 'event-program',
                programName: 'Event Emitter',
                lastProcessedSlot: 456009812n,
                lastSuccessfulSync: new Date('2026-04-16T21:22:30.964Z'),
            }],
            runtimeState: {
                indexerId: 'local-indexer-1',
                listenerMode: 'program_cursor',
                phase: 'idle',
                currentSlot: 456020690n,
                lastProgressAt: new Date('2026-04-16T22:44:55.000Z'),
                lastError: null,
                updatedAt: new Date('2026-04-16T22:44:55.000Z'),
            },
        });

        const status = await loadConsistencyStatus(prisma);

        expect(status.indexerId).toBe('local-indexer-1');
        expect(status.indexedSlot).toBe(456020690);
        expect(status.slotLag).toBe(5);
        expect(status.stale).toBe(false);
        expect(status.alerts.indexerLagWarning).toBe(false);
        expect(status.alerts.indexerLagCritical).toBe(false);
    });

    test('keeps stale true when runtime progress heartbeat is old', async () => {
        const prisma = createPrismaMock({
            checkpoints: [{
                programId: 'event-program',
                programName: 'Event Emitter',
                lastProcessedSlot: 456009812n,
                lastSuccessfulSync: new Date('2026-04-16T21:22:30.964Z'),
            }],
            runtimeState: {
                indexerId: 'local-indexer-1',
                listenerMode: 'program_cursor',
                phase: 'idle',
                currentSlot: 456020690n,
                lastProgressAt: new Date('2026-04-16T22:40:00.000Z'),
                lastError: null,
                updatedAt: new Date('2026-04-16T22:40:00.000Z'),
            },
        });

        const status = await loadConsistencyStatus(prisma);

        expect(status.indexedSlot).toBe(456009812);
        expect(status.slotLag).toBe(10883);
        expect(status.stale).toBe(true);
        expect(status.alerts.indexerLagWarning).toBe(true);
        expect(status.alerts.indexerLagCritical).toBe(true);
    });
});
