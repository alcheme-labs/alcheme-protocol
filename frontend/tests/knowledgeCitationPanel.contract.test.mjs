import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const panelPath = path.join(frontendRoot, 'src/components/knowledge/KnowledgeCitationPanel/KnowledgeCitationPanel.tsx');
const referenceClientPath = path.join(frontendRoot, 'src/lib/contribution-engine/referenceClient.ts');
const zhMessagesPath = path.join(frontendRoot, 'src/i18n/messages/zh.json');
const enMessagesPath = path.join(frontendRoot, 'src/i18n/messages/en.json');

function readSource() {
  assert.equal(fs.existsSync(panelPath), true, `missing file: ${panelPath}`);
  return fs.readFileSync(panelPath, 'utf8');
}

test('KnowledgeCitationPanel delegates citation submission through the app-level reference client', () => {
  const source = readSource();
  const referenceClientSource = fs.readFileSync(referenceClientPath, 'utf8');

  assert.match(source, /const sdk = useAlchemeSDK\(\);/);
  assert.match(source, /if \(!sdk\?\.contributionEngine\)/);
  assert.match(source, /submitKnowledgeCitation\(/);
  assert.doesNotMatch(source, /sdk\.contributionEngine\.addReference\(/);

  assert.match(referenceClientSource, /sdk\.contributionEngine\.addReference\(/);
  assert.match(referenceClientSource, /new PublicKey\(sourceOnChainAddress\)/);
  assert.match(referenceClientSource, /new PublicKey\(targetOnChainAddress\)/);
});

test('KnowledgeCitationPanel contract still promises indexer-driven citation readback', () => {
  const source = readSource();
  const zhMessages = fs.readFileSync(zhMessagesPath, 'utf8');
  const enMessages = fs.readFileSync(enMessagesPath, 'utf8');

  assert.match(source, /useI18n\('KnowledgeCitationPanel'\)/);
  assert.match(zhMessages, /引用会走真实链上交易，成功后由 indexer 回写/);
  assert.match(zhMessages, /索引后会更新被引次数与通知/);
  assert.match(enMessages, /Citations use a real on-chain transaction, then the indexer writes the result back/);
  assert.match(enMessages, /Indexing will update counts and notifications shortly/);
});

test('KnowledgeCitationPanel filters the current target out of citation candidates on the client', () => {
  const source = readSource();

  assert.match(source, /function filterCitationSources/);
  assert.match(source, /item\.knowledgeId !== target\.knowledgeId/);
  assert.match(source, /item\.onChainAddress !== target\.onChainAddress/);
});
