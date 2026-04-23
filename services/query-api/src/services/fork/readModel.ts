import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveCirclePolicyProfile } from '../policy/profile';

interface ForkLineageViewRow {
    lineageId: string | number;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string | number;
    sourceCircleName: string;
    targetCircleName: string;
    declarationText: string;
    status: string;
    originAnchorRef: string | null;
    executionAnchorDigest: string | null;
    createdAt: Date;
    currentCheckpointDay: number | null;
    nextCheckAt: Date | null;
    inactiveStreak: number | null;
    markerVisible: boolean | null;
    permanentAt: Date | null;
    hiddenAt: Date | null;
    lastEvaluatedAt: Date | null;
}

export interface ForkLineageViewItem {
    lineageId: string;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string;
    sourceCircleName: string;
    targetCircleName: string;
    declarationText: string;
    status: string;
    originAnchorRef: string | null;
    executionAnchorDigest: string | null;
    createdAt: string;
    currentCheckpointDay: number | null;
    nextCheckAt: string | null;
    inactiveStreak: number | null;
    markerVisible: boolean | null;
    permanentAt: string | null;
    hiddenAt: string | null;
    lastEvaluatedAt: string | null;
}

export interface ForkLineageView {
    circleId: number;
    asSource: ForkLineageViewItem[];
    asTarget: ForkLineageViewItem[];
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapLineageViewRow(row: ForkLineageViewRow): ForkLineageViewItem {
    return {
        lineageId: String(row.lineageId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId,
        declarationId: String(row.declarationId),
        sourceCircleName: row.sourceCircleName,
        targetCircleName: row.targetCircleName,
        declarationText: row.declarationText,
        status: String(row.status || 'completed'),
        originAnchorRef: row.originAnchorRef ?? null,
        executionAnchorDigest: row.executionAnchorDigest ?? null,
        createdAt: row.createdAt.toISOString(),
        currentCheckpointDay: typeof row.currentCheckpointDay === 'number' ? row.currentCheckpointDay : null,
        nextCheckAt: row.nextCheckAt instanceof Date ? row.nextCheckAt.toISOString() : null,
        inactiveStreak: typeof row.inactiveStreak === 'number' ? row.inactiveStreak : null,
        markerVisible: typeof row.markerVisible === 'boolean' ? row.markerVisible : null,
        permanentAt: row.permanentAt instanceof Date ? row.permanentAt.toISOString() : null,
        hiddenAt: row.hiddenAt instanceof Date ? row.hiddenAt.toISOString() : null,
        lastEvaluatedAt: row.lastEvaluatedAt instanceof Date ? row.lastEvaluatedAt.toISOString() : null,
    };
}

export async function loadForkLineageView(
    prisma: PrismaClient,
    circleId: number,
): Promise<ForkLineageView> {
    const normalizedCircleId = asPositiveInteger(circleId);
    if (!normalizedCircleId) {
        throw new Error('invalid_circle_id');
    }

    const rows = await prisma.$queryRaw<ForkLineageViewRow[]>(Prisma.sql`
        SELECT
            lineage.lineage_id AS "lineageId",
            lineage.source_circle_id AS "sourceCircleId",
            lineage.target_circle_id AS "targetCircleId",
            lineage.declaration_id AS "declarationId",
            source_circle.name AS "sourceCircleName",
            target_circle.name AS "targetCircleName",
            declaration.declaration_text AS "declarationText",
            declaration.status AS "status",
            COALESCE(lineage.origin_anchor_ref, declaration.origin_anchor_ref) AS "originAnchorRef",
            COALESCE(lineage.execution_anchor_digest, declaration.execution_anchor_digest) AS "executionAnchorDigest",
            lineage.created_at AS "createdAt",
            retention.current_checkpoint_day AS "currentCheckpointDay",
            retention.next_check_at AS "nextCheckAt",
            retention.inactive_streak AS "inactiveStreak",
            retention.marker_visible AS "markerVisible",
            retention.permanent_at AS "permanentAt",
            retention.hidden_at AS "hiddenAt",
            retention.last_evaluated_at AS "lastEvaluatedAt"
        FROM circle_fork_lineage lineage
        INNER JOIN fork_declarations declaration
            ON declaration.declaration_id = lineage.declaration_id
        INNER JOIN circles source_circle
            ON source_circle.id = lineage.source_circle_id
        INNER JOIN circles target_circle
            ON target_circle.id = lineage.target_circle_id
        LEFT JOIN circle_fork_retention_state retention
            ON retention.target_circle_id = lineage.target_circle_id
        WHERE lineage.source_circle_id = ${normalizedCircleId}
           OR lineage.target_circle_id = ${normalizedCircleId}
        ORDER BY lineage.created_at DESC
    `);

    const items = rows.map(mapLineageViewRow);
    return {
        circleId: normalizedCircleId,
        asSource: items.filter((item) => item.sourceCircleId === normalizedCircleId),
        asTarget: items.filter((item) => item.targetCircleId === normalizedCircleId),
    };
}

export async function buildForkInheritanceSnapshot(
    prisma: PrismaClient,
    sourceCircleId: number,
): Promise<Record<string, unknown>> {
    const normalizedCircleId = asPositiveInteger(sourceCircleId);
    if (!normalizedCircleId) {
        throw new Error('invalid_source_circle_id');
    }

    const [circle, policyProfile] = await Promise.all([
        prisma.circle.findUnique({
            where: { id: normalizedCircleId },
            select: {
                id: true,
                name: true,
                description: true,
                mode: true,
                joinRequirement: true,
                minCrystals: true,
            },
        }),
        resolveCirclePolicyProfile(prisma, normalizedCircleId),
    ]);

    if (!circle) {
        throw new Error('source_circle_not_found');
    }

    return {
        sourceType: policyProfile.sourceType,
        inheritanceMode: policyProfile.inheritanceMode,
        localEditability: policyProfile.localEditability,
        inheritsFromProfileId: policyProfile.inheritsFromProfileId,
        inheritsFromCircleId: policyProfile.inheritsFromCircleId,
        configVersion: policyProfile.configVersion,
        baseCircle: {
            circleId: circle.id,
            name: circle.name,
            description: circle.description ?? null,
            mode: circle.mode,
            joinRequirement: circle.joinRequirement,
            minCrystals: circle.minCrystals,
        },
        draftLifecycleTemplate: policyProfile.draftLifecycleTemplate,
        draftWorkflowPolicy: policyProfile.draftWorkflowPolicy,
        ghostPolicy: policyProfile.ghostPolicy,
        forkPolicy: policyProfile.forkPolicy,
    };
}
