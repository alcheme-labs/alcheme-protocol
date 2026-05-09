import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { membershipRouter } from '../src/rest/membership';

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

describe('membership identity status route', () => {
    test('returns visitor dust-only status for unauthenticated users', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 42,
                    createdAt: new Date('2026-03-02T10:00:00.000Z'),
                })),
            },
        } as any;
        const router = membershipRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/identity-status', 'get');

        const req = { params: { id: '7' } } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: false,
            circleId: 7,
            currentLevel: 'Visitor',
            nextLevel: null,
            messagingMode: 'dust_only',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns visitor progress for authenticated non-members based on active dust messages', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 42,
                    createdAt: new Date('2026-03-02T10:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    pubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                    reputationScore: 2,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
            $queryRaw: jest.fn(async () => [{ count: 3 }]),
        } as any;
        const router = membershipRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/identity-status', 'get');

        const req = {
            params: { id: '7' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: true,
            circleId: 7,
            currentLevel: 'Visitor',
            nextLevel: null,
            messagingMode: 'dust_only',
            progress: {
                messageCount: 3,
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns formal identity progression for active members', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-02T10:30:00.000Z'));

        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 42,
                    createdAt: new Date('2026-03-02T10:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    pubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                    reputationScore: 12,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Initiate',
                    joinedAt: new Date('2026-03-01T10:00:00.000Z'),
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 12 } },
                    { userId: 21, user: { reputationScore: 10 } },
                ])),
            },
            circleMembershipEvent: {
                findMany: jest.fn(async () => ([
                    {
                        reason: '已发送 6 条消息，达到 5 条可晋升为入局者。',
                        metadata: {
                            fromLevel: 'Visitor',
                            toLevel: 'Initiate',
                            source: 'identity_cron',
                        },
                        createdAt: new Date('2026-03-02T08:00:00.000Z'),
                    },
                    {
                        reason: '已获得 3 次引用，达到 2 次可晋升为成员。',
                        metadata: {
                            fromLevel: 'Initiate',
                            toLevel: 'Member',
                            source: 'identity_cron',
                        },
                        createdAt: new Date('2026-03-01T08:00:00.000Z'),
                    },
                ])),
            },
            post: {
                count: jest.fn(async () => 5),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-02T09:00:00.000Z'),
                })),
            },
        } as any;
        const router = membershipRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/identity-status', 'get');

        const req = {
            params: { id: '7' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        try {
            await handler(req, res as any, next);
        } finally {
            jest.useRealTimers();
        }

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: true,
            circleId: 7,
            currentLevel: 'Initiate',
            nextLevel: 'Member',
            messagingMode: 'formal',
            progress: {
                messageCount: 5,
                citationCount: 0,
                reputationPercentile: 50,
            },
            recentTransition: {
                from: 'Visitor',
                to: 'Initiate',
                reason: '已发送 6 条消息，达到 5 条可晋升为入局者。',
            },
            history: [
                {
                    from: 'Visitor',
                    to: 'Initiate',
                    reason: '已发送 6 条消息，达到 5 条可晋升为入局者。',
                },
                {
                    from: 'Initiate',
                    to: 'Member',
                    reason: '已获得 3 次引用，达到 2 次可晋升为成员。',
                },
            ],
        });
        expect(next).not.toHaveBeenCalled();
    });
});
