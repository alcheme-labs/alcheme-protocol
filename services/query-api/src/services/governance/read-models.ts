import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveCirclePolicyProfile } from '../policy/profile';
import type {
    CandidateGenerationGovernanceReadModel,
    CirclePolicyProfile,
    CrystallizationGovernanceReadModel,
    DraftCandidateGovernanceStatus,
    DraftCrystallizationGovernanceStatus,
    ForkBaselineResolvedView,
    ForkThresholdResolvedView,
    GovernanceActionType,
    GovernanceRequestState,
    GovernanceRequestSummary,
    GovernanceRole,
    GovernanceSignalSummary,
    InheritanceResolvedView,
    Team04ForkResolvedInputs,
} from '../policy/types';

interface GovernanceRequestRow {
    requestId: string;
    actionType: string;
    targetType: string;
    targetRef: string | number;
    state: string;
    proposerPubkey: string;
    payload: unknown;
    openedAt: Date | null;
    expiresAt: Date | null;
    resolvedAt: Date | null;
    executionStatus: string | null;
    executionError: string | null;
}

interface GovernanceSignalRow {
    requestId: string | number;
    actorPubkey: string | null;
    value: string;
    evidence: unknown;
    createdAt: Date;
}

const DEFAULT_MANAGER_ROLES: GovernanceRole[] = ['Owner', 'Admin', 'Moderator'];

function normalizeRequestState(raw: unknown): GovernanceRequestState {
    const status = String(raw || '').trim().toLowerCase();
    if (status === 'active') return 'active';
    if (status === 'accepted') return 'accepted';
    if (status === 'rejected') return 'rejected';
    if (status === 'expired') return 'expired';
    if (status === 'cancelled') return 'cancelled';
    return 'active';
}

function normalizeSignalValue(raw: unknown): 'approve' | 'reject' {
    const vote = String(raw || '').trim().toLowerCase();
    if (vote === 'reject') return 'reject';
    return 'approve';
}

function toRecord(raw: unknown): Record<string, unknown> | null {
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return null;
        }
    }
    return null;
}

async function loadLatestGovernanceRequest(
    prisma: PrismaClient,
    input: {
        circleId: number;
        actionType: GovernanceActionType;
        targetType?: string;
        targetRef?: string | number;
    },
): Promise<GovernanceRequestSummary | null> {
    const targetTypeFilter = input.targetType
        ? Prisma.sql`AND request.target_type = ${input.targetType}`
        : Prisma.empty;
    const targetRefFilter = input.targetRef !== undefined && input.targetRef !== null
        ? Prisma.sql`AND request.target_ref::text = ${String(input.targetRef)}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<GovernanceRequestRow[]>(Prisma.sql`
        SELECT
            request.id AS "requestId",
            request.action_type AS "actionType",
            request.target_type AS "targetType",
            request.target_ref AS "targetRef",
            request.state AS "state",
            request.proposer_pubkey AS "proposerPubkey",
            request.payload AS "payload",
            request.opened_at AS "openedAt",
            request.expires_at AS "expiresAt",
            request.resolved_at AS "resolvedAt",
            receipt.execution_status AS "executionStatus",
            receipt.error_code AS "executionError"
        FROM governance_requests request
        LEFT JOIN LATERAL (
            SELECT execution_status, error_code
            FROM governance_execution_receipts
            WHERE request_id = request.id
            ORDER BY executed_at DESC
            LIMIT 1
        ) receipt ON TRUE
        WHERE request.action_type = ${input.actionType}
          AND (
            request.scope_ref = ${String(input.circleId)}
            OR request.target_ref = ${String(input.circleId)}
            OR request.payload ->> 'targetCircleId' = ${String(input.circleId)}
            OR request.payload ->> 'circleId' = ${String(input.circleId)}
          )
          ${targetTypeFilter}
          ${targetRefFilter}
        ORDER BY request.opened_at DESC
        LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    const executionStatus = String(row.executionStatus || '').trim();

    return {
        requestId: String(row.requestId),
        actionType: input.actionType,
        targetType: String(row.targetType || ''),
        targetRef: String(row.targetRef || ''),
        state: normalizeRequestState(row.state),
        proposerPubkey: String(row.proposerPubkey || ''),
        payload: toRecord(row.payload),
        openedAt: row.openedAt ?? null,
        expiresAt: row.expiresAt ?? null,
        resolvedAt: row.resolvedAt ?? null,
        executionStatus: executionStatus === 'executed' || executionStatus === 'failed' || executionStatus === 'skipped'
            ? executionStatus
            : null,
        executionError: row.executionError ?? null,
    };
}

