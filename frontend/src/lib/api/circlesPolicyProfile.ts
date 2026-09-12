import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import { authenticatedApiFetchJson } from '@/lib/api/fetch';
import {
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
    normalizeDraftPromptEnvelopePayload,
    normalizePolicyProfileEnvelopePayload,
} from '@/lib/circles/settingsEnvelope';

export type DraftReviewEntryMode = 'auto_only' | 'manual_only' | 'auto_or_manual';
export type GovernanceRole = 'Owner' | 'Admin' | 'Moderator' | 'Elder' | 'Member' | 'Initiate';
export type ForkThresholdMode = 'contribution_threshold';
export type ForkInheritancePrefillSource = 'lv0_default_profile';
export type ForkKnowledgeLineageInheritance = 'upstream_until_fork_node';

export interface CircleDraftLifecycleTemplate {
    templateId: 'fast_deposition' | 'standard_collaboration' | 'deep_research';
    draftGenerationVotingMinutes: number;
    draftingWindowMinutes: number;
    reviewWindowMinutes: number;
    maxRevisionRounds: number;
    reviewEntryMode: DraftReviewEntryMode;
}

export interface CircleDraftWorkflowPolicy {
    createIssueMinRole: GovernanceRole;
    followupIssueMinRole: GovernanceRole;
    reviewIssueMinRole: GovernanceRole;
    retagIssueMinRole: GovernanceRole;
    applyIssueMinRole: GovernanceRole;
    manualEndDraftingMinRole: GovernanceRole;
    advanceFromReviewMinRole: GovernanceRole;
    enterCrystallizationMinRole: GovernanceRole;
    allowAuthorWithdrawBeforeReview: boolean;
    allowModeratorRetagIssue: boolean;
}

export interface CircleForkPolicy {
    enabled: boolean;
    thresholdMode: ForkThresholdMode;
    minimumContributions: number;
    minimumRole: GovernanceRole;
    requiresGovernanceVote: boolean;
    inheritancePrefillSource: ForkInheritancePrefillSource;
    knowledgeLineageInheritance: ForkKnowledgeLineageInheritance;
}

export interface CirclePolicyProfilePayload {
    circleId: number;
    profile: {
        draftLifecycleTemplate: CircleDraftLifecycleTemplate;
        draftWorkflowPolicy: CircleDraftWorkflowPolicy;
        forkPolicy: CircleForkPolicy;
    };
}

export type CirclePolicyProfileUpdateResult =
    | ({ status: 'executed' } & CirclePolicyProfilePayload)
    | {
        status: 'requires_governance';
        actionType: string;
        request: {
            id?: string | null;
        };
    };

export interface CircleDraftLifecycleTemplatePatch {
    draftingWindowMinutes: number;
    reviewWindowMinutes: number;
    maxRevisionRounds: number;
    reviewEntryMode: DraftReviewEntryMode;
}

export const DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY: CircleDraftWorkflowPolicy = {
    createIssueMinRole: 'Member',
    followupIssueMinRole: 'Member',
    reviewIssueMinRole: 'Moderator',
    retagIssueMinRole: 'Moderator',
    applyIssueMinRole: 'Admin',
    manualEndDraftingMinRole: 'Moderator',
    advanceFromReviewMinRole: 'Admin',
    enterCrystallizationMinRole: 'Moderator',
    allowAuthorWithdrawBeforeReview: true,
    allowModeratorRetagIssue: true,
};

export const DEFAULT_CIRCLE_FORK_POLICY: CircleForkPolicy = {
    enabled: true,
    thresholdMode: 'contribution_threshold',
    minimumContributions: 1,
    minimumRole: 'Member',
    requiresGovernanceVote: false,
    inheritancePrefillSource: 'lv0_default_profile',
    knowledgeLineageInheritance: 'upstream_until_fork_node',
};

export type CircleDraftWorkflowPolicyPatch = Partial<CircleDraftWorkflowPolicy>;
export interface CirclePolicyProfileUpdateAuth extends CircleSettingsEnvelopeAuth {}

export type CircleDraftPromptScope = 'knowledge_draft' | 'governance_draft';
export type CircleDraftPromptMode = 'system_default' | 'circle_custom';

