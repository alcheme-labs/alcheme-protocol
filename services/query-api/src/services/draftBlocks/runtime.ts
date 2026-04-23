import crypto from 'crypto';

export type ArgumentBlockLeaseStatus = 'active' | 'released' | 'expired' | 'revoked';
export type ArgumentBlockRevisionSessionStatus =
    | 'claiming'
    | 'active'
    | 'editing'
    | 'submitted'
    | 'merged'
    | 'rejected'
    | 'expired'
    | 'released'
    | 'revoked';

export interface ArgumentBlockEditLeaseView {
    leaseId: string;
    draftPostId: number;
    draftVersion: number;
    blockId: string;
    holderUserId: number;
    status: ArgumentBlockLeaseStatus;
    acquiredAt: string;
    expiresAt: string;
    lastHeartbeatAt: string;
    releasedAt: string | null;
    releaseReason: string | null;
}

export interface ArgumentBlockRevisionSessionView {
    sessionId: string;
    draftPostId: number;
    baseDraftVersion: number;
    blockId: string;
    editorUserId: number;
    leaseId: string;
    status: ArgumentBlockRevisionSessionStatus;
    contentHashBefore: string;
    contentAfter: string | null;
    startedAt: string;
    updatedAt: string;
    submittedAt: string | null;
    closedAt: string | null;
    closeReason: string | null;
}

export interface TemporaryEditGrantRuntimeView {
    grantId: string;
    draftPostId: number;
    blockId: string;
    granteeUserId: number;
    requestedBy: number;
    grantedBy: number | null;
    revokedBy: number | null;
    approvalMode: 'manager_confirm' | 'governance_vote';
    status: 'requested' | 'active' | 'revoked' | 'expired' | 'rejected';
    governanceProposalId: string | null;
    requestNote: string | null;
    expiresAt: string | null;
    requestedAt: string;
    grantedAt: string | null;
    revokedAt: string | null;
    updatedAt: string;
}

