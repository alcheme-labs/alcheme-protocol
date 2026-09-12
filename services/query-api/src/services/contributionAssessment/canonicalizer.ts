import {
    hashContributionEvidencePackage,
    sha256Hex,
    stableStringify,
} from './evidencePackage';
import {
    shouldRetainEvidenceForFinalAllocation,
} from './finalContentDiff';
import {
    DEFAULT_CONTRIBUTION_POLICY_VERSION,
    getStagePriorForOrigin,
    isSourceSelectionContributionEligible,
    redistributeUnavailableStageBudgets,
} from './policy';
import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    TOTAL_CONTRIBUTION_WEIGHT_BPS,
    type CanonicalContributionAllocation,
    type CanonicalContributionEntry,
    type ContributionAssessmentDecisionRecord,
    type ContributionAssessmentSuggestion,
    type ContributionRoleFact,
    type ContributionEvidencePackage,
    type ContributionEvidenceRef,
    type ContributionFunction,
    type ContributionHighPenetrationState,
    type ContributionStage,
    type ContributionTraceEvent,
    type ContributionType,
} from './types';
import {
    validateContributionAssessmentSuggestion,
} from './validator';

const CONTRIBUTION_TYPE_TO_STAGE: Record<ContributionType, ContributionStage> = {
    source_discussion: 'source_discussion',
    direct_authoring: 'direct_author',
    curation: 'source_selection',
    semantic_edit: 'draft_modification',
    style_edit: 'draft_modification',
    review_issue: 'review_correction',
    review_solution: 'review_correction',
};

const HIGH_PENETRATION_RESOLUTION_TYPES = new Set<ContributionAssessmentDecisionRecord['decisionType']>([
    'confirm_high_penetration',
    'continue_with_fallback',
    'reject_high_penetration',
]);

function distributeWeightBps(totalBps: number, keys: string[], weights?: Map<string, number>): Map<string, number> {
    const result = new Map<string, number>();
    if (totalBps <= 0 || keys.length === 0) return result;
    const orderedKeys = [...keys].sort();
    const rawWeights = orderedKeys.map((key) => Math.max(0, weights?.get(key) ?? 1));
    const weightTotal = rawWeights.reduce((sum, value) => sum + value, 0);
    if (weightTotal <= 0) {
        const base = Math.floor(totalBps / orderedKeys.length);
        let remainder = totalBps - base * orderedKeys.length;
        for (const key of orderedKeys) {
            result.set(key, base + (remainder > 0 ? 1 : 0));
            remainder -= 1;
        }
        return result;
    }
    const exact = orderedKeys.map((key, index) => ({
        key,
        value: (rawWeights[index] / weightTotal) * totalBps,
    }));
    const floors = exact.map((item) => ({
        key: item.key,
        value: Math.floor(item.value),
        fractional: item.value - Math.floor(item.value),
    }));
    let remainder = totalBps - floors.reduce((sum, item) => sum + item.value, 0);
    for (const item of floors) result.set(item.key, item.value);
    for (const item of [...floors].sort((a, b) => {
        if (b.fractional !== a.fractional) return b.fractional - a.fractional;
        return a.key.localeCompare(b.key);
    })) {
        if (remainder <= 0) break;
        result.set(item.key, (result.get(item.key) || 0) + 1);
        remainder -= 1;
    }
    return result;
}

function getAssessmentLevelDecisionType(
    decisions: ContributionAssessmentDecisionRecord[] | undefined,
): ContributionAssessmentDecisionRecord['decisionType'] | null {
    const decision = (decisions ?? []).find((item) =>
        !item.candidateId
        && HIGH_PENETRATION_RESOLUTION_TYPES.has(item.decisionType)
    );
    return decision?.decisionType ?? null;
}

function getDecisionType(
    decisions: ContributionAssessmentDecisionRecord[] | undefined,
    candidateId: string,
): ContributionAssessmentDecisionRecord['decisionType'] | null {
    return decisions?.find((decision) => decision.candidateId === candidateId)?.decisionType
        ?? getAssessmentLevelDecisionType(decisions);
}

