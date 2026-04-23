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
    GovernanceProposal,
    GovernanceProposalStatus,
    GovernanceRole,
    GovernanceVote,
    GovernanceVoteDecision,
    InheritanceResolvedView,
    Team04ForkResolvedInputs,
} from '../policy/types';

interface GovernanceProposalRow {
    proposalId: string | number;
    circleId: number;
    actionType: string;
    targetType: string;
    targetId: string | number;
    targetVersion: number | null;
    status: string;
    createdBy: number | null;
    electorateScope: string | null;
    voteRule: string | null;
    thresholdValue: number | null;
    quorum: number | null;
    opensAt: Date | null;
    closesAt: Date | null;
    resolvedAt: Date | null;
    executedAt: Date | null;
    executionError: string | null;
    configSnapshot: unknown;
    createdAt: Date | null;
}

interface GovernanceVoteRow {
    proposalId: string | number;
    voterUserId: number;
    vote: string;
    reason: string | null;
    createdAt: Date;
}

const DEFAULT_MANAGER_ROLES: GovernanceRole[] = ['Owner', 'Admin', 'Moderator'];

function isMissingTableError(error: unknown, tableName: string): boolean {
    const code = (error as { code?: string } | null)?.code;
    if (code === '42P01') return true;
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes(tableName) && message.includes('does not exist');
}

function normalizeProposalStatus(raw: unknown): GovernanceProposalStatus {
    const status = String(raw || '').trim().toLowerCase();
    if (status === 'drafted') return 'drafted';
    if (status === 'active') return 'active';
    if (status === 'passed') return 'passed';
    if (status === 'rejected') return 'rejected';
    if (status === 'expired') return 'expired';
    if (status === 'executed') return 'executed';
    if (status === 'execution_failed') return 'execution_failed';
    if (status === 'cancelled') return 'cancelled';
    return 'drafted';
}

