import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Fork create sheet canonical UI flow', () => {
  const circlePageSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/page.tsx'),
    'utf8',
  );
  const knowledgePageSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/knowledge/[id]/page.tsx'),
    'utf8',
  );
  const circleSummaryPageSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/summary/page.tsx'),
    'utf8',
  );
  const createSheetSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx'),
    'utf8',
  );
  const forkSheetSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/ForkCreateSheet/ForkCreateSheet.tsx'),
    'utf8',
  );

  it('adds Fork as the third canonical create entry beside same-level and next-level', () => {
    assert.match(createSheetSource, /同级/);
    assert.match(createSheetSource, /下级/);
    assert.match(createSheetSource, /Fork/);
  });

  it('opens a dedicated ForkCreateSheet from the circle page create flow', () => {
    assert.match(circlePageSource, /ForkCreateSheet/);
    assert.match(circlePageSource, /showForkCreateSheet/);
    assert.match(circlePageSource, /setShowForkCreateSheet/);
    assert.match(circlePageSource, /onSelectFork/);
  });

  it('keeps Fork creation out of knowledge pages and summary pages', () => {
    assert.doesNotMatch(knowledgePageSource, /ForkReadinessPanel/);
    assert.doesNotMatch(knowledgePageSource, /fetchForkTeam04ResolvedInputs/);
    assert.doesNotMatch(knowledgePageSource, /继续分支/);

    assert.doesNotMatch(circleSummaryPageSource, /fetchForkTeam04ResolvedInputs/);
    assert.doesNotMatch(circleSummaryPageSource, /buildForkReadinessViewModel/);
    assert.doesNotMatch(circleSummaryPageSource, /forkHint/);
  });

  it('renders the frozen two-part fork sheet with slogan and declaration input', () => {
    assert.match(forkSheetSource, /为什么现在可以 Fork/);
    assert.match(forkSheetSource, /新圈怎么开始/);
    assert.match(forkSheetSource, /当分歧已指向不同的未来，分叉比彼此裹挟更诚实。/);
    assert.match(forkSheetSource, /分歧说明/);
    assert.match(forkSheetSource, /创建 Fork 圈层/);
  });

  it('allows opening for non-qualified viewers but disables submit until qualification is met', () => {
    assert.match(forkSheetSource, /canSubmitFork/);
    assert.match(forkSheetSource, /disabled=\{!canSubmitFork/);
    assert.match(forkSheetSource, /暂不可提交/);
  });

  it('reuses a stable declaration id and retries final filing before attempting another circle create', () => {
    assert.match(circlePageSource, /declarationId/);
    assert.match(circlePageSource, /pendingForkFinalization/);
    assert.doesNotMatch(circlePageSource, /但备案失败，请稍后补记/);
  });

  it('persists pending fork finalization across reload and routes recovery back through the canonical fork sheet', () => {
    assert.match(circlePageSource, /readPendingForkFinalization/);
    assert.match(circlePageSource, /writePendingForkFinalization/);
    assert.match(circlePageSource, /clearPendingForkFinalization/);
    assert.match(circlePageSource, /resumePendingFinalization=/);
    assert.match(forkSheetSource, /继续补齐备案/);
  });
});
