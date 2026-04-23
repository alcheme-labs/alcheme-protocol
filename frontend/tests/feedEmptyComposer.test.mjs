import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const feedTabSource = readFileSync(
  new URL('../src/components/circle/FeedTab/FeedTab.tsx', import.meta.url),
  'utf8',
);

test('circle feed empty state keeps the publish entry available', () => {
  const emptyStateBranch = feedTabSource.match(
    /if \(posts\.length === 0\) \{\s*return \(([\s\S]*?)\n\s*\);\n\s*\}/,
  )?.[1] ?? '';

  assert.match(emptyStateBranch, /styles\.feedEmpty/);
  assert.match(emptyStateBranch, /renderComposer\(\)/);
});
