import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'mocha';

const repoRoot = resolve(process.cwd());
const editorSource = readFileSync(
  join(repoRoot, 'frontend/src/components/circle/CrucibleEditor/CrucibleEditor.tsx'),
  'utf8',
);

describe('Crucible inline notes panel guard', () => {
  it('opens the notes panel inline under the active paragraph instead of once below the whole document', () => {
    assert.match(editorSource, /activeCommentParagraph === block\.index/);
    assert.doesNotMatch(editorSource, /\{activeCommentParagraph !== null && \(/);
  });

  it('makes the discussion count directly clickable for the active paragraph', () => {
    assert.match(editorSource, /className=\{styles\.paragraphMetaButton\}/);
    assert.match(editorSource, /onClick=\{\(\) => activateParagraph\(block\.index\)\}/);
    assert.match(editorSource, /`\$\{blockComments\.length\} 条留言`/);
  });
});
