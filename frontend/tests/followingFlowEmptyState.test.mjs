import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homePageSource = readFileSync(
  new URL('../src/app/(main)/home/page.tsx', import.meta.url),
  'utf8',
);

let helperSource = '';
try {
  helperSource = readFileSync(
    new URL('../src/lib/home/followingFlowEmptyState.ts', import.meta.url),
    'utf8',
  );
} catch {
  helperSource = '';
}

test('Following flow empty state differentiates no follows from no visible posts', () => {
  assert.match(homePageSource, /resolveFollowingFlowEmptyStateMessage/);
  assert.match(homePageSource, /me\?\.stats\.following/);
  assert.match(helperSource, /followingCount/);
  assert.match(helperSource, /你还没有关注任何创作者/);
  assert.match(helperSource, /你关注的人还没有发布可见内容/);
});
