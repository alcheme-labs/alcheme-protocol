import { Prisma, type PrismaClient } from '@prisma/client';

import type {
    ForkContextCapsuleInput,
    ForkContextCapsuleRecord,
    ForkContextReleaseRecord,
    ForkContextReleaseSourceRef,
    ForkGateEvaluationPolicy,
    ForkReferenceType,
    ForkReferenceVisibilityState,
    ForkRestrictionState,
    ForkSourceGateSnapshot,
    ForkSourcePathEntry,
    ForkUpstreamReferenceRecord,
} from './contextTypes';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface ForkContextCapsuleRow {
    capsuleId: string;
    declarationId: string;
    lineageId: string;
    sourceCircleId: number;
    targetCircleId: number;
    actorUserId: number;
    sourcePathSnapshot: unknown;
    originSnapshot: unknown;
    gateEvaluationPolicy: unknown;
    capsuleDigest: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

interface ForkUpstreamReferenceRow {
    referenceId: string;
    capsuleId: string;
    sourceCircleId: number;
    targetCircleId: number;
    sourceMaterialId: number | null;
    circleSummarySnapshotId: number | null;
    referenceType: string;
    visibilityState: string;
    sourceGateSnapshot: unknown;
    restrictionState: string;
    releaseId: string | null;
    sourceDigest: string | null;
    summaryDigest: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
}

interface ForkContextReleaseRow {
    releaseId: string;
    sourceCircleId: number;
    targetCircleId: number | null;
    releaseAudience: string;
    approvedByUserId: number | null;
    approvalMethod: string;
    governanceRequestId: string | null;
    decisionDigest: string | null;
    sourceRefs: unknown;
    summaryText: string | null;
    summaryDigest: string;
    status: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ForkContextStore {
    getCapsuleByTargetCircleId(targetCircleId: number): Promise<ForkContextCapsuleRecord | null>;
    ensureCapsule(input: ForkContextCapsuleInput): Promise<ForkContextCapsuleRecord>;
    listReferencesByTargetCircleId(targetCircleId: number): Promise<ForkUpstreamReferenceRecord[]>;
    getReferenceById(referenceId: string): Promise<ForkUpstreamReferenceRecord | null>;
    saveReference(input: ForkUpstreamReferenceRecord): Promise<ForkUpstreamReferenceRecord>;
    getActiveReleaseById(releaseId: string): Promise<ForkContextReleaseRecord | null>;
}

function toJsonbSql(value: unknown): Prisma.Sql {
    if (value === null || value === undefined) {
        return Prisma.sql`NULL`;
    }
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return {};
        }
    }
    return {};
}

function asNullableRecord(value: unknown): Record<string, unknown> | null {
    const record = asRecord(value);
    return Object.keys(record).length > 0 ? record : null;
}

function asReleaseSourceRefs(value: unknown): ForkContextReleaseSourceRef[] {
    if (Array.isArray(value)) {
        return value
            .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
            .map((entry) => entry as ForkContextReleaseSourceRef);
    }
    const record = asRecord(value);
    if (Array.isArray(record.sourceRefs)) {
        return asReleaseSourceRefs(record.sourceRefs);
    }
    if (Array.isArray(record.referenceIds)) {
        return record.referenceIds
            .map((referenceId) => ({ referenceId: String(referenceId) }))
            .filter((entry) => entry.referenceId.trim().length > 0);
    }
    return [];
}

function asPathSnapshot(value: unknown): ForkSourcePathEntry[] {
    return Array.isArray(value) ? value as ForkSourcePathEntry[] : [];
}

function normalizeCapsuleStatus(value: unknown): ForkContextCapsuleRecord['status'] {
    const normalized = String(value || '').trim();
    if (normalized === 'context_pending') return 'context_pending';
    if (normalized === 'revoked') return 'revoked';
    return 'active';
}

function normalizeReferenceType(value: unknown): ForkReferenceType {
    const normalized = String(value || '').trim();
    if (normalized === 'source_material') return 'source_material';
    if (normalized === 'circle_summary') return 'circle_summary';
    if (normalized === 'knowledge') return 'knowledge';
    if (normalized === 'sealed_metadata') return 'sealed_metadata';
    return 'lineage';
}

