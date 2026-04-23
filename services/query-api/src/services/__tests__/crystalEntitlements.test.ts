import { describe, expect, jest, test } from '@jest/globals';

import {
    CrystalEntitlementSyncError,
    upsertCrystalEntitlementsForKnowledge,
} from '../crystalEntitlements/upsert';

function createPrismaMock() {
    const crystalEntitlement = {
        updateMany: jest.fn(async () => ({ count: 1 })),
        upsert: jest.fn(async ({ where }: any) => ({
            id: 1,
            knowledgeRowId: where.knowledgeRowId_ownerPubkey.knowledgeRowId,
            ownerPubkey: where.knowledgeRowId_ownerPubkey.ownerPubkey,
        })),
    };

    const prisma: any = {
        knowledge: {
            findUnique: jest.fn(async () => ({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                binding: {
                    proofPackageHash: '9'.repeat(64),
                    sourceAnchorId: 'a'.repeat(64),
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 2,
                },
                contributions: [
                    {
                        contributorPubkey: 'author-pubkey',
                        contributionRole: 'Author',
                        contributionWeightBps: 7000,
                    },
                    {
                        contributorPubkey: 'discussant-pubkey',
                        contributionRole: 'Discussant',
                        contributionWeightBps: 3000,
                    },
                ],
            })),
        },
        user: {
            findMany: jest.fn(async () => ([
                { id: 11, pubkey: 'author-pubkey' },
                { id: 12, pubkey: 'discussant-pubkey' },
            ])),
        },
        crystalEntitlement,
        $transaction: jest.fn(async (callback: any) => callback({
            crystalEntitlement,
        })),
    };

    return prisma;
}

describe('crystal entitlement upsert', () => {
    test('upserts active entitlements from the current binding and contribution snapshot', async () => {
        const prisma = createPrismaMock();

        const result = await upsertCrystalEntitlementsForKnowledge(prisma as any, {
            knowledgePublicId: 'knowledge-9',
        });

        expect(result).toMatchObject({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            entitlementCount: 2,
            ownerPubkeys: ['author-pubkey', 'discussant-pubkey'],
        });
        expect(prisma.crystalEntitlement.updateMany).toHaveBeenCalledWith({
            where: {
                knowledgeRowId: 9,
                status: 'active',
                ownerPubkey: { notIn: ['author-pubkey', 'discussant-pubkey'] },
            },
            data: {
                status: 'revoked',
                lastSyncedAt: expect.any(Date),
            },
        });
        expect(prisma.crystalEntitlement.upsert).toHaveBeenCalledTimes(2);
        expect(prisma.crystalEntitlement.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: {
                knowledgeRowId_ownerPubkey: {
                    knowledgeRowId: 9,
                    ownerPubkey: 'author-pubkey',
                },
            },
            create: expect.objectContaining({
                knowledgePublicId: 'knowledge-9',
                circleId: 7,
                ownerUserId: 11,
                contributionRole: 'Author',
                contributionWeightBps: 7000,
                status: 'active',
            }),
            update: expect.objectContaining({
                ownerUserId: 11,
                contributionRole: 'Author',
                contributionWeightBps: 7000,
                status: 'active',
            }),
        }));
    });

    test('fails when knowledge binding is still missing', async () => {
        const prisma = createPrismaMock();
        prisma.knowledge.findUnique.mockResolvedValueOnce({
            id: 9,
            knowledgeId: 'knowledge-9',
            circleId: 7,
            binding: null,
            contributions: [],
        });

        await expect(upsertCrystalEntitlementsForKnowledge(prisma as any, {
            knowledgePublicId: 'knowledge-9',
        })).rejects.toBeInstanceOf(CrystalEntitlementSyncError);
    });
});
