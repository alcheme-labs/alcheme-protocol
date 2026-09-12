import crypto from 'crypto';

import { evaluateAiPolicyGate, type AiProposedAction } from './policyGate';

const FORBIDDEN_PROPOSAL_DIFF_FIELDS = [
    'proofRoot',
    'signature',
    'receiptWeight',
    'rawPrompt',
    'rawText',
    'privateText',
    'providerRawResponse',
    'css',
    'selector',
    'remoteResource',
    'sourceExcerpt',
    'personalProfile',
    'providerTrace',
    'privateProfile',
] as const;

interface GhostDraftGenerationLike {
    id: number | string;
    draftPostId: number | string;
    requestedByUserId?: number | string | null;
    promptAsset?: string | null;
    promptVersion?: string | null;
    sourceDigest?: string | null;
    providerMode?: string | null;
    model?: string | null;
    draftText?: string | null;
    suggestions?: unknown[] | null;
}

interface CreateProposalInput {
    generation: GhostDraftGenerationLike;
    aiJobId?: number | null;
}

interface GenericProposalArtifactInput {
    id?: string;
    taskType: string;
    subjectType: string;
    subjectId: string;
    createdByUserId?: number | string | null;
    idempotencyKey: string;
    sourceDigest?: string | null;
    evidenceRefs?: unknown[] | null;
    contextCapsuleId?: string | null;
    modelProfile?: string | null;
    promptVersion?: string | null;
    outputSchemaVersion?: string | null;
    riskLevel?: string | null;
    proposedAction: AiProposedAction;
    proposedDiff: Record<string, unknown>;
    explanation?: string | null;
    validationErrors?: unknown[] | null;
    reviewRequired?: boolean;
    domainArtifactType?: string | null;
    domainArtifactId?: string | number | null;
    domainStatus?: string | null;
    applyTarget?: Record<string, unknown> | null;
    expiresAt?: Date | string | null;
}

interface TrendPromptCacheLike {
    id: string;
    requestedByUserId?: number | string | null;
    sourceDigest?: string | null;
    contextCapsuleId?: string | null;
    payload?: {
        status?: string | null;
        suggestions?: unknown[] | null;
        evidenceRefs?: unknown[] | null;
        query?: unknown;
        confidence?: unknown;
        expiresAt?: string | null;
    } | Record<string, unknown> | null;
    status?: string | null;
    failureCode?: string | null;
    expiresAt?: Date | string | null;
}

interface ConfigurationProposalLike {
    subjectType: 'circle_create_session' | 'circle' | 'circle_fork_session';
    subjectId: string;
    createdByUserId?: number | string | null;
    contextCapsuleId?: string | null;
    sourceDigest?: string | null;
    evidenceRefs?: unknown[] | null;
    entrypoint: 'create_circle' | 'circle_settings' | 'fork_create';
    proposal: {
        reason: string;
        riskLevel: string;
        affectedFields: string[];
        configDiff: unknown[];
        validationErrors?: unknown[] | null;
    };
    modelProfile?: string | null;
    promptVersion?: string | null;
    expiresAt?: Date | string | null;
}

interface SettingsTextSuggestionLike {
    subjectType: 'profile' | 'circle_alias';
    subjectId: string;
    createdByUserId?: number | string | null;
    contextCapsuleId?: string | null;
    sourceDigest?: string | null;
    field: string;
    proposal: {
        field: string;
        previousValue: string;
        suggestedValue: string | null;
        reason: string;
        confidence: number | null;
        riskLevel: string;
        requiredPermission: string;
        validationErrors?: unknown[] | null;
    };
    modelProfile?: string | null;
    promptVersion?: string | null;
    expiresAt?: Date | string | null;
}

interface StyleProposalLike {
    subjectType: 'style_user' | 'circle' | 'style_session';
    subjectId: string;
    createdByUserId?: number | string | null;
    contextCapsuleId?: string | null;
    sourceDigest?: string | null;
    evidenceRefs?: unknown[] | null;
    scope: 'personal' | 'circle' | 'session_preview';
    proposal: {
        reason: string;
        riskLevel: string;
        tokenPolicyVersion: string;
        styleIntent: string;
        tone: string;
        tokenSelections: unknown;
        tokenDiff: unknown[];
        lifeFeelInputs: unknown;
        previewState: unknown;
        accessibilityChecks: unknown[];
        validationErrors?: unknown[] | null;
    };
    modelProfile?: string | null;
    promptVersion?: string | null;
    expiresAt?: Date | string | null;
}

export function validateProposalDiff(diff: Record<string, unknown>): {
    ok: true;
    forbiddenFields: [];
} | {
    ok: false;
    forbiddenFields: string[];
} {
    const forbiddenFields = Array.from(collectForbiddenFields(diff));
    if (forbiddenFields.length > 0) {
        return {
            ok: false,
            forbiddenFields: [...forbiddenFields],
        };
    }
    return {
        ok: true,
        forbiddenFields: [],
    };
}

