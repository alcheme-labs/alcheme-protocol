import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildKnowledgeReferenceOptions,
    formatCrystalReferenceMarkup,
} from '../src/lib/circle/knowledgeReferenceOptions.ts';

test('buildKnowledgeReferenceOptions keeps only parser-safe unique crystallized knowledge entries', () => {
    const options = buildKnowledgeReferenceOptions([
        { knowledgeId: 'k-z', title: 'Zeta Flow', onChainAddress: 'addr-z', version: 1 },
        { knowledgeId: 'k-a', title: 'Alpha Flow', onChainAddress: 'addr-a', version: 2 },
        { knowledgeId: '', title: 'Missing id', onChainAddress: 'addr-missing-id', version: 1 },
        { knowledgeId: 'k-missing-title', title: '', onChainAddress: 'addr-missing-title', version: 1 },
        { knowledgeId: 'k-dup-1', title: 'Duplicate Flow', onChainAddress: 'addr-dup-1', version: 1 },
        { knowledgeId: 'k-dup-2', title: 'Duplicate Flow', onChainAddress: 'addr-dup-2', version: 3 },
        { knowledgeId: 'k-hash', title: 'Hash # Flow', onChainAddress: 'addr-hash', version: 1 },
        { knowledgeId: 'k-close', title: 'Close ) Flow', onChainAddress: 'addr-close', version: 1 },
        { knowledgeId: 'k-newline', title: 'Multi\nLine', onChainAddress: 'addr-newline', version: 1 },
    ]);

    assert.deepEqual(
        options.map((option) => ({
            knowledgeId: option.knowledgeId,
            title: option.title,
            version: option.version,
        })),
        [
            { knowledgeId: 'k-a', title: 'Alpha Flow', version: 2 },
            { knowledgeId: 'k-z', title: 'Zeta Flow', version: 1 },
        ],
    );
});

test('formatCrystalReferenceMarkup renders canonical draft parser syntax', () => {
    const options = buildKnowledgeReferenceOptions([
        { knowledgeId: 'k-1', title: 'Onboarding Flow', onChainAddress: 'addr-1', version: 2 },
    ]);

    assert.equal(formatCrystalReferenceMarkup(options[0]), '@crystal(Onboarding Flow){kid=k-1}');
});

test('formatCrystalReferenceMarkup requires a stable knowledge id', () => {
    assert.throws(
        () => formatCrystalReferenceMarkup({ title: 'Onboarding Flow', knowledgeId: '' }),
        /knowledge reference requires title and knowledgeId/,
    );
    assert.throws(
        () => formatCrystalReferenceMarkup({ title: 'Onboarding Flow', knowledgeId: 'bad}id' }),
        /knowledge reference requires title and knowledgeId/,
    );
});
