import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const crucibleTabSource = readFileSync(
  new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
  'utf8'
);
const draftPermissionsSource = readFileSync(
  new URL('../src/lib/circle/draftPermissions.ts', import.meta.url),
  'utf8'
);
const crucibleViewModelSource = readFileSync(
  new URL('../src/lib/circle/crucibleViewModel.ts', import.meta.url),
  'utf8'
);

test('Wave D part 3 localizes crucible tab shell and action feedback', () => {
  assert.match(crucibleTabSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    crucibleTabSource,
    /加载临时编辑授权失败|加载上传材料失败|加载源文件引用失败|缺少草稿上下文|当前没有编辑权限|当前仅支持文本类材料|上传材料失败|加载草稿生命周期失败|加载讨论线程失败|草稿保存失败|请先填写正文，再进入审阅。|当前草稿已进入审阅阶段。|进入审阅失败|当前草稿已进入下一轮修订。|进入下一轮修订失败|当前草稿已进入结晶阶段。|进入结晶阶段失败|已重新进入结晶阶段。|重试结晶失败|已回到审阅阶段，可继续处理问题单。|回到审阅失败|请先填写正文，再归档草稿。|当前草稿已归档。|归档草稿失败|当前草稿已恢复到新一轮修订。|恢复草稿失败|讨论线程刷新失败|讨论操作失败|未知成员|应用已通过问题单失败|评论发送失败，请稍后重试。|请求临时编辑授权失败|已提交临时编辑授权请求。|批准临时编辑授权失败|临时编辑授权已生效。|撤销临时编辑授权失败|临时编辑授权已撤销。|请先填写正文，再执行结晶。|执行结晶失败|当前已达到最多|钱包未连接，无法写入链上|当前策略摘要尚未就绪|正在加载草稿内容|返回草稿列表|正文区|当前草稿正文|先完善正文，再围绕稳定版本发起和处理修订讨论。|未命名草稿|讨论区|审阅讨论与应用|这里的讨论默认绑定稳定版本/
  );
});

test('Wave D part 3 removes user-facing Chinese helper copy from crucible permissions and view models', () => {
  assert.doesNotMatch(
    draftPermissionsSource,
    /只有活跃圈层成员才能执行这个动作。|圈主|管理员|主持人|长老|成员|初始成员|当前圈层策略要求至少|问题单|当前圈层策略不允许在进入审议前撤回自己的问题单。|审议|结晶|当前圈层策略暂不允许在审议过程中调整问题类型。/
  );
  assert.doesNotMatch(
    crucibleViewModelSource,
    /这条问题单还没有补充说明。|时间待补|修订推进中|审阅推进中|结晶表决中|结晶恢复处理中|已完成结晶|当前已归档|草稿流程处理中|可提交问题单|可审议问题单|可应用已通过问题|可发起结晶|当前仅可查看|最近处理时间待补|最近更新于|当前正文已锁定|已解决|已通过待应用|审议中|已提交|可继续完善|稳定版本|段落|段落块|正文已锁定|当前选中|正文可编辑|只读查看/
  );
});
