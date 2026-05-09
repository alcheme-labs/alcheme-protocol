import crypto from 'crypto';

import {
    buildDraftAnchorProofPackage,
    stableStringify,
} from '../proofPackage';
import type { DraftAnchorCanonicalPayload } from '../types';

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function fixturePayload(): DraftAnchorCanonicalPayload {
    const messages: DraftAnchorCanonicalPayload['messages'] = [
        {
            envelopeId: 'env-2',
            payloadHash: '2'.repeat(64),
            lamport: '101',
            senderPubkey: '11111111111111111111111111111113',
            createdAt: '2026-03-13T12:00:01.000Z',
            semanticScore: 2,
            relevanceMethod: '',
        },
        {
            envelopeId: 'env-1',
            payloadHash: '1'.repeat(64),
            lamport: '100',
            senderPubkey: '11111111111111111111111111111112',
            createdAt: '2026-03-13T12:00:00.000Z',
            semanticScore: -1,
            relevanceMethod: 'embedding',
        },
    ];

    return {
        version: 1,
        anchorType: 'discussion_draft_trigger',
        roomKey: 'circle:7',
        circleId: 7,
        draftPostId: 42,
        triggerReason: 'focused_discussion',
        summaryMethod: 'rule',
        summaryHash: sha256Hex('summary text'),
        messagesDigest: sha256Hex('placeholder'),
        messageCount: messages.length,
        fromLamport: '100',
        toLamport: '101',
        generatedAt: '2026-03-13T12:00:02.000Z',
        messages,
    };
}

describe('settlement proofPackage', () => {
    test('stableStringify sorts object keys without changing array order', () => {
        expect(stableStringify({
            b: 2,
            a: {
                d: 4,
                c: 3,
            },
        })).toBe('{"a":{"c":3,"d":4},"b":2}');
    });

    test('builds draft anchor payload hash with the legacy stable serialization', () => {
        const payload = fixturePayload();
        const result = buildDraftAnchorProofPackage({
            payload,
            memoPrefix: 'alcheme-draft-anchor:v1:',
        });

        const canonicalJson = stableStringify(result.canonicalPayload);
        expect(result.canonicalJson).toBe(canonicalJson);
        expect(result.payloadHash).toBe(sha256Hex(canonicalJson));
        expect(result.anchorId).toBe(result.payloadHash);
        expect(result.anchorPayload.payloadHash).toBe(result.payloadHash);
        expect(result.anchorPayload.canonicalJson).toBe(canonicalJson);
        expect(result.memoText).toContain(result.anchorId);
        expect(result.memoText).toContain(result.summaryHash);
        expect(result.memoText).toContain(result.messagesDigest);
    });
});
