import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(
    new URL('../src/components/circle/SeededFileTree/SeededFileTree.tsx', import.meta.url),
    'utf8',
);
const tabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const discussionPanelSource = readFileSync(
    new URL('../src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx', import.meta.url),
    'utf8',
);

test('SeededFileTree renders file preview lines and emits @file references from selected lines', () => {
    assert.match(componentSource, /split\(\/\\r\?\\n\//);
    assert.match(componentSource, /@file:\$\{selectedFile\.path\}:\$\{lineNumber\}/);
    assert.match(componentSource, /onSelectReference/);
});

test('CrucibleTab wires the seeded tree into the draft workspace and discussion surface', () => {
    assert.match(tabSource, /SeededFileTree/);
    assert.match(tabSource, /fetchSeededFileTree/);
    assert.match(tabSource, /selectedSeededReference/);
    assert.match(tabSource, /onSelectSeededReference/);
    assert.match(tabSource, /backToDraftList/);
    assert.match(discussionPanelSource, /insertCurrentReference/);
});

test('CrucibleTab loads seeded tree data for SEEDED circles even before a draft is selected', () => {
    assert.match(tabSource, /const loadSeededFileTree = useCallback\(async \(\): Promise<void> => \{/);
    assert.match(tabSource, /if \(genesisMode !== 'SEEDED'\)/);
    assert.doesNotMatch(tabSource, /!selectedDraftPostId \|\| !Number\.isFinite\(selectedDraftPostId\) \|\| genesisMode !== 'SEEDED'/);
});