async function loadGovernanceSignals(
    prisma: PrismaClient,
    requestId: string,
): Promise<GovernanceSignalSummary[]> {
    const rows = await prisma.$queryRaw<GovernanceSignalRow[]>`
        SELECT
            request_id AS "requestId",
            actor_pubkey AS "actorPubkey",
            value AS "value",
            evidence AS "evidence",
            created_at AS "createdAt"
        FROM governance_signals
        WHERE request_id::text = ${requestId}
        ORDER BY created_at ASC
    `;
    return rows.map((row) => ({
        requestId: String(row.requestId),
        actorPubkey: row.actorPubkey ?? null,
        value: normalizeSignalValue(row.value),
        evidence: toRecord(row.evidence),
        createdAt: row.createdAt,
    }));
}

export function mapDraftGenerationOutcomeFromRequest(
    request: GovernanceRequestSummary,
): DraftCandidateGovernanceStatus {
    if (request.executionStatus === 'failed') return 'generation_failed';
    if (request.executionStatus === 'executed') return 'accepted';
    if (request.state === 'accepted') return 'pending';
    if (request.state === 'rejected') return 'rejected';
    if (request.state === 'expired') return 'expired';
    if (request.state === 'cancelled') return 'cancelled';
    return 'proposal_active';
}

export function mapCrystallizationOutcomeFromRequest(
    request: GovernanceRequestSummary,
): DraftCrystallizationGovernanceStatus {
    if (request.executionStatus === 'failed') return 'crystallization_failed';
    if (request.executionStatus === 'executed') return 'crystallized';
    if (request.state === 'accepted') return 'crystallization_active';
    if (request.state === 'rejected' || request.state === 'expired' || request.state === 'cancelled') return 'drafting';
    return 'crystallization_active';
}

export function buildCandidateGenerationGovernanceReadModel(input: {
    circleId: number;
    candidateId: string | null;
    policyProfile: CirclePolicyProfile;
    request: GovernanceRequestSummary | null;
    signals: GovernanceSignalSummary[];
}): CandidateGenerationGovernanceReadModel {
    return {
        circleId: input.circleId,
        candidateId: input.candidateId,
        policyProfile: input.policyProfile,
        request: input.request,
        signals: input.signals,
        candidateStatus: input.request
            ? mapDraftGenerationOutcomeFromRequest(input.request)
            : 'open',
        failureRecovery: {
            failedStatus: 'generation_failed',
            canRetryExecutionRoles: DEFAULT_MANAGER_ROLES,
            retryExecutionReusesPassedProposal: true,
            canCancelRoles: DEFAULT_MANAGER_ROLES,
        },
    };
}

function buildDefaultCrystallizationPolicy(profile: CirclePolicyProfile): CrystallizationGovernanceReadModel['crystallizationPolicy'] {
    return {
        actionType: 'crystallization',
        electorateScope: 'contributors_of_current_draft',
        eligibleRoles: profile.draftGenerationPolicy.eligibleRoles,
        voteRule: 'majority_of_voters',
        thresholdValue: 1,
        quorum: null,
        timeWindowMinutes: Math.max(60, profile.draftLifecycleTemplate.reviewWindowMinutes),
    };
}

export function buildCrystallizationGovernanceReadModel(input: {
    circleId: number;
    draftPostId: number | null;
    policyProfile: CirclePolicyProfile;
    request: GovernanceRequestSummary | null;
    signals: GovernanceSignalSummary[];
}): CrystallizationGovernanceReadModel {
    return {
        circleId: input.circleId,
        draftPostId: input.draftPostId,
        policyProfile: input.policyProfile,
        crystallizationPolicy: buildDefaultCrystallizationPolicy(input.policyProfile),
        request: input.request,
        signals: input.signals,
        draftStatus: input.request
            ? mapCrystallizationOutcomeFromRequest(input.request)
            : 'drafting',
        failureRecovery: {
            failedStatus: 'crystallization_failed',
            canRetryExecutionRoles: DEFAULT_MANAGER_ROLES,
            retryExecutionReusesPassedProposal: true,
            canRollbackToReviewRoles: DEFAULT_MANAGER_ROLES,
            canArchiveRoles: DEFAULT_MANAGER_ROLES,
        },
    };
}

export function buildForkBaselineResolvedView(input: {
    circleId: number;
    policyProfile: CirclePolicyProfile;
}): ForkBaselineResolvedView {
    const inheritance = buildInheritanceResolvedView(input);

    return {
        circleId: input.circleId,
        policyProfile: input.policyProfile,
        baseline: inheritance,
        threshold: input.policyProfile.forkPolicy,
    };
}

export function buildForkThresholdResolvedView(input: {
    circleId: number;
    policyProfile: CirclePolicyProfile;
}): ForkThresholdResolvedView {
    return {
        circleId: input.circleId,
        enabled: input.policyProfile.forkPolicy.enabled,
        thresholdMode: input.policyProfile.forkPolicy.thresholdMode,
        minimumContributions: input.policyProfile.forkPolicy.minimumContributions,
        minimumRole: input.policyProfile.forkPolicy.minimumRole,
        requiresGovernanceVote: input.policyProfile.forkPolicy.requiresGovernanceVote,
    };
}

