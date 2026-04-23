import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const crucibleViewModel = readFileSync(
  new URL('../src/lib/circle/crucibleViewModel.ts', import.meta.url),
  'utf8'
);
const crucibleTab = readFileSync(
  new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
  'utf8'
);

test('crucible view helpers stop hardcoding user-facing english workflow copy', () => {
  assert.equal(crucibleViewModel.includes('No additional context has been added to this issue yet.'), false);
  assert.equal(crucibleViewModel.includes('Revision round'), false);
  assert.equal(crucibleViewModel.includes('Stable version v'), false);
  assert.equal(crucibleViewModel.includes('Ready for more edits'), false);
});

test('crucible tab wires localized copy into governance and paragraph view models', () => {
  assert.match(crucibleTab, /useI18n\('DraftDiscussionPanel'\)/);
  assert.match(crucibleTab, /useI18n\('CrucibleEditor'\)/);
});
