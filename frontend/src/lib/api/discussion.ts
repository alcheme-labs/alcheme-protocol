import { apiFetch, authenticatedApiFetch } from './fetch.ts';
import { resolveNodeRoute, type NodeRoutingSurface } from './nodeRouting.ts';
import type { SemanticFacet } from '../../features/discussion-intake/labels/structuredMetadata.ts';
import type { DiscussionAnchoredInteractionDto as AnchoredInteractionDto } from '../../features/anchored-interactions/types.ts';
import type {
    CircleIdentityDisplayState,
    CircleIdentityLevelValue,
    CircleMembershipSourceValue,
    CircleRoleValue,
} from '../circle/identityTypes.ts';
import type {
    ContributionAssessmentGateView,
    ContributionAssessmentView,
} from '../../features/contribution-trace/adapter.ts';
export type {
    DiscussionAnchoredInteractionDto,
    AnchoredInteractionDetailDto,
    DiscussionAnchoredInteractionsResponse,
    InteractionResultNoticeView,
    PlazaAnchoredInteractionType,
} from '../../features/anchored-interactions/types.ts';
export {
    appendAnchoredInteractionEvent,
    createAnchoredInteraction,
    fetchAnchoredInteractionDetail,
    fetchAnchoredInteractions,
    fetchAnchoredSuggestionDecisions,
    lookupAnchoredInteractions,
    resolveAnchoredInteraction,
} from './anchoredInteractions.ts';
export type {
    AnchoredSuggestionDecisionsResponse,
    FetchAnchoredSuggestionDecisionsInput,
} from './anchoredInteractions.ts';

export interface DiscussionMessageDto {
    envelopeId: string;
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    senderHandle: string | null;
    senderDisplayName?: string | null;
    senderCircleAlias?: string | null;
    senderEffectiveDisplayName?: string | null;
    senderDisplaySource?: string | null;
    senderDisplayCircleId?: number | null;
    senderIdentityLevel?: CircleIdentityLevelValue | null;
    senderIdentityDisplayName?: string | null;
    senderIdentityState?: CircleIdentityDisplayState | null;
    senderMembershipSource?: CircleMembershipSourceValue | null;
    senderMembershipCircleId?: number | null;
    senderRole?: CircleRoleValue | null;
    senderRoleDisplayName?: string | null;
    text: string;
    payloadHash: string;
    nonce: string;
    signature: string | null;
    signatureVerified: boolean;
    authMode?: string;
    sessionId?: string | null;
    relevanceScore?: number | null;
    semanticScore?: number | null;
    qualityScore?: number | null;
    spamScore?: number | null;
    decisionConfidence?: number | null;
    relevanceMethod?: string | null;
    relevanceStatus?: 'pending' | 'ready' | 'stale' | 'failed' | null;
    embeddingScore?: number | null;
    actualMode?: string | null;
    analysisVersion?: string | null;
    topicProfileVersion?: string | null;
    semanticFacets?: SemanticFacet[] | null;
    focusScore?: number | null;
    focusLabel?: 'focused' | 'contextual' | 'off_topic' | null;
    analysisCompletedAt?: string | null;
    analysisErrorCode?: string | null;
    analysisErrorMessage?: string | null;
    authorAnnotations?: Array<{ kind: 'fact' | 'explanation' | 'emotion'; source: 'author' }> | null;
    isFeatured?: boolean;
    usefulCount?: number | null;
    viewerHasMarkedUseful?: boolean | null;
    featureReason?: string | null;
    featuredAt?: string | null;
    isEphemeral?: boolean;
    expiresAt?: string | null;
    clientTimestamp: string;
    lamport: number;
    prevEnvelopeId: string | null;
    deleted: boolean;
    tombstoneReason: string | null;
    tombstonedAt: string | null;
    createdAt: string;
    updatedAt: string;
    messageKind?: string | null;
    metadata?: Record<string, unknown> | null;
    anchoredInteractions?: AnchoredInteractionDto[] | null;
    subjectType?: string | null;
    subjectId?: string | null;
    forwardCard?: {
        sourceEnvelopeId: string | null;
        sourceCircleId: number | null;
        sourceCircleName: string | null;
        sourceLevel: number | null;
        sourceAuthorHandle: string | null;
        forwarderHandle: string | null;
        sourceMessageCreatedAt: string | null;
        forwardedAt: string | null;
        sourceDeleted: boolean;
        snapshotText: string;
    } | null;
    forwardBundleCard?: {
        bundleId: string;
        sourceCircleId: number | null;
        sourceCircleName: string | null;
        sourceLevel: number | null;
        forwarderHandle: string | null;
        forwardedAt: string | null;
        itemCount: number;
        sourceItems: Array<{
            sourceEnvelopeId: string;
            sourceAuthorPubkey: string;
            sourceAuthorDisplayName: string | null;
            sourceAuthorDisplaySource: string | null;
            sourceAuthorDisplayCircleId: number | null;
            sourceMessageCreatedAt: string | null;
            snapshotText: string;
            snapshotTruncated: boolean;
            sourceDeleted: boolean;
        }>;
    } | null;
}

