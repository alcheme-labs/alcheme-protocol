import { Prisma, PrismaClient } from '@prisma/client';

import {
    resolveCircleActorDisplays,
    type CircleActorDisplay,
} from '../../identity/circleActorDisplay';
import type { CircleAnnouncementDisplaySnapshot } from './types';

const MAX_ANNOUNCEMENT_THREAD_DEPTH = 16;
const DISCUSSION_PREVIEW_LIMIT = 50;
const DISCUSSION_PREVIEW_TEXT_LIMIT = 240;
const DEFAULT_LOCALE = 'en';

interface AnnouncementRootRow {
    announcementId: string;
    rootEnvelopeId: string;
}

interface AnnouncementReplyPreviewRow {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
    payloadText: string;
    clientTimestamp: Date | string;
}

interface AnnouncementReplyCountRow {
    replyCount: bigint | number | string;
}

export interface AnnouncementDiscussionProjection {
    discussionReplyCount: number;
    latestDiscussionPreview: Array<{
        envelopeId: string;
        senderPubkey: string;
        senderHandle: string | null;
        senderDisplay: CircleAnnouncementDisplaySnapshot;
        text: string;
        clientTimestamp: string;
    }>;
}

type AnnouncementProjectionClient = Prisma.TransactionClient | PrismaClient;

function previewText(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= DISCUSSION_PREVIEW_TEXT_LIMIT
        ? normalized
        : `${normalized.slice(0, DISCUSSION_PREVIEW_TEXT_LIMIT - 1)}…`;
}

