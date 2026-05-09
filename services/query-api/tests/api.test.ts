import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import request from 'supertest';

import { createApp, type QueryApiAppContext } from '../src/app';

const loadConsistencyStatusMock: any = jest.fn();

type ExpressLayer = {
    name?: string;
    route?: {
        path?: unknown;
    };
    handle?: {
        stack?: ExpressLayer[];
    };
    regexp?: {
        fast_slash?: boolean;
    };
};

jest.mock('../src/services/consistency', () => ({
    loadConsistencyStatus: (...args: unknown[]) => loadConsistencyStatusMock(...args),
}));

function createPrismaStub() {
    return {
        $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    };
}

function createRedisStub() {
    return {
        get: jest.fn(async () => null),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 1),
        publish: jest.fn(async () => 1),
        ping: jest.fn(async () => 'PONG'),
        quit: jest.fn(async () => 'OK'),
    };
}

function collectRoutePaths(stack: ExpressLayer[] | undefined, prefix = ''): string[] {
    if (!Array.isArray(stack)) return [];
    return stack.flatMap((layer: ExpressLayer) => {
        if (layer.route?.path) {
            return [`${prefix}${String(layer.route.path)}`];
        }
        if (layer.name === 'router' && Array.isArray(layer.handle?.stack)) {
            const nextPrefix = layer.regexp?.fast_slash
                ? prefix
                : prefix;
            return collectRoutePaths(layer.handle.stack, nextPrefix);
        }
        return [];
    });
}

describe('Query API - app baseline smoke', () => {
    let prisma: any;
    let redis: any;
    let appContext: QueryApiAppContext;

    beforeEach(async () => {
        prisma = createPrismaStub();
        redis = createRedisStub();
        loadConsistencyStatusMock.mockResolvedValue({
            indexerId: 'test-indexer',
            readCommitment: 'confirmed',
            indexedSlot: 123,
            headSlot: 123,
            slotLag: 0,
            stale: false,
            generatedAt: new Date('2026-03-25T00:00:00.000Z').toISOString(),
            checkpoints: [],
            offchain: null,
            offchainPeers: [],
            settlement: {
                adapterId: 'solana-l1',
                chainFamily: 'svm',
                settlementLayer: 'solana-l1',
                chainId: 'localnet',
                readCommitment: 'confirmed',
                indexedSlot: '123',
                headSlot: '123',
                slotLag: 0,
                finality: {
                    status: 'indexed',
                    commitment: 'confirmed',
                    indexed: true,
                    final: false,
                },
                stale: false,
                generatedAt: new Date('2026-03-25T00:00:00.000Z').toISOString(),
                source: 'sync_checkpoint_plus_runtime_state',
            },
            alerts: {
                indexerLagWarning: false,
                indexerLagCritical: false,
                failedSlotsPending: 0,
                failedSlotsOldestAgeSec: null,
                failedSlotsWarning: false,
                failedSlotsCritical: false,
                pendingGhostSettings: 0,
                pendingGhostSettingsOldestAgeSec: null,
                pendingGhostSettingsWarning: false,
                pendingGhostSettingsCritical: false,
            },
        });
        appContext = await createApp({ prisma: prisma as any, redis: redis as any });
    });

    afterEach(async () => {
        jest.clearAllMocks();
        await appContext.dispose();
    });

    test('createApp returns an express app with health and sync routes', () => {
        const stack = (((appContext.app as any)?._router?.stack ?? []) as ExpressLayer[]);
        const routePaths = collectRoutePaths(stack);

        expect(routePaths).toContain('/health');
        expect(routePaths).toContain('/sync/status');
    });

    test('/sync/status exposes settlement checkpoint without breaking consistency headers', async () => {
        const response = await request(appContext.app)
            .get('/sync/status')
            .expect(200);

        expect(response.body.settlement).toMatchObject({
            adapterId: 'solana-l1',
            chainFamily: 'svm',
            settlementLayer: 'solana-l1',
            indexedSlot: '123',
            source: 'sync_checkpoint_plus_runtime_state',
        });
        expect(response.headers['x-alcheme-indexed-slot']).toBe('123');
        expect(response.headers['x-alcheme-read-commitment']).toBe('confirmed');
        expect(response.headers['x-alcheme-settlement-adapter']).toBe('solana-l1');
        expect(response.headers['x-alcheme-settlement-chain-family']).toBe('svm');
    });

    test('createApp mounts the REST router and GraphQL middleware', () => {
        const stack = (((appContext.app as any)?._router?.stack ?? []) as ExpressLayer[]);
        const routePaths = collectRoutePaths(stack);
        const middlewareNames = stack.map((layer: ExpressLayer) => String(layer?.name || ''));

        expect(middlewareNames).toContain('router');
        expect(routePaths.some((path) => path.includes('/users') || path.includes('/:handle'))).toBe(true);
        expect(routePaths.some((path) => path.includes('/feed') || path.includes('/:contentId'))).toBe(true);
        expect(appContext.apolloServer.graphqlPath).toBe('/graphql');
    });
});