export interface DiscussionMessagesResponse {
    circleId: number;
    roomKey: string;
    count: number;
    watermark: {
        lastLamport: number;
        lastEnvelopeId: string | null;
        lastIngestedAt: string | null;
    } | null;
    messages: DiscussionMessageDto[];
}

export interface KnowledgeDiscussionMessagesResponse extends DiscussionMessagesResponse {
    knowledgeId: string;
}

export interface DiscussionSendResponse {
    ok: boolean;
    message: DiscussionMessageDto;
}

export interface DiscussionForwardResponse {
    ok: boolean;
    message: DiscussionMessageDto;
}

export interface DiscussionForwardBundleResponse extends DiscussionForwardResponse {
    status: 'created' | 'existing';
    bundleId: string;
}

export interface DiscussionClientWriteIdentity {
    clientTimestamp: string;
    nonce: string;
}

export interface DraftStrictWarning {
    code: string;
    message: string;
    details?: Record<string, unknown>;
}

export interface DraftPublishReadinessResponse {
    ready: boolean;
    message?: string;
    mode?: 'off' | 'warn' | 'enforce';
    warning?: DraftStrictWarning;
}

export interface DraftContributorProofPayload {
    circleId: number;
    rootHex: string;
    count: number;
}

export interface DraftContributorProofResponse {
    ok: boolean;
    mode?: 'off' | 'warn' | 'enforce';
    proof: DraftContributorProofPayload | null;
    warning?: DraftStrictWarning;
}

export interface DraftProofPackageResponse {
    ok: boolean;
    mode?: 'off' | 'warn' | 'enforce';
    draftPostId?: number;
    root?: string;
    count?: number;
    proof_package_hash?: string;
    source_anchor_id?: string;
    binding_version?: number;
    generated_at?: string;
    issuer_key_id?: string;
    issued_signature?: string;
    proofPackage?: Record<string, unknown> | null;
    warning?: DraftStrictWarning;
}

export interface DraftContributionAssessmentDecisionRecord {
    id: string;
    assessmentId: string;
    decisionType: string;
    candidateId: string | null;
    actorUserId: number | null;
    actorPubkey: string | null;
    reason: string | null;
    affectedRefs: string[];
    createdAt: string;
}

export interface DraftContributionAssessmentResponse {
    ok: boolean;
    mode?: 'off' | 'warn' | 'enforce';
    draftPostId: number;
    assessment: ContributionAssessmentView | null;
    decisions: DraftContributionAssessmentDecisionRecord[];
    gate: ContributionAssessmentGateView;
}

export interface DraftContributionAssessmentDecisionResponse extends DraftContributionAssessmentResponse {
    decision: DraftContributionAssessmentDecisionRecord;
}

export interface DraftCrystallizationBindingResponse {
    ok: boolean;
    draftPostId: number;
    mode?: 'off' | 'warn' | 'enforce';
    proofBindingMode?: 'off' | 'warn' | 'enforce';
    contributionAssessmentMode?: 'legacy' | 'shadow' | 'enforce';
    sourceContentId: string;
    knowledgeId: string;
    sourceDraftHeatScore: number;
    knowledgeHeatScore: number;
}

export interface DraftCrystallizationAttemptRegistrationResponse {
    ok: boolean;
    draftPostId: number;
    attempt: {
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
            | 'finalization_failed'
            | 'finalized';
        failureCode?: string | null;
        failureMessage?: string | null;
    };
}

export interface KnowledgePublicationAuthorizationResponse {
    ok: boolean;
    authorization: {
        chainId: 'solana:localnet' | 'solana:devnet';
        draftPostId: number;
        targetCircleId: number;
        draftVersion: number;
        draftSnapshotDigest: string;
        proofPackageHash: string;
        contributorsRoot: string;
        contributorsCount: number;
        contributorPubkeys: string[];
        contentHash: string;
        title: string;
        description: string;
        sourceSnapshotDigest: string;
        publicationOriginDigest: string;
        aiDerivationDigest: string | null;
        license: {
            ref: string;
            version: string;
            rightsRetainedByContributors: true;
            publicDisplayAuthorized: true;
            adaptationAuthorized: false;
            commercialUseAuthorized: false;
            nftUseAuthorized: false;
            finalProductionLegalReview: 'required';
        };
    };
    authorizationDigest: string;
    acceptedContributorPubkeys: string[];
    missingContributorPubkeys: string[];
    actorSigningEnvelope: {
        signedMessage: string;
        nonce: string;
        expiresAt: string;
    } | null;
}

