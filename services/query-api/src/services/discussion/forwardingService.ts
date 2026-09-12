import crypto from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import type { AppLocale } from '../../i18n/locale';
import { localizeQueryApiCopy } from '../../i18n/copy';
import type { AuthActor } from '../auth/actor';
import { requireCircleActorForAuthActor } from '../auth/actor';
import { resolveCircleActorDisplays } from '../identity/circleActorDisplay';
import {
    buildDiscussionRoomKey,
    computeDiscussionEnvelopeId,
    DISCUSSION_STREAM_KEY,
    normalizeDiscussionText,
    sha256Hex,
    updateOffchainWatermark,
} from '../offchainDiscussion';
import { sqlTimestampWithoutTimeZone } from '../../utils/sqlTimestamp';
import {
    discussionForwardSourceJoin,
    discussionSelectColumns,
    discussionUsefulCountJoin,
    mapRowToDto,
    mapRowsToDtos,
    type DiscussionMessageDto,
    type DiscussionRow,
} from './messagesReadModel';
import {
    canForwardDiscussionMessage,
    type ForwardingCircleNode,
} from './forwardingPolicy';
import { resolvePlazaDiscussionContextForWrite } from './plazaRoomCapability';
import {
    computeForwardBundleDigest,
    createForwardBundleRecord,
    type ForwardBundleItemInput,
} from './forwardingBundleStore';
import { createForwardNotifications } from './forwardingNotification';

const FORWARD_SNAPSHOT_MAX_LENGTH = 220;
const FORWARD_BUNDLE_ITEM_SNAPSHOT_MAX_LENGTH = 500;
const FORWARD_BUNDLE_PAYLOAD_MAX_LENGTH = 2000;

interface CircleForwardingRow {
    id: number;
    name: string;
    level: number;
    parentCircleId: number | null;
}

export class DiscussionForwardingError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
    ) {
        super(code);
    }
}

export function sendDiscussionForwardingError(
    res: { status: (code: number) => { json: (body: unknown) => unknown } },
    error: unknown,
): boolean {
    if (!(error instanceof DiscussionForwardingError)) return false;
    res.status(error.statusCode).json({ error: error.code });
    return true;
}

export interface DiscussionForwardRealtimeEvent {
    circleId: number;
    latestLamport: number;
    envelopeId: string;
    reason: 'message_forwarded';
    message: DiscussionMessageDto;
}

export interface CreateDiscussionForwardProjectionResult {
    message: DiscussionMessageDto;
    row: DiscussionRow;
    realtimeEvent: DiscussionForwardRealtimeEvent;
}

export interface CreateDiscussionForwardProjectionInput {
    prisma: PrismaClient;
    actor: AuthActor;
    sourceEnvelopeId: string;
    targetCircleId: number;
    locale: AppLocale;
}

export interface CreateDiscussionForwardBundleProjectionInput {
    prisma: PrismaClient;
    actor: AuthActor;
    sourceEnvelopeIds: readonly unknown[];
    targetCircleId: number;
    locale: AppLocale;
}

export interface CreateDiscussionForwardBundleProjectionResult {
    status: 'created' | 'existing';
    bundleId: string;
    message: DiscussionMessageDto;
    row: DiscussionRow;
    realtimeEvent: DiscussionForwardRealtimeEvent | null;
}

function randomNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

function buildForwardSnapshotText(text: string, locale: AppLocale): string {
    const normalized = normalizeDiscussionText(text).replace(/\s+/g, ' ').trim();
    if (!normalized) return localizeQueryApiCopy('discussion.forward.emptySourceMessage', locale);
    if (normalized.length <= FORWARD_SNAPSHOT_MAX_LENGTH) {
        return normalized;
    }
    return `${normalized.slice(0, FORWARD_SNAPSHOT_MAX_LENGTH - 1)}…`;
}

