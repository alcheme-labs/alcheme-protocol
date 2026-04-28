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
        primaryLabel: 'Main route',
        parallelLabel: (index) => `Parallel branch ${index}`,
        primaryHint: 'If this is your first time in the circle, start here.',
        parallelHint: 'Use this branch when you want to compare a different interpretation.',
    },
    branch: {
        statusPrimary: 'Most mature now',
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
