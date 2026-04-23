import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    buildKnowledgeReferenceOptions,
    filterKnowledgeReferenceOptions,
} from '../src/lib/circle/knowledgeReferenceOptions.ts';

test('filterKnowledgeReferenceOptions matches current-circle titles case-insensitively', () => {
    const options = buildKnowledgeReferenceOptions([
        { knowledgeId: 'k-1', title: 'Onboarding Flow', onChainAddress: 'addr-1', version: 1 },
        { knowledgeId: 'k-2', title: 'Membership Handshake', onChainAddress: 'addr-2', version: 2 },
        { knowledgeId: 'k-3', title: 'Welcome Prompts', onChainAddress: 'addr-3', version: 1 },
    ]);

    const filtered = filterKnowledgeReferenceOptions(options, 'flow');

    assert.deepEqual(
        filtered.map((option) => option.title),
        ['Onboarding Flow'],
    );
});

test('KnowledgeReferencePicker exposes a compact onSelect path without a modal takeover', () => {
    const source = readFileSync(
        new URL('../src/components/circle/KnowledgeReferencePicker/KnowledgeReferencePicker.tsx', import.meta.url),
        'utf8',
    );

    assert.match(source, /onSelect:\s*\(option:/);
    assert.match(source, /onClose\?:\s*\(\)\s*=>\s*void/);
    assert.doesNotMatch(source, /role=['"]dialog['"]/);
});

test('KnowledgeReferencePicker copy makes the preloaded 50-item phase-1 cap explicit', () => {
    const zhMessages = readFileSync(
        new URL('../src/i18n/messages/zh.json', import.meta.url),
        'utf8',
    );
    const enMessages = readFileSync(
        new URL('../src/i18n/messages/en.json', import.meta.url),
        'utf8',
    );

    assert.match(zhMessages, /最多 50 条/);
    assert.match(enMessages, /up to 50/);
});
