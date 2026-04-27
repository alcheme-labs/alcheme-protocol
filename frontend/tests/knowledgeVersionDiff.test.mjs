import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const pagePath = path.join(frontendRoot, 'src/app/(main)/knowledge/[id]/page.tsx');
const panelPath = path.join(frontendRoot, 'src/components/knowledge/KnowledgeVersionDiffPanel/KnowledgeVersionDiffPanel.tsx');
const panelStylesPath = path.join(frontendRoot, 'src/components/knowledge/KnowledgeVersionDiffPanel/KnowledgeVersionDiffPanel.module.css');
const queriesPath = path.join(frontendRoot, 'src/lib/apollo/queries.ts');
const typesPath = path.join(frontendRoot, 'src/lib/apollo/types.ts');
const zhMessagesPath = path.join(frontendRoot, 'src/i18n/messages/zh.json');

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
  const zhMessagesSource = readSource(zhMessagesPath);

  assert.match(panelSource, /GET_KNOWLEDGE_VERSION_DIFF/);
  assert.match(panelSource, /t\('notes\.metadataOnly'\)/);
  assert.match(zhMessagesSource, /历史正文快照尚未入库/);
  assert.match(panelSource, /fromVersion/);
  assert.match(panelSource, /toVersion/);

  assert.match(queriesSource, /export const GET_KNOWLEDGE_VERSION_DIFF = gql`/);
  assert.match(queriesSource, /versionDiff\(fromVersion: \$fromVersion, toVersion: \$toVersion\)/);

  assert.match(typesSource, /export interface GQLKnowledgeVersionDiff/);
  assert.match(typesSource, /export interface GQLKnowledgeVersionSnapshot/);
});

test('knowledge version diff panel keeps compare content inside narrow mobile containers', () => {
  const panelStyles = readSource(panelStylesPath);

  assert.match(panelStyles, /\.panel\s*\{[\s\S]*?width:\s*100%;/);
  assert.match(panelStyles, /\.panel\s*\{[\s\S]*?max-width:\s*100%;/);
  assert.match(panelStyles, /\.panel\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(panelStyles, /\.panel\s*>\s*\*\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(panelStyles, /\.select\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(panelStyles, /\.subtitle\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(panelStyles, /\.note\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(panelStyles, /\.snapshotMeta\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(panelStyles, /\.changeValue\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
});
