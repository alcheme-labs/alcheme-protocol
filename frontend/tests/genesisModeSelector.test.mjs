import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const sheetPath = path.join(frontendRoot, 'src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx');

function readSource() {
  assert.equal(fs.existsSync(sheetPath), true, `missing file: ${sheetPath}`);
  return fs.readFileSync(sheetPath, 'utf8');
}

test('CreateCircleSheet exposes BLANK and SEEDED genesis mode choices instead of hardcoding BLANK only', () => {
  const source = readSource();

  assert.match(source, /genesisMode/);
  assert.match(source, /BLANK/);
  assert.match(source, /SEEDED/);
  assert.doesNotMatch(source, /genesisMode:\s*'BLANK'/);
});
