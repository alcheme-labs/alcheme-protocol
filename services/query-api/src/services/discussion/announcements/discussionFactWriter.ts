import type { Prisma, PrismaClient } from '@prisma/client';

import {
    DISCUSSION_STREAM_KEY,
    buildDiscussionRoomKey,
    computeDiscussionEnvelopeId,
    sha256Hex,
    updateOffchainWatermark,
} from '../../offchainDiscussion';

type SqlClient = PrismaClient | Prisma.TransactionClient;

export interface AnnouncementDiscussionFactInput {
    circleId: number;
    announcementId: string;
    actorPubkey: string;
    senderHandle?: string | null;
    sessionId?: string | null;
    title: string;
    body: string;
    confirmationPolicy: string;
    pinPriority: number;
    primarySourceType: string;
    primarySourceRef: string;
    primarySourceEnvelopeId?: string | null;
    now: Date;
}

export interface AnnouncementDiscussionFactResult {
    envelopeId: string;
    lamport: bigint;
    payloadText: string;
    payloadHash: string;
    signedMessage: string;
}

export async function writeAnnouncementDiscussionFact(
    client: SqlClient,
    input: AnnouncementDiscussionFactInput,
): Promise<AnnouncementDiscussionFactResult> {
    const roomKey = buildDiscussionRoomKey(input.circleId);
    const clientTimestampIso = input.now.toISOString();
    const nonce = `announcement:${input.announcementId}`;
    const payloadText = normalizeAnnouncementPayloadText(input);
    const payloadHash = sha256Hex(payloadText);
    const signedMessage = buildAnnouncementSignedMessage({
        v: 1,
        circleId: input.circleId,
        roomKey,
        announcementId: input.announcementId,
        actorPubkey: input.actorPubkey,
        title: input.title,
        body: input.body,
        confirmationPolicy: input.confirmationPolicy,
        clientTimestamp: clientTimestampIso,
        nonce,
    });
    const envelopeId = computeDiscussionEnvelopeId({
        roomKey,
        senderPubkey: input.actorPubkey,
        payloadHash,
        clientTimestamp: clientTimestampIso,
        nonce,
        prevEnvelopeId: null,
        signatureBase64: null,
        subjectType: 'announcement',
        subjectId: input.announcementId,
    });
    const metadata = {
        announcementId: input.announcementId,
        title: input.title,
        confirmationPolicy: input.confirmationPolicy,
        pinPriority: input.pinPriority,
        primarySourceType: input.primarySourceType,
        primarySourceRef: input.primarySourceRef,
        primarySourceEnvelopeId: input.primarySourceEnvelopeId ?? null,
    };
    const [{ lamport }] = await client.$queryRaw<Array<{ lamport: bigint }>>`
        SELECT nextval('discussion_lamport_seq')::bigint AS "lamport"
    `;

    const row = await (client as any).circleDiscussionMessage.create({
        data: {
            envelopeId,
            streamKey: DISCUSSION_STREAM_KEY,
            roomKey,
            circleId: input.circleId,
            senderPubkey: input.actorPubkey,
            senderHandle: input.senderHandle ?? null,
            messageKind: 'announcement_notice',
            subjectType: 'announcement',
            subjectId: input.announcementId,
            metadata,
            payloadText,
            payloadHash,
            nonce,
            signature: null,
            signatureScheme: 'ed25519',
            signedMessage,
            signatureVerified: false,
            authMode: 'session_token',
            sessionId: input.sessionId ?? null,
            relevanceScore: 1,
            relevanceStatus: 'ready',
            relevanceMethod: 'system',
            semanticFacets: [],
            authorAnnotations: [],
            isEphemeral: false,
            clientTimestamp: input.now,
            lamport,
            prevEnvelopeId: null,
            createdAt: input.now,
            updatedAt: input.now,
        },
    });

    await updateOffchainWatermark(client, {
        lamport: row.lamport,
        envelopeId: row.envelopeId,
    });

    return {
        envelopeId: row.envelopeId,
        lamport: row.lamport,
        payloadText,
        payloadHash,
        signedMessage,
    };
}

function normalizeAnnouncementPayloadText(input: { title: string; body: string }): string {
    const title = input.title.trim();
    const body = input.body.trim();
    return body ? `${title}\n\n${body}` : title;
}

function buildAnnouncementSignedMessage(payload: Record<string, unknown>): string {
    return `alcheme-announcement:${stableStringify(payload)}`;
}

function stableStringify(value: unknown): string {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
