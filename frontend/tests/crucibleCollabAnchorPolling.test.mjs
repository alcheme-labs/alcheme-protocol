import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const collaborationHookSource = readFileSync(
    new URL('../src/lib/collaboration/useCollaboration.ts', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const crucibleEditorSource = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
    'utf8',
);

test('useCollaboration does not poll draft edit anchors', () => {
    assert.doesNotMatch(collaborationHookSource, /edit-anchors/);
    assert.doesNotMatch(collaborationHookSource, /anchorStatus/);
    assert.doesNotMatch(collaborationHookSource, /lastAnchorAt/);
});

test('CrucibleTab only passes connection state and collaborators into the editor', () => {
    assert.match(
        crucibleTabSource,
        /collabStatus=\{\{\s*isConnected,\s*connectedUsers,\s*\}\}/,
    );
    assert.doesNotMatch(crucibleTabSource, /anchorStatus/);
    assert.doesNotMatch(crucibleTabSource, /lastAnchorAt/);
});

test('CrucibleEditor no longer renders anchor sync status text', () => {
    assert.doesNotMatch(crucibleEditorSource, /formatAnchorStatus/);
    assert.doesNotMatch(crucibleEditorSource, /anchorStatus/);
    assert.doesNotMatch(crucibleEditorSource, /lastAnchorAt/);
    assert.doesNotMatch(crucibleEditorSource, /collabAnchorText/);
});