export interface CircleDraftPromptVersionReadback {
    id: string;
    version: number;
    promptDigest: string;
    schemaRef: string;
    systemPromptAsset: string;
    systemPromptVersion: string;
    approvalRef: string;
    approvedByPubkey: string;
    approvedAt: string;
    keyVersion: string;
    selectionCount: number;
    lastSelectedAt: string | null;
}

export interface CircleDraftPromptEventReadback {
    id: string;
    eventType: 'custom_selected' | 'system_default_selected' | 'prompt_decrypted';
    selectionSequence: number | null;
    promptVersionId: string;
    promptVersion: number | null;
    approvalRef: string | null;
    actorUserId: number | null;
    actorPubkey: string | null;
    purpose: string;
    createdAt: string;
}

export interface CircleDraftPromptScopeReadback {
    scope: CircleDraftPromptScope;
    mode: CircleDraftPromptMode;
    systemPromptAsset: string;
    systemPromptVersion: string;
    schemaRef: string;
    activeVersion: CircleDraftPromptVersionReadback | null;
    promptBody: string | null;
    history: CircleDraftPromptVersionReadback[];
    selectionSequence: number;
    selectionHistory: CircleDraftPromptEventReadback[];
    recentDecryptAudit: CircleDraftPromptEventReadback[];
    customRuntimeConnected: boolean;
    currentSelectionApprovalRef: string | null;
    currentSelectionApprovedByPubkey: string | null;
    providerBoundary: {
        mode: 'builtin' | 'external';
        externalPrivateContentMode: 'deny' | 'allow';
        runtimeRole: string;
        plaintextDuringAuthorizedRun: true;
    };
}

function normalizeGovernanceRole(value: unknown, fallback: GovernanceRole): GovernanceRole {
    const normalized = String(value || '').trim();
    if (
        normalized === 'Owner'
        || normalized === 'Admin'
        || normalized === 'Moderator'
        || normalized === 'Elder'
        || normalized === 'Member'
        || normalized === 'Initiate'
    ) {
        return normalized;
    }
    return fallback;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return fallback;
}

function normalizeReviewEntryMode(value: unknown): DraftReviewEntryMode {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto_only') return 'auto_only';
    if (normalized === 'manual_only') return 'manual_only';
    return 'auto_or_manual';
}

function normalizeDraftLifecycleTemplate(value: any): CircleDraftLifecycleTemplate {
    return {
        templateId: value?.templateId === 'standard_collaboration'
            ? 'standard_collaboration'
            : value?.templateId === 'deep_research'
                ? 'deep_research'
                : 'fast_deposition',
        draftGenerationVotingMinutes: normalizePositiveInt(value?.draftGenerationVotingMinutes, 10),
        draftingWindowMinutes: normalizePositiveInt(value?.draftingWindowMinutes, 30),
        reviewWindowMinutes: normalizePositiveInt(value?.reviewWindowMinutes, 240),
        maxRevisionRounds: normalizePositiveInt(value?.maxRevisionRounds, 1),
        reviewEntryMode: normalizeReviewEntryMode(value?.reviewEntryMode),
    };
}

function normalizeDraftWorkflowPolicy(value: any): CircleDraftWorkflowPolicy {
    return {
        createIssueMinRole: normalizeGovernanceRole(value?.createIssueMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.createIssueMinRole),
        followupIssueMinRole: normalizeGovernanceRole(value?.followupIssueMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.followupIssueMinRole),
        reviewIssueMinRole: normalizeGovernanceRole(value?.reviewIssueMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.reviewIssueMinRole),
        retagIssueMinRole: normalizeGovernanceRole(value?.retagIssueMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.retagIssueMinRole),
        applyIssueMinRole: normalizeGovernanceRole(value?.applyIssueMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.applyIssueMinRole),
        manualEndDraftingMinRole: normalizeGovernanceRole(value?.manualEndDraftingMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.manualEndDraftingMinRole),
        advanceFromReviewMinRole: normalizeGovernanceRole(value?.advanceFromReviewMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.advanceFromReviewMinRole),
        enterCrystallizationMinRole: normalizeGovernanceRole(value?.enterCrystallizationMinRole, DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.enterCrystallizationMinRole),
        allowAuthorWithdrawBeforeReview: Boolean(value?.allowAuthorWithdrawBeforeReview ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowAuthorWithdrawBeforeReview),
        allowModeratorRetagIssue: Boolean(value?.allowModeratorRetagIssue ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowModeratorRetagIssue),
    };
}