function buildForwardBundleSnapshotText(text: string, locale: AppLocale): {
    snapshotText: string;
    snapshotTruncated: boolean;
} {
    const normalized = normalizeDiscussionText(text).replace(/\s+/g, ' ').trim()
        || localizeQueryApiCopy('discussion.forward.emptySourceMessage', locale);
    if (normalized.length <= FORWARD_BUNDLE_ITEM_SNAPSHOT_MAX_LENGTH) {
        return {
            snapshotText: normalized,
            snapshotTruncated: false,
        };
    }
    return {
        snapshotText: `${normalized.slice(0, FORWARD_BUNDLE_ITEM_SNAPSHOT_MAX_LENGTH - 1)}…`,
        snapshotTruncated: true,
    };
}

function truncateForwardBundlePayload(text: string): string {
    if (text.length <= FORWARD_BUNDLE_PAYLOAD_MAX_LENGTH) return text;
    return `${text.slice(0, FORWARD_BUNDLE_PAYLOAD_MAX_LENGTH - 1)}…`;
}

function buildForwardBundleId(input: {
    sourceCircleId: number;
    targetCircleId: number;
    orderedSourceEnvelopeIdsDigest: string;
}): string {
    return `fwb_${sha256Hex([
        input.sourceCircleId,
        input.targetCircleId,
        input.orderedSourceEnvelopeIdsDigest,
    ].join('|')).slice(0, 64)}`;
}

function buildForwardBundlePayloadSummary(items: ForwardBundleItemInput[]): string {
    const lines = [
        `Forwarded ${items.length} discussion ${items.length === 1 ? 'message' : 'messages'}.`,
        ...items.map((item) => `${item.position + 1}. ${item.sourceAuthorDisplayName}: ${item.snapshotText}`),
    ];
    return truncateForwardBundlePayload(lines.join('\n'));
}

