import { hashContributionEvidencePackage } from './evidencePackage';
import {
    DEFAULT_CONTRIBUTION_POLICY_VERSION,
    getStagePriorForOrigin,
    isSourceSelectionContributionEligible,
    redistributeUnavailableStageBudgets,
} from './policy';
import type { ContributionAssessmentProvider } from './provider';
import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    type ContributionAssessmentSuggestion,
    type ContributionEvidencePackage,
    type ContributionEvidenceRef,
    type ContributionStage,
    type ContributionType,
} from './types';

const MOCK_ALGORITHM_VERSION = 'mock:contribution-assessment:v1';

const STAGE_TO_CONTRIBUTION_TYPE: Record<ContributionStage, ContributionType> = {
    source_discussion: 'source_discussion',
    direct_author: 'direct_authoring',
    source_selection: 'curation',
    draft_modification: 'style_edit',
    review_correction: 'review_issue',
};

function getRetainedContributionRefs(evidence: ContributionEvidencePackage): ContributionEvidenceRef[] {
    return evidence.evidenceRefs
        .filter((ref) =>
            ref.retention === 'retained'
            && ref.stage !== null
            && ref.contributorPubkey !== null
            && ref.metadata?.isLifecycleFallbackAnchor !== true
            && ref.metadata?.lifecycleFallbackAnchor !== true
            && ref.metadata?.anchorPurpose !== 'lifecycle_fallback'
        )
        .filter((ref) => {
            if (ref.stage !== 'source_selection') return true;
            return isSourceSelectionContributionEligible({
                sourceKind: evidence.inputContext.sourceKind,
                retainedSourceSelectionImpact: ref.metadata?.retainedSourceSelectionImpact === true,
            });
        });
}

function stageToFrameType(stage: ContributionStage): ContributionAssessmentSuggestion['frames'][number]['frameType'] {
    if (stage === 'source_discussion') return 'core_claim';
    if (stage === 'direct_author') return 'core_claim';
    if (stage === 'source_selection') return 'problem_framing';
    if (stage === 'draft_modification') return 'structure_expression';
    return 'review_correction';
}

function distributeWeightBps(totalBps: number, keys: string[]): Map<string, number> {
    const result = new Map<string, number>();
    if (totalBps <= 0 || keys.length === 0) return result;
    const orderedKeys = [...keys].sort();
    const base = Math.floor(totalBps / orderedKeys.length);
    let remainder = totalBps - base * orderedKeys.length;
    for (const key of orderedKeys) {
        result.set(key, base + (remainder > 0 ? 1 : 0));
        remainder -= 1;
    }
    return result;
}

export function buildMockContributionAssessmentSuggestion(
    evidence: ContributionEvidencePackage,
): ContributionAssessmentSuggestion {
    const retainedRefs = getRetainedContributionRefs(evidence);
    const refsByStage = new Map<ContributionStage, ContributionEvidenceRef[]>();
    for (const ref of retainedRefs) {
        const stage = ref.stage as ContributionStage;
        const refs = refsByStage.get(stage) ?? [];
        refs.push(ref);
        refsByStage.set(stage, refs);
    }
    const availableStages = new Set(refsByStage.keys());
    const stageBudgets = redistributeUnavailableStageBudgets({
        budget: getStagePriorForOrigin(evidence.draftOrigin),
        availableStages,
    });
    const frames: ContributionAssessmentSuggestion['frames'] = [];

    for (const stage of [...refsByStage.keys()].sort()) {
        const stageBudget = stageBudgets[stage] || 0;
        if (stageBudget <= 0) continue;
        const refs = [...(refsByStage.get(stage) ?? [])].sort((a, b) => a.refId.localeCompare(b.refId));
        const pubkeys = [...new Set(refs.map((ref) => ref.contributorPubkey).filter(Boolean) as string[])].sort();
        const weights = distributeWeightBps(stageBudget, pubkeys);
        const allocations = pubkeys
            .map((pubkey) => {
                const evidenceRefs = refs
                    .filter((ref) => ref.contributorPubkey === pubkey)
                    .map((ref) => ref.refId)
                    .sort();
                return {
                    allocationId: `mock:${stage}:${pubkey}`,
                    pubkey,
                    contributionType: STAGE_TO_CONTRIBUTION_TYPE[stage],
                    weightBps: weights.get(pubkey) || 0,
                    evidenceRefs,
                    confidence: 0.5,
                    penetration: {
                        targetFrameId: null,
                        strengthBps: 0,
                        requiresReview: false,
                    },
                    reasonCode: `mock_retained_${stage}`,
                    shortReason: `Retained ${stage.replace(/_/g, ' ')} evidence.`,
                };
            })
            .filter((allocation) => allocation.weightBps > 0 && allocation.evidenceRefs.length > 0);
        if (allocations.length === 0) continue;
        frames.push({
            frameId: `mock:${stage}`,
            frameType: stageToFrameType(stage),
            weightBps: allocations.reduce((sum, allocation) => sum + allocation.weightBps, 0),
            allocations,
        });
    }

    if (frames.length === 0) {
        throw new Error('mock_contribution_assessment_no_retained_evidence');
    }

    return {
        schemaVersion: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        provider: 'mock',
        algorithmVersion: MOCK_ALGORITHM_VERSION,
        framePolicyVersion: DEFAULT_CONTRIBUTION_POLICY_VERSION,
        inputHash: hashContributionEvidencePackage(evidence),
        confidence: 0.5,
        frames,
        highPenetrationCandidates: [],
        warnings: [{
            code: 'mock_provider_conservative',
            evidenceRefs: [],
            message: 'Mock provider uses deterministic retained evidence only and does not perform semantic attribution.',
        }],
    };
}

export function createMockContributionAssessmentProvider(): ContributionAssessmentProvider {
    return {
        mode: 'mock',
        async assessDraftContribution(input) {
            return buildMockContributionAssessmentSuggestion(input);
        },
    };
}
