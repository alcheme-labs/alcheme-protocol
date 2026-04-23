import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('public docs include a minimal quickstart and explicit external reporting guidance', () => {
  const readme = read('README.md');
  const contributing = read('CONTRIBUTING.md');
  const security = read('SECURITY.md');
  const codeOfConduct = read('CODE_OF_CONDUCT.md');

  assert.match(readme, /^## Quickstart$/m);
  assert.match(readme, /Node\.js 20/i);
  assert.match(readme, /Rust/i);
  assert.match(readme, /Solana CLI 3\.0\.11/i);
  assert.match(readme, /Anchor CLI 0\.31\.1/i);
  assert.match(readme, /Postgres 16/i);
  assert.match(readme, /Redis 7/i);
  assert.match(readme, /scripts\/start-local-stack\.sh/);
  assert.match(readme, /currently validated against the toolchain matrix above/i);

  assert.match(contributing, /^## Prerequisites$/m);
  assert.match(contributing, /Node\.js 20/i);
  assert.match(contributing, /Rust/i);
  assert.match(contributing, /Solana CLI 3\.0\.11/i);
  assert.match(contributing, /Anchor CLI 0\.31\.1/i);
  assert.match(contributing, /Postgres 16/i);
  assert.match(contributing, /Redis 7/i);

  assert.match(security, /GitHub private vulnerability reporting/i);
  assert.match(security, /Do not announce the public repository until GitHub private vulnerability reporting is enabled there\./i);
  assert.doesNotMatch(security, /private coordination channel you already use/i);

  assert.match(codeOfConduct, /GitHub private reporting path documented in `SECURITY\.md`/);
  assert.doesNotMatch(codeOfConduct, /already established for the project/i);
});
