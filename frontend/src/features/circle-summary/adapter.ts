import type { CrystalOutputViewModel } from '../crystal-output/adapter';

export type FrozenDraftSourceKind =
    | 'accepted_candidate_v1_seed'
    | 'review_bound_snapshot'
    | null;

export interface FrozenDraftDocumentView {
    draftPostId: number;
    circleId: number | null;
    documentStatus:
        | 'drafting'
        | 'review'
        | 'crystallization_active'
        | 'crystallization_failed'
        | 'crystallized'
        | 'archived';
    currentSnapshotVersion: number;
}

export interface FrozenDraftVersionSnapshotView {
    draftVersion: number;
    sourceKind: FrozenDraftSourceKind;
    createdAt: string | null;
    seedDraftAnchorId: string | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    contentHash: string | null;
}

export interface FrozenDraftWorkingCopyView {
    draftPostId: number;
    basedOnSnapshotVersion: number;
    workingCopyHash: string;
    status: 'active';
    updatedAt: string;
}

export interface FrozenSummaryDraftConsumption {
    document: FrozenDraftDocumentView;
    stableSnapshot: FrozenDraftVersionSnapshotView;
    workingCopy: FrozenDraftWorkingCopyView;
}

export type CircleSummaryGeneratedBy =
    | 'system_projection'
    | 'system_llm'
    | 'user_requested';

export interface CircleSummaryGenerationMetadata {
    providerMode: string;
    model: string;
    promptAsset: string;
    promptVersion: string;
    sourceDigest: string;
    locale?: string;
}

export interface CircleSummarySnapshot {
    summaryId: string;
    circleId: number;
    version: number;
    issueMap: CircleSummaryIssueMapCard[];
    conceptGraph: Record<string, unknown>;
    viewpointBranches: Array<Record<string, unknown>>;
    factExplanationEmotionBreakdown: Record<string, unknown>;
    emotionConflictContext: Record<string, unknown>;
    sedimentationTimeline: CircleSummaryTimelineItem[];
    openQuestions: CircleSummaryOpenQuestion[];
    generatedAt: string;
    generatedBy: CircleSummaryGeneratedBy;
    generationMetadata: CircleSummaryGenerationMetadata | null;
}

export type CircleSummaryTopologyAccessState =
    | 'readable'
    | 'locked'
    | 'requestable'
    | 'hidden';

export interface CircleSummaryTopologyItem {
    circleId: number;
    safeTitle?: string;
    kind: 'main' | 'auxiliary';
    level: number;
    parentCircleId: number | null;
    accessState: CircleSummaryTopologyAccessState;
    unavailableReason?: string;
    activityScore: number;
    stableOutputCount: number;
}

export interface CircleSummaryTopologyPayload {
    current: CircleSummaryTopologyItem;
    parent: CircleSummaryTopologyItem | null;
    children: CircleSummaryTopologyItem[];
    auxiliarySiblings: CircleSummaryTopologyItem[];
    sourceVersion: string;
}

export interface CircleSummarySnapshotDiagnostics {
    version: number;
    generatedAt: string;
    generatedBy: CircleSummaryGeneratedBy;
    generationMetadata: CircleSummaryGenerationMetadata | null;
}

export interface CircleSummaryResolvedPresentation {
    source: 'snapshot' | 'pending_snapshot';
    summaryMap: CircleSummaryMapViewModel | null;
    diagnostics: CircleSummarySnapshotDiagnostics | null;
}

export interface DraftReferenceLinkConsumptionField {
    field:
        | 'referenceId'
        | 'draftPostId'
        | 'draftVersion'
        | 'sourceBlockId'
        | 'crystalName'
        | 'crystalBlockAnchor'
        | 'status';
    reason: string;
}

export interface DraftReferenceLinkConsumptionNeeds {
    publicReadiness: 'public_read_exit_live';
    note: string;
    fields: DraftReferenceLinkConsumptionField[];
}

export type SummaryDegradationKey =
    | 'selected frozen draft lifecycle input'
    | 'snapshot-backed output evidence'
    | 'stable output to draft binding';

export interface SummaryDependencyViewModel {
    hasSelectedDraft: boolean;
    missingTeam03Inputs: SummaryDegradationKey[];
}

export interface CircleSummarySituationItem {
    label: string;
    value: string;
    description: string;
    tone: 'warm' | 'neutral' | 'muted';
}

export interface CircleSummaryIssueMapCard {
    title: string;
    body: string;
    emphasis: 'primary' | 'secondary' | 'muted';
}

export interface CircleSummaryBranchCard {
    knowledgeId: string;
    title: string;
    routeLabel: string;
    routeHint: string;
    statusLabel: string;
    bindingLabel: string;
    evidenceLabel: string;
    versionLabel: string;
    evidenceSummary: string;
    citationSummary: string;
    createdAtLabel: string;
    degradationLabels: string[];
}

export interface CircleSummaryCoverageCard {
    label: string;
    value: string;
    description: string;
}

export interface CircleSummaryTimelineItem {
    key: string;
    title: string;
    summary: string;
    timeLabel: string;
}

export interface CircleSummaryOpenQuestion {
    title: string;
    body: string;
}

export interface CircleSummaryMapViewModel {
    hero: {
        eyebrow: string;
        title: string;
        lead: string;
    };
    defaultFocusBranchId: string | null;
    situation: CircleSummarySituationItem[];
    issueMap: CircleSummaryIssueMapCard[];
    branches: CircleSummaryBranchCard[];
    coverage: CircleSummaryCoverageCard[];
    timeline: CircleSummaryTimelineItem[];
    openQuestions: CircleSummaryOpenQuestion[];
}

export type CognitiveRouteRole = 'recommended_start' | 'standard_route' | 'related_route';
export type CognitiveRouteStatus = 'stable_conclusion' | 'pending_question' | 'needs_organization';
export type CognitiveEvidenceState = 'stable' | 'partial' | 'missing';
export type CognitiveRouteStage = 'discussion' | 'pending_question' | 'draft' | 'review' | 'crystal' | 'citation' | 'current_map';
export type CognitiveMapNodeKind = 'current_circle' | 'parent_circle' | 'child_circle' | 'auxiliary_circle' | 'route' | 'pending_question' | 'evidence_gap';
export type CognitiveMapEdgeKind = 'hierarchy' | 'auxiliary' | 'recommended_route' | 'related_route' | 'evidence_gap';
export type CognitiveMapNodeRelation = 'current' | 'parent' | 'child' | 'auxiliary' | 'internal_route';
export type CognitiveMapRenderableAccessState = Exclude<CircleSummaryTopologyAccessState, 'hidden'>;
export type CognitiveMapRecommendationSource =
    | 'topology'
    | 'stable_output'
    | 'summary_snapshot'
    | 'deterministic_fallback';
export type CircleCognitiveMapLocale = 'en' | 'zh' | 'fr' | 'es';
export type CircleCognitiveMapViewerIntent = 'newcomer' | 'participant' | 'reviewer';
export type CognitiveMapActionKind =
    | 'view_current_circle'
    | 'open_parent_summary'
    | 'open_child_circle'
    | 'open_auxiliary_circle'
    | 'request_circle_access'
    | 'expand_collapsed_group'
    | 'open_full_circle_map'
    | 'open_route_detail'
    | 'view_evidence'
    | 'open_discussion'
    | 'open_draft'
    | 'ask_ai'
    | 'none';

export type CognitiveMapSelectedContext =
    | { kind: 'node'; nodeId: string; recommendationSource?: CognitiveMapRecommendationSource }
    | { kind: 'route'; routeId: string; recommendationSource?: CognitiveMapRecommendationSource }
    | { kind: 'question'; questionId: string }
    | { kind: 'step'; stepId: string };

export type CognitiveMapActionTarget =
    | { kind: 'circle'; circleId: number }
    | { kind: 'circle_access_request'; circleId: number }
    | { kind: 'collapsed_group'; groupId: string }
    | { kind: 'circle_map'; circleId: number; mode: 'expanded_graph' }
    | { kind: 'route'; routeId: string }
    | { kind: 'discussion'; threadId: string; routeId?: string }
    | { kind: 'draft'; draftId: string; routeId?: string }
    | { kind: 'knowledge'; knowledgeId: string; routeId?: string }
    | { kind: 'ai_explanation'; selectedContext: CognitiveMapSelectedContext }
    | { kind: 'none' };

export interface CognitiveMapAction {
    kind: CognitiveMapActionKind;
    label: string;
    target: CognitiveMapActionTarget;
    enabled: boolean;
    href?: string;
    disabledReason?: string;
}

export interface CognitiveMapNodeView {
    id: string;
    kind: CognitiveMapNodeKind;
    title: string;
    label: string;
    relationToCurrent: CognitiveMapNodeRelation;
    circleId?: number;
    routeId?: string;
    level?: number;
    accessState: CognitiveMapRenderableAccessState;
    statusLabel?: string;
    recommendationSource?: CognitiveMapRecommendationSource;
    primaryAction: CognitiveMapAction;
    secondaryActions: CognitiveMapAction[];
}

export interface CognitiveMapEdgeView {
    id: string;
    kind: CognitiveMapEdgeKind;
    fromNodeId: string;
    toNodeId: string;
    evidenceState?: CognitiveEvidenceState;
}

export type CognitiveMapCollapsedGroupKind = 'parent_path' | 'children' | 'auxiliary' | 'routes' | 'pending_questions';

export interface CognitiveMapCollapsedGroup {
    id: string;
    kind: CognitiveMapCollapsedGroupKind;
    label: string;
    count: number;
    reason: string;
    action: CognitiveMapAction;
}

export interface CircleTopologyContext {
    currentCircleId: number;
    displayMode: 'single_circle' | 'three_hop' | 'expanded_graph';
    nodes: CognitiveMapNodeView[];
    edges: CognitiveMapEdgeView[];
    collapsedGroups: CognitiveMapCollapsedGroup[];
}

export interface CognitiveSourceRef {
    kind: 'discussion' | 'draft' | 'crystal' | 'knowledge' | 'citation';
    id: string;
    label: string;
}

export interface CognitiveRouteView {
    id: string;
    role: CognitiveRouteRole;
    status: CognitiveRouteStatus;
    evidenceState: CognitiveEvidenceState;
    recommendationSource?: CognitiveMapRecommendationSource;
    title: string;
    summary: string;
    reason: string;
    evidenceLabel: string;
    sourceLabel: string;
    nextActionLabel: string;
    stage?: CognitiveRouteStage;
    sourceRefs: CognitiveSourceRef[];
}

export type CognitiveEvolutionMotionIntent = 'appear' | 'highlight' | 'branch' | 'stabilize' | 'fade' | 'gap';

export interface CognitiveEvolutionStep {
    id: string;
    stage: CognitiveRouteStage;
    title: string;
    summary: string;
    routeIds: string[];
    focusNodeId?: string;
    highlightNodeIds: string[];
    highlightEdgeIds: string[];
    evidenceState: CognitiveEvidenceState;
    sourceRefs: CognitiveSourceRef[];
    motion: {
        intent: CognitiveEvolutionMotionIntent;
        durationMs: number;
        pauseAfterMs?: number;
    };
    reducedMotionLabel: string;
}

