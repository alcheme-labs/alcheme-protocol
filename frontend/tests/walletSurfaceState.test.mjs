import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canEditRegisteredProfile,
  shouldLoadRegisteredProfile,
  shouldShowHomeWalletBadge,
} from '../src/lib/auth/walletSurfaceState.ts';

test('home wallet badge only shows for a genuinely connected wallet', () => {
  assert.equal(shouldShowHomeWalletBadge(true), true);
  assert.equal(shouldShowHomeWalletBadge(false), false);
});

test('profile data only loads when the wallet is connected and identity is registered', () => {
  assert.equal(shouldLoadRegisteredProfile({ walletConnected: true, identityState: 'registered' }), true);
  assert.equal(shouldLoadRegisteredProfile({ walletConnected: false, identityState: 'registered' }), false);
  assert.equal(shouldLoadRegisteredProfile({ walletConnected: true, identityState: 'unregistered' }), false);
  assert.equal(shouldLoadRegisteredProfile({ walletConnected: true, identityState: 'session_error' }), false);
});

test('profile editing stays locked until a connected registered identity has a handle', () => {
  assert.equal(canEditRegisteredProfile({
    walletConnected: true,
    identityState: 'registered',
    handle: 'alchemist',
  }), true);

  assert.equal(canEditRegisteredProfile({
    walletConnected: false,
    identityState: 'registered',
    handle: 'alchemist',
  }), false);

  assert.equal(canEditRegisteredProfile({
    walletConnected: true,
    identityState: 'unregistered',
    handle: 'alchemist',
  }), false);

  assert.equal(canEditRegisteredProfile({
    walletConnected: true,
    identityState: 'registered',
    handle: '',
  }), false);
});
