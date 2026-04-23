import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const hookPath = path.join(frontendRoot, 'src/hooks/useCreateCircle.ts');
const circlesPagePath = path.join(frontendRoot, 'src/app/(main)/circles/page.tsx');
const circleDetailPath = path.join(frontendRoot, 'src/app/(main)/circles/[id]/page.tsx');

function read(targetPath) {
  assert.equal(fs.existsSync(targetPath), true, `missing file: ${targetPath}`);
  return fs.readFileSync(targetPath, 'utf8');
}

test('useCreateCircle keeps genesisMode in the create contract and syncs it after creation', () => {
  const source = read(hookPath);

  assert.match(source, /genesisMode\?: 'BLANK' \| 'SEEDED'/);
  assert.match(source, /updateCircleGenesisMode/);
  assert.match(source, /genesisMode: options\.genesisMode/);
});

test('both primary create entrypoints forward data.genesisMode instead of dropping it', () => {
  const circlesPage = read(circlesPagePath);
  const circleDetailPage = read(circleDetailPath);

  assert.match(circlesPage, /genesisMode: data\.genesisMode/);
  assert.match(circleDetailPage, /genesisMode: data\.genesisMode/);
});
