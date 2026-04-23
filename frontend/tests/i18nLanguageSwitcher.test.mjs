import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const localeConfigSource = readFileSync(
  new URL('../src/i18n/config.ts', import.meta.url),
  'utf8'
);
const languageSwitcherSource = readFileSync(
  new URL('../src/components/i18n/LanguageSwitcher.tsx', import.meta.url),
  'utf8'
);
const englishMessagesSource = readFileSync(
  new URL('../src/i18n/messages/en.json', import.meta.url),
  'utf8'
);
const localePreferenceRouteSource = readFileSync(
  new URL('../src/app/api/preferences/locale/route.ts', import.meta.url),
  'utf8'
);

test('language switcher offers the four supported locales', () => {
  assert.match(languageSwitcherSource, /LOCALE_OPTIONS/);
  assert.match(languageSwitcherSource, /t\(`options\.\$\{option\.value\}`\)/);
  assert.match(localeConfigSource, /'zh'/);
  assert.match(localeConfigSource, /'en'/);
  assert.match(localeConfigSource, /'es'/);
  assert.match(localeConfigSource, /'fr'/);
  assert.match(englishMessagesSource, /"English"/);
  assert.match(englishMessagesSource, /"Español"/);
  assert.match(englishMessagesSource, /"Français"/);
});

test('locale preference route validates and stores the selected locale in a cookie', () => {
  assert.match(localePreferenceRouteSource, /cookies/);
  assert.match(localePreferenceRouteSource, /locale/);
  assert.match(localePreferenceRouteSource, /SUPPORTED_LOCALES/);
});
