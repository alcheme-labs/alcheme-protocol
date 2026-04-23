import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'mocha';

import {
  buildCrucibleAcceptedIssuesByParagraph,
  shouldResolveIssueViaParagraphEditing,
} from '../../frontend/src/lib/circle/crucibleViewModel';
import type { DraftDiscussionThreadRecord } from '../../frontend/src/lib/discussion/api';

const repoRoot = resolve(process.cwd());
const editorSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/CrucibleEditor/CrucibleEditor.tsx'),
  'utf8',
);
const crucibleTabSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
  'utf8',
);

const threads: DraftDiscussionThreadRecord[] = [
  {
    id: 'thread_1',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:0',
    targetVersion: 5,
    issueType: 'fact_correction',
    state: 'accepted',
    createdBy: 1,
    createdAt: '2026-03-16T13:01:00.000Z',
    updatedAt: '2026-03-16T13:02:00.000Z',
    latestResolution: { resolvedBy: 2, toState: 'accepted', reason: '值得修', resolvedAt: '2026-03-16T13:02:00.000Z' },
    latestApplication: null,
    latestMessage: { authorId: 1, messageType: 'propose', content: '第一段补上背景事实。', createdAt: '2026-03-16T13:02:00.000Z' },
    messages: [
      { id: 'msg_1', authorId: 1, messageType: 'create', content: '第一段补上背景事实。', createdAt: '2026-03-16T13:01:30.000Z' },
      { id: 'msg_2', authorId: 2, messageType: 'accept', content: '值得修', createdAt: '2026-03-16T13:02:00.000Z' },
    ],
  },
  {
    id: 'thread_2',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:0',
    targetVersion: 5,
    issueType: 'knowledge_supplement',
    state: 'applied',
    createdBy: 1,
    createdAt: '2026-03-16T13:03:00.000Z',
    updatedAt: '2026-03-16T13:04:00.000Z',
    latestResolution: { resolvedBy: 2, toState: 'accepted', reason: null, resolvedAt: '2026-03-16T13:03:30.000Z' },
    latestApplication: {
      appliedBy: 3,
      appliedEditAnchorId: 'a'.repeat(64),
      appliedSnapshotHash: 'b'.repeat(64),
      appliedDraftVersion: 5,
      reason: null,
      appliedAt: '2026-03-16T13:04:00.000Z',
    },
    latestMessage: { authorId: 1, messageType: 'propose', content: '这条已经解决。', createdAt: '2026-03-16T13:03:00.000Z' },
    messages: [
      { id: 'msg_3', authorId: 1, messageType: 'create', content: '这条已经解决。', createdAt: '2026-03-16T13:03:00.000Z' },
      { id: 'msg_4', authorId: 3, messageType: 'apply', content: null, createdAt: '2026-03-16T13:04:00.000Z' },
    ],
  },
  {
    id: 'thread_3',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:1',
    targetVersion: 5,
    issueType: 'expression_improvement',
    state: 'accepted',
    createdBy: 1,
    createdAt: '2026-03-16T13:05:00.000Z',
    updatedAt: '2026-03-16T13:06:00.000Z',
    latestResolution: { resolvedBy: 2, toState: 'accepted', reason: '继续跟进', resolvedAt: '2026-03-16T13:06:00.000Z' },
    latestApplication: null,
    latestMessage: { authorId: 1, messageType: 'propose', content: '第二段补一句结论。', createdAt: '2026-03-16T13:05:30.000Z' },
    messages: [
      { id: 'msg_5', authorId: 1, messageType: 'create', content: '第二段补一句结论。', createdAt: '2026-03-16T13:05:00.000Z' },
      { id: 'msg_6', authorId: 2, messageType: 'accept', content: '继续跟进', createdAt: '2026-03-16T13:06:00.000Z' },
    ],
  },
  {
    id: 'thread_4',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:1',
    targetVersion: 5,
    issueType: 'question_and_supplement',
    state: 'accepted',
    createdBy: 4,
    createdAt: '2026-03-16T13:07:00.000Z',
    updatedAt: '2026-03-16T13:08:00.000Z',
    latestResolution: { resolvedBy: 2, toState: 'accepted', reason: '先保留讨论', resolvedAt: '2026-03-16T13:08:00.000Z' },
    latestApplication: null,
    latestMessage: { authorId: 4, messageType: 'accept', content: '先保留讨论', createdAt: '2026-03-16T13:08:00.000Z' },
    messages: [
      { id: 'msg_7', authorId: 4, messageType: 'create', content: '先记一个疑问', createdAt: '2026-03-16T13:07:00.000Z' },
      { id: 'msg_8', authorId: 2, messageType: 'accept', content: '先保留讨论', createdAt: '2026-03-16T13:08:00.000Z' },
    ],
  },
  {
    id: 'thread_5',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:2',
    targetVersion: 5,
    issueType: 'fact_correction',
    state: 'accepted',
    createdBy: 9,
    createdAt: '2026-03-16T13:09:00.000Z',
    updatedAt: '2026-03-16T13:11:00.000Z',
    latestResolution: { resolvedBy: 2, toState: 'accepted', reason: '同意进入修订', resolvedAt: '2026-03-16T13:11:00.000Z' },
    latestApplication: null,
    latestMessage: { authorId: 2, messageType: 'accept', content: '同意进入修订', createdAt: '2026-03-16T13:11:00.000Z' },
    messages: [
      { id: 'msg_9', authorId: 9, messageType: 'create', content: '第三段需要补上事实背景。', createdAt: '2026-03-16T13:09:00.000Z' },
      { id: 'msg_10', authorId: 9, messageType: 'followup', content: '目前例子不够完整。', createdAt: '2026-03-16T13:10:00.000Z' },
      { id: 'msg_11', authorId: 2, messageType: 'accept', content: '同意进入修订', createdAt: '2026-03-16T13:11:00.000Z' },
    ],
  },
];

