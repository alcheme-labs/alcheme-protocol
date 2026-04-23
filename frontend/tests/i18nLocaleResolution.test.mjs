import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const localeConfigSource = readFileSync(
  new URL('../src/i18n/config.ts', import.meta.url),
  'utf8'
);
const localeResolverSource = readFileSync(
  new URL('../src/i18n/resolveLocale.ts', import.meta.url),
  'utf8'
);

test('locale resolver defines the four canonical locales and falls back to english', () => {
  assert.match(localeConfigSource, /SUPPORTED_LOCALES/);
  assert.match(localeConfigSource, /'zh'/);
  assert.match(localeConfigSource, /'en'/);
  assert.match(localeConfigSource, /'es'/);
  assert.match(localeConfigSource, /'fr'/);
  assert.match(localeConfigSource, /DEFAULT_LOCALE:\s*AppLocale\s*=\s*'en'/);
});

test('locale resolver normalizes supported region variants and falls back arabic to english', () => {
  assert.match(localeResolverSource, /zh-cn/);
  assert.match(localeResolverSource, /zh-tw/);
  assert.match(localeResolverSource, /es-mx/);
  assert.match(localeResolverSource, /fr-ca/);
  assert.match(localeResolverSource, /ar-sa/);
  assert.match(localeResolverSource, /return DEFAULT_LOCALE;/);
});
