import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Circle plaza rail alignment', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/page.module.css'),
    'utf8',
  );

  it('uses one shared horizontal rail for controls, rows, and composer', () => {
    assert.match(css, /--plaza-rail-inline:/);
    assert.match(css, /\.discussionControls \{[\s\S]*padding: 0 var\(--plaza-rail-inline\) 4px;/);
    assert.match(css, /\.msgRow \{[\s\S]*padding: var\(--space-3\) var\(--plaza-rail-inline\);/);
    assert.match(css, /\.composerWrap \{[\s\S]*padding: var\(--space-2\) var\(--plaza-rail-inline\) calc\(var\(--space-2\) \+ var\(--safe-area-bottom\)\);/);
  });
});
