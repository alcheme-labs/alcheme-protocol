import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plazaTabSource = readFileSync(
  new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
  'utf8',
);

test('PlazaTab renders a deleted-source fallback label for forward cards whose source is gone', () => {
  assert.match(plazaTabSource, /msg\.forwardCard\.sourceDeleted && \(/);
  assert.match(plazaTabSource, /t\('forward\.sourceDeleted'\)/);
});