export class DraftBlockRuntimeError extends Error {
    constructor(public readonly code: string, message?: string) {
        super(message || code);
        this.name = 'DraftBlockRuntimeError';
    }
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function normalizeIsoString(input: string | Date): string {
    return input instanceof Date ? input.toISOString() : new Date(input).toISOString();
}

function addSeconds(input: string, seconds: number): string {
    return new Date(new Date(input).getTime() + (seconds * 1000)).toISOString();
}

function isExpired(lease: ArgumentBlockEditLeaseView, nowIso: string): boolean {
    return new Date(lease.expiresAt).getTime() <= new Date(nowIso).getTime();
}

function hasActiveTemporaryEditGrant(
    grant: TemporaryEditGrantRuntimeView | null | undefined,
    input: {
        draftPostId: number;
        blockId: string;
        holderUserId: number;
        nowIso: string;
    },
): boolean {
    if (!grant) return false;
    if (grant.status !== 'active') return false;
    if (grant.draftPostId !== input.draftPostId) return false;
    if (grant.blockId !== input.blockId) return false;
    if (grant.granteeUserId !== input.holderUserId) return false;
    if (!grant.expiresAt) return true;
    return new Date(grant.expiresAt).getTime() > new Date(input.nowIso).getTime();
}

function assertLeaseActive(lease: ArgumentBlockEditLeaseView, nowIso: string) {
    if (lease.status !== 'active' || isExpired(lease, nowIso)) {
        throw new DraftBlockRuntimeError(
            'argument_block_lease_not_active',
            'argument_block_lease_not_active',
        );
    }
}

export function claimArgumentBlockLease(input: {
    draftPostId: number;
    draftVersion: number;
    blockId: string;
    holderUserId: number;
    canClaimLease: boolean;
    temporaryEditGrant?: TemporaryEditGrantRuntimeView | null;
    now: string | Date;
    ttlSeconds: number;
    existingLease?: ArgumentBlockEditLeaseView | null;
}): ArgumentBlockEditLeaseView {
    const nowIso = normalizeIsoString(input.now);
    const temporaryGrantAllowsClaim = hasActiveTemporaryEditGrant(input.temporaryEditGrant, {
        draftPostId: input.draftPostId,
        blockId: input.blockId,
        holderUserId: input.holderUserId,
        nowIso,
    });
    if (!input.canClaimLease && !temporaryGrantAllowsClaim) {
        throw new DraftBlockRuntimeError(
            'argument_block_lease_permission_denied',
            'argument_block_lease_permission_denied',
        );
    }

    const existingLease = input.existingLease || null;
    if (
        existingLease
        && existingLease.status === 'active'
        && !isExpired(existingLease, nowIso)
        && existingLease.holderUserId !== input.holderUserId
    ) {
        throw new DraftBlockRuntimeError(
            'argument_block_lease_conflict',
            'argument_block_lease_conflict',
        );
    }

    return {
        leaseId: sha256Hex(
            [
                input.draftPostId,
                input.draftVersion,
                input.blockId,
                input.holderUserId,
                nowIso,
            ].join(':'),
        ),
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
        blockId: input.blockId,
        holderUserId: input.holderUserId,
        status: 'active',
        acquiredAt: nowIso,
        expiresAt: addSeconds(nowIso, input.ttlSeconds),
        lastHeartbeatAt: nowIso,
        releasedAt: null,
        releaseReason: null,
    };
}

export function heartbeatArgumentBlockLease(input: {
    lease: ArgumentBlockEditLeaseView;
    now: string | Date;
    ttlSeconds: number;
}): ArgumentBlockEditLeaseView {
    const nowIso = normalizeIsoString(input.now);
    assertLeaseActive(input.lease, nowIso);
    return {
        ...input.lease,
        lastHeartbeatAt: nowIso,
        expiresAt: addSeconds(nowIso, input.ttlSeconds),
    };
}

export function releaseArgumentBlockLease(input: {
    lease: ArgumentBlockEditLeaseView;
    now: string | Date;
    releaseReason: string;
}): ArgumentBlockEditLeaseView {
    const nowIso = normalizeIsoString(input.now);
    assertLeaseActive(input.lease, nowIso);
    return {
        ...input.lease,
        status: 'released',
        releasedAt: nowIso,
        releaseReason: String(input.releaseReason || '').trim() || 'released',
    };
}

export function openArgumentBlockRevisionSession(input: {
    lease: ArgumentBlockEditLeaseView;
    baseDraftVersion: number;
    contentHashBefore: string;
    now: string | Date;
}): ArgumentBlockRevisionSessionView {
    const nowIso = normalizeIsoString(input.now);
    assertLeaseActive(input.lease, nowIso);

    return {
        sessionId: sha256Hex(
            [
                input.lease.leaseId,
                input.baseDraftVersion,
                input.contentHashBefore,
                nowIso,
            ].join(':'),
        ),
        draftPostId: input.lease.draftPostId,
        baseDraftVersion: input.baseDraftVersion,
        blockId: input.lease.blockId,
        editorUserId: input.lease.holderUserId,
        leaseId: input.lease.leaseId,
        status: 'active',
        contentHashBefore: input.contentHashBefore,
        contentAfter: null,
        startedAt: nowIso,
        updatedAt: nowIso,
        submittedAt: null,
        closedAt: null,
        closeReason: null,
    };
}

function assertSessionTransitionAllowed(
    from: ArgumentBlockRevisionSessionStatus,
    to: ArgumentBlockRevisionSessionStatus,
) {
    if (from === 'active' && (to === 'editing' || to === 'released' || to === 'expired' || to === 'revoked')) return;
    if (from === 'editing' && (to === 'submitted' || to === 'released' || to === 'expired' || to === 'revoked')) return;
    if (from === 'submitted' && (to === 'merged' || to === 'rejected')) return;

    throw new DraftBlockRuntimeError(
        'argument_block_session_invalid_transition',
        'argument_block_session_invalid_transition',
    );
}

export function setArgumentBlockRevisionSessionStatus(input: {
    session: ArgumentBlockRevisionSessionView;
    nextStatus: ArgumentBlockRevisionSessionStatus;
    now: string | Date;
    contentAfter?: string;
    closeReason?: string;
}): ArgumentBlockRevisionSessionView {
    const nowIso = normalizeIsoString(input.now);
    assertSessionTransitionAllowed(input.session.status, input.nextStatus);

    if (input.nextStatus === 'submitted' && !String(input.contentAfter || '').trim()) {
        throw new DraftBlockRuntimeError(
            'argument_block_session_submission_required',
            'argument_block_session_submission_required',
        );
    }

    const closedStatus =
        input.nextStatus === 'merged'
        || input.nextStatus === 'rejected'
        || input.nextStatus === 'released'
        || input.nextStatus === 'expired'
        || input.nextStatus === 'revoked';

    return {
        ...input.session,
        status: input.nextStatus,
        contentAfter:
            input.nextStatus === 'submitted'
                ? String(input.contentAfter || '')
                : input.session.contentAfter,
        updatedAt: nowIso,
        submittedAt: input.nextStatus === 'submitted' ? nowIso : input.session.submittedAt,
        closedAt: closedStatus ? nowIso : input.session.closedAt,
        closeReason: closedStatus
            ? String(input.closeReason || '').trim() || input.session.closeReason || input.nextStatus
            : input.session.closeReason,
    };
}
