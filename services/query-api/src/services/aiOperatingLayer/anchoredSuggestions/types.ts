export const ANCHORED_SUGGESTION_TASK_TYPE = 'anchored.interaction_suggestion_judge.v1';
export const ANCHORED_SUGGESTION_JOB_TYPE = 'anchored_interaction_suggestion_judge';
export const ANCHORED_SUGGESTION_SCHEMA_VERSION = 'v1';

export type AnchoredSuggestionKind = 'signup' | 'poll' | 'challenge' | 'none';
export type AnchoredSuggestionReasonCode =
    | 'needs_participants'
    | 'needs_decision'
    | 'needs_verification'
    | 'low_actionability'
    | 'unclear';

export interface AnchoredSuggestionCandidateSnapshot {
    envelopeId: string;
    messageId: number;
    createdAt: string | null;
    clientTimestamp: string | null;
    messageKind: 'plain' | 'root';
    semanticFacets: string[];
    authorAnnotationKinds: string[];
    focusScore: number | null;
    relevanceScore: number | null;
    focusLabel: 'focused' | 'contextual' | 'off_topic' | null;
    usefulCount: number;
    replyCount: number;
    actionSignals: string[];
    payloadHash: string;
}

export interface AnchoredSuggestionContextPayload {
    kind: 'anchored_interaction_suggestions.v1';
    circleId: number;
    locale: 'en' | 'zh' | 'fr' | 'es';
    candidateEnvelopeIds: string[];
    candidates: AnchoredSuggestionCandidateSnapshot[];
}

export interface AnchoredSuggestionDecision {
    envelopeId: string;
    shouldSuggest: boolean;
    suggestedType: AnchoredSuggestionKind;
    importanceScore: number;
    actionabilityScore: number;
    discussionAdvancementScore: number;
    confidence: number;
    reasonCode: AnchoredSuggestionReasonCode;
    shortReason: string;
}

export interface AnchoredSuggestionJobResult extends Record<string, unknown> {
    taskType: typeof ANCHORED_SUGGESTION_TASK_TYPE;
    taskCatalogVersion: string;
    schemaVersion: typeof ANCHORED_SUGGESTION_SCHEMA_VERSION;
    status: 'ready';
    circleId: number;
    sourceDigest: string;
    decisions: AnchoredSuggestionDecision[];
    fallbackUsed: boolean;
    failureCode: string | null;
    modelProfile: string | null;
    promptVersion: string | null;
}
