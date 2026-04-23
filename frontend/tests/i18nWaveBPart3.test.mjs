import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const summaryPageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/summary/page.tsx', import.meta.url),
  'utf8'
);
const scaffoldSource = readFileSync(
  new URL('../src/features/circle-summary/CircleSummaryScaffold.tsx', import.meta.url),
  'utf8'
);
const readinessSource = readFileSync(
  new URL('../src/features/circle-summary/SummaryReadinessPanel.tsx', import.meta.url),
  'utf8'
);
const adapterSource = readFileSync(
  new URL('../src/features/circle-summary/adapter.ts', import.meta.url),
  'utf8'
);

test('Wave B part 3 localizes the circle summary surface and its user-facing formatter copy', () => {
  assert.match(summaryPageSource, /useI18n|useTranslations/);
  assert.match(scaffoldSource, /useI18n|useTranslations/);
  assert.match(readinessSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    scaffoldSource,
    /返回圈层|从这里进入主要路线|主线还在形成|辅助说明|当前局势|这些线站得稳不稳|它是怎么沉淀出来的|现在还没说清的事|你现在怎么进入/
  );
  assert.doesNotMatch(
    readinessSource,
    /总结页面|当前页面怎样取材|等待正式快照|来源模型|来源方式|提示词版本|上下文指纹|引用线索准备/
  );
  assert.doesNotMatch(
    adapterSource,
    /认知地图入口|主线入口|并行观察点|快照支撑|结算回放|来源待确认|时间待补|系统 LLM|手动请求|系统投影|内置 LLM|规则摘要|引用标识|尚未定位唯一的草稿基线/
  );
});