function normalizeSourceEnvelopeIds(sourceEnvelopeIds: readonly unknown[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of sourceEnvelopeIds) {
        const normalized = String(raw || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

async function mapDiscussionRowForResponse(
    prisma: PrismaClient,
    row: DiscussionRow,
    locale: AppLocale,
): Promise<DiscussionMessageDto> {
    const [dto] = await mapRowsToDtos({
        prisma,
        rows: [row],
        locale,
    });
    return dto ?? mapRowToDto(row, { locale });
}

async function loadCircleForwardingNode(
    prisma: PrismaClient,
    circleId: number,
): Promise<(ForwardingCircleNode & { name: string }) | null> {
    const visited = new Set<number>();
    let currentCircleId: number | null = circleId;
    let rootCircleId: number | null = null;
    let targetCircle: CircleForwardingRow | null = null;

    while (currentCircleId) {
        if (visited.has(currentCircleId)) {
            throw new Error(`circle_hierarchy_cycle_detected:${circleId}`);
        }
        visited.add(currentCircleId);

        const circle: CircleForwardingRow | null = await prisma.circle.findUnique({
            where: { id: currentCircleId },
            select: {
                id: true,
                name: true,
                level: true,
                parentCircleId: true,
            },
        });
        if (!circle) return null;
        if (!targetCircle) {
            targetCircle = circle;
        }
        if (!circle.parentCircleId) {
            rootCircleId = circle.id;
            break;
        }
        currentCircleId = circle.parentCircleId;
    }

    if (!targetCircle || !rootCircleId) return null;
    return {
        id: targetCircle.id,
        name: targetCircle.name,
        level: targetCircle.level,
        parentCircleId: targetCircle.parentCircleId,
        rootCircleId,
    };
}

async function loadDiscussionRowsByEnvelopeIds(
    prisma: PrismaClient,
    envelopeIds: readonly string[],
): Promise<DiscussionRow[]> {
    return prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.envelope_id IN (${Prisma.join([...envelopeIds])})
        ORDER BY m.lamport ASC, m.id ASC
    `);
}

async function loadDiscussionRowByEnvelopeId(
    client: Pick<PrismaClient, '$queryRaw'>,
    envelopeId: string,
): Promise<DiscussionRow | null> {
    const rows = await client.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.envelope_id = ${envelopeId}
        LIMIT 1
    `);
    return rows[0] ?? null;
}

function throwForwardingDecision(reason: ReturnType<typeof canForwardDiscussionMessage>['reason']): never {
    if (reason === 'ephemeral_not_forwardable') {
        throw new DiscussionForwardingError(409, 'forward_ephemeral_not_allowed');
    }
    if (reason === 'deleted_not_forwardable') {
        throw new DiscussionForwardingError(409, 'forward_deleted_not_allowed');
    }
    if (reason === 'empty_source_not_forwardable') {
        throw new DiscussionForwardingError(409, 'forward_empty_source_not_allowed');
    }
    if (reason === 'forward_of_forward_not_allowed') {
        throw new DiscussionForwardingError(409, 'forward_of_forward_not_allowed');
    }
    if (reason === 'unsupported_source_kind') {
        throw new DiscussionForwardingError(409, 'forward_source_kind_not_allowed');
    }
    if (reason === 'different_tree') {
        throw new DiscussionForwardingError(403, 'forward_cross_tree_not_allowed');
    }
    throw new DiscussionForwardingError(403, 'forward_same_or_lower_level_not_allowed');
}

export async function createDiscussionForwardProjection(
    input: CreateDiscussionForwardProjectionInput,
): Promise<CreateDiscussionForwardProjectionResult> {
    const { prisma, actor, sourceEnvelopeId, targetCircleId, locale } = input;

    const sourceRows = await prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.envelope_id = ${sourceEnvelopeId}
        LIMIT 1
    `);
    const sourceRow = sourceRows[0];
    if (!sourceRow) {
        throw new DiscussionForwardingError(404, 'discussion_message_not_found');
    }

    const [sourceCircle, targetCircle] = await Promise.all([
        loadCircleForwardingNode(prisma, sourceRow.circleId),
        loadCircleForwardingNode(prisma, targetCircleId),
    ]);
    if (!sourceCircle) {
        throw new DiscussionForwardingError(404, 'source_circle_not_found');
    }
    if (!targetCircle) {
        throw new DiscussionForwardingError(404, 'target_circle_not_found');
    }

    await requireCircleActorForAuthActor(actor, prisma, {
        circleId: sourceCircle.id,
        action: 'discussion.write',
    });
    const targetCircleActor = await requireCircleActorForAuthActor(actor, prisma, {
        circleId: targetCircle.id,
        action: 'discussion.write',
    });

    const forwardDecision = canForwardDiscussionMessage({
        sourceCircle,
        targetCircle,
        sourceMessageKind: sourceRow.messageKind,
        sourceIsEphemeral: sourceRow.isEphemeral,
        sourceIsDeleted: sourceRow.deleted,
        sourcePayloadText: sourceRow.payloadText,
    });
    if (!forwardDecision.allowed) {
        throwForwardingDecision(forwardDecision.reason);
    }

    await resolvePlazaDiscussionContextForWrite(prisma as any, {
        circleId: targetCircle.id,
        activeCircleMember: true,
        circleActor: targetCircleActor,
        now: new Date(),
    });

    const snapshotText = buildForwardSnapshotText(sourceRow.payloadText, locale);
    const forwardedAt = new Date();
    const metadata = {
        sourceEnvelopeId: sourceRow.envelopeId,
        sourceCircleId: sourceCircle.id,
        sourceCircleName: sourceCircle.name,
        sourceLevel: sourceCircle.level,
        sourceAuthorHandle: sourceRow.senderHandle,
        forwarderHandle: actor.handle,
        sourceMessageCreatedAt: sourceRow.createdAt.toISOString(),
        forwardedAt: forwardedAt.toISOString(),
        sourceDeleted: sourceRow.deleted,
        snapshotText,
    };
    const nonce = randomNonce();
    const roomKey = buildDiscussionRoomKey(targetCircle.id);
    const clientTimestamp = forwardedAt.toISOString();
    const persistedForwardedAt = sqlTimestampWithoutTimeZone(forwardedAt);
    const payloadHash = sha256Hex(snapshotText);
    const envelopeId = computeDiscussionEnvelopeId({
        roomKey,
        senderPubkey: actor.pubkey,
        payloadHash,
        clientTimestamp,
        nonce,
        prevEnvelopeId: null,
        signatureBase64: null,
        subjectType: 'discussion_message',
        subjectId: sourceRow.envelopeId,
    });

    const inserted = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<DiscussionRow[]>(Prisma.sql`
            INSERT INTO circle_discussion_messages (
                envelope_id,
                stream_key,
                room_key,
                circle_id,
                sender_pubkey,
                sender_handle,
                message_kind,
                subject_type,
                subject_id,
                metadata,
                payload_text,
                payload_hash,
                nonce,
                signature,
                signature_scheme,
                signed_message,
                signature_verified,
                auth_mode,
                session_id,
                relevance_score,
                semantic_score,
                quality_score,
                spam_score,
                decision_confidence,
                relevance_method,
                is_featured,
                feature_reason,
                featured_at,
                client_timestamp,
                prev_envelope_id,
                created_at,
                updated_at
            )
            VALUES (
                ${envelopeId},
                ${DISCUSSION_STREAM_KEY},
                ${roomKey},
                ${targetCircle.id},
                ${actor.pubkey},
                ${actor.handle},
                'forward',
                'discussion_message',
                ${sourceRow.envelopeId},
                ${JSON.stringify(metadata)}::jsonb,
                ${snapshotText},
                ${payloadHash},
                ${nonce},
                NULL,
                'ed25519',
                ${`alcheme-discussion-forward:${JSON.stringify({ sourceEnvelopeId: sourceRow.envelopeId, targetCircleId: targetCircle.id, nonce })}`},
                TRUE,
                'session_token',
                NULL,
                1,
                1,
                0.5,
                0,
                0.5,
                'rule',
                FALSE,
                NULL,
                NULL,
                ${persistedForwardedAt},
                NULL,
                ${persistedForwardedAt},
                ${persistedForwardedAt}
            )
            ON CONFLICT (envelope_id) DO UPDATE SET
                updated_at = ${sqlTimestampWithoutTimeZone(new Date())}
            RETURNING
                envelope_id AS "envelopeId",
                room_key AS "roomKey",
                circle_id AS "circleId",
                sender_pubkey AS "senderPubkey",
                sender_handle AS "senderHandle",
                message_kind AS "messageKind",
                subject_type AS "subjectType",
                subject_id AS "subjectId",
                metadata AS "metadata",
                payload_text AS "payloadText",
                payload_hash AS "payloadHash",
                nonce AS "nonce",
                signature AS "signature",
                signature_verified AS "signatureVerified",
                auth_mode AS "authMode",
                session_id AS "sessionId",
                relevance_score AS "relevanceScore",
                semantic_score AS "semanticScore",
                quality_score AS "qualityScore",
                spam_score AS "spamScore",
                decision_confidence AS "decisionConfidence",
                relevance_method AS "relevanceMethod",
                is_featured AS "isFeatured",
                COALESCE((
                    SELECT COUNT(*)::INT
                    FROM discussion_message_highlights useful_marks
                    WHERE useful_marks.envelope_id = circle_discussion_messages.envelope_id
                ), 0) AS "usefulCount",
                FALSE AS "viewerHasMarkedUseful",
                feature_reason AS "featureReason",
                featured_at AS "featuredAt",
                is_ephemeral AS "isEphemeral",
                expires_at AS "expiresAt",
                client_timestamp AS "clientTimestamp",
                lamport AS "lamport",
                prev_envelope_id AS "prevEnvelopeId",
                deleted AS "deleted",
                tombstone_reason AS "tombstoneReason",
                tombstoned_at AS "tombstonedAt",
                NULL::BOOLEAN AS "sourceMessageDeleted",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);

        const row = rows[0];
        if (!row) {
            throw new Error('failed_to_insert_forward_message');
        }

        await updateOffchainWatermark(tx, {
            lamport: row.lamport,
            envelopeId: row.envelopeId,
        });

        await createForwardNotifications({
            prisma,
            tx,
            actor,
            forwardKind: 'single',
            targetCircle,
            targetEnvelopeId: row.envelopeId,
            sourceItems: [{ sourceAuthorPubkey: sourceRow.senderPubkey }],
            locale,
        });

        return row;
    });

    const message = await mapDiscussionRowForResponse(prisma, inserted, locale);

    return {
        message,
        row: inserted,
        realtimeEvent: {
            circleId: targetCircle.id,
            latestLamport: Number(inserted.lamport),
            envelopeId: inserted.envelopeId,
            reason: 'message_forwarded',
            message,
        },
    };
}

