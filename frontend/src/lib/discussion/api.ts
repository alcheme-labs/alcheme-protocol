import { resolveNodeRoute, type NodeRoutingSurface } from '@/lib/config/nodeRouting';
import type { SemanticFacet } from '@/features/discussion-intake/labels/structuredMetadata';

export interface DiscussionMessageDto {
    envelopeId: string;
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    senderHandle: string | null;
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
    highlightCount?: number | null;
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

export interface DraftCrystallizationBindingResponse {
    ok: boolean;
    draftPostId: number;
    sourceContentId: string;
    knowledgeId: string;
    sourceDraftHeatScore: number;
    knowledgeHeatScore: number;
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
    senderPubkey: string;
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
    const response = await fetch(input, init);
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

function normalizeMessageText(text: string): string {
    return text.replace(/\r\n/g, '\n').trim();
}

function randomNonce(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
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
    senderPubkey: string;
    scope?: string;
    clientTimestamp: string;
    nonce: string;
}): DiscussionSessionBootstrapPayload {
    return {
        v: 1,
        action: 'session_init',
        senderPubkey: input.senderPubkey,
        scope: input.scope || 'circle:*',
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
    };
}

export function buildDiscussionSessionBootstrapMessage(payload: DiscussionSessionBootstrapPayload): string {
    return `alcheme-discussion-session:${JSON.stringify(payload)}`;
}

function normalizeDiscussionMessageDto(message: DiscussionMessageDto): DiscussionMessageDto {
    return {
        ...message,
        sessionId: null,
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

    const response = await fetch(
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

    const response = await fetch(
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

    const response = await fetch(
        `${baseUrl}/api/v1/discussion/knowledge/${encodeURIComponent(input.knowledgeId)}/messages?${query.toString()}`,
        {
            method: 'GET',
            credentials: 'include',
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
    const response = await fetch(
        `${baseUrl}/api/v1/discussion/messages/${encodeURIComponent(input.envelopeId)}/forward`,
        {
            method: 'POST',
            credentials: 'include',
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

export async function fetchDraftPublishReadiness(input: {
    draftPostId: number;
}): Promise<DraftPublishReadinessResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    return fetchDiscussionJson<DraftPublishReadinessResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/publish-readiness`,
        {
            method: 'GET',
            cache: 'no-store',
            credentials: 'include',
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
            credentials: 'include',
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
            credentials: 'include',
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
            credentials: 'include',
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

export async function listDraftDiscussions(input: {
    draftPostId: number;
    limit?: number;
}): Promise<DraftDiscussionListResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    const query = new URLSearchParams();
    query.set('limit', String(input.limit ?? 50));
    return fetchDiscussionJson<DraftDiscussionListResponse>(
        `${baseUrl}/api/v1/discussion/drafts/${input.draftPostId}/discussions?${query.toString()}`,
        {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
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
            credentials: 'include',
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
            credentials: 'include',
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
            credentials: 'include',
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
            credentials: 'include',
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
            credentials: 'include',
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
            credentials: 'include',
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

    const response = await fetch(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/messages`, {
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

    const response = await fetch(
        `${baseUrl}/api/v1/discussion/knowledge/${encodeURIComponent(input.knowledgeId)}/messages`,
        {
            method: 'POST',
            credentials: 'include',
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

    const response = await fetch(
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
    senderPubkey: string;
    senderHandle?: string | null;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    scope?: string;
    ttlSec?: number;
    clientMeta?: Record<string, unknown>;
}): Promise<DiscussionSessionResponse> {
    const baseUrl = await getNodeBaseUrl('discussion_runtime');
    const clientTimestamp = new Date().toISOString();
    const nonce = randomNonce();
    const payload = buildDiscussionSessionBootstrapPayload({
        senderPubkey: input.senderPubkey,
        scope: input.scope,
        clientTimestamp,
        nonce,
    });
    const signedMessage = buildDiscussionSessionBootstrapMessage(payload);
    const signature = await signDiscussionMessage({
        signMessage: input.signMessage,
        message: signedMessage,
    });

    const response = await fetch(`${baseUrl}/api/v1/discussion/sessions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            senderPubkey: input.senderPubkey,
            senderHandle: input.senderHandle ?? undefined,
            scope: payload.scope,
            ttlSec: input.ttlSec,
            clientTimestamp,
            nonce,
            signedMessage,
            signature,
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
    const response = await fetch(`${baseUrl}/api/v1/discussion/sessions/${input.sessionId}/refresh`, {
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
    const response = await fetch(`${baseUrl}/api/v1/discussion/sessions/${input.sessionId}`, {
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
