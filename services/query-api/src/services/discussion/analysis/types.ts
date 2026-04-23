export const DISCUSSION_ANALYSIS_STATUSES = ['pending', 'ready', 'stale', 'failed'] as const;
export type DiscussionAnalysisStatus = typeof DISCUSSION_ANALYSIS_STATUSES[number];

export const DISCUSSION_FOCUS_LABELS = ['focused', 'contextual', 'off_topic'] as const;
export type DiscussionFocusLabel = typeof DISCUSSION_FOCUS_LABELS[number];

export const DISCUSSION_SEMANTIC_FACETS = [
    'fact',
    'explanation',
    'emotion',
    'question',
    'problem',
    'criteria',
    'proposal',
    'summary',
] as const;
export type SemanticFacet = typeof DISCUSSION_SEMANTIC_FACETS[number];

export const AUTHOR_ANNOTATION_KINDS = ['fact', 'explanation', 'emotion'] as const;
export type AuthorAnnotationKind = typeof AUTHOR_ANNOTATION_KINDS[number];

export interface AuthorAnnotation {
    kind: AuthorAnnotationKind;
    source: 'author';
}

export interface DiscussionAnalysisResult {
    relevanceStatus: DiscussionAnalysisStatus;
    semanticScore: number | null;
    embeddingScore: number | null;
    qualityScore: number | null;
    spamScore: number | null;
    decisionConfidence: number | null;
    relevanceMethod: string | null;
    actualMode: string | null;
    analysisVersion: string | null;
    topicProfileVersion: string | null;
    focusScore: number | null;
    focusLabel: DiscussionFocusLabel | null;
    semanticFacets: SemanticFacet[];
    isFeatured: boolean;
    featureReason: string | null;
    analysisCompletedAt: Date | null;
    analysisErrorCode: string | null;
    analysisErrorMessage: string | null;
    authorAnnotations: AuthorAnnotation[];
}

export function buildPendingDiscussionAnalysisResult(
    input: {
        authorAnnotations?: AuthorAnnotation[];
        analysisVersion?: string | null;
        topicProfileVersion?: string | null;
    } = {},
): DiscussionAnalysisResult {
    return {
        relevanceStatus: 'pending',
        semanticScore: null,
        embeddingScore: null,
        qualityScore: null,
        spamScore: null,
        decisionConfidence: null,
        relevanceMethod: null,
        actualMode: null,
        analysisVersion: input.analysisVersion ?? null,
        topicProfileVersion: input.topicProfileVersion ?? null,
        focusScore: null,
        focusLabel: null,
        semanticFacets: [],
        isFeatured: false,
        featureReason: null,
        analysisCompletedAt: null,
        analysisErrorCode: null,
        analysisErrorMessage: null,
        authorAnnotations: Array.isArray(input.authorAnnotations) ? [...input.authorAnnotations] : [],
    };
}
