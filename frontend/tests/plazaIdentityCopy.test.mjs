import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const localeFiles = [
  '../src/i18n/messages/en.json',
  '../src/i18n/messages/zh.json',
  '../src/i18n/messages/fr.json',
  '../src/i18n/messages/es.json',
];

for (const relativePath of localeFiles) {
  test(`PlazaTab locale contract includes level and state labels: ${relativePath}`, () => {
    const payload = JSON.parse(
      readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    );
    const plazaTab = payload.PlazaTab;

    assert.ok(plazaTab);
    assert.deepEqual(Object.keys(plazaTab.levels || {}).sort(), ['Elder', 'Initiate', 'Member', 'Visitor']);
    assert.deepEqual(
      Object.keys(plazaTab.states || {})
        .filter((key) => ['visitor', 'initiate', 'member', 'curator', 'owner'].includes(key))
        .sort(),
      ['curator', 'initiate', 'member', 'owner', 'visitor'],
    );
  });
}
