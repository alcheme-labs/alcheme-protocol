import test from 'node:test';
import assert from 'node:assert/strict';
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

const { resolveCircleJoinBannerState } = require('../src/lib/circle/joinBanner.ts');
const { validateIdentityHandle } = require('../src/lib/identity/handle.ts');

function createJoinCopy() {
  return {
    button: {
      join: 'Join circle',
      createIdentity: 'Create identity',
      joined: 'Joined',
      pending: 'Pending',
      approvalRequired: 'Request access',
      inviteRequired: 'Invite required',
      crystalRequirement: ({ missingCrystals }) => `${missingCrystals} crystals needed`,
      restricted: 'Restricted',
      rejoin: 'Rejoin',
    },
    hint: {
      visitorDefault: 'Visitors can post ephemeral messages.',
      createIdentity: 'Create an identity before joining this circle.',
      pending: 'Your join request is pending.',
      approvalRequired: 'This circle requires approval.',
      inviteRequired: 'This circle is invite-only.',
      insufficientCrystals: ({ required, current }) => `Need ${required}, current ${current}.`,
      banned: 'Your access to this circle is restricted.',
    },
    errors: {
      walletRequired: 'Connect your identity before joining the circle.',
      inviteRequired: 'This circle is invite-only.',
      insufficientCrystals: 'You do not have enough crystals to join yet.',
      banned: 'Your access to this circle is currently restricted.',
      requestStateChanged: 'That request state changed. Refresh and try again.',
      fallback: 'Could not join the circle. Please try again.',
    },
  };
}

test('wallet disconnected keeps connect-wallet intent', () => {
  const state = resolveCircleJoinBannerState(null, false, createJoinCopy(), {
    connectWallet: 'Connect wallet',
    connectWalletHint: 'Connect your wallet before joining this circle.',
    registerIdentity: 'Create identity',
    registerIdentityHint: 'Create an identity before joining this circle.',
    retrySession: 'Retry',
    retrySessionHint: 'We could not confirm your identity state. Please try again.',
    unresolvedMembershipLabel: 'Working…',
    unresolvedMembershipHint: 'Checking your circle access.',
  });
  assert.equal(state.action, 'connect_wallet');
  assert.equal(state.label, 'Connect wallet');
});

test('wallet connected but unresolved unregistered identity still prompts identity creation', () => {
  const state = resolveCircleJoinBannerState(null, true, createJoinCopy(), {
    connectWallet: 'Connect wallet',
    connectWalletHint: 'Connect your wallet before joining this circle.',
    registerIdentity: 'Create identity',
    registerIdentityHint: 'Create an identity before joining this circle.',
    retrySession: 'Retry',
    retrySessionHint: 'We could not confirm your identity state. Please try again.',
    unresolvedMembershipLabel: 'Working…',
    unresolvedMembershipHint: 'Checking your circle access.',
  }, {
    identityState: 'unregistered',
  });

  assert.equal(state.action, 'register_identity');
  assert.equal(state.label, 'Create identity');
  assert.match(state.hint ?? '', /Create an identity/);
});

test('wallet connected with session confirmation error exposes retry action', () => {
  const state = resolveCircleJoinBannerState(null, true, createJoinCopy(), {
    connectWallet: 'Connect wallet',
    connectWalletHint: 'Connect your wallet before joining this circle.',
    registerIdentity: 'Create identity',
    registerIdentityHint: 'Create an identity before joining this circle.',
    retrySession: 'Retry',
    retrySessionHint: 'We could not confirm your identity state. Please try again.',
    unresolvedMembershipLabel: 'Working…',
    unresolvedMembershipHint: 'Checking your circle access.',
  }, {
    identityState: 'session_error',
  });

  assert.equal(state.action, 'retry_session');
  assert.equal(state.label, 'Retry');
  assert.match(state.hint ?? '', /Please try again/);
});

test('wallet connected with in-flight identity session exposes retry action instead of passive dead-end', () => {
  const state = resolveCircleJoinBannerState(null, true, createJoinCopy(), {
    connectWallet: 'Connect wallet',
    connectWalletHint: 'Connect your wallet before joining this circle.',
    registerIdentity: 'Create identity',
    registerIdentityHint: 'Create an identity before joining this circle.',
    retrySession: 'Retry',
    retrySessionHint: 'We could not confirm your identity state. Please try again.',
    unresolvedMembershipLabel: 'Working…',
    unresolvedMembershipHint: 'Checking your circle access.',
  }, {
    identityState: 'connecting_session',
  });

  assert.equal(state.action, 'passive');
  assert.equal(state.label, 'Working…');
  assert.match(state.hint ?? '', /Checking your circle access/);
});

