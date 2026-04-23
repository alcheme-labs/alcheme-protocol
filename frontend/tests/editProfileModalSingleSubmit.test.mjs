import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalSource = readFileSync(
  new URL('../src/components/ui/EditProfileModal/EditProfileModal.tsx', import.meta.url),
  'utf8',
);

test('EditProfileModal guards against duplicate saves before React disables the button', () => {
  assert.match(modalSource, /const saveInFlightRef = useRef\(false\)/);
  assert.match(modalSource, /if \(saveInFlightRef\.current \|\| !displayName\.trim\(\)\) return;/);
  assert.match(modalSource, /saveInFlightRef\.current = true;/);
  assert.match(modalSource, /saveInFlightRef\.current = false;/);
});
