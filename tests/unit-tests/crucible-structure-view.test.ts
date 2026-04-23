import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';

import {
  buildCrucibleGovernanceSummary,
  buildCrucibleLifecycleSummary,
  buildCrucibleParagraphBlocks,
  splitCrucibleParagraphContent,
  replaceCrucibleParagraphContent,
} from '../../frontend/src/lib/circle/crucibleViewModel';
import type { DraftLifecycleReadModel } from '../../frontend/src/features/draft-working-copy/api';
import type { DraftDiscussionThreadRecord } from '../../frontend/src/lib/discussion/api';

const lifecycle: DraftLifecycleReadModel = {
  draftPostId: 201,
  circleId: 36,
  documentStatus: 'drafting',
  currentSnapshotVersion: 5,
  currentRound: 1,
  reviewEntryMode: 'auto_or_manual',
  draftingEndsAt: '2026-03-16T15:00:00.000Z',
  reviewEndsAt: null,
  reviewWindowExpiredAt: null,
  transitionMode: 'seeded',
  handoff: {
    candidateId: 'cand_201',
    draftPostId: 201,
    sourceMessageIds: ['m1', 'm2'],
    sourceDiscussionLabels: ['fact', 'explanation'],
    lastProposalId: 'proposal_9',
    acceptedAt: '2026-03-16T12:00:00.000Z',
  },
  stableSnapshot: {
    draftVersion: 5,
    sourceKind: 'review_bound_snapshot',
    seedDraftAnchorId: 'anchor_1',
    sourceEditAnchorId: 'edit_1',
    sourceSummaryHash: 's'.repeat(64),
    sourceMessagesDigest: 'm'.repeat(64),
    contentHash: 'c'.repeat(64),
    createdAt: '2026-03-16T12:30:00.000Z',
  },
  workingCopy: {
    workingCopyId: 'wc_201',
    draftPostId: 201,
    basedOnSnapshotVersion: 5,
    workingCopyContent: '第一段正文\n\n第二段正文\n\n第三段正文',
    workingCopyHash: 'w'.repeat(64),
    status: 'active',
    updatedAt: '2026-03-16T13:00:00.000Z',
    roomKey: 'crucible-201',
    latestEditAnchorId: 'ea_1',
    latestEditAnchorStatus: 'anchored',
  },
  reviewBinding: {
    boundSnapshotVersion: 5,
    totalThreadCount: 3,
    openThreadCount: 1,
    proposedThreadCount: 1,
    acceptedThreadCount: 1,
    appliedThreadCount: 0,
    mismatchedApplicationCount: 0,
    latestThreadUpdatedAt: '2026-03-16T13:20:00.000Z',
  },
  warnings: [],
};

const threads: DraftDiscussionThreadRecord[] = [
  {
    id: 'thread_1',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:0',
    targetVersion: 5,
    issueType: 'fact_correction',
    state: 'open',
    createdBy: 1,
    createdAt: '2026-03-16T13:01:00.000Z',
    updatedAt: '2026-03-16T13:02:00.000Z',
    latestResolution: null,
    latestApplication: null,
    latestMessage: { authorId: 1, messageType: 'comment', content: '第一段需要补事实。', createdAt: '2026-03-16T13:02:00.000Z' },
    messages: [
      { id: 'msg_1', authorId: 1, messageType: 'create', content: '第一段需要补事实。', createdAt: '2026-03-16T13:02:00.000Z' },
    ],
  },
  {
    id: 'thread_2',
    draftPostId: 201,
    targetType: 'paragraph',
    targetRef: 'paragraph:1',
    targetVersion: 5,
    issueType: 'expression_improvement',
    state: 'accepted',
    createdBy: 2,
    createdAt: '2026-03-16T13:03:00.000Z',
    updatedAt: '2026-03-16T13:04:00.000Z',
    latestResolution: { resolvedBy: 3, toState: 'accepted', reason: '同意修订', resolvedAt: '2026-03-16T13:04:00.000Z' },
    latestApplication: null,
    latestMessage: { authorId: 2, messageType: 'propose', content: '第二段建议改写。', createdAt: '2026-03-16T13:03:30.000Z' },
    messages: [
      { id: 'msg_2', authorId: 2, messageType: 'create', content: '第二段建议改写。', createdAt: '2026-03-16T13:03:00.000Z' },
      { id: 'msg_3', authorId: 3, messageType: 'accept', content: '同意修订', createdAt: '2026-03-16T13:04:00.000Z' },
    ],
  },
];

