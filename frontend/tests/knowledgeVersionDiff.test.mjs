import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const pagePath = path.join(frontendRoot, 'src/app/(main)/knowledge/[id]/page.tsx');
const panelPath = path.join(frontendRoot, 'src/components/knowledge/KnowledgeVersionDiffPanel/KnowledgeVersionDiffPanel.tsx');
const queriesPath = path.join(frontendRoot, 'src/lib/apollo/queries.ts');
const typesPath = path.join(frontendRoot, 'src/lib/apollo/types.ts');

function readSource(targetPath) {
  assert.equal(fs.existsSync(targetPath), true, `missing file: ${targetPath}`);
  return fs.readFileSync(targetPath, 'utf8');
}

test('knowledge detail page exposes a dedicated version diff panel instead of timeline-only navigation', () => {
  const pageSource = readSource(pagePath);

  assert.match(pageSource, /KnowledgeVersionDiffPanel/);
  assert.match(pageSource, /versionTimeline/);
  assert.match(pageSource, /knowledgeId=\{knowledge\.knowledgeId\}/);
});

test('knowledge version diff panel uses a dedicated GraphQL compare query and warns about missing historical content snapshots', () => {
  const panelSource = readSource(panelPath);
  const queriesSource = readSource(queriesPath);
  const typesSource = readSource(typesPath);

  assert.match(panelSource, /GET_KNOWLEDGE_VERSION_DIFF/);
  assert.match(panelSource, /历史正文快照尚未入库/);
  assert.match(panelSource, /fromVersion/);
  assert.match(panelSource, /toVersion/);

  assert.match(queriesSource, /export const GET_KNOWLEDGE_VERSION_DIFF = gql`/);
  assert.match(queriesSource, /versionDiff\(fromVersion: \$fromVersion, toVersion: \$toVersion\)/);

  assert.match(typesSource, /export interface GQLKnowledgeVersionDiff/);
  assert.match(typesSource, /export interface GQLKnowledgeVersionSnapshot/);
});
