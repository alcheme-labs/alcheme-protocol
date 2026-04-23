import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
process.env.TS_NODE_PROJECT = path.join(frontendRoot, 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'commonjs',
  moduleResolution: 'node',
  allowImportingTsExtensions: true,
});

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { normalizeCircleRouteTab } = require('../src/lib/circle/routeTabs.ts');

test('keeps current internal circle tab keys stable', () => {
  assert.equal(normalizeCircleRouteTab('plaza'), 'plaza');
  assert.equal(normalizeCircleRouteTab('feed'), 'feed');
  assert.equal(normalizeCircleRouteTab('crucible'), 'crucible');
  assert.equal(normalizeCircleRouteTab('sanctuary'), 'sanctuary');
});

test('accepts legacy human-facing aliases for discussion, drafts, and knowledge routes', () => {
  assert.equal(normalizeCircleRouteTab('discussion'), 'plaza');
  assert.equal(normalizeCircleRouteTab('draft'), 'crucible');
  assert.equal(normalizeCircleRouteTab('drafts'), 'crucible');
  assert.equal(normalizeCircleRouteTab('knowledge'), 'sanctuary');
});

test('normalizes casing and ignores unknown tab values', () => {
  assert.equal(normalizeCircleRouteTab(' Drafts '), 'crucible');
  assert.equal(normalizeCircleRouteTab('DISCUSSION'), 'plaza');
  assert.equal(normalizeCircleRouteTab('unknown'), null);
  assert.equal(normalizeCircleRouteTab(null), null);
});
