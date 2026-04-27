import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
  'utf8',
);

test('editing a paragraph does not open the paragraph comment panel', () => {
  const beginEditBody = source.match(/const beginParagraphEditing = useCallback\(\(paragraphIndex: number\) => \{([\s\S]*?)\n    \}, \[/)?.[1] || '';

  assert.ok(beginEditBody, 'beginParagraphEditing callback should be present');
  assert.doesNotMatch(beginEditBody, /activateParagraph\(paragraphIndex\)/);
  assert.match(source, /const isCommentPanelOpen = activeCommentParagraph === block\.index && !isEditingParagraph/);
});
