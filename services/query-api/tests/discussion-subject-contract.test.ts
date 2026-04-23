import {
    buildDiscussionSigningMessage,
    buildDiscussionSigningPayload,
    computeDiscussionEnvelopeId,
} from '../src/services/offchainDiscussion';

describe('discussion subject contract', () => {
    test('includes optional knowledge subject in canonical signing payload', () => {
        const payload = buildDiscussionSigningPayload({
            roomKey: 'circle:7',
            circleId: 7,
            senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
            text: 'Crystal thread message',
            clientTimestamp: '2026-03-01T12:00:00.000Z',
            nonce: 'abc123',
            subjectType: 'knowledge',
            subjectId: 'knowledge-9',
        });

        expect(payload).toMatchObject({
            subjectType: 'knowledge',
            subjectId: 'knowledge-9',
        });
        expect(buildDiscussionSigningMessage(payload)).toContain('"subjectType":"knowledge"');
        expect(buildDiscussionSigningMessage(payload)).toContain('"subjectId":"knowledge-9"');
    });

    test('changes envelope id when the subject changes', () => {
        const baseInput = {
            roomKey: 'circle:7',
            senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
            payloadHash: 'f'.repeat(64),
            clientTimestamp: '2026-03-01T12:00:00.000Z',
            nonce: 'abc123',
        };

        const genericId = computeDiscussionEnvelopeId(baseInput);
        const knowledgeId = computeDiscussionEnvelopeId({
            ...baseInput,
            subjectType: 'knowledge',
            subjectId: 'knowledge-9',
        });

        expect(knowledgeId).not.toBe(genericId);
    });

    test('rejects unsupported subject types', () => {
        expect(() => buildDiscussionSigningPayload({
            roomKey: 'circle:7',
            circleId: 7,
            senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
            text: 'Crystal thread message',
            clientTimestamp: '2026-03-01T12:00:00.000Z',
            nonce: 'abc123',
            subjectType: 'draft',
            subjectId: 'draft-42',
        } as any)).toThrow('invalid_discussion_subject');
    });

    test('requires subject id when subject type is knowledge', () => {
        expect(() => buildDiscussionSigningPayload({
            roomKey: 'circle:7',
            circleId: 7,
            senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
            text: 'Crystal thread message',
            clientTimestamp: '2026-03-01T12:00:00.000Z',
            nonce: 'abc123',
            subjectType: 'knowledge',
            subjectId: '   ',
        } as any)).toThrow('invalid_discussion_subject');
    });
});
