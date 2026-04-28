import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(
    new URL('../src/hooks/useCrystallizeDraft.ts', import.meta.url),
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

test('useCrystallizeDraft loads resumable attempts after proof package and before submitKnowledge', () => {
    assert.match(hookSource, /fetchDraftLifecycle/);
    assert.match(hookSource, /selectMatchingResumableCrystallizationAttempt/);
    assertIncreasingOrder(hookSource, [
        'const proofPackage = assertProofPackageReady(proofPackageResponse);',
        'const lifecycleWithAttempt = await fetchDraftLifecycle({ draftPostId }).catch(() => null);',
        'const resumableAttempt = selectMatchingResumableCrystallizationAttempt(',
        'if (!resumableAttempt) {',
        'sdk.circles.submitKnowledge(',
    ]);
});

test('useCrystallizeDraft registers the submitted K_new before contributor binding', () => {
    assert.match(hookSource, /registerDraftCrystallizationAttempt/);
    assertIncreasingOrder(hookSource, [
        'knowledgeTxSignature = await sdk.circles.submitKnowledge({',
        'const registeredAttempt = await registerDraftCrystallizationAttempt({',
        'contributorsTxSignature = await sdk.circles.bindAndUpdateContributors({',
    ]);
});

test('useCrystallizeDraft skips submitKnowledge and contributor binding when a matching attempt exists', () => {
    const guardedBlockMatch = hookSource.match(/if \(!resumableAttempt\) \{([\s\S]*?)\n\s*\}\n\s*\n\s*await bindCrystallizedKnowledge/);
    assert.ok(guardedBlockMatch, 'missing resumableAttempt guard around chain submission');
    const guardedBlock = guardedBlockMatch[1];
    assert.match(guardedBlock, /sdk\.circles\.predictNextKnowledgePda/);
    assert.match(guardedBlock, /sdk\.circles\.submitKnowledge/);
    assert.match(guardedBlock, /sdk\.circles\.bindAndUpdateContributors/);
    assert.match(hookSource, /knowledgePdaBase58 = resumableAttempt\?\.knowledgeOnChainAddress \|\| '';/);
    assert.match(hookSource, /knowledgeTxSignature = resumableAttempt \? 'resumed' : '';/);
    assert.match(hookSource, /contributorsTxSignature = resumableAttempt \? 'resumed' : '';/);
});

test('useCrystallizeDraft resumes binding with existing K_new address for the same proof package hash', () => {
    assert.match(
        hookSource,
        /if \(attempt\.proofPackageHash !== proofPackageHash\) return null;/,
    );
    assert.match(
        hookSource,
        /knowledgePda: knowledgePdaBase58,/,
    );
    const submitIndex = hookSource.indexOf('sdk.circles.submitKnowledge(');
    const guardIndex = hookSource.lastIndexOf('if (!resumableAttempt) {', submitIndex);
    assert.ok(guardIndex >= 0, 'submitKnowledge must stay inside the !resumableAttempt guard');
});
