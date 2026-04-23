import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apolloClientSource = readFileSync(
  new URL('../src/lib/apollo/client.ts', import.meta.url),
  'utf8',
);

test('circle posts cache refetch replaces the previous list instead of appending duplicates', () => {
  const circlePostsPolicy = apolloClientSource.match(
    /Circle:\s*\{[\s\S]*?posts:\s*\{[\s\S]*?merge\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/,
  )?.[1] ?? '';

  assert.doesNotMatch(circlePostsPolicy, /return\s+\[\.\.\.existing,\s*\.\.\.incoming\]/);
  assert.match(circlePostsPolicy, /return\s+incoming/);
});
