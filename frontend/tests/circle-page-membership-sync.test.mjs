import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
process.env.TS_NODE_PROJECT = path.join(frontendRoot, 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'commonjs',
  moduleResolution: 'node',
  allowImportingTsExtensions: true,
});

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { startMembershipRefresh } = require('../src/lib/circle/membershipRefresh.ts');
const {
  deriveCreatorFallbackMembershipSnapshot,
  deriveIdentityStatusFallbackMembershipSnapshot,
} = require('../src/lib/circle/membershipState.ts');

const circlePageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8',
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('membership refresh clears route state before the replacement request resolves', async () => {
  const state = {
    snapshot: { joinState: 'joined' },
    status: { currentLevel: 'Member' },
  };
  const nextSnapshot = deferred();
  const nextStatus = deferred();

  startMembershipRefresh({
    circleId: 26,
    reset: () => {
      state.snapshot = null;
      state.status = null;
    },
    fetchSnapshot: async () => nextSnapshot.promise,
    fetchStatus: async () => nextStatus.promise,
    apply: ({ snapshot, status }) => {
      state.snapshot = snapshot;
      state.status = status;
    },
  });

  assert.equal(state.snapshot, null);
  assert.equal(state.status, null);

  nextSnapshot.resolve({ joinState: 'can_join' });
  nextStatus.resolve({ currentLevel: 'Visitor' });
  await Promise.all([nextSnapshot.promise, nextStatus.promise]);
  await flushMicrotasks();

  assert.deepEqual(state.snapshot, { joinState: 'can_join' });
  assert.deepEqual(state.status, { currentLevel: 'Visitor' });
});

test('membership refresh ignores late responses from an abandoned request', async () => {
  const state = {
    snapshot: { joinState: 'joined' },
    status: { currentLevel: 'Member' },
  };
  const firstSnapshot = deferred();
  const firstStatus = deferred();
  const secondSnapshot = deferred();
  const secondStatus = deferred();

  const cancelFirst = startMembershipRefresh({
    circleId: 26,
    reset: () => {
      state.snapshot = null;
      state.status = null;
    },
    fetchSnapshot: async () => firstSnapshot.promise,
    fetchStatus: async () => firstStatus.promise,
    apply: ({ snapshot, status }) => {
      state.snapshot = snapshot;
      state.status = status;
    },
  });

  cancelFirst();

  startMembershipRefresh({
    circleId: 27,
    reset: () => {
      state.snapshot = null;
      state.status = null;
    },
    fetchSnapshot: async () => secondSnapshot.promise,
    fetchStatus: async () => secondStatus.promise,
    apply: ({ snapshot, status }) => {
      state.snapshot = snapshot;
      state.status = status;
    },
  });

  firstSnapshot.resolve({ joinState: 'joined' });
  firstStatus.resolve({ currentLevel: 'Owner' });
  secondSnapshot.resolve(null);
  secondStatus.resolve(null);
  await Promise.all([
    firstSnapshot.promise,
    firstStatus.promise,
    secondSnapshot.promise,
    secondStatus.promise,
  ]);
  await flushMicrotasks();

  assert.equal(state.snapshot, null);
  assert.equal(state.status, null);
});

