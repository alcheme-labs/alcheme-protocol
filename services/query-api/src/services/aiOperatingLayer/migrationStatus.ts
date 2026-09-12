import type { AiJobType } from '../aiJobs/types';
import { classifyAiJobCompatibility } from './jobCompatibility';
import {
    listAiTaskCatalogEntries,
    resolveTaskCatalogEntry,
} from './taskCatalog';
import type { AiCapability } from './types';

export type AiLegacyMigrationCategory =
    | 'discussion'
    | 'draft'
    | 'circle_summary'
    | 'voice'
    | 'domain_async';

export type AiLegacyMigrationState =
    | 'current'
    | 'reserve'
    | 'future'
    | 'domain_async_non_model';

export interface AiLegacyMigrationCapabilityStatus {
    key: string;
    label: string;
    category: AiLegacyMigrationCategory;
    state: AiLegacyMigrationState;
    taskType: string | null;
    taskCatalogVersion: string | null;
    aiJobType: AiJobType | null;
    catalogStatus: string | null;
    executionStrategy: string;
    modelTask: boolean;
    asyncDomainTask: boolean;
    requiredCapabilities: AiCapability[];
    allowedProviderProfiles: string[];
    legacyOwnerPaths: string[];
    legacyReadModel: string;
    proposalEnvelope: {
        status: 'current' | 'backfill_supported' | 'not_required' | 'excluded';
        reason: string;
    };
    backfill: {
        status: 'supported' | 'not_required' | 'excluded';
        writes: string[];
        dryRunSafe: boolean;
    };
    compatibilityNotes: string[];
}

export interface AiLegacyMigrationReserveStatus {
    key: string;
    label: string;
    state: 'reserve' | 'future';
    reason: string;
    blockedBy: string[];
}

export interface AiRequiredBacklogGapStatus {
    key: string;
    label: string;
    sourceDocument: string;
    previousState: 'reserve' | 'future';
    currentRequirement: 'required_current_work';
    currentImplementationStatus: 'partial' | 'not_done';
    targetPlanPart: string;
    missingWork: string[];
    aiBoundary: string;
    nonAiCompanion: string[];
    rollbackPath: string;
}

export interface AiTrackedAdjacentGapStatus {
    key: string;
    label: string;
    sourceDocument: string;
    previousState: 'reserve' | 'future';
    currentRequirement: 'requires_separate_user_scope';
    currentImplementationStatus: 'not_done';
    targetPlanPart: string;
    missingWork: string[];
    aiBoundary: string;
    nonAiCompanion: string[];
    rollbackPath: string;
}

export interface AiOperatingLayerMigrationStatus {
    statusVersion: 'part8.v1';
    generatedAt: string;
    catalogSummary: {
        currentEntries: number;
        currentModelTasks: number;
        deterministicTasks: number;
        domainAsyncJobTypes: AiJobType[];
    };
    currentCapabilities: AiLegacyMigrationCapabilityStatus[];
    reserveExclusions: AiLegacyMigrationReserveStatus[];
    requiredBacklogGaps: AiRequiredBacklogGapStatus[];
    trackedAdjacentGaps: AiTrackedAdjacentGapStatus[];
    rollback: {
        envelopeModeEnv: 'AI_OPERATING_LAYER_ENVELOPE_MODE';
        offMode: string;
        dryRunBehavior: string;
    };
}

interface LegacyCapabilityDefinition {
    key: string;
    label: string;
    category: AiLegacyMigrationCategory;
    taskType: string | null;
    aiJobType: AiJobType | null;
    state?: AiLegacyMigrationState;
    legacyOwnerPaths: string[];
    legacyReadModel: string;
    proposalEnvelope: AiLegacyMigrationCapabilityStatus['proposalEnvelope'];
    backfill: AiLegacyMigrationCapabilityStatus['backfill'];
    compatibilityNotes: string[];
}

