import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(
    new URL('../src/components/circle/SourceMaterialsPanel/SourceMaterialsPanel.tsx', import.meta.url),
    'utf8',
);
const tabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('SourceMaterialsPanel exposes extraction and AI-readable states', () => {
    assert.match(panelSource, /status\.extracting/);
    assert.match(panelSource, /status\.aiReadable/);
    assert.match(panelSource, /type="file"/);
    assert.doesNotMatch(panelSource, /PDF 类材料/);
});

test('CrucibleTab restores source materials UI and keeps ghost draft grounding inputs wired', () => {
    assert.match(tabSource, /import SourceMaterialsPanel from ['"]@\/components\/circle\/SourceMaterialsPanel\/SourceMaterialsPanel['"]/);
    assert.match(tabSource, /<SourceMaterialsPanel/);
    assert.match(tabSource, /fetchSourceMaterials/);
    assert.match(tabSource, /uploadSourceMaterial/);
    assert.match(tabSource, /handleUploadSourceMaterial/);
    assert.match(tabSource, /await file\.text\(\)/);
    assert.match(tabSource, /sourceMaterialIds:\s*aiReadableSourceMaterialIds/);
    assert.match(tabSource, /sourceMaterialsUploading/);
});
