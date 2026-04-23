import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveDraftReferenceSurface } from '../src/lib/circle/draftReferenceSurface.ts';

test('non-seeded circles only expose formal reference summary state', () => {
    const surface = deriveDraftReferenceSurface({
        isSeededCircle: false,
        referenceLinks: [],
        seededFileTree: [],
    });

    assert.equal(surface.showPanel, true);
    assert.equal(surface.showFormalReferenceSummary, true);
    assert.equal(surface.showSeededEvidence, false);
    assert.equal(surface.showAiSourceMaterials, false);
    assert.equal(surface.formalReferenceCount, 0);
    assert.deepEqual(surface.formalReferenceNames, []);
});

test('seeded circles expose seeded evidence state alongside formal references', () => {
    const surface = deriveDraftReferenceSurface({
        isSeededCircle: true,
        referenceLinks: [],
        seededFileTree: [
            {
                id: 1,
                nodeType: 'file',
                name: 'guide.md',
                path: 'docs/guide.md',
                depth: 0,
                sortOrder: 0,
                mimeType: 'text/markdown',
                byteSize: 20,
                lineCount: 2,
                contentDigest: 'abc',
                contentText: '# Guide',
                children: [],
            },
        ],
    });

    assert.equal(surface.showFormalReferenceSummary, true);
    assert.equal(surface.showSeededEvidence, true);
    assert.equal(surface.showAiSourceMaterials, false);
});

test('seeded circles keep seeded evidence surface visible before the tree loads any file nodes', () => {
    const surface = deriveDraftReferenceSurface({
        isSeededCircle: true,
        referenceLinks: [],
        seededFileTree: [],
    });

    assert.equal(surface.showFormalReferenceSummary, true);
    assert.equal(surface.showSeededEvidence, true);
});

test('formal reference summary deduplicates crystal names from parsed draft references', () => {
    const surface = deriveDraftReferenceSurface({
        isSeededCircle: false,
        referenceLinks: [
            {
                referenceId: 'ref-1',
                draftPostId: 7,
                draftVersion: 2,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Onboarding Crystal',
                crystalBlockAnchor: null,
                status: 'parsed',
            },
            {
                referenceId: 'ref-2',
                draftPostId: 7,
                draftVersion: 2,
                sourceBlockId: 'paragraph:1',
                crystalName: 'Onboarding Crystal',
                crystalBlockAnchor: 'anchor-a',
                status: 'parsed',
            },
            {
                referenceId: 'ref-3',
                draftPostId: 7,
                draftVersion: 2,
                sourceBlockId: 'paragraph:2',
                crystalName: 'Policy Crystal',
                crystalBlockAnchor: null,
                status: 'parsed',
            },
        ],
        seededFileTree: [],
    });

    assert.equal(surface.formalReferenceCount, 3);
    assert.deepEqual(surface.formalReferenceNames, ['Onboarding Crystal', 'Policy Crystal']);
});