const LEGACY_CAPABILITIES: LegacyCapabilityDefinition[] = [
    {
        key: 'discussion_message_analyze',
        label: 'Discussion message analysis',
        category: 'discussion',
        taskType: 'discussion.analysis.v1',
        aiJobType: 'discussion_message_analyze',
        legacyOwnerPaths: [
            'services/query-api/src/services/discussion/analysis',
            'services/query-api/src/ai/discussion-intelligence',
        ],
        legacyReadModel: 'circle_discussion_messages analysis columns',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'analysis writes legacy message fields for compatibility; no user-facing proposal artifact is needed',
        },
        backfill: {
            status: 'supported',
            writes: ['ai_jobs.task_type', 'ai_jobs.task_catalog_version'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Preserves existing relevance/focus/semantic field writes.',
            'No frontend apply action is introduced.',
        ],
    },
    {
        key: 'discussion_circle_reanalyze',
        label: 'Discussion circle reanalysis',
        category: 'discussion',
        taskType: 'discussion.reanalyze.v1',
        aiJobType: 'discussion_circle_reanalyze',
        legacyOwnerPaths: [
            'services/query-api/src/services/discussion/analysis/invalidation.ts',
        ],
        legacyReadModel: 'batch refresh of discussion analysis fields',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'batch analysis is an internal refresh, not a human-applied proposal',
        },
        backfill: {
            status: 'supported',
            writes: ['ai_jobs.task_type', 'ai_jobs.task_catalog_version'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Preserves existing lease/retry behavior.',
        ],
    },
    {
        key: 'discussion_trigger_evaluate',
        label: 'Discussion trigger evaluation',
        category: 'discussion',
        taskType: 'discussion.trigger.v1',
        aiJobType: 'discussion_trigger_evaluate',
        legacyOwnerPaths: [
            'services/query-api/src/ai/discussion-draft-trigger.ts',
            'services/query-api/src/ai/discussion-intelligence/trigger-judge.ts',
        ],
        legacyReadModel: 'trigger decision payload in ai_jobs.result_json',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'trigger decision remains notify-only or enqueue-bound; it must not auto-upgrade to draft apply',
        },
        backfill: {
            status: 'supported',
            writes: ['ai_jobs.task_type', 'ai_jobs.task_catalog_version'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Does not change notify-only versus auto-draft boundary.',
        ],
    },
    {
        key: 'discussion_initial_draft',
        label: 'Discussion initial draft',
        category: 'draft',
        taskType: 'discussion.trigger.v1',
        aiJobType: 'discussion_trigger_evaluate',
        legacyOwnerPaths: [
            'services/query-api/src/ai/discussion-draft-trigger.ts',
            'services/query-api/src/ai/discussion-initial-draft.ts',
        ],
        legacyReadModel: 'draft candidate notices and draft lifecycle service',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'initial draft is still owned by the trigger/draft lifecycle path; Part 8 does not add a generic apply surface',
        },
        backfill: {
            status: 'not_required',
            writes: [],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Catalog coverage is inherited from discussion.trigger.v1.',
            'Future deep migration can split an initial-draft proposal contract after dual-read evidence.',
        ],
    },
    {
        key: 'discussion_summary',
        label: 'Discussion summary',
        category: 'discussion',
        taskType: 'discussion.summary.v1',
        aiJobType: null,
        legacyOwnerPaths: [
            'services/query-api/src/ai/discussion-summary.ts',
            'services/query-api/src/services/discussion/summaryDiagnostics.ts',
        ],
        legacyReadModel: 'summary string plus generation metadata',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'summary is a read artifact, not a proposed write action',
        },
        backfill: {
            status: 'not_required',
            writes: [],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Keeps rule fallback and provider metadata in the existing summary artifact.',
        ],
    },
    {
        key: 'draft_ghost_revision',
        label: 'Ghost draft revision',
        category: 'draft',
        taskType: 'draft.ghost_revision.v1',
        aiJobType: 'ghost_draft_generate',
        legacyOwnerPaths: [
            'services/query-api/src/ai/ghost-draft.ts',
            'services/query-api/src/rest/ai.ts',
            'frontend/src/hooks/useGhostDraftGeneration.ts',
        ],
        legacyReadModel: 'ghost_draft_generations plus ai_jobs stream/polling',
        proposalEnvelope: {
            status: 'backfill_supported',
            reason: 'proposal envelope indexes generated suggestions while legacy generation payload remains readable',
        },
        backfill: {
            status: 'supported',
            writes: ['ai_jobs.task_type', 'ai_jobs.task_catalog_version', 'ai_proposal_artifacts'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Accept/apply remains domain-owned and user-confirmed.',
            'Auto-apply jobs do not create ready proposal envelopes.',
        ],
    },
    {
        key: 'draft_accepted_issue_revision',
        label: 'Accepted issue revision',
        category: 'draft',
        taskType: 'draft.accepted_issue_revision.v1',
        aiJobType: 'accepted_issue_revision_generate',
        legacyOwnerPaths: [
            'services/query-api/src/services/draftAiAssist/acceptedIssueRevision.ts',
            'frontend/src/hooks/useAcceptedIssueRevisionAssist.ts',
        ],
        legacyReadModel: 'ghost_draft_generations plus ai_jobs stream/polling',
        proposalEnvelope: {
            status: 'backfill_supported',
            reason: 'proposal envelope indexes accepted issue suggestions while legacy generation payload remains readable',
        },
        backfill: {
            status: 'supported',
            writes: ['ai_jobs.task_type', 'ai_jobs.task_catalog_version', 'ai_proposal_artifacts'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Only accepted unapplied issues are eligible.',
            'Apply remains explicit and draft state-machine owned.',
        ],
    },
    {
        key: 'circle_summary_overlay',
        label: 'Circle summary overlay',
        category: 'circle_summary',
        taskType: 'circle.summary.overlay.v1',
        aiJobType: null,
        legacyOwnerPaths: [
            'services/query-api/src/services/circleSummary',
            'services/query-api/src/rest/circleSummary.ts',
            'frontend/src/features/circle-summary',
        ],
        legacyReadModel: 'circle_summary_snapshots.generation_metadata',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'circle summary is a domain read snapshot; LLM overlay must not generate topology facts',
        },
        backfill: {
            status: 'not_required',
            writes: [],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Snapshot topology remains deterministic/source-backed.',
        ],
    },
    {
        key: 'circle_cognitive_map_ai',
        label: 'Circle Cognitive Map AI',
        category: 'circle_summary',
        taskType: 'circle.cognitive_map_explain.v1',
        aiJobType: 'circle_cognitive_map_explain',
        legacyOwnerPaths: [
            'services/query-api/src/services/aiOperatingLayer/cognitiveMap',
            'services/query-api/src/rest/circleSummary.ts',
            'frontend/src/features/circle-summary',
        ],
        legacyReadModel: 'ai_jobs.result_json plus circle summary cognitive map view model',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'AI produces bounded explanation text for an existing read model, not a proposed write action',
        },
        backfill: {
            status: 'not_required',
            writes: ['ai_jobs.result_json', 'ai_context_capsules'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Topology, access state, route ids, and source refs remain server-derived.',
            'AI output is validated against existing route/node/question/step/source ids before UI consumption.',
            'Frontend change is data wiring only; no direct model call or arbitrary UI generation.',
        ],
    },
    {
        key: 'contribution_assessment_ai',
        label: 'Contribution Assessment AI',
        category: 'draft',
        taskType: 'contribution.assessment_suggest.v1',
        aiJobType: null,
        legacyOwnerPaths: [
            'services/query-api/src/services/contributionAssessment',
            'services/query-api/src/rest/discussion.ts',
        ],
        legacyReadModel: 'contribution_assessments signed artifact plus contribution trace APIs',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'AI provider output is a bounded suggestion consumed by the existing contribution assessment artifact lifecycle',
        },
        backfill: {
            status: 'not_required',
            writes: ['contribution_assessments', 'contribution_assessment_decisions'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'AI provider mode fails closed unless private sidecar, privacy profile, eval suite, redaction policy, and bounded evidence limits are configured.',
            'AI output never writes proof roots, receipt weights, or knowledge contributions directly.',
            'High-penetration suggestions remain gated by explicit contribution assessment decisions.',
        ],
    },
    {
        key: 'voice_recap_rule',
        label: 'Voice recap rule summary',
        category: 'voice',
        taskType: 'voice.recap.rule.v1',
        aiJobType: 'voice_recap_generate',
        legacyOwnerPaths: [
            'services/query-api/src/services/voice/recap.ts',
        ],
        legacyReadModel: 'voice recap artifact',
        proposalEnvelope: {
            status: 'not_required',
            reason: 'current voice recap is deterministic and must not send raw transcript to a model',
        },
        backfill: {
            status: 'supported',
            writes: ['ai_jobs.task_type', 'ai_jobs.task_catalog_version'],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Model-backed voice recap remains future pending transcript/source review lifecycle.',
        ],
    },
    {
        key: 'crystal_asset_issue',
        label: 'Crystal asset issue',
        category: 'domain_async',
        taskType: null,
        aiJobType: 'crystal_asset_issue',
        state: 'domain_async_non_model',
        legacyOwnerPaths: [
            'services/query-api/src/services/crystalAssets',
        ],
        legacyReadModel: 'domain async mint/issue receipt',
        proposalEnvelope: {
            status: 'excluded',
            reason: 'not an AI capability task; it only reuses async job infrastructure',
        },
        backfill: {
            status: 'excluded',
            writes: [],
            dryRunSafe: true,
        },
        compatibilityNotes: [
            'Must stay out of model routing and provider capability accounting.',
        ],
    },
];

