import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scriptPath = path.join(root, 'scripts/export-public-repo.sh');

test('public export script keeps collaboration docs and strips local frontend artifacts', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const excludeBlock = script.match(/EXCLUDE_PATHS=\(([\s\S]*?)\n\)/)?.[1] ?? '';

  assert.match(script, /"CONTRIBUTING\.md"/);
  assert.match(script, /"SECURITY\.md"/);
  assert.match(script, /"CODE_OF_CONDUCT\.md"/);
  assert.match(script, /"SUPPORT\.md"/);
  assert.doesNotMatch(excludeBlock, /"CONTRIBUTING\.md"/);
  assert.match(script, /--exclude '\.env\.local'/);
  assert.match(script, /--exclude '\.next-\*\/'/);
  assert.match(script, /--exclude 'playwright-report\/'/);
  assert.match(script, /--exclude '\*\.tsbuildinfo'/);
  assert.match(script, /-name '\.next-\*'/);
  assert.match(script, /-name 'playwright-report'/);
});