export interface ManualDraftSourceConsumption {
    sourceMessagesDigest: string;
    sourceMessageIds: string[];
    filteredSourceMessageIds?: string[];
    partialOverlapSourceMessageIds?: string[];
    blocking: boolean;
    advanceAutoCursor?: boolean;
}

export type DraftCandidateCreateDraftResult =
    | {
        status: 'created';
        candidateId: string;
        draftPostId: number;
        created: true;
        ghostDraftGenerationId: null;
        sourceConsumption?: ManualDraftSourceConsumption;
    }
    | {
        status: 'existing';
        candidateId: string;
        draftPostId: number;
        created: false;
        ghostDraftGenerationId: null;
        sourceConsumption?: ManualDraftSourceConsumption;
    }
    | {
        status: 'pending';
        candidateId: string;
        attemptId: number;
        claimedUntil: string;
        created: false;
        sourceConsumption?: ManualDraftSourceConsumption;
    }
    | {
        status: 'generation_failed';
        candidateId: string;
        canRetry: boolean;
        draftGenerationError: string;
        created: false;
        sourceConsumption?: ManualDraftSourceConsumption;
    };

export interface DraftCandidateCreateDraftResponse {
    ok: boolean;
    result: DraftCandidateCreateDraftResult;
}

export interface DraftCandidateCancelResponse {
    ok: boolean;
    result: {
        status: 'cancelled';
        candidateId: string;
        cancelled: true;
    };
}

export interface DraftCandidateSourceScope {
    viewMode?: string | null;
    visibleMessageCount?: number | null;
    filterLabels?: string[] | null;
}

export type DraftDiscussionState = 'open' | 'proposed' | 'accepted' | 'rejected' | 'applied' | 'withdrawn';
export type DraftDiscussionTargetType = 'paragraph' | 'structure' | 'document';
export type DraftDiscussionResolution = 'accepted' | 'rejected';
export type DraftDiscussionIssueType =
    | 'fact_correction'
    | 'expression_improvement'
    | 'knowledge_supplement'
    | 'question_and_supplement';

export interface DraftDiscussionMessageRecord {
    id: string;
    authorId: number;
    messageType: string;
    content: string | null;
    createdAt: string;
}

export interface DraftDiscussionThreadRecord {
    id: string;
    draftPostId: number;
    targetType: DraftDiscussionTargetType;
    targetRef: string;
    targetVersion: number;
    issueType: DraftDiscussionIssueType;
    state: DraftDiscussionState;
    createdBy: number;
    createdAt: string;
    updatedAt: string;
    latestResolution: {
        resolvedBy: number;
        toState: DraftDiscussionResolution;
        reason: string | null;
        resolvedAt: string;
    } | null;
    latestApplication: {
        appliedBy: number;
        appliedEditAnchorId: string;
        appliedSnapshotHash: string;
        appliedDraftVersion: number;
        reason: string | null;
        appliedAt: string;
    } | null;
    latestMessage: {
        authorId: number;
        messageType: string;
        content: string | null;
        createdAt: string;
    } | null;
    messages: DraftDiscussionMessageRecord[];
    reviewContext?: {
        state: 'unchanged' | 'changed' | 'unavailable';
        currentVersion: number | null;
        targetAtCreation: string | null;
        targetCurrent: string | null;
    };
}

export interface DraftDiscussionListResponse {
    ok: boolean;
    draftPostId: number;
    viewerUserId?: number | null;
    count: number;
    threads: DraftDiscussionThreadRecord[];
}

export interface DiscussionSessionResponse {
    ok: boolean;
    sessionId: string;
    senderPubkey: string;
    scope: string;
    expiresAt: string;
    discussionAccessToken: string;
    signatureVerified?: boolean;
    refreshed?: boolean;
}

export interface DiscussionSigningPayload {
    v: 1;
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    text: string;
    clientTimestamp: string;
    nonce: string;
    prevEnvelopeId: string | null;
    subjectType?: 'knowledge' | 'discussion_message';
    subjectId?: string;
}

