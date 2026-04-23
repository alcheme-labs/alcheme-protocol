import { MemberStatus, Prisma, type PrismaClient } from '@prisma/client';
import { resolveCirclePolicyProfile } from '../policy/profile';
import type { GovernanceRole } from '../policy/types';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

type ActorIdentityLevel = 'Visitor' | 'Initiate' | 'Member' | 'Elder' | null;

export type ForkDeclarationStatus =
    | 'attached'
    | 'completed'
    | 'reconciliation_pending';

export type ForkQualificationStatus =
    | 'qualified'
    | 'fork_disabled'
    | 'contribution_shortfall'
    | 'identity_shortfall';

interface ForkDeclarationRow {
    declarationId: string | number;
    sourceCircleId: number;
    targetCircleId: number | null;
    actorUserId: number;
    declarationText: string;
    originAnchorRef: string | null;
    qualificationSnapshot: unknown;
    status: string;
    executionAnchorDigest: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface CircleForkLineageRow {
    lineageId: string | number;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string | number;
    createdBy: number;
    originAnchorRef: string | null;
    inheritanceSnapshot: unknown;
    executionAnchorDigest: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ForkQualificationSnapshot {
    thresholdMode: 'contribution_threshold';
    minimumContributions: number;
    contributorCount: number;
    minimumRole: GovernanceRole;
    actorRole: GovernanceRole | null;
    actorIdentityLevel: ActorIdentityLevel;
    requiresGovernanceVote: boolean;
    qualifies: boolean;
    qualificationStatus: ForkQualificationStatus;
}

export interface ForkDeclarationRecord {
    declarationId: string;
    sourceCircleId: number;
    targetCircleId: number | null;
    actorUserId: number;
    declarationText: string;
    originAnchorRef: string | null;
    qualificationSnapshot: ForkQualificationSnapshot;
    status: ForkDeclarationStatus;
    executionAnchorDigest: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface CircleForkLineageRecord {
    lineageId: string;
    sourceCircleId: number;
    targetCircleId: number;
    declarationId: string;
    createdBy: number;
    originAnchorRef: string | null;
    inheritanceSnapshot: Record<string, unknown>;
    executionAnchorDigest: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface ForkRuntimeStore {
    getDeclaration(declarationId: string): Promise<ForkDeclarationRecord | null>;
    saveDeclaration(declaration: ForkDeclarationRecord): Promise<ForkDeclarationRecord>;
    getLineageByDeclarationId(declarationId: string): Promise<CircleForkLineageRecord | null>;
    saveLineage(lineage: CircleForkLineageRecord): Promise<CircleForkLineageRecord>;
    listCircleLineages(circleId: number): Promise<CircleForkLineageRecord[]>;
    listReconciliationPendingDeclarations(): Promise<ForkDeclarationRecord[]>;
}

export interface ResolveForkQualificationInput {
    sourceCircleId: number;
    userId: number;
}

export interface EvaluateForkQualificationInput {
    minimumContributions: number;
    contributorCount: number;
    minimumRole: GovernanceRole;
    actorRole: GovernanceRole | null;
    actorIdentityLevel: ActorIdentityLevel;
    requiresGovernanceVote: boolean;
}

export interface CreateForkCircleInput {
    declarationId: string;
    sourceCircleId: number;
    actorUserId: number;
    declarationText: string;
    originAnchorRef?: string | null;
    qualificationSnapshot: ForkQualificationSnapshot;
    inheritanceSnapshot?: Record<string, unknown>;
    targetCircleId?: number | null;
    executionAnchorDigest?: string | null;
    forkDeclarationDigest?: string | null;
    executeChildCircleCreate?: () => Promise<{
        targetCircleId: number;
        executionAnchorDigest?: string | null;
    }>;
    createdAt?: Date;
}

export interface ForkCreationResult {
    declaration: ForkDeclarationRecord;
    lineage: CircleForkLineageRecord | null;
    reconciliationPending: boolean;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return null;
        }
    }
    return null;
}

export function normalizeForkDeclarationDigest(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(/^0x/i, '').toLowerCase();
    return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function toJsonbSql(value: unknown): Prisma.Sql {
    if (value === null || value === undefined) {
        return Prisma.sql`NULL`;
    }
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function normalizeForkDeclarationStatus(raw: unknown): ForkDeclarationStatus {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'completed') return 'completed';
    if (normalized === 'reconciliation_pending') return 'reconciliation_pending';
    return 'attached';
}

function normalizeGovernanceRole(raw: unknown): GovernanceRole | null {
    const value = String(raw || '').trim();
    if (
        value === 'Owner'
        || value === 'Admin'
        || value === 'Moderator'
        || value === 'Elder'
        || value === 'Member'
        || value === 'Initiate'
    ) {
        return value;
    }
    return null;
}

function normalizeActorIdentityLevel(raw: unknown): ActorIdentityLevel {
    const value = String(raw || '').trim();
    if (value === 'Visitor') return 'Visitor';
    if (value === 'Initiate') return 'Initiate';
    if (value === 'Member') return 'Member';
    if (value === 'Elder') return 'Elder';
    return null;
}

function roleRank(role: GovernanceRole | null): number {
    if (role === 'Owner') return 6;
    if (role === 'Admin') return 5;
    if (role === 'Moderator') return 4;
    if (role === 'Elder') return 3;
    if (role === 'Member') return 2;
    if (role === 'Initiate') return 1;
    return 0;
}

function identityRank(level: ActorIdentityLevel): number {
    if (level === 'Elder') return 3;
    if (level === 'Member') return 2;
    if (level === 'Initiate') return 1;
    return 0;
}

function requiresManagerRoleFloor(role: GovernanceRole): boolean {
    return role === 'Owner' || role === 'Admin' || role === 'Moderator';
}

function isIdentityFloorSatisfied(input: {
    minimumRole: GovernanceRole;
    actorRole: GovernanceRole | null;
    actorIdentityLevel: ActorIdentityLevel;
}): boolean {
    if (requiresManagerRoleFloor(input.minimumRole)) {
        return roleRank(input.actorRole) >= roleRank(input.minimumRole);
    }
    return identityRank(input.actorIdentityLevel) >= roleRank(input.minimumRole);
}

function mapQualificationSnapshot(raw: unknown): ForkQualificationSnapshot {
    const record = asRecord(raw);
    return {
        thresholdMode: 'contribution_threshold',
        minimumContributions: Math.max(0, Number(record?.minimumContributions || 0)),
        contributorCount: Math.max(0, Number(record?.contributorCount || 0)),
        minimumRole: normalizeGovernanceRole(record?.minimumRole) ?? 'Member',
        actorRole: normalizeGovernanceRole(record?.actorRole),
        actorIdentityLevel: normalizeActorIdentityLevel(record?.actorIdentityLevel),
        requiresGovernanceVote: Boolean(record?.requiresGovernanceVote),
        qualifies: Boolean(record?.qualifies),
        qualificationStatus: String(record?.qualificationStatus || 'contribution_shortfall') === 'qualified'
            ? 'qualified'
            : String(record?.qualificationStatus || '') === 'fork_disabled'
                ? 'fork_disabled'
                : String(record?.qualificationStatus || '') === 'identity_shortfall'
                    ? 'identity_shortfall'
                    : 'contribution_shortfall',
    };
}

function mapDeclarationRow(row: ForkDeclarationRow): ForkDeclarationRecord {
    return {
        declarationId: String(row.declarationId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId ?? null,
        actorUserId: row.actorUserId,
        declarationText: row.declarationText,
        originAnchorRef: row.originAnchorRef ?? null,
        qualificationSnapshot: mapQualificationSnapshot(row.qualificationSnapshot),
        status: normalizeForkDeclarationStatus(row.status),
        executionAnchorDigest: row.executionAnchorDigest ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function mapLineageRow(row: CircleForkLineageRow): CircleForkLineageRecord {
    return {
        lineageId: String(row.lineageId),
        sourceCircleId: row.sourceCircleId,
        targetCircleId: row.targetCircleId,
        declarationId: String(row.declarationId),
        createdBy: row.createdBy,
        originAnchorRef: row.originAnchorRef ?? null,
        inheritanceSnapshot: asRecord(row.inheritanceSnapshot) ?? {},
        executionAnchorDigest: row.executionAnchorDigest ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

export function evaluateForkQualification(
    input: EvaluateForkQualificationInput,
): ForkQualificationSnapshot {
    const minimumContributions = Math.max(0, Math.floor(input.minimumContributions));
    const contributorCount = Math.max(0, Math.floor(input.contributorCount));
    const minimumRole = normalizeGovernanceRole(input.minimumRole) ?? 'Member';
    const actorRole = normalizeGovernanceRole(input.actorRole);
    const actorIdentityLevel = normalizeActorIdentityLevel(input.actorIdentityLevel);
    const contributionSatisfied = contributorCount >= minimumContributions;
    const identitySatisfied = isIdentityFloorSatisfied({
        minimumRole,
        actorRole,
        actorIdentityLevel,
    });

    return {
        thresholdMode: 'contribution_threshold',
        minimumContributions,
        contributorCount,
        minimumRole,
        actorRole,
        actorIdentityLevel,
        requiresGovernanceVote: Boolean(input.requiresGovernanceVote),
        qualifies: contributionSatisfied && identitySatisfied,
        qualificationStatus: !contributionSatisfied
            ? 'contribution_shortfall'
            : !identitySatisfied
                ? 'identity_shortfall'
                : 'qualified',
    };
}

export async function resolveForkQualification(
    prisma: PrismaLike,
    input: ResolveForkQualificationInput,
): Promise<ForkQualificationSnapshot> {
    const sourceCircleId = asPositiveInteger(input.sourceCircleId);
    const userId = asPositiveInteger(input.userId);
    if (!sourceCircleId || !userId) {
        throw new Error('invalid_fork_qualification_input');
    }

    const profile = await resolveCirclePolicyProfile(prisma as PrismaClient, sourceCircleId);
    const [user, membership] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: { pubkey: true },
        }),
        prisma.circleMember.findUnique({
            where: {
                circleId_userId: {
                    circleId: sourceCircleId,
                    userId,
                },
            },
            select: {
                role: true,
                status: true,
                identityLevel: true,
            },
        }),
    ]);

    const contributionRows = user?.pubkey
        ? await prisma.$queryRaw<Array<{ contributorCount: number }>>(Prisma.sql`
            SELECT COUNT(*)::INT AS "contributorCount"
            FROM knowledge_contributions kc
            INNER JOIN knowledge k
                ON k.id = kc.knowledge_id
            WHERE k.circle_id = ${sourceCircleId}
              AND kc.contributor_pubkey = ${user.pubkey}
        `)
        : [];

    const contributorCount = Number(contributionRows[0]?.contributorCount ?? 0);
    const actorRole = membership?.status === MemberStatus.Active
        ? normalizeGovernanceRole(membership.role)
        : null;
    const actorIdentityLevel = membership?.status === MemberStatus.Active
        ? normalizeActorIdentityLevel(membership.identityLevel)
        : null;

    if (!profile.forkPolicy.enabled) {
        return {
            thresholdMode: 'contribution_threshold',
            minimumContributions: profile.forkPolicy.minimumContributions,
            contributorCount,
            minimumRole: profile.forkPolicy.minimumRole,
            actorRole,
            actorIdentityLevel,
            requiresGovernanceVote: profile.forkPolicy.requiresGovernanceVote,
            qualifies: false,
            qualificationStatus: 'fork_disabled',
        };
    }

    return evaluateForkQualification({
        minimumContributions: profile.forkPolicy.minimumContributions,
        contributorCount,
        minimumRole: profile.forkPolicy.minimumRole,
        actorRole,
        actorIdentityLevel,
        requiresGovernanceVote: profile.forkPolicy.requiresGovernanceVote,
    });
}

export function createPrismaForkRuntimeStore(
    prisma: PrismaLike,
): ForkRuntimeStore {
    return {
        async getDeclaration(declarationId) {
            const rows = await prisma.$queryRaw<ForkDeclarationRow[]>(Prisma.sql`
                SELECT
                    declaration_id AS "declarationId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    actor_user_id AS "actorUserId",
                    declaration_text AS "declarationText",
                    origin_anchor_ref AS "originAnchorRef",
                    qualification_snapshot AS "qualificationSnapshot",
                    status,
                    execution_anchor_digest AS "executionAnchorDigest",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM fork_declarations
                WHERE declaration_id = ${declarationId}
                LIMIT 1
            `);
            return rows[0] ? mapDeclarationRow(rows[0]) : null;
        },
        async saveDeclaration(declaration) {
            const rows = await prisma.$queryRaw<ForkDeclarationRow[]>(Prisma.sql`
                INSERT INTO fork_declarations (
                    declaration_id,
                    source_circle_id,
                    target_circle_id,
                    actor_user_id,
                    declaration_text,
                    origin_anchor_ref,
                    qualification_snapshot,
                    status,
                    execution_anchor_digest,
                    created_at,
                    updated_at
                ) VALUES (
                    ${declaration.declarationId},
                    ${declaration.sourceCircleId},
                    ${declaration.targetCircleId ?? null},
                    ${declaration.actorUserId},
                    ${declaration.declarationText},
                    ${declaration.originAnchorRef ?? null},
                    ${toJsonbSql(declaration.qualificationSnapshot)},
                    ${declaration.status},
                    ${declaration.executionAnchorDigest ?? null},
                    ${declaration.createdAt},
                    ${declaration.updatedAt}
                )
                ON CONFLICT (declaration_id) DO UPDATE
                SET
                    source_circle_id = EXCLUDED.source_circle_id,
                    target_circle_id = EXCLUDED.target_circle_id,
                    actor_user_id = EXCLUDED.actor_user_id,
                    declaration_text = EXCLUDED.declaration_text,
                    origin_anchor_ref = EXCLUDED.origin_anchor_ref,
                    qualification_snapshot = EXCLUDED.qualification_snapshot,
                    status = EXCLUDED.status,
                    execution_anchor_digest = EXCLUDED.execution_anchor_digest,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    declaration_id AS "declarationId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    actor_user_id AS "actorUserId",
                    declaration_text AS "declarationText",
                    origin_anchor_ref AS "originAnchorRef",
                    qualification_snapshot AS "qualificationSnapshot",
                    status,
                    execution_anchor_digest AS "executionAnchorDigest",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            return mapDeclarationRow(rows[0]);
        },
        async getLineageByDeclarationId(declarationId) {
            const rows = await prisma.$queryRaw<CircleForkLineageRow[]>(Prisma.sql`
                SELECT
                    lineage_id AS "lineageId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    declaration_id AS "declarationId",
                    created_by AS "createdBy",
                    origin_anchor_ref AS "originAnchorRef",
                    inheritance_snapshot AS "inheritanceSnapshot",
                    execution_anchor_digest AS "executionAnchorDigest",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM circle_fork_lineage
                WHERE declaration_id = ${declarationId}
                LIMIT 1
            `);
            return rows[0] ? mapLineageRow(rows[0]) : null;
        },
        async saveLineage(lineage) {
            const rows = await prisma.$queryRaw<CircleForkLineageRow[]>(Prisma.sql`
                INSERT INTO circle_fork_lineage (
                    lineage_id,
                    source_circle_id,
                    target_circle_id,
                    declaration_id,
                    created_by,
                    origin_anchor_ref,
                    inheritance_snapshot,
                    execution_anchor_digest,
                    created_at,
                    updated_at
                ) VALUES (
                    ${lineage.lineageId},
                    ${lineage.sourceCircleId},
                    ${lineage.targetCircleId},
                    ${lineage.declarationId},
                    ${lineage.createdBy},
                    ${lineage.originAnchorRef ?? null},
                    ${toJsonbSql(lineage.inheritanceSnapshot)},
                    ${lineage.executionAnchorDigest ?? null},
                    ${lineage.createdAt},
                    ${lineage.updatedAt}
                )
                ON CONFLICT (declaration_id) DO UPDATE
                SET
                    source_circle_id = EXCLUDED.source_circle_id,
                    target_circle_id = EXCLUDED.target_circle_id,
                    created_by = EXCLUDED.created_by,
                    origin_anchor_ref = EXCLUDED.origin_anchor_ref,
                    inheritance_snapshot = EXCLUDED.inheritance_snapshot,
                    execution_anchor_digest = EXCLUDED.execution_anchor_digest,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    lineage_id AS "lineageId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    declaration_id AS "declarationId",
                    created_by AS "createdBy",
                    origin_anchor_ref AS "originAnchorRef",
                    inheritance_snapshot AS "inheritanceSnapshot",
                    execution_anchor_digest AS "executionAnchorDigest",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `);
            return mapLineageRow(rows[0]);
        },
        async listCircleLineages(circleId) {
            const rows = await prisma.$queryRaw<CircleForkLineageRow[]>(Prisma.sql`
                SELECT
                    lineage_id AS "lineageId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    declaration_id AS "declarationId",
                    created_by AS "createdBy",
                    origin_anchor_ref AS "originAnchorRef",
                    inheritance_snapshot AS "inheritanceSnapshot",
                    execution_anchor_digest AS "executionAnchorDigest",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM circle_fork_lineage
                WHERE source_circle_id = ${circleId}
                   OR target_circle_id = ${circleId}
                ORDER BY created_at DESC
            `);
            return rows.map(mapLineageRow);
        },
        async listReconciliationPendingDeclarations() {
            const rows = await prisma.$queryRaw<ForkDeclarationRow[]>(Prisma.sql`
                SELECT
                    declaration_id AS "declarationId",
                    source_circle_id AS "sourceCircleId",
                    target_circle_id AS "targetCircleId",
                    actor_user_id AS "actorUserId",
                    declaration_text AS "declarationText",
                    origin_anchor_ref AS "originAnchorRef",
                    qualification_snapshot AS "qualificationSnapshot",
                    status,
                    execution_anchor_digest AS "executionAnchorDigest",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM fork_declarations
                WHERE status = 'reconciliation_pending'
                ORDER BY created_at ASC
            `);
            return rows.map(mapDeclarationRow);
        },
    };
}

function normalizeLineageId(declarationId: string): string {
    return `fork-lineage:${declarationId}`;
}

export async function createForkCircle(
    store: ForkRuntimeStore,
    input: CreateForkCircleInput,
): Promise<ForkCreationResult> {
    const declarationId = asNonEmptyString(input.declarationId);
    const sourceCircleId = asPositiveInteger(input.sourceCircleId);
    const actorUserId = asPositiveInteger(input.actorUserId);
    const declarationText = asNonEmptyString(input.declarationText);

    if (!declarationId) throw new Error('invalid_fork_declaration_id');
    if (!sourceCircleId) throw new Error('invalid_source_circle_id');
    if (!actorUserId) throw new Error('invalid_fork_actor_user_id');
    if (!declarationText) throw new Error('fork_declaration_text_required');
    if (!input.qualificationSnapshot?.qualifies) {
        throw new Error('fork_qualification_not_met');
    }

    const existingDeclaration = await store.getDeclaration(declarationId);
    const existingLineage = existingDeclaration
        ? await store.getLineageByDeclarationId(declarationId)
        : null;
    if (existingDeclaration && (existingLineage || existingDeclaration.status === 'completed')) {
        return {
            declaration: existingDeclaration,
            lineage: existingLineage,
            reconciliationPending: existingDeclaration.status === 'reconciliation_pending',
        };
    }

    const createdAt = input.createdAt ?? new Date();
    const attachedDeclaration = existingDeclaration ?? await store.saveDeclaration({
        declarationId,
        sourceCircleId,
        targetCircleId: null,
        actorUserId,
        declarationText,
        originAnchorRef: asNonEmptyString(input.originAnchorRef) ?? null,
        qualificationSnapshot: input.qualificationSnapshot,
        status: 'attached',
        executionAnchorDigest: null,
        createdAt,
        updatedAt: createdAt,
    });

    const wantsExecution = Boolean(
        input.executeChildCircleCreate
        || asPositiveInteger(input.targetCircleId),
    );
    if (!wantsExecution) {
        return {
            declaration: attachedDeclaration,
            lineage: existingLineage,
            reconciliationPending: attachedDeclaration.status === 'reconciliation_pending',
        };
    }

    const inheritanceSnapshot = asRecord(input.inheritanceSnapshot);
    if (!inheritanceSnapshot) {
        throw new Error('fork_inheritance_snapshot_required');
    }

    const executionResult = input.executeChildCircleCreate
        ? await input.executeChildCircleCreate()
        : {
            targetCircleId: asPositiveInteger(input.targetCircleId),
            executionAnchorDigest: asNonEmptyString(input.executionAnchorDigest) ?? null,
        };

    const targetCircleId = asPositiveInteger(executionResult.targetCircleId);
    if (!targetCircleId) {
        throw new Error('fork_target_circle_required');
    }

    const completedAt = input.createdAt ?? new Date();
    const resolvedExecutionAnchorDigest = normalizeForkDeclarationDigest(input.forkDeclarationDigest)
        ?? normalizeForkDeclarationDigest(input.executionAnchorDigest)
        ?? asNonEmptyString(input.executionAnchorDigest)
        ?? null;
    const declarationWithTarget = await store.saveDeclaration({
        ...attachedDeclaration,
        targetCircleId,
        executionAnchorDigest: normalizeForkDeclarationDigest(executionResult.executionAnchorDigest)
            ?? asNonEmptyString(executionResult.executionAnchorDigest)
            ?? resolvedExecutionAnchorDigest,
        updatedAt: completedAt,
    });

    try {
        const lineage = await store.saveLineage({
            lineageId: normalizeLineageId(declarationId),
            sourceCircleId,
            targetCircleId,
            declarationId,
            createdBy: actorUserId,
            originAnchorRef: declarationWithTarget.originAnchorRef,
            inheritanceSnapshot,
            executionAnchorDigest: declarationWithTarget.executionAnchorDigest,
            createdAt,
            updatedAt: completedAt,
        });
        const completedDeclaration = await store.saveDeclaration({
            ...declarationWithTarget,
            status: 'completed',
            updatedAt: completedAt,
        });
        return {
            declaration: completedDeclaration,
            lineage,
            reconciliationPending: false,
        };
    } catch {
        const reconciliationPending = await store.saveDeclaration({
            ...declarationWithTarget,
            status: 'reconciliation_pending',
            updatedAt: completedAt,
        });
        return {
            declaration: reconciliationPending,
            lineage: null,
            reconciliationPending: true,
        };
    }
}
