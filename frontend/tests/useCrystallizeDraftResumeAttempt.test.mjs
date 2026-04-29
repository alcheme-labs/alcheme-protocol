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

test('useCrystallizeDraft skips submitKnowledge when a matching attempt exists', () => {
    const guardStart = hookSource.indexOf('if (!resumableAttempt) {');
    const bindingGuardStart = hookSource.indexOf('if (shouldSubmitContributorBinding(resumableAttempt)) {');
    assert.ok(guardStart >= 0, 'missing resumableAttempt guard around knowledge submission');
    assert.ok(bindingGuardStart > guardStart, 'contributor binding guard should follow knowledge submission guard');
    const guardedBlock = hookSource.slice(guardStart, bindingGuardStart);
    assert.match(guardedBlock, /sdk\.circles\.predictNextKnowledgePda/);
    assert.match(guardedBlock, /sdk\.circles\.submitKnowledge/);
    assert.doesNotMatch(guardedBlock, /sdk\.circles\.bindAndUpdateContributors/);
    assert.match(hookSource, /knowledgePdaBase58 = resumableAttempt\?\.knowledgeOnChainAddress \|\| '';/);
    assert.match(hookSource, /knowledgeTxSignature = resumableAttempt \? 'resumed' : '';/);
});

test('useCrystallizeDraft resumes contributor binding for binding-pending attempts', () => {
    assert.match(hookSource, /function shouldSubmitContributorBinding/);
    assert.match(hookSource, /attempt\.status === 'submitted'/);
    assert.match(hookSource, /attempt\.status === 'binding_pending'/);
    assert.match(hookSource, /if \(shouldSubmitContributorBinding\(resumableAttempt\)\) \{/);
    assertIncreasingOrder(hookSource, [
        'const registeredAttempt = await registerDraftCrystallizationAttempt({',
        'if (shouldSubmitContributorBinding(resumableAttempt)) {',
        'contributorsTxSignature = await sdk.circles.bindAndUpdateContributors({',
    ]);
});

test('useCrystallizeDraft treats existing knowledge binding PDA as idempotent recovery', () => {
    assert.match(hookSource, /function isExistingKnowledgeBindingAccountError/);
    assert.match(hookSource, /expectedKnowledgeBindingPda\.toBase58\(\)/);
    assert.match(hookSource, /sdk\.pda\.findKnowledgeBindingPda\(knowledgePdaForBinding\)/);
    assertIncreasingOrder(hookSource, [
        'const expectedKnowledgeBindingPda = sdk.pda.findKnowledgeBindingPda(knowledgePdaForBinding);',
        'contributorsTxSignature = await sdk.circles.bindAndUpdateContributors({',
        'if (!isExistingKnowledgeBindingAccountError(error, expectedKnowledgeBindingPda)) {',
        "contributorsTxSignature = 'existing_binding';",
        'await bindCrystallizedKnowledge({',
    ]);
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
