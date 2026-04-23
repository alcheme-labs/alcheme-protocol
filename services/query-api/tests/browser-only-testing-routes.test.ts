import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import request from 'supertest';

import { createApp, type QueryApiAppContext } from '../src/app';

const loadConsistencyStatusMock: any = jest.fn();
const resolveIdentityAccountPresenceMock: any = jest.fn();

jest.mock('../src/services/consistency', () => ({
    loadConsistencyStatus: (...args: unknown[]) => loadConsistencyStatusMock(...args),
}));

jest.mock('../src/services/identityPresence', () => ({
    resolveIdentityAccountPresence: (...args: unknown[]) => resolveIdentityAccountPresenceMock(...args),
}));

function createRedisStub() {
    return {
        get: jest.fn(async () => null),
        setex: jest.fn(async () => 'OK'),
        del: jest.fn(async () => 0),
        publish: jest.fn(async () => 1),
        ping: jest.fn(async () => 'PONG'),
        quit: jest.fn(async () => 'OK'),
    };
}

function createPrismaStub() {
    return {
        $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    } as any;
}

describe('browser-only testing helper routes', () => {
    let prisma: any;
    let redis: any;
    let appContext: QueryApiAppContext;

    beforeEach(async () => {
        prisma = createPrismaStub();
        redis = createRedisStub();
        resolveIdentityAccountPresenceMock.mockResolvedValue('missing');
        loadConsistencyStatusMock.mockResolvedValue({
            indexerId: 'browser-only-helper-test',
            readCommitment: 'confirmed',
            indexedSlot: 0,
            headSlot: 0,
            slotLag: 0,
            stale: false,
            generatedAt: new Date('2026-04-14T00:00:00.000Z').toISOString(),
            checkpoints: [],
            offchain: null,
            offchainPeers: [],
            collab: {
                transportMode: 'builtin',
                storagePolicy: 'trusted_private',
                persistentPlaintext: true,
                persistenceBackend: 'runtime_memory',
                shareableState: [],
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
        appContext = await createApp({ prisma, redis });
    });

    afterEach(async () => {
        jest.clearAllMocks();
        await appContext.dispose();
    });

    test('testing helper identity registration route is not mounted', async () => {
        const response = await request(appContext.app)
            .post('/api/v1/testing/e2e/register-identity')
            .send({
                publicKey: 'Stake11111111111111111111111111111111111111',
                handle: 'e2e_run03_g1_aut004',
            });

        expect(response.status).toBe(404);
    });

    test('testing helper circle creation route is not mounted', async () => {
        const response = await request(appContext.app)
            .post('/api/v1/testing/e2e/create-circle')
            .send({
                publicKey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
                name: 'Browser-only helper circle',
                level: 0,
                kind: 'main',
                mode: 'knowledge',
                minCrystals: 0,
            });

        expect(response.status).toBe(404);
    });

    test('testing helper membership finalization route is not mounted', async () => {
        const response = await request(appContext.app)
            .post('/api/v1/testing/e2e/finalize-membership')
            .send({
                circleId: 26,
                action: 'claim_membership',
                kind: 'Open',
            });

        expect(response.status).toBe(404);
    });

    test('GET /sync/status remains reachable from the browser-only base url', async () => {
        const response = await request(appContext.app).get('/sync/status');

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            indexerId: 'browser-only-helper-test',
            readCommitment: 'confirmed',
            indexedSlot: expect.any(Number),
        });
    });
});
