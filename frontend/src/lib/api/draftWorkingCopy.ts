import { apiFetch } from './fetch.ts';
export interface AcceptedCandidateSeedView {
    candidateId: string;
    draftPostId: number;
    sourceMessageIds: string[];
    sourceSemanticFacets: Array<'fact' | 'explanation' | 'emotion' | 'question' | 'problem' | 'criteria' | 'proposal' | 'summary'>;
    sourceAuthorAnnotations: Array<'fact' | 'explanation' | 'emotion'>;
    lastProposalId: string | null;
    acceptedAt: string;
}

export interface DraftStableSnapshotView {
    draftVersion: number;
    sourceKind: 'accepted_candidate_v1_seed' | 'review_bound_snapshot' | null;
    seedDraftAnchorId: string | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    contentHash: string | null;
    createdAt: string | null;
}

export interface DraftWorkingCopyView {
    workingCopyId: string;
    draftPostId: number;
    basedOnSnapshotVersion: number;
    workingCopyContent: string;
    workingCopyHash: string;
    status: 'active';
    roomKey: string;
    latestEditAnchorId: string | null;
    latestEditAnchorStatus: string | null;
    updatedAt: string;
}

export interface DraftReviewBindingView {
    boundSnapshotVersion: number;
    totalThreadCount: number;
    openThreadCount: number;
    proposedThreadCount: number;
    acceptedThreadCount: number;
    appliedThreadCount: number;
    mismatchedApplicationCount: number;
    latestThreadUpdatedAt: string | null;
}

export interface ResumableCrystallizationAttemptView {
    proofPackageHash: string;
    knowledgeId: string | null;
    knowledgeOnChainAddress: string;
    status:
        | 'submitted'
        | 'binding_pending'
        | 'binding_synced'
        | 'references_synced'
        | 'references_failed'
        | 'finalization_failed';
    failureCode?: string | null;
    failureMessage?: string | null;
}

export interface DraftLifecycleReadModel {
    draftPostId: number;
    circleId: number | null;
    documentStatus:
        | 'drafting'
        | 'review'
        | 'crystallization_active'
        | 'crystallization_failed'
        | 'crystallized'
        | 'archived';
    currentSnapshotVersion: number;
    currentRound: number;
    policyProfileDigest?: string | null;
    reviewEntryMode: 'auto_only' | 'manual_only' | 'auto_or_manual';
    draftingEndsAt: string | null;
    reviewEndsAt: string | null;
    reviewWindowExpiredAt: string | null;
    transitionMode:
        | 'seeded'
        | 'auto_lock'
        | 'manual_lock'
        | 'manual_extend'
        | 'archived'
        | 'review_window_elapsed'
        | 'enter_crystallization'
        | 'crystallization_succeeded'
        | 'crystallization_failed'
        | 'rollback_to_review'
        | null;
    handoff: AcceptedCandidateSeedView | null;
    stableSnapshot: DraftStableSnapshotView;
    workingCopy: DraftWorkingCopyView;
    reviewBinding: DraftReviewBindingView;
    resumableCrystallizationAttempt?: ResumableCrystallizationAttemptView | null;
    warnings: string[];
}

export class DraftLifecycleRequestError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string | null,
        public readonly payload: any,
    ) {
        super(message);
        this.name = 'DraftLifecycleRequestError';
    }
}

function getQueryApiBaseUrl(): string {
    const graphqlEndpoint = process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://127.0.0.1:4000/graphql';
    try {
        return new URL(graphqlEndpoint).origin;
    } catch {
        return 'http://127.0.0.1:4000';
    }
}

async function requestDraftLifecycle(
    path: string,
    init?: RequestInit,
): Promise<DraftLifecycleReadModel> {
    const response = await apiFetch(path, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.reason === 'string'
                ? payload.reason
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new DraftLifecycleRequestError(
            message,
            response.status,
            typeof payload?.error === 'string' ? payload.error : null,
            payload,
        );
    }
    return payload.lifecycle as DraftLifecycleReadModel;
}

export async function fetchDraftLifecycle(input: {
    draftPostId: number;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}`,
        {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        },
    );
}

export async function enterDraftLifecycleReview(input: {
    draftPostId: number;
    confirmApplyAcceptedGhostThreads?: boolean;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/enter-review`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                confirmApplyAcceptedGhostThreads: Boolean(input.confirmApplyAcceptedGhostThreads),
            }),
        },
    );
}

export async function advanceDraftLifecycleReview(input: {
    draftPostId: number;
    confirmApplyAcceptedGhostThreads?: boolean;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/advance-review`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                confirmApplyAcceptedGhostThreads: Boolean(input.confirmApplyAcceptedGhostThreads),
            }),
        },
    );
}

export async function enterDraftLifecycleCrystallization(input: {
    draftPostId: number;
    anchorSignature: string;
    policyProfileDigest: string;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/enter-crystallization`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anchorSignature: input.anchorSignature,
                policyProfileDigest: input.policyProfileDigest,
            }),
        },
    );
}

export async function failDraftLifecycleCrystallization(input: {
    draftPostId: number;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/fail-crystallization`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
        },
    );
}

export async function retryDraftLifecycleCrystallization(input: {
    draftPostId: number;
    anchorSignature: string;
    policyProfileDigest: string;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/retry-crystallization`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anchorSignature: input.anchorSignature,
                policyProfileDigest: input.policyProfileDigest,
            }),
        },
    );
}

export async function repairDraftLifecycleCrystallizationEvidence(input: {
    draftPostId: number;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/repair-crystallization-evidence`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
        },
    );
}

export async function rollbackDraftLifecycleCrystallization(input: {
    draftPostId: number;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/rollback-crystallization`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
        },
    );
}

export async function archiveDraftLifecycle(input: {
    draftPostId: number;
    anchorSignature: string;
    policyProfileDigest: string;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/archive`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anchorSignature: input.anchorSignature,
                policyProfileDigest: input.policyProfileDigest,
            }),
        },
    );
}

export async function restoreDraftLifecycle(input: {
    draftPostId: number;
    anchorSignature: string;
    policyProfileDigest: string;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/restore`,
        {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anchorSignature: input.anchorSignature,
                policyProfileDigest: input.policyProfileDigest,
            }),
        },
    );
}
