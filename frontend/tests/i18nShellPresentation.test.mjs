import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const nextConfigSource = readFileSync(
  new URL('../next.config.ts', import.meta.url),
  'utf8'
);
const rootLayoutSource = readFileSync(
  new URL('../src/app/layout.tsx', import.meta.url),
  'utf8'
);

test('frontend next config wires next-intl through the official plugin', () => {
  assert.match(nextConfigSource, /next-intl\/plugin/);
  assert.match(nextConfigSource, /createNextIntlPlugin/);
});

test('root layout derives html lang from request locale instead of hardcoding zh-CN', () => {
  assert.match(rootLayoutSource, /NextIntlClientProvider/);
  assert.match(rootLayoutSource, /lang=\{.*locale.*\}/);
  assert.doesNotMatch(rootLayoutSource, /lang="zh-CN"/);
});