describe('Crucible accepted issue carry view model', () => {
  it('groups accepted-but-not-applied issue tickets by paragraph', () => {
    const grouped = buildCrucibleAcceptedIssuesByParagraph(threads);

    assert.deepEqual(Object.keys(grouped), ['0', '1', '2']);
    assert.equal(grouped[0].length, 1);
    assert.equal(grouped[0][0].threadId, 'thread_1');
    assert.match(grouped[0][0].summary, /第一段补上背景事实/);
    assert.equal(grouped[1][0].threadId, 'thread_3');
    assert.equal(grouped[1].length, 1);
  });

  it('uses the original issue content instead of the latest workflow message for carry summary', () => {
    const grouped = buildCrucibleAcceptedIssuesByParagraph(threads);

    assert.equal(grouped[2][0].threadId, 'thread_5');
    assert.match(grouped[2][0].summary, /第三段需要补上事实背景/);
    assert.doesNotMatch(grouped[2][0].summary, /同意进入修订/);
  });

  it('treats accepted paragraph issues as editor-resolved instead of requiring a second manual resolve action', () => {
    assert.equal(shouldResolveIssueViaParagraphEditing(threads[0]), true);
    assert.equal(shouldResolveIssueViaParagraphEditing({
      ...threads[0],
      targetType: 'structure',
    }), false);
    assert.equal(shouldResolveIssueViaParagraphEditing({
      ...threads[0],
      issueType: 'question_and_supplement',
    }), false);
    assert.equal(shouldResolveIssueViaParagraphEditing({
      ...threads[0],
      latestApplication: {
        appliedBy: 7,
        appliedEditAnchorId: 'c'.repeat(64),
        appliedSnapshotHash: 'd'.repeat(64),
        appliedDraftVersion: 5,
        reason: null,
        appliedAt: '2026-03-16T13:12:00.000Z',
      },
    }), false);
  });

  it('wires accepted issue carry into paragraph editing instead of leaving approved tickets disconnected', () => {
    assert.match(crucibleTabSource, /buildCrucibleAcceptedIssuesByParagraph\(discussionThreads\)/);
    assert.match(crucibleTabSource, /acceptedIssuesByParagraph=\{acceptedIssuesByParagraph\}/);
    assert.match(crucibleTabSource, /canApplyAcceptedIssues=\{discussionCapabilities\.canApply\}/);
    assert.match(crucibleTabSource, /onApplyAcceptedIssues=\{handleApplyAcceptedIssues\}/);
    assert.match(editorSource, /这段有已通过的问题单，可选择随本次编辑一起解决/);
    assert.match(editorSource, /canApplyAcceptedIssues = true/);
    assert.match(editorSource, /isEditingParagraph && canApplyAcceptedIssues && acceptedIssues\.length > 0/);
    assert.match(editorSource, /完成编辑后，已勾选的问题单会自动写入本段的应用记录/);
    assert.match(editorSource, /className=\{styles\.paragraphEditorActions\}/);
    assert.match(editorSource, /className=\{styles\.paragraphCompleteButton\}/);
    assert.match(editorSource, /onClick=\{\(\) => \{ void completeParagraphEditing\(block\.index\); \}\}/);
  });
});