export async function createDiscussionForwardBundleProjection(
    input: CreateDiscussionForwardBundleProjectionInput,
): Promise<CreateDiscussionForwardBundleProjectionResult> {
    const { prisma, actor, targetCircleId, locale } = input;
    const requestedSourceEnvelopeIds = normalizeSourceEnvelopeIds(input.sourceEnvelopeIds);
    if (requestedSourceEnvelopeIds.length === 0 || requestedSourceEnvelopeIds.length > 20) {
        throw new DiscussionForwardingError(400, 'forward_source_message_count_invalid');
    }

    const sourceRows = await loadDiscussionRowsByEnvelopeIds(prisma, requestedSourceEnvelopeIds);
    const foundSourceIds = new Set(sourceRows.map((row) => row.envelopeId));
    const missingSourceIds = requestedSourceEnvelopeIds.filter((id) => !foundSourceIds.has(id));
    if (missingSourceIds.length > 0) {
        throw new DiscussionForwardingError(404, 'forward_source_message_not_found');
    }

    const sourceCircleIds = new Set(sourceRows.map((row) => row.circleId));
    if (sourceCircleIds.size !== 1) {
        throw new DiscussionForwardingError(400, 'forward_source_circle_mismatch');
    }

    const sourceCircleId = sourceRows[0]?.circleId;
    if (!sourceCircleId) {
        throw new DiscussionForwardingError(404, 'forward_source_message_not_found');
    }

    const [sourceCircle, targetCircle] = await Promise.all([
        loadCircleForwardingNode(prisma, sourceCircleId),
        loadCircleForwardingNode(prisma, targetCircleId),
    ]);
    if (!sourceCircle) {
        throw new DiscussionForwardingError(404, 'source_circle_not_found');
    }
    if (!targetCircle) {
        throw new DiscussionForwardingError(404, 'target_circle_not_found');
    }

    await requireCircleActorForAuthActor(actor, prisma, {
        circleId: sourceCircle.id,
        action: 'discussion.write',
    });
    const targetCircleActor = await requireCircleActorForAuthActor(actor, prisma, {
        circleId: targetCircle.id,
        action: 'discussion.write',
    });

    for (const sourceRow of sourceRows) {
        const decision = canForwardDiscussionMessage({
            sourceCircle,
            targetCircle,
            sourceMessageKind: sourceRow.messageKind,
            sourceIsEphemeral: sourceRow.isEphemeral,
            sourceIsDeleted: sourceRow.deleted,
            sourcePayloadText: sourceRow.payloadText,
        });
        if (!decision.allowed) {
            throwForwardingDecision(decision.reason);
        }
    }

    await resolvePlazaDiscussionContextForWrite(prisma as any, {
        circleId: targetCircle.id,
        activeCircleMember: true,
        circleActor: targetCircleActor,
        now: new Date(),
    });

    const displayRefs = sourceRows.map((row) => ({
        displayKey: `forward-bundle:${row.envelopeId}:source`,
        pubkey: row.senderPubkey,
        circleId: sourceCircle.id,
        sourceCircleId: sourceCircle.id,
        snapshotAt: row.createdAt,
    }));
    const displays = await resolveCircleActorDisplays({
        prisma,
        actors: displayRefs,
        mode: 'source_snapshot',
        locale,
    });

    const items: ForwardBundleItemInput[] = sourceRows.map((row, index) => {
        const displayKey = `forward-bundle:${row.envelopeId}:source`;
        const display = displays.get(displayKey);
        const snapshot = buildForwardBundleSnapshotText(row.payloadText, locale);
        return {
            position: index,
            sourceEnvelopeId: row.envelopeId,
            sourceCircleId: sourceCircle.id,
            sourceAuthorPubkey: row.senderPubkey,
            sourceAuthorDisplayName: display?.effectiveName
                ?? row.senderHandle
                ?? localizeQueryApiCopy('identity.genericMember', locale),
            sourceAuthorDisplaySource: display?.displaySource ?? 'generic_member',
            sourceAuthorDisplayCircleId: display?.displayCircleId ?? sourceCircle.id,
            sourceMessageCreatedAt: row.createdAt,
            snapshotText: snapshot.snapshotText,
            snapshotTruncated: snapshot.snapshotTruncated,
            sourceDeletedAtForwardTime: row.deleted,
        };
    });

    const orderedSourceEnvelopeIds = sourceRows.map((row) => row.envelopeId);
    const orderedSourceEnvelopeIdsDigest = computeForwardBundleDigest(orderedSourceEnvelopeIds);
    const bundleId = buildForwardBundleId({
        sourceCircleId: sourceCircle.id,
        targetCircleId: targetCircle.id,
        orderedSourceEnvelopeIdsDigest,
    });
    const forwardedAt = new Date();
    const payloadText = buildForwardBundlePayloadSummary(items);
    const payloadHash = sha256Hex(payloadText);
    const roomKey = buildDiscussionRoomKey(targetCircle.id);
    const nonce = randomNonce();
    const clientTimestamp = forwardedAt.toISOString();
    const messageEnvelopeId = computeDiscussionEnvelopeId({
        roomKey,
        senderPubkey: actor.pubkey,
        payloadHash,
        clientTimestamp,
        nonce,
        prevEnvelopeId: null,
        signatureBase64: null,
        subjectType: 'discussion_forward_bundle',
        subjectId: bundleId,
    });
    const persistedForwardedAt = sqlTimestampWithoutTimeZone(forwardedAt);
    const metadata = {
        bundleId,
        sourceCircleId: sourceCircle.id,
        sourceCircleName: sourceCircle.name,
        sourceLevel: sourceCircle.level,
        targetCircleId: targetCircle.id,
        orderedSourceEnvelopeIds,
        orderedSourceEnvelopeIdsDigest,
        itemCount: items.length,
        forwarderHandle: actor.handle,
        forwardedAt: forwardedAt.toISOString(),
    };

    const transactionResult = await prisma.$transaction(async (tx) => {
        const bundleResult = await createForwardBundleRecord(tx as any, {
            bundleId,
            sourceCircleId: sourceCircle.id,
            targetCircleId: targetCircle.id,
            orderedSourceEnvelopeIdsDigest,
            messageEnvelopeId,
            forwarderPubkey: actor.pubkey,
            forwarderHandle: actor.handle,
            items,
            now: forwardedAt,
        });

        if (bundleResult.status === 'existing') {
            const existingMessageEnvelopeId = bundleResult.bundle.messageEnvelopeId;
            if (!existingMessageEnvelopeId) {
                throw new Error('forward_bundle_existing_message_missing');
            }
            const existingRow = await loadDiscussionRowByEnvelopeId(tx as any, existingMessageEnvelopeId);
            if (!existingRow) {
                throw new Error('forward_bundle_existing_message_not_found');
            }
            return {
                status: 'existing' as const,
                bundleId: bundleResult.bundle.bundleId,
                row: existingRow,
            };
        }

        const rows = await tx.$queryRaw<DiscussionRow[]>(Prisma.sql`
            INSERT INTO circle_discussion_messages (
                envelope_id,
                stream_key,
                room_key,
                circle_id,
                sender_pubkey,
                sender_handle,
                message_kind,
                subject_type,
                subject_id,
                metadata,
                payload_text,
                payload_hash,
                nonce,
                signature,
                signature_scheme,
                signed_message,
                signature_verified,
                auth_mode,
                session_id,
                relevance_score,
                semantic_score,
                quality_score,
                spam_score,
                decision_confidence,
                relevance_method,
                is_featured,
                feature_reason,
                featured_at,
                client_timestamp,
                prev_envelope_id,
                created_at,
                updated_at
            )
            VALUES (
                ${messageEnvelopeId},
                ${DISCUSSION_STREAM_KEY},
                ${roomKey},
                ${targetCircle.id},
                ${actor.pubkey},
                ${actor.handle},
                'forward_bundle',
                'discussion_forward_bundle',
                ${bundleId},
                ${JSON.stringify(metadata)}::jsonb,
                ${payloadText},
                ${payloadHash},
                ${nonce},
                NULL,
                'ed25519',
                ${`alcheme-discussion-forward-bundle:${JSON.stringify({ bundleId, targetCircleId: targetCircle.id, nonce })}`},
                TRUE,
                'session_token',
                NULL,
                1,
                1,
                0.5,
                0,
                0.5,
                'rule',
                FALSE,
                NULL,
                NULL,
                ${persistedForwardedAt},
                NULL,
                ${persistedForwardedAt},
                ${persistedForwardedAt}
            )
            ON CONFLICT (envelope_id) DO UPDATE SET
                updated_at = ${sqlTimestampWithoutTimeZone(new Date())}
            RETURNING
                envelope_id AS "envelopeId",
                room_key AS "roomKey",
                circle_id AS "circleId",
                sender_pubkey AS "senderPubkey",
                sender_handle AS "senderHandle",
                message_kind AS "messageKind",
                subject_type AS "subjectType",
                subject_id AS "subjectId",
                metadata AS "metadata",
                payload_text AS "payloadText",
                payload_hash AS "payloadHash",
                nonce AS "nonce",
                signature AS "signature",
                signature_verified AS "signatureVerified",
                auth_mode AS "authMode",
                session_id AS "sessionId",
                relevance_score AS "relevanceScore",
                semantic_score AS "semanticScore",
                quality_score AS "qualityScore",
                spam_score AS "spamScore",
                decision_confidence AS "decisionConfidence",
                relevance_method AS "relevanceMethod",
                is_featured AS "isFeatured",
                COALESCE((
                    SELECT COUNT(*)::INT
                    FROM discussion_message_highlights useful_marks
                    WHERE useful_marks.envelope_id = circle_discussion_messages.envelope_id
                ), 0) AS "usefulCount",
                FALSE AS "viewerHasMarkedUseful",
                feature_reason AS "featureReason",
                featured_at AS "featuredAt",
                is_ephemeral AS "isEphemeral",
                expires_at AS "expiresAt",
                client_timestamp AS "clientTimestamp",
                lamport AS "lamport",
                prev_envelope_id AS "prevEnvelopeId",
                deleted AS "deleted",
                tombstone_reason AS "tombstoneReason",
                tombstoned_at AS "tombstonedAt",
                NULL::BOOLEAN AS "sourceMessageDeleted",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);

        const row = rows[0];
        if (!row) {
            throw new Error('failed_to_insert_forward_bundle_message');
        }

        await updateOffchainWatermark(tx, {
            lamport: row.lamport,
            envelopeId: row.envelopeId,
        });

        await createForwardNotifications({
            prisma,
            tx,
            actor,
            forwardKind: 'bundle',
            targetCircle,
            targetEnvelopeId: row.envelopeId,
            sourceItems: items,
            locale,
        });

        return {
            status: 'created' as const,
            bundleId,
            row,
        };
    });

    const message = await mapDiscussionRowForResponse(prisma, transactionResult.row, locale);

    return {
        status: transactionResult.status,
        bundleId: transactionResult.bundleId,
        message,
        row: transactionResult.row,
        realtimeEvent: transactionResult.status === 'created'
            ? {
                circleId: targetCircle.id,
                latestLamport: Number(transactionResult.row.lamport),
                envelopeId: transactionResult.row.envelopeId,
                reason: 'message_forwarded',
                message,
            }
            : null,
    };
}
