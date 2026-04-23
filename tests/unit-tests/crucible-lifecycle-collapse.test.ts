import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Crucible lifecycle header collapse', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleLifecycleHeader.tsx'),
    'utf8',
  );

  it('defaults detail cards to collapsed behind an explicit toggle button', () => {
    assert.match(source, /useState\(false\)/);
    assert.match(source, /展开详情/);
    assert.match(source, /aria-expanded=\{detailsExpanded\}/);
    assert.match(source, /className=\{styles\.metaRow\}/);
  });
});
