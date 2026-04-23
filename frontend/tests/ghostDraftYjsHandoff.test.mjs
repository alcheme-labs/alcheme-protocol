import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const collaborativeEditorSource = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CollaborativeEditor.tsx', import.meta.url),
    'utf8',
);
const crucibleEditorSource = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('collaborative editor has an explicit replace handoff path beyond the empty-editor initialContent fallback', () => {
    assert.match(collaborativeEditorSource, /replaceRequest/);
    assert.match(collaborativeEditorSource, /setContent\(/);
    assert.match(collaborativeEditorSource, /lastAppliedReplaceTokenRef/);
});

test('crucible editor forwards replace requests down to the live collaborative editor', () => {
    assert.match(crucibleEditorSource, /replaceRequest=/);
});

test('crucible tab creates a replace request when a ghost draft is explicitly accepted', () => {
    assert.match(crucibleTabSource, /ghostDraftReplaceRequest/);
    assert.match(crucibleTabSource, /setGhostDraftReplaceRequest/);
});
