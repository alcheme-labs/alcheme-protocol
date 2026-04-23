import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(
    new URL('../src/hooks/useGhostDraftGeneration.ts', import.meta.url),
    'utf8',
);
const tabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const typeSource = readFileSync(
    new URL('../src/lib/apollo/types.ts', import.meta.url),
    'utf8',
);

test('ghost draft frontend types expose seeded reference and source material grounding inputs', () => {
    assert.match(typeSource, /seededReference/);
    assert.match(typeSource, /sourceMaterialIds/);
});

test('CrucibleTab forwards seeded reference and AI-readable materials into the ghost draft hook', () => {
    assert.match(tabSource, /selectedSeededReference:\s*selectedSeededReference/);
    assert.match(tabSource, /sourceMaterialIds:/);
    assert.match(tabSource, /aiReadableSourceMaterialIds/);
    assert.match(tabSource, /status === 'ai_readable'/);
});

test('useGhostDraftGeneration persists grounded ghost draft inputs through the async envelope', () => {
    assert.match(hookSource, /selectedSeededReference/);
    assert.match(hookSource, /sourceMaterialIds/);
    assert.match(hookSource, /variables:\s*\{\s*input:/);
});