export interface CircleCognitiveMapViewModel {
    circleId: number;
    title: string;
    visibleFocus: string;
    mapStatus: {
        stableConclusionCount: number;
        pendingQuestionCount: number;
        evidenceGapCount: number;
        hasDraftBaseline: boolean;
    };
    topology: CircleTopologyContext;
    routes: CognitiveRouteView[];
    evolution: CognitiveEvolutionStep[];
    openQuestions: CircleSummaryOpenQuestion[];
    sourceDigest: string;
    ai: {
        available: boolean;
        fallbackReason?: string;
    };
}

export interface CircleCognitiveMapAiInput {
    circleId: number;
    locale: CircleCognitiveMapLocale;
    mapStatus: CircleCognitiveMapViewModel['mapStatus'];
    visibleFocus: string;
    topology: CircleTopologyContext;
    routes: CognitiveRouteView[];
    evolution: CognitiveEvolutionStep[];
    openQuestions: CircleSummaryOpenQuestion[];
    sourceDigest: string;
    selectedContext?: CognitiveMapSelectedContext;
    viewerIntent?: CircleCognitiveMapViewerIntent;
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

export interface CircleCognitiveMapAiView {
    sourceDigest: string | null;
    output: CircleCognitiveMapAiOutput;
    generatedAt: string | null;
    modelProfile: string | null;
    promptVersion: string | null;
}

type CircleSummaryTranslate = (key: string, values?: Record<string, any>) => string;

export interface CircleSummaryCopy {
    formatShortDate: (value: string | null | undefined) => string;
    common: {
        timeTbd: string;
        unresolvedSource: string;
    };
    hero: {
        eyebrow: string;
        title: (circleId: number) => string;
        lead: string;
    };
    issueMap: {
        stableConclusionTitle: string;
        stableConclusionBodyWithOutput: (title: string) => string;
        stableConclusionBodyWithoutOutput: string;
        draftBaselineTitle: string;
        draftBaselineBodyWithDraft: (draftPostId: number, draftVersion: number) => string;
        draftBaselineBodyWithoutDraft: string;
    };
    route: {
        primaryLabel: string;
        parallelLabel: (index: number) => string;
        primaryHint: string;
        parallelHint: string;
    };
    branch: {
        statusPrimary: string;
        statusParallel: (index: number) => string;
        bindingWithDraft: (draftPostId: number) => string;
        bindingMissing: string;
        evidenceSnapshot: string;
        evidenceSettlementFallback: string;
        evidenceUnknown: string;
        evidenceSummarySnapshot: string;
        evidenceSummarySettlementFallback: string;
        evidenceSummaryUnknown: string;
        citationSummary: (citationCount: number, outboundReferenceCount: number, inboundReferenceCount: number) => string;
        versionPending: string;
    };
    situation: {
        formedConclusionsLabel: string;
        formedConclusionsDescription: string;
        visibleEntriesLabel: string;
        visibleEntriesDescription: string;
        draftBaselineLabel: string;
        draftBaselinePending: string;
        draftBaselineDescription: string;
    };
    coverage: {
        snapshotLabel: string;
        snapshotDescription: string;
        settlementLabel: string;
        settlementDescription: string;
        unresolvedLabel: string;
        unresolvedDescription: string;
    };
    timeline: {
        outputSummarySnapshot: string;
        outputSummaryFallback: string;
        draftTitle: (draftVersion: number) => string;
        draftSummary: (draftPostId: number) => string;
    };
    questions: {
        noStableOutputTitle: string;
        noStableOutputBody: string;
        noDraftBaselineTitle: string;
        noDraftBaselineBody: string;
        missingSnapshotTitle: string;
        missingSnapshotBody: string;
        missingDraftBindingTitle: string;
        missingDraftBindingBody: string;
    };
    generatedBy: Record<CircleSummaryGeneratedBy, string>;
    providerMode: {
        builtin: string;
        projection: string;
        rule: string;
        fallback: string;
    };
    reference: {
        note: string;
        fields: Record<DraftReferenceLinkConsumptionField['field'], string>;
    };
    degradation: Record<SummaryDegradationKey, string>;
}

function makeShortDateFormatter(locale: string, fallback: string) {
    return (value: string | null | undefined): string => {
        if (!value) return fallback;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return fallback;
        return new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
        }).format(parsed);
    };
}

const DEFAULT_CIRCLE_SUMMARY_COPY: CircleSummaryCopy = {
    formatShortDate: makeShortDateFormatter('en', 'Date pending'),
    common: {
        timeTbd: 'Date pending',
        unresolvedSource: 'Source still unresolved',
    },
    hero: {
        eyebrow: 'Cognitive map',
        title: (circleId) => `Circle ${circleId} knowledge map`,
        lead: 'Start with where the topic is converging, which branches have already settled, and what still needs evidence.',
    },
    issueMap: {
        stableConclusionTitle: 'Start with the conclusion that has stabilized',
        stableConclusionBodyWithOutput: (title) => `The clearest settled thread right now is "${title}", so that is the best place to enter this circle's map.`,
        stableConclusionBodyWithoutOutput: 'There is no stable settled output yet, so this page first helps you see what is converging and what is still taking shape.',
        draftBaselineTitle: 'Then trace it back to the draft baseline',
        draftBaselineBodyWithDraft: (draftPostId, draftVersion) => `You can now go back to draft #${draftPostId} and its stable v${draftVersion} snapshot to understand how this settlement formed.`,
        draftBaselineBodyWithoutDraft: 'There is no single stable draft baseline yet, so enter from the settled outcomes instead of pretending the draft truth is settled.',
    },
    route: {
        primaryLabel: 'Recommended start',
        parallelLabel: (index) => `Parallel branch ${index}`,
        primaryHint: 'If this is your first time in the circle, start here.',
        parallelHint: 'Use this branch when you want to compare a different interpretation.',
    },
    branch: {
        statusPrimary: 'Evidence state',
        statusParallel: (index) => `Parallel branch ${index}`,
        bindingWithDraft: (draftPostId) => `Bound back to draft #${draftPostId}`,
        bindingMissing: 'No stable source draft yet',
        evidenceSnapshot: 'Snapshot-backed',
        evidenceSettlementFallback: 'Settlement replay',
        evidenceUnknown: 'Source pending',
        evidenceSummarySnapshot: 'This branch already has stable snapshot evidence and can act as a trustworthy summary entry point.',
        evidenceSummarySettlementFallback: 'This branch has clearly settled, but its source chain is still replay-level evidence.',
        evidenceSummaryUnknown: 'This branch is visible, but the snapshot-level source evidence is still incomplete.',
        citationSummary: (citationCount, outboundReferenceCount, inboundReferenceCount) => `Cited ${citationCount} times · preview refs ${outboundReferenceCount} / cited by ${inboundReferenceCount}`,
        versionPending: 'Version pending',
    },
    situation: {
        formedConclusionsLabel: 'Settled conclusions',
        formedConclusionsDescription: 'Start with what has already stabilized.',
        visibleEntriesLabel: 'Visible entry points',
        visibleEntriesDescription: 'This counts the routes you can enter now, not the full branch graph.',
        draftBaselineLabel: 'Draft baseline',
        draftBaselinePending: 'Pending',
        draftBaselineDescription: 'Once a single draft is resolved, you can trace how the line actually grew.',
    },
    coverage: {
        snapshotLabel: 'Snapshot-backed',
        snapshotDescription: 'Settled outputs that already point back to stable snapshot evidence.',
        settlementLabel: 'Settlement replay',
        settlementDescription: 'Outputs are clearly settled, but the full snapshot chain is still incomplete.',
        unresolvedLabel: 'Source pending',
        unresolvedDescription: 'The result is visible, but its source evidence still needs to be grounded.',
    },
    timeline: {
        outputSummarySnapshot: 'Settled into a knowledge output and can be traced back to stable snapshot evidence.',
        outputSummaryFallback: 'Settled into a knowledge output, but the source chain still needs more evidence.',
        draftTitle: (draftVersion) => `Stable draft baseline v${draftVersion}`,
        draftSummary: (draftPostId) => `Draft #${draftPostId} currently provides the body baseline for this knowledge map.`,
    },
    questions: {
        noStableOutputTitle: 'The first stable output has not appeared yet',
        noStableOutputBody: 'Right now it is more honest to keep adding facts, explanations, and disagreements than to pretend there is already a clear conclusion.',
        noDraftBaselineTitle: 'There is still no single draft baseline',
        noDraftBaselineBody: 'The page still cannot reliably anchor everything back to one draft version, so you should enter from the settled outputs first.',
        missingSnapshotTitle: 'Some settled outputs still lack stable snapshots',
        missingSnapshotBody: 'These results are already visible, but their traceable snapshot evidence is still incomplete.',
        missingDraftBindingTitle: 'Some outputs still do not bind back to a source draft',
        missingDraftBindingBody: 'They are clearly settled, but not yet stably anchored back to a draft entry point.',
    },
    generatedBy: {
        system_llm: 'System LLM',
        user_requested: 'Manual request',
        system_projection: 'System projection',
    },
    providerMode: {
        builtin: 'Builtin LLM',
        projection: 'System projection',
        rule: 'Rule summary',
        fallback: 'Source pending',
    },
    reference: {
        note: 'The reference page consumes these stable fields through the dedicated DraftReferenceLink public-read surface rather than a temporary Team 00 window.',
        fields: {
            referenceId: 'Reference ID',
            draftPostId: 'Source draft',
            draftVersion: 'Draft version',
            sourceBlockId: 'Source block',
            crystalName: 'Crystal name',
            crystalBlockAnchor: 'Crystal segment',
            status: 'Parse status',
        },
    },
    degradation: {
        'selected frozen draft lifecycle input': 'No single draft baseline has been resolved yet',
        'snapshot-backed output evidence': 'This conclusion still lacks stable snapshot evidence',
        'stable output to draft binding': 'This conclusion still lacks a stable draft binding',
    },
};

