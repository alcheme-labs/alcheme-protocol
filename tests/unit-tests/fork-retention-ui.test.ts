import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Fork retention UI surfaces', () => {
  const apiSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/fork-lineage/api.ts'),
    'utf8',
  );
  const panelSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/fork-lineage/ForkReadinessPanel.tsx'),
    'utf8',
  );
  const summarySource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/circle-summary/CircleSummaryScaffold.tsx'),
    'utf8',
  );
  const circlePageSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/page.tsx'),
    'utf8',
  );

  it('keeps the delayed source marker in overview and lineage copy instead of the main tree', () => {
    assert.match(panelSource, /来源标记/);
    assert.match(panelSource, /总览 \/ lineage/);
    assert.match(summarySource, /不进入主结构/);
    assert.doesNotMatch(circlePageSource, /Fork 来源标记不会直接挂进主结构/);
  });

  it('surfaces the frozen retention checkpoints and inactive-hide rule in product copy', () => {
    assert.match(panelSource, /第 2 \/ 7 \/ 30 \/ 90 \/ 180 天/);
    assert.match(panelSource, /连续两次不活跃/);
    assert.match(summarySource, /延迟显示/);
    assert.match(summarySource, /永久保留/);
  });

  it('consumes the formal fork lineage exit in the circle overview instead of leaving retention as copy-only text', () => {
    assert.match(apiSource, /fetchForkLineageView/);
    assert.match(apiSource, /\/api\/v1\/fork\/circles\/\$\{input\.circleId\}\/lineage/);
    assert.match(circlePageSource, /fetchForkLineageView/);
    assert.match(circlePageSource, /forkLineage/);
    assert.match(circlePageSource, /markerVisible/);
  });
});
