import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sanitizeCrystalReferenceMarkersForDisplay } from '../src/lib/crystal/referenceMarkerText.ts';

const hookSource = readFileSync(
    new URL('../src/hooks/useCrystallizeDraft.ts', import.meta.url),
    'utf8',
);

function collapseWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}

test('crystallized knowledge descriptions hide raw kid marker internals', () => {
    const sanitized = collapseWhitespace(
        sanitizeCrystalReferenceMarkersForDisplay('Claim with @crystal(Seed Title){kid=K-source}'),
    );

    assert.equal(sanitized, 'Claim with @Seed Title');
    assert.doesNotMatch(sanitized, /\{kid=/);
});

test('buildKnowledgeDescription uses the shared crystal marker sanitizer', () => {
    assert.match(hookSource, /sanitizeCrystalReferenceMarkersForDisplay/);
    assert.match(hookSource, /collapseWhitespace\(sanitizeCrystalReferenceMarkersForDisplay\(content\)\)/);
});
