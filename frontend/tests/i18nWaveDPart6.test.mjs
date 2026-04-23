import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const accessGateSource = readFileSync(
  new URL('../src/components/circle/AccessGate/AccessGate.tsx', import.meta.url),
  'utf8'
);
const circlePickerSource = readFileSync(
  new URL('../src/components/circle/CirclePicker/CirclePicker.tsx', import.meta.url),
  'utf8'
);
const chatRecordBubbleSource = readFileSync(
  new URL('../src/components/circle/ChatRecordBubble/ChatRecordBubble.tsx', import.meta.url),
  'utf8'
);
const notificationPanelSource = readFileSync(
  new URL('../src/components/circle/NotificationPanel/NotificationPanel.tsx', import.meta.url),
  'utf8'
);
const tierPillSource = readFileSync(
  new URL('../src/components/circle/TierPill/TierPill.tsx', import.meta.url),
  'utf8'
);
const identityOnboardingProviderSource = readFileSync(
  new URL('../src/components/auth/IdentityOnboardingProvider.tsx', import.meta.url),
  'utf8'
);
const agentAdminPanelSource = readFileSync(
  new URL('../src/features/agents/AgentAdminPanel.tsx', import.meta.url),
  'utf8'
);
const crystalDetailSheetSource = readFileSync(
  new URL('../src/components/circle/CrystalDetailSheet/CrystalDetailSheet.tsx', import.meta.url),
  'utf8'
);
const circleSettingsSheetSource = readFileSync(
  new URL('../src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx', import.meta.url),
  'utf8'
);

test('Wave D part 6 localizes supporting access and notification surfaces', () => {
  assert.match(accessGateSource, /useI18n|useTranslations/);
  assert.match(circlePickerSource, /useI18n|useTranslations/);
  assert.match(chatRecordBubbleSource, /useI18n|useTranslations/);
  assert.match(notificationPanelSource, /useI18n|useTranslations/);
  assert.match(tierPillSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    accessGateSource,
    /需要至少|我知道了/
  );
  assert.doesNotMatch(
    circlePickerSource,
    /转发到|仅显示符合规则的目标圈层|取消/
  );
  assert.doesNotMatch(
    chatRecordBubbleSource,
    /来自 .* 的聊天记录|还有 .* 条消息|共 .* 条消息|点击查看全部/
  );
  assert.doesNotMatch(
    notificationPanelSource,
    /通知|全部已读|暂无通知/
  );
  assert.doesNotMatch(
    tierPillSource,
    /创建圈层/
  );
});

test('Wave D part 6 localizes remaining governance and crystal detail copy', () => {
  assert.match(identityOnboardingProviderSource, /useI18n|useTranslations/);
  assert.match(agentAdminPanelSource, /useI18n|useTranslations/);
  assert.match(crystalDetailSheetSource, /useI18n|useTranslations/);
  assert.match(circleSettingsSheetSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    identityOnboardingProviderSource,
    /身份状态确认失败|钱包签名验证失败/
  );
  assert.doesNotMatch(
    agentAdminPanelSource,
    /Agent 管理与审计|仅圈主可修改|已登记 Agent|Agent 策略|正在读取 Agent 目录|当前圈层还没有登记 Agent|Agent 触发范围|成本折扣|审核门槛|保存 Agent 策略/
  );
  assert.doesNotMatch(
    crystalDetailSheetSource,
    /读取正式 CrystalOutput 失败|作者|讨论者|审阅者|被引者|贡献者|来源草稿|讨论锚点|摘要哈希|消息摘要|经典|沉淀中|新结晶|被引用 .* 次|天前结晶|正式结晶结果|读取中|暂不可读|尚未可读|正在读取正式 CrystalOutput|溯源|贡献账本|来源类型|复制|引用待开放|引用/
  );
  assert.doesNotMatch(
    circleSettingsSheetSource,
    /见习成员|长老|圈主|到时间后会自动结束正文编辑|创建者|策展人|角色变更失败|移除成员失败|基本信息|准入|允许消息转出|圈层身份规则|草稿流程设置|进入审阅方式|自动结束|手动结束|两者都可|自动进入审阅时间|审阅阶段时长|最多修订轮次|保存草稿流程设置|问题单与阶段权限|谁可提交问题单|谁可发起结晶|提交者在审议前可撤回|AI 协作|当前：圈层自定义配置|配置加载中|讨论区摘要使用 LLM|草稿触发模式|仅提醒|自动草稿|保存 AI 配置|成员目录|设为策展人|取消策展人|移除成员|邀请成员|危险操作|解散此圈层/
  );
});
