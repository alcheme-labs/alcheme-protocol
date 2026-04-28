import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canManageCircleAgents,
  deriveCreatorFallbackMembershipSnapshot,
  deriveIdentityStatusFallbackMembershipSnapshot,
  resolveActiveMembershipSnapshot,
  deriveViewerCircleState,
} from '../src/lib/circle/membershipState.ts';
import { fetchCircleIdentityStatus } from '../src/lib/api/circlesMembership.ts';

const membershipApiSource = readFileSync(
  new URL('../src/lib/api/circlesMembership.ts', import.meta.url),
  'utf8',
);
const providersSource = readFileSync(
  new URL('../src/app/providers.tsx', import.meta.url),
  'utf8',
);
const apiFetchSource = readFileSync(
  new URL('../src/lib/api/fetch.ts', import.meta.url),
  'utf8',
);

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

test('REST requests carry the active UI locale through the shared API fetch helper', () => {
  assert.doesNotMatch(providersSource, /installRequestLocaleFetchInterceptor/);
  assert.doesNotMatch(apiFetchSource, /window\.fetch\s*=/);
  assert.match(apiFetchSource, /REQUEST_LOCALE_HEADER/);
  assert.match(apiFetchSource, /let activeRequestLocale: AppLocale \| null = null/);
  assert.match(apiFetchSource, /apiFetchJson/);
  assert.match(membershipApiSource, /fetchCircleIdentityStatus\(\s*circleId: number,/);
  assert.match(membershipApiSource, /apiFetchJson\(input,\s*\{\s*init,/);
  assert.match(membershipApiSource, /fetchImpl: options\.fetchImpl/);
  assert.match(membershipApiSource, /locale: options\.locale/);
  assert.doesNotMatch(membershipApiSource, /searchParams\.set\('locale', locale\)/);
});

test('fetchCircleIdentityStatus sends the resolved UI locale on the actual REST request', async () => {
  const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      documentElement: {
        lang: 'en-US',
      },
      cookie: '',
    },
  });

  const requests = [];

  try {
    const result = await fetchCircleIdentityStatus(7, {
      fetchImpl: async (input, init) => {
        const url = String(input);
        requests.push({ url, init });

        if (url.endsWith('/api/v1/extensions/capabilities')) {
          return new Response(JSON.stringify({ generatedAt: '2026-04-28T00:00:00.000Z', capabilities: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({
          authenticated: true,
          circleId: 7,
          currentLevel: 'Visitor',
          nextLevel: 'Initiate',
          messagingMode: 'formal',
          hint: 'Send 3 messages to become an initiate.',
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
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const identityRequest = requests.find((request) => request.url.endsWith('/api/v1/membership/circles/7/identity-status'));
    assert.equal(result.circleId, 7);
    assert.ok(identityRequest, 'identity-status request was not sent');
    assert.equal(new Headers(identityRequest.init.headers).get('x-alcheme-locale'), 'en');
    assert.equal(identityRequest.init.credentials, 'include');
  } finally {
    if (originalDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
    } else {
      delete globalThis.document;
    }
  }
});
