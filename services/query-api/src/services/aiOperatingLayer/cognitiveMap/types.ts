export const CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE = 'circle.cognitive_map_explain.v1';
export const CIRCLE_COGNITIVE_MAP_SCHEMA_VERSION = 'v1';

export type CircleCognitiveMapLocale = 'en' | 'zh' | 'fr' | 'es';
export type CognitiveEvidenceState = 'stable' | 'partial' | 'missing';
export type CognitiveRouteRole = 'recommended_start' | 'standard_route' | 'related_route';
export type CognitiveRouteStatus = 'stable_conclusion' | 'pending_question' | 'needs_organization';
export type CognitiveRouteStage = 'discussion' | 'pending_question' | 'draft' | 'review' | 'crystal' | 'citation' | 'current_map';

export interface CognitiveSourceRef {
    kind: 'discussion' | 'draft' | 'crystal' | 'knowledge' | 'citation';
    id: string;
    label: string;
}

export interface CognitiveRouteSnapshot {
    id: string;
    role: CognitiveRouteRole;
    status: CognitiveRouteStatus;
    evidenceState: CognitiveEvidenceState;
    recommendationSource?: 'topology' | 'stable_output' | 'summary_snapshot' | 'deterministic_fallback';
    title: string;
    summary: string;
    reason: string;
    evidenceLabel: string;
    sourceLabel: string;
    nextActionLabel: string;
    stage?: CognitiveRouteStage;
    sourceRefs: CognitiveSourceRef[];
}

export interface CognitiveNodeSnapshot {
    id: string;
    kind: 'current_circle' | 'parent_circle' | 'child_circle' | 'auxiliary_circle' | 'route' | 'pending_question' | 'evidence_gap';
    title: string;
    relationToCurrent: 'current' | 'parent' | 'child' | 'auxiliary' | 'internal_route';
    accessState: 'readable' | 'locked' | 'requestable';
    recommendationSource?: 'topology' | 'stable_output' | 'summary_snapshot' | 'deterministic_fallback';
}

export interface CognitiveEvolutionSnapshot {
    id: string;
    stage: CognitiveRouteStage;
    title: string;
    summary: string;
    routeIds: string[];
    evidenceState: CognitiveEvidenceState;
    sourceRefs: CognitiveSourceRef[];
}

export interface CircleCognitiveMapContextPayload {
    kind: 'circle_cognitive_map_explain.v1';
    circleId: number;
    locale: CircleCognitiveMapLocale;
    mapStatus: {
        stableConclusionCount: number;
        pendingQuestionCount: number;
        evidenceGapCount: number;
        hasDraftBaseline: boolean;
    };
    visibleFocus: string;
    topology: {
        sourceVersion: string;
        nodes: CognitiveNodeSnapshot[];
    };
    routes: CognitiveRouteSnapshot[];
    evolution: CognitiveEvolutionSnapshot[];
    openQuestions: Array<{
        questionId: string;
        title: string;
        body: string;
    }>;
    sourceDigestMaterial: {
        summaryId: string;
        summaryVersion: number;
        summaryGeneratedAt: string;
        summarySourceDigest: string | null;
        topologySourceVersion: string;
    };
}

export interface CircleCognitiveMapAiOutput {
    coreQuestionSuggestion?: {
        text: string;
        sourceRouteIds: string[];
        sourceRefs: CognitiveSourceRef[];
        confidence: 'low' | 'medium' | 'high';
    };
    routeExplanations: Array<{
        routeId: string;
        shortTitle?: string;
        reason: string;
        nextAction?: string;
        sourceRefs: CognitiveSourceRef[];
    }>;
    pendingQuestionExplanations: Array<{
        questionId: string;
        summary: string;
        nextAction: string;
        linkedRouteIds: string[];
    }>;
    roleGuidance?: {
        newcomer?: string;
        participant?: string;
        reviewer?: string;
    };
    topologyExplanations: Array<{
        nodeId: string;
        reason: string;
        suggestedAction?: string;
        linkedRouteIds: string[];
    }>;
    evolutionNarration: Array<{
        stepId: string;
        narration: string;
        sourceRefs: CognitiveSourceRef[];
    }>;
    warnings: string[];
}

export interface CircleCognitiveMapJobResult extends Record<string, unknown> {
    taskType: typeof CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE;
    taskCatalogVersion: string;
    schemaVersion: typeof CIRCLE_COGNITIVE_MAP_SCHEMA_VERSION;
    status: 'ready' | 'fallback' | 'disabled';
    circleId: number;
    sourceDigest: string;
    output: CircleCognitiveMapAiOutput;
    fallbackUsed: boolean;
    failureCode: string | null;
    modelProfile: string | null;
    promptVersion: string | null;
    generatedAt: string;
}
