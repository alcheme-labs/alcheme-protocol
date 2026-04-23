import { describe, expect, jest, test } from '@jest/globals';

import {
    bindAgentToUser,
    createCircleAgent,
    listCircleAgents,
} from '../runtime';

describe('agent runtime', () => {
    test('creates a persisted circle-scoped agent with an optional bound owner', async () => {
        const createdAt = new Date('2026-03-25T20:00:00.000Z');
        const prisma = {
            agent: {
                create: jest.fn(async ({ data }) => ({
                    id: 15,
                    circleId: data.circleId,
                    agentPubkey: data.agentPubkey,
                    handle: data.handle,
                    displayName: data.displayName,
                    description: data.description,
                    ownerUserId: data.ownerUserId,
                    createdByUserId: data.createdByUserId,
                    status: data.status,
                    createdAt,
                    updatedAt: createdAt,
                })),
            },
        } as any;

        const result = await createCircleAgent(prisma, {
            circleId: 7,
            agentPubkey: 'AgentPubkey111111111111111111111111111111111',
            handle: 'scribe-bot',
            displayName: 'Scribe Bot',
            description: 'Turns debate into first drafts.',
            ownerUserId: 21,
            createdByUserId: 8,
        });

        expect(prisma.agent.create).toHaveBeenCalledWith({
            data: {
                circleId: 7,
                agentPubkey: 'AgentPubkey111111111111111111111111111111111',
                handle: 'scribe-bot',
                displayName: 'Scribe Bot',
                description: 'Turns debate into first drafts.',
                ownerUserId: 21,
                createdByUserId: 8,
                status: 'active',
            },
        });
        expect(result).toMatchObject({
            id: 15,
            ownerUserId: 21,
            status: 'active',
        });
    });

    test('binds an existing agent to a new owner without changing its circle scope', async () => {
        const updatedAt = new Date('2026-03-25T20:05:00.000Z');
        const prisma = {
            agent: {
                findUnique: jest.fn(async () => ({
                    id: 15,
                    circleId: 7,
                    agentPubkey: 'AgentPubkey111111111111111111111111111111111',
                    handle: 'scribe-bot',
                    ownerUserId: 21,
                    createdByUserId: 8,
                    status: 'active',
                    createdAt: new Date('2026-03-25T20:00:00.000Z'),
                    updatedAt: new Date('2026-03-25T20:00:00.000Z'),
                })),
                update: jest.fn(async ({ data }) => ({
                    id: 15,
                    circleId: 7,
                    agentPubkey: 'AgentPubkey111111111111111111111111111111111',
                    handle: 'scribe-bot',
                    ownerUserId: data.ownerUserId,
                    createdByUserId: 8,
                    status: 'active',
                    createdAt: new Date('2026-03-25T20:00:00.000Z'),
                    updatedAt,
                })),
            },
        } as any;

        const result = await bindAgentToUser(prisma, {
            circleId: 7,
            agentId: 15,
            ownerUserId: 34,
        });

        expect(prisma.agent.update).toHaveBeenCalledWith({
            where: { id: 15 },
            data: {
                ownerUserId: 34,
            },
        });
        expect(result).toMatchObject({
            id: 15,
            ownerUserId: 34,
        });
    });

    test('lists circle agents in reverse creation order', async () => {
        const prisma = {
            agent: {
                findMany: jest.fn(async () => ([
                    {
                        id: 16,
                        circleId: 7,
                        agentPubkey: 'AgentPubkey222222222222222222222222222222222',
                        handle: 'review-bot',
                        displayName: 'Review Bot',
                        description: null,
                        ownerUserId: null,
                        createdByUserId: 8,
                        status: 'active',
                        createdAt: new Date('2026-03-25T20:10:00.000Z'),
                        updatedAt: new Date('2026-03-25T20:10:00.000Z'),
                    },
                ])),
            },
        } as any;

        const result = await listCircleAgents(prisma, 7);

        expect(prisma.agent.findMany).toHaveBeenCalledWith({
            where: { circleId: 7 },
            orderBy: [
                { createdAt: 'desc' },
                { id: 'desc' },
            ],
        });
        expect(result[0]).toMatchObject({
            id: 16,
            handle: 'review-bot',
        });
    });
});
