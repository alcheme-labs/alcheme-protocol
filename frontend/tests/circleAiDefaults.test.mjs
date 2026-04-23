import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const createCircleSheet = readFileSync(
  new URL('../src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx', import.meta.url),
  'utf8',
);

const forkCreateSheet = readFileSync(
  new URL('../src/components/circle/ForkCreateSheet/ForkCreateSheet.tsx', import.meta.url),
  'utf8',
);

const circleDetailPage = readFileSync(
  new URL("../src/app/(main)/circles/[id]/page.tsx", import.meta.url),
  'utf8',
);

test('CreateCircleSheet defaults AI collaboration settings to enabled for new circles', () => {
  assert.match(
    createCircleSheet,
    /summaryUseLLM:\s*initialGhostSettings\?\.summaryUseLLM\s*\?\?\s*true/,
  );
  assert.match(
    createCircleSheet,
    /draftTriggerMode:\s*initialGhostSettings\?\.draftTriggerMode\s*\?\?\s*'auto_draft'/,
  );
  assert.match(
    createCircleSheet,
    /triggerSummaryUseLLM:\s*initialGhostSettings\?\.triggerSummaryUseLLM\s*\?\?\s*true/,
  );
});

test('ForkCreateSheet defaults AI collaboration settings to enabled for new forks', () => {
  assert.match(
    forkCreateSheet,
    /summaryUseLLM:\s*props\.initialGhostSettings\?\.summaryUseLLM\s*\?\?\s*true/,
  );
  assert.match(
    forkCreateSheet,
    /draftTriggerMode:\s*props\.initialGhostSettings\?\.draftTriggerMode\s*\?\?\s*'auto_draft'/,
  );
  assert.match(
    forkCreateSheet,
    /triggerSummaryUseLLM:\s*props\.initialGhostSettings\?\.triggerSummaryUseLLM\s*\?\?\s*true/,
  );
});

test('circle detail page only forwards explicit ghost overrides into creation sheets', () => {
  assert.doesNotMatch(
    circleDetailPage,
    /initialGhostSettings=\{circleGhostSettings \|\| DEFAULT_CIRCLE_GHOST_SETTINGS\}/,
  );
  assert.match(circleDetailPage, /const creationInitialGhostSettings =/);
  assert.match(circleDetailPage, /circleGhostSettingsSource === 'circle'/);
  assert.match(circleDetailPage, /circleGhostSettingsSource === 'pending'/);
});

for (const relativePath of [
  '../src/i18n/messages/en.json',
  '../src/i18n/messages/zh.json',
  '../src/i18n/messages/fr.json',
  '../src/i18n/messages/es.json',
]) {
  test(`AI settings locale contract includes rule fallback warnings: ${relativePath}`, () => {
    const payload = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

    assert.ok(payload.CreateCircleSheet?.ai?.summaryUseLlm?.warning);
    assert.ok(payload.CreateCircleSheet?.ai?.triggerSummaryUseLlm?.warning);
    assert.ok(payload.CircleSettingsSheet?.ghost?.summaryUseLlmWarning);
    assert.ok(payload.CircleSettingsSheet?.ghost?.triggerSummaryUseLlmWarning);
  });
}
