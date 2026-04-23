import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const landingPageSource = readFileSync(
  new URL('../src/app/page.tsx', import.meta.url),
  'utf8',
);

test('root landing page transitions to /home after the splash hold', () => {
  assert.match(landingPageSource, /setTimeout\(\(\) => router\.push\('\/home'\), 2800\)/);
  assert.match(landingPageSource, /setTimeout\(\(\) => setPhase\('exit'\), 2200\)/);
});
