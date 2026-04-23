import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const identityBadgeSource = readFileSync(
  new URL('../src/components/circle/IdentityBadge/IdentityBadge.tsx', import.meta.url),
  'utf8'
);
const draftCandidateCardSource = readFileSync(
  new URL('../src/features/discussion-intake/candidate-cards/DraftCandidateInlineCard.tsx', import.meta.url),
  'utf8'
);

test('Wave C part 4 localizes identity badge copy', () => {
  assert.match(identityBadgeSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    identityBadgeSource,
    /游客|参与者|成员|策展人|创建者/
  );
});

test('Wave C part 4 localizes draft candidate inline card copy', () => {
  assert.match(draftCandidateCardSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    draftCandidateCardSource,
    /候选中|提案中|已生成|生成失败|未通过|已过期|已取消|这段讨论已被识别为候选草稿|草稿生成提案进行中|候选草稿已生成正式草稿|来源消息|作者标注|失败原因：|治理恢复：|前往草稿|重试本次生成|重试权限由治理规则决定|取消当前候选治理流程|取消权限由治理规则决定|重试|取消|事实|解释|情绪|问题|提案|总结/
  );
});
