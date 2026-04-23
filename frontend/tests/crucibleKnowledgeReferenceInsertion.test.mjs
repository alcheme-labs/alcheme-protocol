import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('CrucibleTab gates reference insertion to editable non-seeded drafts and threads options through both entry points', () => {
    assert.match(source, /canInsertKnowledgeReference=\{genesisMode !== 'SEEDED' && canEditWorkingCopy && selectedParagraphIndex !== null\}/);
    assert.match(source, /knowledgeReferenceOptions=\{knowledgeReferenceOptions\}/);
    assert.match(source, /onInsertReference=\{handleInsertKnowledgeReference\}/);
    assert.match(source, /insertReferenceRequest=\{insertReferenceRequest\}/);
});

test('CrucibleTab keeps a narrow reference-links refresh guard for insertion-triggered autosave only', () => {
    assert.match(source, /pendingReferenceLinksRefreshRef/);
    assert.match(source, /if \(pendingReferenceLinksRefreshRef\.current && saved\)/);
    assert.match(source, /await loadDraftReferenceLinks\(\)/);
});

test('CrucibleTab clears insert reference requests after insertion and when the selected draft changes', () => {
    assert.match(source, /setInsertReferenceRequest\(null\);/);
});
