import { describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { notificationRouter } from '../src/rest/notifications';

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

describe('notifications REST route localization', () => {
    test('returns localized display copy for source-neutral notifications', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 13,
                        userId: 42,
                        type: 'identity',
                        title: 'identity.level_changed',
                        body: null,
                        metadata: {
                            messageKey: 'identity.level_changed',
                            params: {
                                previousLevel: 'Elder',
                                nextLevel: 'Member',
                                reasonKey: 'identity.reputation_demotion',
                                reasonParams: {
                                    reputationPercentile: '35',
                                    threshold: '10',
                                },
                            },
                        },
                        sourceType: 'circle_identity',
                        sourceId: 'Elder->Member',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:12:00.000Z'),
                    },
                ])),
                count: jest.fn(async () => 1),
            },
            circle: {
                findMany: jest.fn(async () => ([
                    { id: 7, name: 'Alpha' },
                ])),
            },
        } as any;
        const router = notificationRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/', 'get');
        const res = createMockResponse();

        await handler({
            query: { userId: '42', limit: '20', offset: '0' },
            header: (name: string) => (
                name.toLowerCase() === 'x-alcheme-locale' ? 'en' : undefined
            ),
        } as any, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.data).toEqual([
            expect.objectContaining({
                id: 13,
                title: 'identity.level_changed',
                body: null,
                displayTitle: 'Identity updated to Member',
                displayBody: 'Your role in “Alpha” changed from Elder to Member. Your reputation is now in the top 35%, outside the Elder threshold of 10%, so your role changed to Member.',
            }),
        ]);
    });
});
