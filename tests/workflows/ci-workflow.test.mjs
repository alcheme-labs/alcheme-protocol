import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workflowPath = path.join(root, '.github/workflows/ci.yml');

test('ci workflow uses Node 20 for every setup-node invocation', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const matches = [...workflow.matchAll(/node-version: "(\d+)"/g)].map(([, version]) => version);

  assert.ok(matches.length > 0, 'expected at least one setup-node version');
  assert.deepEqual(matches, matches.map(() => '20'));
});
