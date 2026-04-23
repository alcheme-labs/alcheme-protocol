import { describe, expect, jest, test } from '@jest/globals';

import { prepareCrystalAssetProjection } from '../crystalAssets/enqueue';

function createPrismaMock() {
    const crystalAsset = {
        upsert: jest.fn(async () => ({
            id: 51,
            knowledgeRowId: 9,
        })),
    };
    const crystalReceipt = {
        upsert: jest.fn(async ({ where }: any) => ({
            id: Number(where.entitlementId ?? 0) || 1,
            entitlementId: Number(where.entitlementId ?? 0) || 1,
        })),
    };
    const prisma: any = {
        knowledge: {
            findUnique: jest.fn(async () => ({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                author: {
                    pubkey: 'author-pubkey',
                },
                binding: {
                    proofPackageHash: '9'.repeat(64),
                    sourceAnchorId: 'a'.repeat(64),
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 2,
                },
                crystalEntitlements: [
                    {
                        id: 101,
                        ownerPubkey: 'author-pubkey',
                        ownerUserId: 11,
                        contributionRole: 'Author',
                        contributionWeightBps: 7000,
                        proofPackageHash: '9'.repeat(64),
                        sourceAnchorId: 'a'.repeat(64),
                        contributorsRoot: 'e'.repeat(64),
                        contributorsCount: 2,
                    },
                    {
                        id: 102,
                        ownerPubkey: 'discussant-pubkey',
                        ownerUserId: 12,
                        contributionRole: 'Discussant',
                        contributionWeightBps: 3000,
                        proofPackageHash: '9'.repeat(64),
                        sourceAnchorId: 'a'.repeat(64),
                        contributorsRoot: 'e'.repeat(64),
                        contributorsCount: 2,
                    },
                ],
            })),
        },
        crystalAsset,
        crystalReceipt,
    };

    return {
        prisma,
        crystalAsset,
        crystalReceipt,
    };
}

describe('crystal receipt projection', () => {
    test('creates one master asset projection and one pending receipt per active entitlement', async () => {
        const { prisma, crystalAsset, crystalReceipt } = createPrismaMock();

        const result = await prepareCrystalAssetProjection(prisma as any, {
            knowledgeRowId: 9,
        });

        expect(result).toMatchObject({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            circleId: 7,
            ownerPubkey: 'author-pubkey',
            entitlementCount: 2,
            receiptCount: 2,
        });
        expect(crystalAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                knowledgeRowId: 9,
            },
            create: expect.objectContaining({
                knowledgePublicId: 'knowledge-9',
                ownerPubkey: 'author-pubkey',
                mintStatus: 'pending',
            }),
            update: expect.objectContaining({
                knowledgePublicId: 'knowledge-9',
                ownerPubkey: 'author-pubkey',
            }),
        }));
        expect(crystalReceipt.upsert).toHaveBeenCalledTimes(2);
        expect(crystalReceipt.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
            where: {
                entitlementId: 101,
            },
            create: expect.objectContaining({
                knowledgeRowId: 9,
                ownerPubkey: 'author-pubkey',
                assetStandard: 'pending',
                transferMode: 'non_transferable',
                mintStatus: 'pending',
            }),
        }));
        expect(crystalReceipt.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
            where: {
                entitlementId: 102,
            },
            create: expect.objectContaining({
                knowledgeRowId: 9,
                ownerPubkey: 'discussant-pubkey',
                contributionRole: 'Discussant',
                contributionWeightBps: 3000,
            }),
        }));
    });
});
