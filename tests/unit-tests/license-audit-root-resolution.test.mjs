import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceScriptPath = path.join(repoRoot, 'scripts/audit-node-license-risk.mjs');

test('license audit script audits the checkout it is executed from', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'license-audit-root-'));
  const scriptsDir = path.join(tempRoot, 'scripts');
  const configDir = path.join(tempRoot, 'config');

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  fs.copyFileSync(sourceScriptPath, path.join(scriptsDir, 'audit-node-license-risk.mjs'));
  fs.writeFileSync(
    path.join(configDir, 'license-audit-policy.json'),
    JSON.stringify(
      {
        version: 1,
        defaultPolicy: {
          strongCopyleft: 'forbid',
          watchlist: 'review',
        },
        approvedWatchlistRules: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(tempRoot, 'package-lock.json'),
    JSON.stringify(
      {
        name: 'fixture-root',
        lockfileVersion: 3,
        packages: {
          '': {
            name: 'fixture-root',
            version: '1.0.0',
          },
          'node_modules/fixture-strong-license': {
            version: '1.0.0',
            license: 'AGPL-3.0-or-later',
          },
        },
      },
      null,
      2,
    ),
  );

  const output = execFileSync('node', [path.join(scriptsDir, 'audit-node-license-risk.mjs')], {
    cwd: tempRoot,
    encoding: 'utf8',
  });

  assert.match(output, /Strong copyleft findings: 1/);
  assert.match(output, /fixture-strong-license@1\.0\.0/);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
