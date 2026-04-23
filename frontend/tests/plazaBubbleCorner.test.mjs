import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pageStyles = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.module.css', import.meta.url),
  'utf8',
);

test('plaza message bubbles point their sharp corner toward the avatar row', () => {
  assert.match(
    pageStyles,
    /\.msgBubble\s*\{[\s\S]*?border-radius:\s*4px 16px 16px 16px;/,
  );
  assert.match(
    pageStyles,
    /\.msgRowMine \.msgBubble\s*\{[\s\S]*?border-radius:\s*16px 4px 16px 16px;/,
  );
  assert.doesNotMatch(
    pageStyles,
    /\.msgBubble\s*\{[\s\S]*?border-radius:\s*16px 16px 16px 4px;/,
  );
  assert.doesNotMatch(
    pageStyles,
    /\.msgRowMine \.msgBubble\s*\{[\s\S]*?border-radius:\s*16px 16px 4px 16px;/,
  );
});
