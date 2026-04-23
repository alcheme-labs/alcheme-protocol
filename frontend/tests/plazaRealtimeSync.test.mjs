import test from 'node:test';
import assert from 'node:assert/strict';

import {
    appendPlazaDiscussionMessages,
    mergePlazaDiscussionMessages,
    pruneExpiredEphemeralMessages,
    refreshPlazaMessagesByEnvelope,
    syncPlazaDiscussionMessages,
} from '../src/lib/circle/plazaDiscussion.ts';

function createMessage(overrides = {}) {
    return {
        id: 1,
        author: 'alice',
        text: 'hello',
        time: 'now',
        ephemeral: false,
        highlights: 0,
        sendState: 'sent',
        envelopeId: 'env-1',
        semanticFacets: [],
        ...overrides,
    };
}

test('sync keeps the same array when the server snapshot is unchanged', () => {
    const current = [
        createMessage({ id: 1, envelopeId: 'env-1', text: 'hello' }),
        createMessage({ id: 2, envelopeId: 'env-2', text: 'world' }),
    ];
    const server = [
        createMessage({ id: 1, envelopeId: 'env-1', text: 'hello' }),
        createMessage({ id: 2, envelopeId: 'env-2', text: 'world' }),
    ];

    const next = syncPlazaDiscussionMessages({
        currentMessages: current,
        serverMessages: server,
    });

    assert.strictEqual(next, current);
    assert.strictEqual(next[0], current[0]);
    assert.strictEqual(next[1], current[1]);
});

test('sync preserves object identity for unchanged messages when one server message changes', () => {
    const unchanged = createMessage({ id: 1, envelopeId: 'env-1', text: 'hello' });
    const changed = createMessage({ id: 2, envelopeId: 'env-2', text: 'old' });
    const current = [unchanged, changed];
    const server = [
        createMessage({ id: 1, envelopeId: 'env-1', text: 'hello' }),
        createMessage({ id: 2, envelopeId: 'env-2', text: 'new' }),
    ];

    const next = syncPlazaDiscussionMessages({
        currentMessages: current,
        serverMessages: server,
    });

    assert.strictEqual(next[0], unchanged);
    assert.notStrictEqual(next[1], changed);
    assert.equal(next[1].text, 'new');
});

test('merge keeps optimistic unsent messages', () => {
    const merged = mergePlazaDiscussionMessages({
        serverMessages: [createMessage({ id: 1, envelopeId: 'env-1', text: 'persisted' })],
        optimisticMessages: [
            createMessage({
                id: 99,
                envelopeId: undefined,
                sendState: 'pending',
                text: 'pending local',
            }),
        ],
    });

    assert.equal(merged.length, 2);
    assert.equal(merged[1].text, 'pending local');
    assert.equal(merged[1].sendState, 'pending');
});

test('append merges afterLamport increments without dropping optimistic messages', () => {
    const current = [
        createMessage({ id: 1, envelopeId: 'env-1', text: 'persisted one' }),
        createMessage({ id: 99, envelopeId: undefined, sendState: 'pending', text: 'pending local' }),
    ];

    const next = appendPlazaDiscussionMessages({
        currentMessages: current,
        appendedMessages: [
            createMessage({ id: 2, envelopeId: 'env-2', text: 'persisted two' }),
        ],
    });

    assert.deepEqual(next.map((message) => message.text), [
        'persisted one',
        'persisted two',
        'pending local',
    ]);
    assert.strictEqual(next[0], current[0]);
});

test('targeted refresh only replaces the affected message', () => {
    const unchanged = createMessage({ id: 1, envelopeId: 'env-1', text: 'hello' });
    const target = createMessage({ id: 2, envelopeId: 'env-2', text: 'before', highlights: 0 });
    const current = [unchanged, target];

    const next = refreshPlazaMessagesByEnvelope({
        currentMessages: current,
        refreshedMessages: [
            createMessage({ id: 2, envelopeId: 'env-2', text: 'before', highlights: 2 }),
        ],
    });

    assert.strictEqual(next[0], unchanged);
    assert.notStrictEqual(next[1], target);
    assert.equal(next[1].highlights, 2);
});

test('targeted refresh keeps the same array when nothing actually changes', () => {
    const current = [
        createMessage({ id: 1, envelopeId: 'env-1', text: 'hello', highlights: 2 }),
    ];

    const next = refreshPlazaMessagesByEnvelope({
        currentMessages: current,
        refreshedMessages: [
            createMessage({ id: 1, envelopeId: 'env-1', text: 'hello', highlights: 2 }),
        ],
    });

    assert.strictEqual(next, current);
});

test('expired ephemeral messages disappear without waiting for a new server event', () => {
    const next = pruneExpiredEphemeralMessages({
        messages: [
            createMessage({
                id: 1,
                envelopeId: 'env-1',
                text: 'expired',
                ephemeral: true,
                metadata: { expiresAt: '2026-04-08T15:00:00.000Z' },
            }),
            createMessage({
                id: 2,
                envelopeId: 'env-2',
                text: 'still visible',
                ephemeral: true,
                metadata: { expiresAt: '2026-04-08T17:00:00.000Z' },
            }),
        ],
        now: new Date('2026-04-08T16:00:00.000Z'),
    });

    assert.deepEqual(next.map((message) => message.envelopeId), ['env-2']);
});

test('ephemeral pruning keeps the same array when nothing has expired yet', () => {
    const current = [
        createMessage({
            id: 2,
            envelopeId: 'env-2',
            text: 'still visible',
            ephemeral: true,
            metadata: { expiresAt: '2026-04-08T17:00:00.000Z' },
        }),
    ];

    const next = pruneExpiredEphemeralMessages({
        messages: current,
        now: new Date('2026-04-08T16:00:00.000Z'),
    });

    assert.strictEqual(next, current);
});
