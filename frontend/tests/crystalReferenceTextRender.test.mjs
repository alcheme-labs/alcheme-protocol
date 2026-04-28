import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    parseCrystalReferenceText,
    sanitizeCrystalReferenceMarkersForDisplay,
} from '../src/lib/crystal/referenceMarkerText.ts';

const componentSource = readFileSync(
    new URL('../src/components/circle/CrystalReferenceText/CrystalReferenceText.tsx', import.meta.url),
    'utf8',
);

test('crystal reference text parser extracts stable crystal markers', () => {
    assert.deepEqual(
        parseCrystalReferenceText('Before @crystal(Seed Title){kid=K-source} after'),
        [
            { type: 'text', text: 'Before ' },
            { type: 'crystal', title: 'Seed Title', knowledgeId: 'K-source' },
            { type: 'text', text: ' after' },
        ],
    );
});

test('crystal reference text sanitizer hides marker internals', () => {
    assert.equal(
        sanitizeCrystalReferenceMarkersForDisplay('Claim with @crystal(Seed Title#intro){kid=K-source} and @crystal(Legacy Title)'),
        'Claim with @Seed Title and @Legacy Title',
    );
});

test('CrystalReferenceText renders stable references as knowledge links', () => {
    assert.ok(componentSource.includes('href={`/knowledge/${encodeURIComponent(token.knowledgeId)}`}'));
    assert.ok(componentSource.includes('`@${token.title}`'));
    assert.ok(componentSource.includes('event.stopPropagation()'));
});
