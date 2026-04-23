import { Prisma, type PrismaClient } from '@prisma/client';
import type {
    GovernanceActionType,
    GovernanceElectorateScope,
    GovernanceProposal,
    GovernanceProposalStatus,
    GovernanceVote,
    GovernanceVoteDecision,
    GovernanceVoteRule,
} from '../policy/types';
import { getGovernanceActionDefinition } from './actionTypes';

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
    executionMarker: string | null;
    policyProfileDigest: string | null;
    configSnapshot: unknown;
    createdAt: Date | null;
    updatedAt: Date | null;
}

interface GovernanceVoteRow {
    proposalId: string | number;
    voterUserId: number;
    vote: string;
    reason: string | null;
    createdAt: Date;
}

export interface GovernanceRuntimeStore {
    getProposal(proposalId: string): Promise<GovernanceProposal | null>;
    saveProposal(proposal: GovernanceProposal): Promise<GovernanceProposal>;
    listVotes(proposalId: string): Promise<GovernanceVote[]>;
    saveVote(vote: GovernanceVote): Promise<GovernanceVote>;
}

export interface CreateGovernanceProposalInput {
    proposalId: string;
    circleId: number;
    actionType: GovernanceActionType;
    targetType: string;
    targetId: string | number;
    targetVersion?: number | null;
    createdBy?: number | null;
    electorateScope?: GovernanceElectorateScope | null;
    voteRule?: GovernanceVoteRule | null;
    thresholdValue?: number | null;
    quorum?: number | null;
    opensAt?: Date | null;
    closesAt?: Date | null;
    policyProfileDigest?: string | null;
    configSnapshot?: Record<string, unknown> | null;
    createdAt?: Date;
}

export interface RecordGovernanceVoteInput {
    proposalId: string;
    voterUserId: number;
    vote: GovernanceVoteDecision;
    reason?: string | null;
    createdAt?: Date;
}

export interface ResolveGovernanceProposalInput {
    proposalId: string;
    now?: Date;
}