export function createCircleSummaryCopy(
    t: CircleSummaryTranslate,
    locale: string,
): CircleSummaryCopy {
    const timeTbd = t('common.timeTbd');
    return {
        formatShortDate: makeShortDateFormatter(locale, timeTbd),
        common: {
            timeTbd,
            unresolvedSource: t('common.unresolvedSource'),
        },
        hero: {
            eyebrow: t('hero.eyebrow'),
            title: (circleId) => t('hero.title', {circleId}),
            lead: t('hero.lead'),
        },
        issueMap: {
            stableConclusionTitle: t('issueMap.stableConclusionTitle'),
            stableConclusionBodyWithOutput: (title) => t('issueMap.stableConclusionBodyWithOutput', {title}),
            stableConclusionBodyWithoutOutput: t('issueMap.stableConclusionBodyWithoutOutput'),
            draftBaselineTitle: t('issueMap.draftBaselineTitle'),
            draftBaselineBodyWithDraft: (draftPostId, draftVersion) => t('issueMap.draftBaselineBodyWithDraft', {draftPostId, draftVersion}),
            draftBaselineBodyWithoutDraft: t('issueMap.draftBaselineBodyWithoutDraft'),
        },
        route: {
            primaryLabel: t('route.primaryLabel'),
            parallelLabel: (index) => t('route.parallelLabel', {index}),
            primaryHint: t('route.primaryHint'),
            parallelHint: t('route.parallelHint'),
        },
        branch: {
            statusPrimary: t('branch.statusPrimary'),
            statusParallel: (index) => t('branch.statusParallel', {index}),
            bindingWithDraft: (draftPostId) => t('branch.bindingWithDraft', {draftPostId}),
            bindingMissing: t('branch.bindingMissing'),
            evidenceSnapshot: t('branch.evidenceSnapshot'),
            evidenceSettlementFallback: t('branch.evidenceSettlementFallback'),
            evidenceUnknown: t('branch.evidenceUnknown'),
            evidenceSummarySnapshot: t('branch.evidenceSummarySnapshot'),
            evidenceSummarySettlementFallback: t('branch.evidenceSummarySettlementFallback'),
            evidenceSummaryUnknown: t('branch.evidenceSummaryUnknown'),
            citationSummary: (citationCount, outboundReferenceCount, inboundReferenceCount) => t('branch.citationSummary', {
                citationCount,
                outboundReferenceCount,
                inboundReferenceCount,
            }),
            versionPending: t('branch.versionPending'),
        },
        situation: {
            formedConclusionsLabel: t('situation.formedConclusionsLabel'),
            formedConclusionsDescription: t('situation.formedConclusionsDescription'),
            visibleEntriesLabel: t('situation.visibleEntriesLabel'),
            visibleEntriesDescription: t('situation.visibleEntriesDescription'),
            draftBaselineLabel: t('situation.draftBaselineLabel'),
            draftBaselinePending: t('situation.draftBaselinePending'),
            draftBaselineDescription: t('situation.draftBaselineDescription'),
        },
        coverage: {
            snapshotLabel: t('coverage.snapshotLabel'),
            snapshotDescription: t('coverage.snapshotDescription'),
            settlementLabel: t('coverage.settlementLabel'),
            settlementDescription: t('coverage.settlementDescription'),
            unresolvedLabel: t('coverage.unresolvedLabel'),
            unresolvedDescription: t('coverage.unresolvedDescription'),
        },
        timeline: {
            outputSummarySnapshot: t('timeline.outputSummarySnapshot'),
            outputSummaryFallback: t('timeline.outputSummaryFallback'),
            draftTitle: (draftVersion) => t('timeline.draftTitle', {draftVersion}),
            draftSummary: (draftPostId) => t('timeline.draftSummary', {draftPostId}),
        },
        questions: {
            noStableOutputTitle: t('questions.noStableOutputTitle'),
            noStableOutputBody: t('questions.noStableOutputBody'),
            noDraftBaselineTitle: t('questions.noDraftBaselineTitle'),
            noDraftBaselineBody: t('questions.noDraftBaselineBody'),
            missingSnapshotTitle: t('questions.missingSnapshotTitle'),
            missingSnapshotBody: t('questions.missingSnapshotBody'),
            missingDraftBindingTitle: t('questions.missingDraftBindingTitle'),
            missingDraftBindingBody: t('questions.missingDraftBindingBody'),
        },
        generatedBy: {
            system_llm: t('generatedBy.systemLlm'),
            user_requested: t('generatedBy.userRequested'),
            system_projection: t('generatedBy.systemProjection'),
        },
        providerMode: {
            builtin: t('providerMode.builtin'),
            projection: t('providerMode.projection'),
            rule: t('providerMode.rule'),
            fallback: t('providerMode.fallback'),
        },
        reference: {
            note: t('reference.note'),
            fields: {
                referenceId: t('reference.fields.referenceId'),
                draftPostId: t('reference.fields.draftPostId'),
                draftVersion: t('reference.fields.draftVersion'),
                sourceBlockId: t('reference.fields.sourceBlockId'),
                crystalName: t('reference.fields.crystalName'),
                crystalBlockAnchor: t('reference.fields.crystalBlockAnchor'),
                status: t('reference.fields.status'),
            },
        },
        degradation: {
            'selected frozen draft lifecycle input': t('degradation.selectedDraft'),
            'snapshot-backed output evidence': t('degradation.snapshotEvidence'),
            'stable output to draft binding': t('degradation.draftBinding'),
        },
    };
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : null;
}

function asGeneratedBy(value: unknown): CircleSummaryGeneratedBy {
    if (value === 'system_projection' || value === 'system_llm' || value === 'user_requested') {
        return value;
    }
    throw new Error('invalid_generated_by');
}

function normalizeGenerationMetadata(value: unknown): CircleSummaryGenerationMetadata | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const root = value as Record<string, unknown>;
    const providerMode = asNullableString(root.providerMode);
    const model = asNullableString(root.model);
    const promptAsset = asNullableString(root.promptAsset);
    const promptVersion = asNullableString(root.promptVersion);
    const sourceDigest = asNullableString(root.sourceDigest);
    const locale = asNullableString(root.locale);

    if (!providerMode || !model || !promptAsset || !promptVersion || !sourceDigest) {
        return null;
    }

    return {
        providerMode,
        model,
        promptAsset,
        promptVersion,
        sourceDigest,
        ...(locale ? {locale} : {}),
    };
}

function normalizeIssueMapCard(value: unknown): CircleSummaryIssueMapCard {
    const root = ensureObject(value);
    return {
        title: String(root.title || ''),
        body: String(root.body || ''),
        emphasis: (asNullableString(root.emphasis) || 'muted') as CircleSummaryIssueMapCard['emphasis'],
    };
}

function normalizeTimelineItem(value: unknown): CircleSummaryTimelineItem {
    const root = ensureObject(value);
    return {
        key: String(root.key || ''),
        title: String(root.title || ''),
        summary: String(root.summary || ''),
        timeLabel: asNullableString(root.timeLabel) || DEFAULT_CIRCLE_SUMMARY_COPY.common.timeTbd,
    };
}

function normalizeOpenQuestion(value: unknown): CircleSummaryOpenQuestion {
    const root = ensureObject(value);
    return {
        title: String(root.title || ''),
        body: String(root.body || ''),
    };
}

function normalizeTopologyAccessState(value: unknown): CircleSummaryTopologyAccessState {
    if (value === 'readable' || value === 'locked' || value === 'requestable' || value === 'hidden') {
        return value;
    }
    return 'hidden';
}

function normalizeTopologyKind(value: unknown): CircleSummaryTopologyItem['kind'] {
    return value === 'auxiliary' ? 'auxiliary' : 'main';
}

function normalizeTopologyItem(value: unknown): CircleSummaryTopologyItem {
    const root = ensureObject(value);
    const accessState = normalizeTopologyAccessState(root.accessState);
    const safeTitle = asNullableString(root.safeTitle);
    let normalizedAccessState = accessState;
    if (!safeTitle && accessState !== 'hidden') {
        normalizedAccessState = 'hidden';
    }
    return {
        circleId: asPositiveNumber(root.circleId),
        safeTitle: normalizedAccessState === 'hidden' ? undefined : safeTitle ?? undefined,
        kind: normalizeTopologyKind(root.kind),
        level: Math.max(0, Math.trunc(asNullableNumber(root.level) ?? 0)),
        parentCircleId: asNullableNumber(root.parentCircleId),
        accessState: normalizedAccessState,
        unavailableReason: asNullableString(root.unavailableReason) || undefined,
        activityScore: Math.max(0, Math.trunc(asNullableNumber(root.activityScore) ?? 0)),
        stableOutputCount: Math.max(0, Math.trunc(asNullableNumber(root.stableOutputCount) ?? 0)),
    };
}

function normalizeSnapshotBranchVersion(input: {
    branch: Record<string, unknown>;
    conceptGraph: Record<string, unknown>;
}): number | null {
    const directVersion = asNullableNumber(input.branch.version);
    if (directVersion !== null && directVersion > 0) {
        return directVersion;
    }

    const nodes = Array.isArray(input.conceptGraph.nodes)
        ? input.conceptGraph.nodes
        : [];
    const knowledgeId = asString(input.branch.knowledgeId);
    if (!knowledgeId) return null;

    for (const node of nodes) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
        const record = node as Record<string, unknown>;
        if (asString(record.id) !== knowledgeId) continue;
        const version = asNullableNumber(record.version);
        if (version !== null && version > 0) {
            return version;
        }
    }

    return null;
}

function countSnapshotBranchesByBinding(
    snapshot: CircleSummarySnapshot,
    kind: 'snapshot' | 'settlement_fallback' | 'unbound',
): number {
    return snapshot.viewpointBranches.filter((branch) => {
        const root = ensureObject(branch);
        const bindingKind = asNullableString(root.sourceBindingKind) || 'unbound';
        return bindingKind === kind;
    }).length;
}

function buildCircleSummaryMapViewModelFromSnapshot(input: {
    circleId: number;
    snapshot: CircleSummarySnapshot;
    draft: FrozenSummaryDraftConsumption | null;
    copy?: CircleSummaryCopy;
}): CircleSummaryMapViewModel {
    const copy = input.copy ?? DEFAULT_CIRCLE_SUMMARY_COPY;
    const branches = input.snapshot.viewpointBranches.map((branch, index) => {
        const root = ensureObject(branch);
        const sourceBindingKind = (asNullableString(root.sourceBindingKind) || 'unbound') as
            | 'snapshot'
            | 'settlement_fallback'
            | 'unbound';
        const sourceDraftPostId = asNullableNumber(root.sourceDraftPostId);
        const version = normalizeSnapshotBranchVersion({
            branch: root,
            conceptGraph: input.snapshot.conceptGraph,
        });
        const degradationLabels: string[] = [];
        if (sourceBindingKind !== 'snapshot') {
            degradationLabels.push(formatSummaryDegradationLabel('snapshot-backed output evidence', copy));
        }
        if (sourceDraftPostId === null) {
            degradationLabels.push(formatSummaryDegradationLabel('stable output to draft binding', copy));
        }

        return {
            knowledgeId: asString(root.knowledgeId) || `snapshot-branch-${index + 1}`,
            title: asString(root.title) || copy.route.parallelLabel(index + 1),
            routeLabel: asString(root.routeLabel) || (index === 0 ? copy.route.primaryLabel : copy.route.parallelLabel(index + 1)),
            routeHint: asString(root.routeHint) || (
                index === 0
                    ? copy.route.primaryHint
                    : copy.route.parallelHint
            ),
            statusLabel: index === 0 ? copy.branch.statusPrimary : copy.branch.statusParallel(index + 1),
            bindingLabel: sourceDraftPostId !== null
                ? copy.branch.bindingWithDraft(sourceDraftPostId)
                : copy.branch.bindingMissing,
            evidenceLabel: sourceBindingKind === 'snapshot'
                ? copy.branch.evidenceSnapshot
                : sourceBindingKind === 'settlement_fallback'
                    ? copy.branch.evidenceSettlementFallback
                    : copy.branch.evidenceUnknown,
            versionLabel: version !== null ? `v${version}` : copy.branch.versionPending,
            evidenceSummary: sourceBindingKind === 'snapshot'
                ? copy.branch.evidenceSummarySnapshot
                : sourceBindingKind === 'settlement_fallback'
                    ? copy.branch.evidenceSummarySettlementFallback
                    : copy.branch.evidenceSummaryUnknown,
            citationSummary: asString(root.citationSummary) || copy.branch.citationSummary(0, 0, 0),
            createdAtLabel: asString(root.createdAtLabel) || copy.common.timeTbd,
            degradationLabels,
        };
    });

    return {
        hero: {
            eyebrow: copy.hero.eyebrow,
            title: copy.hero.title(input.circleId),
            lead: copy.hero.lead,
        },
        defaultFocusBranchId: branches[0]?.knowledgeId ?? null,
        situation: [
            {
                label: copy.situation.formedConclusionsLabel,
                value: String(branches.length),
                description: copy.situation.formedConclusionsDescription,
                tone: branches.length > 0 ? 'warm' : 'muted',
            },
            {
                label: copy.situation.visibleEntriesLabel,
                value: String(branches.length),
                description: copy.situation.visibleEntriesDescription,
                tone: branches.length > 1 ? 'neutral' : 'muted',
            },
            {
                label: copy.situation.draftBaselineLabel,
                value: input.draft ? `v${input.draft.stableSnapshot.draftVersion}` : copy.situation.draftBaselinePending,
                description: copy.situation.draftBaselineDescription,
                tone: input.draft ? 'warm' : 'muted',
            },
        ],
        issueMap: input.snapshot.issueMap,
        branches,
        coverage: [
            {
                label: copy.coverage.snapshotLabel,
                value: String(countSnapshotBranchesByBinding(input.snapshot, 'snapshot')),
                description: copy.coverage.snapshotDescription,
            },
            {
                label: copy.coverage.settlementLabel,
                value: String(countSnapshotBranchesByBinding(input.snapshot, 'settlement_fallback')),
                description: copy.coverage.settlementDescription,
            },
            {
                label: copy.coverage.unresolvedLabel,
                value: String(countSnapshotBranchesByBinding(input.snapshot, 'unbound')),
                description: copy.coverage.unresolvedDescription,
            },
        ],
        timeline: input.snapshot.sedimentationTimeline,
        openQuestions: input.snapshot.openQuestions,
    };
}