export function buildInheritanceResolvedView(input: {
    circleId: number;
    policyProfile: CirclePolicyProfile;
}): InheritanceResolvedView {
    return {
        circleId: input.circleId,
        sourceType: input.policyProfile.sourceType,
        inheritanceMode: input.policyProfile.inheritanceMode,
        localEditability: input.policyProfile.localEditability,
        inheritsFromProfileId: input.policyProfile.inheritsFromProfileId,
        inheritsFromCircleId: input.policyProfile.inheritsFromCircleId,
        lv0AppliesToFutureCirclesOnly: true,
        inheritLockedMaterializedAtCreate: true,
        runtimeLiveParentLookup: false,
    };
}

export function buildTeam04ForkResolvedInputs(input: {
    circleId: number;
    policyProfile: CirclePolicyProfile;
}): Team04ForkResolvedInputs {
    return {
        circleId: input.circleId,
        forkThresholdResolvedView: buildForkThresholdResolvedView(input),
        inheritanceResolvedView: buildInheritanceResolvedView(input),
        minimumFieldSet: {
            configVersion: input.policyProfile.configVersion,
            effectiveFrom: input.policyProfile.effectiveFrom,
            resolvedFromProfileVersion: input.policyProfile.resolvedFromProfileVersion,
            inheritancePrefillSource: input.policyProfile.forkPolicy.inheritancePrefillSource,
            knowledgeLineageInheritance: input.policyProfile.forkPolicy.knowledgeLineageInheritance,
        },
    };
}

export async function resolveCandidateGenerationGovernanceReadModel(
    prisma: PrismaClient,
    input: {
        circleId: number;
        candidateId?: string | null;
    },
): Promise<CandidateGenerationGovernanceReadModel> {
    const policyProfile = await resolveCirclePolicyProfile(prisma, input.circleId);
    const request = await loadLatestGovernanceRequest(prisma, {
        circleId: input.circleId,
        actionType: 'draft_generation',
        targetType: input.candidateId ? 'draft_candidate' : undefined,
        targetRef: input.candidateId ?? undefined,
    });
    const signals = request ? await loadGovernanceSignals(prisma, request.requestId) : [];

    return buildCandidateGenerationGovernanceReadModel({
        circleId: input.circleId,
        candidateId: input.candidateId ?? null,
        policyProfile,
        request,
        signals,
    });
}

export async function resolveCrystallizationGovernanceReadModel(
    prisma: PrismaClient,
    input: {
        circleId: number;
        draftPostId?: number | null;
    },
): Promise<CrystallizationGovernanceReadModel> {
    const policyProfile = await resolveCirclePolicyProfile(prisma, input.circleId);
    const request = await loadLatestGovernanceRequest(prisma, {
        circleId: input.circleId,
        actionType: 'crystallization',
        targetType: input.draftPostId ? 'draft_post' : undefined,
        targetRef: input.draftPostId ?? undefined,
    });
    const signals = request ? await loadGovernanceSignals(prisma, request.requestId) : [];

    return buildCrystallizationGovernanceReadModel({
        circleId: input.circleId,
        draftPostId: input.draftPostId ?? null,
        policyProfile,
        request,
        signals,
    });
}

export async function resolveForkBaselineResolvedView(
    prisma: PrismaClient,
    circleId: number,
): Promise<ForkBaselineResolvedView> {
    const policyProfile = await resolveCirclePolicyProfile(prisma, circleId);
    return buildForkBaselineResolvedView({
        circleId,
        policyProfile,
    });
}

export async function resolveForkThresholdResolvedView(
    prisma: PrismaClient,
    circleId: number,
): Promise<ForkThresholdResolvedView> {
    const policyProfile = await resolveCirclePolicyProfile(prisma, circleId);
    return buildForkThresholdResolvedView({
        circleId,
        policyProfile,
    });
}

export async function resolveInheritanceResolvedView(
    prisma: PrismaClient,
    circleId: number,
): Promise<InheritanceResolvedView> {
    const policyProfile = await resolveCirclePolicyProfile(prisma, circleId);
    return buildInheritanceResolvedView({
        circleId,
        policyProfile,
    });
}

export async function resolveTeam04ForkResolvedInputs(
    prisma: PrismaClient,
    circleId: number,
): Promise<Team04ForkResolvedInputs> {
    // Circle-level only: these resolved inputs feed the canonical Fork create surface on circle pages.
    // Knowledge detail and summary surfaces must not turn this shared contract into parallel Fork entry points.
    const policyProfile = await resolveCirclePolicyProfile(prisma, circleId);
    return buildTeam04ForkResolvedInputs({
        circleId,
        policyProfile,
    });
}
