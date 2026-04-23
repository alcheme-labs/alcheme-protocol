import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/hooks/useCreateCircle.ts', import.meta.url),
  'utf8',
);

test('useCreateCircle reuses one in-flight create promise across duplicate triggers', () => {
  assert.match(source, /const inFlightRef = useRef<Promise<\{/);
  assert.match(source, /if \(inFlightRef\.current\) return inFlightRef\.current;/);
  assert.match(source, /inFlightRef\.current = run\.finally\(\(\) => \{\s*inFlightRef\.current = null;/);
});
