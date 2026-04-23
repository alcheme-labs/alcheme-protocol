import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveExtensionGateConfig,
  shouldExposeExtensionEntry,
} from '../src/lib/config/extensions.ts';

test('gate stays closed by default', () => {
  const config = resolveExtensionGateConfig({});
  assert.equal(config.enabled, false);
  assert.deepEqual(config.allowlist, []);
});

test('gate parses allowlist and approved contribution-engine url', () => {
  const config = resolveExtensionGateConfig({
    NEXT_PUBLIC_EXTENSION_GATE_ENABLED: 'true',
    NEXT_PUBLIC_EXTENSION_ALLOWLIST: 'contribution-engine, other-ext ',
    NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL: 'https://apps.example/contribution-engine',
  });

  assert.equal(config.enabled, true);
  assert.deepEqual(config.allowlist, ['contribution-engine', 'other-ext']);
  assert.equal(config.contributionEngineUrl, 'https://apps.example/contribution-engine');
});

test('gate reads NEXT_PUBLIC config from process.env when no override is provided', () => {
  const previousEnabled = process.env.NEXT_PUBLIC_EXTENSION_GATE_ENABLED;
  const previousAllowlist = process.env.NEXT_PUBLIC_EXTENSION_ALLOWLIST;
  const previousUrl = process.env.NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL;

  process.env.NEXT_PUBLIC_EXTENSION_GATE_ENABLED = 'true';
  process.env.NEXT_PUBLIC_EXTENSION_ALLOWLIST = 'contribution-engine';
  process.env.NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL = 'https://apps.example/contribution-engine';

  const config = resolveExtensionGateConfig();

  assert.equal(config.enabled, true);
  assert.deepEqual(config.allowlist, ['contribution-engine']);
  assert.equal(config.contributionEngineUrl, 'https://apps.example/contribution-engine');

  process.env.NEXT_PUBLIC_EXTENSION_GATE_ENABLED = previousEnabled;
  process.env.NEXT_PUBLIC_EXTENSION_ALLOWLIST = previousAllowlist;
  process.env.NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL = previousUrl;
});

test('only allowlisted entries are exposed when gate is enabled', () => {
  const config = resolveExtensionGateConfig({
    NEXT_PUBLIC_EXTENSION_GATE_ENABLED: 'true',
    NEXT_PUBLIC_EXTENSION_ALLOWLIST: 'contribution-engine',
  });

  assert.equal(shouldExposeExtensionEntry(config, 'contribution-engine'), true);
  assert.equal(shouldExposeExtensionEntry(config, 'unknown-ext'), false);
});
