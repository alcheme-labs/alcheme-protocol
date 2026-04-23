import test from 'node:test';
import assert from 'node:assert/strict';

import {
  messageMatchesSemanticFacetFilters,
  mergePlazaDiscussionMessages,
  sortPlazaMessagesChronologically,
} from '../src/lib/circle/plazaDiscussion.ts';

test('semantic facet filters match newly added problem and criteria labels', () => {
  const message = {
    id: 10,
    semanticFacets: ['problem', 'criteria'],
    messageKind: 'plain',
  };

  assert.equal(messageMatchesSemanticFacetFilters(message, []), true);
  assert.equal(messageMatchesSemanticFacetFilters(message, ['problem']), true);
  assert.equal(messageMatchesSemanticFacetFilters(message, ['criteria']), true);
  assert.equal(messageMatchesSemanticFacetFilters(message, ['proposal']), false);
});

test('candidate and governance notices stay visible regardless of active facet filters', () => {
  const notice = {
    id: 11,
    semanticFacets: [],
    messageKind: 'draft_candidate_notice',
  };

  assert.equal(messageMatchesSemanticFacetFilters(notice, ['problem']), true);
});

test('chronological sorting prefers original createdAt over newer lamport values', () => {
  const messages = [
    {
      id: 300,
      lamport: 300,
      createdAt: '2026-04-06T10:10:00.000Z',
      clientTimestamp: '2026-04-06T10:10:00.000Z',
      text: 'later',
    },
    {
      id: 999,
      lamport: 999,
      createdAt: '2026-04-06T10:00:00.000Z',
      clientTimestamp: '2026-04-06T10:00:00.000Z',
      text: 'earlier but reanalyzed',
    },
  ];

  const sorted = sortPlazaMessagesChronologically(messages);

  assert.deepEqual(sorted.map((message) => message.text), [
    'earlier but reanalyzed',
    'later',
  ]);
});

test('merge keeps optimistic messages while restoring chronological order', () => {
  const merged = mergePlazaDiscussionMessages({
    serverMessages: [
      {
        id: 25,
        lamport: 25,
        envelopeId: 'env-server',
        createdAt: '2026-04-06T10:01:00.000Z',
        clientTimestamp: '2026-04-06T10:01:00.000Z',
        text: 'server',
      },
    ],
    optimisticMessages: [
      {
        id: 26,
        lamport: 26,
        createdAt: null,
        clientTimestamp: '2026-04-06T10:02:00.000Z',
        text: 'optimistic',
      },
    ],
  });

  assert.deepEqual(merged.map((message) => message.text), ['server', 'optimistic']);
});