test('circle page refreshes route membership after identity session resolves', () => {
  assert.match(circlePageSource, /startMembershipRefresh\(\{\s*circleId,/s);
  assert.match(circlePageSource, /fetchSnapshot: fetchCircleMembershipState,/);
  assert.match(circlePageSource, /fetchStatus: fetchCircleIdentityStatus,/);
  assert.match(circlePageSource, /\[\s*circleId,\s*publicKey,\s*identityState,\s*sessionUser\?\.id\s*\]/);
});

test('circle page clears stale route membership snapshots when refreshed state falls back to guest', () => {
  assert.match(
    circlePageSource,
    /startMembershipRefresh\(\{\s*circleId,\s*reset: \(\) => \{\s*setMembershipSnapshot\(null\);\s*setIdentityStatus\(null\);/s,
  );
  assert.match(
    circlePageSource,
    /apply: \(\{ snapshot, status,[\s\S]*? \}\) => \{\s*setMembershipSnapshot\(snapshot\);\s*setIdentityStatus\(status\);/s,
  );
});

test('circle page still renders join banner fallback while membership snapshot is unavailable', () => {
  assert.match(
    circlePageSource,
    /\{\(!activeCircleMembershipSnapshot \|\| activeCircleMembershipSnapshot\.joinState !== 'joined'\) && \(/,
  );
});

test('circle page routes unresolved connected guests to identity creation instead of blind join', () => {
  assert.match(
    circlePageSource,
    /let effectiveSnapshot = targetSnapshot;\s*if \(!effectiveSnapshot\) \{\s*if \(identityState === 'unregistered'\) \{\s*setShowRegisterIdentitySheet\(true\);\s*return;\s*\}/s,
  );
});

test('circle page retries identity session recovery when join banner is clicked from session error state', () => {
  assert.match(
    circlePageSource,
    /if \(!effectiveSnapshot\) \{\s*if \(identityState === 'unregistered'\) \{\s*setShowRegisterIdentitySheet\(true\);\s*return;\s*\}\s*setJoinActionLoading\(true\);\s*setJoinActionError\(null\);\s*try \{\s*if \(identityState === 'session_error' \|\| identityState === 'connecting_session'\) \{\s*await refreshIdentityState\(\);/s,
  );
});

test('circle page re-fetches membership when a connected registered viewer clicks the unresolved join banner state', () => {
  assert.match(
    circlePageSource,
    /let effectiveSnapshot = targetSnapshot;\s*if \(!effectiveSnapshot\) \{\s*if \(identityState === 'unregistered'\)[\s\S]*?setJoinActionLoading\(true\);\s*setJoinActionError\(null\);\s*try \{\s*if \(identityState === 'session_error' \|\| identityState === 'connecting_session'\) \{\s*await refreshIdentityState\(\);\s*\}\s*const \[snap, status\] = await Promise\.all\(\[[\s\S]*?effectiveSnapshot = snap;/s,
  );
});

test('creator fallback snapshot restores owner membership when graph data proves the viewer owns the active circle', () => {
  const snapshot = deriveCreatorFallbackMembershipSnapshot({
    snapshot: null,
    circleId: 26,
    circleCreatorId: 4,
    circleCreatorPubkey: 'Creator1111111111111111111111111111111111111',
    circleCreatedAt: '2026-03-01T10:00:00.000Z',
    sessionUserId: 4,
    walletPubkey: null,
  });

  assert.deepEqual(snapshot, {
    authenticated: true,
    circleId: 26,
    policy: {
      joinRequirement: 'Free',
      circleType: 'Open',
      minCrystals: 0,
      requiresApproval: false,
      requiresInvite: false,
    },
    joinState: 'joined',
    membership: {
      role: 'Owner',
      status: 'Active',
      identityLevel: 'Member',
      joinedAt: '2026-03-01T10:00:00.000Z',
    },
    userCrystals: 0,
    missingCrystals: 0,
  });
});

test('creator fallback does not fabricate membership for non-owners', () => {
  const snapshot = deriveCreatorFallbackMembershipSnapshot({
    snapshot: null,
    circleId: 26,
    circleCreatorId: 4,
    circleCreatorPubkey: 'Creator1111111111111111111111111111111111111',
    circleCreatedAt: '2026-03-01T10:00:00.000Z',
    sessionUserId: 7,
    walletPubkey: 'Other11111111111111111111111111111111111111',
  });

  assert.equal(snapshot, null);
});

test('creator fallback restores owner membership when wallet pubkey matches the graph creator before session user converges', () => {
  const snapshot = deriveCreatorFallbackMembershipSnapshot({
    snapshot: null,
    circleId: 110,
    circleCreatorId: 1,
    circleCreatorPubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
    circleCreatedAt: '2026-04-10T22:11:01.000Z',
    sessionUserId: null,
    walletPubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
  });

  assert.equal(snapshot?.joinState, 'joined');
  assert.equal(snapshot?.membership?.role, 'Owner');
  assert.equal(snapshot?.membership?.identityLevel, 'Member');
});

test('identity-status fallback restores a joined formal shell when membership projection is temporarily unavailable', () => {
  const snapshot = deriveIdentityStatusFallbackMembershipSnapshot({
    snapshot: null,
    circleId: 26,
    circleCreatedAt: '2026-03-01T10:00:00.000Z',
    status: {
      authenticated: true,
      circleId: 26,
      currentLevel: 'Initiate',
      nextLevel: 'Member',
      messagingMode: 'formal',
      hint: 'Need 2 citations to become a member.',
      thresholds: {
        initiateMessages: 3,
        memberCitations: 2,
        elderPercentile: 10,
        inactivityDays: 30,
      },
      transition: null,
      recentTransition: null,
      history: [],
      progress: {
        messageCount: 0,
        citationCount: 0,
        reputationScore: 0,
        reputationPercentile: 50,
        daysSinceActive: 1,
      },
    },
  });

  assert.deepEqual(snapshot, {
    authenticated: true,
    circleId: 26,
    policy: {
      joinRequirement: 'Free',
      circleType: 'Open',
      minCrystals: 0,
      requiresApproval: false,
      requiresInvite: false,
    },
    joinState: 'joined',
    membership: {
      role: 'Member',
      status: 'Active',
      identityLevel: 'Initiate',
      joinedAt: '2026-03-01T10:00:00.000Z',
    },
    userCrystals: 0,
    missingCrystals: 0,
  });
});

test('identity-status fallback does not fabricate joined membership for dust-only visitors', () => {
  const snapshot = deriveIdentityStatusFallbackMembershipSnapshot({
    snapshot: null,
    circleId: 26,
    circleCreatedAt: '2026-03-01T10:00:00.000Z',
    status: {
      authenticated: true,
      circleId: 26,
      currentLevel: 'Visitor',
      nextLevel: 'Initiate',
      messagingMode: 'dust_only',
      hint: 'Post 3 ephemeral messages to become an initiate.',
      thresholds: {
        initiateMessages: 3,
        memberCitations: 2,
        elderPercentile: 10,
        inactivityDays: 30,
      },
      transition: null,
      recentTransition: null,
      history: [],
      progress: {
        messageCount: 0,
        citationCount: 0,
        reputationScore: 0,
        reputationPercentile: 50,
        daysSinceActive: 1,
      },
    },
  });

  assert.equal(snapshot, null);
});
