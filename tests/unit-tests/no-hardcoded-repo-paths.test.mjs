import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const forbidden = ['Users', 'taiyi', 'Desktop', 'Project', 'Future', 'web3', 'alcheme-protocol'].join('/');
const filesToCheck = [
  'scripts/audit-node-license-risk.mjs',
  'tests/unit-tests/export-public-repo-hygiene.test.mjs',
  'tests/unit-tests/tracked-env-template-hygiene.test.mjs',
  'tests/unit-tests/devnet-demo-packaging.test.mjs',
  'tests/unit-tests/sdk-packaging-contract.test.mjs',
  'tests/unit-tests/crucible-discussion-language.test.ts',
  'tests/unit-tests/crucible-issue-carry.test.ts',
  'tests/unit-tests/crucible-inline-notes-panel.test.ts',
  'tests/unit-tests/crucible-collaboration-regression.test.ts',
  'tests/workflows/ci-workflow.test.mjs',
  'tests/workflows/security-audit-workflow.test.mjs',
];

test('repo scripts and tests do not hardcode a workstation-specific repository path', () => {
  for (const relativePath of filesToCheck) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    assert.doesNotMatch(source, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), relativePath);
  }
});
