import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'mocha';

const repoRoot = resolve(process.cwd());
const editorSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/CrucibleEditor/CrucibleEditor.tsx'),
  'utf8',
);
const panelSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx'),
  'utf8',
);

describe('Crucible discussion product copy guard', () => {
  it('labels the quick paragraph surface as notes rather than a second discussion system', () => {
    assert.match(editorSource, /段落 \{block\.index \+ 1\} 的留言/);
    assert.match(editorSource, /placeholder="对这一段落留言…"/);
    assert.doesNotMatch(editorSource, /段落 \{block\.index \+ 1\} 的讨论/);
  });

  it('treats structured review threads like issue tickets and auto-binds stable version', () => {
    assert.match(panelSource, /发起问题单/);
    assert.match(panelSource, /问题单列表/);
    assert.match(panelSource, /自动绑定稳定版本 v\{stableSnapshotVersion\}/);
    assert.match(panelSource, /问题类型/);
    assert.match(panelSource, /追加补充/);
    assert.match(panelSource, /撤回问题单/);
    assert.match(panelSource, /!shouldResolveIssueViaParagraphEditing\(thread\)/);
    assert.doesNotMatch(panelSource, /draft-discussion-target-version/);
    assert.doesNotMatch(panelSource, /setTargetVersion/);
  });
});
