import { describe, expect, test, jest } from '@jest/globals';
import { resolvers } from '../resolvers';

describe('Knowledge.contributors source-of-truth', () => {
    test('prefers knowledge_contributions snapshot when present', async () => {
        const prisma = {
            knowledgeContribution: {
                findMany: jest.fn(async () => ([
                    {
                        contributorPubkey: '11111111111111111111111111111111',
                        contributorHandle: 'alice',
                        contributionRole: 'Author',
                        contributionWeight: 0.7,
                        sourceDraftPostId: 42,
                        sourceAnchorId: 'a'.repeat(64),
                        sourcePayloadHash: 'b'.repeat(64),
                        sourceSummaryHash: 'c'.repeat(64),
                        sourceMessagesDigest: 'd'.repeat(64),
                        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
                    },
                    {
                        contributorPubkey: '11111111111111111111111111111112',
                        contributorHandle: null,
                        contributionRole: 'Discussant',
                        contributionWeight: 0.3,
                        sourceDraftPostId: 42,
                        sourceAnchorId: 'a'.repeat(64),
                        sourcePayloadHash: 'b'.repeat(64),
                        sourceSummaryHash: 'c'.repeat(64),
                        sourceMessagesDigest: 'd'.repeat(64),
                        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
                    },
                ])),
            },
            user: {
                findMany: jest.fn(async () => ([
                    { pubkey: '11111111111111111111111111111112', handle: 'bob' },
                ])),
            },
            agent: {
                findMany: jest.fn(async () => ([
                    {
                        agentPubkey: '11111111111111111111111111111112',
                        handle: 'scribe-bot',
                    },
                ])),
            },
            settlementHistory: {
                findMany: jest.fn(async () => []),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.contributors(
            {
                id: 99,
                knowledgeId: 'deadbeef',
                onChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                circleId: 7,
            },
            { limit: 20 },
            { prisma },
        );

        expect(prisma.knowledgeContribution.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.settlementHistory.findMany).not.toHaveBeenCalled();
        expect(result).toEqual([
            expect.objectContaining({
                handle: 'alice',
                role: 'Author',
                weight: 0.7,
                sourceType: 'SNAPSHOT',
                sourceDraftPostId: 42,
            }),
            expect.objectContaining({
                handle: 'bob',
                role: 'Discussant',
                weight: 0.3,
                authorType: 'AGENT',
                sourceType: 'SNAPSHOT',
                sourceAnchorId: 'a'.repeat(64),
            }),
        ]);
    });

    test('falls back to settlement_history when snapshot is absent', async () => {
        const prisma = {
            knowledgeContribution: {
                findMany: jest.fn(async () => ([])),
            },
            settlementHistory: {
                findMany: jest.fn(async () => ([
                    {
                        contributorPubkey: '11111111111111111111111111111111',
                        contributionRole: 'Author',
                        contributionWeight: 0.5,
                        authorityScore: 10,
                        reputationDelta: 5,
                        settledAt: new Date('2026-03-02T10:00:00.000Z'),
                    },
                ])),
            },
            user: {
                findMany: jest.fn(async () => ([
                    { pubkey: '11111111111111111111111111111111', handle: 'alice' },
                ])),
            },
            agent: {
                findMany: jest.fn(async () => ([
                    {
                        agentPubkey: '11111111111111111111111111111111',
                        handle: 'review-bot',
                    },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.contributors(
            {
                id: 99,
                knowledgeId: 'deadbeef',
                onChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                circleId: 7,
            },
            { limit: 20 },
            { prisma },
        );

        expect(prisma.knowledgeContribution.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.settlementHistory.findMany).toHaveBeenCalledTimes(1);
        expect(result).toEqual([
            expect.objectContaining({
                handle: 'alice',
                role: 'Author',
                weight: 0.5,
                authorType: 'AGENT',
                sourceType: 'SETTLEMENT',
                sourceAnchorId: null,
            }),
        ]);
    });
});
