import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filePath), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'membership-attestor-registry.mjs');

function readScript() {
  assert.equal(fs.existsSync(scriptPath), true, `missing file: ${scriptPath}`);
  return fs.readFileSync(scriptPath, 'utf8');
}

test('membership attestor rollout script keeps show/init free of event-emitter dependencies', () => {
  const source = readScript();

  assert.match(source, /async function deriveBaseContext\(args\)/);
  assert.match(source, /async function deriveEventContext\(args\)/);
  assert.match(source, /const \{ program, membershipAttestorRegistry \} = await deriveBaseContext\(args\);/);
  assert.match(source, /const \{ program, circleManager, membershipAttestorRegistry, provider \} = await deriveBaseContext\(args\);/);
  assert.match(source, /const \{\s*program,\s*eventProgram,\s*membershipAttestorRegistry,\s*provider,\s*eventEmitter,\s*eventBatch,\s*\} = await deriveEventContext\(args\);/s);
});