interface StableOutputBindingEvidence {
    sourceBindingKind: CrystalOutputViewModel['sourceBindingKind'];
    sourceDraftPostId: number | null;
    sourceAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function asPositiveNumber(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('invalid_positive_number');
    }
    return parsed;
}

function asNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error('invalid_number');
    }
    return parsed;
}

function ensureObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid_object');
    }
    return value as Record<string, unknown>;
}

function formatShortDate(
    value: string | null | undefined,
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): string {
    return copy.formatShortDate(value);
}

function countOutputsByBinding(
    outputs: CrystalOutputViewModel[],
    kind: CrystalOutputViewModel['sourceBindingKind'],
): number {
    return outputs.filter((output) => output.sourceBindingKind === kind).length;
}

function uniqueDegradationKeys(outputs: CrystalOutputViewModel[]): SummaryDegradationKey[] {
    const result = new Set<SummaryDegradationKey>();
    for (const output of outputs) {
        for (const item of output.missingTeam03Inputs) {
            if (
                item === 'selected frozen draft lifecycle input'
                || item === 'snapshot-backed output evidence'
                || item === 'stable output to draft binding'
            ) {
                result.add(item);
            }
        }
    }
    return Array.from(result);
}

function buildIssueMapCards(input: {
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    copy?: CircleSummaryCopy;
}): CircleSummaryIssueMapCard[] {
    const copy = input.copy ?? DEFAULT_CIRCLE_SUMMARY_COPY;
    const primaryOutput = input.outputs[0] || null;

    return [
        {
            title: copy.issueMap.stableConclusionTitle,
            body: primaryOutput
                ? copy.issueMap.stableConclusionBodyWithOutput(primaryOutput.title)
                : copy.issueMap.stableConclusionBodyWithoutOutput,
            emphasis: 'primary',
        },
        {
            title: copy.issueMap.draftBaselineTitle,
            body: input.draft
                ? copy.issueMap.draftBaselineBodyWithDraft(input.draft.document.draftPostId, input.draft.stableSnapshot.draftVersion)
                : copy.issueMap.draftBaselineBodyWithoutDraft,
            emphasis: 'secondary',
        },
    ];
}

function buildBranchCards(
    outputs: CrystalOutputViewModel[],
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): CircleSummaryBranchCard[] {
    return outputs.map((output, index) => ({
        knowledgeId: output.knowledgeId,
        title: output.title,
        routeLabel: index === 0 ? copy.route.primaryLabel : copy.route.parallelLabel(index + 1),
        routeHint: index === 0
            ? copy.route.primaryHint
            : copy.route.parallelHint,
        statusLabel: index === 0 ? copy.branch.statusPrimary : copy.branch.statusParallel(index + 1),
        bindingLabel: output.sourceDraftPostId !== null
            ? copy.branch.bindingWithDraft(output.sourceDraftPostId)
            : copy.branch.bindingMissing,
        evidenceLabel: output.sourceBindingKind === 'snapshot'
            ? copy.branch.evidenceSnapshot
            : output.sourceBindingKind === 'settlement_fallback'
                ? copy.branch.evidenceSettlementFallback
                : copy.branch.evidenceUnknown,
        versionLabel: output.versionLabel,
        evidenceSummary: output.sourceBindingKind === 'snapshot'
            ? copy.branch.evidenceSummarySnapshot
            : output.sourceBindingKind === 'settlement_fallback'
                ? copy.branch.evidenceSummarySettlementFallback
                : copy.branch.evidenceSummaryUnknown,
        citationSummary: copy.branch.citationSummary(output.citationCount, output.outboundReferenceCount, output.inboundReferenceCount),
        createdAtLabel: formatShortDate(output.createdAt, copy),
        degradationLabels: output.missingTeam03Inputs.map((item) => formatSummaryDegradationLabel(item, copy)),
    }));
}

function buildCoverageCards(
    outputs: CrystalOutputViewModel[],
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): CircleSummaryCoverageCard[] {
    return [
        {
            label: copy.coverage.snapshotLabel,
            value: String(countOutputsByBinding(outputs, 'snapshot')),
            description: copy.coverage.snapshotDescription,
        },
        {
            label: copy.coverage.settlementLabel,
            value: String(countOutputsByBinding(outputs, 'settlement_fallback')),
            description: copy.coverage.settlementDescription,
        },
        {
            label: copy.coverage.unresolvedLabel,
            value: String(countOutputsByBinding(outputs, 'unlabeled')),
            description: copy.coverage.unresolvedDescription,
        },
    ];
}

function buildTimeline(input: {
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    copy?: CircleSummaryCopy;
}): CircleSummaryTimelineItem[] {
    const copy = input.copy ?? DEFAULT_CIRCLE_SUMMARY_COPY;
    const outputItems = [...input.outputs]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map((output) => ({
            key: output.knowledgeId,
            title: output.title,
            summary: output.sourceBindingKind === 'snapshot'
                ? copy.timeline.outputSummarySnapshot
                : copy.timeline.outputSummaryFallback,
            timeLabel: formatShortDate(output.createdAt, copy),
        }));

    if (!input.draft) {
        return outputItems;
    }

    return [
        {
            key: `draft-${input.draft.document.draftPostId}`,
            title: copy.timeline.draftTitle(input.draft.stableSnapshot.draftVersion),
            summary: copy.timeline.draftSummary(input.draft.document.draftPostId),
            timeLabel: formatShortDate(input.draft.stableSnapshot.createdAt, copy),
        },
        ...outputItems,
    ];
}

function buildOpenQuestions(input: {
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    copy?: CircleSummaryCopy;
}): CircleSummaryOpenQuestion[] {
    const copy = input.copy ?? DEFAULT_CIRCLE_SUMMARY_COPY;
    const questions: CircleSummaryOpenQuestion[] = [];

    if (input.outputs.length === 0) {
        questions.push({
            title: copy.questions.noStableOutputTitle,
            body: copy.questions.noStableOutputBody,
        });
    }

    if (!input.draft) {
        questions.push({
            title: copy.questions.noDraftBaselineTitle,
            body: copy.questions.noDraftBaselineBody,
        });
    }

    for (const key of uniqueDegradationKeys(input.outputs)) {
        if (key === 'snapshot-backed output evidence') {
            questions.push({
                title: copy.questions.missingSnapshotTitle,
                body: copy.questions.missingSnapshotBody,
            });
        }
        if (key === 'stable output to draft binding') {
            questions.push({
                title: copy.questions.missingDraftBindingTitle,
                body: copy.questions.missingDraftBindingBody,
            });
        }
    }

    return questions;
}

export function buildCircleSummaryMapViewModel(input: {
    circleId: number;
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    forkHint?: { thresholdLabel: string; knowledgeLineageLabel: string } | null;
    copy?: CircleSummaryCopy;
}): CircleSummaryMapViewModel {
    const copy = input.copy ?? DEFAULT_CIRCLE_SUMMARY_COPY;
    return {
        hero: {
            eyebrow: copy.hero.eyebrow,
            title: copy.hero.title(input.circleId),
            lead: copy.hero.lead,
        },
        defaultFocusBranchId: input.outputs[0]?.knowledgeId ?? null,
        situation: [
            {
                label: copy.situation.formedConclusionsLabel,
                value: String(input.outputs.length),
                description: copy.situation.formedConclusionsDescription,
                tone: input.outputs.length > 0 ? 'warm' : 'muted',
            },
            {
                label: copy.situation.visibleEntriesLabel,
                value: String(input.outputs.length),
                description: copy.situation.visibleEntriesDescription,
                tone: input.outputs.length > 1 ? 'neutral' : 'muted',
            },
            {
                label: copy.situation.draftBaselineLabel,
                value: input.draft ? `v${input.draft.stableSnapshot.draftVersion}` : copy.situation.draftBaselinePending,
                description: copy.situation.draftBaselineDescription,
                tone: input.draft ? 'warm' : 'muted',
            },
        ],
        issueMap: buildIssueMapCards({...input, copy}),
        branches: buildBranchCards(input.outputs, copy),
        coverage: buildCoverageCards(input.outputs, copy),
        timeline: buildTimeline({...input, copy}),
        openQuestions: buildOpenQuestions({...input, copy}),
    };
}

function makeCognitiveMapAction(input: {
    kind: CognitiveMapActionKind;
    label: string;
    target: CognitiveMapActionTarget;
    enabled?: boolean;
    href?: string;
    disabledReason?: string;
}): CognitiveMapAction {
    return {
        kind: input.kind,
        label: input.label,
        target: input.target,
        enabled: input.enabled ?? true,
        ...(input.href ? {href: input.href} : {}),
        ...(input.disabledReason ? {disabledReason: input.disabledReason} : {}),
    };
}

function makeNoopAction(label = 'No action available'): CognitiveMapAction {
    return makeCognitiveMapAction({
        kind: 'none',
        label,
        target: {kind: 'none'},
        enabled: false,
    });
}

function filterRenderableTopologyItems(
    items: CircleSummaryTopologyItem[],
): Array<CircleSummaryTopologyItem & { accessState: CognitiveMapRenderableAccessState }> {
    return items.filter((row): row is CircleSummaryTopologyItem & { accessState: CognitiveMapRenderableAccessState } =>
        row.accessState !== 'hidden',
    );
}

function fallbackCurrentTopologyItem(circleId: number): CircleSummaryTopologyItem & { accessState: CognitiveMapRenderableAccessState } {
    return {
        circleId,
        safeTitle: `Circle ${circleId}`,
        kind: 'main',
        level: 0,
        parentCircleId: null,
        accessState: 'readable',
        activityScore: 0,
        stableOutputCount: 0,
    };
}

