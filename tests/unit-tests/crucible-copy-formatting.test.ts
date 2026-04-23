import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';

import {
  formatCrucibleDocumentStatus,
  formatDraftDiscussionIssueType,
  formatDraftDiscussionState,
  formatDraftDiscussionTargetLabel,
  formatDraftDiscussionTargetType,
  formatDraftLifecycleWarning,
  formatDraftSourceKind,
  formatDiscussionLabels,
  formatNullableDraftValue,
} from '../../frontend/src/lib/circle/draftPresentation';

describe('Crucible draft copy formatting', () => {
  it('maps lifecycle status to product-facing Chinese labels', () => {
    assert.equal(formatCrucibleDocumentStatus('drafting'), '修订中');
    assert.equal(formatCrucibleDocumentStatus('review'), '审阅讨论中');
    assert.equal(formatCrucibleDocumentStatus('crystallization_active'), '结晶表决中');
    assert.equal(formatCrucibleDocumentStatus('crystallization_failed'), '结晶未完成');
  });

  it('maps snapshot source kinds to Chinese descriptions', () => {
    assert.equal(formatDraftSourceKind('accepted_candidate_v1_seed'), '候选草稿生成的首个稳定版本');
    assert.equal(formatDraftSourceKind('review_bound_snapshot'), '审阅锁定后的稳定版本');
    assert.equal(formatDraftSourceKind(null), '来源暂缺');
    assert.equal(formatDraftSourceKind('unknown_source_kind'), '来源待确认');
  });

  it('maps discussion states and target types to Chinese', () => {
    assert.equal(formatDraftDiscussionState('open'), '已提交');
    assert.equal(formatDraftDiscussionState('proposed'), '审议中');
    assert.equal(formatDraftDiscussionState('accepted'), '已通过');
    assert.equal(formatDraftDiscussionState('rejected'), '已拒绝');
    assert.equal(formatDraftDiscussionState('applied'), '已解决');
    assert.equal(formatDraftDiscussionState('withdrawn'), '已撤回');

    assert.equal(formatDraftDiscussionTargetType('paragraph'), '段落');
    assert.equal(formatDraftDiscussionTargetType('structure'), '结构');
    assert.equal(formatDraftDiscussionTargetType('document'), '全文');
  });

  it('maps issue types to product-facing Chinese labels', () => {
    assert.equal(formatDraftDiscussionIssueType('fact_correction'), '事实修正');
    assert.equal(formatDraftDiscussionIssueType('expression_improvement'), '表达优化');
    assert.equal(formatDraftDiscussionIssueType('knowledge_supplement'), '知识补充');
    assert.equal(formatDraftDiscussionIssueType('question_and_supplement'), '疑问与补充');
  });

  it('formats paragraph refs and labels in Chinese', () => {
    assert.equal(formatDraftDiscussionTargetLabel('paragraph', 'paragraph:3'), '段落 4');
    assert.equal(formatDraftDiscussionTargetLabel('structure', 'section:intro'), '结构 · section:intro');
  });

  it('formats discussion labels and nullable fallback text in Chinese', () => {
    assert.equal(formatDiscussionLabels(['fact', 'explanation', 'emotion']), '事实 / 解释 / 情绪');
    assert.equal(formatDiscussionLabels([]), '未标注');
    assert.equal(formatNullableDraftValue(''), '未提供');
    assert.equal(formatNullableDraftValue('  abc  '), 'abc');
  });

  it('formats lifecycle warnings into product-facing Chinese hints', () => {
    assert.equal(
      formatDraftLifecycleWarning('draft source handoff is missing; treating candidate source as unavailable for this draft'),
      '这份草稿暂时缺少最初来源记录，当前先按“来源暂缺”处理，不影响继续编辑和审阅。',
    );
  });
});
