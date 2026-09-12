import type { EvidenceRef, EvidenceSourceType, EvidenceVisibility } from '../types';

export const NEUTRAL_EVALUATION_TASK_TYPE = 'evaluation.neutral.v1';
export const NEUTRAL_EVALUATION_SCHEMA_VERSION = 'v1';
export const NEUTRAL_EVALUATION_MAX_OUTPUT_TOKENS = 1800;

export type NeutralEvaluationSubjectType = 'post' | 'draft_post' | 'source_material';
export type NeutralEvaluationStatus =
    | 'pending'
    | 'ready'
    | 'no_source'
    | 'blocked_transcript_review'
    | 'failed';
export type NeutralEvaluationVisibility = 'private' | 'public' | 'retracted';
export type NeutralEvaluationReviewStatus = 'unreviewed' | 'reviewed' | 'flagged';
export type NeutralEvaluationAppealStatus = 'none' | 'open' | 'resolved';
export type NeutralEvaluationConfidence = 'low' | 'medium' | 'high';

export interface NeutralEvaluationProviderSource {
    refId: string;
    sourceType: EvidenceSourceType;
    sourceId: string;
    title: string;
    excerpt: string;
    visibility: EvidenceVisibility;
}

export interface NeutralEvaluationSelection {
    status: 'ready' | 'no_source' | 'blocked_transcript_review';
    blockReason?: 'transcript_review_required' | 'source_not_found' | 'empty_source';
    circleId: number;
    subjectType: NeutralEvaluationSubjectType;
    subjectId: string;
    authorUserId: number | null;
    evidenceRefs: EvidenceRef[];
    providerSources: NeutralEvaluationProviderSource[];
    sourceDigest: string;
    requiresPrivatePlaintext: boolean;
    subjectSnapshot: Record<string, unknown>;
}

export interface NeutralEvaluationContextPayload {
    kind: 'evaluation_neutral.v1';
    artifactId: string;
    circleId: number;
    subjectType: NeutralEvaluationSubjectType;
    subjectId: string;
    sourceDigest: string;
    locale: string;
}

export interface ParsedNeutralEvaluationOutput {
    summary: string;
    claims: Array<{
        id: string;
        text: string;
        evidenceRefIds: string[];
    }>;
    evidenceSummary: Array<{
        evidenceRefId: string;
        note: string;
    }>;
    assumptions: string[];
    evidenceGaps: string[];
    counterpoints: string[];
    verifiableNextSteps: string[];
    neutralWordingSuggestion: string;
    confidence: NeutralEvaluationConfidence;
    limitations: string[];
}
