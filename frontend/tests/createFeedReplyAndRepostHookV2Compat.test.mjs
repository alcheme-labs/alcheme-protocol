import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const replyHookSource = readFileSync(new URL('../src/hooks/useCreateFeedReply.ts', import.meta.url), 'utf8');
const repostHookSource = readFileSync(new URL('../src/hooks/useRepostContent.ts', import.meta.url), 'utf8');

test('useCreateFeedReply resolves explicit write mode and route options', () => {
  assert.match(replyHookSource, /resolveContentWriteMode/);
  assert.match(replyHookSource, /resolveIdentityHandleForV2/);
  assert.match(replyHookSource, /buildV2RouteOptions/);
  assert.match(replyHookSource, /createV2ContentId/);
  assert.match(replyHookSource, /isV2ContentIdConflictError/);
  assert.doesNotMatch(replyHookSource, /assertV2ByIdTargetIsPublicActive/);
  assert.doesNotMatch(replyHookSource, /reply 目标作者 pubkey 缺失/);
});

test('useCreateFeedReply binds circle with route-aware identifier', () => {
  assert.match(replyHookSource, /resolveBindContentId\(/);
  assert.match(replyHookSource, /contentId:\s*bindContentId/);
  assert.match(replyHookSource, /fallbackContentIds/);
  assert.match(replyHookSource, /createReplyById/);
});

test('useRepostContent resolves explicit write mode and route options', () => {
  assert.match(repostHookSource, /resolveContentWriteMode/);
  assert.match(repostHookSource, /resolveIdentityHandleForV2/);
  assert.match(repostHookSource, /buildV2RouteOptions/);
  assert.match(repostHookSource, /createV2ContentId/);
  assert.match(repostHookSource, /isV2ContentIdConflictError/);
  assert.doesNotMatch(repostHookSource, /assertV2ByIdTargetIsPublicActive/);
  assert.doesNotMatch(repostHookSource, /repost 目标作者 pubkey 缺失/);
});

test('useRepostContent binds circle with route-aware identifier', () => {
  assert.match(repostHookSource, /resolveBindContentId\(/);
  assert.match(repostHookSource, /contentId:\s*bindContentId/);
  assert.match(repostHookSource, /fallbackContentIds/);
  assert.match(repostHookSource, /createRepostById/);
});
