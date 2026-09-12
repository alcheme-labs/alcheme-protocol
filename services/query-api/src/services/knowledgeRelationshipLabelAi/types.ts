export const KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE =
    'knowledge.relationship_label_classify.v1';
export const KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE =
    'knowledge.relationship_label_coverage_audit.v1';

export const KNOWLEDGE_RELATIONSHIP_LABEL_SCHEMA_VERSION = 'v1';
export const KNOWLEDGE_RELATIONSHIP_LABEL_MIN_CONFIDENCE = 0.65;

export type KnowledgeRelationshipLabelAiJobKind =
    | 'knowledge_relationship_label_classify'
    | 'knowledge_relationship_label_coverage_audit';

export interface KnowledgeRelationshipLabelCatalogItem {
    key: string;
    displayName: string;
    description: string;
}

export interface KnowledgeRelationshipSnapshot {
    knowledgeId: string;
    title: string;
    description: string | null;
    contentHash: string | null;
    version: number | null;
    createdAt: string | null;
}

export interface KnowledgeRelationshipLabelClassificationPayload {
    kind: 'knowledge_relationship_label_classification.v1';
    circleId: number;
    knowledge: KnowledgeRelationshipSnapshot;
    sourceDraft: {
        sourceDraftId: string | null;
        postId: number | null;
        contentHash: string | null;
        draftVersion: number | null;
    };
    sourceKnowledge: KnowledgeRelationshipSnapshot[];
    acceptedIssues: Array<{
        issueId: string;
        title: string;
        status: string;
    }>;
    evidenceSummary: {
        sourceDigest: string | null;
        sourceKnowledgeCount: number;
        sourceDraftBound: boolean;
    };
    activeLabelCatalog: KnowledgeRelationshipLabelCatalogItem[];
}

export interface KnowledgeRelationshipLabelDecision {
    labelKey: string;
    confidence: number;
    shortReason: string;
    sourceKnowledgeIds: string[];
    needsHumanReview: boolean;
    proposedNewLabel?: {
        key: string;
        displayName: string;
        description: string;
        useCases: string[];
    } | null;
}

export type KnowledgeRelationshipCoverageRecommendationAction =
    | 'needs_new_label'
    | 'merge'
    | 'rename'
    | 'retire'
    | 'no_change';

export interface KnowledgeRelationshipCoverageAuditPayload {
    kind: 'knowledge_relationship_label_coverage_audit.v1';
    scope: {
        type: 'system' | 'circle';
        circleId: number | null;
    };
    activeLabelCatalog: KnowledgeRelationshipLabelCatalogItem[];
    assignmentStats: Array<{
        labelKey: string;
        assignmentCount: number;
    }>;
    recentAssignmentSamples: Array<{
        knowledgeId: string;
        labelKey: string;
        assignedBy: string;
        confidence: number | null;
    }>;
}

export interface KnowledgeRelationshipCoverageRecommendation {
    action: KnowledgeRelationshipCoverageRecommendationAction;
    labelKey?: string | null;
    proposedLabel?: {
        key: string;
        displayName: string;
        description: string;
        useCases: string[];
    } | null;
    reason: string;
    confidence: number;
}

export interface KnowledgeRelationshipCoverageAuditOutput {
    recommendations: KnowledgeRelationshipCoverageRecommendation[];
    coverageSummary: string;
    needsOperatorReview: boolean;
}
