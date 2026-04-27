import { describe, expect, jest, test } from '@jest/globals';
import { print } from 'graphql';

import { resolvers } from '../resolvers';
import { typeDefs } from '../schema';

describe('GraphQL knowledge crystal asset surface', () => {
    test('schema exposes master NFT and receipt fields on Knowledge', () => {
        const schemaSource = print(typeDefs);

        expect(schemaSource).toContain('type CrystalAsset');
        expect(schemaSource).toContain('masterAssetAddress: String');
        expect(schemaSource).toContain('type CrystalReceipt');
        expect(schemaSource).toContain('receiptAssetAddress: String');
        expect(schemaSource).toContain('type CrystalReceiptStats');
        expect(schemaSource).toContain('totalCount: Int!');
        expect(schemaSource).toContain('crystalAsset: CrystalAsset');
        expect(schemaSource).toContain('crystalReceiptStats: CrystalReceiptStats!');
        expect(schemaSource).toContain('crystalReceipts(limit: Int = 20): [CrystalReceipt!]!');
    });

    test('Knowledge.crystalAsset resolves the master NFT projection', async () => {
        const crystalAsset = {
            knowledgeRowId: 9,
            masterAssetAddress: 'mock_master_abc',
            assetStandard: 'mock_chain_master',
            mintStatus: 'minted',
        };
        const prisma = {
            crystalAsset: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(crystalAsset),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.crystalAsset(
            { id: 9 },
            {},
            { prisma },
        );

        expect(result).toBe(crystalAsset);
        expect(prisma.crystalAsset.findUnique).toHaveBeenCalledWith({
            where: {
                knowledgeRowId: 9,
            },
        });
    });

    test('Knowledge.crystalReceipts resolves contribution receipt projections', async () => {
        const receiptRows = [
            {
                id: 101,
                ownerPubkey: 'author-pubkey',
                receiptAssetAddress: 'mock_receipt_abc',
                contributionWeightBps: 7000,
                mintStatus: 'minted',
            },
        ];
        const prisma = {
            crystalReceipt: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue(receiptRows),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.crystalReceipts(
            { id: 9 },
            { limit: 3 },
            { prisma },
        );

        expect(result).toBe(receiptRows);
        expect(prisma.crystalReceipt.findMany).toHaveBeenCalledWith({
            where: {
                knowledgeRowId: 9,
            },
            orderBy: [
                { contributionWeightBps: 'desc' },
                { updatedAt: 'desc' },
            ],
            take: 3,
        });
    });

    test('Knowledge.crystalReceiptStats resolves total contribution receipt counts without page limits', async () => {
        const receiptBuckets = [
            { mintStatus: 'minted', _count: { _all: 2 } },
            { mintStatus: 'pending', _count: { _all: 1 } },
            { mintStatus: 'failed', _count: { _all: 1 } },
            { mintStatus: 'unexpected_status', _count: { _all: 1 } },
        ];
        const prisma = {
            crystalReceipt: {
                groupBy: jest.fn<() => Promise<any[]>>().mockResolvedValue(receiptBuckets),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.crystalReceiptStats(
            { id: 9 },
            {},
            { prisma },
        );

        expect(result).toEqual({
            totalCount: 5,
            mintedCount: 2,
            pendingCount: 1,
            failedCount: 1,
            unknownCount: 1,
        });
        expect(prisma.crystalReceipt.groupBy).toHaveBeenCalledWith({
            where: {
                knowledgeRowId: 9,
            },
            by: ['mintStatus'],
            _count: {
                _all: true,
            },
        });
    });
});
