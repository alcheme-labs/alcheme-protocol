import {
    SEMANTIC_FACET_VALUES,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from '@/features/discussion-intake/labels/structuredMetadata';

export const DRAFT_CANDIDATE_STATES = [
    'open',
    'pending',
    'proposal_active',
    'accepted',
    'generation_failed',
    'rejected',
    'expired',
    'cancelled',
] as const;

export type DraftCandidateState = (typeof DRAFT_CANDIDATE_STATES)[number];

export type GovernanceRole = 'Owner' | 'Admin' | 'Moderator' | 'Member' | 'Elder' | 'Initiate';

export interface CandidateFailureRecoveryMetadata {
    failedStatus: DraftCandidateState;
    canRetryExecutionRoles: GovernanceRole[];
    retryExecutionReusesPassedProposal: boolean;
    canCancelRoles: GovernanceRole[];
}

export interface DraftCandidateInlineNotice {
    candidateId: string;
    state: DraftCandidateState;
    summary: string | null;
    sourceMessageIds: string[];
    sourceSemanticFacets: SemanticFacet[];
    sourceAuthorAnnotations: AuthorAnnotationKind[];
    lastProposalId: string | null;
    lastExecutionError: string | null;
    draftPostId: number | null;
    // Transitional fallback fields from legacy top-level metadata.
    // Shared permission truth is failureRecovery.*.
    canRetry: boolean;
    canCancel: boolean;
    failureRecovery: CandidateFailureRecoveryMetadata | null;
    governanceCandidateStatus: DraftCandidateState | null;
    governanceProposalStatus: string | null;
}

export interface AcceptedCandidateHandoffContext {
    candidateId: string;
    draftPostId: number;
    sourceMessageIds: string[];
    sourceSemanticFacets: SemanticFacet[];
    sourceAuthorAnnotations: AuthorAnnotationKind[];
    lastProposalId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeState(value: unknown): DraftCandidateState | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (
        normalized === 'open'
        || normalized === 'pending'
        || normalized === 'proposal_active'
        || normalized === 'accepted'
        || normalized === 'generation_failed'
        || normalized === 'rejected'
        || normalized === 'expired'
        || normalized === 'cancelled'
    ) {
        return normalized;
    }
    return null;
}

function normalizeSourceMessageIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const normalized = item.trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
    }
    return Array.from(seen);
}

function normalizeSemanticFacets(value: unknown): SemanticFacet[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<SemanticFacet>();
    for (const item of value) {
        const normalized = String(item || '').trim().toLowerCase();
        if (
            normalized !== 'fact'
            && normalized !== 'explanation'
            && normalized !== 'emotion'
            && normalized !== 'question'
            && normalized !== 'problem'
            && normalized !== 'criteria'
            && normalized !== 'proposal'
            && normalized !== 'summary'
        ) continue;
        seen.add(normalized as SemanticFacet);
    }
    return SEMANTIC_FACET_VALUES.filter((label) => seen.has(label));
}

function normalizeAuthorAnnotations(value: unknown): AuthorAnnotationKind[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<AuthorAnnotationKind>();
    for (const item of value) {
        if (item !== 'fact' && item !== 'explanation' && item !== 'emotion') continue;
        seen.add(item);
    }
    const ordered: AuthorAnnotationKind[] = [];
    if (seen.has('fact')) ordered.push('fact');
    if (seen.has('explanation')) ordered.push('explanation');
    if (seen.has('emotion')) ordered.push('emotion');
    return ordered;
}

function normalizeDraftPostId(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
}

function normalizeGovernanceRole(value: unknown): GovernanceRole | null {
    if (value === 'Owner' || value === 'Admin' || value === 'Moderator'
        || value === 'Member' || value === 'Elder' || value === 'Initiate') {
        return value;
    }
    return null;
}

function normalizeGovernanceRoles(value: unknown): GovernanceRole[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<GovernanceRole>();
    for (const item of value) {
        const role = normalizeGovernanceRole(item);
        if (!role || seen.has(role)) continue;
        seen.add(role);
    }
    return Array.from(seen);
}

function parseFailureRecovery(value: unknown): CandidateFailureRecoveryMetadata | null {
    if (!isRecord(value)) return null;
    const failedStatus = normalizeState(value.failedStatus);
    if (!failedStatus) return null;
    return {
        failedStatus,
        canRetryExecutionRoles: normalizeGovernanceRoles(value.canRetryExecutionRoles),
        retryExecutionReusesPassedProposal: Boolean(value.retryExecutionReusesPassedProposal),
        canCancelRoles: normalizeGovernanceRoles(value.canCancelRoles),
    };
}

export function parseDraftCandidateInlineNotice(input: {
    messageKind?: string | null;
    metadata?: unknown;
}): DraftCandidateInlineNotice | null {
    const messageKind = String(input.messageKind || '').trim();
    if (messageKind !== 'draft_candidate_notice' && messageKind !== 'governance_notice') {
        return null;
    }
    if (!isRecord(input.metadata)) return null;

    const candidateId = typeof input.metadata.candidateId === 'string'
        ? input.metadata.candidateId.trim()
        : '';
    if (!candidateId) return null;

    const state = normalizeState(input.metadata.state);
    if (!state) return null;

    const summary = typeof input.metadata.summary === 'string' && input.metadata.summary.trim()
        ? input.metadata.summary.trim()
        : null;
    const sourceMessageIds = normalizeSourceMessageIds(input.metadata.sourceMessageIds);
    const sourceSemanticFacets = normalizeSemanticFacets(
        input.metadata.sourceSemanticFacets ?? input.metadata.sourceDiscussionLabels,
    );
    const sourceAuthorAnnotations = normalizeAuthorAnnotations(input.metadata.sourceAuthorAnnotations);
    const lastProposalId = typeof input.metadata.lastProposalId === 'string' && input.metadata.lastProposalId.trim()
        ? input.metadata.lastProposalId.trim()
        : null;
    const lastExecutionError = typeof input.metadata.lastExecutionError === 'string'
        && input.metadata.lastExecutionError.trim()
        ? input.metadata.lastExecutionError.trim()
        : null;
    const draftPostId = normalizeDraftPostId(input.metadata.draftPostId);
    const failureRecovery = parseFailureRecovery(input.metadata.failureRecovery);
    const governanceCandidateStatus = normalizeState(input.metadata.governanceCandidateStatus);
    const governanceProposalStatus = typeof input.metadata.governanceProposalStatus === 'string'
        && input.metadata.governanceProposalStatus.trim()
        ? input.metadata.governanceProposalStatus.trim()
        : null;

    return {
        candidateId,
        state,
        summary,
        sourceMessageIds,
        sourceSemanticFacets,
        sourceAuthorAnnotations,
        lastProposalId,
        lastExecutionError,
        draftPostId,
        canRetry: Boolean(input.metadata.canRetry),
        canCancel: Boolean(input.metadata.canCancel ?? input.metadata.canRollback),
        failureRecovery,
        governanceCandidateStatus,
        governanceProposalStatus,
    };
}

export function toAcceptedCandidateHandoffContext(
    notice: DraftCandidateInlineNotice | null,
): AcceptedCandidateHandoffContext | null {
    if (!notice || notice.state !== 'accepted' || !notice.draftPostId) {
        return null;
    }
    return {
        candidateId: notice.candidateId,
        draftPostId: notice.draftPostId,
        sourceMessageIds: notice.sourceMessageIds,
        sourceSemanticFacets: notice.sourceSemanticFacets,
        sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
        lastProposalId: notice.lastProposalId,
    };
}
