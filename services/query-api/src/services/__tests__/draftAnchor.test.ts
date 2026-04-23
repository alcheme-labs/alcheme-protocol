import crypto from 'crypto';
import {
    type DraftAnchorCanonicalPayload,
    type DraftAnchorRecord,
    verifyDraftAnchor,
} from '../draftAnchor';

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function stableSortValue(input: unknown): unknown {
    if (Array.isArray(input)) {
        return input.map(stableSortValue);
    }
    if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        Object.keys(record)
            .sort()
            .forEach((key) => {
                const value = record[key];
                if (value !== undefined) output[key] = stableSortValue(value);
            });
        return output;
    }
    return input;
}

function stableStringify(input: unknown): string {
    return JSON.stringify(stableSortValue(input));
}

function buildMessagesDigest(messages: DraftAnchorCanonicalPayload['messages']): string {
    const compact = messages.map((item) => `${item.lamport}:${item.envelopeId}:${item.payloadHash}`);
    return sha256Hex(compact.join('|'));
}

function buildRecord(status: DraftAnchorRecord['status']): DraftAnchorRecord {
    const messages: DraftAnchorCanonicalPayload['messages'] = [
        {
            envelopeId: 'env-1',
            payloadHash: '1'.repeat(64),
            lamport: '100',
            senderPubkey: '11111111111111111111111111111112',
            createdAt: '2026-03-13T12:00:00.000Z',
            semanticScore: 0.8,
            relevanceMethod: 'rule',
        },
    ];
    const messagesDigest = buildMessagesDigest(messages);
    const payload: DraftAnchorCanonicalPayload = {
        version: 1,
        anchorType: 'discussion_draft_trigger',
        roomKey: 'circle:7',
        circleId: 7,
        draftPostId: 42,
        triggerReason: 'focused_discussion',
        summaryMethod: 'rule',
        summaryHash: 'b'.repeat(64),
        messagesDigest,
        messageCount: messages.length,
        fromLamport: '100',
        toLamport: '100',
        generatedAt: '2026-03-13T12:00:00.000Z',
        messages,
    };
    const payloadHash = sha256Hex(stableStringify(payload));

    return {
        anchorId: payloadHash,
        circleId: payload.circleId,
        draftPostId: payload.draftPostId,
        roomKey: payload.roomKey,
        triggerReason: payload.triggerReason,
        summaryHash: payload.summaryHash,
        messagesDigest: payload.messagesDigest,
        payloadHash,
        canonicalPayload: payload,
        messageCount: payload.messageCount,
        fromLamport: payload.fromLamport,
        toLamport: payload.toLamport,
        chain: 'solana:localnet',
        memoText: `anchor:${payloadHash}:summary:${payload.summaryHash}:digest:${payload.messagesDigest}`,
        txSignature: '3'.repeat(88),
        txSlot: '123',
        status,
        errorMessage: null,
        createdAt: '2026-03-13T12:00:00.000Z',
        anchoredAt: status === 'anchored' ? '2026-03-13T12:00:01.000Z' : null,
        updatedAt: '2026-03-13T12:00:01.000Z',
    };
}

describe('draftAnchor', () => {
    test('treats pending anchors as non-verifiable for contributor-proof usage', () => {
        const proof = verifyDraftAnchor(buildRecord('pending'));
        expect(proof.verifiable).toBe(false);
    });

    test('accepts anchored records when canonical payload and memo all match', () => {
        const proof = verifyDraftAnchor(buildRecord('anchored'));
        expect(proof.verifiable).toBe(true);
    });
});
