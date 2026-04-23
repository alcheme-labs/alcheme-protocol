import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profilePageSource = readFileSync(
  new URL('../src/app/(main)/profile/page.tsx', import.meta.url),
  'utf8',
);

test('profile save keeps sdk-facing profile updates in app-level camelCase', () => {
  assert.match(
    profilePageSource,
    /sdk\.identity\.updateIdentity\(user\.handle,\s*\{\s*displayName:\s*profileData\.displayName,\s*bio:\s*profileData\.bio,/s,
  );
  assert.doesNotMatch(
    profilePageSource,
    /sdk\.identity\.updateIdentity\(user\.handle,\s*\{\s*display_name:\s*profileData\.displayName,/s,
  );
});
