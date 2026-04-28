import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { membershipRouter } from '../membership';

function buildApp(prisma: any) {
    const app = express();
    app.use((req, _res, next) => {
        (req as any).userId = 11;
        next();
    });
    app.use('/api/v1/membership', membershipRouter(prisma, {} as any));
    return app;
}

describe('membership identity-status route', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-31T08:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('omits stale recent transition banners after one day', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 99,
                    createdAt: new Date('2026-03-01T00:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    pubkey: 'wallet-11',
                    reputationScore: 100,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                    joinedAt: new Date('2026-03-01T00:00:00.000Z'),
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 100 } },
                    { userId: 12, user: { reputationScore: 80 } },
                    { userId: 13, user: { reputationScore: 60 } },
                    { userId: 14, user: { reputationScore: 40 } },
                    { userId: 15, user: { reputationScore: 20 } },
                    { userId: 16, user: { reputationScore: 10 } },
                    { userId: 17, user: { reputationScore: 5 } },
                    { userId: 18, user: { reputationScore: 4 } },
                    { userId: 19, user: { reputationScore: 3 } },
                    { userId: 20, user: { reputationScore: 2 } },
                    { userId: 21, user: { reputationScore: 1 } },
                ])),
            },
            post: {
                count: jest.fn(async () => 0),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-31T08:00:00.000Z'),
                })),
            },
            circleMembershipEvent: {
                findMany: jest.fn(async () => ([
                    {
                        reason: '当前信誉位于前 1%（阈值前 10%），已晋升为长老。',
                        metadata: {
                            fromLevel: 'Member',
                            toLevel: 'Elder',
                        },
                        createdAt: new Date('2026-03-29T08:00:00.000Z'),
                    },
                ])),
            },
        } as any;

        const response = await request(buildApp(prisma))
            .get('/api/v1/membership/circles/7/identity-status?locale=zh')
            .expect(200);

        expect(response.body.recentTransition).toBeNull();
        expect(response.body.history).toHaveLength(1);
        expect(response.body.history[0]).toMatchObject({
            from: 'Member',
            to: 'Elder',
        });
    });

    test('returns neutral member hint when elder threshold is not met', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 99,
                    createdAt: new Date('2026-03-01T00:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    pubkey: 'wallet-11',
                    reputationScore: 80,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                    joinedAt: new Date('2026-03-01T00:00:00.000Z'),
                })),
                findMany: jest.fn(async () => ([
                    { userId: 12, user: { reputationScore: 100 } },
                    { userId: 13, user: { reputationScore: 90 } },
                    { userId: 11, user: { reputationScore: 80 } },
                    { userId: 14, user: { reputationScore: 70 } },
                    { userId: 15, user: { reputationScore: 60 } },
                    { userId: 16, user: { reputationScore: 50 } },
                    { userId: 17, user: { reputationScore: 40 } },
                    { userId: 18, user: { reputationScore: 30 } },
                    { userId: 19, user: { reputationScore: 20 } },
                    { userId: 20, user: { reputationScore: 10 } },
                ])),
            },
            post: {
                count: jest.fn(async () => 0),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-31T08:00:00.000Z'),
                })),
            },
            circleMembershipEvent: {
                findMany: jest.fn(async () => []),
            },
        } as any;

        const response = await request(buildApp(prisma))
            .get('/api/v1/membership/circles/7/identity-status?locale=zh')
            .expect(200);

        expect(response.body.currentLevel).toBe('Member');
        expect(response.body.progress.reputationPercentile).toBe(30);
        expect(response.body.hint).toBe('当前信誉位于前 30%（需进入前 10%）方可晋升为长老。');
    });

    test('localizes non-member dust hint for requested English locale', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 99,
                    createdAt: new Date('2026-03-01T00:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    pubkey: 'wallet-11',
                    reputationScore: 0,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
            $queryRaw: jest.fn(async () => ([{ count: 0 }])),
        } as any;

        const response = await request(buildApp(prisma))
            .get('/api/v1/membership/circles/7/identity-status')
            .set('x-alcheme-locale', 'en')
            .expect(200);

        expect(response.body.currentLevel).toBe('Visitor');
        expect(response.body.nextLevel).toBeNull();
        expect(response.body.messagingMode).toBe('dust_only');
        expect(response.body.hint).toBe('Visitors can send dust messages, but they do not enter the formal settlement flow.');
    });
});
