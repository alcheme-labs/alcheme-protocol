import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveContentWriteMode,
  resolveBindContentId,
  resolveIdentityHandleForV2,
  buildV2RouteOptions,
  isV2ContentIdConflictError,
} from '../src/lib/content/writeRoute.ts';

test('resolveContentWriteMode hard-forces v2 regardless of env input', () => {
  assert.equal(resolveContentWriteMode(undefined), 'v2');
  assert.equal(resolveContentWriteMode(''), 'v2');
  assert.equal(resolveContentWriteMode('v2'), 'v2');
  assert.equal(resolveContentWriteMode(' V2 '), 'v2');
  assert.equal(resolveContentWriteMode('V1'), 'v2');
});

test('resolveBindContentId always uses v2 numeric content id', () => {
  const contentId = { toString: () => '1700000000123' };
  const expectedContentId = 'Post1111111111111111111111111111111111111';

  assert.equal(resolveBindContentId('v2', contentId, expectedContentId), '1700000000123');
});

test('resolveIdentityHandleForV2 enforces handle only on v2 mode', () => {
  const sessionV1 = { authenticated: false };
  assert.throws(
    () => resolveIdentityHandleForV2('v2', sessionV1),
    /登录态缺少身份 handle/i,
  );

  const sessionV2 = { authenticated: true, user: { handle: 'alice' } };
  assert.equal(resolveIdentityHandleForV2('v2', sessionV2), 'alice');

  assert.throws(
    () => resolveIdentityHandleForV2('v2', { authenticated: false }),
    /登录态缺少身份 handle/i,
  );
});

test('buildV2RouteOptions always stays explicit v2-only', () => {
  assert.deepEqual(
    buildV2RouteOptions('v2', 'alice', 'social_hub_identity'),
    {
      useV2: true,
      enableV1FallbackOnV2Failure: false,
      identityHandle: 'alice',
      identityRegistryName: 'social_hub_identity',
    },
  );
});

test('isV2ContentIdConflictError detects known v2 id contention errors', () => {
  assert.equal(isV2ContentIdConflictError(new Error('Allocate: account Address already in use')), true);
  assert.equal(isV2ContentIdConflictError(new Error('V2ContentIdConflict')), true);
  assert.equal(isV2ContentIdConflictError(new Error('network timeout')), false);
});
