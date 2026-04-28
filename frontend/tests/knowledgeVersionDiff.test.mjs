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
const selectPath = path.join(frontendRoot, 'src/components/ui/Select/Select.tsx');
const selectStylesPath = path.join(frontendRoot, 'src/components/ui/Select/Select.module.css');
const queriesPath = path.join(frontendRoot, 'src/lib/apollo/queries.ts');
const typesPath = path.join(frontendRoot, 'src/lib/apollo/types.ts');
const enMessagesPath = path.join(frontendRoot, 'src/i18n/messages/en.json');
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
  const selectSource = readSource(selectPath);
  const queriesSource = readSource(queriesPath);
  const typesSource = readSource(typesPath);
  const enMessagesSource = readSource(enMessagesPath);
  const zhMessagesSource = readSource(zhMessagesPath);

  assert.match(panelSource, /GET_KNOWLEDGE_VERSION_DIFF/);
  assert.match(panelSource, /t\('notes\.metadataOnly'\)/);
  assert.match(panelSource, /formatSummary/);
  assert.match(panelSource, /formatFieldLabel/);
  assert.doesNotMatch(panelSource, /\{diff\.summary\}/);
  assert.doesNotMatch(panelSource, /\{change\.label\}/);
  assert.doesNotMatch(panelSource, /<select/);
  assert.doesNotMatch(panelSource, /<option/);
  assert.match(panelSource, /@\/components\/ui\/Select/);
  assert.match(selectSource, /role="listbox"/);
  assert.match(selectSource, /role="option"/);
  assert.match(selectSource, /aria-haspopup="listbox"/);
  assert.match(enMessagesSource, /For now only version-event metadata can be compared/);
  assert.match(enMessagesSource, /Contributor count/);
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
  const selectStyles = readSource(selectStylesPath);

  assert.match(panelStyles, /\.panel\s*\{[\s\S]*?width:\s*100%;/);
  assert.match(panelStyles, /\.panel\s*\{[\s\S]*?max-width:\s*100%;/);
  assert.match(panelStyles, /\.panel\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(panelStyles, /\.panel\s*>\s*\*\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(selectStyles, /\.button\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(selectStyles, /\.menu\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(selectStyles, /\.option\s*\{[\s\S]*?border-radius:\s*10px;/);
  assert.match(panelStyles, /\.subtitle\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(panelStyles, /\.note\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(panelStyles, /\.snapshotMeta\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
  assert.match(panelStyles, /\.changeValue\s*\{[\s\S]*?overflow-wrap:\s*anywhere;/);
});

test('knowledge crystal asset card separates demo assets from real mint actions', () => {
  const pageSource = readSource(pagePath);
  const pageStyles = readSource(path.join(frontendRoot, 'src/app/(main)/knowledge/[id]/page.module.css'));
  const enMessagesSource = readSource(enMessagesPath);
  const zhMessagesSource = readSource(zhMessagesPath);

  assert.match(pageSource, /formatAssetStandardLabel/);
  assert.match(pageSource, /buildSolanaExplorerUrl/);
  assert.match(pageSource, /if \(!configuredCluster && !rpcUrl\) return 'devnet';/);
  assert.match(pageSource, /navigator\.clipboard\.writeText/);
  assert.match(pageSource, /asset\.actions\.copyAddress/);
  assert.match(pageSource, /asset\.actions\.viewOnExplorer/);
  assert.match(pageSource, /asset\.actions\.demoOnly/);
  assert.doesNotMatch(pageSource, /crystalAsset\?\.assetStandard\s*\|\|/);

  assert.match(pageStyles, /\.assetAddressGroup/);
  assert.match(pageStyles, /\.assetActionButton/);
  assert.match(pageStyles, /\.assetExplorerLink/);
  assert.match(pageStyles, /\.assetDemoOnly/);

  assert.match(enMessagesSource, /"mintAddress": "Mint address"/);
  assert.match(enMessagesSource, /"receiptMint": "Receipt mint"/);
  assert.match(enMessagesSource, /"demoAsset": "Demo asset"/);
  assert.match(enMessagesSource, /"token2022MasterNft": "Token-2022 master NFT"/);
  assert.match(enMessagesSource, /"copyAddress": "Copy address"/);
  assert.match(enMessagesSource, /"viewOnExplorer": "View on explorer"/);
  assert.match(enMessagesSource, /"demoOnly": "Demo only"/);

  assert.match(zhMessagesSource, /"mintAddress": "Mint 地址"/);
  assert.match(zhMessagesSource, /"receiptMint": "凭证 Mint"/);
  assert.match(zhMessagesSource, /"demoAsset": "演示资产"/);
  assert.match(zhMessagesSource, /"token2022MasterNft": "Token-2022 主 NFT"/);
  assert.match(zhMessagesSource, /"copyAddress": "复制地址"/);
  assert.match(zhMessagesSource, /"viewOnExplorer": "链上查看"/);
  assert.match(zhMessagesSource, /"demoOnly": "仅演示"/);
});
