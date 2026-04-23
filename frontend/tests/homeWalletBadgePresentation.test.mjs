import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const homePageSource = readFileSync(
  new URL('../src/app/(main)/home/page.tsx', import.meta.url),
  'utf8',
);
const homeStyles = readFileSync(
  new URL('../src/app/(main)/home/page.module.css', import.meta.url),
  'utf8',
);

test('Home page drives the wallet badge from real wallet connection state', () => {
  assert.match(homePageSource, /shouldShowHomeWalletBadge\(walletConnected\)/);
});

test('Home wallet badge shares the header controls row instead of occupying a full line', () => {
  assert.match(homePageSource, /className=\{styles\.headerMetaRow\}/);
  assert.match(homePageSource, /<div className=\{styles\.headerMetaRow\}>[\s\S]*styles\.flowToggle[\s\S]*styles\.liveIndicator[\s\S]*<\/div>/);
  assert.match(homeStyles, /\.headerMetaRow\s*\{[\s\S]*display:\s*flex;/);
  assert.match(homeStyles, /\.headerMetaRow\s*\{[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(homeStyles, /\.liveIndicator\s*\{[\s\S]*display:\s*inline-flex;/);
  assert.doesNotMatch(homeStyles, /\.liveIndicator\s*\{[\s\S]*display:\s*block;/);
  assert.doesNotMatch(homeStyles, /\.liveIndicator\s*\{[\s\S]*margin-top:\s*var\(--space-3\);/);
});