function circleNodeLabel(relation: CognitiveMapNodeRelation): string {
    switch (relation) {
        case 'current':
            return 'Current circle';
        case 'parent':
            return 'Parent circle';
        case 'child':
            return 'Child circle';
        case 'auxiliary':
            return 'Auxiliary circle';
        default:
            return 'Circle';
    }
}

function circleNodeKind(relation: CognitiveMapNodeRelation): CognitiveMapNodeKind {
    switch (relation) {
        case 'current':
            return 'current_circle';
        case 'parent':
            return 'parent_circle';
        case 'child':
            return 'child_circle';
        case 'auxiliary':
            return 'auxiliary_circle';
        default:
            return 'route';
    }
}

function circleNodeAction(input: {
    item: CircleSummaryTopologyItem & { accessState: CognitiveMapRenderableAccessState };
    relation: CognitiveMapNodeRelation;
    currentCircleId: number;
}): CognitiveMapAction {
    if (input.item.accessState === 'requestable') {
        return makeCognitiveMapAction({
            kind: 'request_circle_access',
            label: 'Request access',
            target: {kind: 'circle_access_request', circleId: input.item.circleId},
            href: `/circles/${input.item.circleId}`,
        });
    }
    if (input.item.accessState === 'locked') {
        return makeCognitiveMapAction({
            kind: 'request_circle_access',
            label: 'Access locked',
            target: {kind: 'circle_access_request', circleId: input.item.circleId},
            enabled: false,
            disabledReason: input.item.unavailableReason || 'access_locked',
        });
    }

    if (input.relation === 'current') {
        return makeCognitiveMapAction({
            kind: 'view_current_circle',
            label: 'View circle',
            target: {kind: 'circle', circleId: input.item.circleId},
            href: `/circles/${input.item.circleId}`,
        });
    }
    if (input.relation === 'parent') {
        return makeCognitiveMapAction({
            kind: 'open_parent_summary',
            label: 'Open parent summary',
            target: {kind: 'circle', circleId: input.item.circleId},
            href: `/circles/${input.item.circleId}/summary?returnCircleId=${input.currentCircleId}`,
        });
    }
    if (input.relation === 'auxiliary') {
        return makeCognitiveMapAction({
            kind: 'open_auxiliary_circle',
            label: 'Open auxiliary circle',
            target: {kind: 'circle', circleId: input.item.circleId},
            href: `/circles/${input.item.circleId}`,
        });
    }
    return makeCognitiveMapAction({
        kind: 'open_child_circle',
        label: 'Open child circle',
        target: {kind: 'circle', circleId: input.item.circleId},
        href: `/circles/${input.item.circleId}`,
    });
}

function buildCircleNode(input: {
    item: CircleSummaryTopologyItem & { accessState: CognitiveMapRenderableAccessState };
    relation: CognitiveMapNodeRelation;
    currentCircleId: number;
}): CognitiveMapNodeView {
    const title = input.item.safeTitle || `Circle ${input.item.circleId}`;
    const primaryAction = circleNodeAction(input);
    return {
        id: `${input.relation}-circle-${input.item.circleId}`,
        kind: circleNodeKind(input.relation),
        title,
        label: circleNodeLabel(input.relation),
        relationToCurrent: input.relation,
        circleId: input.item.circleId,
        level: input.item.level,
        accessState: input.item.accessState,
        statusLabel: input.item.accessState === 'readable'
            ? `${input.item.stableOutputCount} stable outputs`
            : input.item.unavailableReason,
        recommendationSource: 'topology',
        primaryAction,
        secondaryActions: [
            makeCognitiveMapAction({
                kind: 'open_full_circle_map',
                label: 'Open full map',
                target: {kind: 'circle_map', circleId: input.currentCircleId, mode: 'expanded_graph'},
                href: `/circles/${input.currentCircleId}/summary?map=expanded`,
            }),
        ],
    };
}

function buildTopologyContext(input: {
    circleId: number;
    topology: CircleSummaryTopologyPayload | null;
}): CircleTopologyContext {
    const current = filterRenderableTopologyItems(input.topology ? [input.topology.current] : [])[0]
        ?? fallbackCurrentTopologyItem(input.circleId);
    const parent = input.topology?.parent
        ? filterRenderableTopologyItems([input.topology.parent])[0] ?? null
        : null;
    const children = filterRenderableTopologyItems(input.topology?.children ?? []);
    const auxiliarySiblings = filterRenderableTopologyItems(input.topology?.auxiliarySiblings ?? []);
    const shownChildren = children.slice(0, 3);
    const shownAuxiliary = auxiliarySiblings.slice(0, 2);

    const currentNode = buildCircleNode({
        item: current,
        relation: 'current',
        currentCircleId: input.circleId,
    });
    const nodes: CognitiveMapNodeView[] = [
        ...(parent ? [buildCircleNode({item: parent, relation: 'parent', currentCircleId: input.circleId})] : []),
        currentNode,
        ...shownChildren.map((item) => buildCircleNode({item, relation: 'child', currentCircleId: input.circleId})),
        ...shownAuxiliary.map((item) => buildCircleNode({item, relation: 'auxiliary', currentCircleId: input.circleId})),
    ];
    const edges: CognitiveMapEdgeView[] = [];

    if (parent) {
        edges.push({
            id: `hierarchy-${parent.circleId}-${current.circleId}`,
            kind: 'hierarchy',
            fromNodeId: `parent-circle-${parent.circleId}`,
            toNodeId: currentNode.id,
        });
    }
    for (const child of shownChildren) {
        edges.push({
            id: `hierarchy-${current.circleId}-${child.circleId}`,
            kind: 'hierarchy',
            fromNodeId: currentNode.id,
            toNodeId: `child-circle-${child.circleId}`,
        });
    }
    for (const auxiliary of shownAuxiliary) {
        edges.push({
            id: `auxiliary-${current.circleId}-${auxiliary.circleId}`,
            kind: 'auxiliary',
            fromNodeId: currentNode.id,
            toNodeId: `auxiliary-circle-${auxiliary.circleId}`,
        });
    }

    const collapsedGroups: CognitiveMapCollapsedGroup[] = [];
    if (children.length > shownChildren.length) {
        collapsedGroups.push({
            id: 'collapsed-children',
            kind: 'children',
            label: `${children.length - shownChildren.length} more child circles`,
            count: children.length - shownChildren.length,
            reason: 'Additional child circles are collapsed to keep the map readable.',
            action: makeCognitiveMapAction({
                kind: 'expand_collapsed_group',
                label: 'Expand child circles',
                target: {kind: 'collapsed_group', groupId: 'collapsed-children'},
            }),
        });
    }
    if (auxiliarySiblings.length > shownAuxiliary.length) {
        collapsedGroups.push({
            id: 'collapsed-auxiliary',
            kind: 'auxiliary',
            label: `${auxiliarySiblings.length - shownAuxiliary.length} more auxiliary circles`,
            count: auxiliarySiblings.length - shownAuxiliary.length,
            reason: 'Additional auxiliary circles are collapsed to keep the map readable.',
            action: makeCognitiveMapAction({
                kind: 'expand_collapsed_group',
                label: 'Expand auxiliary circles',
                target: {kind: 'collapsed_group', groupId: 'collapsed-auxiliary'},
            }),
        });
    }

    return {
        currentCircleId: input.circleId,
        displayMode: nodes.length <= 1 ? 'single_circle' : 'three_hop',
        nodes,
        edges,
        collapsedGroups,
    };
}

function evidenceStateForBinding(kind: CrystalOutputViewModel['sourceBindingKind'] | string): CognitiveEvidenceState {
    if (kind === 'snapshot') return 'stable';
    if (kind === 'settlement_fallback') return 'partial';
    return 'missing';
}

function evidenceLabelForState(state: CognitiveEvidenceState, copy: CircleSummaryCopy): string {
    if (state === 'stable') return copy.branch.evidenceSnapshot;
    if (state === 'partial') return copy.branch.evidenceSettlementFallback;
    return copy.branch.evidenceUnknown;
}

function buildRoutesFromOutputs(
    outputs: CrystalOutputViewModel[],
    copy: CircleSummaryCopy,
): CognitiveRouteView[] {
    return outputs.map((output, index) => {
        const evidenceState = evidenceStateForBinding(output.sourceBindingKind);
        const routeId = `snapshot-${output.knowledgeId}`;
        return {
            id: routeId,
            role: index === 0 ? 'recommended_start' : 'standard_route',
            status: 'stable_conclusion',
            evidenceState,
            recommendationSource: 'stable_output',
            title: output.title,
            summary: evidenceState === 'stable'
                ? copy.branch.evidenceSummarySnapshot
                : evidenceState === 'partial'
                    ? copy.branch.evidenceSummarySettlementFallback
                    : copy.branch.evidenceSummaryUnknown,
            reason: index === 0 ? copy.route.primaryHint : copy.route.parallelHint,
            evidenceLabel: evidenceLabelForState(evidenceState, copy),
            sourceLabel: output.sourceDraftPostId !== null
                ? copy.branch.bindingWithDraft(output.sourceDraftPostId)
                : copy.branch.bindingMissing,
            nextActionLabel: 'View evidence',
            stage: 'crystal',
            sourceRefs: [
                {
                    kind: 'knowledge',
                    id: output.knowledgeId,
                    label: output.title,
                },
                ...(output.sourceDraftPostId !== null
                    ? [{
                        kind: 'draft' as const,
                        id: String(output.sourceDraftPostId),
                        label: `Draft #${output.sourceDraftPostId}`,
                    }]
                    : []),
            ],
        };
    });
}

function buildRoutesFromSnapshot(
    snapshot: CircleSummarySnapshot | null,
    copy: CircleSummaryCopy,
): CognitiveRouteView[] {
    if (!snapshot) return [];
    return snapshot.viewpointBranches.map((branch, index) => {
        const root = ensureObject(branch);
        const knowledgeId = asString(root.knowledgeId) || `snapshot-route-${index + 1}`;
        const title = asString(root.title) || copy.route.parallelLabel(index + 1);
        const bindingKind = asString(root.sourceBindingKind) || 'unbound';
        const sourceDraftPostId = asNullableNumber(root.sourceDraftPostId);
        const evidenceState = evidenceStateForBinding(bindingKind);
        return {
            id: `snapshot-${knowledgeId}`,
            role: index === 0 ? 'recommended_start' : 'standard_route',
            status: evidenceState === 'missing' ? 'needs_organization' : 'stable_conclusion',
            evidenceState,
            recommendationSource: 'summary_snapshot',
            title,
            summary: asString(root.routeHint) || (
                evidenceState === 'stable'
                    ? copy.branch.evidenceSummarySnapshot
                    : evidenceState === 'partial'
                        ? copy.branch.evidenceSummarySettlementFallback
                        : copy.branch.evidenceSummaryUnknown
            ),
            reason: index === 0 ? copy.route.primaryHint : copy.route.parallelHint,
            evidenceLabel: evidenceLabelForState(evidenceState, copy),
            sourceLabel: sourceDraftPostId !== null
                ? copy.branch.bindingWithDraft(sourceDraftPostId)
                : copy.branch.bindingMissing,
            nextActionLabel: 'Open route detail',
            stage: 'current_map',
            sourceRefs: [
                {
                    kind: 'knowledge',
                    id: knowledgeId,
                    label: title,
                },
            ],
        };
    });
}

