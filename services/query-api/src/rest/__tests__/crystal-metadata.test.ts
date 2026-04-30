import express from 'express';
import request from 'supertest';
import { describe, expect, jest, test } from '@jest/globals';

import { crystalRouter } from '../crystals';

function buildApp(prisma: any) {
    const app = express();
    app.use('/api/v1/crystals', crystalRouter(prisma, {} as any));
    return app;
}

describe('crystal metadata routes', () => {
    test('serves master asset metadata at the URI minted into Token-2022 assets', async () => {
        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 2,
                    knowledgeId: 'knowledge-public-id',
                    circleId: 153,
                    title: 'Founding Vision',
                    description: 'Settled knowledge from a discussion.',
                    crystalParams: { hue: 210 },
                    author: {
                        pubkey: 'author-wallet',
                    },
                    binding: {
                        proofPackageHash: 'proof-hash',
                        sourceAnchorId: 'source-anchor',
                        contributorsRoot: 'contributors-root',
                        contributorsCount: 2,
                    },
                    crystalAsset: {
                        ownerPubkey: 'asset-owner',
                        proofPackageHash: 'asset-proof-hash',
                        sourceAnchorId: 'asset-source-anchor',
                        contributorsRoot: 'asset-contributors-root',
                        contributorsCount: 2,
                    },
                })),
            },
        };

        const response = await request(buildApp(prisma))
            .get('/api/v1/crystals/knowledge-public-id/master.json')
            .expect(200);

        expect(response.headers['cache-control']).toBe('public, max-age=300');
        expect(response.body).toMatchObject({
            name: 'Founding Vision',
            symbol: 'ALCH-X',
            kind: 'master',
            knowledgePublicId: 'knowledge-public-id',
            circleId: 153,
            ownerPubkey: 'asset-owner',
            proofPackageHash: 'asset-proof-hash',
            sourceAnchorId: 'asset-source-anchor',
            contributorsRoot: 'asset-contributors-root',
            contributorsCount: 2,
            crystalParams: { hue: 210 },
        });
    });

    test('serves contributor receipt metadata at the URI minted into receipt assets', async () => {
        const prisma = {
            crystalReceipt: {
                findFirst: jest.fn(async () => ({
                    entitlementId: 7,
                    knowledgePublicId: 'knowledge-public-id',
                    circleId: 153,
                    ownerPubkey: 'receipt-owner',
                    contributionRole: 'Discussant',
                    contributionWeightBps: 5000,
                    proofPackageHash: 'receipt-proof-hash',
                    sourceAnchorId: 'receipt-source-anchor',
                    contributorsRoot: 'receipt-contributors-root',
                    contributorsCount: 2,
                    knowledge: {
                        title: 'Founding Vision',
                        description: 'Settled knowledge from a discussion.',
                    },
                })),
            },
        };

        const response = await request(buildApp(prisma))
            .get('/api/v1/crystals/knowledge-public-id/receipts/receipt-owner.json')
            .expect(200);

        expect(response.headers['cache-control']).toBe('public, max-age=300');
        expect(response.body).toMatchObject({
            name: 'Alcheme Receipt knowledge-public-id',
            symbol: 'ALCH-R',
            kind: 'receipt',
            entitlementId: 7,
            knowledgePublicId: 'knowledge-public-id',
            circleId: 153,
            ownerPubkey: 'receipt-owner',
            contributionRole: 'Discussant',
            contributionWeightBps: 5000,
            proofPackageHash: 'receipt-proof-hash',
            sourceAnchorId: 'receipt-source-anchor',
            contributorsRoot: 'receipt-contributors-root',
            contributorsCount: 2,
        });
    });
});
