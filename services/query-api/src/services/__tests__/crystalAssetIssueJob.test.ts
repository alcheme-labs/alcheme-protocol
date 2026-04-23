import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { issueCrystalAssetJob } from '../crystalAssets/jobs';

function createPrismaMock() {
    const crystalAsset = {
        upsert: jest.fn(async () => ({
            id: 51,
            knowledgeRowId: 9,
            mintStatus: 'pending',
            masterAssetAddress: null,
        })),
        update: jest.fn(async ({ data }: any) => ({
            id: 51,
            ...data,
        })),
    };
    const crystalReceipt = {
        upsert: jest.fn(async ({ where }: any) => ({
            id: Number(where.entitlementId ?? 0) || 1,
            entitlementId: Number(where.entitlementId ?? 0) || 1,
            mintStatus: 'pending',
            receiptAssetAddress: null,
        })),
        update: jest.fn(async ({ where, data }: any) => ({
            id: Number(where.id ?? 0) || 1,
            ...data,
        })),
    };

    const prisma: any = {
        knowledge: {
            findUnique: jest.fn(async () => ({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
                title: 'Knowledge Nine',
                description: 'Crystalized knowledge',
                crystalParams: { hue: 200 },
                author: {
                    id: 11,
                    handle: 'alice',
                    pubkey: 'author-pubkey',
                },
                binding: {
                    proofPackageHash: '9'.repeat(64),
                    sourceAnchorId: 'a'.repeat(64),
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 2,
                },
                crystalAsset: null,
                crystalEntitlements: [
                    {
                        id: 101,
                        ownerPubkey: 'author-pubkey',
                        ownerUserId: 11,
                        contributionRole: 'Author',
                        contributionWeightBps: 7000,
                        crystalReceipt: null,
                    },
                    {
                        id: 102,
                        ownerPubkey: 'discussant-pubkey',
                        ownerUserId: 12,
                        contributionRole: 'Discussant',
                        contributionWeightBps: 3000,
                        crystalReceipt: null,
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

describe('crystal asset issue job', () => {
    afterEach(() => {
        delete process.env.CRYSTAL_MASTER_OWNER_PUBKEY;
    });

    test('issues one master asset plus one receipt per active entitlement through the adapter', async () => {
        const { prisma, crystalAsset, crystalReceipt } = createPrismaMock();
        const mintAdapter = {
            mode: 'mock_chain' as const,
            issueMasterAsset: jest.fn(async () => ({
                assetAddress: 'master-asset-9',
                assetStandard: 'mock_chain_master',
                metadataUri: 'mock://knowledge-9/master',
                mintedAt: new Date('2026-04-12T19:00:00.000Z'),
            })),
            issueReceipt: jest.fn(async ({ ownerPubkey }: any) => ({
                assetAddress: `receipt-${ownerPubkey}`,
                assetStandard: 'mock_chain_receipt',
                metadataUri: `mock://${ownerPubkey}/receipt`,
                mintedAt: new Date('2026-04-12T19:00:01.000Z'),
            })),
        };

        const result = await issueCrystalAssetJob(prisma as any, {
            knowledgeRowId: 9,
            mintAdapter,
        });

        expect(result).toMatchObject({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            masterAssetIssued: true,
            receiptCount: 2,
            issuedReceiptCount: 2,
        });
        expect(mintAdapter.issueMasterAsset).toHaveBeenCalledWith(expect.objectContaining({
            knowledgeRowId: 9,
            knowledgePublicId: 'knowledge-9',
            ownerPubkey: 'author-pubkey',
        }));
        expect(mintAdapter.issueReceipt).toHaveBeenCalledTimes(2);
        expect(crystalAsset.update).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                knowledgeRowId: 9,
            },
            data: expect.objectContaining({
                masterAssetAddress: 'master-asset-9',
                mintStatus: 'minted',
                assetStandard: 'mock_chain_master',
            }),
        }));
        expect(crystalReceipt.update).toHaveBeenCalledTimes(2);
    });

    test('uses the configured master owner consistently for projection and issuance', async () => {
        process.env.CRYSTAL_MASTER_OWNER_PUBKEY = 'custody-pubkey';
        const { prisma, crystalAsset } = createPrismaMock();
        const mintAdapter = {
            mode: 'mock_chain' as const,
            issueMasterAsset: jest.fn(async () => ({
                assetAddress: 'master-asset-9',
                assetStandard: 'mock_chain_master',
                metadataUri: 'mock://knowledge-9/master',
                mintedAt: new Date('2026-04-12T19:00:00.000Z'),
            })),
            issueReceipt: jest.fn(async ({ ownerPubkey }: any) => ({
                assetAddress: `receipt-${ownerPubkey}`,
                assetStandard: 'mock_chain_receipt',
                metadataUri: `mock://${ownerPubkey}/receipt`,
                mintedAt: new Date('2026-04-12T19:00:01.000Z'),
            })),
        };

        await issueCrystalAssetJob(prisma as any, {
            knowledgeRowId: 9,
            mintAdapter,
        });

        expect(crystalAsset.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({
                ownerPubkey: 'custody-pubkey',
            }),
            update: expect.objectContaining({
                ownerPubkey: 'custody-pubkey',
            }),
        }));
        expect(mintAdapter.issueMasterAsset).toHaveBeenCalledWith(expect.objectContaining({
            ownerPubkey: 'custody-pubkey',
        }));
    });
});
