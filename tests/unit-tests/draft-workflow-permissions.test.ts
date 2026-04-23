import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('draft workflow permissions', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'frontend/src/lib/circle/draftPermissions.ts'),
    'utf8',
  );

  it('keeps member-level issue participation but blocks review actions by default', () => {
    assert.match(source, /createIssueMinRole: 'Member'/);
    assert.match(source, /followupIssueMinRole: 'Member'/);
    assert.match(source, /reviewIssueMinRole: 'Moderator'/);
    assert.match(source, /applyIssueMinRole: 'Admin'/);
    assert.match(source, /manualEndDraftingMinRole: 'Moderator'/);
  });

  it('does not silently keep member-only edit gates on issue creation and followup actions', () => {
    assert.doesNotMatch(source, /createIssue:[\s\S]*requiresEdit: true/);
    assert.doesNotMatch(source, /followupIssue:[\s\S]*requiresEdit: true/);
  });

  it('honors the withdraw toggle separately from role thresholds', () => {
    assert.match(source, /allowAuthorWithdrawBeforeReview/);
    assert.match(source, /withdrawOwnIssue/);
    assert.match(source, /当前圈层策略不允许在进入审议前撤回自己的问题单/);
  });

  it('does not keep enter-crystallization behind the legacy manager-only base gate', () => {
    assert.doesNotMatch(source, /enterCrystallization:[\s\S]*baseAllowed: input\.canCrystallize/);
  });
});