function normalizeForkPolicy(value: any): CircleForkPolicy {
    return {
        enabled: Boolean(value?.enabled ?? DEFAULT_CIRCLE_FORK_POLICY.enabled),
        thresholdMode: value?.thresholdMode === 'contribution_threshold'
            ? 'contribution_threshold'
            : DEFAULT_CIRCLE_FORK_POLICY.thresholdMode,
        minimumContributions: normalizePositiveInt(
            value?.minimumContributions,
            DEFAULT_CIRCLE_FORK_POLICY.minimumContributions,
        ),
        minimumRole: normalizeGovernanceRole(
            value?.minimumRole,
            DEFAULT_CIRCLE_FORK_POLICY.minimumRole,
        ),
        requiresGovernanceVote: Boolean(
            value?.requiresGovernanceVote ?? DEFAULT_CIRCLE_FORK_POLICY.requiresGovernanceVote,
        ),
        inheritancePrefillSource: value?.inheritancePrefillSource === 'lv0_default_profile'
            ? 'lv0_default_profile'
            : DEFAULT_CIRCLE_FORK_POLICY.inheritancePrefillSource,
        knowledgeLineageInheritance: value?.knowledgeLineageInheritance === 'upstream_until_fork_node'
            ? 'upstream_until_fork_node'
            : DEFAULT_CIRCLE_FORK_POLICY.knowledgeLineageInheritance,
    };
}

async function fetchJsonOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
    return authenticatedApiFetchJson(input, { init });
}

export async function fetchCirclePolicyProfile(
    circleId: number,
    signal?: AbortSignal,
): Promise<CirclePolicyProfilePayload> {
    const route = await resolveNodeRoute('policy_profile');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/policy/circles/${circleId}/profile`, {
        method: 'GET',
        cache: 'no-store',
        signal,
    });

    return {
        circleId: Number(data?.circleId || circleId),
        profile: {
            draftLifecycleTemplate: normalizeDraftLifecycleTemplate(data?.profile?.draftLifecycleTemplate),
            draftWorkflowPolicy: normalizeDraftWorkflowPolicy(data?.profile?.draftWorkflowPolicy),
            forkPolicy: normalizeForkPolicy(data?.profile?.forkPolicy),
        },
    };
}

export async function updateCircleDraftLifecycleTemplate(
    circleId: number,
    patch: CircleDraftLifecycleTemplatePatch,
    auth: CirclePolicyProfileUpdateAuth,
): Promise<CirclePolicyProfileUpdateResult> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle settings auth missing');
    }
    const normalizedTemplate = {
        reviewEntryMode: normalizeReviewEntryMode(patch.reviewEntryMode),
        draftingWindowMinutes: normalizePositiveInt(patch.draftingWindowMinutes, 30),
        reviewWindowMinutes: normalizePositiveInt(patch.reviewWindowMinutes, 240),
        maxRevisionRounds: normalizePositiveInt(patch.maxRevisionRounds, 1),
    };
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'policy_profile',
        payload: normalizePolicyProfileEnvelopePayload({
            draftLifecycleTemplate: normalizedTemplate,
        }),
        auth,
    });
    const route = await resolveNodeRoute('policy_profile');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/policy/circles/${circleId}/profile`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            actorPubkey: auth.actorPubkey,
            signedMessage,
            signature,
            draftLifecycleTemplate: normalizedTemplate,
        }),
    });
    if (data?.status === 'requires_governance') {
        return {
            status: 'requires_governance',
            actionType: String(data?.actionType || 'circle.policy.draft_lifecycle.update'),
            request: {
                id: typeof data?.request?.id === 'string' ? data.request.id : null,
            },
        };
    }

    return {
        status: 'executed',
        circleId: Number(data?.circleId || circleId),
        profile: {
            draftLifecycleTemplate: normalizeDraftLifecycleTemplate(data?.profile?.draftLifecycleTemplate),
            draftWorkflowPolicy: normalizeDraftWorkflowPolicy(data?.profile?.draftWorkflowPolicy),
            forkPolicy: normalizeForkPolicy(data?.profile?.forkPolicy),
        },
    };
}

