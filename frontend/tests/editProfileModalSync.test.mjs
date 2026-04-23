import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalSource = readFileSync(
  new URL('../src/components/ui/EditProfileModal/EditProfileModal.tsx', import.meta.url),
  'utf8',
);

test('EditProfileModal rehydrates form state whenever it opens with fresh profile data', () => {
  assert.match(modalSource, /useEffect/);
  assert.match(modalSource, /setDisplayName\(initialData\.displayName\)/);
  assert.match(modalSource, /setBio\(initialData\.bio\)/);
  assert.match(modalSource, /setErrorMessage\(null\)/);
});
