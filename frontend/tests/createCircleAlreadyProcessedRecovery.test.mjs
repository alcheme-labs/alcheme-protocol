import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(
  new URL('../src/hooks/useCreateCircle.ts', import.meta.url),
  'utf8',
);

test('useCreateCircle routes flag updates through the sdk helper instead of direct rpc calls', () => {
  assert.match(hookSource, /updateCircleFlags\(createdCircleId,\s*targetFlags\)/);
  assert.doesNotMatch(hookSource, /\.program\.methods\s*\.\s*updateCircleFlags/);
  assert.doesNotMatch(hookSource, /updateCircleFlags\(targetFlags\)[\s\S]*\.rpc\(\)/);
});