function collectForbiddenFields(value: unknown, output = new Set<string>()): Set<string> {
    if (!value || typeof value !== 'object') return output;
    if (Array.isArray(value)) {
        value.forEach((item) => collectForbiddenFields(item, output));
        return output;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if ((FORBIDDEN_PROPOSAL_DIFF_FIELDS as readonly string[]).includes(key)) {
            output.add(key);
        }
        collectForbiddenFields(nested, output);
    }
    return output;
}

export async function createProposalForGhostDraftGeneration(
    prisma: any,
    input: CreateProposalInput,
) {
    return createProposalForGeneration(prisma, {
        ...input,
        taskType: 'draft.ghost_revision.v1',
        proposedAction: 'draft.ghost_revision.accept',
    });
}

export async function createProposalForAcceptedIssueRevisionGeneration(
    prisma: any,
    input: CreateProposalInput,
) {
    return createProposalForGeneration(prisma, {
        ...input,
        taskType: 'draft.accepted_issue_revision.v1',
        proposedAction: 'draft.accepted_issue_revision.apply',
    });
}

async function createProposalForGeneration(
    prisma: any,
    input: CreateProposalInput & {
        taskType: string;
        proposedAction: AiProposedAction;
    },
) {
    const proposedDiff = buildProposedDiff(input.generation);

    const generationId = String(input.generation.id);
    const draftPostId = String(input.generation.draftPostId);
    const idempotencyKey = `${input.taskType}:ghost_draft_generation:${generationId}`;
    return createAiProposalArtifact(prisma, {
        taskType: input.taskType,
        subjectType: 'draft_post',
        subjectId: draftPostId,
        createdByUserId: normalizeOptionalNumber(input.generation.requestedByUserId),
        idempotencyKey,
        sourceDigest: normalizeDigest(input.generation.sourceDigest),
        evidenceRefs: [],
        contextCapsuleId: null,
        modelProfile: input.generation.model ? String(input.generation.model) : null,
        promptVersion: input.generation.promptVersion ? String(input.generation.promptVersion) : null,
        outputSchemaVersion: 'v1',
        riskLevel: 'medium',
        proposedAction: input.proposedAction,
        proposedDiff,
        explanation: '',
        validationErrors: [],
        reviewRequired: false,
        domainArtifactType: 'ghost_draft_generation',
        domainArtifactId: generationId,
        domainStatus: 'generated',
        expiresAt: null,
    });
}

export async function createProposalForTrendPromptCache(
    prisma: any,
    input: {
        cache: TrendPromptCacheLike;
        modelProfile?: string | null;
        promptVersion?: string | null;
    },
) {
    const payload = input.cache.payload && typeof input.cache.payload === 'object'
        ? input.cache.payload as Record<string, unknown>
        : {};
    const cacheId = String(input.cache.id);
    const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
    const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs : [];
    const proposedDiff = {
        suggestions,
        query: payload.query ?? null,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        failureCode: input.cache.failureCode ?? null,
    };

    return createAiProposalArtifact(prisma, {
        taskType: 'place_prompt.trend_aware.v1',
        subjectType: 'place_prompt',
        subjectId: cacheId,
        createdByUserId: normalizeOptionalNumber(input.cache.requestedByUserId),
        idempotencyKey: `place_prompt.trend_aware.v1:trend_prompt_cache:${cacheId}`,
        sourceDigest: normalizeDigest(input.cache.sourceDigest),
        evidenceRefs,
        contextCapsuleId: typeof input.cache.contextCapsuleId === 'string'
            ? input.cache.contextCapsuleId
            : null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: 'v1',
        riskLevel: 'low',
        proposedAction: 'place_prompt.apply_to_create_circle_form',
        proposedDiff,
        explanation: 'Trend-aware place prompt suggestion for local create-circle form fields.',
        validationErrors: [],
        reviewRequired: false,
        domainArtifactType: 'trend_prompt_cache',
        domainArtifactId: cacheId,
        domainStatus: String(input.cache.status || payload.status || 'ready'),
        applyTarget: {
            type: 'frontend_local_form',
            owner: 'frontend/src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx',
        },
        expiresAt: input.cache.expiresAt ?? (typeof payload.expiresAt === 'string' ? payload.expiresAt : null),
    });
}

