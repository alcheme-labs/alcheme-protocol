import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const circleDetailPageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8'
);
const circleUtilsSource = readFileSync(
  new URL('../src/lib/circle/utils.ts', import.meta.url),
  'utf8'
);
const identityCopySource = readFileSync(
  new URL('../src/lib/circle/identityCopy.ts', import.meta.url),
  'utf8'
);

test('Wave D part 2 localizes circle detail shell, join prompts, and identity labels', () => {
  assert.match(circleDetailPageSource, /useI18n\('CircleDetailPage'\)/);
  assert.doesNotMatch(
    circleDetailPageSource,
    /未知圈层|公共圈|连接身份并加入当前圈层后可查看成员列表与角色。|成员列表仅对当前圈层成员可见；加入后可查看角色与成员详情。|成员资料暂不可用。|加载成员资料失败，请稍后重试。|返回圈层列表|成员 ·|晶体|来源与分叉备案|同步中…|当前圈层来自|来源圈层 Fork|来源锚点|执行摘要|圈内身份|总揽|处理中…|身份变化|关闭身份变化提示|返回主圈|下一层|上一层|当前资格仍不足，暂不可提交 Fork。|当前圈层 ID 无效，无法保存 AI 配置。|保存 AI 配置失败，请稍后重试。|当前圈层 ID 无效，无法保存草稿流程设置。|保存草稿流程设置失败，请稍后重试。|当前圈层 ID 无效，无法保存问题单与阶段权限。|保存问题单与阶段权限失败，请稍后重试。|当前圈层 ID 无效，无法保存 Agent 策略。|保存 Agent 策略失败，请稍后重试。|解散圈层尚未接入安全闭环与确认流程，当前不开放。|请选择要邀请的成员。/
  );
});

test('Wave D part 2 removes user-facing Chinese helper copy from circle utilities and identity copy', () => {
  assert.doesNotMatch(
    circleUtilsSource,
    /刚刚|分钟前|小时前|天前|加入圈层|创建身份|已加入|审核中|申请加入|需邀请|晶体|受限|重新加入|游客可发烟尘消息|创建身份后可加入当前圈层。|加入申请已提交|当前圈层为审核加入|当前圈层为邀请制|当前晶体不足|你已被限制进入该圈层|请先连接身份后再加入圈层。|该圈层为邀请制|当前晶体不足|加入圈层失败，请稍后重试。|\[消息已删除\]/
  );
  assert.doesNotMatch(
    identityCopySource,
    /游客|参与者|成员|长老|策展人|创建者|入局者/
  );
});