const lifecycleCopy = {
  pendingTime: '时间待定',
  latestUpdatePending: '最近更新待定',
  updatedLabel: (date: string) => `最近更新 ${date}`,
  headline: (status: string, version: number) => `${status} · v${version}`,
  statusLabel: (status: DraftLifecycleReadModel['documentStatus']) => {
    if (status === 'drafting') return '修订中';
    if (status === 'review') return '审阅中';
    if (status === 'crystallization_active') return '结晶进行中';
    if (status === 'crystallization_failed') return '结晶未完成';
    if (status === 'crystallized') return '已结晶';
    if (status === 'archived') return '已归档';
    return '推进中';
  },
  summaries: {
    draftingManualWithIssues: ({ round, count, version }: { round: number; count: number; version: number }) => `第 ${round} 轮修订进行中。${count} 条问题单正在围绕 v${version} 推进，团队准备好后可手动进入审阅。`,
    draftingManualNoIssues: ({ round }: { round: number }) => `第 ${round} 轮修订进行中，团队准备好后可手动进入审阅。`,
    draftingAutoWithIssues: ({ round, count, version, window }: { round: number; count: number; version: number; window: string }) => `第 ${round} 轮修订进行中。${count} 条问题单正在围绕 v${version} 推进，预计 ${window} 进入审阅。`,
    draftingAutoNoIssues: ({ round, window }: { round: number; window: string }) => `第 ${round} 轮修订进行中，预计 ${window} 进入审阅。`,
    reviewExpiredWithIssues: ({ count, version }: { count: number; version: number }) => `正文已锁定。围绕 v${version} 的 ${count} 条问题单已结束审阅，请决定开启下一轮修订还是进入结晶。`,
    reviewExpiredNoIssues: ({ version }: { version: number }) => `正文已锁定。v${version} 的审阅已结束，请决定开启下一轮修订还是进入结晶。`,
    reviewActiveWithIssues: ({ count, version, window }: { count: number; version: number; window: string }) => `正文已锁定。围绕 v${version} 的 ${count} 条问题单正在审阅中，本轮预计 ${window} 结束。`,
    reviewActiveNoIssues: ({ version, window }: { version: number; window: string }) => `正文已锁定。v${version} 的审阅轮次正在等待问题单，预计 ${window} 结束。`,
    archivedWithStableVersion: ({ version }: { version: number }) => `这个已归档草稿保留了稳定版 v${version} 及其讨论历史。恢复后可继续开启新的修订轮次。`,
    archivedWithoutStableVersion: '这个已归档草稿保留了当前正文和讨论历史。恢复后可继续开启新的修订轮次。',
    crystallizationActive: ({ version }: { version: number }) => `正文已锁定，v${version} 正在进入结晶。`,
    crystallizationFailed: ({ version }: { version: number }) => `v${version} 的结晶没有完成。你可以继续处理问题单，之后再重试。`,
    crystallized: ({ version }: { version: number }) => `这个草稿已成功结晶，当前稳定结果是 v${version}。`,
    default: ({ version }: { version: number }) => `这个草稿仍在围绕 v${version} 推进。`,
  },
};

const governanceCopy = {
  actionLabel: (status: DraftLifecycleReadModel['documentStatus']) => {
    if (status === 'drafting') return '修订推进中';
    if (status === 'review') return '审阅推进中';
    if (status === 'crystallization_active') return '结晶表决中';
    if (status === 'crystallization_failed') return '结晶恢复处理中';
    if (status === 'crystallized') return '已完成结晶';
    if (status === 'archived') return '当前已归档';
    return '草稿流程处理中';
  },
  targetVersion: (version: number) => `稳定版本 v${version}`,
  statusLabel: lifecycleCopy.statusLabel,
  actorCapabilities: {
    create: '可提交问题单',
    resolve: '可审议问题单',
    apply: '可应用已通过问题',
    crystallize: '可发起结晶',
    viewOnly: '当前仅可查看',
  },
  audit: {
    pending: '最近处理时间待补',
    updated: (date: string) => `最近更新于 ${date}`,
  },
  progress: {
    submitted: '已提交',
    inReview: '审议中',
    accepted: '已通过',
    resolved: '已解决',
  },
};

