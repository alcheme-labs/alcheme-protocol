import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const crucibleEditorSource = readFileSync(
  new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
  'utf8'
);
const collaborativeEditorSource = readFileSync(
  new URL('../src/components/circle/CrucibleEditor/CollaborativeEditor.tsx', import.meta.url),
  'utf8'
);

test('Wave D part 5 localizes crucible editor shell and collaboration actions', () => {
  assert.match(crucibleEditorSource, /useI18n|useTranslations/);
  assert.match(collaborativeEditorSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    crucibleEditorSource,
    /未命名草稿|已锚定|锚定失败|锚定跳过|锚定中|待连接|应用已通过问题单失败|请求临时编辑授权失败|批准临时授权失败|撤销临时授权失败|段落块|可继续完善|正文可编辑|只读查看|在线|次编辑|位贡献者|完成编辑并解决|完成编辑|条留言|个问题单|编辑中|编辑这段|查看讨论|临时编辑授权|等待批准中|提交中|请求临时编辑授权|批准临时授权|撤销临时授权|这段有已通过的问题单|形成可追溯的解决链|当前协作编辑器未连接|这段当前还没有正文|这一段还没有留言|对这一段落留言|发送|需要参与者以上身份才能留言|当前身份只能查看正文/
  );
  assert.doesNotMatch(
    collaborativeEditorSource,
    /粗体|斜体|删除线|标题|小标题|无序列表|有序列表|引用|代码块|高亮|开始编写草稿/
  );
});
