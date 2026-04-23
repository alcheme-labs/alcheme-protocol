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

test('start-local-stack defines AI gateway env defaults for query-api runtime', () => {
  const source = readScript();

  assert.match(source, /ENV_FILE="\$\{ENV_FILE:-\$ROOT_DIR\/services\/query-api\/\.env\}"/);
  assert.match(source, /AI_MODE="\$\{AI_MODE:-builtin\}"/);
  assert.match(source, /AI_BUILTIN_TEXT_API="\$\{AI_BUILTIN_TEXT_API:-chat_completions\}"/);
  assert.match(source, /NEW_API_URL="\$\{NEW_API_URL:-\}"/);
  assert.match(source, /NEW_API_KEY="\$\{NEW_API_KEY:-\}"/);
  assert.match(source, /AI_EXTERNAL_URL="\$\{AI_EXTERNAL_URL:-\}"/);
});

test('start-local-stack loads dev env defaults without overriding explicit shell exports', () => {
  const source = readScript();

  assert.match(source, /load_env_file_defaults\(\)/);
  assert.match(source, /compgen -e/);
  assert.match(source, /restore_file="\$\(mktemp\)"/);
  assert.match(source, /printf 'export %s=%q\\n' "\$env_name" "\$\{!env_name\}" >> "\$restore_file"/);
  assert.match(source, /set -a/);
  assert.match(source, /source "\$env_file"/);
  assert.match(source, /source "\$restore_file"/);
  assert.match(source, /load_env_file_defaults "\$ENV_FILE"/);
});

test('start-local-stack warns when builtin AI gateway is missing or points at the frontend dev server', () => {
  const source = readScript();

  assert.match(source, /builtin AI gateway is unset; query-api will fall back to localhost:3000\/v1/);
  assert.match(source, /NEW_API_URL points at the frontend dev server; builtin AI calls will fail/);
});

test('start-local-stack explains that external AI mode expects a separate adapter service', () => {
  const source = readScript();

  assert.match(source, /AI_EXTERNAL_URL is unset while AI_MODE=external; this mode expects a separate AI adapter service implementing \/generate-text and \/embed/);
  assert.match(source, /this repo does not start one for you/);
});

test('start-local-stack forwards AI env vars into the query-api process env', () => {
  const source = readScript();

  assert.match(source, /AI_MODE=\\?"\$AI_MODE\\?"/);
  assert.match(source, /AI_BUILTIN_TEXT_API=\\?"\$AI_BUILTIN_TEXT_API\\?"/);
  assert.match(source, /NEW_API_URL=\\?"\$NEW_API_URL\\?"/);
  assert.match(source, /NEW_API_KEY=\\?"\$NEW_API_KEY\\?"/);
  assert.match(source, /AI_EXTERNAL_URL=\\?"\$AI_EXTERNAL_URL\\?"/);
});

test('start-local-stack derives and forwards membership bridge issuer defaults for local join finalization', () => {
  const source = readScript();

  assert.match(source, /resolve_membership_bridge_issuer_defaults\(\)/);
  assert.match(source, /MEMBERSHIP_BRIDGE_ISSUER_KEY_ID="\$\{MEMBERSHIP_BRIDGE_ISSUER_KEY_ID:-\}"/);
  assert.match(source, /MEMBERSHIP_BRIDGE_ISSUER_SECRET="\$\{MEMBERSHIP_BRIDGE_ISSUER_SECRET:-\}"/);
  assert.match(source, /MEMBERSHIP_BRIDGE_ISSUER_KEY_ID=\\?"\$MEMBERSHIP_BRIDGE_ISSUER_KEY_ID\\?"/);
  assert.match(source, /MEMBERSHIP_BRIDGE_ISSUER_SECRET=\\?"\$MEMBERSHIP_BRIDGE_ISSUER_SECRET\\?"/);
});

test('start-local-stack runs an optional AI smoke check after query-api starts', () => {
  const source = readScript();

  assert.match(source, /AI_SMOKE_CHECK_ON_START="\$\{AI_SMOKE_CHECK_ON_START:-true\}"/);
  assert.match(source, /AI_SMOKE_CHECK_STRICT="\$\{AI_SMOKE_CHECK_STRICT:-false\}"/);
  assert.match(source, /run_ai_smoke_check_optional\(\)/);
  assert.match(source, /tsx scripts\/ai-smoke-check\.ts/);
  assert.match(source, /ai-smoke-check\.log/);
});
