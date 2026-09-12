import {
    type ContributionStage,
    type DraftContributionOrigin,
    TOTAL_CONTRIBUTION_WEIGHT_BPS,
} from './types';
import { sha256Hex, stableStringify } from './evidencePackage';

export const DEFAULT_CONTRIBUTION_POLICY_VERSION = 'contribution_policy_profile:v1';

export type StagePriorBudget = Record<ContributionStage, number>;

export type HighPenetrationReviewAuthority = 'circle_owner' | 'circle_manager';

export interface HighPenetrationReviewPolicy {
    allowFallbackContinuation: boolean;
    confirmationAuthority: HighPenetrationReviewAuthority;
}

export interface ContributionPolicyProfile {
    schemaVersion: 1;
    version: typeof DEFAULT_CONTRIBUTION_POLICY_VERSION;
    scope: 'knowledge_contribution';
    hierarchy: ['evidence_event', 'stage', 'contributor', 'knowledge'];
    eventKey: 'evidence_ref_id';
    stagePriorByOrigin: Record<DraftContributionOrigin, StagePriorBudget>;
    roleWeightSource: 'retained_evidence_stage_budget';
    aggregation: {
        unit: 'basis_points';
        totalWeightBps: typeof TOTAL_CONTRIBUTION_WEIGHT_BPS;
        deduplication: 'unique_evidence_ref_id';
        normalization: 'largest_remainder';
    };
    cap: {
        perContributorMaxBps: typeof TOTAL_CONTRIBUTION_WEIGHT_BPS;
        stableDimensionRequired: true;
    };
    decay: { mode: 'none' };
    identityMerge: {
        mode: 'canonical_pubkey_only';
        automaticMerge: false;
    };
    revocation: {
        effect: 'prospective_new_snapshot_only';
        historicalSnapshotMutation: false;
    };
    exclusions: {
        voteWithoutExplicitReward: true;
        aiWorkerTriggerWithoutProof: true;
        nftOrCrystalBalance: true;
    };
    highPenetrationReview: HighPenetrationReviewPolicy;
}

export const DEFAULT_CONTRIBUTION_POLICY_PROFILE: ContributionPolicyProfile = {
    schemaVersion: 1,
    version: DEFAULT_CONTRIBUTION_POLICY_VERSION,
    scope: 'knowledge_contribution',
    hierarchy: ['evidence_event', 'stage', 'contributor', 'knowledge'],
    eventKey: 'evidence_ref_id',
    stagePriorByOrigin: {
        ai_discussion_candidate: {
            source_discussion: 7000,
            direct_author: 0,
            source_selection: 0,
            draft_modification: 2000,
            review_correction: 1000,
        },
        direct_human: {
            source_discussion: 0,
            direct_author: 6000,
            source_selection: 0,
            draft_modification: 2500,
            review_correction: 1500,
        },
        manual_selection_ai: {
            source_discussion: 6500,
            direct_author: 0,
            source_selection: 500,
            draft_modification: 2000,
            review_correction: 1000,
        },
    },
    roleWeightSource: 'retained_evidence_stage_budget',
    aggregation: {
        unit: 'basis_points',
        totalWeightBps: TOTAL_CONTRIBUTION_WEIGHT_BPS,
        deduplication: 'unique_evidence_ref_id',
        normalization: 'largest_remainder',
    },
    cap: {
        perContributorMaxBps: TOTAL_CONTRIBUTION_WEIGHT_BPS,
        stableDimensionRequired: true,
    },
    decay: { mode: 'none' },
    identityMerge: {
        mode: 'canonical_pubkey_only',
        automaticMerge: false,
    },
    revocation: {
        effect: 'prospective_new_snapshot_only',
        historicalSnapshotMutation: false,
    },
    exclusions: {
        voteWithoutExplicitReward: true,
        aiWorkerTriggerWithoutProof: true,
        nftOrCrystalBalance: true,
    },
    highPenetrationReview: {
        allowFallbackContinuation: false,
        confirmationAuthority: 'circle_owner',
    },
};