function buildPendingQuestionNodes(snapshot: CircleSummarySnapshot | null): CognitiveMapNodeView[] {
    if (!snapshot) return [];
    return snapshot.openQuestions.map((question, index) => {
        const nodeId = `pending-question-${index + 1}`;
        return {
            id: nodeId,
            kind: 'pending_question',
            title: question.title,
            label: 'Pending question',
            relationToCurrent: 'internal_route',
            accessState: 'readable',
            statusLabel: 'Needs more evidence',
            recommendationSource: 'summary_snapshot',
            primaryAction: makeCognitiveMapAction({
                kind: 'open_route_detail',
                label: 'Open question detail',
                target: {kind: 'route', routeId: nodeId},
                href: '#open-questions',
            }),
            secondaryActions: [],
        };
    });
}

function buildEvidenceGapNodes(routes: CognitiveRouteView[]): CognitiveMapNodeView[] {
    return routes
        .filter((route) => route.evidenceState === 'missing')
        .map((route) => {
            const nodeId = `evidence-gap-${route.id}`;
            return {
                id: nodeId,
                kind: 'evidence_gap',
                title: `Evidence gap: ${route.title}`,
                label: 'Evidence gap',
                relationToCurrent: 'internal_route',
                routeId: route.id,
                accessState: 'readable',
                statusLabel: route.evidenceLabel,
                recommendationSource: route.recommendationSource,
                primaryAction: makeCognitiveMapAction({
                    kind: 'open_route_detail',
                    label: 'Review gap',
                    target: {kind: 'route', routeId: route.id},
                    href: '#primary-routes',
                }),
                secondaryActions: [],
            };
        });
}

function buildRouteNodes(routes: CognitiveRouteView[]): CognitiveMapNodeView[] {
    return routes.slice(0, 4).map((route) => ({
        id: `route-${route.id}`,
        kind: 'route',
        title: route.title,
        label: route.role === 'recommended_start' ? 'Recommended start' : 'Route',
        relationToCurrent: 'internal_route',
        routeId: route.id,
        accessState: 'readable',
        statusLabel: route.evidenceLabel,
        recommendationSource: route.recommendationSource,
        primaryAction: makeCognitiveMapAction({
            kind: 'open_route_detail',
            label: 'Open route detail',
            target: {kind: 'route', routeId: route.id},
            href: '#primary-routes',
        }),
        secondaryActions: route.sourceRefs
            .filter((sourceRef) => sourceRef.kind === 'knowledge')
            .map((sourceRef) => makeCognitiveMapAction({
                kind: 'view_evidence',
                label: 'View evidence',
                target: {kind: 'knowledge', knowledgeId: sourceRef.id, routeId: route.id},
                href: `/knowledge/${sourceRef.id}`,
            })),
    }));
}

function connectInternalRouteNodes(input: {
    currentNodeId: string;
    routeNodes: CognitiveMapNodeView[];
    pendingQuestionNodes: CognitiveMapNodeView[];
    evidenceGapNodes: CognitiveMapNodeView[];
}): CognitiveMapEdgeView[] {
    return [
        ...input.routeNodes.map((node, index) => ({
            id: `route-edge-${node.id}`,
            kind: index === 0 ? 'recommended_route' as const : 'related_route' as const,
            fromNodeId: input.currentNodeId,
            toNodeId: node.id,
            evidenceState: node.statusLabel === 'Snapshot-backed' ? 'stable' as const : undefined,
        })),
        ...input.pendingQuestionNodes.map((node) => ({
            id: `pending-edge-${node.id}`,
            kind: 'related_route' as const,
            fromNodeId: input.currentNodeId,
            toNodeId: node.id,
            evidenceState: 'missing' as const,
        })),
        ...input.evidenceGapNodes.map((node) => ({
            id: `gap-edge-${node.id}`,
            kind: 'evidence_gap' as const,
            fromNodeId: node.routeId ? `route-${node.routeId}` : input.currentNodeId,
            toNodeId: node.id,
            evidenceState: 'missing' as const,
        })),
    ];
}

function buildCognitiveEvolution(input: {
    routes: CognitiveRouteView[];
    draft: FrozenSummaryDraftConsumption | null;
    pendingQuestionNodes: CognitiveMapNodeView[];
    copy: CircleSummaryCopy;
}): CognitiveEvolutionStep[] {
    const steps: CognitiveEvolutionStep[] = [];
    if (input.draft) {
        const draftTitle = input.copy.timeline.draftTitle(input.draft.stableSnapshot.draftVersion);
        const draftSummary = input.copy.timeline.draftSummary(input.draft.document.draftPostId);
        steps.push({
            id: `draft-${input.draft.document.draftPostId}`,
            stage: 'draft',
            title: draftTitle,
            summary: draftSummary,
            routeIds: [],
            highlightNodeIds: [],
            highlightEdgeIds: [],
            evidenceState: 'partial',
            sourceRefs: [{
                kind: 'draft',
                id: String(input.draft.document.draftPostId),
                label: `Draft #${input.draft.document.draftPostId}`,
            }],
            motion: {
                intent: 'appear',
                durationMs: 360,
                pauseAfterMs: 120,
            },
            reducedMotionLabel: draftSummary,
        });
    }
    for (const route of input.routes.slice(0, 4)) {
        steps.push({
            id: `route-step-${route.id}`,
            stage: route.stage ?? 'current_map',
            title: route.title,
            summary: route.summary,
            routeIds: [route.id],
            focusNodeId: `route-${route.id}`,
            highlightNodeIds: [`route-${route.id}`],
            highlightEdgeIds: [`route-edge-route-${route.id}`],
            evidenceState: route.evidenceState,
            sourceRefs: route.sourceRefs,
            motion: {
                intent: route.role === 'recommended_start' ? 'highlight' : 'branch',
                durationMs: 420,
                pauseAfterMs: 140,
            },
            reducedMotionLabel: route.summary,
        });
    }
    for (const node of input.pendingQuestionNodes.slice(0, 2)) {
        steps.push({
            id: `pending-step-${node.id}`,
            stage: 'pending_question',
            title: node.title,
            summary: input.copy.questions.noStableOutputBody,
            routeIds: [],
            focusNodeId: node.id,
            highlightNodeIds: [node.id],
            highlightEdgeIds: [`pending-edge-${node.id}`],
            evidenceState: 'missing',
            sourceRefs: [],
            motion: {
                intent: 'gap',
                durationMs: 300,
            },
            reducedMotionLabel: input.copy.questions.noStableOutputBody,
        });
    }
    if (steps.length === 0) {
        steps.push({
            id: 'current-map-step',
            stage: 'current_map',
            title: input.copy.hero.eyebrow,
            summary: input.copy.issueMap.stableConclusionBodyWithoutOutput,
            routeIds: [],
            focusNodeId: undefined,
            highlightNodeIds: [],
            highlightEdgeIds: [],
            evidenceState: 'missing',
            sourceRefs: [],
            motion: {
                intent: 'appear',
                durationMs: 280,
            },
            reducedMotionLabel: input.copy.issueMap.stableConclusionBodyWithoutOutput,
        });
    }
    return steps;
}

function buildStableSourceDigest(input: {
    snapshot: CircleSummarySnapshot | null;
    topology: CircleTopologyContext;
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    locale: string;
}): string {
    const snapshotKey = input.snapshot
        ? `${input.snapshot.summaryId}:${input.snapshot.version}:${input.snapshot.generatedAt}`
        : 'snapshot:null';
    const topologyKey = [
        input.topology.displayMode,
        ...input.topology.nodes
            .filter((node) => node.relationToCurrent !== 'internal_route')
            .map((node) => [
                node.id,
                node.kind,
                node.relationToCurrent,
                node.circleId ?? 'no-circle',
                node.accessState,
                node.level ?? 'no-level',
            ].join(':'))
            .sort(),
        ...input.topology.edges
            .filter((edge) => edge.kind === 'hierarchy' || edge.kind === 'auxiliary')
            .map((edge) => `${edge.id}:${edge.kind}:${edge.fromNodeId}:${edge.toNodeId}`)
            .sort(),
    ].join('|');
    const outputKey = input.outputs
        .map((row) => [
            row.knowledgeId,
            row.sourceDraftPostId ?? 'no-draft',
            row.sourceAnchorId ?? 'no-anchor',
            row.sourceSummaryHash ?? 'no-summary-hash',
        ].join(':'))
        .sort()
        .join('|');
    const draftKey = input.draft
        ? [
            input.draft.document.draftPostId,
            input.draft.stableSnapshot.draftVersion,
            input.draft.stableSnapshot.sourceSummaryHash ?? 'no-summary-hash',
            input.draft.workingCopy.workingCopyHash,
        ].join(':')
        : 'draft:null';
    return [snapshotKey, topologyKey, outputKey, draftKey, input.locale].join('::');
}

export function explainCircleCognitiveMapByDeterministicFallback(): CircleCognitiveMapAiOutput {
    return {
        routeExplanations: [],
        pendingQuestionExplanations: [],
        topologyExplanations: [],
        evolutionNarration: [],
        warnings: ['AI explanation is reserved; deterministic map explanation is active.'],
    };
}

export function explainCircleCognitiveMap(_input: CircleCognitiveMapAiInput): CircleCognitiveMapAiOutput {
    return explainCircleCognitiveMapByDeterministicFallback();
}

function normalizeCognitiveMapLocale(value: string | undefined): CircleCognitiveMapLocale {
    if (value === 'zh' || value === 'fr' || value === 'es') return value;
    return 'en';
}

function selectedContextExists(
    map: CircleCognitiveMapViewModel,
    selectedContext: CognitiveMapSelectedContext,
): boolean {
    if (selectedContext.kind === 'node') {
        const node = map.topology.nodes.find((item) => item.id === selectedContext.nodeId);
        if (!node) return false;
        return !selectedContext.recommendationSource
            || node.recommendationSource === selectedContext.recommendationSource;
    }
    if (selectedContext.kind === 'route') {
        const route = map.routes.find((item) => item.id === selectedContext.routeId);
        if (!route) return false;
        return !selectedContext.recommendationSource
            || route.recommendationSource === selectedContext.recommendationSource;
    }
    if (selectedContext.kind === 'question') {
        return map.topology.nodes.some((item) => item.id === selectedContext.questionId && item.kind === 'pending_question');
    }
    return map.evolution.some((item) => item.id === selectedContext.stepId);
}

export function buildCircleCognitiveMapAiInput(input: {
    map: CircleCognitiveMapViewModel;
    locale?: string;
    selectedContext?: CognitiveMapSelectedContext;
    viewerIntent?: CircleCognitiveMapViewerIntent;
}): CircleCognitiveMapAiInput {
    const selectedContext = input.selectedContext && selectedContextExists(input.map, input.selectedContext)
        ? input.selectedContext
        : undefined;
    return {
        circleId: input.map.circleId,
        locale: normalizeCognitiveMapLocale(input.locale),
        mapStatus: input.map.mapStatus,
        visibleFocus: input.map.visibleFocus,
        topology: input.map.topology,
        routes: input.map.routes,
        evolution: input.map.evolution,
        openQuestions: input.map.openQuestions,
        sourceDigest: input.map.sourceDigest,
        ...(selectedContext ? {selectedContext} : {}),
        ...(input.viewerIntent ? {viewerIntent: input.viewerIntent} : {}),
    };
}

