import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const draftCardSource = readFileSync(
  new URL('../src/components/circle/DraftCard/DraftCard.tsx', import.meta.url),
  'utf8',
);
const crucibleTabSource = readFileSync(
  new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
  'utf8',
);
const heatSemanticsSource = readFileSync(
  new URL('../src/lib/heat/semantics.ts', import.meta.url),
  'utf8',
);
const enMessages = readFileSync(
  new URL('../src/i18n/messages/en.json', import.meta.url),
  'utf8',
);
const zhMessages = readFileSync(
  new URL('../src/i18n/messages/zh.json', import.meta.url),
  'utf8',
);

test('DraftCard distinguishes crystallized lifecycle from low heat state', () => {
  assert.match(draftCardSource, /lifecycleStatus\?:/);
  assert.match(draftCardSource, /draft\.lifecycleStatus === 'crystallized'/);
  assert.match(draftCardSource, /t\('lifecycle\.crystallized'\)/);
  assert.match(draftCardSource, /t\(`heat\.\$\{heatState\}`\)/);
  assert.doesNotMatch(draftCardSource, /resolveHeatLabel/);
});

test('CrucibleTab passes known draft lifecycle status into DraftCard before REST probes finish', () => {
  assert.match(crucibleTabSource, /documentStatus\?: WorkspaceDraftLifecycleStatus/);
  assert.match(crucibleTabSource, /const effectiveDraftWorkspaceStatuses = useMemo/);
  assert.match(crucibleTabSource, /draft\.documentStatus/);
  assert.match(crucibleTabSource, /lifecycleStatus:\s*effectiveDraftWorkspaceStatuses\[draft\.id\]/);
});

test('CrucibleTab lets fresh GraphQL lifecycle status override stale REST list cache', () => {
  assert.match(
    crucibleTabSource,
    /return\s*\{\s*\.\.\.draftWorkspaceStatuses,\s*\.\.\.next,\s*\};/,
  );
  assert.doesNotMatch(
    crucibleTabSource,
    /return\s*\{\s*\.\.\.next,\s*\.\.\.draftWorkspaceStatuses,\s*\};/,
  );
});

test('Draft card labels are localized and heat fallback is not hardcoded Chinese', () => {
  assert.doesNotMatch(heatSemanticsSource, /已冻结|活跃|冷却中/);
  assert.match(enMessages, /"DraftCard":\s*\{[\s\S]*"lifecycle":\s*\{[\s\S]*"crystallized":\s*"Crystallized"/);
  assert.match(zhMessages, /"DraftCard":\s*\{[\s\S]*"lifecycle":\s*\{[\s\S]*"crystallized":\s*"已结晶"/);
  assert.match(enMessages, /"DraftCard":\s*\{[\s\S]*"heat":\s*\{[\s\S]*"frozen":\s*"Low heat"/);
  assert.match(zhMessages, /"DraftCard":\s*\{[\s\S]*"heat":\s*\{[\s\S]*"frozen":\s*"低热度"/);
});
