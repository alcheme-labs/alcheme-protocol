import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExtensionCapabilityCardModel } from '../src/lib/extensions/normalize.ts';

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

test('available state exposes launch CTA', () => {
  const model = buildExtensionCapabilityCardModel(entry, {
    state: 'available',
    reasonCode: null,
    indexedSlot: 42,
  });

  assert.equal(model.cta.enabled, true);
  assert.equal(model.cta.label, '打开应用');
});

test('disabled state maps governance suspension copy', () => {
  const model = buildExtensionCapabilityCardModel(entry, {
    state: 'disabled',
    reasonCode: 'suspended_by_governance',
    indexedSlot: 42,
  });

  assert.equal(model.cta.enabled, false);
  assert.match(model.message, /暂停接入/);
});

test('temporarily unavailable state keeps retry hint', () => {
  const model = buildExtensionCapabilityCardModel(entry, {
    state: 'temporarily_unavailable',
    reasonCode: 'runtime_lookup_failed',
    indexedSlot: 42,
  });

  assert.equal(model.cta.enabled, false);
  assert.equal(model.showRetry, true);
  assert.match(model.message, /暂不可确认/);
});

test('missing pilot href is treated as misconfigured card', () => {
  const model = buildExtensionCapabilityCardModel({ ...entry, href: null }, {
    state: 'available',
    reasonCode: null,
    indexedSlot: 42,
  });

  assert.equal(model.state, 'misconfigured');
  assert.match(model.message, /待配置/);
});

test('not registered stays visible with explicit copy', () => {
  const model = buildExtensionCapabilityCardModel(entry, {
    state: 'not_registered',
    reasonCode: null,
    indexedSlot: 42,
  });

  assert.equal(model.cta.enabled, false);
  assert.match(model.message, /尚未完成接入/);
});
