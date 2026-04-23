import { resolveNodeRoute } from '@/lib/config/nodeRouting';
import {
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
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
    const response = await fetch(input, init);
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${response.status} ${body}`);
    }
    return response.json();
}

export async function fetchCirclePolicyProfile(circleId: number): Promise<CirclePolicyProfilePayload> {
    const route = await resolveNodeRoute('policy_profile');
    const baseUrl = route.urlBase;
    const data = await fetchJsonOrThrow(`${baseUrl}/api/v1/policy/circles/${circleId}/profile`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
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
): Promise<CirclePolicyProfilePayload> {
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

    return {
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
): Promise<CirclePolicyProfilePayload> {
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

    return {
        circleId: Number(data?.circleId || circleId),
        profile: {
            draftLifecycleTemplate: normalizeDraftLifecycleTemplate(data?.profile?.draftLifecycleTemplate),
            draftWorkflowPolicy: normalizeDraftWorkflowPolicy(data?.profile?.draftWorkflowPolicy),
            forkPolicy: normalizeForkPolicy(data?.profile?.forkPolicy),
        },
    };
}
