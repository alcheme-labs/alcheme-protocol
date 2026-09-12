import { Prisma, type PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type RevisionDirectionAcceptanceMode =
    | 'manager_confirm'
    | 'role_confirm'
    | 'governance_request';

export type RevisionDirectionStatus =
    | 'open'
    | 'accepted'
    | 'rejected'
    | 'expired';

interface RevisionDirectionProposalRow {
    revisionProposalId: string;
    draftPostId: number;
    draftVersion: number;
    scopeType: string;
    scopeRef: string;
    proposedBy: number | null;
    summary: string;
    acceptanceMode: string;
    status: string;
    acceptedBy: number | null;
    acceptedAt: Date | null;
    governanceRequestId: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface RevisionDirectionProposalRecord {
    revisionProposalId: string;
    draftPostId: number;
    draftVersion: number;
    scopeType: string;
    scopeRef: string;
    proposedBy: number | null;
    summary: string;
    acceptanceMode: RevisionDirectionAcceptanceMode;
    status: RevisionDirectionStatus;
    acceptedBy: number | null;
    acceptedAt: Date | null;
    governanceRequestId: string | null;
    createdAt: Date;
    updatedAt?: Date | null;
}

export interface RevisionDirectionStore {
    getProposal(revisionProposalId: string): Promise<RevisionDirectionProposalRecord | null>;
    saveProposal(
        proposal: RevisionDirectionProposalRecord,
    ): Promise<RevisionDirectionProposalRecord>;
    listDraftProposals(input: {
        draftPostId: number;
        draftVersion?: number | null;
    }): Promise<RevisionDirectionProposalRecord[]>;
}

export interface CreateRevisionDirectionProposalInput {
    revisionProposalId: string;
    draftPostId: number;
    draftVersion: number;
    scopeType: string;
    scopeRef: string;
    proposedBy?: number | null;
    summary: string;
    acceptanceMode: RevisionDirectionAcceptanceMode;
    governanceRequestId?: string | null;
    createdAt?: Date;
}

export interface AcceptRevisionDirectionProposalInput {
    revisionProposalId: string;
    acceptedBy?: number | null;
    acceptedAt?: Date;
}

export interface RejectRevisionDirectionProposalInput {
    revisionProposalId: string;
}

export interface ApplyGovernedRevisionDirectionOutcomeInput {
    revisionProposalId: string;
    outcome: 'accepted' | 'rejected';
    decidedAt?: Date;
}

export interface ReconcileRevisionDirectionGovernanceInput {
    revisionProposalId: string;
    governanceRequest: {
        id: string;
        state: string;
        resolvedAt?: Date | null;
    } | null;
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

export function normalizeRevisionDirectionAcceptanceMode(
    raw: unknown,
): RevisionDirectionAcceptanceMode | null {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'manager_confirm') return 'manager_confirm';
    if (normalized === 'role_confirm') return 'role_confirm';
    if (normalized === 'governance_request') return 'governance_request';
    return null;
}

export function normalizeRevisionDirectionStatus(
    raw: unknown,
): RevisionDirectionStatus {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'accepted') return 'accepted';
    if (normalized === 'rejected') return 'rejected';
    if (normalized === 'expired') return 'expired';
    return 'open';
}

function normalizeGovernanceRequestState(raw: unknown): 'active' | 'accepted' | 'rejected' | 'expired' | 'cancelled' {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'active') return 'active';
    if (normalized === 'rejected') return 'rejected';
    if (normalized === 'expired') return 'expired';
    if (normalized === 'cancelled') return 'cancelled';
    if (normalized === 'accepted') return 'accepted';
    return 'active';
}

function mapProposalRow(
    row: RevisionDirectionProposalRow,
): RevisionDirectionProposalRecord {
    return {
        revisionProposalId: String(row.revisionProposalId),
        draftPostId: row.draftPostId,
        draftVersion: row.draftVersion,
        scopeType: row.scopeType,
        scopeRef: row.scopeRef,
        proposedBy: row.proposedBy ?? null,
        summary: row.summary,
        acceptanceMode: normalizeRevisionDirectionAcceptanceMode(row.acceptanceMode) ?? 'manager_confirm',
        status: normalizeRevisionDirectionStatus(row.status),
        acceptedBy: row.acceptedBy ?? null,
        acceptedAt: row.acceptedAt ?? null,
        governanceRequestId: row.governanceRequestId ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt ?? null,
    };
}

