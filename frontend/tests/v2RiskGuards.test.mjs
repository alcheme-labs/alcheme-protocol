import test from 'node:test';
import assert from 'node:assert/strict';

import { assertV2ByIdTargetIsPublicActive } from '../src/lib/content/v2RiskGuards.ts';

test('assertV2ByIdTargetIsPublicActive rejects non-200 lookup', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
  });

  try {
    await assert.rejects(
      () => assertV2ByIdTargetIsPublicActive('123', 'reply'),
      /不可用或尚未索引/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('assertV2ByIdTargetIsPublicActive rejects non-public or inactive target', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ visibility: 'CircleOnly', status: 'Draft' }),
  });

  try {
    await assert.rejects(
      () => assertV2ByIdTargetIsPublicActive('456', 'repost'),
      /Public 且 Active\/Published/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('assertV2ByIdTargetIsPublicActive passes for public active target', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ visibility: 'Public', status: 'Active' }),
  });

  try {
    await assert.doesNotReject(
      () => assertV2ByIdTargetIsPublicActive('789', 'reply'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
