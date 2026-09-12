import type { Redis } from 'ioredis';
import crypto from 'crypto';

import {
    buildDiscussionRealtimeChannel,
    normalizeDiscussionRealtimePayload,
    type DiscussionRealtimePayload,
    type DiscussionRealtimeReason,
    type DiscussionRealtimeTiming,
} from './protocol';
import type { DiscussionMessageDto } from '../messagesReadModel';
import type { DiscussionAnchoredInteractionDto } from '../anchoredInteractions/types';
import type { CircleAnnouncementDetailDto } from '../announcements/types';

function normalizeOptionalDate(value: string | Date | null | undefined): string | undefined {
    if (!value) return undefined;
    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed.toISOString();
}

export async function publishDiscussionRealtimeEvent(
    redis: Pick<Redis, 'publish'>,
    input: {
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
        serverReceivedAt?: string | Date | null;
        dbCommittedAt?: string | Date | null;
    },
): Promise<DiscussionRealtimePayload> {
    const publishedAt = new Date();
    const serverReceivedAt = normalizeOptionalDate(input.serverReceivedAt);
    const dbCommittedAt = normalizeOptionalDate(input.dbCommittedAt);
    const payload = normalizeDiscussionRealtimePayload({
        ...input,
        timing: input.timing ?? {
            eventId: crypto.randomUUID(),
            ...(serverReceivedAt ? { serverReceivedAt } : {}),
            ...(dbCommittedAt ? { dbCommittedAt } : {}),
            publishedAt: publishedAt.toISOString(),
        },
    });
    await redis.publish(
        buildDiscussionRealtimeChannel(payload.circleId),
        JSON.stringify(payload),
    );
    return payload;
}