function resolveHighPenetrationState(input: {
    suggestion?: ContributionAssessmentSuggestion | null;
    decisions?: ContributionAssessmentDecisionRecord[];
    fallbackApplied?: boolean;
}): ContributionHighPenetrationState {
    if (input.fallbackApplied) return 'fallback_applied';
    const candidates = input.suggestion?.highPenetrationCandidates ?? [];
    const allocationRequiresReview = suggestionRequiresHighPenetrationReview(input.suggestion ?? null);
    const assessmentLevelDecision = getAssessmentLevelDecisionType(input.decisions);
    if (assessmentLevelDecision === 'continue_with_fallback') return 'fallback_applied';
    if (assessmentLevelDecision === 'confirm_high_penetration') return 'confirmed';
    if (assessmentLevelDecision === 'reject_high_penetration') return 'rejected';
    if (candidates.length === 0) return allocationRequiresReview ? 'needs_review' : 'none';
    const decisions = candidates.map((candidate) => getDecisionType(input.decisions, candidate.candidateId));
    if (decisions.every((decision) => decision === 'confirm_high_penetration')) return 'confirmed';
    if (decisions.every((decision) => decision === 'reject_high_penetration')) return 'rejected';
    if (decisions.some((decision) => decision === 'continue_with_fallback')) return 'fallback_applied';
    return 'needs_review';
}

function suggestionRequiresHighPenetrationReview(
    suggestion: ContributionAssessmentSuggestion | null,
): boolean {
    if (!suggestion) return false;
    if (suggestion.highPenetrationCandidates.length > 0) return true;
    return suggestion.frames.some((frame) =>
        frame.allocations.some((allocation) =>
            allocation.penetration.requiresReview
            || allocation.penetration.strengthBps >= 8000
        )
    );
}

function hasContinueWithFallbackDecision(input: {
    suggestion: ContributionAssessmentSuggestion;
    decisions?: ContributionAssessmentDecisionRecord[];
}): boolean {
    const candidateIds = new Set(input.suggestion.highPenetrationCandidates.map((candidate) => candidate.candidateId));
    return (input.decisions ?? []).some((decision) =>
        decision.decisionType === 'continue_with_fallback'
        && (
            !decision.candidateId
            || candidateIds.has(decision.candidateId)
        )
    );
}

function getRetainedEvidenceRefs(evidence: ContributionEvidencePackage): Map<string, ContributionEvidenceRef> {
    return new Map(
        evidence.evidenceRefs
            .filter((ref) => shouldRetainEvidenceForFinalAllocation({
                retention: ref.retention,
                isLifecycleFallbackAnchor:
                    ref.metadata?.isLifecycleFallbackAnchor === true
                    || ref.metadata?.lifecycleFallbackAnchor === true
                    || ref.metadata?.anchorPurpose === 'lifecycle_fallback',
            }))
            .map((ref) => [ref.refId, ref]),
    );
}

function buildAllocationHash(input: Omit<CanonicalContributionAllocation, 'allocationHash'>): string {
    return sha256Hex(stableStringify(input));
}

