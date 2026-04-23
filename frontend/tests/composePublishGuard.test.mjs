import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const composePageSource = readFileSync(
  new URL('../src/app/(main)/compose/page.tsx', import.meta.url),
  'utf8',
);
const composeStyles = readFileSync(
  new URL('../src/app/(main)/compose/page.module.css', import.meta.url),
  'utf8',
);

test('compose publish uses a synchronous in-flight guard before awaiting chain write', () => {
  assert.match(composePageSource, /submitInFlightRef\s*=\s*useRef\(false\)/);
  assert.match(composePageSource, /submitInFlightRef\.current/);
  assert.match(
    composePageSource,
    /submitInFlightRef\.current\s*=\s*true[\s\S]*?await createContent/,
  );
});

test('compose success copy stays centered and wraps long circle names', () => {
  assert.match(composeStyles, /\.successScreen\s*\{[\s\S]*?text-align:\s*center;/);
  assert.match(composeStyles, /\.successText\s*\{[\s\S]*?max-width:/);
  assert.match(composeStyles, /\.successText\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
});
