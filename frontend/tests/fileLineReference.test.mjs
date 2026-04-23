import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const discussionPanelSource = readFileSync(
    new URL('../src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx', import.meta.url),
    'utf8',
);
const presentationSource = readFileSync(
    new URL('../src/lib/circle/draftPresentation.ts', import.meta.url),
    'utf8',
);
const viewModelSource = readFileSync(
    new URL('../src/lib/circle/crucibleViewModel.ts', import.meta.url),
    'utf8',
);

test('DraftDiscussionPanel inserts the currently selected file reference into issue content', () => {
    assert.match(discussionPanelSource, /插入当前源文件引用/);
    assert.match(discussionPanelSource, /selectedSeededReference/);
    assert.match(discussionPanelSource, /extractCrucibleFileLineReferences/);
});

test('draft presentation and view model expose dedicated file reference formatting helpers', () => {
    assert.match(presentationSource, /formatSeededReferenceLabel/);
    assert.match(viewModelSource, /extractCrucibleFileLineReferences/);
    assert.match(viewModelSource, /@file:/);
});