export interface DiscussionTombstonePayload {
    v: 1;
    action: 'tombstone';
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    envelopeId: string;
    reason: string;
    clientTimestamp: string;
}

export interface DiscussionSessionBootstrapPayload {
    v: 1;
    action: 'session_init';
    senderPubkey?: string;
    scope: string;
    clientTimestamp: string;
    nonce: string;
}

async function getNodeBaseUrl(surface: NodeRoutingSurface): Promise<string> {
    const route = await resolveNodeRoute(surface);
    return route.urlBase;
}

export async function getDiscussionProtocolBaseUrl(): Promise<string> {
    return getNodeBaseUrl('discussion_protocol');
}

function buildRoomKey(circleId: number): string {
    return `circle:${circleId}`;
}

async function fetchDiscussionJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const response = await authenticatedApiFetch(input, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        const error = new Error(message) as Error & {
            code?: string;
            status?: number;
            details?: unknown;
        };
        if (typeof payload?.error === 'string') {
            error.code = payload.error;
        }
        error.status = response.status;
        if (payload && typeof payload === 'object' && 'details' in payload) {
            error.details = (payload as Record<string, unknown>).details;
        }
        throw error;
    }
    return payload as T;
}

function buildDiscussionJsonHeaders(discussionAccessToken?: string | null): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (discussionAccessToken) {
        headers.Authorization = `Bearer ${discussionAccessToken}`;
    }
    return headers;
}

function normalizeMessageText(text: string): string {
    return text.replace(/\r\n/g, '\n').trim();
}

function randomNonce(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}

export function createDiscussionClientWriteIdentity(now: Date = new Date()): DiscussionClientWriteIdentity {
    return {
        clientTimestamp: now.toISOString(),
        nonce: randomNonce(),
    };
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function buildDiscussionSigningPayload(input: {
    circleId: number;
    senderPubkey: string;
    text: string;
    clientTimestamp: string;
    nonce: string;
    prevEnvelopeId?: string | null;
    subjectType?: 'knowledge' | 'discussion_message';
    subjectId?: string;
}): DiscussionSigningPayload {
    const payload: DiscussionSigningPayload = {
        v: 1,
        roomKey: buildRoomKey(input.circleId),
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        text: normalizeMessageText(input.text),
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
        prevEnvelopeId: input.prevEnvelopeId ?? null,
    };
    if (input.subjectType) {
        payload.subjectType = input.subjectType;
    }
    if (input.subjectId) {
        payload.subjectId = input.subjectId;
    }
    return payload;
}

export function buildDiscussionSigningMessage(payload: DiscussionSigningPayload): string {
    return `alcheme-discussion:${JSON.stringify(payload)}`;
}

export function buildDiscussionTombstonePayload(input: {
    circleId: number;
    senderPubkey: string;
    envelopeId: string;
    reason: string;
    clientTimestamp: string;
}): DiscussionTombstonePayload {
    return {
        v: 1,
        action: 'tombstone',
        roomKey: buildRoomKey(input.circleId),
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        envelopeId: input.envelopeId,
        reason: input.reason,
        clientTimestamp: input.clientTimestamp,
    };
}

export function buildDiscussionTombstoneMessage(payload: DiscussionTombstonePayload): string {
    return `alcheme-discussion-action:${JSON.stringify(payload)}`;
}

export function buildDiscussionSessionBootstrapPayload(input: {
    senderPubkey?: string;
    scope?: string;
    clientTimestamp: string;
    nonce: string;
}): DiscussionSessionBootstrapPayload {
    const payload: DiscussionSessionBootstrapPayload = {
        v: 1,
        action: 'session_init',
        scope: input.scope || 'circle:*',
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
    };
    if (input.senderPubkey) {
        payload.senderPubkey = input.senderPubkey;
    }
    return payload;
}

export function buildDiscussionSessionBootstrapMessage(payload: DiscussionSessionBootstrapPayload): string {
    return `alcheme-discussion-session:${JSON.stringify(payload)}`;
}

function normalizeDiscussionMessageDto(message: DiscussionMessageDto): DiscussionMessageDto {
    return {
        ...message,
        sessionId: null,
        forwardCard: message.forwardCard || null,
        forwardBundleCard: message.forwardBundleCard || null,
    };
}

function normalizeDiscussionMessagesResponse<T extends DiscussionMessagesResponse>(
    payload: T,
): T {
    return {
        ...payload,
        messages: Array.isArray(payload.messages)
            ? payload.messages.map((message) => normalizeDiscussionMessageDto(message))
            : [],
    };
}

function normalizeDiscussionSendResponse<T extends DiscussionSendResponse | DiscussionForwardResponse>(
    payload: T,
): T {
    return {
        ...payload,
        message: normalizeDiscussionMessageDto(payload.message),
    };
}

export async function signDiscussionMessage(input: {
    signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined;
    message: string;
}): Promise<string | null> {
    if (!input.signMessage) return null;
    const signature = await input.signMessage(new TextEncoder().encode(input.message));
    return bytesToBase64(signature);
}

export async function fetchDiscussionMessages(input: {
    circleId: number;
    limit?: number;
    includeDeleted?: boolean;
    beforeLamport?: number;
    afterLamport?: number;
}): Promise<DiscussionMessagesResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const query = new URLSearchParams();
    query.set('limit', String(input.limit ?? 80));
    if (input.includeDeleted) query.set('includeDeleted', 'true');
    if (typeof input.beforeLamport === 'number' && Number.isFinite(input.beforeLamport)) {
        query.set('beforeLamport', String(Math.max(1, Math.trunc(input.beforeLamport))));
    }
    if (typeof input.afterLamport === 'number' && Number.isFinite(input.afterLamport)) {
        query.set('afterLamport', String(Math.max(0, Math.trunc(input.afterLamport))));
    }

    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/messages?${query.toString()}`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        throw new Error(`fetch discussion messages failed: ${response.status}`);
    }
    return normalizeDiscussionMessagesResponse(await response.json());
}

export async function fetchDiscussionMessagesByEnvelopeIds(input: {
    circleId: number;
    envelopeIds: string[];
    includeDeleted?: boolean;
}): Promise<DiscussionMessagesResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const normalizedEnvelopeIds = input.envelopeIds
        .map((envelopeId) => String(envelopeId || '').trim())
        .filter((envelopeId) => envelopeId.length > 0);
    if (normalizedEnvelopeIds.length === 0) {
        return {
            circleId: input.circleId,
            roomKey: `circle:${input.circleId}`,
            count: 0,
            watermark: null,
            messages: [],
        };
    }

    const query = new URLSearchParams();
    query.set('envelopeIds', normalizedEnvelopeIds.join(','));
    if (input.includeDeleted) query.set('includeDeleted', 'true');

    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/messages/lookup?${query.toString()}`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        throw new Error(`fetch discussion message lookup failed: ${response.status}`);
    }
    return normalizeDiscussionMessagesResponse(await response.json());
}

