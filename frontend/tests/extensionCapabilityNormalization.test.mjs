import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeExtensionCapabilityState } from '../src/lib/extensions/normalize.ts';

const baseCatalog = {
  manifestSource: 'configured',
  manifestReason: null,
  consistency: {
    indexerId: 'indexer-test',
    readCommitment: 'confirmed',
    indexedSlot: 12345,
    stale: false,
  },
};

const baseCapability = {
  extensionId: 'contribution-engine',
  displayName: 'Contribution Engine',
  programId: 'Contrib11111111111111111111111111111111111',
  version: '1.0.0',
  parserVersion: 'v1',
  status: 'active',
  reason: null,
  sdkPackage: '@alcheme/sdk',
  requiredPermissions: ['ReputationWrite'],
  tags: ['knowledge'],
  runtime: {
    registered: true,
    enabled: true,
    permissions: ['ReputationWrite'],
    source: 'chain',
    registrationStatus: 'registered_enabled',
    reason: null,
  },
  indexedSlot: 12345,
  stale: false,
};

test('normalizes manifest root problems as misconfigured', () => {
  const state = normalizeExtensionCapabilityState(
    { ...baseCatalog, manifestSource: 'missing', manifestReason: 'manifest_root_missing' },
    baseCapability,
  );

  assert.equal(state.state, 'misconfigured');
  assert.equal(state.reasonCode, 'manifest_root_missing');
});

test('normalizes suspended manifest status as disabled before runtime enabled', () => {
  const state = normalizeExtensionCapabilityState(
    baseCatalog,
    { ...baseCapability, status: 'suspended', reason: 'suspended_by_governance' },
  );

  assert.equal(state.state, 'disabled');
  assert.equal(state.reasonCode, 'suspended_by_governance');
});

test('normalizes registered disabled runtime as disabled', () => {
  const state = normalizeExtensionCapabilityState(
    baseCatalog,
    {
      ...baseCapability,
      runtime: {
        ...baseCapability.runtime,
        enabled: false,
        registrationStatus: 'registered_disabled',
      },
    },
  );

  assert.equal(state.state, 'disabled');
  assert.equal(state.reasonCode, 'registered_disabled');
});

test('normalizes stale enabled capability as syncing', () => {
  const state = normalizeExtensionCapabilityState(
    { ...baseCatalog, consistency: { ...baseCatalog.consistency, stale: true } },
    baseCapability,
  );

  assert.equal(state.state, 'syncing');
});

test('normalizes active but not registered capability as not_registered', () => {
  const state = normalizeExtensionCapabilityState(
    baseCatalog,
    {
      ...baseCapability,
      runtime: {
        registered: false,
        enabled: null,
        permissions: null,
        source: 'chain',
        registrationStatus: 'not_registered',
        reason: null,
      },
    },
  );

  assert.equal(state.state, 'not_registered');
});

test('normalizes active registered enabled capability as available', () => {
  const state = normalizeExtensionCapabilityState(baseCatalog, baseCapability);
  assert.equal(state.state, 'available');
});
