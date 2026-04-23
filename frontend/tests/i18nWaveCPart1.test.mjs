import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const feedTabSource = readFileSync(
  new URL('../src/components/circle/FeedTab/FeedTab.tsx', import.meta.url),
  'utf8'
);
const sanctuaryTabSource = readFileSync(
  new URL('../src/components/circle/SanctuaryTab/SanctuaryTab.tsx', import.meta.url),
  'utf8'
);
const forkCreateSheetSource = readFileSync(
  new URL('../src/components/circle/ForkCreateSheet/ForkCreateSheet.tsx', import.meta.url),
  'utf8'
);
const forkReadinessPanelSource = readFileSync(
  new URL('../src/features/fork-lineage/ForkReadinessPanel.tsx', import.meta.url),
  'utf8'
);
const forkLineageAdapterSource = readFileSync(
  new URL('../src/features/fork-lineage/adapter.ts', import.meta.url),
  'utf8'
);
const circleDetailPageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8'
);

test('Wave C part 1 localizes feed and sanctuary tab shell copy', () => {
  assert.match(feedTabSource, /useI18n|useTranslations/);
  assert.match(sanctuaryTabSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    feedTabSource,
    /No feed posts yet|Reposted from @|Original repost|Original content is unavailable|Open replies|Comment unavailable|Share your next move with|Composer unavailable/
  );
  assert.doesNotMatch(
    sanctuaryTabSource,
    /被引用|经典|沉淀中/
  );
});

test('Wave C part 1 localizes fork creation shell and fork lineage copy', () => {
  assert.match(forkCreateSheetSource, /useI18n|useTranslations/);
  assert.match(forkReadinessPanelSource, /useI18n|useTranslations/);
  assert.match(circleDetailPageSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    forkCreateSheetSource,
    /Fork ·|关闭 Fork 创建|为什么现在可以 Fork|来源圈层、资格说明和分歧依据会一起写进这次创建备案。|当分歧已指向不同的未来，分叉比彼此裹挟更诚实。|正在整理继续分支条件|已检测到 Fork 圈层|分歧说明|写下这次分叉的方向差异。|新圈怎么开始|下面这些字段会作为新圈的起始配置|自由加入|晶体门槛|邀请制|审批制|自动或手动|仅自动|仅手动|仅提醒|自动草稿|稍后再说|继续补齐备案|暂不可提交|创建 Fork 圈层/
  );
  assert.doesNotMatch(
    forkReadinessPanelSource,
    /继续分支条件|来源圈层|当前资格|贡献门槛|身份保护线|层级|进入门槛|继承方式|知识延续|来源标记|延迟显示，仅在总览 \/ lineage 面板出现，不进入主结构|保留节奏|第 2 \/ 7 \/ 30 \/ 90 \/ 180 天检查，连续两次不活跃后隐藏|默认带入/
  );
  assert.doesNotMatch(
    forkLineageAdapterSource,
    /当前圈层还没有开放继续分支。|至少累计|并通过一次治理表决。|即可继续分支。|会先带入上游配置，创建后保持锁定。|会先带入上游配置，创建后仍可继续调整。|会从独立配置开始，不继续继承上游设置。|会沿用上游知识脉络，直到新的分支节点出现。|圈层创建者|管理员|维护者|普通成员|资深成员|新成员|当前资格已满足，可继续 Fork。|当前圈层暂未开放 Fork。|当前角色\/身份仍低于|还差|份贡献，达到门槛后即可提交。|当前还未满足提交条件。|可继续 Fork|暂未开放|身份仍不足|贡献仍不足|圈层 #|层级待确认|第 .* 层|保护线：|创建时会带入默认配置|当分歧已指向不同的未来，分叉比彼此裹挟更诚实。|写下这次分叉想守住的方向差异|这里会同时说明贡献门槛、身份保护线、继承方式和知识延续范围，创建入口只保留在圈层页。/
  );
});
