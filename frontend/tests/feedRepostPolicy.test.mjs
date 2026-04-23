import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveFeedRepostMembershipPending,
  resolveFeedRepostState,
} from '../src/lib/feed/repostState.ts';

const circlesPageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8',
);
const feedTabSource = readFileSync(
  new URL('../src/components/circle/FeedTab/FeedTab.tsx', import.meta.url),
  'utf8',
);

test('regular feed posts can be reposted when not pending', () => {
  const state = resolveFeedRepostState({
    isRepost: false,
    walletConnected: true,
    canPublish: true,
    pending: false,
  });

  assert.equal(state.disabled, false);
  assert.equal(state.reason, null);
});

test('reposts cannot be reposted again', () => {
  const state = resolveFeedRepostState({
    isRepost: true,
    walletConnected: true,
    canPublish: true,
    pending: false,
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason, 'already_reposted');
});

test('pending repost stays disabled without introducing forwarding ui state', () => {
  const state = resolveFeedRepostState({
    isRepost: false,
    walletConnected: true,
    canPublish: true,
    pending: true,
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason, 'pending');
  assert.equal('targetCircleId' in state, false);
});

test('connected guests still cannot repost into the current circle', () => {
  const state = resolveFeedRepostState({
    isRepost: false,
    walletConnected: true,
    canPublish: false,
    pending: false,
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason, 'join_circle');
});

test('pending membership keeps repost disabled with a dedicated review-state reason', () => {
  const state = resolveFeedRepostState({
    isRepost: false,
    walletConnected: true,
    canPublish: false,
    pending: false,
    membershipPending: true,
  });

  assert.equal(state.disabled, true);
  assert.equal(state.reason, 'pending_membership');
});

test('pending membership can still be derived from the join banner when the snapshot is stale', () => {
  const pending = deriveFeedRepostMembershipPending({
    joinState: 'can_join',
    joinBannerHint: 'Your join request is waiting for review.',
    pendingMembershipHint: 'Your join request is waiting for review.',
  });

  assert.equal(pending, true);
});

test('pending membership derivation tolerates cosmetic punctuation drift in the join banner hint', () => {
  const pending = deriveFeedRepostMembershipPending({
    joinState: 'can_join',
    joinBannerHint: 'Your join request is waiting for review',
    pendingMembershipHint: 'Your join request is waiting for review.',
  });

  assert.equal(pending, true);
});

test('circle feed wiring uses the derived pending-membership gate instead of only checking snapshot.joinState', () => {
  assert.match(circlesPageSource, /const repostMembershipPending = useMemo\(\(\) => deriveFeedRepostMembershipPending\(/);
  assert.match(circlesPageSource, /repostMembershipPending=\{repostMembershipPending\}/);
  assert.doesNotMatch(circlesPageSource, /repostMembershipPending=\{activeCircleMembershipSnapshot\?\.joinState === 'pending'\}/);
});

test('feed repost cards hide synthetic repost uri bodies from the visible post text', () => {
  assert.match(feedTabSource, /content:\\\/\\\/repost\\\//);
  assert.match(feedTabSource, /visiblePostText/);
  assert.match(feedTabSource, /isSyntheticRepostText/);
});
