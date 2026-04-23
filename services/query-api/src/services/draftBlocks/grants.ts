import { Prisma, type PrismaClient } from '@prisma/client';
import type { GovernanceProposalStatus } from '../policy/types';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type TemporaryEditGrantApprovalMode =
    | 'manager_confirm'
    | 'governance_vote';

export type TemporaryEditGrantStatus =
    | 'requested'
    | 'active'
    | 'revoked'
    | 'expired'
    | 'rejected';

interface TemporaryEditGrantRow {
    grantId: string;
    draftPostId: number;
    blockId: string;
    granteeUserId: number;
    requestedBy: number;
    grantedBy: number | null;
    revokedBy: number | null;
    approvalMode: string;
    status: string;
    governanceProposalId: string | null;
    requestNote: string | null;
    expiresAt: Date | null;
    requestedAt: Date;
    grantedAt: Date | null;
    revokedAt: Date | null;
    updatedAt: Date;
}

export interface TemporaryEditGrantRecord {
    grantId: string;
    draftPostId: number;
    blockId: string;
    granteeUserId: number;
    requestedBy: number;
    grantedBy: number | null;
    revokedBy: number | null;
    approvalMode: TemporaryEditGrantApprovalMode;
    status: TemporaryEditGrantStatus;
    governanceProposalId: string | null;
    requestNote: string | null;
    expiresAt: Date | null;
    requestedAt: Date;
    grantedAt: Date | null;
    revokedAt: Date | null;
    updatedAt: Date;
}

export interface TemporaryEditGrantStore {
    getGrant(grantId: string): Promise<TemporaryEditGrantRecord | null>;
    saveGrant(grant: TemporaryEditGrantRecord): Promise<TemporaryEditGrantRecord>;
    listDraftGrants(input: {
        draftPostId: number;
        blockId?: string | null;
    }): Promise<TemporaryEditGrantRecord[]>;
}

export interface RequestTemporaryEditGrantInput {
    grantId: string;
    draftPostId: number;
    blockId: string;
    granteeUserId: number;
    requestedBy: number;
    approvalMode: TemporaryEditGrantApprovalMode;
    governanceProposalId?: string | null;
    requestNote?: string | null;
    requestedAt?: Date;
}

export interface IssueTemporaryEditGrantInput {
    grantId: string;
    grantedBy: number;
    grantedAt?: Date;
    expiresAt?: Date | null;
}

export interface RevokeTemporaryEditGrantInput {
    grantId: string;
    revokedBy: number;
    revokedAt?: Date;
}

export interface ExpireTemporaryEditGrantInput {
    grantId: string;
    now?: Date;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

export function normalizeTemporaryEditGrantApprovalMode(
    raw: unknown,
): TemporaryEditGrantApprovalMode | null {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'manager_confirm') return 'manager_confirm';
    if (normalized === 'governance_vote') return 'governance_vote';
    return null;
}

export function normalizeTemporaryEditGrantStatus(
    raw: unknown,
): TemporaryEditGrantStatus {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'active') return 'active';
    if (normalized === 'revoked') return 'revoked';
    if (normalized === 'expired') return 'expired';
    if (normalized === 'rejected') return 'rejected';
    return 'requested';
}

function normalizeGovernanceStatus(raw: unknown): GovernanceProposalStatus {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'active') return 'active';
    if (normalized === 'passed') return 'passed';
    if (normalized === 'rejected') return 'rejected';
    if (normalized === 'expired') return 'expired';
    if (normalized === 'executed') return 'executed';
    if (normalized === 'execution_failed') return 'execution_failed';
    if (normalized === 'cancelled') return 'cancelled';
    return 'drafted';
}

function mapGrantRow(row: TemporaryEditGrantRow): TemporaryEditGrantRecord {
    return {
        grantId: String(row.grantId),
        draftPostId: row.draftPostId,
        blockId: row.blockId,
        granteeUserId: row.granteeUserId,
        requestedBy: row.requestedBy,
        grantedBy: row.grantedBy ?? null,
        revokedBy: row.revokedBy ?? null,
        approvalMode: normalizeTemporaryEditGrantApprovalMode(row.approvalMode) ?? 'manager_confirm',
        status: normalizeTemporaryEditGrantStatus(row.status),
        governanceProposalId: row.governanceProposalId ?? null,
        requestNote: row.requestNote ?? null,
        expiresAt: row.expiresAt ?? null,
        requestedAt: row.requestedAt,
        grantedAt: row.grantedAt ?? null,
        revokedAt: row.revokedAt ?? null,
        updatedAt: row.updatedAt,
    };
}

