import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
    'utf8',
);

test('CrucibleEditor accepts knowledge reference insertion props and forwards them to CollaborativeEditor', () => {
    assert.match(source, /knowledgeReferenceOptions\?: KnowledgeReferenceOption\[\]/);
    assert.match(source, /insertReferenceRequest\?:/);
    assert.match(source, /onKnowledgeReferenceInserted\?: \(option: KnowledgeReferenceOption\) => void/);
    assert.match(source, /<CollaborativeEditor[\s\S]*knowledgeReferenceOptions=\{knowledgeReferenceOptions\}/);
    assert.match(source, /<CollaborativeEditor[\s\S]*insertReferenceRequest=\{insertReferenceRequest\}/);
    assert.match(source, /<CollaborativeEditor[\s\S]*onKnowledgeReferenceInserted=\{onKnowledgeReferenceInserted\}/);
    assert.match(source, /replaceRequest=\{replaceRequest/);
});

test('CrucibleEditor does not silently fall back to the first paragraph for panel-driven insertion', () => {
    assert.doesNotMatch(source, /paragraphBlocks\[0\]\?\.index/);
});
