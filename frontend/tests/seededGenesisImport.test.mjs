import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');

function read(relativePath) {
  const targetPath = path.join(frontendRoot, relativePath);
  assert.equal(fs.existsSync(targetPath), true, `missing file: ${targetPath}`);
  return fs.readFileSync(targetPath, 'utf8');
}

test('SEEDED create flow reads uploaded source files and forwards seededSources to the create hook', () => {
  const sheetSource = read('src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx');
  const hookSource = read('src/hooks/useCreateCircle.ts');

  assert.match(sheetSource, /type="file"/);
  assert.match(sheetSource, /multiple/);
  assert.match(sheetSource, /seededSources/);
  assert.match(sheetSource, /file\.text\(\)/);

  assert.match(hookSource, /seededSources\?:/);
  assert.match(hookSource, /importSeededSources/);
});

test('current seeded flow stays on single-document working copy instead of introducing multi-file draft editing', () => {
  const hookSource = read('src/hooks/useCreateCircle.ts');
  const sheetSource = read('src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx');

  assert.doesNotMatch(hookSource, /workingCopyFiles|multiFileWorkingCopy|draftFiles/);
  assert.doesNotMatch(sheetSource, /workingCopyFiles|multiFileWorkingCopy|draftFiles/);
});