function toIsoString(value: Date | string): string {
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toCount(value: bigint | number | string | undefined): number {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export async function refreshAnnouncementDiscussionProjectionForReply(
    client: AnnouncementProjectionClient,
    input: {
        circleId: number;
        replySubjectEnvelopeId: string;
        now: Date;
    },
): Promise<string | null> {
    const rootRows = await client.$queryRaw<AnnouncementRootRow[]>(Prisma.sql`
        WITH RECURSIVE thread AS (
            SELECT
                m.envelope_id,
                m.subject_type,
                m.subject_id,
                0 AS depth
            FROM circle_discussion_messages m
            WHERE m.circle_id = ${input.circleId}
              AND m.envelope_id = ${input.replySubjectEnvelopeId}
            UNION ALL
            SELECT
                parent.envelope_id,
                parent.subject_type,
                parent.subject_id,
                thread.depth + 1 AS depth
            FROM circle_discussion_messages parent
            JOIN thread
              ON thread.subject_type = 'discussion_message'
             AND parent.envelope_id = thread.subject_id
            WHERE parent.circle_id = ${input.circleId}
              AND thread.depth < ${MAX_ANNOUNCEMENT_THREAD_DEPTH}
        )
        SELECT
            a.announcement_id AS "announcementId",
            a.discussion_root_envelope_id AS "rootEnvelopeId"
        FROM circle_announcements a
        JOIN thread t
          ON t.envelope_id = a.discussion_root_envelope_id
        WHERE a.circle_id = ${input.circleId}
          AND a.status = 'active'
        ORDER BY t.depth ASC
        LIMIT 1
    `);
    const root = rootRows[0] ?? null;
    if (!root) return null;

    const projection = await loadAnnouncementDiscussionProjection(client, {
        circleId: input.circleId,
        rootEnvelopeId: root.rootEnvelopeId,
    });

    await client.circleAnnouncement.update({
        where: { announcementId: root.announcementId },
        data: {
            discussionReplyCount: projection.discussionReplyCount,
            latestDiscussionPreview: projection.latestDiscussionPreview as unknown as Prisma.InputJsonValue,
            updatedAt: input.now,
        },
    });

    return root.announcementId;
}

export async function loadAnnouncementDiscussionProjection(
    client: AnnouncementProjectionClient,
    input: {
        circleId: number;
        rootEnvelopeId: string;
        locale?: string | null;
    },
): Promise<AnnouncementDiscussionProjection> {
    const countRows = await client.$queryRaw<AnnouncementReplyCountRow[]>(Prisma.sql`
        WITH RECURSIVE replies AS (
            SELECT
                m.envelope_id,
                m.subject_type,
                m.subject_id,
                1 AS depth
            FROM circle_discussion_messages m
            WHERE m.circle_id = ${input.circleId}
              AND m.message_kind = 'plain'
              AND m.deleted = FALSE
              AND m.subject_type = 'discussion_message'
              AND m.subject_id = ${input.rootEnvelopeId}
            UNION ALL
            SELECT
                child.envelope_id,
                child.subject_type,
                child.subject_id,
                parent.depth + 1 AS depth
            FROM circle_discussion_messages child
            JOIN replies parent
              ON child.subject_type = 'discussion_message'
             AND child.subject_id = parent.envelope_id
            WHERE child.circle_id = ${input.circleId}
              AND child.message_kind = 'plain'
              AND child.deleted = FALSE
              AND parent.depth < ${MAX_ANNOUNCEMENT_THREAD_DEPTH}
        )
        SELECT COUNT(*)::BIGINT AS "replyCount"
        FROM replies
    `);
    const replyCount = toCount(countRows[0]?.replyCount);

    const latestRows = await client.$queryRaw<AnnouncementReplyPreviewRow[]>(Prisma.sql`
        WITH RECURSIVE replies AS (
            SELECT
                m.envelope_id,
                m.sender_pubkey,
                m.sender_handle,
                m.payload_text,
                m.client_timestamp,
                m.lamport,
                1 AS depth
            FROM circle_discussion_messages m
            WHERE m.circle_id = ${input.circleId}
              AND m.message_kind = 'plain'
              AND m.deleted = FALSE
              AND m.subject_type = 'discussion_message'
              AND m.subject_id = ${input.rootEnvelopeId}
            UNION ALL
            SELECT
                child.envelope_id,
                child.sender_pubkey,
                child.sender_handle,
                child.payload_text,
                child.client_timestamp,
                child.lamport,
                parent.depth + 1 AS depth
            FROM circle_discussion_messages child
            JOIN replies parent
              ON child.subject_type = 'discussion_message'
             AND child.subject_id = parent.envelope_id
            WHERE child.circle_id = ${input.circleId}
              AND child.message_kind = 'plain'
              AND child.deleted = FALSE
              AND parent.depth < ${MAX_ANNOUNCEMENT_THREAD_DEPTH}
        )
        SELECT
            envelope_id AS "envelopeId",
            sender_pubkey AS "senderPubkey",
            sender_handle AS "senderHandle",
            payload_text AS "payloadText",
            client_timestamp AS "clientTimestamp"
        FROM replies
        ORDER BY lamport ASC
        LIMIT ${DISCUSSION_PREVIEW_LIMIT}
    `);
    const displayMap = await resolveCircleActorDisplays({
        prisma: client as any,
        actors: latestRows.map((row) => ({
            displayKey: row.envelopeId,
            pubkey: row.senderPubkey,
            circleId: input.circleId,
        })),
        mode: 'current',
        locale: input.locale ?? DEFAULT_LOCALE,
    });

    return {
        discussionReplyCount: replyCount,
        latestDiscussionPreview: latestRows.map((row) => ({
            envelopeId: row.envelopeId,
            senderPubkey: row.senderPubkey,
            senderHandle: row.senderHandle,
            senderDisplay: displaySnapshotFromActorDisplay(displayMap.get(row.envelopeId) ?? null),
            text: previewText(row.payloadText),
            clientTimestamp: toIsoString(row.clientTimestamp),
        })),
    };
}

function displaySnapshotFromActorDisplay(display: CircleActorDisplay | null): CircleAnnouncementDisplaySnapshot {
    return {
        effectiveName: display?.effectiveName ?? 'A member',
        displaySource: display?.displaySource ?? 'generic_member',
        displayCircleId: display?.displayCircleId ?? null,
        inheritedFromCircleId: display?.inheritedFromCircleId ?? null,
        alias: display?.circleAlias ?? null,
        snapshotAt: null,
    };
}
