import test from 'node:test';
import assert from 'node:assert/strict';

import { submitFeedReply } from '../src/lib/feed/replyComposer.ts';

test('rejects empty reply drafts before calling write path', async () => {
  let called = false;

  const result = await submitFeedReply({
    parentContentId: 'root_post',
    circleId: 8,
    draft: '   ',
    createReply: async () => {
      called = true;
      return 'sig';
    },
    refreshThread: async () => {},
    refreshFeed: async () => {},
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /不能为空/);
});

test('submits reply against the selected root post and refreshes read models', async () => {
  const calls = [];

  const result = await submitFeedReply({
    parentContentId: 'root_post',
    circleId: 8,
    draft: '这条回复应该仍然属于当前动态。',
    createReply: async (input) => {
      calls.push(['create', input]);
      return 'sig_123';
    },
    refreshThread: async () => {
      calls.push(['thread']);
    },
    refreshFeed: async () => {
      calls.push(['feed']);
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    ['create', {
      parentContentId: 'root_post',
      circleId: 8,
      text: '这条回复应该仍然属于当前动态。',
    }],
    ['thread'],
    ['feed'],
  ]);
});

test('does not refresh when reply creation does not complete', async () => {
  const calls = [];

  const result = await submitFeedReply({
    parentContentId: 'root_post',
    circleId: 8,
    draft: '保留在当前线程里',
    createReply: async (input) => {
      calls.push(['create', input]);
      return null;
    },
    refreshThread: async () => {
      calls.push(['thread']);
    },
    refreshFeed: async () => {
      calls.push(['feed']);
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(calls, [
    ['create', {
      parentContentId: 'root_post',
      circleId: 8,
      text: '保留在当前线程里',
    }],
  ]);
});
