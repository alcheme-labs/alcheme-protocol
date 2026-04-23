import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath = path.join(root, '.github/workflows/security-audit.yml');
const scriptPath = path.join(root, 'scripts/run-solana-security-audit.sh');
const licenseAuditScriptPath = path.join(root, 'scripts/audit-node-license-risk.mjs');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('security-audit workflow routes npm audit through real working directories', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /working-directory: \$\{\{ matrix\.working_directory \}\}/);
  assert.match(workflow, /- service: query-api\s+working_directory: services\/query-api/);
  assert.match(workflow, /- service: sdk\s+working_directory: sdk/);
  assert.doesNotMatch(workflow, /working-directory: services\/\$\{\{ matrix\.service \}\}/);
});

test('security-audit workflow executes a dedicated Solana security audit script instead of a TODO placeholder', () => {
  const workflow = read(workflowPath);
  const script = read(scriptPath);

  assert.doesNotMatch(workflow, /TODO - Integrate Soteria/);
  assert.match(workflow, /bash scripts\/run-solana-security-audit\.sh/);
  assert.match(script, /cargo clippy --workspace --all-targets --all-features -- -D warnings/);
  assert.match(script, /anchor build/);
  assert.match(script, /grep -R -n "\\.unwrap\(\)" programs shared/);
});

test('security-audit workflow publishes a dedicated node license audit report', () => {
  const workflow = read(workflowPath);
  const script = read(licenseAuditScriptPath);

  assert.match(workflow, /license-audit:/);
  assert.match(
    workflow,
    /node scripts\/audit-node-license-risk\.mjs --json license-audit-report\.json --fail-on-strong --fail-on-unapproved-watchlist/
  );
  assert.match(workflow, /name: license-audit-report/);
  assert.match(workflow, /\| License Audit \| \$\{\{ needs\.license-audit\.result \}\} \|/);
  assert.match(script, /const STRONG_COPYLEFT =/);
  assert.match(script, /const WATCHLIST =/);
  assert.match(script, /const POLICY_PATH =/);
  assert.match(script, /approvedWatchlistRules/);
});
