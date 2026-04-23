import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/app/(main)/circles/page.tsx', import.meta.url),
  'utf8',
);

test('CirclesPage de-duplicates root circle cards by circle id before rendering', () => {
  assert.match(source, /const displayCircles: GQLCircle\[\] = Array\.from\(new Map\(\(/);
  assert.match(source, /\.map\(\(circle\) => \[circle\.id, circle\] as const\)\)\.values\(\)\)/);
});
