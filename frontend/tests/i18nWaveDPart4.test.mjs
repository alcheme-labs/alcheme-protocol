import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const crucibleLifecycleHeaderSource = readFileSync(
  new URL('../src/components/circle/CrucibleTab/CrucibleLifecycleHeader.tsx', import.meta.url),
  'utf8'
);
const draftDiscussionPanelSource = readFileSync(
  new URL('../src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx', import.meta.url),
  'utf8'
);
const sourceMaterialsPanelSource = readFileSync(
  new URL('../src/components/circle/SourceMaterialsPanel/SourceMaterialsPanel.tsx', import.meta.url),
  'utf8'
);
const seededFileTreeSource = readFileSync(
  new URL('../src/components/circle/SeededFileTree/SeededFileTree.tsx', import.meta.url),
  'utf8'
);

test('Wave D part 4 localizes crucible lifecycle header and draft discussion shell', () => {
  assert.match(crucibleLifecycleHeaderSource, /useI18n|useTranslations/);
  assert.match(draftDiscussionPanelSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    crucibleLifecycleHeaderSource,
    /未提供|当前共有 .* 条问题单围绕|草稿状态|正在进入审阅|进入下一轮修订|发起结晶|执行结晶|重试结晶|回到审阅|归档草稿|恢复草稿|收起详情|展开详情|草稿来源|来源暂缺|当前审阅基线|当前正文|当前问题单进度|草稿锚点/
  );
  assert.doesNotMatch(
    draftDiscussionPanelSource,
    /管理员确认|审议角色确认|治理投票|已采纳|未采纳|已过期|待处理|提交问题单|追加补充|开始审议|通过问题单|拒绝问题单|解决并写入正文|撤回问题单|调整问题类型|问题更新|暂无补充说明|时间待补|成员 #|加载修订方向失败|请先写明这条修订方向的摘要|创建修订方向失败|接受修订方向失败|拒绝修订方向失败|请先在编辑器中点选段落|请至少选择一段|请填写问题描述|创建问题单失败|请填写补充内容|追加补充失败|开始审议失败|审议失败|撤回问题单失败|标记已解决失败|草稿讨论面板|审阅区|问题单审议|当前治理上下文|当前围绕|谁可继续推进|最近审计|修订方向|方向摘要|接受方式|提交修订方向|下一轮写作输入|方向列表|采纳为下一轮方向|不采纳|发起问题单|问题作用范围|问题类型|目标段落|请选择段落|目标结构|目标范围|自动绑定版本|问题描述|插入当前源文件引用|问题单列表|加载问题单中|当前还没有问题单|解决记录|编辑锚点|快照哈希|草稿版本|通过|拒绝|标记已解决/
  );
});

test('Wave D part 4 localizes source materials and seeded file selectors', () => {
  assert.match(sourceMaterialsPanelSource, /useI18n|useTranslations/);
  assert.match(seededFileTreeSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    sourceMaterialsPanelSource,
    /AI 可读|抽取中|处理中|上传材料|上传文本类材料后|上传材料文件|上传并抽取|只有当前可编辑草稿的成员才能上传 grounding 材料|材料列表加载中|当前还没有可用于 AI grounding 的材料/
  );
  assert.doesNotMatch(
    seededFileTreeSource,
    /源文件引用|在这里选文件和行号|当前定位|源文件加载中|当前还没有可引用的源文件|未选择文件/
  );
});
