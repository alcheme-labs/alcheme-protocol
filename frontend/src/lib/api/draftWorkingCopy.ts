import { authenticatedApiFetch } from './fetch.ts';
import type { RevisionDirectionAcceptActionType } from './draftRuntime.ts';
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
    crystallizationRoutingReceipt: ({
        schemaVersion: 1 | 2;
        path: 'ordinary_knowledge';
        actionIntent: 'none';
        humanConfirmed: true;
        draftPostId: number;
        draftVersion: number;
        snapshotContentHash: string;
        policyProfileDigest: string;
        actorUserId: number;
        reasonCodes:
            | ['no_structured_action_intent', 'ordinary_collaboration_confirmed']
            | [
                'no_structured_action_intent',
                'ordinary_collaboration_confirmed',
                'failed_retry_submit_authority_superseded',
            ];
        supersededReceipts?: Array<{
            receiptDigest: string;
            actorUserId: number;
            evaluatedAt: string;
        }>;
        evaluatedAt: string;
        receiptDigest: string;
    } | {
        schemaVersion: 1;
        path: 'governed_case';
        actionIntent: RevisionDirectionAcceptActionType;
        humanConfirmed: true;
        draftPostId: number;
        draftVersion: number;
        snapshotContentHash: string;
        policyProfileDigest: string;
        actorUserId: number;
        actionType: RevisionDirectionAcceptActionType;
        targetType: 'revision_direction';
        targetRef: string;
        payloadDigest: string;
        governancePolicyId: string;
        governancePolicyVersionId: string;
        governancePolicyVersion: number;
        governanceRuleId: string;
        contractVersionId: string;
        authorityBindingId: string;
        profileBindingId: string;
        invocationId: string;
        requestId: string;
        caseId: string;
        reasonCodes: [
            'registered_action_intent_confirmed',
            'active_governance_binding_resolved',
            'lossless_case_upgrade',
        ];
        evaluatedAt: string;
        receiptDigest: string;
    }) | null;
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
        | 'authorization_ready'
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
    briefLock?: {
        caseId: string;
        casePhase: string;
        canReturnToDrafting: boolean;
        canArchive: boolean;
        canCrystallize: boolean;
    } | null;
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
    const response = await authenticatedApiFetch(path, init);
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
    discussionAccessToken?: string | null;
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}`,
        {
            method: 'GET',
            cache: 'no-store',
            headers: input.discussionAccessToken
                ? { Authorization: `Bearer ${input.discussionAccessToken}` }
                : undefined,
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
    routingConfirmation: {
        path: 'ordinary_knowledge';
        actionIntent: null;
        humanConfirmed: true;
    } | {
        path: 'governed_case';
        actionIntent: {
            actionType: RevisionDirectionAcceptActionType;
            targetType: 'revision_direction';
            targetRef: string;
            requestId: string;
            requestedEffect: 'accept_revision_direction';
            collectiveCommitmentRequired: true;
        };
        humanConfirmed: true;
    };
}): Promise<DraftLifecycleReadModel> {
    const baseUrl = getQueryApiBaseUrl();
    return requestDraftLifecycle(
        `${baseUrl}/api/v1/draft-lifecycle/drafts/${input.draftPostId}/enter-crystallization`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anchorSignature: input.anchorSignature,
                policyProfileDigest: input.policyProfileDigest,
                routingConfirmation: input.routingConfirmation,
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
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                anchorSignature: input.anchorSignature,
                policyProfileDigest: input.policyProfileDigest,
            }),
        },
    );
}
