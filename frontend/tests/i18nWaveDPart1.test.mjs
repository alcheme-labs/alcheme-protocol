import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const plazaTabSource = readFileSync(
  new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
  'utf8'
);
const plazaForwardingSource = readFileSync(
  new URL('../src/lib/circle/plazaForwarding.ts', import.meta.url),
  'utf8'
);

test('Wave D part 1 localizes plaza tab shell and composer copy', () => {
  assert.match(plazaTabSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    plazaTabSource,
    /筛选|范围|全部|聚焦|仅我|内容|同步讨论数据中|已折叠 .* 条噪音消息|草稿候选|系统已将它作为聊天流中的候选草稿更新保留。|转发卡|查看来源|作者标注：|发送中|发送失败|该消息已删除（发件人可见）|烟尘消息|偏离主题|回复 @|取消回复|在广场中发言|发送烟尘消息（不进入正式沉淀链路）|连接钱包后可发送消息|发送|更多|表情|文件待开放|提及|清空|这些标注只代表作者意图/
  );
});

test('Wave D part 1 removes user-facing Chinese copy from plaza forwarding helper', () => {
  assert.doesNotMatch(
    plazaForwardingSource,
    /转发|加入圈层后可转发消息。|该消息暂不具备可转发的稳定标识。|已删除消息不可转发。|烟尘消息不进入正式沉淀链路，不可转发。|转发卡片不可再次转发，请回到原始消息发起。|当前没有符合规则的目标圈层。/
  );
});
