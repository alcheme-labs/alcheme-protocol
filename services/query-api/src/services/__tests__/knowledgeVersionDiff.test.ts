import { describe, expect, jest, test } from '@jest/globals';

import { loadKnowledgeVersionDiff } from '../knowledgeVersionDiff';

function makeEventRow(input: {
    id: bigint;
    knowledgeId: string;
    eventType: string;
    version: number;
    actorPubkey: string | null;
    contributorsCount: number | null;
    contributorsRoot: string | null;
    sourceEventTimestamp: bigint;
    eventAt: Date;
    createdAt: Date;
}) {
    return input;
}

describe('knowledge version diff read model', () => {
    test('compares two versions using available version-event truth plus current-version metadata', async () => {
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
                makeEventRow({
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
                }),
                makeEventRow({
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
                }),
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

        const diff = await loadKnowledgeVersionDiff(prisma, {
            knowledgeId: 'K-1',
            fromVersion: 1,
            toVersion: 3,
        });

        expect(diff).not.toBeNull();
        expect(diff).toMatchObject({
            knowledgeId: 'K-1',
            fromVersion: 1,
            toVersion: 3,
            fromSnapshot: {
                version: 1,
                eventType: 'knowledge_submitted',
                actorHandle: 'alice',
                hasContentSnapshot: false,
                title: null,
            },
            toSnapshot: {
                version: 3,
                eventType: 'contributors_updated',
                actorHandle: 'bob',
                hasContentSnapshot: true,
                title: 'Latest crystal title',
                contentHash: 'f'.repeat(64),
            },
            unavailableFields: ['title', 'description', 'ipfsCid', 'contentHash'],
            summary: 'Only version-event metadata can be compared for now; historical body snapshots are not stored yet.',
        });
        expect(diff!.fieldChanges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                field: 'eventType',
                fromValue: 'knowledge_submitted',
                toValue: 'contributors_updated',
            }),
            expect.objectContaining({
                field: 'contributorsCount',
                fromValue: '—',
                toValue: '5',
            }),
            expect.objectContaining({
                field: 'contributorsRoot',
                fromValue: '—',
                toValue: 'b'.repeat(64),
            }),
        ]));
    });

    test('localizes compatibility labels and summary by locale with English fallback', async () => {
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
                makeEventRow({
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
                }),
                makeEventRow({
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
                }),
            ])),
            user: {
                findMany: jest.fn(async () => []),
            },
        } as any;

        const zhDiff = await loadKnowledgeVersionDiff(prisma, {
            knowledgeId: 'K-1',
            fromVersion: 1,
            toVersion: 3,
            locale: 'zh',
        });
        expect(zhDiff?.summary).toBe('当前只能比较版本事件元数据；历史正文快照尚未入库。');
        expect(zhDiff?.fieldChanges.find((change) => change.field === 'contributorsCount')?.label).toBe('贡献者人数');

        const esDiff = await loadKnowledgeVersionDiff(prisma, {
            knowledgeId: 'K-1',
            fromVersion: 1,
            toVersion: 3,
            locale: 'es',
        });
        expect(esDiff?.summary).toBe('Only version-event metadata can be compared for now; historical body snapshots are not stored yet.');
        expect(esDiff?.fieldChanges.find((change) => change.field === 'contributorsCount')?.label).toBe('Contributor count');
    });

    test('returns null when one requested version does not exist in version events', async () => {
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
                makeEventRow({
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
                }),
            ])),
            user: {
                findMany: jest.fn(async () => []),
            },
        } as any;

        const diff = await loadKnowledgeVersionDiff(prisma, {
            knowledgeId: 'K-1',
            fromVersion: 2,
            toVersion: 3,
        });

        expect(diff).toBeNull();
    });
});
