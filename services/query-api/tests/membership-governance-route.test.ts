import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { membershipRouter } from '../src/rest/membership';

function getRouteHandler(router: Router, path: string, method: 'post' | 'put') {
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

function createRedisMock() {
    return {
        publish: jest.fn(async () => 1),
    };
}

function createPrismaMock(input?: {
    actorUserId?: number;
    targetMembership?: {
        id?: number;
        userId?: number;
        role?: 'Owner' | 'Admin' | 'Moderator' | 'Member';
        status?: 'Active' | 'Left' | 'Banned';
        identityLevel?: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        joinedAt?: Date;
    } | null;
    existingInvite?: { id: number } | null;
    existingMembershipForInvite?: { status: 'Active' | 'Left' | 'Banned' } | null;
    resolvedInviteeUser?: { id: number } | null;
}) {
    const actorUserId = input?.actorUserId ?? 42;
    const targetMembership = input?.targetMembership ?? {
        id: 77,
        userId: 88,
        role: 'Member' as const,
        status: 'Active' as const,
        identityLevel: 'Member' as const,
        joinedAt: new Date('2026-03-20T10:00:00.000Z'),
    };

    return {
        circle: {
            findUnique: jest.fn(async ({ where }: any) => {
                if (where?.id !== 7) return null;
                return {
                    creatorId: actorUserId,
                };
            }),
            update: jest.fn(async ({ where, data }: any) => ({
                id: where.id,
                membersCount: data.membersCount ?? 1,
            })),
        },
        circleMember: {
            findUnique: jest.fn(async ({ where }: any) => {
                const userId = where?.circleId_userId?.userId;
                if (userId === actorUserId) return null;
                if (userId === 88) {
                    if (targetMembership === null) return null;
                    return {
                        id: targetMembership.id ?? 77,
                        userId: targetMembership.userId ?? 88,
                        role: targetMembership.role ?? 'Member',
                        status: targetMembership.status ?? 'Active',
                        identityLevel: targetMembership.identityLevel ?? 'Member',
                        joinedAt: targetMembership.joinedAt ?? new Date('2026-03-20T10:00:00.000Z'),
                    };
                }
                if (userId === 99) {
                    return input?.existingMembershipForInvite;
                }
                return null;
            }),
            update: jest.fn(async ({ where, data }: any) => ({
                id: where.id,
                userId: 88,
                role: data.role ?? targetMembership?.role ?? 'Member',
                status: data.status ?? targetMembership?.status ?? 'Active',
                identityLevel: targetMembership?.identityLevel ?? 'Member',
                joinedAt: targetMembership?.joinedAt ?? new Date('2026-03-20T10:00:00.000Z'),
            })),
            count: jest.fn(async () => 1),
        },
        circleInvite: {
            findFirst: jest.fn(async () => input?.existingInvite ?? null),
            create: jest.fn(async () => ({
                id: 501,
                code: 'invite-code-501',
                inviteeUserId: input?.resolvedInviteeUser?.id ?? 99,
                inviteeHandle: input?.resolvedInviteeUser ? null : 'candidate',
                status: 'Active',
                expiresAt: new Date('2026-03-27T10:00:00.000Z'),
                createdAt: new Date('2026-03-23T10:00:00.000Z'),
            })),
        },
        circleMembershipEvent: {
            create: jest.fn(async () => ({ id: 1 })),
        },
        user: {
            findUnique: jest.fn(async () => input?.resolvedInviteeUser ?? null),
            update: jest.fn(async () => ({ id: 88, circlesCount: 0 })),
        },
    };
}

describe('membership governance routes', () => {
    test('POST /circles/:id/invites creates an invite for owner-managed circles', async () => {
        const prisma = createPrismaMock({
            resolvedInviteeUser: { id: 99 },
        });
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/invites', 'post');

        const req = {
            userId: 42,
            params: { id: '7' },
            body: { inviteeHandle: 'candidate', note: 'join us' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            invite: expect.objectContaining({
                id: 501,
                inviteeUserId: 99,
                status: 'Active',
            }),
        });
        expect((prisma.circleInvite.create as any)).toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/invites rejects already active members', async () => {
        const prisma = createPrismaMock({
            resolvedInviteeUser: { id: 99 },
            existingMembershipForInvite: { status: 'Active' },
        });
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/invites', 'post');

        const req = {
            userId: 42,
            params: { id: '7' },
            body: { inviteeHandle: 'candidate' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({ error: 'invitee_already_member' });
        expect((prisma.circleInvite.create as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('PUT /circles/:id/members/:userId/role returns wallet finalization shim for allowed role changes', async () => {
        const prisma = createPrismaMock();
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/members/:userId/role', 'put');

        const req = {
            userId: 42,
            params: { id: '7', userId: '88' },
            body: { role: 'Moderator' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(202);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            requiresWalletFinalization: true,
            finalization: expect.objectContaining({
                action: 'update_role',
                userId: 88,
                role: 'Moderator',
            }),
        });
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('PUT /circles/:id/members/:userId/role rejects protected roles', async () => {
        const prisma = createPrismaMock({
            targetMembership: {
                id: 77,
                userId: 88,
                role: 'Admin',
                status: 'Active',
            },
        });
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/members/:userId/role', 'put');

        const req = {
            userId: 42,
            params: { id: '7', userId: '88' },
            body: { role: 'Member' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({ error: 'protected_member_role' });
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/leave returns wallet finalization shim for active members', async () => {
        const prisma = createPrismaMock();
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/leave', 'post');

        const req = {
            userId: 88,
            params: { id: '7' },
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(202);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            userId: 88,
            requiresWalletFinalization: true,
            finalization: {
                action: 'leave',
                userId: 88,
            },
        });
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/members/:userId/remove returns wallet finalization shim for removable members', async () => {
        const prisma = createPrismaMock();
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/members/:userId/remove', 'post');

        const req = {
            userId: 42,
            params: { id: '7', userId: '88' },
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(202);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            requiresWalletFinalization: true,
            finalization: {
                action: 'remove_member',
                userId: 88,
            },
        });
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/members/:userId/remove rejects protected roles', async () => {
        const prisma = createPrismaMock({
            targetMembership: {
                id: 77,
                userId: 88,
                role: 'Owner',
                status: 'Active',
            },
        });
        const router = membershipRouter(prisma as any, createRedisMock() as any);
        const handler = getRouteHandler(router, '/circles/:id/members/:userId/remove', 'post');

        const req = {
            userId: 42,
            params: { id: '7', userId: '88' },
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({ error: 'protected_member_role' });
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