function normalizeCanonicalEntries(input: {
    draftPostId: number;
    circleId: number;
    framePolicyVersion: string;
    algorithmVersion: string;
    highPenetrationState: ContributionHighPenetrationState;
    roleFacts: ContributionRoleFact[];
    rawEntries: Map<string, {
        weightBps: number;
        sourceStages: Set<ContributionStage>;
        sourceTypes: Set<ContributionType>;
        evidenceRefs: Set<string>;
        traceReasons: Set<string>;
    }>;
    traceEvents: ContributionTraceEvent[];
}): CanonicalContributionAllocation {
    const keys = [...input.rawEntries.keys()].sort();
    const rawWeights = new Map(keys.map((key) => [key, input.rawEntries.get(key)!.weightBps]));
    const normalizedWeights = distributeWeightBps(TOTAL_CONTRIBUTION_WEIGHT_BPS, keys, rawWeights);
    const contributors: CanonicalContributionEntry[] = keys
        .map((pubkey) => {
            const entry = input.rawEntries.get(pubkey)!;
            const sourceStages = [...entry.sourceStages].sort();
            const sourceTypes = [...entry.sourceTypes].sort();
            const entryEvidenceRefs = new Set(entry.evidenceRefs);
            const weightedRoleFacts = input.roleFacts.filter((fact) => (
                fact.actorPubkey === pubkey
                && fact.weightTreatment === 'weighted'
                && fact.evidenceRefs.some((refId) => entryEvidenceRefs.has(refId))
            ));
            return {
                pubkey,
                proofRole: sourceStages.includes('direct_author') ? 'Author' as const : 'Discussant' as const,
                weightBps: normalizedWeights.get(pubkey) || 0,
                sourceStages,
                sourceTypes,
                contributionFunctions: Array.from(new Set(
                    weightedRoleFacts
                        .map((fact) => fact.contributionFunction)
                        .filter((value): value is ContributionFunction => value !== null),
                )).sort(),
                actorRoles: Array.from(new Set(
                    weightedRoleFacts.map((fact) => fact.actorRole),
                )).sort(),
                evidenceRefs: [...entry.evidenceRefs].sort(),
                traceReasons: [...entry.traceReasons].sort(),
            };
        })
        .filter((entry) => entry.weightBps > 0);
    const withoutHash = {
        schemaVersion: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        framePolicyVersion: input.framePolicyVersion,
        algorithmVersion: input.algorithmVersion,
        highPenetrationState: input.highPenetrationState,
        totalWeightBps: TOTAL_CONTRIBUTION_WEIGHT_BPS as typeof TOTAL_CONTRIBUTION_WEIGHT_BPS,
        contributors,
        traceEvents: input.traceEvents,
    };
    return {
        ...withoutHash,
        allocationHash: buildAllocationHash(withoutHash),
    };
}

