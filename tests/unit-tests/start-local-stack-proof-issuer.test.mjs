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

test('start-local-stack wires proof package issuer env into query-api', () => {
  const source = readScript();

  assert.match(source, /DRAFT_PROOF_ISSUER_KEY_ID="\$\{DRAFT_PROOF_ISSUER_KEY_ID:-/);
  assert.match(source, /DRAFT_PROOF_ISSUER_SECRET="\$\{DRAFT_PROOF_ISSUER_SECRET:-/);
  assert.match(source, /DRAFT_PROOF_ISSUER_KEY_ID=\\?"\$DRAFT_PROOF_ISSUER_KEY_ID\\?"/);
  assert.match(source, /DRAFT_PROOF_ISSUER_SECRET=\\?"\$DRAFT_PROOF_ISSUER_SECRET\\?"/);
});

test('start-local-stack bootstraps proof attestor registry before query-api serves crystallization binding', () => {
  const source = readScript();

  assert.match(source, /bootstrap_proof_attestor_registry\(\)/);
  assert.match(source, /npx ts-node scripts\/bootstrap-proof-attestor\.ts/);
  assert.match(source, /bootstrapping proof attestor registry for crystallization contributor binding/);
  assert.match(source, /--attestor "\$DRAFT_PROOF_ISSUER_KEY_ID"/);
});
