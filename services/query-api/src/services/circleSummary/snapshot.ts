import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeAiGenerationMetadata, type AiGenerationMetadata } from '../../ai/metadata';

export type CircleSummaryGeneratedBy =
    | 'system_projection'
    | 'system_llm'
    | 'user_requested';

export interface CircleSummarySnapshot {
    summaryId: string;
    circleId: number;
    version: number;
    issueMap: unknown[];
    conceptGraph: Record<string, unknown>;
    viewpointBranches: unknown[];
    factExplanationEmotionBreakdown: Record<string, unknown>;
    emotionConflictContext: Record<string, unknown>;
    sedimentationTimeline: unknown[];
    openQuestions: unknown[];
    generatedAt: Date;
    generatedBy: CircleSummaryGeneratedBy;
    generationMetadata: AiGenerationMetadata | null;
}

export interface CircleSummarySnapshotPersistenceInput {
    circleId: number;
    issueMap: unknown[];
    conceptGraph: Record<string, unknown>;
    viewpointBranches: unknown[];
    factExplanationEmotionBreakdown: Record<string, unknown>;
    emotionConflictContext: Record<string, unknown>;
    sedimentationTimeline: unknown[];
    openQuestions: unknown[];
    generatedAt: Date;
    generatedBy: CircleSummaryGeneratedBy;
    generationMetadata: AiGenerationMetadata | null;
}

interface CircleSummarySnapshotRow {
    summaryId: string;
    circleId: number;
    version: number;
    issueMap: unknown;
    conceptGraph: unknown;
    viewpointBranches: unknown;
    factExplanationEmotionBreakdown: unknown;
    emotionConflictContext: unknown;
    sedimentationTimeline: unknown;
    openQuestions: unknown;
    generatedAt: Date;
    generatedBy: string;
    generationMetadata: unknown;
}

function asPositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asArray(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function asGeneratedBy(value: unknown): CircleSummaryGeneratedBy | null {
    return value === 'system_projection'
        || value === 'system_llm'
        || value === 'user_requested'
        ? value
        : null;
}

function mapCircleSummarySnapshot(
    row: CircleSummarySnapshotRow | null | undefined,
): CircleSummarySnapshot | null {
    if (!row) return null;

    const circleId = asPositiveInt(row.circleId);
    const version = asPositiveInt(row.version);
    const issueMap = asArray(row.issueMap);
    const conceptGraph = asObject(row.conceptGraph);
    const viewpointBranches = asArray(row.viewpointBranches);
    const factExplanationEmotionBreakdown = asObject(row.factExplanationEmotionBreakdown);
    const emotionConflictContext = asObject(row.emotionConflictContext);
    const sedimentationTimeline = asArray(row.sedimentationTimeline);
    const openQuestions = asArray(row.openQuestions);
    const generatedBy = asGeneratedBy(row.generatedBy);
    const generationMetadata = normalizeAiGenerationMetadata(row.generationMetadata);

    if (
        typeof row.summaryId !== 'string'
        || !row.summaryId.trim()
        || !circleId
        || !version
        || !issueMap
        || !conceptGraph
        || !viewpointBranches
        || !factExplanationEmotionBreakdown
        || !emotionConflictContext
        || !sedimentationTimeline
        || !openQuestions
        || !(row.generatedAt instanceof Date)
        || !generatedBy
    ) {
        return null;
    }

    return {
        summaryId: row.summaryId,
        circleId,
        version,
        issueMap,
        conceptGraph,
        viewpointBranches,
        factExplanationEmotionBreakdown,
        emotionConflictContext,
        sedimentationTimeline,
        openQuestions,
        generatedAt: row.generatedAt,
        generatedBy,
        generationMetadata,
    };
}

function buildSummarySnapshotSelect(whereClause: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
        SELECT
            summary_id AS "summaryId",
            circle_id AS "circleId",
            version,
            issue_map AS "issueMap",
            concept_graph AS "conceptGraph",
            viewpoint_branches AS "viewpointBranches",
            fact_explanation_emotion_breakdown AS "factExplanationEmotionBreakdown",
            emotion_conflict_context AS "emotionConflictContext",
            sedimentation_timeline AS "sedimentationTimeline",
            open_questions AS "openQuestions",
            generated_at AS "generatedAt",
            generated_by AS "generatedBy",
            generation_metadata AS "generationMetadata"
        FROM circle_summary_snapshots
        ${whereClause}
    `;
}

function isUniqueConstraintViolation(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const candidate = error as {
        code?: unknown;
        meta?: {
            code?: unknown;
        };
    };

    if (candidate.code === 'P2002') {
        return true;
    }

    return candidate.code === 'P2010' && candidate.meta?.code === '23505';
}

export async function loadLatestCircleSummarySnapshot(
    prisma: PrismaClient,
    circleId: number,
): Promise<CircleSummarySnapshot | null> {
    const rows = await prisma.$queryRaw<CircleSummarySnapshotRow[]>(
        buildSummarySnapshotSelect(
            Prisma.sql`
                WHERE circle_id = ${circleId}
                ORDER BY version DESC
                LIMIT 1
            `,
        ),
    );
    return mapCircleSummarySnapshot(rows[0]);
}

export async function loadCircleSummarySnapshotByVersion(
    prisma: PrismaClient,
    circleId: number,
    version: number,
): Promise<CircleSummarySnapshot | null> {
    const rows = await prisma.$queryRaw<CircleSummarySnapshotRow[]>(
        buildSummarySnapshotSelect(
            Prisma.sql`
                WHERE circle_id = ${circleId}
                  AND version = ${version}
                LIMIT 1
            `,
        ),
    );
    return mapCircleSummarySnapshot(rows[0]);
}

export async function persistCircleSummarySnapshot(
    prisma: PrismaClient,
    input: CircleSummarySnapshotPersistenceInput,
): Promise<CircleSummarySnapshot> {
    const versionRows = await prisma.$queryRaw<Array<{ nextVersion: number }>>(Prisma.sql`
        SELECT COALESCE(MAX(version), 0) + 1 AS "nextVersion"
        FROM circle_summary_snapshots
        WHERE circle_id = ${input.circleId}
    `);
    const version = asPositiveInt(versionRows[0]?.nextVersion) ?? 1;
    const summaryId = `circle-${input.circleId}-v${version}`;

    let rows: CircleSummarySnapshotRow[];
    try {
        rows = await prisma.$queryRawUnsafe<CircleSummarySnapshotRow[]>(
            `
                INSERT INTO circle_summary_snapshots (
                    summary_id,
                    circle_id,
                    version,
                    issue_map,
                    concept_graph,
                    viewpoint_branches,
                    fact_explanation_emotion_breakdown,
                    emotion_conflict_context,
                    sedimentation_timeline,
                    open_questions,
                    generated_at,
                    generated_by,
                    generation_metadata
                )
                VALUES (
                    $1,
                    $2,
                    $3,
                    $4::jsonb,
                    $5::jsonb,
                    $6::jsonb,
                    $7::jsonb,
                    $8::jsonb,
                    $9::jsonb,
                    $10::jsonb,
                    $11,
                    $12,
                    $13::jsonb
                )
                RETURNING
                    summary_id AS "summaryId",
                    circle_id AS "circleId",
                    version,
                    issue_map AS "issueMap",
                    concept_graph AS "conceptGraph",
                    viewpoint_branches AS "viewpointBranches",
                    fact_explanation_emotion_breakdown AS "factExplanationEmotionBreakdown",
                    emotion_conflict_context AS "emotionConflictContext",
                    sedimentation_timeline AS "sedimentationTimeline",
                    open_questions AS "openQuestions",
                    generated_at AS "generatedAt",
                    generated_by AS "generatedBy",
                    generation_metadata AS "generationMetadata"
            `,
            summaryId,
            input.circleId,
            version,
            JSON.stringify(input.issueMap),
            JSON.stringify(input.conceptGraph),
            JSON.stringify(input.viewpointBranches),
            JSON.stringify(input.factExplanationEmotionBreakdown),
            JSON.stringify(input.emotionConflictContext),
            JSON.stringify(input.sedimentationTimeline),
            JSON.stringify(input.openQuestions),
            input.generatedAt,
            input.generatedBy,
            JSON.stringify(input.generationMetadata),
        );
    } catch (error) {
        if (!isUniqueConstraintViolation(error)) {
            throw error;
        }

        const latest = await loadLatestCircleSummarySnapshot(prisma, input.circleId);
        if (latest) {
            return latest;
        }

        throw error;
    }

    const snapshot = mapCircleSummarySnapshot(rows[0]);
    if (!snapshot) {
        throw new Error('invalid_circle_summary_snapshot_row');
    }
    return snapshot;
}