export async function fetchKnowledgeDiscussionMessages(input: {
    knowledgeId: string;
    limit?: number;
    includeDeleted?: boolean;
}): Promise<KnowledgeDiscussionMessagesResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_protocol');
    const query = new URLSearchParams();
    query.set('limit', String(input.limit ?? 80));
    if (input.includeDeleted) query.set('includeDeleted', 'true');

    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/knowledge/${encodeURIComponent(input.knowledgeId)}/messages?${query.toString()}`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`fetch knowledge discussion messages failed: ${response.status} ${body}`);
    }
    return normalizeDiscussionMessagesResponse(await response.json());
}

export async function forwardDiscussionMessage(input: {
    envelopeId: string;
    targetCircleId: number;
}): Promise<DiscussionForwardResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_protocol');
    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/messages/${encodeURIComponent(input.envelopeId)}/forward`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                targetCircleId: input.targetCircleId,
            }),
        },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`forward discussion message failed: ${response.status} ${body}`);
    }
    return normalizeDiscussionSendResponse(await response.json());
}

export async function forwardDiscussionMessagesBatch(input: {
    sourceEnvelopeIds: string[];
    targetCircleId: number;
}): Promise<DiscussionForwardBundleResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_protocol');
    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/messages/forward-batch`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sourceEnvelopeIds: input.sourceEnvelopeIds,
                targetCircleId: input.targetCircleId,
            }),
        },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`forward discussion messages failed: ${response.status} ${body}`);
    }
    return normalizeDiscussionSendResponse(await response.json());
}

export async function fetchDraftPublishReadiness(input: {
    draftPostId: number;
}): Promise<DraftPublishReadinessResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftPublishReadinessResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/publish-readiness`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
}

export async function fetchDraftContributorProof(input: {
    draftPostId: number;
}): Promise<DraftContributorProofResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftContributorProofResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/contributor-proof`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
}

export async function fetchDraftProofPackage(input: {
    draftPostId: number;
}): Promise<DraftProofPackageResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftProofPackageResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/proof-package`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
}

