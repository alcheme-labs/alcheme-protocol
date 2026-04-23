import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const frontendRoot = new URL('..', import.meta.url);

const rootLayoutSource = fs.readFileSync(
  new URL('../src/app/layout.tsx', import.meta.url),
  'utf8'
);
const profilePageSource = fs.readFileSync(
  new URL('../src/app/(main)/profile/page.tsx', import.meta.url),
  'utf8'
);
const zhMessagesSource = fs.readFileSync(
  new URL('../src/i18n/messages/zh.json', import.meta.url),
  'utf8'
);
const enMessagesSource = fs.readFileSync(
  new URL('../src/i18n/messages/en.json', import.meta.url),
  'utf8'
);

const settingsSheetPath = path.join(
  frontendRoot.pathname,
  'src/components/profile/ProfileSettingsSheet/ProfileSettingsSheet.tsx'
);

test('root layout no longer renders the floating language switcher directly', () => {
  assert.doesNotMatch(rootLayoutSource, /<LanguageSwitcher\s*\/>/);
});

test('profile page owns a dedicated settings entry for language controls', () => {
  assert.match(profilePageSource, /ProfileSettingsSheet/);
  assert.match(profilePageSource, /Settings/);
  assert.match(profilePageSource, /showSettingsSheet/);
});

test('profile settings sheet supports a nested language panel wired to the locale preference API', () => {
  assert.equal(fs.existsSync(settingsSheetPath), true, `missing file: ${settingsSheetPath}`);
  const settingsSheetSource = fs.readFileSync(settingsSheetPath, 'utf8');

  assert.match(settingsSheetSource, /LOCALE_OPTIONS/);
  assert.match(settingsSheetSource, /\/api\/preferences\/locale/);
  assert.match(settingsSheetSource, /router\.refresh/);
  assert.match(settingsSheetSource, /useState<\s*'root'\s*\|\s*'language'\s*>/);
  assert.match(settingsSheetSource, /setView\('language'\)/);
});

test('profile locale settings copy exists in both chinese and english locale bundles', () => {
  assert.match(zhMessagesSource, /"ProfileSettingsSheet"/);
  assert.match(enMessagesSource, /"ProfileSettingsSheet"/);
  assert.match(zhMessagesSource, /"language"/);
  assert.match(enMessagesSource, /"language"/);
});