export function createPrismaTemporaryEditGrantStore(
    prisma: PrismaLike,
): TemporaryEditGrantStore {
    return {
        async getGrant(grantId) {
            const rows = await prisma.$queryRaw<TemporaryEditGrantRow[]>(Prisma.sql`
                SELECT
                    grant_id AS "grantId",
                    draft_post_id AS "draftPostId",
                    block_id AS "blockId",
                    grantee_user_id AS "granteeUserId",
                    requested_by AS "requestedBy",
                    granted_by AS "grantedBy",
                    revoked_by AS "revokedBy",
                    approval_mode AS "approvalMode",
                    status,
                    governance_proposal_id AS "governanceProposalId",
                    request_note AS "requestNote",
                    expires_at AS "expiresAt",
                    requested_at AS "requestedAt",
                    granted_at AS "grantedAt",
                    revoked_at AS "revokedAt",
                    updated_at AS "updatedAt"
                FROM temporary_edit_grants
                WHERE grant_id = ${grantId}
                LIMIT 1
            `);
            return rows[0] ? mapGrantRow(rows[0]) : null;
        },
        async saveGrant(grant) {
            const rows = await prisma.$queryRaw<TemporaryEditGrantRow[]>(Prisma.sql`
                INSERT INTO temporary_edit_grants (
                    grant_id,
                    draft_post_id,
                    block_id,
                    grantee_user_id,
                    requested_by,
                    granted_by,
                    revoked_by,
                    approval_mode,
                    status,
                    governance_proposal_id,
                    request_note,
                    expires_at,
                    requested_at,
                    granted_at,
                    revoked_at,
                    updated_at
                ) VALUES (
                    ${grant.grantId},
                    ${grant.draftPostId},
                    ${grant.blockId},
                    ${grant.granteeUserId},
                    ${grant.requestedBy},
                    ${grant.grantedBy ?? null},
                    ${grant.revokedBy ?? null},
                    ${grant.approvalMode},
                    ${grant.status},
                    ${grant.governanceProposalId ?? null},
                    ${grant.requestNote ?? null},
                    ${grant.expiresAt ?? null},
                    ${grant.requestedAt},
                    ${grant.grantedAt ?? null},
                    ${grant.revokedAt ?? null},
                    ${grant.updatedAt}
                )
                ON CONFLICT (grant_id) DO UPDATE
                SET
                    draft_post_id = EXCLUDED.draft_post_id,
                    block_id = EXCLUDED.block_id,
                    grantee_user_id = EXCLUDED.grantee_user_id,
                    requested_by = EXCLUDED.requested_by,
                    granted_by = EXCLUDED.granted_by,
                    revoked_by = EXCLUDED.revoked_by,
                    approval_mode = EXCLUDED.approval_mode,
                    status = EXCLUDED.status,
                    governance_proposal_id = EXCLUDED.governance_proposal_id,
                    request_note = EXCLUDED.request_note,
                    expires_at = EXCLUDED.expires_at,
                    granted_at = EXCLUDED.granted_at,
                    revoked_at = EXCLUDED.revoked_at,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    grant_id AS "grantId",
                    draft_post_id AS "draftPostId",
                    block_id AS "blockId",
                    grantee_user_id AS "granteeUserId",
                    requested_by AS "requestedBy",
                    granted_by AS "grantedBy",
                    revoked_by AS "revokedBy",
                    approval_mode AS "approvalMode",
                    status,
                    governance_proposal_id AS "governanceProposalId",
                    request_note AS "requestNote",
                    expires_at AS "expiresAt",
                    requested_at AS "requestedAt",
                    granted_at AS "grantedAt",
                    revoked_at AS "revokedAt",
                    updated_at AS "updatedAt"
            `);
            return mapGrantRow(rows[0]);
        },
        async listDraftGrants(input) {
            const rows = await prisma.$queryRaw<TemporaryEditGrantRow[]>(Prisma.sql`
                SELECT
                    grant_id AS "grantId",
                    draft_post_id AS "draftPostId",
                    block_id AS "blockId",
                    grantee_user_id AS "granteeUserId",
                    requested_by AS "requestedBy",
                    granted_by AS "grantedBy",
                    revoked_by AS "revokedBy",
                    approval_mode AS "approvalMode",
                    status,
                    governance_proposal_id AS "governanceProposalId",
                    request_note AS "requestNote",
                    expires_at AS "expiresAt",
                    requested_at AS "requestedAt",
                    granted_at AS "grantedAt",
                    revoked_at AS "revokedAt",
                    updated_at AS "updatedAt"
                FROM temporary_edit_grants
                WHERE draft_post_id = ${input.draftPostId}
                    AND (
                        ${input.blockId ?? null}::VARCHAR IS NULL
                        OR block_id = ${input.blockId ?? null}
                    )
                ORDER BY requested_at DESC
            `);
            return rows.map(mapGrantRow);
        },
    };
}