export async function fetchDraftContributionAssessment(input: {
    draftPostId: number;
}): Promise<DraftContributionAssessmentResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftContributionAssessmentResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/contribution-assessment`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
}

export async function recordDraftContributionAssessmentDecision(input: {
    draftPostId: number;
    assessmentId?: string | null;
    decisionType: string;
    reason?: string | null;
    affectedRefs?: string[] | null;
}): Promise<DraftContributionAssessmentDecisionResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftContributionAssessmentDecisionResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/contribution-assessment/decisions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                assessmentId: input.assessmentId ?? null,
                decisionType: input.decisionType,
                reason: input.reason ?? null,
                affectedRefs: input.affectedRefs ?? null,
            }),
        },
    );
}

export async function submitDraftCrystallizationBinding(input: {
    draftPostId: number;
    knowledgePda: string;
    proofPackageHash?: string;
    sourceAnchorId?: string;
    contributorsRoot?: string;
    contributorsCount?: number;
    bindingVersion?: number;
    generatedAt?: string;
    issuerKeyId?: string;
    issuedSignature?: string;
    proofPackage?: Record<string, unknown> | null;
}): Promise<DraftCrystallizationBindingResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftCrystallizationBindingResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/crystallization-binding`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                knowledgePda: input.knowledgePda,
                proofPackageHash: input.proofPackageHash,
                sourceAnchorId: input.sourceAnchorId,
                contributorsRoot: input.contributorsRoot,
                contributorsCount: input.contributorsCount,
                bindingVersion: input.bindingVersion,
                generatedAt: input.generatedAt,
                issuerKeyId: input.issuerKeyId,
                issuedSignature: input.issuedSignature,
                proofPackage: input.proofPackage,
            }),
        },
    );
}

export async function registerDraftCrystallizationAttempt(input: {
    draftPostId: number;
    knowledgePda: string;
    proofPackageHash: string;
}): Promise<DraftCrystallizationAttemptRegistrationResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftCrystallizationAttemptRegistrationResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/crystallization-attempt`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                knowledgePda: input.knowledgePda,
                proofPackageHash: input.proofPackageHash,
            }),
        },
    );
}

export async function prepareKnowledgePublicationAuthorization(input: {
    draftPostId: number;
    title: string;
    description: string;
    contentHash: string;
}): Promise<KnowledgePublicationAuthorizationResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<KnowledgePublicationAuthorizationResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/publication-license/prepare`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    );
}

export async function acceptKnowledgePublicationLicense(input: {
    draftPostId: number;
    title: string;
    description: string;
    contentHash: string;
    signedMessage: string;
    signature: string;
    nonce: string;
    expiresAt: string;
}): Promise<KnowledgePublicationAuthorizationResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<KnowledgePublicationAuthorizationResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/publication-license/accept`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    );
}

export async function authorizeKnowledgePublicationAttempt(input: {
    draftPostId: number;
    title: string;
    description: string;
    contentHash: string;
    knowledgePda: string;
}): Promise<KnowledgePublicationAuthorizationResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<KnowledgePublicationAuthorizationResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/publication-authorization`,
        {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        },
    );
}

export async function createDraftFromCandidate(input: {
    circleId: number;
    candidateId: string;
}): Promise<DraftCandidateCreateDraftResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftCandidateCreateDraftResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/candidates/${encodeURIComponent(input.candidateId)}/create-draft`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );
}

export async function cancelDraftCandidate(input: {
    circleId: number;
    candidateId: string;
}): Promise<DraftCandidateCancelResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftCandidateCancelResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/candidates/${encodeURIComponent(input.candidateId)}/cancel`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
        },
    );
}

export async function createDraftFromDiscussionMessages(input: {
    circleId: number;
    sourceMessageIds: string[];
    sourceScope?: DraftCandidateSourceScope | null;
}): Promise<DraftCandidateCreateDraftResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftCandidateCreateDraftResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/drafts/from-messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sourceMessageIds: input.sourceMessageIds,
                sourceScope: input.sourceScope ?? null,
            }),
        },
    );
}

export async function createDraftFromCommunicationSourceMaterials(input: {
    circleId: number;
    sourceMaterialIds: number[];
}): Promise<DraftCandidateCreateDraftResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftCandidateCreateDraftResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/drafts/from-messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sourceCarrier: 'communication_message',
                sourceMaterialIds: input.sourceMaterialIds,
            }),
        },
    );
}

