import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchNodeJson,
  resolveNodeRoute,
} from '../src/lib/config/nodeRouting.ts';

test('prefers node-advertised sidecar routing for sidecar-owned surfaces', async () => {
  const route = await resolveNodeRoute('source_materials', {
    bootstrapPublicBaseUrl: 'https://public.alcheme.test',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        node: {
          runtimeRole: 'PUBLIC_NODE',
          deploymentProfile: 'sovereign_private',
          publicBaseUrl: 'https://public.alcheme.test',
          sidecar: {
            configured: true,
            discoverable: true,
            baseUrl: 'https://sidecar.alcheme.test',
            proxyMode: 'none',
            authMode: 'session_cookie',
          },
          routing: {
            preferredSource: 'node_capabilities',
            publicNodeSafeApis: ['graphql', 'membership'],
            sidecarOwnedApis: ['source_materials', 'auth_session', 'discussion_runtime'],
            hostedOnlyExceptions: [],
          },
        },
      }),
    }),
  });

  assert.deepEqual(route, {
    surface: 'source_materials',
    urlBase: 'https://sidecar.alcheme.test',
    authMode: 'session_cookie',
    target: 'sidecar',
    proxyMode: 'none',
  });
});

test('keeps public-safe surfaces on the public node even when a sidecar is discoverable', async () => {
  const route = await resolveNodeRoute('membership', {
    bootstrapPublicBaseUrl: 'https://public.alcheme.test',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        node: {
          runtimeRole: 'PUBLIC_NODE',
          deploymentProfile: 'sovereign_private',
          publicBaseUrl: 'https://public.alcheme.test',
          sidecar: {
            configured: true,
            discoverable: true,
            baseUrl: 'https://sidecar.alcheme.test',
            proxyMode: 'none',
            authMode: 'session_cookie',
          },
          routing: {
            preferredSource: 'node_capabilities',
            publicNodeSafeApis: ['graphql', 'membership'],
            sidecarOwnedApis: ['source_materials', 'auth_session'],
            hostedOnlyExceptions: [],
          },
        },
      }),
    }),
  });

  assert.deepEqual(route, {
    surface: 'membership',
    urlBase: 'https://public.alcheme.test',
    authMode: 'session_cookie',
    target: 'public',
    proxyMode: 'none',
  });
});

test('fails explicitly when a sidecar-owned surface is requested from a public-node-only deployment', async () => {
  await assert.rejects(
    () => resolveNodeRoute('source_materials', {
      bootstrapPublicBaseUrl: 'https://public.alcheme.test',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          node: {
            runtimeRole: 'PUBLIC_NODE',
            deploymentProfile: 'public_node_only',
            publicBaseUrl: 'https://public.alcheme.test',
            sidecar: {
              configured: false,
              discoverable: false,
              baseUrl: null,
              proxyMode: 'none',
              authMode: 'session_cookie',
            },
            routing: {
              preferredSource: 'node_capabilities',
              publicNodeSafeApis: ['graphql', 'membership'],
              sidecarOwnedApis: ['source_materials', 'auth_session'],
              hostedOnlyExceptions: ['draft_working_copy'],
            },
          },
        }),
      }),
    }),
    /private_sidecar_required/i,
  );
});

test('falls back to the bootstrap public base when legacy capabilities omit the node block', async () => {
  const route = await resolveNodeRoute('auth_session', {
    bootstrapPublicBaseUrl: 'https://public.alcheme.test',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        generatedAt: '2026-03-27T00:00:00.000Z',
        capabilities: [],
      }),
    }),
  });

  assert.deepEqual(route, {
    surface: 'auth_session',
    urlBase: 'https://public.alcheme.test',
    authMode: 'session_cookie',
    target: 'public',
    proxyMode: 'none',
  });
});

test('sends credentials for session-cookie sidecar requests and bearer headers when requested', async () => {
  let captured = null;
  const payload = { ok: true };

  const result = await fetchNodeJson('discussion_runtime', '/api/v1/discussion/sessions/abc/refresh', {
    bootstrapPublicBaseUrl: 'https://public.alcheme.test',
    fetchImpl: async (input, init) => {
      captured = {
        url: String(input),
        init,
      };
      return {
        ok: true,
        json: async () => payload,
      };
    },
    resolveCapabilities: async () => ({
      runtimeRole: 'PUBLIC_NODE',
      deploymentProfile: 'sovereign_private',
      publicBaseUrl: 'https://public.alcheme.test',
      sidecar: {
        configured: true,
        discoverable: true,
        baseUrl: 'https://sidecar.alcheme.test',
        proxyMode: 'none',
        authMode: 'session_cookie',
      },
      routing: {
        preferredSource: 'node_capabilities',
        publicNodeSafeApis: ['graphql', 'membership'],
        sidecarOwnedApis: ['discussion_runtime'],
        hostedOnlyExceptions: [],
      },
    }),
    init: {
      method: 'POST',
      headers: {
        Authorization: 'Bearer discussion-token',
      },
      body: JSON.stringify({ ttlSec: 60 }),
    },
  });

  assert.deepEqual(result, payload);
  assert.equal(captured.url, 'https://sidecar.alcheme.test/api/v1/discussion/sessions/abc/refresh');
  assert.equal(captured.init.credentials, 'include');
  const headers = new Headers(captured.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer discussion-token');
  assert.equal(headers.get('x-alcheme-locale'), 'en');
});