export function buildCircleCognitiveMapViewModel(input: {
    circleId: number;
    snapshot: CircleSummarySnapshot | null;
    topology: CircleSummaryTopologyPayload | null;
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    copy?: CircleSummaryCopy;
    locale?: string;
    cognitiveMapAi?: CircleCognitiveMapAiView | null;
}): CircleCognitiveMapViewModel {
    const copy = input.copy ?? DEFAULT_CIRCLE_SUMMARY_COPY;
    const topology = buildTopologyContext({
        circleId: input.circleId,
        topology: input.topology,
    });
    const outputRoutes = buildRoutesFromOutputs(input.outputs, copy);
    const baseRoutes = outputRoutes.length > 0
        ? outputRoutes
        : buildRoutesFromSnapshot(input.snapshot, copy);
    const candidateAiOutput = input.cognitiveMapAi?.sourceDigest
        ? input.cognitiveMapAi.output
        : null;
    const routes = applyCircleCognitiveMapRouteExplanations(baseRoutes, candidateAiOutput);
    const routeNodes = buildRouteNodes(routes);
    const pendingQuestionNodes = applyCircleCognitiveMapPendingQuestionExplanations(
        buildPendingQuestionNodes(input.snapshot),
        candidateAiOutput,
    );
    const evidenceGapNodes = buildEvidenceGapNodes(routes);
    const currentNodeId = topology.nodes.find((node) => node.relationToCurrent === 'current')?.id
        ?? `current-circle-${input.circleId}`;
    const internalEdges = connectInternalRouteNodes({
        currentNodeId,
        routeNodes,
        pendingQuestionNodes,
        evidenceGapNodes,
    });
    const stableConclusionCount = routes.filter((route) => route.status === 'stable_conclusion').length;
    const evidenceGapCount = evidenceGapNodes.length;
    const title = topology.nodes.find((node) => node.relationToCurrent === 'current')?.title
        ?? copy.hero.title(input.circleId);
    const openQuestions = input.snapshot?.openQuestions ?? [];
    const topologyWithInternalNodes: CircleTopologyContext = {
        ...topology,
        nodes: [
            ...topology.nodes,
            ...routeNodes,
            ...pendingQuestionNodes,
            ...evidenceGapNodes,
        ],
        edges: [
            ...topology.edges,
            ...internalEdges,
        ],
        collapsedGroups: [
            ...topology.collapsedGroups,
            ...(routes.length > routeNodes.length
                ? [{
                    id: 'collapsed-routes',
                    kind: 'routes' as const,
                    label: `${routes.length - routeNodes.length} more routes`,
                    count: routes.length - routeNodes.length,
                    reason: 'Additional routes are collapsed to keep the overview readable.',
                    action: makeCognitiveMapAction({
                        kind: 'expand_collapsed_group',
                        label: 'Expand routes',
                        target: {kind: 'collapsed_group', groupId: 'collapsed-routes'},
                    }),
                }]
                : []),
        ],
    };

    const evolution = applyCircleCognitiveMapEvolutionNarration(
        buildCognitiveEvolution({
            routes,
            draft: input.draft,
            pendingQuestionNodes,
            copy,
        }),
        candidateAiOutput,
    );
    const finalTopology = applyCircleCognitiveMapTopologyExplanations(
        topologyWithInternalNodes,
        candidateAiOutput,
    );
    const aiAvailable = hasUsableCircleCognitiveMapAiOutput({
        aiOutput: candidateAiOutput,
        routes,
        pendingQuestionNodes,
        topology: finalTopology,
        evolution,
    });
    const effectiveAiOutput = aiAvailable ? candidateAiOutput : null;
    const visibleFocus = resolveAiVisibleFocus({
        aiOutput: effectiveAiOutput,
        fallback: routes[0]?.title || title,
    });

    return {
        circleId: input.circleId,
        title,
        visibleFocus,
        mapStatus: {
            stableConclusionCount,
            pendingQuestionCount: pendingQuestionNodes.length,
            evidenceGapCount,
            hasDraftBaseline: Boolean(input.draft),
        },
        topology: finalTopology,
        routes,
        openQuestions,
        evolution,
        sourceDigest: buildStableSourceDigest({
            snapshot: input.snapshot,
            topology: topologyWithInternalNodes,
            draft: input.draft,
            outputs: input.outputs,
            locale: input.locale || 'en',
        }),
        ai: {
            available: aiAvailable,
            fallbackReason: effectiveAiOutput
                ? effectiveAiOutput.warnings[0]
                : explainCircleCognitiveMapByDeterministicFallback().warnings[0],
        },
    };
}

function applyCircleCognitiveMapRouteExplanations(
    routes: CognitiveRouteView[],
    aiOutput: CircleCognitiveMapAiOutput | null,
): CognitiveRouteView[] {
    if (!aiOutput) return routes;
    const byRouteId = new Map(aiOutput.routeExplanations.map((item) => [item.routeId, item]));
    return routes.map((route) => {
        const explanation = byRouteId.get(route.id);
        if (!explanation) return route;
        return {
            ...route,
            title: explanation.shortTitle || route.title,
            summary: explanation.reason,
            reason: explanation.reason,
            nextActionLabel: explanation.nextAction || route.nextActionLabel,
        };
    });
}

function applyCircleCognitiveMapPendingQuestionExplanations(
    nodes: CognitiveMapNodeView[],
    aiOutput: CircleCognitiveMapAiOutput | null,
): CognitiveMapNodeView[] {
    if (!aiOutput) return nodes;
    const byQuestionId = new Map(aiOutput.pendingQuestionExplanations.map((item) => [item.questionId, item]));
    return nodes.map((node) => {
        const explanation = byQuestionId.get(node.id);
        if (!explanation) return node;
        return {
            ...node,
            title: explanation.summary || node.title,
            statusLabel: explanation.nextAction || node.statusLabel,
        };
    });
}

function applyCircleCognitiveMapEvolutionNarration(
    steps: CognitiveEvolutionStep[],
    aiOutput: CircleCognitiveMapAiOutput | null,
): CognitiveEvolutionStep[] {
    if (!aiOutput) return steps;
    const byStepId = new Map(aiOutput.evolutionNarration.map((item) => [item.stepId, item]));
    return steps.map((step) => {
        const narration = byStepId.get(step.id);
        if (!narration) return step;
        return {
            ...step,
            summary: narration.narration,
            reducedMotionLabel: narration.narration,
        };
    });
}

function applyCircleCognitiveMapTopologyExplanations(
    topology: CircleTopologyContext,
    aiOutput: CircleCognitiveMapAiOutput | null,
): CircleTopologyContext {
    if (!aiOutput) return topology;
    const byNodeId = new Map(aiOutput.topologyExplanations.map((item) => [item.nodeId, item]));
    return {
        ...topology,
        nodes: topology.nodes.map((node) => {
            const explanation = byNodeId.get(node.id);
            if (!explanation) return node;
            return {
                ...node,
                statusLabel: explanation.reason || node.statusLabel,
            };
        }),
    };
}

function hasUsableCircleCognitiveMapAiOutput(input: {
    aiOutput: CircleCognitiveMapAiOutput | null;
    routes: CognitiveRouteView[];
    pendingQuestionNodes: CognitiveMapNodeView[];
    topology: CircleTopologyContext;
    evolution: CognitiveEvolutionStep[];
}): boolean {
    const aiOutput = input.aiOutput;
    if (!aiOutput) return false;
    const routeIds = new Set(input.routes.map((route) => route.id));
    const questionIds = new Set(input.pendingQuestionNodes.map((node) => node.id));
    const nodeIds = new Set(input.topology.nodes.map((node) => node.id));
    const stepIds = new Set(input.evolution.map((step) => step.id));

    if (hasText(aiOutput.roleGuidance?.newcomer)
        || hasText(aiOutput.roleGuidance?.participant)
        || hasText(aiOutput.roleGuidance?.reviewer)) {
        return true;
    }
    const coreRouteIds = aiOutput.coreQuestionSuggestion?.sourceRouteIds ?? [];
    if (hasText(aiOutput.coreQuestionSuggestion?.text)
        && (coreRouteIds.length === 0 || coreRouteIds.some((routeId) => routeIds.has(routeId)))) {
        return true;
    }
    if (aiOutput.routeExplanations.some((item) => (
        routeIds.has(item.routeId)
        && (hasText(item.reason) || hasText(item.shortTitle) || hasText(item.nextAction))
    ))) {
        return true;
    }
    if (aiOutput.pendingQuestionExplanations.some((item) => (
        questionIds.has(item.questionId)
        && (hasText(item.summary) || hasText(item.nextAction))
    ))) {
        return true;
    }
    if (aiOutput.topologyExplanations.some((item) => (
        nodeIds.has(item.nodeId)
        && (hasText(item.reason) || hasText(item.suggestedAction))
    ))) {
        return true;
    }
    return aiOutput.evolutionNarration.some((item) => (
        stepIds.has(item.stepId)
        && hasText(item.narration)
    ));
}

function hasText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function resolveAiVisibleFocus(input: {
    aiOutput: CircleCognitiveMapAiOutput | null;
    fallback: string;
}): string {
    return input.aiOutput?.roleGuidance?.newcomer
        || input.aiOutput?.coreQuestionSuggestion?.text
        || input.fallback;
}

export function pickCircleSummarySnapshot(
    payload: unknown,
): CircleSummarySnapshot {
    const root = ensureObject(payload);
    const issueMap = Array.isArray(root.issueMap)
        ? root.issueMap.map((item) => normalizeIssueMapCard(item))
        : [];
    const conceptGraph = ensureObject(root.conceptGraph);
    const viewpointBranches = Array.isArray(root.viewpointBranches)
        ? root.viewpointBranches.map((item) => ensureObject(item))
        : [];
    const factExplanationEmotionBreakdown = ensureObject(root.factExplanationEmotionBreakdown);
    const emotionConflictContext = ensureObject(root.emotionConflictContext);
    const sedimentationTimeline = Array.isArray(root.sedimentationTimeline)
        ? root.sedimentationTimeline.map((item) => normalizeTimelineItem(item))
        : [];
    const openQuestions = Array.isArray(root.openQuestions)
        ? root.openQuestions.map((item) => normalizeOpenQuestion(item))
        : [];
    const generatedAt = String(root.generatedAt || '');

    return {
        summaryId: String(root.summaryId || ''),
        circleId: asPositiveNumber(root.circleId),
        version: asPositiveNumber(root.version),
        issueMap,
        conceptGraph,
        viewpointBranches,
        factExplanationEmotionBreakdown,
        emotionConflictContext,
        sedimentationTimeline,
        openQuestions,
        generatedAt,
        generatedBy: asGeneratedBy(root.generatedBy),
        generationMetadata: normalizeGenerationMetadata(root.generationMetadata),
    };
}

