import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filePath), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'start-local-stack.sh');

function readScript() {
  assert.equal(fs.existsSync(scriptPath), true, `missing file: ${scriptPath}`);
  return fs.readFileSync(scriptPath, 'utf8');
}

test('start-local-stack defines crystal mint env defaults for query-api runtime', () => {
  const source = readScript();

  assert.match(source, /CRYSTAL_MINT_ADAPTER="\$\{CRYSTAL_MINT_ADAPTER:-disabled\}"/);
  assert.match(source, /CRYSTAL_MINT_RPC_URL="\$\{CRYSTAL_MINT_RPC_URL:-\$RPC_URL\}"/);
  assert.match(source, /CRYSTAL_MINT_AUTHORITY_SECRET="\$\{CRYSTAL_MINT_AUTHORITY_SECRET:-\}"/);
  assert.match(source, /CRYSTAL_MASTER_OWNER_PUBKEY="\$\{CRYSTAL_MASTER_OWNER_PUBKEY:-\}"/);
  assert.match(source, /CRYSTAL_METADATA_BASE_URL="\$\{CRYSTAL_METADATA_BASE_URL:-\}"/);
});

test('start-local-stack forwards crystal mint env into the query-api process env', () => {
  const source = readScript();

  assert.match(source, /CRYSTAL_MINT_ADAPTER=\\?"\$CRYSTAL_MINT_ADAPTER\\?"/);
  assert.match(source, /CRYSTAL_MINT_RPC_URL=\\?"\$CRYSTAL_MINT_RPC_URL\\?"/);
  assert.match(source, /CRYSTAL_MINT_AUTHORITY_SECRET=\\?"\$CRYSTAL_MINT_AUTHORITY_SECRET\\?"/);
  assert.match(source, /CRYSTAL_MASTER_OWNER_PUBKEY=\\?"\$CRYSTAL_MASTER_OWNER_PUBKEY\\?"/);
  assert.match(source, /CRYSTAL_METADATA_BASE_URL=\\?"\$CRYSTAL_METADATA_BASE_URL\\?"/);
});
