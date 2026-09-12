import type { DraftContributorRole } from '../contributorProof';

export const CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION = 1 as const;
export const TOTAL_CONTRIBUTION_WEIGHT_BPS = 10_000;

export type ContributionAssessmentStatus =
    | 'prepared'
    | 'needs_review'
    | 'fallback_applied'
    | 'confirmed'
    | 'bound'
    | 'superseded'
    | 'failed';

export type ContributionAssessmentDecisionType =
    | 'review_before_crystallize'
    | 'continue_with_fallback'
    | 'confirm_high_penetration'
    | 'reject_high_penetration'
    | 'request_correction'
    | 'supersede_assessment';

export type ContributionHighPenetrationState =
    | 'none'
    | 'needs_review'
    | 'confirmed'
    | 'fallback_applied'
    | 'rejected';

export type ContributionProviderMode = 'disabled' | 'mock' | 'ai';

export type DraftContributionOrigin =
    | 'direct_human'
    | 'ai_discussion_candidate'
    | 'manual_selection_ai';

export type ContributionStage =
    | 'source_discussion'
    | 'direct_author'
    | 'source_selection'
    | 'draft_modification'
    | 'review_correction';

export type ContributionFrameType =
    | 'problem_framing'
    | 'core_claim'
    | 'evidence_boundary'
    | 'structure_expression'
    | 'review_correction';

export type ContributionType =
    | 'source_discussion'
    | 'direct_authoring'
    | 'curation'
    | 'semantic_edit'
    | 'style_edit'
    | 'review_issue'
    | 'review_solution';

export type ContributionEvidenceRole =
    | 'source_message'
    | 'direct_author'
    | 'editor'
    | 'reviewer'
    | 'curator'
    | 'operator'
    | 'system';

export type ContributionEvidenceRefType =
    | 'source_message'
    | 'draft_snapshot'
    | 'collab_edit'
    | 'review_issue'
    | 'review_application'
    | 'source_selection'
    | 'governance_claim'
    | 'governance_execution'
    | 'governance_outcome'
    | 'governance_vote'
    | 'automation_trigger';

export type ContributionFunction =
    | 'material'
    | 'claim'
    | 'edit'
    | 'review'
    | 'execution'
    | 'outcome';

export type ContributionActorRole =
    | 'external_author'
    | 'submitter'
    | 'proposal_author'
    | 'editor'
    | 'reviewer'
    | 'voter'
    | 'executor'
    | 'outcome_reviewer'
    | 'ai_worker'
    | 'trigger';

export type ContributionWeightTreatment = 'weighted' | 'trace_only' | 'excluded';

export interface ContributionRoleFact {
    factId: string;
    actorPubkey: string | null;
    actorRole: ContributionActorRole;
    contributionFunction: ContributionFunction | null;
    proofContribution: boolean;
    weightTreatment: ContributionWeightTreatment;
    reasonCode: string;
    evidenceRefs: string[];
    targetCircleId: number;
    institutionRole: 'target' | 'committee';
    institutionCircleId: number;
    governanceCaseId: string | null;
    governanceRequestId: string | null;
}

export type ContributionRetentionState =
    | 'retained'
    | 'trace_only'
    | 'excluded';

export type ContributionTraceEventType =
    | 'stage_prior_applied'
    | 'fallback_applied'
    | 'high_penetration_review_required'
    | 'allocation_normalized'
    | 'evidence_excluded'
    | 'proof_adapter_built';

export interface ContributionEvidenceContributor {
    pubkey: string;
    userId: number | null;
    handle: string | null;
    evidenceRoles: ContributionEvidenceRole[];
}

export interface ContributionEvidenceRef {
    refId: string;
    refType: ContributionEvidenceRefType;
    contributorPubkey: string | null;
    hash: string | null;
    excerpt: string | null;
    stage: ContributionStage | null;
    retention: ContributionRetentionState;
    metadata: Record<string, unknown>;
}

export interface ContributionEvidencePackage {
    schemaVersion: typeof CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION;
    draftPostId: number;
    circleId: number;
    draftOrigin: DraftContributionOrigin;
    sourceAnchor: {
        anchorId: string;
        payloadHash: string;
        summaryHash: string;
        sourceMessagesDigest: string;
    } | null;
    stableSnapshot: {
        draftVersion: number;
        contentHash: string;
        sourceEditAnchorId: string | null;
        sourceSummaryHash: string | null;
        sourceMessagesDigest: string | null;
    };
    contributors: ContributionEvidenceContributor[];
    evidenceRefs: ContributionEvidenceRef[];
    roleFacts: ContributionRoleFact[];
    finalContentDigest: string;
    boundedFinalContentExcerpt: string;
    inputContext: {
        postContentType: string | null;
        postAuthorUserId: number | null;
        snapshotCreatedByUserId: number | null;
        candidateAcceptedByUserId: number | null;
        candidateAttemptedByUserId: number | null;
        sourceKind: 'auto_draft' | 'manual_selection' | null;
    };
}

export interface ContributionAssessmentAllocationSuggestion {
    allocationId: string;
    pubkey: string;
    contributionType: ContributionType;
    weightBps: number;
    evidenceRefs: string[];
    confidence: number;
    penetration: {
        targetFrameId: string | null;
        strengthBps: number;
        requiresReview: boolean;
    };
    reasonCode: string;
    shortReason: string;
}

export interface ContributionAssessmentFrameSuggestion {
    frameId: string;
    frameType: ContributionFrameType;
    weightBps: number;
    allocations: ContributionAssessmentAllocationSuggestion[];
}

export interface ContributionAssessmentSuggestion {
    schemaVersion: typeof CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION;
    provider: ContributionProviderMode;
    algorithmVersion: string;
    framePolicyVersion: string;
    inputHash: string;
    confidence: number;
    frames: ContributionAssessmentFrameSuggestion[];
    highPenetrationCandidates: Array<{
        candidateId: string;
        sourceAllocationRef: string;
        targetFrameId: string;
        strengthBps: number;
        reasonCode: string;
        shortReason: string;
    }>;
    warnings: Array<{
        code: string;
        evidenceRefs: string[];
        message: string;
    }>;
}

export interface ContributionAssessmentDecisionRecord {
    decisionType: ContributionAssessmentDecisionType;
    candidateId?: string | null;
    actorUserId?: number | null;
    actorPubkey?: string | null;
    reason?: string | null;
    affectedRefs?: string[];
}

export interface CanonicalContributionEntry {
    pubkey: string;
    proofRole: DraftContributorRole;
    weightBps: number;
    sourceStages: ContributionStage[];
    sourceTypes: ContributionType[];
    contributionFunctions: ContributionFunction[];
    actorRoles: ContributionActorRole[];
    evidenceRefs: string[];
    traceReasons: string[];
}

export interface ContributionTraceEvent {
    eventType: ContributionTraceEventType;
    reasonCode: string;
    message: string;
    evidenceRefs: string[];
    beforeWeightBps?: number | null;
    afterWeightBps?: number | null;
}

export interface CanonicalContributionAllocation {
    schemaVersion: typeof CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION;
    draftPostId: number;
    circleId: number;
    framePolicyVersion: string;
    algorithmVersion: string;
    highPenetrationState: ContributionHighPenetrationState;
    totalWeightBps: typeof TOTAL_CONTRIBUTION_WEIGHT_BPS;
    allocationHash: string;
    contributors: CanonicalContributionEntry[];
    traceEvents: ContributionTraceEvent[];
}