const paragraphCopy = {
  title: (index: number) => `段落 ${index}`,
  typeLabel: '段落块',
  sourceVersion: (version: number) => `V${version}`,
  status: {
    locked: '当前正文已锁定',
    resolved: '已解决',
    acceptedPending: '已通过待应用',
    inReview: '审议中',
    submitted: '已提交',
    ready: '可继续完善',
  },
  editability: {
    locked: '正文已锁定',
    selected: '当前选中',
    editable: '正文可编辑',
    readOnly: '只读查看',
  },
};

describe('Crucible structure view models', () => {
  it('builds a concise lifecycle summary without repeating stage and version cards', () => {
    const summary = buildCrucibleLifecycleSummary(lifecycle, {
      locale: 'zh-CN',
      copy: lifecycleCopy,
    });

    assert.equal(summary.headline, '修订中 · v5');
    assert.match(summary.summary, /第 1 轮修订进行中/);
    assert.match(summary.summary, /3 条问题单/);
    assert.match(summary.summary, /预计 3月16日 进入审阅/);
    assert.equal(summary.metaLabel, '最近更新 3月16日');
    assert.equal(summary.showReviewCard, true);
  });

  it('omits review progress card when there are no issue threads yet', () => {
    const summary = buildCrucibleLifecycleSummary({
      ...lifecycle,
      reviewBinding: {
        ...lifecycle.reviewBinding,
        totalThreadCount: 0,
        openThreadCount: 0,
        proposedThreadCount: 0,
        acceptedThreadCount: 0,
        appliedThreadCount: 0,
      },
    }, {
      locale: 'zh-CN',
      copy: lifecycleCopy,
    });

    assert.equal(summary.showReviewCard, false);
    assert.match(summary.summary, /第 1 轮修订进行中/);
  });

  it('builds an explicit governance summary from lifecycle and discussion state', () => {
    const summary = buildCrucibleGovernanceSummary({
      lifecycle,
      threads,
      canCreate: true,
      canResolve: true,
      canApply: false,
      canCrystallize: true,
    }, {
      locale: 'zh-CN',
      copy: governanceCopy,
    });

    assert.equal(summary.actionLabel, '修订推进中');
    assert.equal(summary.targetLabel, '稳定版本 v5');
    assert.equal(summary.statusLabel, '修订中');
    assert.match(summary.actorLabel, /可提交问题单/);
    assert.match(summary.actorLabel, /可审议问题单/);
    assert.equal(summary.auditLabel, '最近更新于 3月16日');
    assert.deepEqual(summary.progressItems.map((item) => item.label), ['已提交', '审议中', '已通过', '已解决']);
    assert.equal(summary.progressItems[0].value, '1');
    assert.equal(summary.progressItems[2].value, '1');
  });

  it('builds paragraph blocks with type, source, status and editability', () => {
    const blocks = buildCrucibleParagraphBlocks({
      content: lifecycle.workingCopy.workingCopyContent,
      lifecycle,
      threads,
      selectedParagraphIndex: 1,
      canEditWorkingCopy: true,
    }, {
      copy: paragraphCopy,
    });

    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].typeLabel, '段落块');
    assert.equal(blocks[0].sourceLabel, 'V5');
    assert.equal(blocks[0].statusLabel, '已提交');
    assert.equal(blocks[1].statusLabel, '已通过待应用');
    assert.equal(blocks[1].editabilityLabel, '当前选中');
    assert.equal(blocks[2].editabilityLabel, '正文可编辑');
  });

  it('splits and replaces paragraph content for block-level editing', () => {
    const parts = splitCrucibleParagraphContent(lifecycle.workingCopy.workingCopyContent);
    assert.deepEqual(parts, ['第一段正文', '第二段正文', '第三段正文']);

    const next = replaceCrucibleParagraphContent(
      lifecycle.workingCopy.workingCopyContent,
      1,
      '第二段正文（已修改）',
    );

    assert.equal(next, '第一段正文\n\n第二段正文（已修改）\n\n第三段正文');
  });
});
