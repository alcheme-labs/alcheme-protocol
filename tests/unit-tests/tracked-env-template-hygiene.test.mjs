import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const trackedEnvFiles = [
  '.env.example',
  'services/indexer-core/.env.example',
  'services/query-api/.env.example',
];

const internalOnlySensitiveFiles = [
  '.env.devnet',
  '.env.mainnet',
  'services/indexer-core/.env',
  'extensions/contribution-engine/program/keypair.json',
  'programs/circle-manager/target-keypair.json',
  'programs/messaging-manager/target-keypair.json',
];

function read(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function isTracked(relativePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relativePath], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

test('tracked public env templates do not contain live-looking API keys', () => {
  for (const relativePath of trackedEnvFiles) {
    const source = read(relativePath);
    assert.doesNotMatch(source, /(?:^|\s)sk-[a-z0-9]{16,}/i, `${relativePath} contains a live-looking API key`);
  }
});

test('tracked public env templates use placeholders for sensitive credentials', () => {
  const generic = read('.env.example');
  const indexer = read('services/indexer-core/.env.example');
  const queryApi = read('services/query-api/.env.example');

  assert.match(generic, /^YELLOWSTONE_TOKEN=CHANGE_ME$/m);
  assert.match(generic, /^DB_PASSWORD=CHANGE_ME_DB_PASSWORD$/m);
  assert.match(generic, /^GRAFANA_PASSWORD=CHANGE_ME_GRAFANA_PASSWORD$/m);
  assert.match(generic, /^NEW_API_KEY=CHANGE_ME_AI_API_KEY$/m);

  assert.match(indexer, /^YELLOWSTONE_TOKEN=CHANGE_ME$/m);
  assert.match(indexer, /^EVENT_EMITTER_PROGRAM_ID=CHANGE_ME$/m);

  assert.match(queryApi, /^NEW_API_URL=https:\/\/your-openai-compatible-endpoint\.example\/v1$/m);
  assert.match(queryApi, /^NEW_API_KEY=sk-dev-change-me$/m);
  assert.match(queryApi, /^DRAFT_PROOF_ISSUER_SECRET=$/m);
  assert.match(queryApi, /^MEMBERSHIP_BRIDGE_ISSUER_SECRET=$/m);
});

test('internal-only env files and keypairs are not tracked by git', () => {
  for (const relativePath of internalOnlySensitiveFiles) {
    assert.equal(isTracked(relativePath), false, `${relativePath} should not be tracked`);
  }
});
