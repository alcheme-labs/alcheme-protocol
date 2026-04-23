import type { Redis } from 'ioredis';

export type DiscussionRealtimeReason =
    | 'message_created'
    | 'message_tombstoned'
    | 'message_forwarded'
    | 'system_notice_published'
    | 'candidate_notice_updated'
    | 'message_refresh_required';

export interface DiscussionRealtimePayload {
    circleId: number;
    latestLamport: number | null;
    envelopeId: string | null;
    reason: DiscussionRealtimeReason;
}

export function buildDiscussionRealtimeChannel(circleId: number): string {
    return `discussion:circle:${circleId}`;
}

export function normalizeDiscussionRealtimePayload(input: {
    circleId: number;
    latestLamport?: number | null;
    envelopeId?: string | null;
    reason: DiscussionRealtimeReason;
}): DiscussionRealtimePayload {
    return {
        circleId: input.circleId,
        latestLamport: typeof input.latestLamport === 'number' && Number.isFinite(input.latestLamport)
            ? input.latestLamport
            : null,
        envelopeId: typeof input.envelopeId === 'string' && input.envelopeId.trim().length > 0
            ? input.envelopeId.trim()
            : null,
        reason: input.reason,
    };
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
            && parsed.reason !== 'message_refresh_required'
        ) {
            return null;
        }
        return normalizeDiscussionRealtimePayload({
            circleId: parsed.circleId,
            latestLamport: parsed.latestLamport,
            envelopeId: parsed.envelopeId,
            reason: parsed.reason,
        });
    } catch {
        return null;
    }
}

export function serializeDiscussionRealtimeSseEvent(event: DiscussionRealtimePayload): string {
    return `event: message_changed\ndata: ${JSON.stringify(event)}\n\n`;
}

export function serializeDiscussionRealtimeHeartbeat(): string {
    return ': keepalive\n\n';
}

export async function publishDiscussionRealtimeEvent(
    redis: Pick<Redis, 'publish'>,
    input: {
        circleId: number;
        latestLamport?: number | null;
        envelopeId?: string | null;
        reason: DiscussionRealtimeReason;
    },
): Promise<DiscussionRealtimePayload> {
    const payload = normalizeDiscussionRealtimePayload(input);
    await redis.publish(
        buildDiscussionRealtimeChannel(payload.circleId),
        JSON.stringify(payload),
    );
    return payload;
}