export async function createComposeDraft(input: {
    circleId: number;
    text: string;
    draftTitle?: string;
    clientRequestId?: string;
}): Promise<{ ok: true; result: { draftPostId: number } }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: true; result: { draftPostId: number } }>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/drafts`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: input.text,
                ...(input.draftTitle ? { draftTitle: input.draftTitle } : {}),
                ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
            }),
        },
    );
}

export async function listDraftDiscussions(input: {
    draftPostId: number;
    limit?: number;
    discussionAccessToken?: string | null;
}): Promise<DraftDiscussionListResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    const query = new URLSearchParams();
    query.set('limit', String(input.limit ?? 50));
    return fetchDiscussionJson<DraftDiscussionListResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions?${query.toString()}`,
        {
            method: 'GET',
            cache: 'no-store',
            headers: buildDiscussionJsonHeaders(input.discussionAccessToken || undefined),
        },
    );
}

export async function createDraftDiscussion(input: {
    draftPostId: number;
    targetType: DraftDiscussionTargetType;
    targetRef: string;
    targetVersion?: number;
    issueType: DraftDiscussionIssueType;
    content: string;
}): Promise<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                targetType: input.targetType,
                targetRef: input.targetRef,
                targetVersion: input.targetVersion,
                issueType: input.issueType,
                content: input.content,
            }),
        },
    );
}

export async function proposeDraftDiscussion(input: {
    draftPostId: number;
    threadId: string;
    issueType?: DraftDiscussionIssueType;
    content: string;
}): Promise<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions/${encodeURIComponent(input.threadId)}/propose`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                issueType: input.issueType,
                content: input.content,
            }),
        },
    );
}

export async function resolveDraftDiscussion(input: {
    draftPostId: number;
    threadId: string;
    resolution: DraftDiscussionResolution;
    issueType?: DraftDiscussionIssueType;
    reason?: string;
}): Promise<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions/${encodeURIComponent(input.threadId)}/resolve`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                resolution: input.resolution,
                issueType: input.issueType,
                reason: input.reason || undefined,
            }),
        },
    );
}

export async function appendDraftDiscussionMessage(input: {
    draftPostId: number;
    threadId: string;
    content: string;
}): Promise<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions/${encodeURIComponent(input.threadId)}/messages`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                content: input.content,
            }),
        },
    );
}

export async function withdrawDraftDiscussion(input: {
    draftPostId: number;
    threadId: string;
    reason?: string;
}): Promise<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions/${encodeURIComponent(input.threadId)}/withdraw`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                reason: input.reason || undefined,
            }),
        },
    );
}

export async function applyDraftDiscussion(input: {
    draftPostId: number;
    threadId: string;
    appliedEditAnchorId?: string;
    appliedSnapshotHash?: string;
    appliedDraftVersion?: number;
    reason?: string;
}): Promise<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<{ ok: boolean; draftPostId: number; thread: DraftDiscussionThreadRecord }>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions/${encodeURIComponent(input.threadId)}/apply`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                appliedEditAnchorId: input.appliedEditAnchorId,
                appliedSnapshotHash: input.appliedSnapshotHash,
                appliedDraftVersion: input.appliedDraftVersion,
                reason: input.reason || undefined,
            }),
        },
    );
}

export async function sendDiscussionMessage(input: {
    circleId: number;
    senderPubkey: string;
    senderHandle?: string | null;
    text: string;
    metadata?: Record<string, unknown> | null;
    prevEnvelopeId?: string | null;
    subjectType?: 'discussion_message';
    subjectId?: string | null;
    clientWrite?: DiscussionClientWriteIdentity;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    discussionAccessToken?: string;
}): Promise<DiscussionSendResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_protocol');
    const { clientTimestamp, nonce } = input.clientWrite ?? createDiscussionClientWriteIdentity();
    const payload = buildDiscussionSigningPayload({
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        text: input.text,
        clientTimestamp,
        nonce,
        prevEnvelopeId: input.prevEnvelopeId,
        subjectType: input.subjectType,
        subjectId: input.subjectId || undefined,
    });
    const signedMessage = buildDiscussionSigningMessage(payload);
    const signature = await signDiscussionMessage({
        signMessage: input.signMessage,
        message: signedMessage,
    });

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (input.discussionAccessToken) {
        headers.Authorization = `Bearer ${input.discussionAccessToken}`;
    }

    const response = await authenticatedApiFetch(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            senderPubkey: input.senderPubkey,
            senderHandle: input.senderHandle ?? undefined,
            text: payload.text,
            metadata: input.metadata || undefined,
            clientTimestamp,
            nonce,
            prevEnvelopeId: payload.prevEnvelopeId,
            subjectType: payload.subjectType,
            subjectId: payload.subjectId,
            signedMessage,
            signature,
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`send discussion message failed: ${response.status} ${body}`);
    }
    return normalizeDiscussionSendResponse(await response.json());
}

export async function sendKnowledgeDiscussionMessage(input: {
    circleId: number;
    knowledgeId: string;
    senderPubkey: string;
    senderHandle?: string | null;
    text: string;
    metadata?: Record<string, unknown> | null;
    prevEnvelopeId?: string | null;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    discussionAccessToken?: string;
}): Promise<DiscussionSendResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_protocol');
    const clientTimestamp = new Date().toISOString();
    const nonce = randomNonce();
    const payload = buildDiscussionSigningPayload({
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        text: input.text,
        clientTimestamp,
        nonce,
        prevEnvelopeId: input.prevEnvelopeId,
        subjectType: 'knowledge',
        subjectId: input.knowledgeId,
    });
    const signedMessage = buildDiscussionSigningMessage(payload);
    const signature = await signDiscussionMessage({
        signMessage: input.signMessage,
        message: signedMessage,
    });

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (input.discussionAccessToken) {
        headers.Authorization = `Bearer ${input.discussionAccessToken}`;
    }

    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/knowledge/${encodeURIComponent(input.knowledgeId)}/messages`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                senderPubkey: input.senderPubkey,
                senderHandle: input.senderHandle ?? undefined,
                text: payload.text,
                metadata: input.metadata || undefined,
                clientTimestamp,
                nonce,
                prevEnvelopeId: payload.prevEnvelopeId,
                signedMessage,
                signature,
            }),
        },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`send knowledge discussion message failed: ${response.status} ${body}`);
    }
    return normalizeDiscussionSendResponse(await response.json());
}

