import { afterEach, describe, expect, jest, test } from '@jest/globals';

const listenMock = jest.fn((_: unknown, callback?: () => void) => {
    callback?.();
});
const closeMock = jest.fn((callback?: () => void) => {
    callback?.();
});
const setupCollaborationMock = jest.fn();
const shutdownCollaborationMock = jest.fn(async () => undefined);
const createAppMock = jest.fn(async () => ({
    app: {} as any,
    redis: {
        on: jest.fn(),
        ping: jest.fn(async () => 'PONG'),
    } as any,
    apolloServer: {
        graphqlPath: '/graphql',
    } as any,
    dispose: jest.fn(async () => undefined),
}));
const ensureOffchainDiscussionSchemaMock = jest.fn(async () => undefined);
const cacheStartMock = jest.fn(async () => undefined);
const cacheStopMock = jest.fn(async () => undefined);
const workerStopMock = jest.fn(async () => undefined);
const createAiJobHandlersMock = jest.fn(() => ({}));
const startAiJobWorkerMock = jest.fn(() => ({
    stop: workerStopMock,
}));

jest.mock('http', () => ({
    createServer: jest.fn(() => ({
        listen: listenMock,
        close: closeMock,
    })),
}));

jest.mock('../src/app', () => ({
    createApp: createAppMock,
}));

jest.mock('../src/collab/setup', () => ({
    setupCollaboration: setupCollaborationMock,
    shutdownCollaboration: shutdownCollaborationMock,
}));

jest.mock('../src/services/cacheInvalidator', () => ({
    CacheInvalidator: jest.fn().mockImplementation(() => ({
        start: cacheStartMock,
        stop: cacheStopMock,
    })),
}));

jest.mock('../src/services/offchainDiscussion', () => ({
    ensureOffchainDiscussionSchema: ensureOffchainDiscussionSchemaMock,
}));

jest.mock('../src/services/aiJobs/handlers', () => ({
    createAiJobHandlers: createAiJobHandlersMock,
}));

jest.mock('../src/services/aiJobs/worker', () => ({
    startAiJobWorker: startAiJobWorkerMock,
}));

jest.mock('../src/cron/heat-decay', () => ({
    startHeatDecayCron: jest.fn(),
    stopHeatDecayCron: jest.fn(),
}));
jest.mock('../src/cron/identity-evaluation', () => ({
    startIdentityCron: jest.fn(),
    stopIdentityCron: jest.fn(),
}));
jest.mock('../src/cron/draft-workflow', () => ({
    startDraftWorkflowCron: jest.fn(),
    stopDraftWorkflowCron: jest.fn(),
}));
jest.mock('../src/cron/fork-retention', () => ({
    startForkRetentionCron: jest.fn(),
    stopForkRetentionCron: jest.fn(),
}));
jest.mock('../src/services/offchainPeerSync', () => ({
    startOffchainPeerSync: jest.fn(),
    stopOffchainPeerSync: jest.fn(),
}));
jest.mock('../src/services/pendingGhostSettingsReconciler', () => ({
    startPendingGhostSettingsReconciler: jest.fn(),
    stopPendingGhostSettingsReconciler: jest.fn(),
}));
jest.mock('../src/database', () => ({
    prisma: {
        $disconnect: jest.fn(async () => undefined),
    },
}));

describe('index worker bootstrap', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('index bootstraps the ai job worker and owns its shutdown lifecycle', async () => {
        const { startQueryApiServer } = await import('../src/index');

        const control = await startQueryApiServer({
            registerProcessHandlers: false,
            port: 0,
        });

        expect(ensureOffchainDiscussionSchemaMock).toHaveBeenCalled();
        expect(createAppMock).toHaveBeenCalled();
        expect(setupCollaborationMock).toHaveBeenCalled();
        expect(cacheStartMock).toHaveBeenCalled();
        expect(createAiJobHandlersMock).toHaveBeenCalledTimes(1);
        expect(startAiJobWorkerMock).toHaveBeenCalledTimes(1);

        await control.stop();

        expect(workerStopMock).toHaveBeenCalledTimes(1);
        expect(cacheStopMock).toHaveBeenCalledTimes(1);
        expect(shutdownCollaborationMock).toHaveBeenCalledTimes(1);
    });
});
