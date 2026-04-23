import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const circlesPageSource = readFileSync(
  new URL('../src/app/(main)/circles/page.tsx', import.meta.url),
  'utf8',
);

test('circles search keeps the related-content hint when circle results are empty but post matches exist', () => {
  assert.match(circlesPageSource, /const hasSearchResults = searchPostData\?\.searchPosts && searchPostData\.searchPosts\.length > 0;/);
  assert.match(
    circlesPageSource,
    /\) : displayCircles\.length === 0 \? \(\s*<div className=\{styles\.empty\}>\s*<p>\{t\('empty'\)\}<\/p>\s*\{hasSearchResults && \(\s*<p className=\{styles\.searchHint\}>\{relatedResultsHint\}<\/p>\s*\)\}\s*<\/div>/s,
  );
});

test('circles list cards remain direct links into the circle detail route', () => {
  assert.match(
    circlesPageSource,
    /<Link href=\{`\/circles\/\$\{circle\.id\}`\} className=\{styles\.circleLink\}>/,
  );
});
