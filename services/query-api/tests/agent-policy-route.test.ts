import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const resolveCircleAgentPolicyMock = jest.fn<() => Promise<any>>();
const upsertCircleAgentPolicyMock = jest.fn<() => Promise<any>>();

jest.mock('../src/services/agents/policy', () => ({
    resolveCircleAgentPolicy: resolveCircleAgentPolicyMock,
    upsertCircleAgentPolicy: upsertCircleAgentPolicyMock,
}));

import { agentsRouter } from '../src/rest/agents';

function getRouteHandler(router: Router, path: string, method: 'get' | 'put') {
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

describe('agent policy routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        resolveCircleAgentPolicyMock.mockResolvedValue({
            circleId: 7,
            triggerScope: 'draft_only',
            costDiscountBps: 0,
            reviewMode: 'owner_review',
            updatedByUserId: null,
        });
        upsertCircleAgentPolicyMock.mockResolvedValue({
            circleId: 7,
            triggerScope: 'circle_wide',
            costDiscountBps: 1500,
            reviewMode: 'admin_review',
            updatedByUserId: 8,
        });
    });

    test('allows circle admins to read the current agent policy', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Admin',
                    status: 'Active',
                })),
            },
        } as any;

        const router = agentsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/agents/policy', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 8,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(resolveCircleAgentPolicyMock).toHaveBeenCalledWith(prisma, 7);
    });

    test('rejects policy writes from non-owner managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Admin',
                    status: 'Active',
                })),
            },
        } as any;

        const router = agentsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/agents/policy', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 8,
            body: {
                triggerScope: 'circle_wide',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(403);
        expect(upsertCircleAgentPolicyMock).not.toHaveBeenCalled();
    });

    test('allows circle owners to update trigger scope, discount, and review mode', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 8,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Owner',
                    status: 'Active',
                })),
            },
        } as any;

        const router = agentsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/agents/policy', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 8,
            body: {
                triggerScope: 'circle_wide',
                costDiscountBps: 1500,
                reviewMode: 'admin_review',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(upsertCircleAgentPolicyMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            actorUserId: 8,
            patch: {
                triggerScope: 'circle_wide',
                costDiscountBps: 1500,
                reviewMode: 'admin_review',
            },
        });
    });
});
