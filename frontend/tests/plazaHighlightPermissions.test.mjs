import test from 'node:test';
import assert from 'node:assert/strict';

import { canHighlightPlazaMessage } from '../src/lib/circle/plazaHighlightPermissions.ts';

test('allows highlighting another active message once', () => {
    assert.equal(
        canHighlightPlazaMessage({
            messageId: 10,
            highlightedIds: new Set(),
            walletPubkey: 'viewer_pubkey',
            senderPubkey: 'author_pubkey',
            deleted: false,
        }),
        true,
    );
});

test('blocks highlighting own message', () => {
    assert.equal(
        canHighlightPlazaMessage({
            messageId: 10,
            highlightedIds: new Set(),
            walletPubkey: 'same_pubkey',
            senderPubkey: 'same_pubkey',
            deleted: false,
        }),
        false,
    );
});

test('blocks repeated highlight from same client state', () => {
    assert.equal(
        canHighlightPlazaMessage({
            messageId: 10,
            highlightedIds: new Set([10]),
            walletPubkey: 'viewer_pubkey',
            senderPubkey: 'author_pubkey',
            deleted: false,
        }),
        false,
    );
});

test('blocks deleted message highlight', () => {
    assert.equal(
        canHighlightPlazaMessage({
            messageId: 10,
            highlightedIds: new Set(),
            walletPubkey: 'viewer_pubkey',
            senderPubkey: 'author_pubkey',
            deleted: true,
        }),
        false,
    );
});

test('blocks ephemeral message highlight', () => {
    assert.equal(
        canHighlightPlazaMessage({
            messageId: 10,
            highlightedIds: new Set(),
            walletPubkey: 'viewer_pubkey',
            senderPubkey: 'author_pubkey',
            deleted: false,
            ephemeral: true,
        }),
        false,
    );
});

test('blocks highlight when viewer has no wallet session', () => {
    assert.equal(
        canHighlightPlazaMessage({
            messageId: 10,
            highlightedIds: new Set(),
            walletPubkey: null,
            senderPubkey: 'author_pubkey',
            deleted: false,
        }),
        false,
    );
});