export function getContributionPolicySnapshot(
    profile: ContributionPolicyProfile = DEFAULT_CONTRIBUTION_POLICY_PROFILE,
): ContributionPolicyProfile {
    return JSON.parse(JSON.stringify(profile)) as ContributionPolicyProfile;
}

export function hashContributionPolicySnapshot(
    profile: ContributionPolicyProfile = DEFAULT_CONTRIBUTION_POLICY_PROFILE,
): string {
    return sha256Hex(stableStringify(profile));
}

export function getStagePriorForOrigin(
    draftOrigin: DraftContributionOrigin,
    profile: ContributionPolicyProfile = DEFAULT_CONTRIBUTION_POLICY_PROFILE,
): StagePriorBudget {
    const prior = profile.stagePriorByOrigin[draftOrigin];
    if (!prior) {
        throw new Error(`unknown_draft_origin:${draftOrigin}`);
    }
    return { ...prior };
}

export function getHighPenetrationReviewPolicy(
    profile: ContributionPolicyProfile = DEFAULT_CONTRIBUTION_POLICY_PROFILE,
): HighPenetrationReviewPolicy {
    return { ...profile.highPenetrationReview };
}

export function validateStagePriorBudget(budget: StagePriorBudget): void {
    const total = Object.values(budget).reduce((sum, value) => sum + value, 0);
    if (total !== TOTAL_CONTRIBUTION_WEIGHT_BPS) {
        throw new Error('stage_prior_total_must_equal_10000');
    }
    for (const [stage, weight] of Object.entries(budget)) {
        if (!Number.isInteger(weight) || weight < 0 || weight > TOTAL_CONTRIBUTION_WEIGHT_BPS) {
            throw new Error(`invalid_stage_prior_weight:${stage}`);
        }
    }
}

export function redistributeUnavailableStageBudgets(input: {
    budget: StagePriorBudget;
    availableStages: Set<ContributionStage>;
}): StagePriorBudget {
    validateStagePriorBudget(input.budget);
    const result = { ...input.budget };
    const availableStages = [...input.availableStages]
        .filter((stage) => result[stage] > 0)
        .sort();

    if (availableStages.length === 0) {
        return {
            source_discussion: 0,
            direct_author: 0,
            source_selection: 0,
            draft_modification: 0,
            review_correction: 0,
        };
    }

    let redistributionPool = 0;
    for (const stage of Object.keys(result) as ContributionStage[]) {
        if (!input.availableStages.has(stage)) {
            redistributionPool += result[stage];
            result[stage] = 0;
        }
    }

    if (redistributionPool <= 0) return result;

    const currentAvailableTotal = availableStages.reduce((sum, stage) => sum + result[stage], 0);
    if (currentAvailableTotal <= 0) {
        const base = Math.floor(redistributionPool / availableStages.length);
        let remainder = redistributionPool - base * availableStages.length;
        for (const stage of availableStages) {
            result[stage] += base + (remainder > 0 ? 1 : 0);
            remainder -= 1;
        }
        return result;
    }

    const exact = availableStages.map((stage) => ({
        stage,
        value: (result[stage] / currentAvailableTotal) * redistributionPool,
    }));
    const floors = exact.map((item) => ({
        stage: item.stage,
        value: Math.floor(item.value),
        fractional: item.value - Math.floor(item.value),
    }));
    let remainder = redistributionPool - floors.reduce((sum, item) => sum + item.value, 0);
    for (const item of floors) {
        result[item.stage] += item.value;
    }
    for (const item of [...floors].sort((a, b) => {
        if (b.fractional !== a.fractional) return b.fractional - a.fractional;
        return a.stage.localeCompare(b.stage);
    })) {
        if (remainder <= 0) break;
        result[item.stage] += 1;
        remainder -= 1;
    }
    return result;
}

export function isSourceSelectionContributionEligible(input: {
    sourceKind: 'auto_draft' | 'manual_selection' | null;
    retainedSourceSelectionImpact: boolean;
}): boolean {
    return input.sourceKind === 'manual_selection' && input.retainedSourceSelectionImpact;
}
