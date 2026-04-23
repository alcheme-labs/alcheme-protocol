interface ResolveCreateCircleStepAdvanceInput {
    step: number;
    totalSteps: number;
    genesisMode: 'BLANK' | 'SEEDED';
    selectedSeedFileCount: number;
}

type CreateCircleStepAdvanceDecision =
    | { type: 'advance'; nextStep: number }
    | { type: 'submit' }
    | { type: 'error'; errorKey: 'errors.seededRequired' };

export function resolveCreateCircleStepAdvance(
    input: ResolveCreateCircleStepAdvanceInput,
): CreateCircleStepAdvanceDecision {
    const lastStepIndex = Math.max(0, input.totalSteps - 1);
    const isSeededSourceStep = input.step === 1;

    if (
        isSeededSourceStep
        && input.genesisMode === 'SEEDED'
        && input.selectedSeedFileCount === 0
    ) {
        return { type: 'error', errorKey: 'errors.seededRequired' };
    }

    if (input.step < lastStepIndex) {
        return {
            type: 'advance',
            nextStep: input.step + 1,
        };
    }

    return { type: 'submit' };
}