const RESERVE_EXCLUSIONS: AiLegacyMigrationReserveStatus[] = [];

const REQUIRED_BACKLOG_GAPS: AiRequiredBacklogGapStatus[] = [];

const TRACKED_ADJACENT_GAPS: AiTrackedAdjacentGapStatus[] = [
    {
        key: 'voice_recap_model_backed',
        label: 'Voice Recap Model-backed AI',
        sourceDocument: 'docs/architecture/next-generation-ai-operating-layer-product-optimization.zh-CN.md',
        previousState: 'future',
        currentRequirement: 'requires_separate_user_scope',
        currentImplementationStatus: 'not_done',
        targetPlanPart: 'Separate Voice Recap Model-backed AI plan only after user approval',
        missingWork: [
            'opt-in transcript lifecycle',
            'SourceMaterial review path',
            'private sidecar/provider privacy gate',
            'model-backed recap task catalog entry',
            'voice recap evaluation coverage',
        ],
        aiBoundary: 'AI may summarize reviewed opt-in transcript material only after source and privacy gates pass.',
        nonAiCompanion: [
            'transcript review lifecycle',
            'SourceMaterial intake',
            'private plaintext consent and retention controls',
        ],
        rollbackPath: 'Keep voice recap on deterministic non-model summary.',
    },
];

