import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildExtensionCapabilitiesUrl,
  fetchExtensionCapabilities,
} from '../src/lib/extensions/api.ts';

test('builds capabilities url from graphql origin', () => {
  assert.equal(
    buildExtensionCapabilitiesUrl('http://127.0.0.1:4100/graphql'),
    'http://127.0.0.1:4100/api/v1/extensions/capabilities',
  );
});

test('fetches capabilities catalog through injected fetch', async () => {
  let requestedUrl = null;
  let requestedInit = null;
  const payload = { generatedAt: '2026-03-07T00:00:00.000Z', capabilities: [] };

  const result = await fetchExtensionCapabilities({
    graphqlEndpoint: 'http://127.0.0.1:4100/graphql',
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return {
        ok: true,
        json: async () => payload,
      };
    },
  });

  assert.equal(requestedUrl, 'http://127.0.0.1:4100/api/v1/extensions/capabilities');
  assert.equal(requestedInit.cache, 'no-store');
  const headers = new Headers(requestedInit.headers);
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(headers.get('x-alcheme-locale'), 'en');
  assert.deepEqual(result, payload);
});

test('throws a stable error when capability fetch fails', async () => {
  await assert.rejects(
    () => fetchExtensionCapabilities({
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    /extension capability request failed: 503/i,
  );
});
