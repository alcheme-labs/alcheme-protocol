import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { membershipRouter } from '../src/rest/membership';

function getRouteHandler(router: Router, path: string, method: 'get' | 'post') {
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

function createPrismaMock() {
    return {
        circle: {
            findUnique: jest.fn(async ({ where, select }: any) => {
                if (where?.id !== 7) return null;
                const full = {
                    id: 7,
                    joinRequirement: 'Free',
                    circleType: 'Open',
                    minCrystals: 0,
                    creatorId: 42,
                    createdAt: new Date('2026-03-02T10:00:00.000Z'),
                    parentCircleId: null,
                };
                if (!select) return full;
                return Object.fromEntries(Object.keys(select).map((key) => [key, (full as any)[key]]));
            }),
            findMany: jest.fn(async () => []),
            update: jest.fn(async () => ({ id: 7, membersCount: 1 })),
        },
        circleMember: {
            findUnique: jest.fn(async () => null),
            create: jest.fn(async () => {
                throw new Error('circleMember.create should not be called for creator fallback');
            }),
            update: jest.fn(async () => {
                throw new Error('circleMember.update should not be called for creator fallback');
            }),
            count: jest.fn(async () => 0),
        },
        circleJoinRequest: {
            findFirst: jest.fn(async () => null),
        },
        circleInvite: {
            findFirst: jest.fn(async () => null),
            findUnique: jest.fn(async () => null),
            update: jest.fn(async () => ({ id: 1 })),
        },
        user: {
            findUnique: jest.fn(async () => ({ id: 42, handle: 'owner' })),
            update: jest.fn(async () => ({ id: 42, circlesCount: 1 })),
        },
        knowledge: {
            count: jest.fn(async () => 0),
        },
        circleMembershipEvent: {
            create: jest.fn(async () => ({ id: 1 })),
        },
    };
}

describe('membership owner fallback', () => {
    test('GET /circles/:id/me treats creator as joined owner before membership row is indexed', async () => {
        const prisma = createPrismaMock();
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/me', 'get');

        const req = {
            params: { id: '7' },
            userId: 42,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: true,
            circleId: 7,
            joinState: 'joined',
            membership: {
                role: 'Owner',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join treats creator as already joined before membership row is indexed', async () => {
        const prisma = createPrismaMock();
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 42,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            joinState: 'joined',
            alreadyMember: true,
        });
        expect(prisma.circleMember.create).not.toHaveBeenCalled();
        expect(prisma.circleMember.update).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
