import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

jest.mock('../src/ai/ghost/config', () => ({
    loadGhostConfig: jest.fn(() => ({
        summary: {
            useLLM: true,
            windowSize: 20,
            cacheTtlSec: 0,
            internalEndpointEnabled: true,
        },
        trigger: {
            enabled: true,
            mode: 'notify_only',
            windowSize: 20,
            minMessages: 3,
            minQuestionCount: 1,
            minFocusedRatio: 0.5,
            cooldownSec: 60,
            summaryUseLLM: false,
            generateComment: false,
        },
        relevance: { mode: 'rule' },
        admin: { token: 'secret-token' },
    })),
}));

function getRouteHandler(router: Router, path: string, method: 'get') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = layer?.route?.stack?.find((entry: any) => entry.method === method);
    if (!routeLayer?.handle) {
        throw new Error(`route handler not found for ${method.toUpperCase()} ${path}`);
    }
    return routeLayer.handle;
}

function createMockResponse() {
    return {
        statusCode: 200,
        payload: null as any,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.payload = payload;
            return this;
        },
    };
}

describe('circle route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('serializes BigInt fields safely for cache and JSON responses', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 77,
                    name: '新成员入门流程优化',
                    description: '专门讨论新成员加入后的前 7 天体验。',
                    lastSyncedSlot: BigInt(123),
                    creator: {
                        handle: 'owner',
                        displayName: 'Owner',
                        avatarUri: null,
                    },
                })),
            },
        } as any;

        const redis = {
            get: jest.fn(async () => null),
            setex: jest.fn(async () => 'OK'),
        } as any;

        const { circleRouter } = await import('../src/rest/circles');
        const router = circleRouter(prisma, redis);
        const handler = getRouteHandler(router, '/:id', 'get');
        const res = createMockResponse();
        const next = jest.fn();

        await handler({
            params: { id: '77' },
        } as any, res as any, next);

        expect(next).not.toHaveBeenCalled();
        expect(redis.setex).toHaveBeenCalledWith(
            'circle:77',
            300,
            expect.stringContaining('"lastSyncedSlot":"123"'),
        );
        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            id: 77,
            name: '新成员入门流程优化',
            description: '专门讨论新成员加入后的前 7 天体验。',
            lastSyncedSlot: '123',
        });
    });
});
