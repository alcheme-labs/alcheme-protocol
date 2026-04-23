import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const ghostDraftHookSource = readFileSync(
    new URL('../src/hooks/useGhostDraftGeneration.ts', import.meta.url),
    'utf8',
);

test('draft page exposes the AI source materials panel alongside grounding inputs', () => {
    assert.match(crucibleTabSource, /<SourceMaterialsPanel/);
    assert.match(crucibleTabSource, /fetchSourceMaterials/);
    assert.match(crucibleTabSource, /sourceMaterialIds:\s*aiReadableSourceMaterialIds/);
    assert.match(crucibleTabSource, /handleUploadSourceMaterial/);
    assert.match(crucibleTabSource, /sourceMaterialsUploading/);
});

test('ghost draft hook still accepts source material ids while upload UI is visible', () => {
    assert.match(ghostDraftHookSource, /sourceMaterialIds\?: number\[\] \| null/);
});
