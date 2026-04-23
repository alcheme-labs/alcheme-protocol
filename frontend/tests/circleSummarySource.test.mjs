import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const adapterSource = readFileSync(
    new URL('../src/features/circle-summary/adapter.ts', import.meta.url),
    'utf8',
);
const apiSource = readFileSync(
    new URL('../src/features/circle-summary/api.ts', import.meta.url),
    'utf8',
);
const panelSource = readFileSync(
    new URL('../src/features/circle-summary/SummaryReadinessPanel.tsx', import.meta.url),
    'utf8',
);

test('circle summary adapter normalizes persisted generation metadata instead of only generatedBy', () => {
    assert.match(adapterSource, /generationMetadata/);
    assert.match(adapterSource, /providerMode/);
    assert.match(adapterSource, /promptAsset/);
    assert.match(adapterSource, /promptVersion/);
    assert.match(adapterSource, /sourceDigest/);
});

test('circle summary api keeps the existing synchronous snapshot contract and reads generation metadata from the route payload', () => {
    assert.match(apiSource, /summary-snapshots\/latest/);
    assert.match(apiSource, /pickCircleSummarySnapshot/);
    assert.match(apiSource, /generationMetadata/);
    assert.doesNotMatch(apiSource, /ai-jobs/);
});

test('SummaryReadinessPanel renders human-readable summary provenance for projection and llm snapshots', () => {
    assert.match(panelSource, /提示词版本/);
    assert.match(panelSource, /来源模型/);
    assert.match(panelSource, /上下文指纹/);
    assert.match(adapterSource, /系统 LLM/);
    assert.match(adapterSource, /系统投影/);
});
