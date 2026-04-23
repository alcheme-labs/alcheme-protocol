import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'mocha';
import { Keypair } from '@solana/web3.js';

const filePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filePath), '..', '..', '..');
const extensionRoot = path.join(repoRoot, 'extensions', 'contribution-engine');
const expectedProgramId = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'target', 'deploy', 'contribution_engine-keypair.json'), 'utf8'),
    ),
  ),
).publicKey.toBase58();

function read(filePath: string): string {
  assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

describe('contribution-engine program id sync', () => {
  it('keeps Rust declare_id, manifest, README and source idls aligned to deploy keypair', () => {
    const rustSource = read(path.join(extensionRoot, 'program', 'src', 'lib.rs'));
    const manifest = JSON.parse(read(path.join(extensionRoot, 'extension.manifest.json')));
    const readme = read(path.join(extensionRoot, 'README.md'));
    const trackerIdl = JSON.parse(read(path.join(extensionRoot, 'tracker', 'idl', 'contribution_engine.json')));
    const coreSdkIdl = JSON.parse(read(path.join(repoRoot, 'sdk', 'src', 'idl', 'contribution_engine.json')));

    const rustDeclareId = rustSource.match(/declare_id!\(\"([^\"]+)\"\)/)?.[1] ?? null;

    assert.equal(rustDeclareId, expectedProgramId);
    assert.equal(manifest.program_id, expectedProgramId);
    assert.match(readme, new RegExp(expectedProgramId));
    assert.equal(trackerIdl.address, expectedProgramId);
    assert.equal(coreSdkIdl.address, expectedProgramId);
  });
});
