import { Prisma, type PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type DraftParagraphDependencyKind =
    | 'draft_comment'
    | 'discussion_thread'
    | 'temporary_edit_grant'
    | 'revision_direction';

export interface LockedDraftParagraphStructure {
    draftPostId: number;
    text: string;
    documentStatus: string;
    currentSnapshotVersion: number;
}

interface LockedDraftParagraphStructureRow {
    draftPostId: number;
    text: string | null;
    documentStatus: string | null;
    currentSnapshotVersion: number | null;
}

interface DraftParagraphDependencyRow {
    kind: DraftParagraphDependencyKind;
}

export async function lockDraftParagraphStructure(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<LockedDraftParagraphStructure | null> {
    const rows = await prisma.$queryRaw<LockedDraftParagraphStructureRow[]>(Prisma.sql`
        SELECT
            p.id AS "draftPostId",
            p.text,
            COALESCE(s.document_status, 'drafting') AS "documentStatus",
            COALESCE(s.current_snapshot_version, 1) AS "currentSnapshotVersion"
        FROM posts p
        LEFT JOIN draft_workflow_state s
            ON s.draft_post_id = p.id
        WHERE p.id = ${draftPostId}
        FOR UPDATE OF p
    `);
    const row = rows[0];
    if (!row) return null;
    return {
        draftPostId: row.draftPostId,
        text: String(row.text || ''),
        documentStatus: String(row.documentStatus || 'drafting').toLowerCase(),
        currentSnapshotVersion: Math.max(1, Number(row.currentSnapshotVersion || 1)),
    };
}

export async function listDraftParagraphStructureDependencies(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<DraftParagraphDependencyKind[]> {
    const rows = await prisma.$queryRaw<DraftParagraphDependencyRow[]>(Prisma.sql`
        SELECT DISTINCT dependency.kind
        FROM (
            SELECT 'draft_comment'::TEXT AS kind
            FROM draft_comments
            WHERE post_id = ${draftPostId}
              AND line_ref ~ '^paragraph:[0-9]+$'
            UNION ALL
            SELECT 'discussion_thread'::TEXT AS kind
            FROM draft_discussion_threads
            WHERE draft_post_id = ${draftPostId}
              AND target_ref ~ '^paragraph:[0-9]+$'
            UNION ALL
            SELECT 'temporary_edit_grant'::TEXT AS kind
            FROM temporary_edit_grants
            WHERE draft_post_id = ${draftPostId}
              AND block_id ~ '^paragraph:[0-9]+$'
            UNION ALL
            SELECT 'revision_direction'::TEXT AS kind
            FROM revision_direction_proposals
            WHERE draft_post_id = ${draftPostId}
              AND scope_ref ~ '^paragraph:[0-9]+$'
        ) dependency
        ORDER BY dependency.kind
    `);
    return rows.map((row) => row.kind);
}

export async function lockDraftWorkingCopyForSnapshot(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<void> {
    await prisma.$queryRaw(Prisma.sql`
        SELECT id
        FROM posts
        WHERE id = ${draftPostId}
        FOR UPDATE
    `);
}
