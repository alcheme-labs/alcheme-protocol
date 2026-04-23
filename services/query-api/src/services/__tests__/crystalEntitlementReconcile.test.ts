import { afterEach, describe, expect, jest, test } from '@jest/globals';

const upsertCrystalEntitlementsForKnowledgeMock = jest.fn<() => Promise<any>>();

jest.mock('../crystalEntitlements/upsert', () => ({
    upsertCrystalEntitlementsForKnowledge: (...args: any[]) => (upsertCrystalEntitlementsForKnowledgeMock as any)(...args),
}));

import { reconcileCrystalEntitlements } from '../crystalEntitlements/reconcile';

describe('crystal entitlement reconcile', () => {
    afterEach(() => {
        upsertCrystalEntitlementsForKnowledgeMock.mockReset();
    });

    test('replays entitlement upsert for each already-crystallized knowledge row in scope', async () => {
        const prisma = {
            knowledge: {
                findMany: jest.fn(async () => ([
                    { id: 9, knowledgeId: 'knowledge-9' },
                    { id: 10, knowledgeId: 'knowledge-10' },
                ])),
            },
        } as any;
        upsertCrystalEntitlementsForKnowledgeMock
            .mockResolvedValueOnce({
                knowledgeRowId: 9,
                knowledgePublicId: 'knowledge-9',
                entitlementCount: 2,
                ownerPubkeys: ['a', 'b'],
            })
            .mockResolvedValueOnce({
                knowledgeRowId: 10,
                knowledgePublicId: 'knowledge-10',
                entitlementCount: 1,
                ownerPubkeys: ['c'],
            });

        const result = await reconcileCrystalEntitlements(prisma, { limit: 50 });

        expect(result).toEqual({
            processedKnowledgeCount: 2,
            totalEntitlements: 3,
            knowledgeRowIds: [9, 10],
        });
        expect(prisma.knowledge.findMany).toHaveBeenCalledWith({
            where: {
                binding: { isNot: null },
                contributions: { some: {} },
            },
            orderBy: { id: 'asc' },
            take: 50,
            select: {
                id: true,
                knowledgeId: true,
            },
        });
        expect(upsertCrystalEntitlementsForKnowledgeMock).toHaveBeenNthCalledWith(1, prisma, {
            knowledgeRowId: 9,
            now: undefined,
        });
        expect(upsertCrystalEntitlementsForKnowledgeMock).toHaveBeenNthCalledWith(2, prisma, {
            knowledgeRowId: 10,
            now: undefined,
        });
    });
});
