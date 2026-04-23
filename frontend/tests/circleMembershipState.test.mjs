import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canManageCircleAgents,
  deriveCreatorFallbackMembershipSnapshot,
  deriveIdentityStatusFallbackMembershipSnapshot,
  resolveActiveMembershipSnapshot,
  deriveViewerCircleState,
} from '../src/lib/circle/membershipState.ts';

const routeSnapshot = {
  authenticated: true,
  circleId: 1,
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
    identityLevel: 'Member',
    joinedAt: '2026-03-02T10:00:00.000Z',
  },
  userCrystals: 0,
  missingCrystals: 0,
};

test('active tier snapshot wins over route snapshot for sub-circle context', () => {
  const activeTierSnapshot = {
    ...routeSnapshot,
    circleId: 2,
    joinState: 'guest',
    membership: null,
  };

  const resolved = resolveActiveMembershipSnapshot({
    routeCircleId: 1,
    activeCircleId: 2,
    routeSnapshot,
    activeTierSnapshot,
  });

  assert.equal(resolved?.circleId, 2);
  assert.equal(resolved?.joinState, 'guest');
});

test('viewer state only uses snapshot membership and does not fall back to directory data', () => {
  const resolved = deriveViewerCircleState({
    snapshot: {
      ...routeSnapshot,
      joinState: 'guest',
      membership: null,
    },
  });

  assert.equal(resolved.joined, false);
  assert.equal(resolved.identityState, 'visitor');
  assert.equal(resolved.membership, null);
});

test('joined snapshot produces member identity state', () => {
  const resolved = deriveViewerCircleState({ snapshot: routeSnapshot });

  assert.equal(resolved.joined, true);
  assert.equal(resolved.identityState, 'member');
  assert.equal(resolved.membership?.role, 'Member');
});

test('initiate snapshot maps to initiate identity state', () => {
  const resolved = deriveViewerCircleState({
    snapshot: {
      ...routeSnapshot,
      membership: {
        ...routeSnapshot.membership,
        identityLevel: 'Initiate',
      },
    },
  });

  assert.equal(resolved.identityState, 'initiate');
});

test('formal identity status overrides stale guest shell snapshots', () => {
  const resolved = deriveIdentityStatusFallbackMembershipSnapshot({
    snapshot: {
      ...routeSnapshot,
      authenticated: false,
      joinState: 'guest',
      membership: null,
    },
    circleId: 1,
    circleCreatedAt: '2026-03-02T10:00:00.000Z',
    status: {
      authenticated: true,
      circleId: 1,
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

  assert.equal(resolved?.joinState, 'joined');
  assert.equal(resolved?.membership?.identityLevel, 'Initiate');
});

test('formal identity status does not override real pending membership gates', () => {
  const resolved = deriveIdentityStatusFallbackMembershipSnapshot({
    snapshot: {
      ...routeSnapshot,
      joinState: 'pending',
      membership: null,
    },
    circleId: 1,
    circleCreatedAt: '2026-03-02T10:00:00.000Z',
    status: {
      authenticated: true,
      circleId: 1,
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

  assert.equal(resolved?.joinState, 'pending');
  assert.equal(resolved?.membership, null);
});

test('creator fallback can trust the connected wallet pubkey when the graph proves the viewer owns the circle', () => {
  const resolved = deriveCreatorFallbackMembershipSnapshot({
    snapshot: null,
    circleId: 110,
    circleCreatorId: 1,
    circleCreatorPubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
    circleCreatedAt: '2026-04-10T22:11:01.000Z',
    sessionUserId: null,
    walletPubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
  });

  assert.equal(resolved?.joinState, 'joined');
  assert.equal(resolved?.membership?.role, 'Owner');
});

test('agent admin access is limited to active owner, admin, and moderator memberships', () => {
  assert.equal(canManageCircleAgents({snapshot: routeSnapshot}), false);

  assert.equal(
    canManageCircleAgents({
      snapshot: {
        ...routeSnapshot,
        membership: {
          ...routeSnapshot.membership,
          role: 'Owner',
        },
      },
    }),
    true,
  );

  assert.equal(
    canManageCircleAgents({
      snapshot: {
        ...routeSnapshot,
        membership: {
          ...routeSnapshot.membership,
          role: 'Admin',
        },
      },
    }),
    true,
  );

  assert.equal(
    canManageCircleAgents({
      snapshot: {
        ...routeSnapshot,
        membership: {
          ...routeSnapshot.membership,
          role: 'Moderator',
        },
      },
    }),
    true,
  );

  assert.equal(
    canManageCircleAgents({
      snapshot: {
        ...routeSnapshot,
        membership: {
          ...routeSnapshot.membership,
          role: 'Admin',
          status: 'Left',
        },
      },
    }),
    false,
  );
});