export function buildAiOperatingLayerMigrationStatus(
    now: Date = new Date(),
): AiOperatingLayerMigrationStatus {
    const catalogEntries = listAiTaskCatalogEntries();
    const currentCapabilities = LEGACY_CAPABILITIES.map((definition) =>
        buildCapabilityStatus(definition),
    );
    const deterministicTasks = catalogEntries.filter((entry) =>
        entry.executionStrategy === 'deterministic_only',
    );
    const currentModelTasks = catalogEntries.filter((entry) =>
        entry.status === 'current'
        && entry.requiredCapabilities.length > 0
        && entry.executionStrategy !== 'deterministic_only',
    );

    return {
        statusVersion: 'part8.v1',
        generatedAt: now.toISOString(),
        catalogSummary: {
            currentEntries: catalogEntries.filter((entry) => entry.status === 'current').length,
            currentModelTasks: currentModelTasks.length,
            deterministicTasks: deterministicTasks.length,
            domainAsyncJobTypes: currentCapabilities
                .filter((entry) => entry.asyncDomainTask)
                .map((entry) => entry.aiJobType)
                .filter((jobType): jobType is AiJobType => Boolean(jobType)),
        },
        currentCapabilities,
        reserveExclusions: RESERVE_EXCLUSIONS.map((entry) => ({
            ...entry,
            blockedBy: [...entry.blockedBy],
        })),
        requiredBacklogGaps: REQUIRED_BACKLOG_GAPS.map((entry) => ({
            ...entry,
            missingWork: [...entry.missingWork],
            nonAiCompanion: [...entry.nonAiCompanion],
        })),
        trackedAdjacentGaps: TRACKED_ADJACENT_GAPS.map((entry) => ({
            ...entry,
            missingWork: [...entry.missingWork],
            nonAiCompanion: [...entry.nonAiCompanion],
        })),
        rollback: {
            envelopeModeEnv: 'AI_OPERATING_LAYER_ENVELOPE_MODE',
            offMode: 'off disables proposal envelope writes and keeps legacy reads active',
            dryRunBehavior: 'dryRun and off report would-update counts without mutating ai_jobs or proposals',
        },
    };
}

function buildCapabilityStatus(
    definition: LegacyCapabilityDefinition,
): AiLegacyMigrationCapabilityStatus {
    const catalogEntry = definition.taskType
        ? resolveTaskCatalogEntry(definition.taskType)
        : null;
    const compatibility = definition.aiJobType
        ? classifyAiJobCompatibility(definition.aiJobType)
        : null;
    const catalogModelTask = Boolean(
        catalogEntry
        && catalogEntry.requiredCapabilities.length > 0
        && catalogEntry.executionStrategy !== 'deterministic_only',
    );

    return {
        key: definition.key,
        label: definition.label,
        category: definition.category,
        state: definition.state ?? 'current',
        taskType: catalogEntry?.taskType ?? definition.taskType,
        taskCatalogVersion: catalogEntry?.catalogVersion ?? compatibility?.taskCatalogVersion ?? null,
        aiJobType: definition.aiJobType,
        catalogStatus: catalogEntry?.status ?? null,
        executionStrategy: catalogEntry?.executionStrategy ?? compatibility?.executionStrategy ?? 'domain_async',
        modelTask: compatibility ? compatibility.modelTask : catalogModelTask,
        asyncDomainTask: Boolean(compatibility?.asyncDomainTask),
        requiredCapabilities: [...(catalogEntry?.requiredCapabilities ?? compatibility?.requiredCapabilities ?? [])],
        allowedProviderProfiles: [...(catalogEntry?.allowedProviderProfiles ?? [])],
        legacyOwnerPaths: [...definition.legacyOwnerPaths],
        legacyReadModel: definition.legacyReadModel,
        proposalEnvelope: { ...definition.proposalEnvelope },
        backfill: {
            ...definition.backfill,
            writes: [...definition.backfill.writes],
        },
        compatibilityNotes: [...definition.compatibilityNotes],
    };
}
