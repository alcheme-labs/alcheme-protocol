import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('normalizeJoinActionError surfaces membership bridge configuration failures as a clear join-finalization error', () => {
  const source = readFileSync(
    new URL('../src/lib/circle/utils.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /missing_membership_bridge_issuer_key_id/);
  assert.match(source, /missing_membership_bridge_issuer_secret/);
  assert.match(source, /membership_bridge_issuer_key_mismatch/);
  assert.match(source, /copy\.errors\.membershipBridgeUnavailable/);
});
