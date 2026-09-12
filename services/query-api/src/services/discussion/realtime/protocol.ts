import type { DiscussionMessageDto } from '../messagesReadModel';
import type { DiscussionAnchoredInteractionDto } from '../anchoredInteractions/types';
import type { CircleAnnouncementDetailDto } from '../announcements/types';

export type DiscussionRealtimeReason =
    | 'message_created'
    | 'message_tombstoned'
    | 'message_forwarded'
    | 'system_notice_published'
    | 'candidate_notice_updated'
    | 'interaction_projection_changed'
    | 'announcement_projection_changed'
    | 'interaction_result_published'
    | 'message_refresh_required';

export interface DiscussionRealtimePayload {
    circleId: number;
    latestLamport: number | null;
    envelopeId: string | null;
    reason: DiscussionRealtimeReason;
    message?: DiscussionMessageDto | null;
    interactionId?: string | null;
    announcementId?: string | null;
    discussionRootEnvelopeId?: string | null;
    projectionVersion?: number | null;
    projectionCursor?: number | null;
    interaction?: DiscussionAnchoredInteractionDto | null;
    announcement?: CircleAnnouncementDetailDto | null;
    timing?: DiscussionRealtimeTiming;
}

export interface DiscussionRealtimeTiming {
    eventId: string;
    serverReceivedAt?: string;
    dbCommittedAt?: string;
    publishedAt: string;
}

export function buildDiscussionRealtimeChannel(circleId: number): string {
    return `discussion:circle:${circleId}`;
}

export function normalizeDiscussionRealtimePayload(input: {
    circleId: number;
    latestLamport?: number | null;
    envelopeId?: string | null;
    reason: DiscussionRealtimeReason;
    message?: DiscussionMessageDto | null;
    interactionId?: string | null;
    announcementId?: string | null;
    discussionRootEnvelopeId?: string | null;
    projectionVersion?: number | null;
    projectionCursor?: number | null;
    interaction?: DiscussionAnchoredInteractionDto | null;
    announcement?: CircleAnnouncementDetailDto | null;
    timing?: DiscussionRealtimeTiming | null;
}): DiscussionRealtimePayload {
    const message = normalizeDiscussionMessageDto(input.message);
    const interaction = normalizeDiscussionAnchoredInteractionDto(input.interaction);
    const announcement = normalizeCircleAnnouncementDetailDto(input.announcement);
    const timing = normalizeDiscussionRealtimeTiming(input.timing);
    const interactionId = interaction?.interactionId
        ?? normalizeOptionalString(input.interactionId);
    const announcementId = announcement?.announcementId
        ?? normalizeOptionalString(input.announcementId);
    const discussionRootEnvelopeId = announcement?.discussionRootEnvelopeId
        ?? normalizeOptionalString(input.discussionRootEnvelopeId);
    const projectionVersion = typeof input.projectionVersion === 'number' && Number.isFinite(input.projectionVersion)
        ? Math.max(0, Math.trunc(input.projectionVersion))
        : interaction?.projectionVersion ?? announcement?.projectionVersion ?? null;
    const projectionCursor = typeof input.projectionCursor === 'number' && Number.isFinite(input.projectionCursor)
        ? Math.max(0, Math.trunc(input.projectionCursor))
        : interaction?.projectionCursor ?? null;
    return {
        circleId: input.circleId,
        latestLamport: message
            ? message.lamport
            : typeof input.latestLamport === 'number' && Number.isFinite(input.latestLamport)
            ? input.latestLamport
            : null,
        envelopeId: message
            ? message.envelopeId
            : typeof input.envelopeId === 'string' && input.envelopeId.trim().length > 0
            ? input.envelopeId.trim()
            : null,
        reason: input.reason,
        ...(message ? { message } : {}),
        ...(interactionId ? { interactionId } : {}),
        ...(announcementId ? { announcementId } : {}),
        ...(discussionRootEnvelopeId ? { discussionRootEnvelopeId } : {}),
        ...(projectionVersion !== null ? { projectionVersion } : {}),
        ...(projectionCursor !== null ? { projectionCursor } : {}),
        ...(interaction ? { interaction } : {}),
        ...(announcement ? { announcement } : {}),
        ...(timing ? { timing } : {}),
    };
}

function normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeIsoTimestamp(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    return new Date(parsed).toISOString();
}

function normalizeDiscussionRealtimeTiming(value: unknown): DiscussionRealtimeTiming | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<DiscussionRealtimeTiming>;
    if (typeof record.eventId !== 'string' || !record.eventId.trim()) return null;
    const publishedAt = normalizeIsoTimestamp(record.publishedAt);
    if (!publishedAt) return null;
    const serverReceivedAt = normalizeIsoTimestamp(record.serverReceivedAt);
    const dbCommittedAt = normalizeIsoTimestamp(record.dbCommittedAt);
    return {
        eventId: record.eventId.trim(),
        ...(serverReceivedAt ? { serverReceivedAt } : {}),
        ...(dbCommittedAt ? { dbCommittedAt } : {}),
        publishedAt,
    };
}

function normalizeDiscussionMessageDto(value: unknown): DiscussionMessageDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<DiscussionMessageDto>;
    if (typeof record.envelopeId !== 'string' || !record.envelopeId.trim()) return null;
    if (typeof record.roomKey !== 'string' || !record.roomKey.trim()) return null;
    if (typeof record.circleId !== 'number' || !Number.isFinite(record.circleId) || record.circleId <= 0) return null;
    if (typeof record.senderPubkey !== 'string' || !record.senderPubkey.trim()) return null;
    if (typeof record.text !== 'string') return null;
    if (typeof record.payloadHash !== 'string') return null;
    if (typeof record.nonce !== 'string') return null;
    if (typeof record.clientTimestamp !== 'string') return null;
    if (typeof record.lamport !== 'number' || !Number.isFinite(record.lamport)) return null;
    if (typeof record.deleted !== 'boolean') return null;
    if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') return null;

    return {
        ...record,
        envelopeId: record.envelopeId.trim(),
        roomKey: record.roomKey.trim(),
        circleId: record.circleId,
        senderPubkey: record.senderPubkey.trim(),
        senderHandle: typeof record.senderHandle === 'string' ? record.senderHandle : null,
        text: record.text,
        payloadHash: record.payloadHash,
        nonce: record.nonce,
        signature: typeof record.signature === 'string' ? record.signature : null,
        signatureVerified: record.signatureVerified === true,
        sessionId: null,
        clientTimestamp: record.clientTimestamp,
        lamport: Math.max(0, Math.trunc(record.lamport)),
        prevEnvelopeId: typeof record.prevEnvelopeId === 'string' ? record.prevEnvelopeId : null,
        deleted: record.deleted,
        usefulCount:
            typeof record.usefulCount === 'number' && Number.isFinite(record.usefulCount)
                ? Math.max(0, Math.trunc(record.usefulCount))
                : 0,
        viewerHasMarkedUseful: record.viewerHasMarkedUseful === true,
        tombstoneReason: typeof record.tombstoneReason === 'string' ? record.tombstoneReason : null,
        tombstonedAt: typeof record.tombstonedAt === 'string' ? record.tombstonedAt : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    } as DiscussionMessageDto;
}