export async function updateCircleDraftWorkflowPolicy(
    circleId: number,
    patch: CircleDraftWorkflowPolicyPatch,
    auth: CirclePolicyProfileUpdateAuth,
): Promise<CirclePolicyProfileUpdateResult> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle settings auth missing');
    }
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'policy_profile',
        payload: normalizePolicyProfileEnvelopePayload({
            draftWorkflowPolicy: {
                ...patch,
            },
        }),
        auth,
    });
    const route = await resolveNodeRoute('policy_profile');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/policy/circles/${circleId}/profile`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            actorPubkey: auth.actorPubkey,
            signedMessage,
            signature,
            draftWorkflowPolicy: {
                ...patch,
            },
        }),
    });
    if (data?.status === 'requires_governance') {
        return {
            status: 'requires_governance',
            actionType: String(data?.actionType || 'circle.policy.profile.update'),
            request: {
                id: typeof data?.request?.id === 'string' ? data.request.id : null,
            },
        };
    }

    return {
        status: 'executed',
        circleId: Number(data?.circleId || circleId),
        profile: {
            draftLifecycleTemplate: normalizeDraftLifecycleTemplate(data?.profile?.draftLifecycleTemplate),
            draftWorkflowPolicy: normalizeDraftWorkflowPolicy(data?.profile?.draftWorkflowPolicy),
            forkPolicy: normalizeForkPolicy(data?.profile?.forkPolicy),
        },
    };
}

function normalizeDraftPromptVersion(value: any): CircleDraftPromptVersionReadback | null {
    if (!value || typeof value !== 'object') return null;
    const version = Number(value.version);
    if (!value.id || !Number.isSafeInteger(version) || version <= 0 || !value.promptDigest) return null;
    return {
        id: String(value.id),
        version,
        promptDigest: String(value.promptDigest),
        schemaRef: String(value.schemaRef || ''),
        systemPromptAsset: String(value.systemPromptAsset || ''),
        systemPromptVersion: String(value.systemPromptVersion || ''),
        approvalRef: String(value.approvalRef || ''),
        approvedByPubkey: String(value.approvedByPubkey || ''),
        approvedAt: String(value.approvedAt || ''),
        keyVersion: String(value.keyVersion || ''),
        selectionCount: Math.max(0, Number(value.selectionCount || 0)),
        lastSelectedAt: typeof value.lastSelectedAt === 'string' ? value.lastSelectedAt : null,
    };
}

function normalizeDraftPromptEvent(value: any): CircleDraftPromptEventReadback | null {
    const eventType = value?.eventType === 'custom_selected'
        || value?.eventType === 'system_default_selected'
        || value?.eventType === 'prompt_decrypted'
        ? value.eventType
        : null;
    if (!value?.id || !eventType || !value?.promptVersionId) return null;
    const selectionSequence = value.selectionSequence === null
        ? null
        : Number(value.selectionSequence);
    return {
        id: String(value.id),
        eventType,
        selectionSequence: Number.isSafeInteger(selectionSequence) ? selectionSequence : null,
        promptVersionId: String(value.promptVersionId),
        promptVersion: value.promptVersion !== null && Number.isSafeInteger(Number(value.promptVersion))
            ? Number(value.promptVersion)
            : null,
        approvalRef: typeof value.approvalRef === 'string' ? value.approvalRef : null,
        actorUserId: value.actorUserId !== null && Number.isSafeInteger(Number(value.actorUserId))
            ? Number(value.actorUserId)
            : null,
        actorPubkey: typeof value.actorPubkey === 'string' ? value.actorPubkey : null,
        purpose: String(value.purpose || ''),
        createdAt: String(value.createdAt || ''),
    };
}

function normalizeDraftPromptScope(value: any): CircleDraftPromptScopeReadback | null {
    const scope = value?.scope === 'knowledge_draft'
        ? 'knowledge_draft'
        : value?.scope === 'governance_draft'
            ? 'governance_draft'
            : null;
    if (!scope) return null;
    const mode = value?.mode === 'circle_custom' ? 'circle_custom' : 'system_default';
    return {
        scope,
        mode,
        systemPromptAsset: String(value?.systemPromptAsset || ''),
        systemPromptVersion: String(value?.systemPromptVersion || ''),
        schemaRef: String(value?.schemaRef || ''),
        activeVersion: normalizeDraftPromptVersion(value?.activeVersion),
        promptBody: typeof value?.promptBody === 'string' ? value.promptBody : null,
        history: Array.isArray(value?.history)
            ? value.history.map(normalizeDraftPromptVersion).filter(Boolean) as CircleDraftPromptVersionReadback[]
            : [],
        selectionSequence: Math.max(0, Number(value?.selectionSequence || 0)),
        selectionHistory: Array.isArray(value?.selectionHistory)
            ? value.selectionHistory.map(normalizeDraftPromptEvent).filter(Boolean) as CircleDraftPromptEventReadback[]
            : [],
        recentDecryptAudit: Array.isArray(value?.recentDecryptAudit)
            ? value.recentDecryptAudit.map(normalizeDraftPromptEvent).filter(Boolean) as CircleDraftPromptEventReadback[]
            : [],
        customRuntimeConnected: value?.customRuntimeConnected === true,
        currentSelectionApprovalRef: typeof value?.currentSelectionApprovalRef === 'string'
            ? value.currentSelectionApprovalRef
            : null,
        currentSelectionApprovedByPubkey: typeof value?.currentSelectionApprovedByPubkey === 'string'
            ? value.currentSelectionApprovedByPubkey
            : null,
        providerBoundary: {
            mode: value?.providerBoundary?.mode === 'external' ? 'external' : 'builtin',
            externalPrivateContentMode: value?.providerBoundary?.externalPrivateContentMode === 'allow'
                ? 'allow'
                : 'deny',
            runtimeRole: String(value?.providerBoundary?.runtimeRole || 'unknown'),
            plaintextDuringAuthorizedRun: true,
        },
    };
}

export async function fetchCircleDraftPrompts(
    circleId: number,
    signal?: AbortSignal,
): Promise<CircleDraftPromptScopeReadback[]> {
    const route = await resolveNodeRoute('policy_profile');
    const data = await fetchJsonOrThrow(`${route.urlBase}/api/v1/policy/circles/${circleId}/draft-prompts`, {
        method: 'GET',
        cache: 'no-store',
        signal,
    });
    return Array.isArray(data?.scopes)
        ? data.scopes.map(normalizeDraftPromptScope).filter(Boolean) as CircleDraftPromptScopeReadback[]
        : [];
}

export async function updateCircleDraftPrompt(
    circleId: number,
    input: {
        scope: CircleDraftPromptScope;
        mode: CircleDraftPromptMode;
        promptBody?: string;
        version?: number;
        promptDigest?: string;
    },
    auth: CirclePolicyProfileUpdateAuth,
    currentPrompt: CircleDraftPromptScopeReadback,
): Promise<CircleDraftPromptScopeReadback> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle settings auth missing');
    }
    if (currentPrompt.scope !== input.scope) {
        throw new Error('circle_draft_prompt_scope_mismatch');
    }
    const promptBody = input.mode === 'circle_custom' && input.promptBody !== undefined
        ? String(input.promptBody || '').replace(/\r\n?/g, '\n').trim()
        : undefined;
    const promptDigest = promptBody
        ? Array.from(new Uint8Array(await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(promptBody),
        ))).map((value) => value.toString(16).padStart(2, '0')).join('')
        : input.mode === 'circle_custom'
            ? String(input.promptDigest || '').trim().toLowerCase()
            : currentPrompt.activeVersion?.promptDigest ?? null;
    const version = input.mode === 'circle_custom'
        ? promptBody
            ? Math.max(0, ...currentPrompt.history.map((entry) => entry.version)) + 1
            : Number(input.version || 0)
        : currentPrompt.activeVersion?.version ?? null;
    const payload = normalizeDraftPromptEnvelopePayload({
        ...input,
        ...(promptBody ? { promptBody } : {}),
        version,
        promptDigest,
        schemaRef: currentPrompt.schemaRef,
        systemPromptVersion: currentPrompt.systemPromptVersion,
    });
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'draft_prompt',
        payload,
        auth,
    });
    const route = await resolveNodeRoute('policy_profile');
    const data = await fetchJsonOrThrow(`${route.urlBase}/api/v1/policy/circles/${circleId}/draft-prompts/${input.scope}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            actorPubkey: auth.actorPubkey,
            signedMessage,
            signature,
            ...payload,
        }),
    });
    const prompt = normalizeDraftPromptScope(data?.prompt);
    if (!prompt) throw new Error('circle_draft_prompt_readback_invalid');
    return prompt;
}
