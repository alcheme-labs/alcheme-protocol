import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const createCircleAgentMock = jest.fn<() => Promise<any>>();
const bindAgentToUserMock = jest.fn<() => Promise<any>>();
const listCircleAgentsMock = jest.fn<() => Promise<any[]>>();

jest.mock('../src/services/agents/runtime', () => ({
    createCircleAgent: createCircleAgentMock,
    bindAgentToUser: bindAgentToUserMock,
    listCircleAgents: listCircleAgentsMock,
}));

import { agentsRouter } from '../src/rest/agents';

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

describe('agent routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        createCircleAgentMock.mockResolvedValue({
            id: 15,
            circleId: 7,
            agentPubkey: 'AgentPubkey111111111111111111111111111111111',
            handle: 'scribe-bot',
            displayName: 'Scribe Bot',
            description: 'Turns debate into first drafts.',
            ownerUserId: 21,
            createdByUserId: 8,
            status: 'active',
        });
        bindAgentToUserMock.mockResolvedValue({
            id: 15,
            circleId: 7,
            ownerUserId: 34,
            status: 'active',
        });
        listCircleAgentsMock.mockResolvedValue([]);
    });

    test('creates an agent for circle owners/admins', async () => {
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
        const handler = getRouteHandler(router, '/:id/agents', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 8,
            body: {
                pubkey: 'AgentPubkey111111111111111111111111111111111',
                handle: 'scribe-bot',
                displayName: 'Scribe Bot',
                description: 'Turns debate into first drafts.',
                ownerUserId: 21,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(createCircleAgentMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            agentPubkey: 'AgentPubkey111111111111111111111111111111111',
            handle: 'scribe-bot',
            displayName: 'Scribe Bot',
            description: 'Turns debate into first drafts.',
            ownerUserId: 21,
            createdByUserId: 8,
        });
    });

    test('rejects ordinary members from creating agents', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                })),
            },
        } as any;

        const router = agentsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/agents', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 8,
            body: {
                pubkey: 'AgentPubkey111111111111111111111111111111111',
                handle: 'scribe-bot',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(403);
        expect(createCircleAgentMock).not.toHaveBeenCalled();
    });

    test('binds an existing agent for circle owners/admins', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
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
        const handler = getRouteHandler(router, '/:id/agents/:agentId/bind', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7', agentId: '15' },
            userId: 8,
            body: {
                ownerUserId: 34,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(bindAgentToUserMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            agentId: 15,
            ownerUserId: 34,
        });
    });
});