test('wallet connected with unresolved registered membership stays in passive loading until a real refresh error is known', () => {
  const state = resolveCircleJoinBannerState(null, true, createJoinCopy(), {
    connectWallet: 'Connect wallet',
    connectWalletHint: 'Connect your wallet before joining this circle.',
    registerIdentity: 'Create identity',
    registerIdentityHint: 'Create an identity before joining this circle.',
    retrySession: 'Retry',
    retrySessionHint: 'We could not confirm your identity state. Please try again.',
    unresolvedMembershipLabel: 'Working…',
    unresolvedMembershipHint: 'Checking your circle access.',
  }, {
    identityState: 'registered',
  });

  assert.equal(state.action, 'passive');
  assert.equal(state.label, 'Working…');
  assert.match(state.hint ?? '', /Checking your circle access/);
});

test('wallet connected with unresolved registered membership exposes retry only after membership refresh explicitly fails', () => {
  const state = resolveCircleJoinBannerState(null, true, createJoinCopy(), {
    connectWallet: 'Connect wallet',
    connectWalletHint: 'Connect your wallet before joining this circle.',
    registerIdentity: 'Create identity',
    registerIdentityHint: 'Create an identity before joining this circle.',
    retrySession: 'Retry',
    retrySessionHint: 'We could not confirm your identity state. Please try again.',
    unresolvedMembershipLabel: 'Working…',
    unresolvedMembershipHint: 'Checking your circle access.',
  }, {
    identityState: 'registered',
    membershipFetchFailed: true,
  });

  assert.equal(state.action, 'retry_session');
  assert.equal(state.label, 'Retry');
  assert.match(state.hint ?? '', /Please try again/);
});

test('wallet connected but unauthenticated becomes register-then-join intent', () => {
  const copy = createJoinCopy();
  const state = resolveCircleJoinBannerState({
    authenticated: false,
    circleId: 8,
    policy: {
      joinRequirement: 'Free',
      circleType: 'Open',
      minCrystals: 0,
      requiresApproval: false,
      requiresInvite: false,
    },
    joinState: 'guest',
    membership: null,
    userCrystals: 0,
    missingCrystals: 0,
  }, true, copy);

  assert.equal(state.action, 'register_identity');
  assert.equal(state.label, 'Create identity');
  assert.match(state.hint ?? '', /Create an identity/);
});

test('authenticated joined-disabled states remain passive', () => {
  const copy = createJoinCopy();
  const state = resolveCircleJoinBannerState({
    authenticated: true,
    circleId: 8,
    policy: {
      joinRequirement: 'InviteOnly',
      circleType: 'Closed',
      minCrystals: 0,
      requiresApproval: false,
      requiresInvite: true,
    },
    joinState: 'invite_required',
    membership: null,
    userCrystals: 0,
    missingCrystals: 0,
  }, true, copy);

  assert.equal(state.action, 'passive');
  assert.equal(state.label, 'Invite required');
});

test('reactivable former members get an explicit rejoin CTA instead of a generic join label', () => {
  const copy = createJoinCopy();
  const state = resolveCircleJoinBannerState({
    authenticated: true,
    circleId: 9,
    policy: {
      joinRequirement: 'ApprovalRequired',
      circleType: 'Closed',
      minCrystals: 0,
      requiresApproval: true,
      requiresInvite: false,
    },
    joinState: 'can_join',
    membership: {
      role: 'Member',
      status: 'Left',
      identityLevel: 'Member',
      joinedAt: '2026-04-01T00:00:00.000Z',
    },
    userCrystals: 0,
    missingCrystals: 0,
  }, true, copy);

  assert.equal(state.action, 'join');
  assert.equal(state.label, 'Rejoin');
});

test('insufficient crystal state stays passive with gap-aware copy', () => {
  const copy = createJoinCopy();
  const state = resolveCircleJoinBannerState({
    authenticated: true,
    circleId: 9,
    policy: {
      joinRequirement: 'TokenGated',
      circleType: 'Open',
      minCrystals: 5,
      requiresApproval: false,
      requiresInvite: false,
    },
    joinState: 'insufficient_crystals',
    membership: null,
    userCrystals: 2,
    missingCrystals: 3,
  }, true, copy);

  assert.equal(state.action, 'passive');
  assert.equal(state.label, '3 crystals needed');
  assert.equal(state.hint, 'Need 5, current 2.');
});

test('validates identity handle against on-chain rules', () => {
  assert.equal(validateIdentityHandle('alice_01'), null);
  assert.match(validateIdentityHandle('1alice') ?? '', /不能以数字开头/);
  assert.match(validateIdentityHandle('al') ?? '', /3-32/);
  assert.match(validateIdentityHandle('alice__foo') ?? '', /连续下划线/);
});