function normalizeVisibilityState(value: unknown): ForkReferenceVisibilityState {
    const normalized = String(value || '').trim();
    if (normalized === 'source_gated') return 'source_gated';
    if (normalized === 'sealed_source') return 'sealed_source';
    if (normalized === 'released_summary') return 'released_summary';
    return 'public_source';
}

function normalizeRestrictionState(value: unknown): ForkRestrictionState {
    const normalized = String(value || '').trim();
    if (normalized === 'source_gate_required') return 'source_gate_required';
    if (normalized === 'sealed') return 'sealed';
    if (normalized === 'released_safe_summary') return 'released_safe_summary';
    if (normalized === 'revoked') return 'revoked';
    return 'none';
}

function mapCapsuleRow(row: ForkContextCapsuleRow): ForkContextCapsuleRecord {
    return {
        capsuleId: String(row.capsuleId),
        declarationId: String(row.declarationId),
        lineageId: String(row.lineageId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId,
        actorUserId: row.actorUserId,
        sourcePathSnapshot: asPathSnapshot(row.sourcePathSnapshot),
        originSnapshot: asRecord(row.originSnapshot) as ForkContextCapsuleInput['originSnapshot'],
        gateEvaluationPolicy: asRecord(row.gateEvaluationPolicy) as unknown as ForkGateEvaluationPolicy,
        capsuleDigest: row.capsuleDigest,
        status: normalizeCapsuleStatus(row.status),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function mapReferenceRow(row: ForkUpstreamReferenceRow): ForkUpstreamReferenceRecord {
    return {
        referenceId: String(row.referenceId),
        capsuleId: String(row.capsuleId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId,
        sourceMaterialId: asPositiveInteger(row.sourceMaterialId),
        circleSummarySnapshotId: asPositiveInteger(row.circleSummarySnapshotId),
        referenceType: normalizeReferenceType(row.referenceType),
        visibilityState: normalizeVisibilityState(row.visibilityState),
        sourceGateSnapshot: asRecord(row.sourceGateSnapshot) as unknown as ForkSourceGateSnapshot,
        restrictionState: normalizeRestrictionState(row.restrictionState),
        releaseId: row.releaseId ?? null,
        sourceDigest: row.sourceDigest ?? null,
        summaryDigest: row.summaryDigest ?? null,
        metadata: asNullableRecord(row.metadata),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function mapReleaseRow(row: ForkContextReleaseRow): ForkContextReleaseRecord {
    return {
        releaseId: String(row.releaseId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId ?? null,
        releaseAudience: row.releaseAudience,
        approvedByUserId: row.approvedByUserId ?? null,
        approvalMethod: row.approvalMethod,
        governanceRequestId: row.governanceRequestId ?? null,
        decisionDigest: row.decisionDigest ?? null,
        sourceRefs: asReleaseSourceRefs(row.sourceRefs),
        summaryText: row.summaryText ?? null,
        summaryDigest: row.summaryDigest,
        status: row.status,
        expiresAt: row.expiresAt ?? null,
        revokedAt: row.revokedAt ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export function createPrismaForkContextStore(
    prisma: PrismaLike,
): ForkContextStore {
    return {
        async getCapsuleByTargetCircleId(targetCircleId) {
            const normalizedTargetCircleId = asPositiveInteger(targetCircleId);
            if (!normalizedTargetCircleId) return null;
            const rows = await prisma.$queryRaw<ForkContextCapsuleRow[]>(Prisma.sql`
                SELECT
                    capsule_id AS "capsuleId",
                    declaration_id AS "declarationId",
                    lineage_id AS "lineageId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    actor_user_id AS "actorUserId",
                    source_path_snapshot AS "sourcePathSnapshot",
                    origin_snapshot AS "originSnapshot",
                    gate_evaluation_policy AS "gateEvaluationPolicy",
                    capsule_digest AS "capsuleDigest",
                    status,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM fork_context_capsules
                WHERE target_circle_id = ${normalizedTargetCircleId}
                LIMIT 1
            `);
            return rows[0] ? mapCapsuleRow(rows[0]) : null;
        },
        async ensureCapsule(input) {
            const rows = await prisma.$queryRaw<ForkContextCapsuleRow[]>(Prisma.sql`
                INSERT INTO fork_context_capsules (
                    capsule_id,
                    declaration_id,
                    lineage_id,
                    source_circle_id,
                    target_circle_id,
                    actor_user_id,
                    source_path_snapshot,
                    origin_snapshot,
                    gate_evaluation_policy,
                    capsule_digest,
                    status,
                    created_at,
                    updated_at
                ) VALUES (
                    ${input.capsuleId},
                    ${input.declarationId},
                    ${input.lineageId},
                    ${input.sourceCircleId},
                    ${input.targetCircleId},
                    ${input.actorUserId},
                    ${toJsonbSql(input.sourcePathSnapshot)},
                    ${toJsonbSql(input.originSnapshot)},
                    ${toJsonbSql(input.gateEvaluationPolicy)},
                    ${input.capsuleDigest},
                    'active',
                    NOW(),
                    NOW()
                )
                ON CONFLICT (capsule_id) DO UPDATE
                SET
                    declaration_id = EXCLUDED.declaration_id,
                    lineage_id = EXCLUDED.lineage_id,
                    source_circle_id = EXCLUDED.source_circle_id,
                    target_circle_id = EXCLUDED.target_circle_id,
                    actor_user_id = EXCLUDED.actor_user_id,
                    source_path_snapshot = EXCLUDED.source_path_snapshot,
                    origin_snapshot = EXCLUDED.origin_snapshot,
                    gate_evaluation_policy = EXCLUDED.gate_evaluation_policy,
                    capsule_digest = EXCLUDED.capsule_digest,
                    status = 'active',
                    updated_at = NOW()
                RETURNING
                    capsule_id AS "capsuleId",
                    declaration_id AS "declarationId",
                    lineage_id AS "lineageId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    actor_user_id AS "actorUserId",
                    source_path_snapshot AS "sourcePathSnapshot",
                    origin_snapshot AS "originSnapshot",
                    gate_evaluation_policy AS "gateEvaluationPolicy",
                    capsule_digest AS "capsuleDigest",
                    status,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            return mapCapsuleRow(rows[0]);
        },
        async listReferencesByTargetCircleId(targetCircleId) {
            const normalizedTargetCircleId = asPositiveInteger(targetCircleId);
            if (!normalizedTargetCircleId) return [];
            const rows = await prisma.$queryRaw<ForkUpstreamReferenceRow[]>(Prisma.sql`
                SELECT
                    reference_id AS "referenceId",
                    capsule_id AS "capsuleId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    source_material_id AS "sourceMaterialId",
                    circle_summary_snapshot_id AS "circleSummarySnapshotId",
                    reference_type AS "referenceType",
                    visibility_state AS "visibilityState",
                    source_gate_snapshot AS "sourceGateSnapshot",
                    restriction_state AS "restrictionState",
                    release_id AS "releaseId",
                    source_digest AS "sourceDigest",
                    summary_digest AS "summaryDigest",
                    metadata,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM fork_upstream_references
                WHERE target_circle_id = ${normalizedTargetCircleId}
                ORDER BY created_at DESC
            `);
            return rows.map(mapReferenceRow);
        },
        async getReferenceById(referenceId) {
            const normalizedReferenceId = typeof referenceId === 'string' ? referenceId.trim() : '';
            if (!normalizedReferenceId) return null;
            const rows = await prisma.$queryRaw<ForkUpstreamReferenceRow[]>(Prisma.sql`
                SELECT
                    reference_id AS "referenceId",
                    capsule_id AS "capsuleId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    source_material_id AS "sourceMaterialId",
                    circle_summary_snapshot_id AS "circleSummarySnapshotId",
                    reference_type AS "referenceType",
                    visibility_state AS "visibilityState",
                    source_gate_snapshot AS "sourceGateSnapshot",
                    restriction_state AS "restrictionState",
                    release_id AS "releaseId",
                    source_digest AS "sourceDigest",
                    summary_digest AS "summaryDigest",
                    metadata,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM fork_upstream_references
                WHERE reference_id = ${normalizedReferenceId}
                LIMIT 1
            `);
            return rows[0] ? mapReferenceRow(rows[0]) : null;
        },
        async saveReference(input) {
            const rows = await prisma.$queryRaw<ForkUpstreamReferenceRow[]>(Prisma.sql`
                INSERT INTO fork_upstream_references (
                    reference_id,
                    capsule_id,
                    source_circle_id,
                    target_circle_id,
                    source_material_id,
                    circle_summary_snapshot_id,
                    reference_type,
                    visibility_state,
                    source_gate_snapshot,
                    restriction_state,
                    release_id,
                    source_digest,
                    summary_digest,
                    metadata,
                    created_at,
                    updated_at
                ) VALUES (
                    ${input.referenceId},
                    ${input.capsuleId},
                    ${input.sourceCircleId},
                    ${input.targetCircleId},
                    ${input.sourceMaterialId ?? null},
                    ${input.circleSummarySnapshotId ?? null},
                    ${input.referenceType},
                    ${input.visibilityState},
                    ${toJsonbSql(input.sourceGateSnapshot)},
                    ${input.restrictionState},
                    ${input.releaseId ?? null},
                    ${input.sourceDigest ?? null},
                    ${input.summaryDigest ?? null},
                    ${toJsonbSql(input.metadata)},
                    ${input.createdAt},
                    ${input.updatedAt}
                )
                ON CONFLICT (reference_id) DO UPDATE
                SET
                    capsule_id = EXCLUDED.capsule_id,
                    source_circle_id = EXCLUDED.source_circle_id,
                    target_circle_id = EXCLUDED.target_circle_id,
                    source_material_id = EXCLUDED.source_material_id,
                    circle_summary_snapshot_id = EXCLUDED.circle_summary_snapshot_id,
                    reference_type = EXCLUDED.reference_type,
                    visibility_state = EXCLUDED.visibility_state,
                    source_gate_snapshot = EXCLUDED.source_gate_snapshot,
                    restriction_state = EXCLUDED.restriction_state,
                    release_id = EXCLUDED.release_id,
                    source_digest = EXCLUDED.source_digest,
                    summary_digest = EXCLUDED.summary_digest,
                    metadata = EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    reference_id AS "referenceId",
                    capsule_id AS "capsuleId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    source_material_id AS "sourceMaterialId",
                    circle_summary_snapshot_id AS "circleSummarySnapshotId",
                    reference_type AS "referenceType",
                    visibility_state AS "visibilityState",
                    source_gate_snapshot AS "sourceGateSnapshot",
                    restriction_state AS "restrictionState",
                    release_id AS "releaseId",
                    source_digest AS "sourceDigest",
                    summary_digest AS "summaryDigest",
                    metadata,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            return mapReferenceRow(rows[0]);
        },
        async getActiveReleaseById(releaseId) {
            const normalizedReleaseId = typeof releaseId === 'string' ? releaseId.trim() : '';
            if (!normalizedReleaseId) return null;
            const rows = await prisma.$queryRaw<ForkContextReleaseRow[]>(Prisma.sql`
                SELECT
                    release_id AS "releaseId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    release_audience AS "releaseAudience",
                    approved_by_user_id AS "approvedByUserId",
                    approval_method AS "approvalMethod",
                    governance_request_id AS "governanceRequestId",
                    decision_digest AS "decisionDigest",
                    source_refs AS "sourceRefs",
                    summary_text AS "summaryText",
                    summary_digest AS "summaryDigest",
                    status,
                    expires_at AS "expiresAt",
                    revoked_at AS "revokedAt",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM fork_context_releases
                WHERE release_id = ${normalizedReleaseId}
                  AND status = 'active'
                  AND revoked_at IS NULL
                  AND (expires_at IS NULL OR expires_at > NOW())
                LIMIT 1
            `);
            return rows[0] ? mapReleaseRow(rows[0]) : null;
        },
    };
}
