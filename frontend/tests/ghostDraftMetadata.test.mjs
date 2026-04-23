import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const queriesSource = readFileSync(
    new URL('../src/lib/apollo/queries.ts', import.meta.url),
    'utf8',
);
const typesSource = readFileSync(
    new URL('../src/lib/apollo/types.ts', import.meta.url),
    'utf8',
);
const hookSource = readFileSync(
    new URL('../src/hooks/useGhostDraftGeneration.ts', import.meta.url),
    'utf8',
);
const revealSource = readFileSync(
    new URL('../src/components/circle/GhostReveal/GhostReveal.tsx', import.meta.url),
    'utf8',
);

test('ghost draft graphql contract requests dedicated artifact ids and provenance fields', () => {
    assert.match(queriesSource, /generationId/);
    assert.match(queriesSource, /suggestions\s*\{/);
    assert.match(queriesSource, /provenance\s*\{/);
    assert.match(queriesSource, /providerMode/);
    assert.match(queriesSource, /promptAsset/);
    assert.match(queriesSource, /promptVersion/);
    assert.match(queriesSource, /sourceDigest/);
    assert.match(queriesSource, /ghostRunId/);
});

test('frontend apollo types expose provenance as a dedicated structure instead of mixing it into draft comments', () => {
    assert.match(typesSource, /export interface GQLGhostDraftProvenance/);
    assert.match(typesSource, /export interface GQLGhostDraftSuggestion/);
    assert.match(typesSource, /generationId: number/);
    assert.match(typesSource, /provenance: GQLGhostDraftProvenance/);
    assert.doesNotMatch(typesSource, /DraftComment.*promptVersion/s);
});

test('ghost draft hook normalizes generation ids and provenance metadata for the candidate view', () => {
    assert.match(hookSource, /generationId/);
    assert.match(hookSource, /normalizeSuggestion/);
    assert.match(hookSource, /provenance/);
    assert.match(hookSource, /GQLGhostDraftProvenance/);
    assert.match(hookSource, /payload\.provenance/);
});

test('GhostReveal renders provenance metadata alongside the candidate preview', () => {
    assert.match(revealSource, /metadata\.promptVersion/);
    assert.match(revealSource, /metadata\.sourceDigest/);
    assert.match(revealSource, /candidate\.targetLabel/);
});