function normalizeVoteDecision(raw: unknown): GovernanceVoteDecision {
    const vote = String(raw || '').trim().toLowerCase();
    if (vote === 'reject') return 'reject';
    if (vote === 'abstain') return 'abstain';
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

async function loadLatestGovernanceProposal(
    prisma: PrismaClient,
    input: {
        circleId: number;
        actionType: GovernanceActionType;
        targetType?: string;
        targetId?: string | number;
    },
): Promise<GovernanceProposal | null> {
    try {
        const targetTypeFilter = input.targetType
            ? Prisma.sql`AND target_type = ${input.targetType}`
            : Prisma.empty;
        const targetIdFilter = input.targetId !== undefined && input.targetId !== null
            ? Prisma.sql`AND target_id::text = ${String(input.targetId)}`
            : Prisma.empty;

        const rows = await prisma.$queryRaw<GovernanceProposalRow[]>(Prisma.sql`
            SELECT
                proposal_id AS "proposalId",
                circle_id AS "circleId",
                action_type AS "actionType",
                target_type AS "targetType",
                target_id AS "targetId",
                target_version AS "targetVersion",
                status AS "status",
                created_by AS "createdBy",
                electorate_scope AS "electorateScope",
                vote_rule AS "voteRule",
                threshold_value AS "thresholdValue",
                quorum AS "quorum",
                opens_at AS "opensAt",
                closes_at AS "closesAt",
                resolved_at AS "resolvedAt",
                executed_at AS "executedAt",
                execution_error AS "executionError",
                config_snapshot AS "configSnapshot",
                created_at AS "createdAt"
            FROM governance_proposals
            WHERE circle_id = ${input.circleId}
              AND action_type = ${input.actionType}
              ${targetTypeFilter}
              ${targetIdFilter}
            ORDER BY created_at DESC
            LIMIT 1
        `);
        const row = rows[0];
        if (!row) return null;

        return {
            proposalId: String(row.proposalId),
            circleId: row.circleId,
            actionType: input.actionType,
            targetType: String(row.targetType || ''),
            targetId: String(row.targetId || ''),
            targetVersion: row.targetVersion ?? null,
            status: normalizeProposalStatus(row.status),
            createdBy: row.createdBy ?? null,
            electorateScope: (row.electorateScope as GovernanceProposal['electorateScope']) ?? null,
            voteRule: (row.voteRule as GovernanceProposal['voteRule']) ?? null,
            thresholdValue: row.thresholdValue ?? null,
            quorum: row.quorum ?? null,
            opensAt: row.opensAt ?? null,
            closesAt: row.closesAt ?? null,
            resolvedAt: row.resolvedAt ?? null,
            executedAt: row.executedAt ?? null,
            executionError: row.executionError ?? null,
            configSnapshot: toRecord(row.configSnapshot),
            createdAt: row.createdAt ?? null,
        };
    } catch (error) {
        if (isMissingTableError(error, 'governance_proposals')) {
            return null;
        }
        throw error;
    }
}

async function loadGovernanceVotes(
    prisma: PrismaClient,
    proposalId: string,
): Promise<GovernanceVote[]> {
    try {
        const rows = await prisma.$queryRaw<GovernanceVoteRow[]>`
            SELECT
                proposal_id AS "proposalId",
                voter_user_id AS "voterUserId",
                vote AS "vote",
                reason AS "reason",
                created_at AS "createdAt"
            FROM governance_votes
            WHERE proposal_id::text = ${proposalId}
            ORDER BY created_at ASC
        `;
        return rows.map((row) => ({
            proposalId: String(row.proposalId),
            voterUserId: row.voterUserId,
            vote: normalizeVoteDecision(row.vote),
            reason: row.reason ?? null,
            createdAt: row.createdAt,
        }));
    } catch (error) {
        if (isMissingTableError(error, 'governance_votes')) {
            return [];
        }
        throw error;
    }
}

export function mapDraftGenerationOutcomeFromProposalStatus(
    status: GovernanceProposalStatus,
): DraftCandidateGovernanceStatus {
    if (status === 'executed') return 'accepted';
    if (status === 'execution_failed') return 'generation_failed';
    if (status === 'rejected') return 'rejected';
    if (status === 'expired') return 'expired';
    if (status === 'cancelled') return 'cancelled';
    return 'proposal_active';
}

export function mapCrystallizationOutcomeFromProposalStatus(
    status: GovernanceProposalStatus,
): DraftCrystallizationGovernanceStatus {
    if (status === 'executed') return 'crystallized';
    if (status === 'execution_failed') return 'crystallization_failed';
    if (status === 'rejected' || status === 'expired' || status === 'cancelled') return 'drafting';
    return 'crystallization_active';
}

export function buildCandidateGenerationGovernanceReadModel(input: {
    circleId: number;
    candidateId: string | null;
    policyProfile: CirclePolicyProfile;
    proposal: GovernanceProposal | null;
    votes: GovernanceVote[];
}): CandidateGenerationGovernanceReadModel {
    return {
        circleId: input.circleId,
        candidateId: input.candidateId,
        policyProfile: input.policyProfile,
        proposal: input.proposal,
        votes: input.votes,
        candidateStatus: input.proposal
            ? mapDraftGenerationOutcomeFromProposalStatus(input.proposal.status)
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
    proposal: GovernanceProposal | null;
    votes: GovernanceVote[];
}): CrystallizationGovernanceReadModel {
    return {
        circleId: input.circleId,
        draftPostId: input.draftPostId,
        policyProfile: input.policyProfile,
        crystallizationPolicy: buildDefaultCrystallizationPolicy(input.policyProfile),
        proposal: input.proposal,
        votes: input.votes,
        draftStatus: input.proposal
            ? mapCrystallizationOutcomeFromProposalStatus(input.proposal.status)
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
    const proposal = await loadLatestGovernanceProposal(prisma, {
        circleId: input.circleId,
        actionType: 'draft_generation',
        targetType: input.candidateId ? 'draft_candidate' : undefined,
        targetId: input.candidateId ?? undefined,
    });
    const votes = proposal ? await loadGovernanceVotes(prisma, proposal.proposalId) : [];

    return buildCandidateGenerationGovernanceReadModel({
        circleId: input.circleId,
        candidateId: input.candidateId ?? null,
        policyProfile,
        proposal,
        votes,
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
    const proposal = await loadLatestGovernanceProposal(prisma, {
        circleId: input.circleId,
        actionType: 'crystallization',
        targetType: input.draftPostId ? 'draft_post' : undefined,
        targetId: input.draftPostId ?? undefined,
    });
    const votes = proposal ? await loadGovernanceVotes(prisma, proposal.proposalId) : [];

    return buildCrystallizationGovernanceReadModel({
        circleId: input.circleId,
        draftPostId: input.draftPostId ?? null,
        policyProfile,
        proposal,
        votes,
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
