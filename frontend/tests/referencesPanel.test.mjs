import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const referencesPanelSource = readFileSync(
    new URL('../src/components/circle/ReferencesPanel/ReferencesPanel.tsx', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const seededFileTreeSource = readFileSync(
    new URL('../src/components/circle/SeededFileTree/SeededFileTree.tsx', import.meta.url),
    'utf8',
);

test('CrucibleTab converges the right rail into a single references panel', () => {
    assert.match(crucibleTabSource, /import ReferencesPanel from ['"]@\/components\/circle\/ReferencesPanel\/ReferencesPanel['"]/);
    assert.match(crucibleTabSource, /<ReferencesPanel/);
    assert.match(crucibleTabSource, /import SourceMaterialsPanel from ['"]@\/components\/circle\/SourceMaterialsPanel\/SourceMaterialsPanel['"]/);
    assert.match(crucibleTabSource, /<SourceMaterialsPanel/);
    assert.doesNotMatch(crucibleTabSource, /<SeededFileTree[\s>]/);
});

test('CrucibleTab keeps seeded evidence visible from the draft list before a draft is opened', () => {
    assert.match(crucibleTabSource, /const seededDraftListSurface = useMemo\(/);
    assert.match(crucibleTabSource, /genesisMode === 'SEEDED' && \(/);
    assert.match(crucibleTabSource, /surface=\{seededDraftListSurface\}/);
    assert.match(crucibleTabSource, /showFormalReferenceSummary: false/);
});

test('ReferencesPanel shows formal references and conditionally embeds seeded evidence', () => {
    assert.match(referencesPanelSource, /useI18n\('ReferencesPanel'\)/);
    assert.match(referencesPanelSource, /surface\.showFormalReferenceSummary/);
    assert.match(referencesPanelSource, /surface\.showSeededEvidence/);
    assert.match(referencesPanelSource, /<SeededFileTree/);
    assert.match(referencesPanelSource, /selectedSeededReference/);
});

test('SeededFileTree supports embedded rendering inside ReferencesPanel', () => {
    assert.match(seededFileTreeSource, /embedded\?: boolean/);
});

test('ReferencesPanel exposes a compact insert action for editable non-seeded drafts', () => {
    assert.match(referencesPanelSource, /canInsertKnowledgeReference\?: boolean/);
    assert.match(referencesPanelSource, /knowledgeReferenceOptions: KnowledgeReferenceOption\[\]/);
    assert.match(referencesPanelSource, /onInsertReference:\s*\(option: KnowledgeReferenceOption\)/);
    assert.match(referencesPanelSource, /t\('formal\.insertAction'\)/);
});

test('ReferencesPanel keeps insert action hidden for read-only drafts', () => {
    assert.match(referencesPanelSource, /canInsertKnowledgeReference && knowledgeReferenceOptions\.length > 0/);
});
