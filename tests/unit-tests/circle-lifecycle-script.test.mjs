import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(filePath), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'circle-lifecycle.mjs');

function readScript() {
  assert.equal(fs.existsSync(scriptPath), true, `missing file: ${scriptPath}`);
  return fs.readFileSync(scriptPath, 'utf8');
}

test('circle lifecycle script exposes show/migrate/archive/restore commands with explicit circle-id parsing', () => {
  const source = readScript();

  assert.match(source, /node scripts\/circle-lifecycle\.mjs show --circle-id <id>/);
  assert.match(source, /node scripts\/circle-lifecycle\.mjs migrate --circle-id <id>/);
  assert.match(source, /node scripts\/circle-lifecycle\.mjs archive --circle-id <id> --reason/);
  assert.match(source, /node scripts\/circle-lifecycle\.mjs restore --circle-id <id>/);
  assert.match(source, /circleId: null/);
  assert.match(source, /if \(value === "--circle-id"\)/);
  assert.match(source, /const circleId = Number\.parseInt\(args\.circleId, 10\);/);
});

test('circle lifecycle script keeps show and migrate free of event-emitter dependencies while archive and restore use them', () => {
  const source = readScript();

  assert.match(source, /async function deriveBaseContext\(args\)/);
  assert.match(source, /async function deriveEventContext\(args\)/);
  assert.match(source, /const \{ program, circle, circleManager \} = await deriveBaseContext\(args\);/);
  assert.match(source, /async function migrateCircle\(args\)/);
  assert.match(source, /\.migrateCircleLifecycle\(circleId\)/);
  assert.match(source, /if \(args\.command === "migrate"\)/);
  assert.match(source, /const \{\s*program,\s*circle,\s*circleManager,\s*provider,\s*eventProgram,\s*eventEmitter,\s*eventBatch,\s*\} = await deriveEventContext\(args\);/s);
  assert.match(source, /\.archiveCircle\(reason\)/);
  assert.match(source, /\.restoreCircle\(\)/);
});
