import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveFeedLikeState } from '../src/lib/feed/likeState.ts';

test('unliked feed post stays inactive and clickable', () => {
    const state = resolveFeedLikeState({
        likes: 4,
        liked: false,
        pendingLike: false,
    });

    assert.deepEqual(state, {
        likes: 4,
        active: false,
        disabled: false,
    });
});

test('pending like is optimistic and non-destructive', () => {
    const state = resolveFeedLikeState({
        likes: 4,
        liked: false,
        pendingLike: true,
    });

    assert.deepEqual(state, {
        likes: 5,
        active: true,
        disabled: true,
    });
});

test('persisted like stays active without double increment', () => {
    const state = resolveFeedLikeState({
        likes: 5,
        liked: true,
        pendingLike: false,
    });

    assert.deepEqual(state, {
        likes: 5,
        active: true,
        disabled: true,
    });
});

test('pending state does not double count an already liked post', () => {
    const state = resolveFeedLikeState({
        likes: 5,
        liked: true,
        pendingLike: true,
    });

    assert.deepEqual(state, {
        likes: 5,
        active: true,
        disabled: true,
    });
});
