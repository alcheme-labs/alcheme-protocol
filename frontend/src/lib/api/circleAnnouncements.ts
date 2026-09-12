import { authenticatedApiFetch } from './fetch.ts';
import { resolveNodeRoute } from './nodeRouting.ts';
import type {
    CircleAnnouncementConfirmationPolicy,
    CircleAnnouncementDetailDto,
    CircleAnnouncementListDto,
    CircleAnnouncementMutationResponse,
} from '../../features/circle-announcements/types.ts';

interface AnnouncementActorInput {
    circleId: number;
    senderPubkey?: string | null;
    discussionAccessToken?: string | null;
}

export interface PublishCircleAnnouncementInput extends AnnouncementActorInput {
    title: string;
    body: string;
    confirmationPolicy?: CircleAnnouncementConfirmationPolicy;
    clientNonce?: string | null;
    pinPriority?: number | null;
    pinnedUntil?: string | null;
}

export interface CircleAnnouncementDetailInput extends AnnouncementActorInput {
    announcementId: string;
}

export interface ConfirmCircleAnnouncementInput extends CircleAnnouncementDetailInput {
    confirmationText?: string | null;
}

export async function fetchCircleAnnouncements(
    input: AnnouncementActorInput,
): Promise<CircleAnnouncementListDto> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const url = new URL(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/announcements`);
    return fetchAnnouncementJson<CircleAnnouncementListDto>(url, {
        method: 'GET',
        headers: buildHeaders(input.discussionAccessToken),
        cache: 'no-store',
    });
}

export async function publishCircleAnnouncement(
    input: PublishCircleAnnouncementInput,
): Promise<CircleAnnouncementMutationResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    return fetchAnnouncementJson<CircleAnnouncementMutationResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/announcements`,
        {
            method: 'POST',
            headers: buildHeaders(input.discussionAccessToken),
            body: JSON.stringify({
                clientNonce: input.clientNonce ?? createClientNonce(),
                title: input.title,
                body: input.body,
                confirmationPolicy: input.confirmationPolicy ?? 'none',
                pinPriority: input.pinPriority ?? 0,
                pinnedUntil: input.pinnedUntil || undefined,
            }),
        },
    );
}

export async function fetchCircleAnnouncementDetail(
    input: CircleAnnouncementDetailInput,
): Promise<CircleAnnouncementDetailDto> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    const url = new URL(`${baseUrl}/api/v1/discussion/circles/${input.circleId}/announcements/${encodeURIComponent(input.announcementId)}`);
    const response = await fetchAnnouncementJson<CircleAnnouncementMutationResponse>(url, {
        method: 'GET',
        headers: buildHeaders(input.discussionAccessToken),
        cache: 'no-store',
    });
    return response.announcement;
}

export async function markCircleAnnouncementSeen(
    input: CircleAnnouncementDetailInput,
): Promise<CircleAnnouncementMutationResponse> {
    return mutateCircleAnnouncementReceipt(input, 'seen');
}

export async function markCircleAnnouncementUnread(
    input: CircleAnnouncementDetailInput,
): Promise<CircleAnnouncementMutationResponse> {
    return mutateCircleAnnouncementReceipt(input, 'mark-unread');
}

export async function confirmCircleAnnouncement(
    input: ConfirmCircleAnnouncementInput,
): Promise<CircleAnnouncementMutationResponse> {
    return mutateCircleAnnouncementReceipt(input, 'confirm', {
        confirmationText: input.confirmationText ?? null,
    });
}

async function mutateCircleAnnouncementReceipt(
    input: CircleAnnouncementDetailInput,
    action: 'seen' | 'mark-unread' | 'confirm',
    extraBody: Record<string, unknown> = {},
): Promise<CircleAnnouncementMutationResponse> {
    const baseUrl = await getDiscussionProtocolBaseUrl();
    return fetchAnnouncementJson<CircleAnnouncementMutationResponse>(
        `${baseUrl}/api/v1/discussion/circles/${input.circleId}/announcements/${encodeURIComponent(input.announcementId)}/${action}`,
        {
            method: 'POST',
            headers: buildHeaders(input.discussionAccessToken),
            body: JSON.stringify({
                ...extraBody,
            }),
        },
    );
}

async function getDiscussionProtocolBaseUrl(): Promise<string> {
    const route = await resolveNodeRoute('discussion_protocol');
    return route.urlBase;
}

function buildHeaders(discussionAccessToken?: string | null): Headers {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (discussionAccessToken) {
        headers.set('Authorization', `Bearer ${discussionAccessToken}`);
    }
    return headers;
}

async function fetchAnnouncementJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
    const response = await authenticatedApiFetch(input, init);
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

function createClientNonce(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}
