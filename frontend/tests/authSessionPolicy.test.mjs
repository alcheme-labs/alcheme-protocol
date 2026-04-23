import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAuthSessionSignatureRequirement,
  shouldSignAuthSession,
} from '../src/lib/auth/sessionPolicy.ts';

test('auth session signature requirement defaults to false', () => {
  assert.equal(parseAuthSessionSignatureRequirement(undefined), false);
  assert.equal(parseAuthSessionSignatureRequirement(''), false);
  assert.equal(parseAuthSessionSignatureRequirement('unexpected'), false);
});

test('auth session signature requirement accepts explicit truthy values', () => {
  assert.equal(parseAuthSessionSignatureRequirement('true'), true);
  assert.equal(parseAuthSessionSignatureRequirement('1'), true);
  assert.equal(parseAuthSessionSignatureRequirement('yes'), true);
});

test('auth session signature requirement accepts explicit falsy values', () => {
  assert.equal(parseAuthSessionSignatureRequirement('false'), false);
  assert.equal(parseAuthSessionSignatureRequirement('0'), false);
  assert.equal(parseAuthSessionSignatureRequirement('no'), false);
});

test('auth session helper only forwards signMessage when signature is required', () => {
  const signer = async () => new Uint8Array([1, 2, 3]);

  assert.equal(shouldSignAuthSession(signer, 'true'), signer);
  assert.equal(shouldSignAuthSession(signer, 'false'), undefined);
  assert.equal(shouldSignAuthSession(undefined, 'true'), undefined);
});
