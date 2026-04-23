import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'mocha';

describe('Crucible discussion sync behavior', () => {
  const panelSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx'),
    'utf8',
  );
  const tabSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
    'utf8',
  );

  it('uses automatic sync instead of exposing a manual refresh button in the review panel', () => {
    assert.doesNotMatch(panelSource, /className=\{styles\.refreshButton\}/);
    assert.doesNotMatch(panelSource, />\s*刷新\s*</);
    assert.doesNotMatch(panelSource, /onRefresh:\s*\(\)\s*=>\s*void;/);
  });

  it('polls lifecycle, issue threads, and binding evidence while a draft is open', () => {
    assert.match(tabSource, /window\.setInterval/);
    assert.match(tabSource, /const syncDraftDiscussionSurface = useCallback/);
    assert.match(tabSource, /Promise\.all\(\s*\[\s*refreshDraftDiscussions\(\),\s*refreshDraftLifecycle\(\),/s);
    assert.match(tabSource, /void syncDraftDiscussionSurface\(\)/);
  });
});