export async function requestTemporaryEditGrant(
    store: TemporaryEditGrantStore,
    input: RequestTemporaryEditGrantInput,
): Promise<TemporaryEditGrantRecord> {
    const grantId = asNonEmptyString(input.grantId);
    const draftPostId = asPositiveInteger(input.draftPostId);
    const blockId = asNonEmptyString(input.blockId);
    const granteeUserId = asPositiveInteger(input.granteeUserId);
    const requestedBy = asPositiveInteger(input.requestedBy);
    const approvalMode = normalizeTemporaryEditGrantApprovalMode(input.approvalMode);
    const governanceProposalId = asNonEmptyString(input.governanceProposalId);

    if (!grantId) throw new Error('invalid_temporary_edit_grant_id');
    if (!draftPostId) throw new Error('invalid_draft_post_id');
    if (!blockId) throw new Error('temporary_edit_grant_block_id_required');
    if (!granteeUserId) throw new Error('temporary_edit_grant_grantee_required');
    if (!requestedBy) throw new Error('temporary_edit_grant_requester_required');
    if (!approvalMode) throw new Error('invalid_temporary_edit_grant_approval_mode');
    if (approvalMode === 'governance_vote' && !governanceProposalId) {
        throw new Error('temporary_edit_grant_governance_proposal_required');
    }

    const requestedAt = input.requestedAt ?? new Date();
    return store.saveGrant({
        grantId,
        draftPostId,
        blockId,
        granteeUserId,
        requestedBy,
        grantedBy: null,
        revokedBy: null,
        approvalMode,
        status: 'requested',
        governanceProposalId: governanceProposalId ?? null,
        requestNote: asNonEmptyString(input.requestNote) ?? null,
        expiresAt: null,
        requestedAt,
        grantedAt: null,
        revokedAt: null,
        updatedAt: requestedAt,
    });
}

export async function issueTemporaryEditGrant(
    store: TemporaryEditGrantStore,
    input: IssueTemporaryEditGrantInput,
): Promise<TemporaryEditGrantRecord> {
    const grant = await store.getGrant(input.grantId);
    if (!grant) {
        throw new Error('temporary_edit_grant_not_found');
    }
    if (grant.status === 'active') {
        return grant;
    }
    if (grant.status !== 'requested') {
        throw new Error('temporary_edit_grant_not_requestable');
    }

    const grantedAt = input.grantedAt ?? new Date();
    return store.saveGrant({
        ...grant,
        grantedBy: input.grantedBy,
        status: 'active',
        expiresAt: input.expiresAt ?? grant.expiresAt ?? null,
        grantedAt,
        updatedAt: grantedAt,
    });
}

export async function revokeTemporaryEditGrant(
    store: TemporaryEditGrantStore,
    input: RevokeTemporaryEditGrantInput,
): Promise<TemporaryEditGrantRecord> {
    const grant = await store.getGrant(input.grantId);
    if (!grant) {
        throw new Error('temporary_edit_grant_not_found');
    }
    if (grant.status === 'revoked') {
        return grant;
    }
    if (grant.status !== 'requested' && grant.status !== 'active') {
        throw new Error('temporary_edit_grant_not_revocable');
    }

    const revokedAt = input.revokedAt ?? new Date();
    return store.saveGrant({
        ...grant,
        revokedBy: input.revokedBy,
        status: 'revoked',
        revokedAt,
        updatedAt: revokedAt,
    });
}

export async function expireTemporaryEditGrant(
    store: TemporaryEditGrantStore,
    input: ExpireTemporaryEditGrantInput,
): Promise<TemporaryEditGrantRecord> {
    const grant = await store.getGrant(input.grantId);
    if (!grant) {
        throw new Error('temporary_edit_grant_not_found');
    }
    if (grant.status === 'expired') {
        return grant;
    }
    if (!grant.expiresAt) {
        return grant;
    }

    const now = input.now ?? new Date();
    if (grant.expiresAt.getTime() > now.getTime()) {
        return grant;
    }

    return store.saveGrant({
        ...grant,
        status: 'expired',
        updatedAt: now,
    });
}

export async function reconcileTemporaryEditGrantGovernance(
    store: TemporaryEditGrantStore,
    input: {
        grantId: string;
        governanceProposal: {
            proposalId: string;
            status: GovernanceProposalStatus | string;
        } | null;
    },
): Promise<TemporaryEditGrantRecord> {
    const grant = await store.getGrant(input.grantId);
    if (!grant) {
        throw new Error('temporary_edit_grant_not_found');
    }
    if (grant.approvalMode !== 'governance_vote' || !grant.governanceProposalId || !input.governanceProposal) {
        return grant;
    }
    if (input.governanceProposal.proposalId !== grant.governanceProposalId) {
        return grant;
    }
    if (grant.status === 'active' || grant.status === 'revoked' || grant.status === 'expired') {
        return grant;
    }

    const governanceStatus = normalizeGovernanceStatus(input.governanceProposal.status);
    if (governanceStatus === 'rejected' || governanceStatus === 'execution_failed' || governanceStatus === 'cancelled') {
        const now = new Date();
        return store.saveGrant({
            ...grant,
            status: 'rejected',
            updatedAt: now,
        });
    }
    if (governanceStatus === 'expired') {
        const now = new Date();
        return store.saveGrant({
            ...grant,
            status: 'expired',
            updatedAt: now,
        });
    }
    return grant;
}
