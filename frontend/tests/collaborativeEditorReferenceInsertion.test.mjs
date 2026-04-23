import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    detectActiveKnowledgeReferenceQuery,
    insertKnowledgeReferenceMarkup,
} from '../src/components/circle/CrucibleEditor/referenceInsertion.ts';

test('insertKnowledgeReferenceMarkup inserts canonical markup and advances the cursor', () => {
    const result = insertKnowledgeReferenceMarkup(
        'We should cite this',
        20,
        20,
        '@crystal(Onboarding Flow)',
    );

    assert.deepEqual(result, {
        nextValue: 'We should cite this @crystal(Onboarding Flow) ',
        nextSelectionStart: 46,
        nextSelectionEnd: 46,
    });
});

test('detectActiveKnowledgeReferenceQuery only opens on a fresh @ token', () => {
    assert.deepEqual(
        detectActiveKnowledgeReferenceQuery('We should cite @onb'),
        {
            token: '@onb',
            query: 'onb',
        },
    );
    assert.equal(detectActiveKnowledgeReferenceQuery('mail me at a@b.com'), null);
});

test('CollaborativeEditor wires the compact picker and insertion request props without a mention extension rewrite', () => {
    const source = readFileSync(
        new URL('../src/components/circle/CrucibleEditor/CollaborativeEditor.tsx', import.meta.url),
        'utf8',
    );

    assert.match(source, /KnowledgeReferencePicker/);
    assert.match(source, /knowledgeReferenceOptions\?: KnowledgeReferenceOption\[\]/);
    assert.match(source, /insertReferenceRequest\?:/);
    assert.doesNotMatch(source, /Mention\.configure/);
});

test('CollaborativeEditor inserts references through document ranges instead of flattening editor text', () => {
    const source = readFileSync(
        new URL('../src/components/circle/CrucibleEditor/CollaborativeEditor.tsx', import.meta.url),
        'utf8',
    );

    assert.match(source, /insertContentAt/);
    assert.doesNotMatch(source, /editorInstance\.getText\(\)/);
    assert.doesNotMatch(source, /setContent\(nextContent\.nextValue\)/);
});