export async function createProposalForConfigurationCopilot(
    prisma: any,
    input: ConfigurationProposalLike,
) {
    const idempotencyKey = [
        'configuration.copilot.v1',
        input.subjectType,
        input.subjectId,
        input.contextCapsuleId || normalizeDigest(input.sourceDigest),
    ].join(':');
    const proposedAction = input.entrypoint === 'create_circle'
        ? 'configuration.apply_to_create_circle_form'
        : input.entrypoint === 'fork_create'
            ? 'configuration.apply_to_fork_create_form'
            : 'configuration.apply_to_circle_settings_form';

    return createAiProposalArtifact(prisma, {
        taskType: 'configuration.copilot.v1',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        createdByUserId: normalizeOptionalNumber(input.createdByUserId),
        idempotencyKey,
        sourceDigest: normalizeDigest(input.sourceDigest),
        evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
        contextCapsuleId: input.contextCapsuleId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: 'v1',
        riskLevel: input.proposal.riskLevel || 'low',
        proposedAction,
        proposedDiff: {
            reason: input.proposal.reason,
            riskLevel: input.proposal.riskLevel,
            affectedFields: input.proposal.affectedFields,
            configDiff: input.proposal.configDiff,
        },
        explanation: input.proposal.reason,
        validationErrors: Array.isArray(input.proposal.validationErrors)
            ? input.proposal.validationErrors
            : [],
        reviewRequired: input.proposal.riskLevel === 'high',
        domainArtifactType: 'configuration_copilot',
        domainArtifactId: input.contextCapsuleId ?? input.subjectId,
        domainStatus: 'proposal_ready',
        applyTarget: {
            type: 'frontend_local_form',
            owner: input.entrypoint === 'create_circle'
                ? 'frontend/src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx'
                : input.entrypoint === 'fork_create'
                    ? 'frontend/src/components/circle/ForkCreateSheet/ForkCreateSheet.tsx'
                    : 'frontend/src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx',
        },
        expiresAt: input.expiresAt ?? null,
    });
}

export async function createProposalForSettingsTextAssist(
    prisma: any,
    input: SettingsTextSuggestionLike,
) {
    const idempotencyKey = [
        'settings.field_text_suggestion.v1',
        input.subjectType,
        input.subjectId,
        input.field,
        input.contextCapsuleId || normalizeDigest(input.sourceDigest),
    ].join(':');

    return createAiProposalArtifact(prisma, {
        taskType: 'settings.field_text_suggestion.v1',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        createdByUserId: normalizeOptionalNumber(input.createdByUserId),
        idempotencyKey,
        sourceDigest: normalizeDigest(input.sourceDigest),
        evidenceRefs: [],
        contextCapsuleId: input.contextCapsuleId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: 'v1',
        riskLevel: 'low',
        proposedAction: 'settings_text.apply_local_suggestion',
        proposedDiff: {
            field: input.proposal.field,
            previousValue: input.proposal.previousValue,
            suggestedValue: input.proposal.suggestedValue,
            reason: input.proposal.reason,
            confidence: input.proposal.confidence,
            requiredPermission: input.proposal.requiredPermission,
        },
        explanation: input.proposal.reason,
        validationErrors: Array.isArray(input.proposal.validationErrors)
            ? input.proposal.validationErrors
            : [],
        reviewRequired: false,
        domainArtifactType: 'settings_text_assist',
        domainArtifactId: input.contextCapsuleId ?? `${input.subjectType}:${input.subjectId}:${input.field}`,
        domainStatus: 'proposal_ready',
        applyTarget: {
            type: 'frontend_local_form',
            owner: 'frontend/src/components/alcheme/FieldAssist/FieldAssistInline.tsx',
        },
        expiresAt: input.expiresAt ?? null,
    });
}

export async function createProposalForStyleAdvisor(
    prisma: any,
    input: StyleProposalLike,
) {
    const idempotencyKey = [
        'style.life_feel_advisor.v1',
        input.subjectType,
        input.subjectId,
        input.contextCapsuleId || normalizeDigest(input.sourceDigest),
    ].join(':');
	    const proposedAction = input.scope === 'circle'
	        ? 'style.preview_circle_style'
	        : input.scope === 'session_preview'
	            ? 'style.preview_session'
	            : 'style.preview_personal_preferences';

    return createAiProposalArtifact(prisma, {
        taskType: 'style.life_feel_advisor.v1',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        createdByUserId: normalizeOptionalNumber(input.createdByUserId),
        idempotencyKey,
        sourceDigest: normalizeDigest(input.sourceDigest),
        evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
        contextCapsuleId: input.contextCapsuleId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: 'v1',
        riskLevel: input.proposal.riskLevel || 'low',
        proposedAction,
        proposedDiff: {
            scope: input.scope,
            reason: input.proposal.reason,
            riskLevel: input.proposal.riskLevel,
            tokenPolicyVersion: input.proposal.tokenPolicyVersion,
            styleIntent: input.proposal.styleIntent,
            tone: input.proposal.tone,
            tokenSelections: input.proposal.tokenSelections,
            tokenDiff: input.proposal.tokenDiff,
            lifeFeelInputs: input.proposal.lifeFeelInputs,
            previewState: input.proposal.previewState,
            accessibilityChecks: input.proposal.accessibilityChecks,
        },
        explanation: input.proposal.reason,
        validationErrors: Array.isArray(input.proposal.validationErrors)
            ? input.proposal.validationErrors
            : [],
        reviewRequired: input.proposal.riskLevel === 'high',
        domainArtifactType: 'style_life_feel_advisor',
        domainArtifactId: input.contextCapsuleId ?? input.subjectId,
        domainStatus: 'proposal_ready',
	        applyTarget: input.scope === 'session_preview'
	            ? null
	            : {
	                type: input.scope === 'circle'
	                    ? 'circle_style_preferences'
	                    : 'user_style_preferences',
	                owner: input.scope === 'circle'
	                    ? 'frontend/src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx'
	                    : 'frontend/src/components/profile/ProfileSettingsSheet/ProfileSettingsSheet.tsx',
	            },
        expiresAt: input.expiresAt ?? null,
    });
}

