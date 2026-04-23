import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const memberCardSource = readFileSync(
  new URL('../src/components/circle/MemberCard/MemberCard.tsx', import.meta.url),
  'utf8'
);
const inviteMemberSheetSource = readFileSync(
  new URL('../src/components/circle/InviteMemberSheet/InviteMemberSheet.tsx', import.meta.url),
  'utf8'
);
const messageActionSheetSource = readFileSync(
  new URL('../src/components/circle/MessageActionSheet/MessageActionSheet.tsx', import.meta.url),
  'utf8'
);

test('Wave C part 2 localizes member card copy', () => {
  assert.match(memberCardSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    memberCardSource,
    /创建者|策展人|成员|处理中|已关注|关注|资料未就绪，暂时无法关注。|加入 |成员资料加载中|引用|晶体|圈层|共同圈层|近期动态|私信|邀请/
  );
});

test('Wave C part 2 localizes invite sheet and plaza action sheet copy', () => {
  assert.match(inviteMemberSheetSource, /useI18n|useTranslations/);
  assert.match(messageActionSheetSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    inviteMemberSheetSource,
    /已发送 .* 条邀请|邀请发送失败，请稍后重试。|邀请成员|邀请加入|搜索成员|未找到匹配成员|已在圈内|策展人|成员|取消|发送中|发送邀请/
  );
  assert.doesNotMatch(
    messageActionSheetSource,
    /转发|回复|高亮|复制|删除|取消/
  );
});
