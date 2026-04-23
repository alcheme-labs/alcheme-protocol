import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const profilePageSource = readFileSync(
  new URL('../src/app/(main)/profile/page.tsx', import.meta.url),
  'utf8'
);
const editProfileModalSource = readFileSync(
  new URL('../src/components/ui/EditProfileModal/EditProfileModal.tsx', import.meta.url),
  'utf8'
);
const totemDisplaySource = readFileSync(
  new URL('../src/components/profile/TotemDisplay/TotemDisplay.tsx', import.meta.url),
  'utf8'
);
const profileErrorsSource = readFileSync(
  new URL('../src/lib/profile/updateIdentityError.ts', import.meta.url),
  'utf8'
);
const knowledgePageSource = readFileSync(
  new URL('../src/app/(main)/knowledge/[id]/page.tsx', import.meta.url),
  'utf8'
);
const knowledgeDiscussionSource = readFileSync(
  new URL('../src/components/knowledge/KnowledgeDiscussionPanel/KnowledgeDiscussionPanel.tsx', import.meta.url),
  'utf8'
);
const knowledgeCitationSource = readFileSync(
  new URL('../src/components/knowledge/KnowledgeCitationPanel/KnowledgeCitationPanel.tsx', import.meta.url),
  'utf8'
);
const knowledgeVersionDiffSource = readFileSync(
  new URL('../src/components/knowledge/KnowledgeVersionDiffPanel/KnowledgeVersionDiffPanel.tsx', import.meta.url),
  'utf8'
);
const discussionDiagnosticsSource = readFileSync(
  new URL('../src/app/dev/discussion-diagnostics/page.tsx', import.meta.url),
  'utf8'
);

test('Wave B part 5 localizes profile surface and its direct helpers', () => {
  assert.match(profilePageSource, /useI18n|useTranslations/);
  assert.match(editProfileModalSource, /useI18n|useTranslations/);
  assert.match(totemDisplaySource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    profilePageSource,
    /身份待确认|身份确认中…|未创建身份|正在确认当前钱包的链上身份，请稍候。|连接钱包|编辑资料|断开|帖子|圈层|关注者|声誉|图腾|我的晶体|未知圈层|被引用/
  );
  assert.doesNotMatch(
    editProfileModalSource,
    /编辑资料|昵称|输入昵称|简介|一句话介绍自己|取消|保存中…|保存|资料保存失败/
  );
  assert.doesNotMatch(
    totemDisplaySource,
    /种子：|萌芽：|绽放：|璀璨：|传世：/
  );
  assert.doesNotMatch(
    profileErrorsSource,
    /当前钱包还没有可编辑的链上身份|资料保存参数未被链上程序接受|资料保存失败/
  );
});

test('Wave B part 5 localizes knowledge detail surfaces and discussion diagnostics copy', () => {
  assert.match(knowledgePageSource, /useI18n|useTranslations/);
  assert.match(knowledgeDiscussionSource, /useI18n|useTranslations/);
  assert.match(knowledgeCitationSource, /useI18n|useTranslations/);
  assert.match(knowledgeVersionDiffSource, /useI18n|useTranslations/);
  assert.match(discussionDiagnosticsSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    knowledgePageSource,
    /作者|讨论者|审阅者|被引者|贡献者|知识晶体未找到|该晶体可能尚未结晶或已被移除|知识晶体|未知成员|被引用|天前结晶|版本轨迹|当前|正式结晶结果|读取中|暂不可读|尚未可读|贡献者|来源类型|讨论锚点快照|结算回放（回退）|未标注|查看圈层总结|来源圈层|查看圈层|引用链路|本晶体引用|引用本晶体/
  );
  assert.doesNotMatch(
    knowledgeDiscussionSource,
    /这枚晶体已经完成结晶|楼|主题讨论|此晶体作为主题帖|主题帖|不同于 Plaza 的即时聊天|正在确认访问权限|主题讨论已上锁|正在展开楼层|讨论暂时不可用|还没有楼层留言|留下新的一层|补注、质疑、推导或引用路径，避免即时闲聊。|连接钱包后才可留下楼层|留言会绑定到当前晶体，并进入独立热度。|连接钱包|落层中…|留下这一层/
  );
  assert.doesNotMatch(
    knowledgeCitationSource,
    /未找到可用的引用源|当前环境未启用引用引擎|引用交易已提交|引用提交失败|引用这枚晶体|选择你自己的另一枚晶体|当前目标|正在载入你的晶体列表|暂时无法读取你的晶体列表|还没有可用的引用源|可用引用源|未归属圈层|热度|被引|连接钱包后可提交链上引用|连接钱包|提交中…|提交引用/
  );
  assert.doesNotMatch(
    knowledgeVersionDiffSource,
    /版本对比|当前先提供基于版本事件的结构化 compare|当前还没有足够的版本点可供 compare|历史正文快照尚未入库|正在读取版本差异…|版本差异暂时不可读|当前选中的版本暂时没有可读 diff|事件类型：|执行者：|事件时间：|正文快照：|可读|不可读|两个版本在当前可读范围内没有差异。/
  );
  assert.doesNotMatch(
    discussionDiagnosticsSource,
    /请先登录拥有该圈层管理权限的账号|当前诊断接口只能在 private sidecar 节点访问|没有找到这条消息|当前圈层还没有 trigger 运行记录|读取消息分析快照失败|读取讨论总结快照失败|读取 trigger 快照失败|重新入队分析失败|运行状态|实际模式|聚焦标签|语义分数|精选|方法|缓存|输入保真度|模型|触发原因|窗口消息数|请输入有效的 circle id|这里展示的是 discussion AI 的完整调试视图|输入 circle id 读取最近消息|读取中…|读取最近消息|输入 discussion envelope id|加载中…|读取分析快照|重跑中…|重新入队分析|已重新入队|当前样本|空消息|最近消息|关键诊断|错误信息|查看原始 analysis JSON|查看原始 summary JSON|查看原始 trigger JSON/
  );
});