export async function createAiProposalArtifact(
    prisma: any,
    input: GenericProposalArtifactInput,
) {
    const policy = await evaluateAiPolicyGate({
        proposedAction: input.proposedAction,
    });
    if (policy.decision !== 'allow') {
        throw new Error(`ai_proposal_action_denied:${policy.reasonCode}`);
    }

    const diffValidation = validateProposalDiff(input.proposedDiff);
    if (!diffValidation.ok) {
        throw new Error(`ai_proposal_forbidden_fields:${diffValidation.forbiddenFields.join(',')}`);
    }

    const create = {
        id: input.id ?? `proposal_${digest(`${input.taskType}:${input.idempotencyKey}`).slice(0, 24)}`,
        taskType: input.taskType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: 'ready',
        createdByUserId: normalizeOptionalNumber(input.createdByUserId),
        acceptedByUserId: null,
        rejectedByUserId: null,
        appliedByUserId: null,
        idempotencyKey: input.idempotencyKey,
        sourceDigest: normalizeDigest(input.sourceDigest),
        evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
        contextCapsuleId: input.contextCapsuleId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: input.outputSchemaVersion ?? 'v1',
        riskLevel: input.riskLevel ?? 'medium',
        proposedAction: input.proposedAction,
        proposedDiff: input.proposedDiff,
        explanation: input.explanation ?? '',
        validationErrors: Array.isArray(input.validationErrors) ? input.validationErrors : [],
        reviewRequired: Boolean(input.reviewRequired),
        domainArtifactType: input.domainArtifactType ?? null,
        domainArtifactId: input.domainArtifactId === null || input.domainArtifactId === undefined
            ? null
            : String(input.domainArtifactId),
        domainStatus: input.domainStatus ?? null,
        applyTarget: input.applyTarget ?? null,
        applyReceiptId: null,
        rollbackRef: null,
        expiresAt: normalizeDateInput(input.expiresAt),
    };

    const updated = {
        status: create.status,
        evidenceRefs: create.evidenceRefs,
        contextCapsuleId: create.contextCapsuleId,
        modelProfile: create.modelProfile,
        promptVersion: create.promptVersion,
        outputSchemaVersion: create.outputSchemaVersion,
        riskLevel: create.riskLevel,
        proposedAction: create.proposedAction,
        proposedDiff: create.proposedDiff,
        explanation: create.explanation,
        validationErrors: create.validationErrors,
        reviewRequired: create.reviewRequired,
        domainStatus: create.domainStatus,
        expiresAt: create.expiresAt,
    };

    if (typeof prisma?.aiProposalArtifact?.upsert === 'function') {
        return prisma.aiProposalArtifact.upsert({
            where: {
                taskType_idempotencyKey: {
                    taskType: input.taskType,
                    idempotencyKey: input.idempotencyKey,
                },
            },
            create,
            update: updated,
        });
    }

    return create;
}

function buildProposedDiff(generation: GhostDraftGenerationLike): Record<string, unknown> {
    if (Array.isArray(generation.suggestions)) {
        return {
            suggestions: generation.suggestions,
        };
    }
    const parsed = parseDraftText(generation.draftText);
    return {
        suggestions: parsed?.suggestions ?? [],
    };
}

function parseDraftText(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'string') return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, any>
            : null;
    } catch {
        return null;
    }
}

function normalizeOptionalNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDigest(value: unknown): string {
    const text = typeof value === 'string' ? value : '';
    return /^[a-f0-9]{64}$/i.test(text) ? text : digest(text || 'missing_source_digest');
}

function normalizeDateInput(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
