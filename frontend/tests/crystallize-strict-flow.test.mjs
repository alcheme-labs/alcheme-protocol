import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(
    new URL('../src/hooks/useCrystallizeDraft.ts', import.meta.url),
    'utf8',
);
const crystallizationApiSource = readFileSync(
    new URL('../src/lib/api/crystallization.ts', import.meta.url),
    'utf8',
);

function assertIncreasingOrder(source, checkpoints) {
    let lastIndex = -1;
    for (const marker of checkpoints) {
        const index = source.indexOf(marker);
        assert.notEqual(index, -1, `missing marker: ${marker}`);
        assert.ok(index > lastIndex, `marker order regression: ${marker}`);
        lastIndex = index;
    }
}

test('strict crystallization flow preserves readiness -> proof -> proof-package -> on-chain -> binding order', () => {
    assertIncreasingOrder(hookSource, [
        'fetchDraftPublishReadiness({',
        'fetchDraftContributorProof({',
        'fetchDraftProofPackage({',
        'sdk.circles.submitKnowledge(',
        'sdk.circles.bindAndUpdateContributors(',
        'await bindCrystallizedKnowledge({',
    ]);
});

test('strict crystallization flow uses atomic bindAndUpdateContributors in primary path', () => {
    assert.match(hookSource, /sdk\.circles\.bindAndUpdateContributors\(/);
    assert.equal(hookSource.includes('sdk.circles.updateContributors('), false);
});

test('strict crystallization flow does not swallow binding failures as warnings', () => {
    assert.equal(hookSource.includes('failed to bind knowledge source draft'), false);
    assert.equal(hookSource.includes('catch (bindingError)'), false);
});

test('strict crystallization flow retries contribution_sync_required from binding endpoint', () => {
    assert.match(hookSource, /code === 'contribution_sync_required'/);
});

test('strict crystallization flow clamps knowledge title and description by byte budget before submitKnowledge', () => {
    assert.match(hookSource, /const KNOWLEDGE_TITLE_MAX_BYTES = 128;/);
    assert.match(hookSource, /const KNOWLEDGE_DESCRIPTION_MAX_BYTES = 256;/);
    assert.match(hookSource, /title: buildKnowledgeTitle\(title\)/);
    assert.doesNotMatch(hookSource, /return normalized\.slice\(0,\s*180\)/);
});

test('final document storage upload is routed through the private discussion sidecar', () => {
    assert.match(crystallizationApiSource, /resolveNodeRoute\('discussion_runtime'\)/);
    assert.doesNotMatch(crystallizationApiSource, /input\.baseUrl}\/api\/v1\/storage/);
});
