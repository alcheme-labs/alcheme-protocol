import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_QUERY_API_GRAPHQL_URL,
    getQueryApiBaseUrl,
} from '../src/lib/config/queryApiBase.ts';

test('query api base defaults to 127.0.0.1 origin', () => {
    assert.equal(DEFAULT_QUERY_API_GRAPHQL_URL, 'http://127.0.0.1:4000/graphql');
    assert.equal(getQueryApiBaseUrl(undefined), 'http://127.0.0.1:4000');
});

test('query api base derives origin from explicit graphql endpoint', () => {
    assert.equal(
        getQueryApiBaseUrl('http://127.0.0.1:4100/graphql'),
        'http://127.0.0.1:4100',
    );
});

test('query api base falls back to 127.0.0.1 when endpoint is malformed', () => {
    assert.equal(getQueryApiBaseUrl('not-a-url'), 'http://127.0.0.1:4000');
});