export async function tombstoneDiscussionMessage(input: {
    circleId: number;
    envelopeId: string;
    senderPubkey: string;
    reason?: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    discussionAccessToken?: string;
}): Promise<DiscussionSendResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_protocol');
    const clientTimestamp = new Date().toISOString();
    const payload = buildDiscussionTombstonePayload({
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        envelopeId: input.envelopeId,
        reason: input.reason || 'user_deleted',
        clientTimestamp,
    });
    const signedMessage = buildDiscussionTombstoneMessage(payload);
    const signature = await signDiscussionMessage({
        signMessage: input.signMessage,
        message: signedMessage,
    });

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (input.discussionAccessToken) {
        headers.Authorization = `Bearer ${input.discussionAccessToken}`;
    }

    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/messages/${input.envelopeId}/tombstone`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                senderPubkey: input.senderPubkey,
                reason: payload.reason,
                clientTimestamp,
                signedMessage,
                signature,
            }),
        },
    );

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`tombstone discussion message failed: ${response.status} ${body}`);
    }

    return normalizeDiscussionSendResponse(await response.json());
}

export async function createDiscussionSession(input: {
    senderHandle?: string | null;
    scope?: string;
    ttlSec?: number;
    clientMeta?: Record<string, unknown>;
}): Promise<DiscussionSessionResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    const clientTimestamp = new Date().toISOString();
    const nonce = randomNonce();
    const payload = buildDiscussionSessionBootstrapPayload({
        scope: input.scope,
        clientTimestamp,
        nonce,
    });

    const response = await authenticatedApiFetch(`${baseUrl}/api/v1/discussion/sessions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            senderHandle: input.senderHandle ?? undefined,
            scope: payload.scope,
            ttlSec: input.ttlSec,
            clientTimestamp,
            nonce,
            clientMeta: input.clientMeta ?? undefined,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`create discussion session failed: ${response.status} ${body}`);
    }

    return response.json();
}

export async function refreshDiscussionSession(input: {
    sessionId: string;
    discussionAccessToken: string;
    ttlSec?: number;
}): Promise<DiscussionSessionResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    const response = await apiFetch(`${baseUrl}/api/v1/discussion/sessions/${input.sessionId}/refresh`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${input.discussionAccessToken}`,
        },
        body: JSON.stringify({
            ttlSec: input.ttlSec,
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`refresh discussion session failed: ${response.status} ${body}`);
    }
    return response.json();
}

export async function revokeDiscussionSession(input: {
    sessionId: string;
    discussionAccessToken: string;
}): Promise<{ ok: boolean; sessionId: string }> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    const response = await apiFetch(`${baseUrl}/api/v1/discussion/sessions/${input.sessionId}`, {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${input.discussionAccessToken}`,
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`revoke discussion session failed: ${response.status} ${body}`);
    }
    return response.json();
}
