import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test('public toolchain matrix is aligned across Anchor config, workflows, and JS packages', () => {
  const anchorToml = read('Anchor.toml');
  const ciWorkflow = read('.github/workflows/ci.yml');
  const securityWorkflow = read('.github/workflows/security-audit.yml');
  const rootPackage = readJson('package.json');
  const sdkPackage = readJson('sdk/package.json');
  const frontendPackage = readJson('frontend/package.json');

  assert.match(anchorToml, /anchor_version = "0\.31\.1"/);
  assert.match(anchorToml, /solana_version = "3\.0\.11"/);

  assert.equal(rootPackage.dependencies['@coral-xyz/anchor'], '^0.31.1');
  assert.equal(sdkPackage.dependencies['@coral-xyz/anchor'], '^0.31.1');
  assert.equal(frontendPackage.dependencies['@coral-xyz/anchor'], '^0.31.1');

  assert.match(ciWorkflow, /https:\/\/release\.anza\.xyz\/v3\.0\.11\/install/);
  assert.match(
    ciWorkflow,
    /cargo install --git https:\/\/github\.com\/solana-foundation\/anchor --tag v0\.31\.1 anchor-cli --locked/,
  );
  assert.match(
    securityWorkflow,
    /cargo install --git https:\/\/github\.com\/solana-foundation\/anchor --tag v0\.31\.1 anchor-cli --locked/,
  );
});