export function pickCircleSummaryTopologyPayload(
    payload: unknown,
): CircleSummaryTopologyPayload | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
    }
    const root = payload as Record<string, unknown>;
    return {
        current: normalizeTopologyItem(root.current),
        parent: root.parent ? normalizeTopologyItem(root.parent) : null,
        children: Array.isArray(root.children)
            ? root.children.map((item) => normalizeTopologyItem(item))
            : [],
        auxiliarySiblings: Array.isArray(root.auxiliarySiblings)
            ? root.auxiliarySiblings.map((item) => normalizeTopologyItem(item))
            : [],
        sourceVersion: asNullableString(root.sourceVersion) || 'unknown-topology',
    };
}

export function pickCircleCognitiveMapAiView(
    payload: unknown,
): CircleCognitiveMapAiView | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return null;
    }
    const root = payload as Record<string, unknown>;
    const output = root.output && typeof root.output === 'object' && !Array.isArray(root.output)
        ? root.output as CircleCognitiveMapAiOutput
        : null;
    if (!output || !Array.isArray(output.routeExplanations)) return null;
    return {
        sourceDigest: asNullableString(root.sourceDigest),
        output: {
            routeExplanations: Array.isArray(output.routeExplanations) ? output.routeExplanations : [],
            pendingQuestionExplanations: Array.isArray(output.pendingQuestionExplanations) ? output.pendingQuestionExplanations : [],
            topologyExplanations: Array.isArray(output.topologyExplanations) ? output.topologyExplanations : [],
            evolutionNarration: Array.isArray(output.evolutionNarration) ? output.evolutionNarration : [],
            warnings: Array.isArray(output.warnings) ? output.warnings : [],
            ...(output.coreQuestionSuggestion ? {coreQuestionSuggestion: output.coreQuestionSuggestion} : {}),
            ...(output.roleGuidance ? {roleGuidance: output.roleGuidance} : {}),
        },
        generatedAt: asNullableString(root.generatedAt),
        modelProfile: asNullableString(root.modelProfile),
        promptVersion: asNullableString(root.promptVersion),
    };
}

export function formatCircleSummaryGeneratedByLabel(
    generatedBy: CircleSummaryGeneratedBy,
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): string {
    return copy.generatedBy[generatedBy] ?? copy.generatedBy.system_projection;
}

export function formatCircleSummaryProviderModeLabel(
    providerMode: string | null | undefined,
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): string {
    switch (providerMode) {
        case 'builtin':
            return copy.providerMode.builtin;
        case 'projection':
            return copy.providerMode.projection;
        case 'rule':
            return copy.providerMode.rule;
        default:
            return providerMode && providerMode.trim().length > 0
                ? providerMode
                : copy.providerMode.fallback;
    }
}

export function resolveCircleSummaryPresentation(input: {
    circleId: number;
    snapshot: CircleSummarySnapshot | null;
    draft: FrozenSummaryDraftConsumption | null;
    outputs: CrystalOutputViewModel[];
    forkHint?: { thresholdLabel: string; knowledgeLineageLabel: string } | null;
    copy?: CircleSummaryCopy;
}): CircleSummaryResolvedPresentation {
    if (input.snapshot) {
        return {
            source: 'snapshot',
            summaryMap: buildCircleSummaryMapViewModelFromSnapshot({
                circleId: input.circleId,
                snapshot: input.snapshot,
                draft: input.draft,
                copy: input.copy,
            }),
            diagnostics: {
                version: input.snapshot.version,
                generatedAt: input.snapshot.generatedAt,
                generatedBy: input.snapshot.generatedBy,
                generationMetadata: input.snapshot.generationMetadata,
            },
        };
    }

    return {
        source: 'pending_snapshot',
        summaryMap: null,
        diagnostics: null,
    };
}

export function pickFrozenSummaryDraftConsumption(
    payload: unknown,
): FrozenSummaryDraftConsumption {
    const root = ensureObject(payload);
    const stableSnapshot = ensureObject(root.stableSnapshot);
    const workingCopy = ensureObject(root.workingCopy);

    return {
        document: {
            draftPostId: asPositiveNumber(root.draftPostId),
            circleId: asNullableNumber(root.circleId),
            documentStatus: (asNullableString(root.documentStatus) || 'drafting') as FrozenDraftDocumentView['documentStatus'],
            currentSnapshotVersion: asPositiveNumber(root.currentSnapshotVersion),
        },
        stableSnapshot: {
            draftVersion: asPositiveNumber(stableSnapshot.draftVersion),
            sourceKind: asNullableString(stableSnapshot.sourceKind) as FrozenDraftSourceKind,
            createdAt: asNullableString(stableSnapshot.createdAt),
            seedDraftAnchorId: asNullableString(stableSnapshot.seedDraftAnchorId),
            sourceEditAnchorId: asNullableString(stableSnapshot.sourceEditAnchorId),
            sourceSummaryHash: asNullableString(stableSnapshot.sourceSummaryHash),
            sourceMessagesDigest: asNullableString(stableSnapshot.sourceMessagesDigest),
            contentHash: asNullableString(stableSnapshot.contentHash),
        },
        workingCopy: {
            draftPostId: asPositiveNumber(workingCopy.draftPostId),
            basedOnSnapshotVersion: asPositiveNumber(workingCopy.basedOnSnapshotVersion),
            workingCopyHash: String(workingCopy.workingCopyHash || ''),
            status: 'active',
            updatedAt: String(workingCopy.updatedAt || ''),
        },
    };
}

export function buildDraftReferenceLinkConsumptionNeeds(): DraftReferenceLinkConsumptionNeeds {
    return {
        publicReadiness: 'public_read_exit_live',
        note: DEFAULT_CIRCLE_SUMMARY_COPY.reference.note,
        fields: [
            {
                field: 'referenceId',
                reason: 'Used for stable keys and citation/reference deduplication.',
            },
            {
                field: 'draftPostId',
                reason: 'Used to bind the reference back to the source draft behind the summary or output.',
            },
            {
                field: 'draftVersion',
                reason: 'Used to bind a stable snapshot version.',
            },
            {
                field: 'sourceBlockId',
                reason: 'Used to anchor the reference back to a source block or citation segment.',
            },
            {
                field: 'crystalName',
                reason: 'Used to render the referenced output title.',
            },
            {
                field: 'crystalBlockAnchor',
                reason: 'Used to jump to a block anchor inside the crystal output.',
            },
            {
                field: 'status',
                reason: 'Used to distinguish references that resolved successfully and can be shown.',
            },
        ],
    };
}

export function formatDraftReferenceLinkConsumptionFieldLabel(
    field: DraftReferenceLinkConsumptionField['field'],
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): string {
    return copy.reference.fields[field] ?? field;
}

export function formatSummaryDegradationLabel(
    value: string,
    copy: CircleSummaryCopy = DEFAULT_CIRCLE_SUMMARY_COPY,
): string {
    switch (value) {
        case 'selected frozen draft lifecycle input':
            return copy.degradation['selected frozen draft lifecycle input'];
        case 'snapshot-backed output evidence':
            return copy.degradation['snapshot-backed output evidence'];
        case 'stable output to draft binding':
            return copy.degradation['stable output to draft binding'];
        default:
            return value;
    }
}

export function buildSummaryDependencyViewModel(input: {
    draft: FrozenSummaryDraftConsumption | null;
    outputs: Array<{ missingTeam03Inputs?: string[] }>;
}): SummaryDependencyViewModel {
    const missing = new Set<SummaryDegradationKey>();
    if (!input.draft) {
        missing.add('selected frozen draft lifecycle input');
    }
    for (const output of input.outputs) {
        for (const item of output.missingTeam03Inputs || []) {
            if (
                item === 'selected frozen draft lifecycle input'
                || item === 'snapshot-backed output evidence'
                || item === 'stable output to draft binding'
            ) {
                missing.add(item);
            }
        }
    }

    return {
        hasSelectedDraft: Boolean(input.draft),
        missingTeam03Inputs: Array.from(missing),
    };
}

function hasSnapshotBackedEvidence(output: StableOutputBindingEvidence): boolean {
    if (output.sourceBindingKind !== 'snapshot') return false;
    return Boolean(
        output.sourceAnchorId
        || output.sourceSummaryHash
        || output.sourceMessagesDigest,
    );
}

function matchesFrozenSnapshotEvidence(
    output: StableOutputBindingEvidence,
    draft: FrozenSummaryDraftConsumption,
): boolean {
    if (!hasSnapshotBackedEvidence(output)) return false;

    if (
        output.sourceAnchorId
        && output.sourceAnchorId !== draft.stableSnapshot.seedDraftAnchorId
    ) {
        return false;
    }
    if (
        output.sourceSummaryHash
        && output.sourceSummaryHash !== draft.stableSnapshot.sourceSummaryHash
    ) {
        return false;
    }
    if (
        output.sourceMessagesDigest
        && output.sourceMessagesDigest !== draft.stableSnapshot.sourceMessagesDigest
    ) {
        return false;
    }

    return true;
}

function resolveStableOutputDraftPostId(input: {
    output: StableOutputBindingEvidence;
    draftCandidates: FrozenSummaryDraftConsumption[];
}): number | null {
    if (input.output.sourceDraftPostId !== null) {
        return input.output.sourceDraftPostId;
    }
    if (!hasSnapshotBackedEvidence(input.output)) {
        return null;
    }

    const matches = input.draftCandidates.filter((draft) =>
        matchesFrozenSnapshotEvidence(input.output, draft),
    );

    if (matches.length !== 1) {
        return null;
    }

    return matches[0].document.draftPostId;
}

export function attachStableOutputDraftBindings(input: {
    outputs: CrystalOutputViewModel[];
    draftCandidates: FrozenSummaryDraftConsumption[];
}): CrystalOutputViewModel[] {
    return input.outputs.map((output) => {
        const resolvedDraftPostId = resolveStableOutputDraftPostId({
            output,
            draftCandidates: input.draftCandidates,
        });
        if (resolvedDraftPostId === null || resolvedDraftPostId === output.sourceDraftPostId) {
            return output;
        }

        return {
            ...output,
            sourceDraftPostId: resolvedDraftPostId,
            missingTeam03Inputs: output.missingTeam03Inputs.filter(
                (item) => item !== 'stable output to draft binding',
            ),
        };
    });
}

export function pickAutoSelectedFrozenSummaryDraftConsumption(input: {
    requestedDraftPostId: number | null;
    outputs: CrystalOutputViewModel[];
    draftCandidates: FrozenSummaryDraftConsumption[];
}): FrozenSummaryDraftConsumption | null {
    if (input.requestedDraftPostId !== null) {
        return input.draftCandidates.find((draft) =>
            draft.document.draftPostId === input.requestedDraftPostId,
        ) || null;
    }

    const boundOutputs = attachStableOutputDraftBindings({
        outputs: input.outputs,
        draftCandidates: input.draftCandidates,
    });
    const preferredDraftPostIds = Array.from(new Set(
        boundOutputs
            .filter((output) =>
                output.sourceBindingKind === 'snapshot'
                && output.sourceDraftPostId !== null,
            )
            .map((output) => output.sourceDraftPostId as number),
    ));

    if (preferredDraftPostIds.length !== 1) {
        return null;
    }

    const [preferredDraftPostId] = preferredDraftPostIds;

    return input.draftCandidates.find((draft) =>
        draft.document.draftPostId === preferredDraftPostId,
    ) || null;
}