export function buildFallbackCanonicalAllocation(input: {
    evidence: ContributionEvidencePackage;
    algorithmVersion?: string;
}): CanonicalContributionAllocation {
    // Legacy compatibility only: do not use this for provider failures or new proof binding.
    const retainedRefs = getRetainedEvidenceRefs(input.evidence);
    const stageToRefs = new Map<ContributionStage, ContributionEvidenceRef[]>();
    for (const ref of retainedRefs.values()) {
        if (!ref.stage || !ref.contributorPubkey) continue;
        if (
            ref.stage === 'source_selection'
            && !isSourceSelectionContributionEligible({
                sourceKind: input.evidence.inputContext.sourceKind,
                retainedSourceSelectionImpact: ref.metadata?.retainedSourceSelectionImpact === true,
            })
        ) {
            continue;
        }
        const refs = stageToRefs.get(ref.stage) ?? [];
        refs.push(ref);
        stageToRefs.set(ref.stage, refs);
    }
    const availableStages = new Set(stageToRefs.keys());
    const redistributedBudget = redistributeUnavailableStageBudgets({
        budget: getStagePriorForOrigin(input.evidence.draftOrigin),
        availableStages,
    });
    const rawEntries = new Map<string, {
        weightBps: number;
        sourceStages: Set<ContributionStage>;
        sourceTypes: Set<ContributionType>;
        evidenceRefs: Set<string>;
        traceReasons: Set<string>;
    }>();
    const traceEvents: ContributionTraceEvent[] = [{
        eventType: 'stage_prior_applied',
        reasonCode: 'deterministic_fallback_stage_prior',
        message: 'Applied deterministic stage prior over retained evidence.',
        evidenceRefs: [...retainedRefs.keys()].sort(),
    }];

    for (const [stage, refs] of [...stageToRefs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const stageBudget = redistributedBudget[stage] || 0;
        if (stageBudget <= 0) continue;
        const contributors = Array.from(new Set(refs.map((ref) => ref.contributorPubkey).filter(Boolean) as string[]));
        const sourceWeights = new Map<string, number>();
        for (const ref of refs) {
            const pubkey = ref.contributorPubkey;
            if (!pubkey) continue;
            const score = Number(ref.metadata?.semanticScore ?? ref.metadata?.impactScore ?? 1);
            sourceWeights.set(pubkey, (sourceWeights.get(pubkey) || 0) + (Number.isFinite(score) ? Math.max(0, score) : 1));
        }
        const distributed = distributeWeightBps(stageBudget, contributors, sourceWeights);
        for (const [pubkey, weightBps] of distributed.entries()) {
            if (weightBps <= 0) continue;
            const existing = rawEntries.get(pubkey) ?? {
                weightBps: 0,
                sourceStages: new Set<ContributionStage>(),
                sourceTypes: new Set<ContributionType>(),
                evidenceRefs: new Set<string>(),
                traceReasons: new Set<string>(),
            };
            existing.weightBps += weightBps;
            existing.sourceStages.add(stage);
            const sourceType = stage === 'direct_author'
                ? 'direct_authoring'
                : stage === 'source_selection'
                    ? 'curation'
                    : stage === 'draft_modification'
                        ? 'style_edit'
                        : stage === 'review_correction'
                            ? 'review_issue'
                            : 'source_discussion';
            existing.sourceTypes.add(sourceType);
            refs.filter((ref) => ref.contributorPubkey === pubkey).forEach((ref) => existing.evidenceRefs.add(ref.refId));
            existing.traceReasons.add(`fallback:${stage}`);
            rawEntries.set(pubkey, existing);
        }
    }

    if (rawEntries.size === 0) {
        throw new Error('canonical_allocation_empty');
    }

    return normalizeCanonicalEntries({
        draftPostId: input.evidence.draftPostId,
        circleId: input.evidence.circleId,
        framePolicyVersion: DEFAULT_CONTRIBUTION_POLICY_VERSION,
        algorithmVersion: input.algorithmVersion ?? 'deterministic-fallback:v1',
        highPenetrationState: 'fallback_applied',
        roleFacts: input.evidence.roleFacts,
        rawEntries,
        traceEvents,
    });
}

export function buildUnavailableCanonicalAllocation(input: {
    evidence: ContributionEvidencePackage;
    algorithmVersion: string;
}): CanonicalContributionAllocation {
    const withoutHash = {
        schemaVersion: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        draftPostId: input.evidence.draftPostId,
        circleId: input.evidence.circleId,
        framePolicyVersion: DEFAULT_CONTRIBUTION_POLICY_VERSION,
        algorithmVersion: input.algorithmVersion,
        highPenetrationState: 'needs_review' as const,
        totalWeightBps: TOTAL_CONTRIBUTION_WEIGHT_BPS as typeof TOTAL_CONTRIBUTION_WEIGHT_BPS,
        contributors: [],
        traceEvents: [],
    };
    return {
        ...withoutHash,
        allocationHash: buildAllocationHash(withoutHash),
    };
}

export function buildCanonicalAllocationFromSuggestion(input: {
    evidence: ContributionEvidencePackage;
    suggestion: ContributionAssessmentSuggestion;
    decisions?: ContributionAssessmentDecisionRecord[];
    // Deprecated compatibility flag. New canonicalization must not turn unresolved review into fallback contributors.
    fallbackOnUnconfirmedHighPenetration?: boolean;
}): CanonicalContributionAllocation {
    if (hasContinueWithFallbackDecision({ suggestion: input.suggestion, decisions: input.decisions })) {
        return buildUnavailableCanonicalAllocation({
            evidence: input.evidence,
            algorithmVersion: `${input.suggestion.algorithmVersion}:fallback-decision-unavailable:v1`,
        });
    }
    const highPenetrationState = resolveHighPenetrationState({
        suggestion: input.suggestion,
        decisions: input.decisions,
    });
    validateContributionAssessmentSuggestion({
        evidence: input.evidence,
        suggestion: input.suggestion,
        expectedInputHash: hashContributionEvidencePackage(input.evidence),
        decisions: input.decisions,
    });

    const retainedRefs = getRetainedEvidenceRefs(input.evidence);
    const rejectedAllocationIds = new Set<string>();
    const assessmentLevelDecision = getAssessmentLevelDecisionType(input.decisions);
    for (const candidate of input.suggestion.highPenetrationCandidates) {
        const decision = getDecisionType(input.decisions, candidate.candidateId);
        if (decision !== 'confirm_high_penetration') {
            rejectedAllocationIds.add(candidate.sourceAllocationRef);
        }
    }

    const rawEntries = new Map<string, {
        weightBps: number;
        sourceStages: Set<ContributionStage>;
        sourceTypes: Set<ContributionType>;
        evidenceRefs: Set<string>;
        traceReasons: Set<string>;
    }>();
    const traceEvents: ContributionTraceEvent[] = [];

    for (const frame of input.suggestion.frames) {
        for (const allocation of frame.allocations) {
            const allocationRequiresReview =
                allocation.penetration.requiresReview
                || allocation.penetration.strengthBps >= 8000;
            if (allocation.weightBps <= 0) {
                traceEvents.push({
                    eventType: 'evidence_excluded',
                    reasonCode: 'zero_weight_allocation',
                    message: 'Zero-weight allocation was ignored before canonical normalization.',
                    evidenceRefs: allocation.evidenceRefs,
                    beforeWeightBps: allocation.weightBps,
                    afterWeightBps: 0,
                });
                continue;
            }
            if (allocationRequiresReview && assessmentLevelDecision === 'reject_high_penetration') {
                traceEvents.push({
                    eventType: 'fallback_applied',
                    reasonCode: 'high_penetration_rejected',
                    message: 'Excluded rejected high-penetration allocation from canonical root.',
                    evidenceRefs: allocation.evidenceRefs,
                    beforeWeightBps: allocation.weightBps,
                    afterWeightBps: 0,
                });
                continue;
            }
            if (rejectedAllocationIds.has(allocation.allocationId)) {
                traceEvents.push({
                    eventType: 'fallback_applied',
                    reasonCode: 'high_penetration_not_confirmed',
                    message: 'Excluded unconfirmed high-penetration allocation from canonical root.',
                    evidenceRefs: allocation.evidenceRefs,
                    beforeWeightBps: allocation.weightBps,
                    afterWeightBps: 0,
                });
                continue;
            }
            const retainedAllocationRefs = allocation.evidenceRefs.filter((refId) => retainedRefs.has(refId));
            if (retainedAllocationRefs.length === 0) {
                traceEvents.push({
                    eventType: 'evidence_excluded',
                    reasonCode: 'allocation_not_retained',
                    message: 'Allocation evidence was not retained in the final content.',
                    evidenceRefs: allocation.evidenceRefs,
                    beforeWeightBps: allocation.weightBps,
                    afterWeightBps: 0,
                });
                continue;
            }
            const stage = CONTRIBUTION_TYPE_TO_STAGE[allocation.contributionType];
            if (
                stage === 'source_selection'
                && !retainedAllocationRefs.some((refId) =>
                    retainedRefs.get(refId)?.metadata?.retainedSourceSelectionImpact === true
                )
            ) {
                continue;
            }
            const existing = rawEntries.get(allocation.pubkey) ?? {
                weightBps: 0,
                sourceStages: new Set<ContributionStage>(),
                sourceTypes: new Set<ContributionType>(),
                evidenceRefs: new Set<string>(),
                traceReasons: new Set<string>(),
            };
            existing.weightBps += allocation.weightBps;
            existing.sourceStages.add(stage);
            existing.sourceTypes.add(allocation.contributionType);
            retainedAllocationRefs.forEach((refId) => existing.evidenceRefs.add(refId));
            existing.traceReasons.add(allocation.reasonCode);
            rawEntries.set(allocation.pubkey, existing);
        }
    }

    if (rawEntries.size === 0) {
        return buildUnavailableCanonicalAllocation({
            evidence: input.evidence,
            algorithmVersion: `${input.suggestion.algorithmVersion}:empty-unavailable:v1`,
        });
    }

    return normalizeCanonicalEntries({
        draftPostId: input.evidence.draftPostId,
        circleId: input.evidence.circleId,
        framePolicyVersion: input.suggestion.framePolicyVersion,
        algorithmVersion: input.suggestion.algorithmVersion,
        highPenetrationState,
        roleFacts: input.evidence.roleFacts,
        rawEntries,
        traceEvents,
    });
}
