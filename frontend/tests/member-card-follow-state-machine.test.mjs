import test from 'node:test';
import assert from 'node:assert/strict';

import {
    beginFollowWrite,
    canStartFollowWrite,
    completeFollowWrite,
    createPendingFollowState,
    markPendingFollowIndexed,
    markPendingFollowIndexTimeout,
    normalizeFollowTargetPubkey,
    resolveFollowStateFromServer,
    shouldClearPendingFollow,
} from '../src/lib/follow/stateMachine.ts';

test('single-flight gate accepts only one follow write while request is in-flight', () => {
    let inFlightUserId = null;
    let writeCount = 0;

    if (canStartFollowWrite(inFlightUserId)) {
        inFlightUserId = beginFollowWrite(7);
        writeCount += 1;
    }

    if (canStartFollowWrite(inFlightUserId)) {
        inFlightUserId = beginFollowWrite(7);
        writeCount += 1;
    }

    assert.equal(writeCount, 1);

    inFlightUserId = completeFollowWrite(inFlightUserId, 7);
    assert.equal(inFlightUserId, null);
    assert.equal(canStartFollowWrite(inFlightUserId), true);
});

test('pending follow overlay keeps optimistic state and prevents rollback flicker', () => {
    const pending = createPendingFollowState(7, true, 1_000);

    const resolved = resolveFollowStateFromServer({
        serverViewerFollows: false,
        pendingState: pending,
        nowMs: 2_000,
    });

    assert.deepEqual(resolved, {
        viewerFollows: true,
        syncing: true,
        indexTimeout: false,
        pendingActive: true,
    });
});

test('index timeout keeps pending within recovery window and clears after timeout window', () => {
    const pending = createPendingFollowState(7, true, 1_000);
    const timeoutPending = markPendingFollowIndexTimeout(pending, 2_000);

    const duringWindow = resolveFollowStateFromServer({
        serverViewerFollows: false,
        pendingState: timeoutPending,
        nowMs: timeoutPending.expiresAt - 1,
    });

    assert.equal(duringWindow.viewerFollows, true);
    assert.equal(duringWindow.indexTimeout, true);
    assert.equal(shouldClearPendingFollow(timeoutPending, false, timeoutPending.expiresAt - 1), false);

    const afterWindow = resolveFollowStateFromServer({
        serverViewerFollows: false,
        pendingState: timeoutPending,
        nowMs: timeoutPending.expiresAt + 1,
    });

    assert.equal(afterWindow.viewerFollows, false);
    assert.equal(afterWindow.pendingActive, false);
    assert.equal(shouldClearPendingFollow(timeoutPending, false, timeoutPending.expiresAt + 1), true);
});

test('indexed follow keeps optimistic state visible until read model confirms it', () => {
    const pending = createPendingFollowState(7, true, 1_000);
    const indexedPending = markPendingFollowIndexed(pending, 2_000);

    const resolved = resolveFollowStateFromServer({
        serverViewerFollows: false,
        pendingState: indexedPending,
        nowMs: 3_000,
    });

    assert.deepEqual(resolved, {
        viewerFollows: true,
        syncing: false,
        indexTimeout: false,
        pendingActive: true,
    });
    assert.equal(shouldClearPendingFollow(indexedPending, false, 3_000), false);
});

test('missing target pubkey is normalized to null and should not trigger write path', () => {
    assert.equal(normalizeFollowTargetPubkey(''), null);
    assert.equal(normalizeFollowTargetPubkey('   '), null);
    assert.equal(normalizeFollowTargetPubkey(undefined), null);
    assert.equal(normalizeFollowTargetPubkey('TargetPubkey11111111111111111111111111111'), 'TargetPubkey11111111111111111111111111111');
});
