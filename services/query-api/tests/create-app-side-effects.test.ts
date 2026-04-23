import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { createApp } from '../src/app';

const startAiJobWorkerMock = jest.fn();

jest.mock('../src/services/aiJobs/worker', () => ({
    startAiJobWorker: startAiJobWorkerMock,
}));

function createPrismaGuard() {
    const target = {
        $executeRaw: jest.fn(async () => {
            throw new Error('unexpected bootstrap write');
        }),
        $executeRawUnsafe: jest.fn(async () => {
            throw new Error('unexpected bootstrap write');
        }),
        $queryRaw: jest.fn(async () => [{ '?column?': 1 }]),
    } as Record<string | symbol, unknown>;

    return new Proxy(target, {
        get(current, prop) {
            if (prop in current) {
                return current[prop];
            }
            const fn = jest.fn();
            current[prop] = fn;
            return fn;
        },
    });
}

function createRedisStub() {
    return new Proxy(
        {},
        {
            get(_target, prop) {
                if (prop === 'quit') {
                    return jest.fn(async () => 'OK');
                }
                if (prop === 'ping') {
                    return jest.fn(async () => 'PONG');
                }
                return jest.fn();
            },
        }
    );
}

describe('createApp side effects', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('constructing the app does not execute offchain discussion bootstrap writes', async () => {
        const prisma = createPrismaGuard();
        const redis = createRedisStub();

        const appContext = await createApp({ prisma: prisma as any, redis: redis as any });

        expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
        expect(startAiJobWorkerMock).not.toHaveBeenCalled();

        await appContext.dispose();
    });
});
