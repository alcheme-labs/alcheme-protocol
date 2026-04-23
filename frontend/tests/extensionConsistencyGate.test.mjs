import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeExtensionCapabilityState,
  buildExtensionCapabilityCardModel,
} from '../src/lib/extensions/normalize.ts';

const catalog = {
  manifestSource: 'configured',
  manifestReason: null,
  consistency: {
    indexerId: 'indexer-test',
    readCommitment: 'confirmed',
    indexedSlot: 98765,
    stale: true,
  },
};

const capability = {
  extensionId: 'contribution-engine',
  displayName: 'Contribution Engine',
  programId: 'Contrib11111111111111111111111111111111111',
  version: '1.0.0',
  parserVersion: 'v1',
  status: 'active',
  reason: null,
  sdkPackage: '@alcheme/sdk',
  requiredPermissions: ['ReputationWrite'],
  tags: [],
  runtime: {
    registered: true,
    enabled: true,
    permissions: ['ReputationWrite'],
    source: 'chain',
    registrationStatus: 'registered_enabled',
    reason: null,
  },
  indexedSlot: 98765,
  stale: true,
};

const entry = {
  extensionId: 'contribution-engine',
  title: '贡献引擎',
  description: '把贡献沉淀为可结算的积分。',
  surface: 'home',
  href: 'https://apps.example/contribution-engine',
  icon: 'sparkles',
  visibility: 'public',
  type: 'external',
};

test('stale capability is normalized as syncing and explains latest indexed slot', () => {
  const normalized = normalizeExtensionCapabilityState(catalog, capability);
  const model = buildExtensionCapabilityCardModel(entry, normalized);

  assert.equal(normalized.state, 'syncing');
  assert.equal(model.showRetry, true);
  assert.match(model.meta, /98765/);
});
