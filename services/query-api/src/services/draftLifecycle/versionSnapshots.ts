import crypto from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { getCollabEditAnchorsBySnapshotHash } from '../collabEditAnchor';
import { getLatestDraftAnchorByPostId } from '../draftAnchor';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface DraftVersionSnapshotRow {
    draftPostId: number;
    draftVersion: number;
    contentSnapshot: string;
    contentHash: string;
    createdFromState: string;
    createdBy: number | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    createdAt: Date;
}

export interface DraftVersionSnapshotRecord {
    draftPostId: number;
    draftVersion: number;
    contentSnapshot: string;
    contentHash: string;
    createdFromState: string;
    createdBy: number | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    createdAt: string;
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function mapRowToRecord(row: DraftVersionSnapshotRow): DraftVersionSnapshotRecord {
    return {
        draftPostId: row.draftPostId,
        draftVersion: row.draftVersion,
        contentSnapshot: row.contentSnapshot,
        contentHash: row.contentHash,
        createdFromState: row.createdFromState,
        createdBy: row.createdBy ?? null,
        sourceEditAnchorId: row.sourceEditAnchorId ?? null,
        sourceSummaryHash: row.sourceSummaryHash ?? null,
        sourceMessagesDigest: row.sourceMessagesDigest ?? null,
        createdAt: row.createdAt.toISOString(),
    };
}

export async function loadDraftVersionSnapshot(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
    },
): Promise<DraftVersionSnapshotRecord | null> {
    const rows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        SELECT
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            created_at AS "createdAt"
        FROM draft_version_snapshots
        WHERE draft_post_id = ${input.draftPostId}
          AND draft_version = ${input.draftVersion}
        LIMIT 1
    `);

    return rows[0] ? mapRowToRecord(rows[0]) : null;
}

export async function createDraftVersionSnapshot(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
        contentSnapshot: string;
        createdFromState: 'drafting';
        createdBy: number | null;
    },
): Promise<DraftVersionSnapshotRecord> {
    const contentSnapshot = String(input.contentSnapshot || '');
    const contentHash = sha256Hex(contentSnapshot);
    const [latestDraftAnchor, matchingCollabAnchors] = await Promise.all([
        getLatestDraftAnchorByPostId(prisma, input.draftPostId),
        getCollabEditAnchorsBySnapshotHash(prisma, {
            draftPostId: input.draftPostId,
            snapshotHash: contentHash,
            limit: 5,
        }),
    ]);
    const latestAnchoredMatchingCollabAnchor =
        matchingCollabAnchors.find((anchor) => anchor.status === 'anchored') || null;

    const insertedRows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        INSERT INTO draft_version_snapshots (
            draft_post_id,
            draft_version,
            content_snapshot,
            content_hash,
            created_from_state,
            created_by,
            source_edit_anchor_id,
            source_summary_hash,
            source_messages_digest,
            created_at
        )
        VALUES (
            ${input.draftPostId},
            ${input.draftVersion},
            ${contentSnapshot},
            ${contentHash},
            ${input.createdFromState},
            ${input.createdBy},
            ${latestAnchoredMatchingCollabAnchor?.anchorId || null},
            ${latestDraftAnchor?.summaryHash || null},
            ${latestDraftAnchor?.messagesDigest || null},
            NOW()
        )
        ON CONFLICT (draft_post_id, draft_version) DO NOTHING
        RETURNING
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            created_at AS "createdAt"
    `);

    if (insertedRows[0]) {
        return mapRowToRecord(insertedRows[0]);
    }

    const existing = await loadDraftVersionSnapshot(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
    });
    if (!existing) {
        throw new Error('draft_version_snapshot_unavailable');
    }
    return existing;
}

export async function updateDraftVersionSnapshotSourceEvidence(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        draftVersion: number;
        sourceEditAnchorId?: string | null;
        sourceSummaryHash?: string | null;
        sourceMessagesDigest?: string | null;
    },
): Promise<DraftVersionSnapshotRecord | null> {
    const rows = await prisma.$queryRaw<DraftVersionSnapshotRow[]>(Prisma.sql`
        UPDATE draft_version_snapshots
        SET
            source_edit_anchor_id = COALESCE(${input.sourceEditAnchorId ?? null}, source_edit_anchor_id),
            source_summary_hash = COALESCE(${input.sourceSummaryHash ?? null}, source_summary_hash),
            source_messages_digest = COALESCE(${input.sourceMessagesDigest ?? null}, source_messages_digest)
        WHERE draft_post_id = ${input.draftPostId}
          AND draft_version = ${input.draftVersion}
        RETURNING
            draft_post_id AS "draftPostId",
            draft_version AS "draftVersion",
            content_snapshot AS "contentSnapshot",
            content_hash AS "contentHash",
            created_from_state AS "createdFromState",
            created_by AS "createdBy",
            source_edit_anchor_id AS "sourceEditAnchorId",
            source_summary_hash AS "sourceSummaryHash",
            source_messages_digest AS "sourceMessagesDigest",
            created_at AS "createdAt"
    `);

    return rows[0] ? mapRowToRecord(rows[0]) : null;
}
