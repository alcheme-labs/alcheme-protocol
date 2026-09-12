import crypto from 'crypto';
import { Prisma } from '@prisma/client';

interface SqlClient {
    $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

interface ForwardBundleRow {
    id: bigint;
    bundleId: string;
    sourceCircleId: number;
    targetCircleId: number;
    orderedSourceEnvelopeIdsDigest: string;
    messageEnvelopeId: string | null;
    forwarderPubkey: string;
    forwarderHandle: string | null;
    itemCount: number;
    createdAt: Date;
    updatedAt: Date;
}

interface ForwardBundleItemRow {
    id?: bigint;
    bundleId: string;
    position: number;
    sourceEnvelopeId: string;
    sourceCircleId: number;
    sourceAuthorPubkey: string;
    sourceAuthorDisplayName: string;
    sourceAuthorDisplaySource: string;
    sourceAuthorDisplayCircleId: number | null;
    sourceMessageCreatedAt: Date;
    snapshotText: string;
    snapshotTruncated: boolean;
    sourceDeletedAtForwardTime: boolean;
    createdAt: Date;
}

export interface ForwardBundleItemInput {
    position: number;
    sourceEnvelopeId: string;
    sourceCircleId: number;
    sourceAuthorPubkey: string;
    sourceAuthorDisplayName: string;
    sourceAuthorDisplaySource: string;
    sourceAuthorDisplayCircleId?: number | null;
    sourceMessageCreatedAt: Date;
    snapshotText: string;
    snapshotTruncated?: boolean;
    sourceDeletedAtForwardTime?: boolean;
}

export interface ForwardBundleRecord {
    id: bigint;
    bundleId: string;
    sourceCircleId: number;
    targetCircleId: number;
    orderedSourceEnvelopeIdsDigest: string;
    messageEnvelopeId: string | null;
    forwarderPubkey: string;
    forwarderHandle: string | null;
    itemCount: number;
    createdAt: Date;
    updatedAt: Date;
    items: ForwardBundleItemRow[];
}

export type CreateForwardBundleRecordResult =
    | { status: 'created'; bundle: ForwardBundleRecord }
    | { status: 'existing'; bundle: ForwardBundleRecord };

export interface FindExistingForwardBundleInput {
    sourceCircleId: number;
    targetCircleId: number;
    orderedSourceEnvelopeIdsDigest: string;
}

export interface CreateForwardBundleRecordInput extends FindExistingForwardBundleInput {
    bundleId: string;
    messageEnvelopeId?: string | null;
    forwarderPubkey: string;
    forwarderHandle?: string | null;
    items: ForwardBundleItemInput[];
    now?: Date;
}

export function computeForwardBundleDigest(orderedEnvelopeIds: readonly string[]): string {
    const normalized = orderedEnvelopeIds.map((value) => String(value || '').trim());
    if (normalized.length === 0 || normalized.some((value) => value.length === 0)) {
        throw new Error('forward_bundle_source_envelope_ids_required');
    }
    return crypto
        .createHash('sha256')
        .update(normalized.join('|'))
        .digest('hex');
}

function mapBundle(row: ForwardBundleRow, items: ForwardBundleItemRow[]): ForwardBundleRecord {
    return {
        id: row.id,
        bundleId: row.bundleId,
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId,
        orderedSourceEnvelopeIdsDigest: row.orderedSourceEnvelopeIdsDigest,
        messageEnvelopeId: row.messageEnvelopeId,
        forwarderPubkey: row.forwarderPubkey,
        forwarderHandle: row.forwarderHandle,
        itemCount: row.itemCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        items,
    };
}

function normalizeItemInput(input: ForwardBundleItemInput, bundleId: string, createdAt: Date): ForwardBundleItemRow {
    return {
        bundleId,
        position: Math.trunc(input.position),
        sourceEnvelopeId: input.sourceEnvelopeId,
        sourceCircleId: input.sourceCircleId,
        sourceAuthorPubkey: input.sourceAuthorPubkey,
        sourceAuthorDisplayName: input.sourceAuthorDisplayName,
        sourceAuthorDisplaySource: input.sourceAuthorDisplaySource,
        sourceAuthorDisplayCircleId: input.sourceAuthorDisplayCircleId ?? null,
        sourceMessageCreatedAt: input.sourceMessageCreatedAt,
        snapshotText: input.snapshotText,
        snapshotTruncated: Boolean(input.snapshotTruncated),
        sourceDeletedAtForwardTime: Boolean(input.sourceDeletedAtForwardTime),
        createdAt,
    };
}

async function loadForwardBundleItems(client: SqlClient, bundleId: string): Promise<ForwardBundleItemRow[]> {
    return client.$queryRaw<ForwardBundleItemRow[]>(Prisma.sql`
        SELECT
            id,
            bundle_id AS "bundleId",
            position,
            source_envelope_id AS "sourceEnvelopeId",
            source_circle_id AS "sourceCircleId",
            source_author_pubkey AS "sourceAuthorPubkey",
            source_author_display_name AS "sourceAuthorDisplayName",
            source_author_display_source AS "sourceAuthorDisplaySource",
            source_author_display_circle_id AS "sourceAuthorDisplayCircleId",
            source_message_created_at AS "sourceMessageCreatedAt",
            snapshot_text AS "snapshotText",
            snapshot_truncated AS "snapshotTruncated",
            source_deleted_at_forward_time AS "sourceDeletedAtForwardTime",
            created_at AS "createdAt"
        FROM discussion_forward_bundle_items
        WHERE bundle_id = ${bundleId}
        ORDER BY position ASC
    `);
}

export async function findExistingForwardBundle(
    client: SqlClient,
    input: FindExistingForwardBundleInput,
): Promise<ForwardBundleRecord | null> {
    const rows = await client.$queryRaw<ForwardBundleRow[]>(Prisma.sql`
        SELECT
            id,
            bundle_id AS "bundleId",
            source_circle_id AS "sourceCircleId",
            target_circle_id AS "targetCircleId",
            ordered_source_envelope_ids_digest AS "orderedSourceEnvelopeIdsDigest",
            message_envelope_id AS "messageEnvelopeId",
            forwarder_pubkey AS "forwarderPubkey",
            forwarder_handle AS "forwarderHandle",
            item_count AS "itemCount",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM discussion_forward_bundles
        WHERE source_circle_id = ${input.sourceCircleId}
          AND target_circle_id = ${input.targetCircleId}
          AND ordered_source_envelope_ids_digest = ${input.orderedSourceEnvelopeIdsDigest}
        LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    const items = await loadForwardBundleItems(client, row.bundleId);
    return mapBundle(row, items);
}

export async function createForwardBundleRecord(
    client: SqlClient,
    input: CreateForwardBundleRecordInput,
): Promise<CreateForwardBundleRecordResult> {
    if (input.items.length === 0) {
        throw new Error('forward_bundle_items_required');
    }

    const existing = await findExistingForwardBundle(client, input);
    if (existing) {
        return { status: 'existing', bundle: existing };
    }

    const now = input.now ?? new Date();
    const insertRows = await client.$queryRaw<ForwardBundleRow[]>(Prisma.sql`
        INSERT INTO discussion_forward_bundles (
            bundle_id,
            source_circle_id,
            target_circle_id,
            ordered_source_envelope_ids_digest,
            message_envelope_id,
            forwarder_pubkey,
            forwarder_handle,
            item_count,
            created_at,
            updated_at
        )
        VALUES (
            ${input.bundleId},
            ${input.sourceCircleId},
            ${input.targetCircleId},
            ${input.orderedSourceEnvelopeIdsDigest},
            ${input.messageEnvelopeId ?? null},
            ${input.forwarderPubkey},
            ${input.forwarderHandle ?? null},
            ${input.items.length},
            ${now},
            ${now}
        )
        ON CONFLICT (source_circle_id, target_circle_id, ordered_source_envelope_ids_digest)
        DO NOTHING
        RETURNING
            id,
            bundle_id AS "bundleId",
            source_circle_id AS "sourceCircleId",
            target_circle_id AS "targetCircleId",
            ordered_source_envelope_ids_digest AS "orderedSourceEnvelopeIdsDigest",
            message_envelope_id AS "messageEnvelopeId",
            forwarder_pubkey AS "forwarderPubkey",
            forwarder_handle AS "forwarderHandle",
            item_count AS "itemCount",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
    `);

    const inserted = insertRows[0];
    if (!inserted) {
        await client.$queryRaw<ForwardBundleRow[]>(Prisma.sql`
            UPDATE discussion_forward_bundles
            SET updated_at = ${now}
            WHERE source_circle_id = ${input.sourceCircleId}
              AND target_circle_id = ${input.targetCircleId}
              AND ordered_source_envelope_ids_digest = ${input.orderedSourceEnvelopeIdsDigest}
            RETURNING
                id,
                bundle_id AS "bundleId",
                source_circle_id AS "sourceCircleId",
                target_circle_id AS "targetCircleId",
                ordered_source_envelope_ids_digest AS "orderedSourceEnvelopeIdsDigest",
                message_envelope_id AS "messageEnvelopeId",
                forwarder_pubkey AS "forwarderPubkey",
                forwarder_handle AS "forwarderHandle",
                item_count AS "itemCount",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        const racedExisting = await findExistingForwardBundle(client, input);
        if (!racedExisting) {
            throw new Error('forward_bundle_unique_conflict_without_existing_record');
        }
        return { status: 'existing', bundle: racedExisting };
    }

    const itemRows = input.items.map((item) => normalizeItemInput(item, input.bundleId, now));
    await client.$queryRaw(Prisma.sql`
        INSERT INTO discussion_forward_bundle_items (
            bundle_id,
            position,
            source_envelope_id,
            source_circle_id,
            source_author_pubkey,
            source_author_display_name,
            source_author_display_source,
            source_author_display_circle_id,
            source_message_created_at,
            snapshot_text,
            snapshot_truncated,
            source_deleted_at_forward_time,
            created_at
        )
        VALUES ${Prisma.join(itemRows.map((item) => Prisma.sql`(
            ${item.bundleId},
            ${item.position},
            ${item.sourceEnvelopeId},
            ${item.sourceCircleId},
            ${item.sourceAuthorPubkey},
            ${item.sourceAuthorDisplayName},
            ${item.sourceAuthorDisplaySource},
            ${item.sourceAuthorDisplayCircleId},
            ${item.sourceMessageCreatedAt},
            ${item.snapshotText},
            ${item.snapshotTruncated},
            ${item.sourceDeletedAtForwardTime},
            ${item.createdAt}
        )`))}
        ON CONFLICT (bundle_id, source_envelope_id) DO NOTHING
    `);

    return {
        status: 'created',
        bundle: mapBundle(inserted, itemRows),
    };
}
