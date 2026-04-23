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

const { resolvePreferredActiveTierId } = require('../src/lib/circle/activeTierRestore.ts');

test('restores the saved auxiliary tier on the root circle route after reload', () => {
  const nextTierId = resolvePreferredActiveTierId({
    circleId: 110,
    routeTierId: '110',
    defaultTierId: '110',
    savedTierId: '126',
    requestedRouteTab: null,
    focusEnvelopeId: null,
    userCrystals: 0,
    subCircles: [
      {
        id: '110',
        tabs: ['plaza', 'crucible', 'sanctuary'],
        accessRequirement: { type: 'free' },
      },
      {
        id: '126',
        tabs: ['plaza', 'crucible', 'sanctuary'],
        accessRequirement: { type: 'free' },
      },
    ],
  });

  assert.equal(nextTierId, '126');
});

test('keeps the route tier when the saved auxiliary tier cannot satisfy the requested tab', () => {
  const nextTierId = resolvePreferredActiveTierId({
    circleId: 110,
    routeTierId: '110',
    defaultTierId: '110',
    savedTierId: '126',
    requestedRouteTab: 'feed',
    focusEnvelopeId: null,
    userCrystals: 0,
    subCircles: [
      {
        id: '110',
        tabs: ['plaza', 'feed'],
        accessRequirement: { type: 'free' },
      },
      {
        id: '126',
        tabs: ['plaza', 'crucible', 'sanctuary'],
        accessRequirement: { type: 'free' },
      },
    ],
  });

  assert.equal(nextTierId, '110');
});

test('ignores the saved auxiliary tier when it is still crystal-locked for the viewer', () => {
  const nextTierId = resolvePreferredActiveTierId({
    circleId: 110,
    routeTierId: '110',
    defaultTierId: '110',
    savedTierId: '126',
    requestedRouteTab: null,
    focusEnvelopeId: null,
    userCrystals: 1,
    subCircles: [
      {
        id: '110',
        tabs: ['plaza', 'crucible', 'sanctuary'],
        accessRequirement: { type: 'free' },
      },
      {
        id: '126',
        tabs: ['plaza', 'crucible', 'sanctuary'],
        accessRequirement: { type: 'crystal', minCrystals: 5 },
      },
    ],
  });

  assert.equal(nextTierId, '110');
});
