import { apiFetch, authenticatedApiFetch } from './fetch.ts';
import { resolveNodeRoute } from './nodeRouting.ts';
import type {
    DiscussionAnchoredInteractionDto,
    AnchoredInteractionDetailDto,
    DiscussionAnchoredInteractionsResponse,
    PlazaAnchoredInteractionType,
} from '../../features/anchored-interactions/types.ts';
import type { InteractionSuggestionDecision } from '../../features/anchored-interactions/suggestions.ts';

interface AuthenticatedInteractionInput {
    circleId: number;
    senderPubkey: string;
    discussionAccessToken?: string | null;
}

export interface FetchAnchoredInteractionsInput {
    circleId: number;
    afterProjectionCursor?: number | null;
    limit?: number | null;
}

export interface LookupAnchoredInteractionsInput {
    circleId: number;
    interactionIds: string[];
}

export interface FetchAnchoredInteractionDetailInput {
    circleId: number;
    interactionId: string;
}

export interface FetchAnchoredSuggestionDecisionsInput {
    circleId: number;
    envelopeIds: string[];
    locale?: string | null;
}

export interface CreateAnchoredInteractionInput extends AuthenticatedInteractionInput {
    clientNonce: string;
    anchor: {
        type: 'discussion_message' | 'freeform';
        ref: string;
    };
    interactionType: PlazaAnchoredInteractionType;
    initialState?: Record<string, unknown> | null;
    initialSummary?: Record<string, unknown> | null;
}

export interface AppendAnchoredInteractionEventInput extends AuthenticatedInteractionInput {
    interactionId: string;
    clientNonce: string;
    eventKind: string;
    payload?: Record<string, unknown> | null;
}

export interface ResolveAnchoredInteractionInput extends AuthenticatedInteractionInput {
    interactionId: string;
    explicitClose?: boolean;
    policy?: Record<string, unknown> | null;
}

export interface AnchoredInteractionMutationResponse {
    ok: boolean;
    interaction: DiscussionAnchoredInteractionDto;
    result?: Record<string, unknown>;
    resultNoticeEnvelopeId?: string | null;
    noticeEnvelopeId?: string | null;
}

export interface AnchoredSuggestionDecisionsResponse {
    ok: boolean;
    circleId: number;
    status: 'missing' | 'queued' | 'running' | 'ready' | 'failed';
    jobId?: number | null;
    sourceDigest?: string | null;
    decisions: Array<InteractionSuggestionDecision & { envelopeId: string }>;
    failureCode?: string | null;
}

export async function fetchAnchoredInteractions(
    input: FetchAnchoredInteractionsInput,
): Promise<DiscussionAnchoredInteractionsResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const url = new URL(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions`);
    if (typeof input.afterProjectionCursor === 'number') {
        url.searchParams.set('afterProjectionCursor', String(input.afterProjectionCursor));
    }
    if (typeof input.limit === 'number') {
        url.searchParams.set('limit', String(input.limit));
    }
    return fetchAnchoredInteractionJson<DiscussionAnchoredInteractionsResponse>(url);
}

export async function lookupAnchoredInteractions(
    input: LookupAnchoredInteractionsInput,
): Promise<DiscussionAnchoredInteractionsResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const url = new URL(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions/lookup`);
    url.searchParams.set('interactionIds', input.interactionIds.join(','));
    return fetchAnchoredInteractionJson<DiscussionAnchoredInteractionsResponse>(url);
}

export async function fetchAnchoredInteractionDetail(
    input: FetchAnchoredInteractionDetailInput,
): Promise<AnchoredInteractionDetailDto> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const url = new URL(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions/${encodeURIComponent(input.interactionId)}/detail`);
    return fetchAnchoredInteractionJson<AnchoredInteractionDetailDto>(url);
}

export async function fetchAnchoredSuggestionDecisions(
    input: FetchAnchoredSuggestionDecisionsInput,
): Promise<AnchoredSuggestionDecisionsResponse> {
    const baseUrl = await getDiscussionRuntimeBaseUrl();
    return fetchAuthenticatedAnchoredInteractionJson<AnchoredSuggestionDecisionsResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions/suggestion-decisions`,
        {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
                envelopeIds: input.envelopeIds,
                locale: input.locale ?? undefined,
            }),
        },
    );
}


export async function createAnchoredInteraction(
    input: CreateAnchoredInteractionInput,
): Promise<AnchoredInteractionMutationResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    return fetchAuthenticatedAnchoredInteractionJson<AnchoredInteractionMutationResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions`,
        {
            method: 'POST',
            headers: buildHeaders(input.discussionAccessToken),
            body: JSON.stringify({
                senderPubkey: input.senderPubkey,
                clientNonce: input.clientNonce,
                anchor: input.anchor,
                interactionType: input.interactionType,
                initialState: input.initialState ?? undefined,
                initialSummary: input.initialSummary ?? undefined,
            }),
        },
    );
}

export async function appendAnchoredInteractionEvent(
    input: AppendAnchoredInteractionEventInput,
): Promise<AnchoredInteractionMutationResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    return fetchAuthenticatedAnchoredInteractionJson<AnchoredInteractionMutationResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions/${encodeURIComponent(input.interactionId)}/events`,
        {
            method: 'POST',
            headers: buildHeaders(input.discussionAccessToken),
            body: JSON.stringify({
                senderPubkey: input.senderPubkey,
                clientNonce: input.clientNonce,
                eventKind: input.eventKind,
                payload: input.payload ?? {},
            }),
        },
    );
}

export async function resolveAnchoredInteraction(
    input: ResolveAnchoredInteractionInput,
): Promise<AnchoredInteractionMutationResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    return fetchAuthenticatedAnchoredInteractionJson<AnchoredInteractionMutationResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/interactions/${encodeURIComponent(input.interactionId)}/resolve`,
        {
            method: 'POST',
            headers: buildHeaders(input.discussionAccessToken),
            body: JSON.stringify({
                senderPubkey: input.senderPubkey,
                explicitClose: input.explicitClose === true,
                policy: input.policy ?? undefined,
            }),
        },
    );
}

async function getDiscussionProtocolBaseUrl(): Promise<string> {
    const route = await resolveNodeRoute('discussion_protocol');
    return route.urlBase;
}

async function getDiscussionRuntimeBaseUrl(): Promise<string> {
    const route = await resolveNodeRoute('discussion_runtime');
    return route.urlBase;
}

function buildHeaders(discussionAccessToken?: string | null): Headers {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (discussionAccessToken) {
        headers.set('Authorization', `Bearer ${discussionAccessToken}`);
    }
    return headers;
}

async function fetchAnchoredInteractionJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const response = await apiFetch(input, init);
    return readAnchoredInteractionJson<T>(response);
}

async function fetchAuthenticatedAnchoredInteractionJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const response = await authenticatedApiFetch(input, init);
    return readAnchoredInteractionJson<T>(response);
}

async function readAnchoredInteractionJson<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        const error = new Error(message) as Error & { code?: string; status?: number };
        if (typeof payload?.error === 'string') error.code = payload.error;
        error.status = response.status;
        throw error;
    }
    return payload as T;
}