function normalizeDiscussionAnchoredInteractionDto(value: unknown): DiscussionAnchoredInteractionDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<DiscussionAnchoredInteractionDto>;
    if (typeof record.interactionId !== 'string' || !record.interactionId.trim()) return null;
    if (typeof record.circleId !== 'number' || !Number.isFinite(record.circleId) || record.circleId <= 0) return null;
    if (!record.anchor || typeof record.anchor !== 'object') return null;
    if (record.anchor.type !== 'discussion_message' && record.anchor.type !== 'freeform') return null;
    if (typeof record.anchor.ref !== 'string' || !record.anchor.ref.trim()) return null;
    if (
        record.interactionType !== 'signup'
        && record.interactionType !== 'poll'
        && record.interactionType !== 'challenge'
        && record.interactionType !== 'announcement'
        && record.interactionType !== 'support'
        && record.interactionType !== 'tip'
        && record.interactionType !== 'bounty'
    ) return null;
    if (record.interactionClass !== 'display' && record.interactionClass !== 'aggregate') return null;
    if (typeof record.projectionVersion !== 'number' || !Number.isFinite(record.projectionVersion)) return null;
    if (typeof record.projectionCursor !== 'number' || !Number.isFinite(record.projectionCursor)) return null;
    return {
        ...record,
        interactionId: record.interactionId.trim(),
        circleId: record.circleId,
        anchor: {
            type: record.anchor.type,
            ref: record.anchor.ref.trim(),
        },
        interactionType: record.interactionType,
        interactionClass: record.interactionClass,
        status: record.status || 'open',
        projectionVersion: Math.max(0, Math.trunc(record.projectionVersion)),
        projectionCursor: Math.max(0, Math.trunc(record.projectionCursor)),
        resultStatus: record.resultStatus || 'none',
        resultNoticeEnvelopeId: record.resultNoticeEnvelopeId || null,
        state: record.state || {},
        summary: record.summary || {},
        policyVersion: record.policyVersion || '',
        createdByPubkey: record.createdByPubkey || '',
        createdAt: record.createdAt || '',
        updatedAt: record.updatedAt || '',
    } as DiscussionAnchoredInteractionDto;
}

function normalizeCircleAnnouncementDetailDto(value: unknown): CircleAnnouncementDetailDto | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<CircleAnnouncementDetailDto>;
    if (typeof record.announcementId !== 'string' || !record.announcementId.trim()) return null;
    if (typeof record.circleId !== 'number' || !Number.isFinite(record.circleId) || record.circleId <= 0) return null;
    if (typeof record.projectionVersion !== 'number' || !Number.isFinite(record.projectionVersion)) return null;
    if (typeof record.discussionRootEnvelopeId !== 'string' || !record.discussionRootEnvelopeId.trim()) return null;
    return {
        ...record,
        announcementId: record.announcementId.trim(),
        circleId: record.circleId,
        projectionVersion: Math.max(0, Math.trunc(record.projectionVersion)),
        discussionRootEnvelopeId: record.discussionRootEnvelopeId.trim(),
    } as CircleAnnouncementDetailDto;
}

export function parseDiscussionRealtimePayload(value: string): DiscussionRealtimePayload | null {
    try {
        const parsed = JSON.parse(value) as Partial<DiscussionRealtimePayload> | null;
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        if (typeof parsed.circleId !== 'number' || !Number.isFinite(parsed.circleId) || parsed.circleId <= 0) {
            return null;
        }
        if (
            parsed.reason !== 'message_created'
            && parsed.reason !== 'message_tombstoned'
            && parsed.reason !== 'message_forwarded'
            && parsed.reason !== 'system_notice_published'
            && parsed.reason !== 'candidate_notice_updated'
            && parsed.reason !== 'interaction_projection_changed'
            && parsed.reason !== 'announcement_projection_changed'
            && parsed.reason !== 'interaction_result_published'
            && parsed.reason !== 'message_refresh_required'
        ) {
            return null;
        }
        return normalizeDiscussionRealtimePayload({
            circleId: parsed.circleId,
            latestLamport: parsed.latestLamport,
            envelopeId: parsed.envelopeId,
            reason: parsed.reason,
            message: parsed.message,
            interactionId: parsed.interactionId,
            announcementId: parsed.announcementId,
            discussionRootEnvelopeId: parsed.discussionRootEnvelopeId,
            projectionVersion: parsed.projectionVersion,
            projectionCursor: parsed.projectionCursor,
            interaction: parsed.interaction,
            announcement: parsed.announcement,
            timing: parsed.timing,
        });
    } catch {
        return null;
    }
}
