import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apiFetch,
  withRequestLocaleHeaders,
} from '../src/lib/api/fetch.ts';

test('apiFetch adds the active locale header to Alcheme API requests', async () => {
  let captured;
  await apiFetch('https://api.alcheme.test/api/v1/membership/circles/7/identity-status', {
    locale: 'en',
    fetchImpl: async (input, init) => {
      captured = { input, init };
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(captured.input, 'https://api.alcheme.test/api/v1/membership/circles/7/identity-status');
  assert.equal(new Headers(captured.init.headers).get('x-alcheme-locale'), 'en');
});

test('apiFetch preserves an explicit locale header', async () => {
  let captured;
  await apiFetch('https://api.alcheme.test/api/v1/membership/circles/7/identity-status', {
    locale: 'en',
    init: {
      headers: {
        'x-alcheme-locale': 'fr',
      },
    },
    fetchImpl: async (input, init) => {
      captured = { input, init };
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(new Headers(captured.init.headers).get('x-alcheme-locale'), 'fr');
});

test('apiFetch does not add the internal locale header to unrelated external APIs', async () => {
  let captured;
  await apiFetch('https://example.com/api/v1/something', {
    locale: 'en',
    alchemeApi: false,
    fetchImpl: async (input, init) => {
      captured = { input, init };
      return new Response('{}', { status: 200 });
    },
  });

  assert.equal(new Headers(captured.init?.headers).has('x-alcheme-locale'), false);
});

test('withRequestLocaleHeaders can be reused by GraphQL and explicit clients', () => {
  const headers = withRequestLocaleHeaders({
    accept: 'application/json',
  }, 'es');

  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(headers.get('x-alcheme-locale'), 'es');
});
