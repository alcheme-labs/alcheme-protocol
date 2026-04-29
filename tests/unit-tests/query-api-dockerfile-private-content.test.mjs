import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dockerfilePath = path.join(repoRoot, 'services', 'query-api', 'Dockerfile');

function readDockerfile() {
  assert.equal(fs.existsSync(dockerfilePath), true, `missing file: ${dockerfilePath}`);
  return fs.readFileSync(dockerfilePath, 'utf8');
}

test('query-api runtime image prepares writable local private content storage for node user', () => {
  const source = readDockerfile();
  const userNodeIndex = source.indexOf('USER node');
  assert.notEqual(userNodeIndex, -1, 'query-api runtime image should switch to node user');

  const beforeUserNode = source.slice(0, userNodeIndex);
  assert.match(beforeUserNode, /mkdir -p \/var\/lib\/alcheme\/private-content/);
  assert.match(beforeUserNode, /chown -R node:node [^\n]*\/var\/lib\/alcheme/);
});
