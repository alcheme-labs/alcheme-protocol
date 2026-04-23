import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Circle edge alignment', () => {
  const pageCss = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/page.module.css'),
    'utf8',
  );
  const tabCss = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/ui/TabBar/TabBar.module.css'),
    'utf8',
  );

  it('removes extra edge padding from header buttons and tab shell', () => {
    assert.match(pageCss, /\.backButton \{[\s\S]*padding: 0;/);
    assert.match(pageCss, /\.settingsButton \{[\s\S]*padding: 0;/);
    assert.match(tabCss, /\.tabBar \{[\s\S]*padding: 0;/);
    assert.match(tabCss, /\.tab \{[\s\S]*min-height: 34px;/);
  });

  it('keeps the tier pill at the restored medium size instead of the extra-small compressed size', () => {
    assert.match(pageCss, /\.tierPill \{[\s\S]*gap: 5px;[\s\S]*padding: 3px 9px;[\s\S]*border-radius: 13px;/);
    assert.match(pageCss, /\.tierPillName \{[\s\S]*font-size: 9px;/);
  });
});