export interface MarkGovernanceProposalExecutionInput {
    proposalId: string;
    executionMarker: string;
    executionError?: string | null;
    now?: Date;
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

function mapProposalRow(row: GovernanceProposalRow): GovernanceProposal {
    return {
        proposalId: String(row.proposalId),
        circleId: row.circleId,
        actionType: row.actionType as GovernanceActionType,
        targetType: String(row.targetType),
        targetId: String(row.targetId),
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
        executionMarker: row.executionMarker ?? null,
        policyProfileDigest: row.policyProfileDigest ?? null,
        configSnapshot: toRecord(row.configSnapshot),
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
    };
}

function mapVoteRow(row: GovernanceVoteRow): GovernanceVote {
    return {
        proposalId: String(row.proposalId),
        voterUserId: row.voterUserId,
        vote: normalizeVoteDecision(row.vote),
        reason: row.reason ?? null,
        createdAt: row.createdAt,
    };
}

function isTerminalStatus(status: GovernanceProposalStatus): boolean {
    return status === 'passed'
        || status === 'rejected'
        || status === 'expired'
        || status === 'executed'
        || status === 'execution_failed'
        || status === 'cancelled';
}

function countVotes(votes: GovernanceVote[]) {
    const approvals = votes.filter((vote) => vote.vote === 'approve').length;
    const rejections = votes.filter((vote) => vote.vote === 'reject').length;
    const abstentions = votes.filter((vote) => vote.vote === 'abstain').length;
    return {
        approvals,
        rejections,
        abstentions,
        decisive: approvals + rejections,
        total: votes.length,
    };
}

function evaluateProposalOutcome(
    proposal: GovernanceProposal,
    votes: GovernanceVote[],
    now: Date,
): GovernanceProposalStatus | null {
    const definition = getGovernanceActionDefinition(proposal.actionType);
    if (definition.voteMode === 'none') {
        return proposal.status === 'passed' ? null : 'passed';
    }
    if (!proposal.voteRule) {
        return definition.voteMode === 'optional' ? 'passed' : null;
    }

    const counts = countVotes(votes);
    const thresholdValue = proposal.thresholdValue ?? 1;
    const quorumReached = proposal.quorum == null || counts.total >= proposal.quorum;

    if (proposal.voteRule === 'single_approver') {
        if (counts.approvals >= 1) return 'passed';
        if (counts.rejections >= 1) return 'rejected';
    }

    if (proposal.voteRule === 'threshold_count') {
        if (counts.approvals >= thresholdValue) return 'passed';
        if (counts.rejections >= thresholdValue) return 'rejected';
    }

    if ((proposal.voteRule === 'majority_of_voters' || proposal.voteRule === 'majority_of_eligible') && quorumReached) {
        if (counts.approvals > counts.rejections && counts.decisive > 0) return 'passed';
        if (proposal.closesAt && proposal.closesAt.getTime() <= now.getTime() && counts.rejections >= counts.approvals && counts.decisive > 0) {
            return 'rejected';
        }
    }

    if (proposal.voteRule === 'unanimity' && counts.decisive > 0) {
        if (counts.rejections > 0) return 'rejected';
        if (quorumReached && counts.approvals === counts.decisive) return 'passed';
    }

    if (proposal.closesAt && proposal.closesAt.getTime() <= now.getTime()) {
        return 'expired';
    }
    return null;
}

function assertRequiredVoteConfig(input: CreateGovernanceProposalInput) {
    if (!input.electorateScope) {
        throw new Error('electorate_scope_required');
    }
    if (!input.voteRule) {
        throw new Error('vote_rule_required');
    }
}

export function createPrismaGovernanceRuntimeStore(
    prisma: PrismaClient,
): GovernanceRuntimeStore {
    return {
        async getProposal(proposalId) {
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
                    execution_marker AS "executionMarker",
                    policy_profile_digest AS "policyProfileDigest",
                    config_snapshot AS "configSnapshot",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM governance_proposals
                WHERE proposal_id::text = ${proposalId}
                LIMIT 1
            `);
            return rows[0] ? mapProposalRow(rows[0]) : null;
        },
        async saveProposal(proposal) {
            const rows = await prisma.$queryRaw<GovernanceProposalRow[]>(Prisma.sql`
                INSERT INTO governance_proposals (
                    proposal_id,
                    circle_id,
                    action_type,
                    target_type,
                    target_id,
                    target_version,
                    status,
                    created_by,
                    electorate_scope,
                    vote_rule,
                    threshold_value,
                    quorum,
                    opens_at,
                    closes_at,
                    resolved_at,
                    executed_at,
                    execution_error,
                    execution_marker,
                    policy_profile_digest,
                    config_snapshot,
                    created_at,
                    updated_at
                ) VALUES (
                    ${proposal.proposalId},
                    ${proposal.circleId},
                    ${proposal.actionType},
                    ${proposal.targetType},
                    ${proposal.targetId},
                    ${proposal.targetVersion ?? null},
                    ${proposal.status},
                    ${proposal.createdBy ?? null},
                    ${proposal.electorateScope ?? null},
                    ${proposal.voteRule ?? null},
                    ${proposal.thresholdValue ?? null},
                    ${proposal.quorum ?? null},
                    ${proposal.opensAt ?? null},
                    ${proposal.closesAt ?? null},
                    ${proposal.resolvedAt ?? null},
                    ${proposal.executedAt ?? null},
                    ${proposal.executionError ?? null},
                    ${proposal.executionMarker ?? null},
                    ${proposal.policyProfileDigest ?? null},
                    CAST(${JSON.stringify(proposal.configSnapshot ?? null)} AS JSONB),
                    ${proposal.createdAt ?? new Date()},
                    ${proposal.updatedAt ?? new Date()}
                )
                ON CONFLICT (proposal_id) DO UPDATE
                SET
                    circle_id = EXCLUDED.circle_id,
                    action_type = EXCLUDED.action_type,
                    target_type = EXCLUDED.target_type,
                    target_id = EXCLUDED.target_id,
                    target_version = EXCLUDED.target_version,
                    status = EXCLUDED.status,
                    created_by = EXCLUDED.created_by,
                    electorate_scope = EXCLUDED.electorate_scope,
                    vote_rule = EXCLUDED.vote_rule,
                    threshold_value = EXCLUDED.threshold_value,
                    quorum = EXCLUDED.quorum,
                    opens_at = EXCLUDED.opens_at,
                    closes_at = EXCLUDED.closes_at,
                    resolved_at = EXCLUDED.resolved_at,
                    executed_at = EXCLUDED.executed_at,
                    execution_error = EXCLUDED.execution_error,
                    execution_marker = EXCLUDED.execution_marker,
                    policy_profile_digest = EXCLUDED.policy_profile_digest,
                    config_snapshot = EXCLUDED.config_snapshot,
                    updated_at = EXCLUDED.updated_at
                RETURNING
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
                    execution_marker AS "executionMarker",
                    policy_profile_digest AS "policyProfileDigest",
                    config_snapshot AS "configSnapshot",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            return mapProposalRow(rows[0]);
        },
        async listVotes(proposalId) {
            const rows = await prisma.$queryRaw<GovernanceVoteRow[]>(Prisma.sql`
                SELECT
                    proposal_id AS "proposalId",
                    voter_user_id AS "voterUserId",
                    vote AS "vote",
                    reason AS "reason",
                    created_at AS "createdAt"
                FROM governance_votes
                WHERE proposal_id::text = ${proposalId}
                ORDER BY created_at ASC
            `);
            return rows.map((row) => mapVoteRow(row));
        },
        async saveVote(vote) {
            const rows = await prisma.$queryRaw<GovernanceVoteRow[]>(Prisma.sql`
                INSERT INTO governance_votes (
                    proposal_id,
                    voter_user_id,
                    vote,
                    reason,
                    created_at,
                    updated_at
                ) VALUES (
                    ${vote.proposalId},
                    ${vote.voterUserId},
                    ${vote.vote},
                    ${vote.reason ?? null},
                    ${vote.createdAt},
                    ${vote.createdAt}
                )
                ON CONFLICT (proposal_id, voter_user_id) DO UPDATE
                SET
                    vote = EXCLUDED.vote,
                    reason = EXCLUDED.reason,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    proposal_id AS "proposalId",
                    voter_user_id AS "voterUserId",
                    vote AS "vote",
                    reason AS "reason",
                    created_at AS "createdAt"
            `);
            return mapVoteRow(rows[0]);
        },
    };
}

export async function createGovernanceProposal(
    store: GovernanceRuntimeStore,
    input: CreateGovernanceProposalInput,
): Promise<GovernanceProposal> {
    const definition = getGovernanceActionDefinition(input.actionType);
    if (definition.requiresPolicyProfileDigest && !input.policyProfileDigest) {
        throw new Error('policy_profile_digest_required');
    }
    if (definition.voteMode === 'required') {
        assertRequiredVoteConfig(input);
    }

    const now = input.createdAt ?? new Date();
    const usesVoteFlow = definition.voteMode === 'required'
        || (definition.voteMode === 'optional' && !!input.voteRule);

    return store.saveProposal({
        proposalId: input.proposalId,
        circleId: input.circleId,
        actionType: input.actionType,
        targetType: input.targetType,
        targetId: String(input.targetId),
        targetVersion: input.targetVersion ?? null,
        status: usesVoteFlow ? 'active' : 'passed',
        createdBy: input.createdBy ?? null,
        electorateScope: usesVoteFlow ? input.electorateScope ?? null : null,
        voteRule: usesVoteFlow ? input.voteRule ?? null : null,
        thresholdValue: usesVoteFlow ? input.thresholdValue ?? null : null,
        quorum: usesVoteFlow ? input.quorum ?? null : null,
        opensAt: usesVoteFlow ? input.opensAt ?? null : null,
        closesAt: usesVoteFlow ? input.closesAt ?? null : null,
        resolvedAt: usesVoteFlow ? null : now,
        executedAt: null,
        executionError: null,
        executionMarker: null,
        policyProfileDigest: input.policyProfileDigest ?? null,
        configSnapshot: input.configSnapshot ?? null,
        createdAt: now,
        updatedAt: now,
    });
}

export async function recordGovernanceVote(
    store: GovernanceRuntimeStore,
    input: RecordGovernanceVoteInput,
): Promise<GovernanceVote> {
    const proposal = await store.getProposal(input.proposalId);
    if (!proposal) {
        throw new Error('proposal_not_found');
    }

    const definition = getGovernanceActionDefinition(proposal.actionType);
    if (definition.voteMode === 'none') {
        throw new Error(`action ${proposal.actionType} does not support vote flow`);
    }
    if (isTerminalStatus(proposal.status) && proposal.status !== 'passed') {
        throw new Error('proposal_not_voteable');
    }

    return store.saveVote({
        proposalId: proposal.proposalId,
        voterUserId: input.voterUserId,
        vote: input.vote,
        reason: input.reason ?? null,
        createdAt: input.createdAt ?? new Date(),
    });
}

export async function resolveGovernanceProposal(
    store: GovernanceRuntimeStore,
    input: ResolveGovernanceProposalInput,
): Promise<GovernanceProposal> {
    const proposal = await store.getProposal(input.proposalId);
    if (!proposal) {
        throw new Error('proposal_not_found');
    }
    if (isTerminalStatus(proposal.status)) {
        return proposal;
    }

    const now = input.now ?? new Date();
    const votes = await store.listVotes(proposal.proposalId);
    const nextStatus = evaluateProposalOutcome(proposal, votes, now);

    if (!nextStatus || nextStatus === proposal.status) {
        return proposal;
    }

    return store.saveProposal({
        ...proposal,
        status: nextStatus,
        resolvedAt: now,
        updatedAt: now,
    });
}

export async function markGovernanceProposalExecution(
    store: GovernanceRuntimeStore,
    input: MarkGovernanceProposalExecutionInput,
): Promise<GovernanceProposal> {
    const proposal = await store.getProposal(input.proposalId);
    if (!proposal) {
        throw new Error('proposal_not_found');
    }
    if (proposal.executionMarker && proposal.executionMarker !== input.executionMarker) {
        throw new Error('proposal already has a different execution marker');
    }
    if (proposal.status === 'executed' || proposal.status === 'execution_failed') {
        return proposal;
    }
    if (proposal.status !== 'passed' && !input.executionError) {
        throw new Error('proposal_not_ready_for_execution');
    }

    const now = input.now ?? new Date();
    return store.saveProposal({
        ...proposal,
        status: input.executionError ? 'execution_failed' : 'executed',
        resolvedAt: proposal.resolvedAt ?? now,
        executedAt: input.executionError ? proposal.executedAt ?? null : now,
        executionError: input.executionError ?? null,
        executionMarker: input.executionMarker,
        updatedAt: now,
    });
}
