import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'mocha';

import { formatDraftDiscussionTargetLabel } from '../../frontend/src/lib/circle/draftPresentation';

describe('Crucible discussion targeting', () => {
  const panelSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx'),
    'utf8',
  );

  it('formats grouped structure targets as selected paragraphs instead of raw refs', () => {
    assert.equal(
      formatDraftDiscussionTargetLabel('structure', 'paragraph:0,paragraph:2'),
      '结构 · 第 1、3 段',
    );
    assert.equal(formatDraftDiscussionTargetLabel('document', 'document'), '全文');
  });

  it('uses product pickers instead of asking users to manually type target refs', () => {
    assert.match(panelSource, /targetType === 'structure'/);
    assert.match(panelSource, /type="checkbox"/);
    assert.match(panelSource, /全文问题单会围绕整篇正文推进，不需要额外选择段落/);
    assert.doesNotMatch(panelSource, /placeholder="例如：paragraph:3/);
  });
});
