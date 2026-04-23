import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDiscussionSessionAuthError,
  runWithDiscussionSessionRecovery,
} from '../src/lib/discussion/sessionRecovery.ts';

test('detects stale discussion session auth failures from API errors', () => {
  assert.equal(
    isDiscussionSessionAuthError(new Error('send discussion message failed: 401 {"error":"discussion_session_not_found"}')),
    true,
  );
  assert.equal(
    isDiscussionSessionAuthError(new Error('send discussion message failed: 401 {"error":"invalid_discussion_session_token"}')),
    true,
  );
  assert.equal(
    isDiscussionSessionAuthError(new Error('send discussion message failed: 500 {"error":"database_down"}')),
    false,
  );
});

test('recovers from a stale discussion token by clearing session state and retrying with a fresh token', async () => {
  const tokenRequests = [];
  const sendAttempts = [];
  let resetCount = 0;

  const result = await runWithDiscussionSessionRecovery({
    useSessionTokenAuth: true,
    getToken: async (options) => {
      tokenRequests.push(options?.forceNew === true ? 'fresh' : 'cached');
      return options?.forceNew === true ? 'fresh-token' : 'stale-token';
    },
    resetSession: () => {
      resetCount += 1;
    },
    run: async (token) => {
      sendAttempts.push(token);
      if (token === 'stale-token') {
        throw new Error('send discussion message failed: 401 {"error":"discussion_session_not_found"}');
      }
      return 'sent';
    },
  });

  assert.equal(result, 'sent');
  assert.deepEqual(tokenRequests, ['cached', 'fresh']);
  assert.deepEqual(sendAttempts, ['stale-token', 'fresh-token']);
  assert.equal(resetCount, 1);
});

