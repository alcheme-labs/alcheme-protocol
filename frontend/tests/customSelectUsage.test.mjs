import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const activeSelectSurfaces = [
  'src/components/knowledge/KnowledgeVersionDiffPanel/KnowledgeVersionDiffPanel.tsx',
  'src/components/i18n/LanguageSwitcher.tsx',
  'src/features/agents/AgentAdminPanel.tsx',
  'src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx',
  'src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx',
  'src/components/circle/ForkCreateSheet/ForkCreateSheet.tsx',
];

function read(relativePath) {
  return fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');
}

function selectOpeningTags(source) {
  return source.match(/<Select\b[\s\S]*?\/>/g) || [];
}

test('mobile-facing select surfaces use the shared custom Select component instead of native select popups', () => {
  const selectSource = read('src/components/ui/Select/Select.tsx');
  const agentE2eSource = read('e2e/agent-contribution.spec.ts');
  const draftDiscussionE2eSource = read('e2e/draft-discussion-workflow.spec.ts');
  assert.match(selectSource, /aria-haspopup="listbox"/);
  assert.match(selectSource, /role="listbox"/);
  assert.match(selectSource, /role="option"/);
  assert.match(selectSource, /activeValue/);
  assert.doesNotMatch(selectSource, /moveSelection/);
  assert.match(agentE2eSource, /test\.describe\.skip\('Agent contribution admin'/);
  assert.doesNotMatch(agentE2eSource, /\.selectOption\(/);
  assert.match(agentE2eSource, /getByRole\('option'/);
  assert.doesNotMatch(draftDiscussionE2eSource, /\.selectOption\(/);
  assert.match(draftDiscussionE2eSource, /getByRole\('option'/);

  for (const relativePath of activeSelectSurfaces) {
    const source = read(relativePath);
    assert.match(source, /@\/components\/ui\/Select/, `${relativePath} should import the shared Select`);
    assert.notEqual(selectOpeningTags(source).length, 0, `${relativePath} should render at least one shared Select`);
    assert.doesNotMatch(source, /<select\b/, `${relativePath} should not render native select`);
    assert.doesNotMatch(source, /<option\b/, `${relativePath} should not render native option`);
    for (const tag of selectOpeningTags(source)) {
      assert.doesNotMatch(tag, /\baria-label=/, `${relativePath} should pass ariaLabel to shared Select, not aria-label`);
    }
  }
});
