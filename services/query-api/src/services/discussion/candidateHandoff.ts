import {
    AUTHOR_ANNOTATION_KINDS,
    type AuthorAnnotationKind,
} from './structuredMessageMetadata';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type SemanticFacet,
} from './analysis/types';

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

export interface AcceptedCandidateHandoff {
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

function normalizeCandidateState(value: unknown): DraftCandidateState | null {
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

function normalizeSourceSemanticFacets(value: unknown): SemanticFacet[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<SemanticFacet>();
    for (const item of value) {
        if (!(DISCUSSION_SEMANTIC_FACETS as readonly string[]).includes(String(item || '').trim())) continue;
        seen.add(String(item || '').trim() as SemanticFacet);
    }
    return DISCUSSION_SEMANTIC_FACETS.filter((label) => seen.has(label));
}

function normalizeSourceAuthorAnnotations(value: unknown): AuthorAnnotationKind[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<AuthorAnnotationKind>();
    for (const item of value) {
        if (!(AUTHOR_ANNOTATION_KINDS as readonly string[]).includes(String(item || '').trim())) continue;
        seen.add(String(item || '').trim() as AuthorAnnotationKind);
    }
    return AUTHOR_ANNOTATION_KINDS.filter((label) => seen.has(label));
}

function normalizePositiveInt(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value <= 0) return null;
    return value;
}

export function parseAcceptedCandidateHandoffMetadata(metadata: unknown): AcceptedCandidateHandoff | null {
    if (!isRecord(metadata)) return null;

    const state = normalizeCandidateState(metadata.state);
    if (state !== 'accepted') return null;

    const candidateId = typeof metadata.candidateId === 'string'
        ? metadata.candidateId.trim()
        : '';
    if (!candidateId) return null;

    const draftPostId = normalizePositiveInt(metadata.draftPostId);
    if (!draftPostId) return null;

    const sourceMessageIds = normalizeSourceMessageIds(metadata.sourceMessageIds);
    const sourceSemanticFacets = normalizeSourceSemanticFacets(
        metadata.sourceSemanticFacets ?? metadata.sourceDiscussionLabels,
    );
    const sourceAuthorAnnotations = normalizeSourceAuthorAnnotations(
        metadata.sourceAuthorAnnotations,
    );
    const lastProposalId = typeof metadata.lastProposalId === 'string' && metadata.lastProposalId.trim()
        ? metadata.lastProposalId.trim()
        : null;

    return {
        candidateId,
        draftPostId,
        sourceMessageIds,
        sourceSemanticFacets,
        sourceAuthorAnnotations,
        lastProposalId,
    };
}
