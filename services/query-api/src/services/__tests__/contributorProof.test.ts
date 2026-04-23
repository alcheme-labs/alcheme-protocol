import type { DraftAnchorCanonicalPayload } from '../draftAnchor';
import {
    buildDraftContributorProof,
    loadDraftContributorProof,
    sortDraftContributorsCanonical,
} from '../contributorProof';

function makeAnchorPayload(): DraftAnchorCanonicalPayload {
    return {
        version: 1,
        anchorType: 'discussion_draft_trigger',
        roomKey: 'circle:7',
        circleId: 7,
        draftPostId: 42,
        triggerReason: 'focused_discussion',
        summaryMethod: 'rule',
        summaryHash: 'b'.repeat(64),
        messagesDigest: 'c'.repeat(64),
        messageCount: 4,
        fromLamport: '100',
        toLamport: '104',
        generatedAt: '2026-02-27T12:00:00.000Z',
        messages: [
            {
                envelopeId: 'env-1',
                payloadHash: '1'.repeat(64),
                lamport: '100',
                senderPubkey: '11111111111111111111111111111112',
                createdAt: '2026-02-27T12:00:00.000Z',
                semanticScore: 0.8,
                relevanceMethod: 'rule',
            },
            {
                envelopeId: 'env-2',
                payloadHash: '2'.repeat(64),
                lamport: '101',
                senderPubkey: '11111111111111111111111111111113',
                createdAt: '2026-02-27T12:00:01.000Z',
                semanticScore: 0.6,
                relevanceMethod: 'rule',
            },
            {
                envelopeId: 'env-3',
                payloadHash: '3'.repeat(64),
                lamport: '102',
                senderPubkey: '11111111111111111111111111111113',
                createdAt: '2026-02-27T12:00:02.000Z',
                semanticScore: 0.4,
                relevanceMethod: 'rule',
            },
            {
                envelopeId: 'env-4',
                payloadHash: '4'.repeat(64),
                lamport: '104',
                senderPubkey: '11111111111111111111111111111114',
                createdAt: '2026-02-27T12:00:03.000Z',
                semanticScore: 0.1,
                relevanceMethod: 'rule',
            },
        ],
    };
}

describe('contributorProof', () => {
    test('builds a deterministic contributor root from draft author plus discussants', () => {
        const result = buildDraftContributorProof({
            draftPostId: 42,
            draftAuthorPubkey: '11111111111111111111111111111111',
            anchorId: 'd'.repeat(64),
            payloadHash: 'e'.repeat(64),
            canonicalPayload: makeAnchorPayload(),
        });

        expect(result.count).toBe(4);
        expect(result.contributors.map((item) => ({
            pubkey: item.pubkey,
            role: item.role,
            weightBps: item.weightBps,
        }))).toEqual([
            { pubkey: '11111111111111111111111111111111', role: 'Author', weightBps: 5000 },
            { pubkey: '11111111111111111111111111111112', role: 'Discussant', weightBps: 2105 },
            { pubkey: '11111111111111111111111111111113', role: 'Discussant', weightBps: 2632 },
            { pubkey: '11111111111111111111111111111114', role: 'Discussant', weightBps: 263 },
        ]);
        expect(result.rootHex).toHaveLength(64);
    });

    test('fails when no verified draft anchor exists', async () => {
        await expect(loadDraftContributorProof({
            draftPostId: 42,
            loadLatestAnchor: async () => null,
            loadDraftPost: async () => ({
                id: 42,
                circleId: 7,
                authorPubkey: '11111111111111111111111111111111',
            }),
        })).rejects.toThrow('draft_anchor_not_found');
    });

    test('fails when anchor proof is not verifiable', async () => {
        await expect(loadDraftContributorProof({
            draftPostId: 42,
            loadLatestAnchor: async () => ({
                anchorId: 'd'.repeat(64),
                payloadHash: 'e'.repeat(64),
                canonicalPayload: makeAnchorPayload(),
                proof: { verifiable: false },
            }),
            loadDraftPost: async () => ({
                id: 42,
                circleId: 7,
                authorPubkey: '11111111111111111111111111111111',
            }),
        })).rejects.toThrow('draft_anchor_unverifiable');
    });

    test('sorts contributors deterministically by role then pubkey', () => {
        const sorted = sortDraftContributorsCanonical([
            {
                pubkey: '11111111111111111111111111111113',
                role: 'Discussant',
                weightBps: 1000,
                leafHex: '3'.repeat(64),
            },
            {
                pubkey: '11111111111111111111111111111111',
                role: 'Author',
                weightBps: 5000,
                leafHex: '1'.repeat(64),
            },
            {
                pubkey: '11111111111111111111111111111112',
                role: 'Discussant',
                weightBps: 4000,
                leafHex: '2'.repeat(64),
            },
        ]);

        expect(sorted.map((item) => `${item.role}:${item.pubkey}`)).toEqual([
            'Author:11111111111111111111111111111111',
            'Discussant:11111111111111111111111111111112',
            'Discussant:11111111111111111111111111111113',
        ]);
    });
});
