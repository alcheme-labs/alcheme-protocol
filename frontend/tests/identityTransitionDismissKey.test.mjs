import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8',
);

test('identity transition dismiss key is scoped by active viewer identity', () => {
  assert.match(
    pageSource,
    /const viewerScope = sessionUser\?\.pubkey \|\| walletPubkey \|\| 'anonymous';/,
  );
  assert.match(
    pageSource,
    /alcheme_identity_transition_dismissed:\$\{viewerScope\}:\$\{activeDiscussionCircleId\}:\$\{changedAt\}/,
  );
});
