import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Crucible workflow UI wiring', () => {
  const tabSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
    'utf8',
  );
  const headerSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleLifecycleHeader.tsx'),
    'utf8',
  );
  const apiSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/draft-working-copy/api.ts'),
    'utf8',
  );
  const panelSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx'),
    'utf8',
  );
  const editorSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleEditor/CrucibleEditor.tsx'),
    'utf8',
  );

  it('passes granular workflow permissions into the discussion panel', () => {
    assert.match(tabSource, /canFollowup=\{discussionCapabilities\.canFollowup\}/);
    assert.match(tabSource, /followupDisabledReason=\{discussionCapabilities\.followupDisabledReason\}/);
    assert.match(tabSource, /canWithdrawOwn=\{discussionCapabilities\.canWithdraw\}/);
    assert.match(tabSource, /withdrawDisabledReason=\{discussionCapabilities\.withdrawDisabledReason\}/);
    assert.match(tabSource, /canStartReview=\{discussionCapabilities\.canStartReview\}/);
    assert.match(tabSource, /reviewDisabledReason=\{discussionCapabilities\.startReviewDisabledReason\}/);
    assert.match(tabSource, /canRetag=\{discussionCapabilities\.canRetag\}/);
    assert.match(tabSource, /retagDisabledReason=\{discussionCapabilities\.retagDisabledReason\}/);
    assert.match(tabSource, /resolveDisabledReason=\{discussionCapabilities\.resolveDisabledReason\}/);
    assert.match(tabSource, /applyDisabledReason=\{discussionCapabilities\.applyDisabledReason\}/);
  });

  it('drives manual enter-review from workflow permissions instead of the old resolve flag', () => {
    assert.match(tabSource, /discussionCapabilities\.canEndDraftingEarly/);
    assert.match(tabSource, /const showEnterReviewAction = Boolean\(/);
    assert.match(tabSource, /const canEnterReviewManually = Boolean\(\s*showEnterReviewAction && discussionCapabilities\.canEndDraftingEarly/s);
    assert.match(tabSource, /const flushDraftBeforeWorkflowAction = useCallback\(/);
    assert.match(tabSource, /if \(autosaveTimerRef\.current !== null\) \{\s*window\.clearTimeout\(autosaveTimerRef\.current\);\s*autosaveTimerRef\.current = null;\s*\}/s);
    assert.match(tabSource, /const latestDraftText = hasUnsavedDraftRef\.current \? autosaveTextRef\.current : selectedDraftContent;/);
    assert.match(tabSource, /if \(!latestDraftText\.trim\(\)\) \{\s*throw new Error\(emptyMessage\);\s*\}/s);
    assert.match(tabSource, /await flushDraftBeforeWorkflowAction\(\{\s*postId: selectedDraftPostId,\s*emptyMessage: '请先填写正文，再进入审阅。'/s);
    assert.match(tabSource, /const isNearDraftingDeadline = Boolean\(draftLifecycle\?\.documentStatus === 'drafting'[\s\S]*draftLifecycle\?\.draftingEndsAt/);
    assert.match(tabSource, /showEnterReviewAction=/);
    assert.match(tabSource, /enterReviewDisabledReason=/);
  });

  it('blocks resolving accepted issues when the current draft has been cleared to empty', () => {
    assert.match(tabSource, /await flushDraftBeforeWorkflowAction\(\{\s*postId: selectedDraftPostId,\s*emptyMessage: '请先填写正文，再解决问题单。'/s);
    assert.doesNotMatch(tabSource, /const latestDraftText = autosaveTextRef\.current \|\| selectedDraftContent;/);
  });

  it('lets the lifecycle header render disabled review entry with a policy hint', () => {
    assert.match(headerSource, /showEnterReviewAction\?: boolean/);
    assert.match(headerSource, /enterReviewDisabledReason\?: string \| null/);
    assert.match(headerSource, /showEnterReviewAction && lifecycle\.documentStatus === 'drafting'/);
    assert.match(headerSource, /enterReviewDisabledReason/);
  });

  it('lets the discussion panel separate followup, withdraw, review, retag, resolve and apply permissions', () => {
    assert.match(panelSource, /canFollowup: boolean;/);
    assert.match(panelSource, /followupDisabledReason: string \| null;/);
    assert.match(panelSource, /canWithdrawOwn: boolean;/);
    assert.match(panelSource, /canStartReview: boolean;/);
    assert.match(panelSource, /canRetag: boolean;/);
    assert.match(panelSource, /reviewDisabledReason: string \| null;/);
    assert.match(panelSource, /retagDisabledReason: string \| null;/);
    assert.match(panelSource, /resolveDisabledReason: string \| null;/);
    assert.match(panelSource, /applyDisabledReason: string \| null;/);
  });

  it('wires review-stage advance and crystallization actions into the lifecycle header', () => {
    assert.match(apiSource, /export async function advanceDraftLifecycleReview/);
    assert.match(apiSource, /export async function enterDraftLifecycleCrystallization/);
    assert.match(apiSource, /export async function retryDraftLifecycleCrystallization/);
    assert.match(apiSource, /export async function rollbackDraftLifecycleCrystallization/);
    assert.match(tabSource, /showAdvanceReviewAction=/);
    assert.match(tabSource, /canAdvanceFromReview=/);
    assert.match(tabSource, /advanceReviewDisabledReason=/);
    assert.match(tabSource, /showEnterCrystallizationAction=/);
    assert.match(tabSource, /canEnterCrystallization=/);
    assert.match(tabSource, /enterCrystallizationDisabledReason=/);
    assert.match(tabSource, /showRetryCrystallizationAction=/);
    assert.match(tabSource, /canRetryCrystallization=/);
    assert.match(tabSource, /showRollbackCrystallizationAction=/);
    assert.match(tabSource, /canRollbackCrystallization=/);
    assert.match(tabSource, /showExecuteCrystallizationAction=/);
    assert.match(tabSource, /canExecuteCrystallization=/);
    assert.match(tabSource, /executeCrystallizationDisabledReason=/);
    assert.match(tabSource, /executeCrystallizationPending=/);
    assert.match(headerSource, /showAdvanceReviewAction\?: boolean/);
    assert.match(headerSource, /showEnterCrystallizationAction\?: boolean/);
    assert.match(headerSource, /onAdvanceReview\?: \(\) => void/);
    assert.match(headerSource, /onEnterCrystallization\?: \(\) => void/);
    assert.match(headerSource, /showRetryCrystallizationAction\?: boolean/);
    assert.match(headerSource, /onRetryCrystallization\?: \(\) => void/);
    assert.match(headerSource, /showRollbackCrystallizationAction\?: boolean/);
    assert.match(headerSource, /onRollbackCrystallization\?: \(\) => void/);
    assert.match(headerSource, /showExecuteCrystallizationAction\?: boolean/);
    assert.match(headerSource, /onExecuteCrystallization\?: \(\) => void/);
  });

  it('removes the legacy in-editor crystallize CTA and keeps lifecycle crystallization actions in the header', () => {
    assert.match(headerSource, /发起结晶/);
    assert.match(headerSource, /执行结晶/);
    assert.match(tabSource, /useCrystallizeDraft/);
    assert.match(tabSource, /const handleExecuteCrystallization = useCallback/);
    assert.match(tabSource, /executeCrystallizationDisabledReason=\{/);
    assert.doesNotMatch(editorSource, /提议结晶/);
    assert.doesNotMatch(tabSource, /showTierProgressHint/);
  });
});
