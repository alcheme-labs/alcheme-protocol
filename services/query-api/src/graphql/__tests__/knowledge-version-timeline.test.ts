import { describe, expect, test, jest } from '@jest/globals';

import { resolvers } from '../resolvers';

describe('Knowledge.versionTimeline resolver', () => {
    test('returns mapped timeline events with actor handles', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => ([
                {
                    id: BigInt(102),
                    eventType: 'contributors_updated',
                    version: 3,
                    actorPubkey: 'ActorPubkey111111111111111111111111111111111',
                    contributorsCount: 4,
                    contributorsRoot: 'a'.repeat(64),
                    sourceEventTimestamp: BigInt(1700001200),
                    eventAt: new Date('2026-03-03T05:20:00.000Z'),
                    createdAt: new Date('2026-03-03T05:20:03.000Z'),
                },
                {
                    id: BigInt(101),
                    eventType: 'knowledge_submitted',
                    version: 1,
                    actorPubkey: 'ActorPubkey111111111111111111111111111111111',
                    contributorsCount: null,
                    contributorsRoot: null,
                    sourceEventTimestamp: BigInt(1700001000),
                    eventAt: new Date('2026-03-03T05:10:00.000Z'),
                    createdAt: new Date('2026-03-03T05:10:02.000Z'),
                },
            ])),
            user: {
                findMany: jest.fn(async () => ([
                    {
                        pubkey: 'ActorPubkey111111111111111111111111111111111',
                        handle: 'alice',
                    },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.versionTimeline(
            { knowledgeId: 'K-1' },
            { limit: 20 },
            { prisma },
        );

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.user.findMany).toHaveBeenCalledWith({
            where: {
                pubkey: {
                    in: ['ActorPubkey111111111111111111111111111111111'],
                },
            },
            select: {
                pubkey: true,
                handle: true,
            },
        });
        expect(result).toEqual([
            expect.objectContaining({
                id: '102',
                eventType: 'contributors_updated',
                version: 3,
                actorHandle: 'alice',
                contributorsCount: 4,
                sourceEventTimestamp: '1700001200',
            }),
            expect.objectContaining({
                id: '101',
                eventType: 'knowledge_submitted',
                version: 1,
                actorHandle: 'alice',
                contributorsCount: null,
                sourceEventTimestamp: '1700001000',
            }),
        ]);
    });

    test('returns empty list when knowledge id is missing', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => []),
            user: {
                findMany: jest.fn(async () => []),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.versionTimeline(
            { knowledgeId: '' },
            { limit: 20 },
            { prisma },
        );

        expect(result).toEqual([]);
        expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    test('returns a structured version diff instead of only timeline events', async () => {
        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    knowledgeId: 'K-1',
                    title: 'Latest crystal title',
                    description: 'Latest crystal description',
                    ipfsCid: 'bafy-current',
                    contentHash: 'f'.repeat(64),
                    version: 3,
                })),
            },
            $queryRaw: jest.fn(async () => ([
                {
                    id: BigInt(103),
                    knowledgeId: 'K-1',
                    eventType: 'contributors_updated',
                    version: 3,
                    actorPubkey: 'BobPubkey1111111111111111111111111111111111',
                    contributorsCount: 5,
                    contributorsRoot: 'b'.repeat(64),
                    sourceEventTimestamp: BigInt(1700001300),
                    eventAt: new Date('2026-03-24T21:03:00.000Z'),
                    createdAt: new Date('2026-03-24T21:03:02.000Z'),
                },
                {
                    id: BigInt(101),
                    knowledgeId: 'K-1',
                    eventType: 'knowledge_submitted',
                    version: 1,
                    actorPubkey: 'AlicePubkey11111111111111111111111111111111',
                    contributorsCount: null,
                    contributorsRoot: null,
                    sourceEventTimestamp: BigInt(1700001000),
                    eventAt: new Date('2026-03-24T21:00:00.000Z'),
                    createdAt: new Date('2026-03-24T21:00:02.000Z'),
                },
            ])),
            user: {
                findMany: jest.fn(async () => ([
                    {
                        pubkey: 'AlicePubkey11111111111111111111111111111111',
                        handle: 'alice',
                    },
                    {
                        pubkey: 'BobPubkey1111111111111111111111111111111111',
                        handle: 'bob',
                    },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.versionDiff(
            { knowledgeId: 'K-1' },
            { fromVersion: 1, toVersion: 3 },
            { prisma },
        );

        expect(result).toMatchObject({
            knowledgeId: 'K-1',
            fromVersion: 1,
            toVersion: 3,
            fromSnapshot: {
                actorHandle: 'alice',
                hasContentSnapshot: false,
            },
            toSnapshot: {
                actorHandle: 'bob',
                hasContentSnapshot: true,
                title: 'Latest crystal title',
            },
            summary: 'Only version-event metadata can be compared for now; historical body snapshots are not stored yet.',
        });
        expect(result.fieldChanges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                field: 'eventType',
                fromValue: 'knowledge_submitted',
                toValue: 'contributors_updated',
            }),
        ]));
    });
});