export function createPrismaRevisionDirectionStore(
    prisma: PrismaLike,
): RevisionDirectionStore {
    return {
        async getProposal(revisionProposalId) {
            const rows = await prisma.$queryRaw<RevisionDirectionProposalRow[]>(Prisma.sql`
                SELECT
                    revision_proposal_id AS "revisionProposalId",
                    draft_post_id AS "draftPostId",
                    draft_version AS "draftVersion",
                    scope_type AS "scopeType",
                    scope_ref AS "scopeRef",
                    proposed_by AS "proposedBy",
                    summary,
                    acceptance_mode AS "acceptanceMode",
                    status,
                    accepted_by AS "acceptedBy",
                    accepted_at AS "acceptedAt",
                    governance_request_id AS "governanceRequestId",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM revision_direction_proposals
                WHERE revision_proposal_id = ${revisionProposalId}
                LIMIT 1
            `);
            return rows[0] ? mapProposalRow(rows[0]) : null;
        },
        async saveProposal(proposal) {
            const rows = await prisma.$queryRaw<RevisionDirectionProposalRow[]>(Prisma.sql`
                INSERT INTO revision_direction_proposals (
                    revision_proposal_id,
                    draft_post_id,
                    draft_version,
                    scope_type,
                    scope_ref,
                    proposed_by,
                    summary,
                    acceptance_mode,
                    status,
                    accepted_by,
                    accepted_at,
                    governance_request_id,
                    created_at,
                    updated_at
                ) VALUES (
                    ${proposal.revisionProposalId},
                    ${proposal.draftPostId},
                    ${proposal.draftVersion},
                    ${proposal.scopeType},
                    ${proposal.scopeRef},
                    ${proposal.proposedBy ?? null},
                    ${proposal.summary},
                    ${proposal.acceptanceMode},
                    ${proposal.status},
                    ${proposal.acceptedBy ?? null},
                    ${proposal.acceptedAt ?? null},
                    ${proposal.governanceRequestId ?? null},
                    ${proposal.createdAt},
                    ${proposal.updatedAt ?? proposal.createdAt}
                )
                ON CONFLICT (revision_proposal_id) DO UPDATE
                SET
                    draft_post_id = EXCLUDED.draft_post_id,
                    draft_version = EXCLUDED.draft_version,
                    scope_type = EXCLUDED.scope_type,
                    scope_ref = EXCLUDED.scope_ref,
                    proposed_by = EXCLUDED.proposed_by,
                    summary = EXCLUDED.summary,
                    acceptance_mode = EXCLUDED.acceptance_mode,
                    status = EXCLUDED.status,
                    accepted_by = EXCLUDED.accepted_by,
                    accepted_at = EXCLUDED.accepted_at,
                    governance_request_id = EXCLUDED.governance_request_id,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    revision_proposal_id AS "revisionProposalId",
                    draft_post_id AS "draftPostId",
                    draft_version AS "draftVersion",
                    scope_type AS "scopeType",
                    scope_ref AS "scopeRef",
                    proposed_by AS "proposedBy",
                    summary,
                    acceptance_mode AS "acceptanceMode",
                    status,
                    accepted_by AS "acceptedBy",
                    accepted_at AS "acceptedAt",
                    governance_request_id AS "governanceRequestId",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            return mapProposalRow(rows[0]);
        },
        async listDraftProposals(input) {
            const rows = await prisma.$queryRaw<RevisionDirectionProposalRow[]>(Prisma.sql`
                SELECT
                    revision_proposal_id AS "revisionProposalId",
                    draft_post_id AS "draftPostId",
                    draft_version AS "draftVersion",
                    scope_type AS "scopeType",
                    scope_ref AS "scopeRef",
                    proposed_by AS "proposedBy",
                    summary,
                    acceptance_mode AS "acceptanceMode",
                    status,
                    accepted_by AS "acceptedBy",
                    accepted_at AS "acceptedAt",
                    governance_request_id AS "governanceRequestId",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM revision_direction_proposals
                WHERE draft_post_id = ${input.draftPostId}
                    AND (
                        ${input.draftVersion ?? null}::INTEGER IS NULL
                        OR draft_version = ${input.draftVersion ?? null}
                    )
                ORDER BY created_at DESC
            `);
            return rows.map(mapProposalRow);
        },
    };
}

export async function createRevisionDirectionProposal(
    store: RevisionDirectionStore,
    input: CreateRevisionDirectionProposalInput,
): Promise<RevisionDirectionProposalRecord> {
    const revisionProposalId = asNonEmptyString(input.revisionProposalId);
    const draftPostId = asPositiveInteger(input.draftPostId);
    const draftVersion = asPositiveInteger(input.draftVersion);
    const scopeType = asNonEmptyString(input.scopeType);
    const scopeRef = asNonEmptyString(input.scopeRef);
    const summary = asNonEmptyString(input.summary);
    const acceptanceMode = normalizeRevisionDirectionAcceptanceMode(input.acceptanceMode);
    const governanceRequestId = asNonEmptyString(input.governanceRequestId);

    if (!revisionProposalId) throw new Error('invalid_revision_proposal_id');
    if (!draftPostId) throw new Error('invalid_draft_post_id');
    if (!draftVersion) throw new Error('invalid_draft_version');
    if (!scopeType) throw new Error('revision_direction_scope_type_required');
    if (!scopeRef) throw new Error('revision_direction_scope_ref_required');
    if (!summary) throw new Error('revision_direction_summary_required');
    if (!acceptanceMode) throw new Error('invalid_revision_direction_acceptance_mode');
    if (acceptanceMode === 'governance_request' && !governanceRequestId) {
        throw new Error('revision_direction_governance_request_required');
    }

    const now = input.createdAt ?? new Date();
    return store.saveProposal({
        revisionProposalId,
        draftPostId,
        draftVersion,
        scopeType,
        scopeRef,
        proposedBy: input.proposedBy ?? null,
        summary,
        acceptanceMode,
        status: 'open',
        acceptedBy: null,
        acceptedAt: null,
        governanceRequestId: governanceRequestId ?? null,
        createdAt: now,
        updatedAt: now,
    });
}

export async function listRevisionDirectionProposals(
    store: RevisionDirectionStore,
    input: {
        draftPostId: number;
        draftVersion?: number | null;
    },
): Promise<RevisionDirectionProposalRecord[]> {
    return store.listDraftProposals(input);
}

export async function acceptRevisionDirectionProposal(
    store: RevisionDirectionStore,
    input: AcceptRevisionDirectionProposalInput,
): Promise<RevisionDirectionProposalRecord> {
    const proposal = await store.getProposal(input.revisionProposalId);
    if (!proposal) {
        throw new Error('revision_direction_not_found');
    }
    if (proposal.status === 'accepted') {
        return proposal;
    }
    if (proposal.status !== 'open') {
        throw new Error('revision_direction_not_open');
    }
    if (proposal.acceptanceMode === 'governance_request') {
        throw new Error('revision_direction_governance_acceptance_required');
    }

    const acceptedAt = input.acceptedAt ?? new Date();
    return store.saveProposal({
        ...proposal,
        status: 'accepted',
        acceptedBy: input.acceptedBy ?? null,
        acceptedAt,
        updatedAt: acceptedAt,
    });
}

export async function rejectRevisionDirectionProposal(
    store: RevisionDirectionStore,
    input: RejectRevisionDirectionProposalInput,
): Promise<RevisionDirectionProposalRecord> {
    const proposal = await store.getProposal(input.revisionProposalId);
    if (!proposal) {
        throw new Error('revision_direction_not_found');
    }
    if (proposal.status === 'rejected') {
        return proposal;
    }
    if (proposal.status !== 'open') {
        throw new Error('revision_direction_not_open');
    }
    if (proposal.acceptanceMode === 'governance_request') {
        throw new Error('revision_direction_governance_rejection_required');
    }

    const now = new Date();
    return store.saveProposal({
        ...proposal,
        status: 'rejected',
        acceptedBy: null,
        acceptedAt: null,
        updatedAt: now,
    });
}

export async function applyGovernedRevisionDirectionOutcome(
    store: RevisionDirectionStore,
    input: ApplyGovernedRevisionDirectionOutcomeInput,
): Promise<RevisionDirectionProposalRecord> {
    const proposal = await store.getProposal(input.revisionProposalId);
    if (!proposal) {
        throw new Error('revision_direction_not_found');
    }
    if (proposal.acceptanceMode !== 'governance_request' || !proposal.governanceRequestId) {
        throw new Error('revision_direction_governance_request_required');
    }
    if (proposal.status === input.outcome) {
        return proposal;
    }
    if (proposal.status !== 'open') {
        throw new Error('revision_direction_not_open');
    }

    const decidedAt = input.decidedAt ?? new Date();
    return store.saveProposal({
        ...proposal,
        status: input.outcome,
        acceptedBy: null,
        acceptedAt: input.outcome === 'accepted' ? decidedAt : null,
        updatedAt: decidedAt,
    });
}

export async function reconcileRevisionDirectionProposalGovernance(
    store: RevisionDirectionStore,
    input: ReconcileRevisionDirectionGovernanceInput,
): Promise<RevisionDirectionProposalRecord> {
    const proposal = await store.getProposal(input.revisionProposalId);
    if (!proposal) {
        throw new Error('revision_direction_not_found');
    }
    if (proposal.acceptanceMode !== 'governance_request' || !proposal.governanceRequestId) {
        return proposal;
    }
    if (!input.governanceRequest || input.governanceRequest.id !== proposal.governanceRequestId) {
        return proposal;
    }
    if (proposal.status === 'accepted' || proposal.status === 'rejected' || proposal.status === 'expired') {
        return proposal;
    }

    const governanceStatus = normalizeGovernanceRequestState(input.governanceRequest.state);
    if (governanceStatus === 'expired') {
        const now = new Date();
        return store.saveProposal({
            ...proposal,
            status: 'expired',
            updatedAt: now,
        });
    }
    if (
        governanceStatus === 'rejected'
        || governanceStatus === 'cancelled'
    ) {
        const now = new Date();
        return store.saveProposal({
            ...proposal,
            status: 'rejected',
            updatedAt: now,
        });
    }
    return proposal;
}

export async function listAcceptedRevisionDirectionsForNextRound(
    store: RevisionDirectionStore,
    input: {
        draftPostId: number;
        draftVersion?: number | null;
    },
): Promise<RevisionDirectionProposalRecord[]> {
    const proposals = await store.listDraftProposals(input);
    return proposals
        .filter((proposal) => proposal.status === 'accepted')
        .sort((left, right) => {
            const leftTime = left.acceptedAt?.getTime() ?? left.createdAt.getTime();
            const rightTime = right.acceptedAt?.getTime() ?? right.createdAt.getTime();
            return leftTime - rightTime;
        });
}
