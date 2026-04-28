import { Prisma, type PrismaClient } from '@prisma/client';

export type CrystallizationAttemptStatus =
    | 'submitted'
    | 'binding_pending'
    | 'binding_synced'
    | 'references_synced'
    | 'references_failed'
    | 'finalization_failed'
    | 'finalized';

export interface DraftCrystallizationAttempt {
    id: number;
    draftPostId: number;
    proofPackageHash: string;
    knowledgeId: string | null;
    knowledgeOnChainAddress: string;
    status: CrystallizationAttemptStatus;
    failureCode: string | null;
    failureMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface DraftCrystallizationAttemptRow {
    id: bigint | number;
    draftPostId: number;
    proofPackageHash: string;
    knowledgeId: string | null;
    knowledgeOnChainAddress: string;
    status: string;
    failureCode: string | null;
    failureMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
}

const RESUMABLE_ATTEMPT_STATUSES: CrystallizationAttemptStatus[] = [
    'submitted',
    'binding_pending',
    'binding_synced',
    'references_synced',
    'references_failed',
    'finalization_failed',
];

function normalizeDraftPostId(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error('invalid_draft_post_id');
    }
    return value;
}

function normalizeProofPackageHash(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error('invalid_proof_package_hash');
    }
    return normalized;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
    const normalized = String(value || '').trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeKnowledgeOnChainAddress(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.length > 44) {
        throw new Error('invalid_knowledge_on_chain_address');
    }
    return normalized;
}

function normalizeFailureCode(value: string): string {
    const normalized = String(value || '').trim();
    if (!normalized) return 'crystallization_attempt_failed';
    return normalized.slice(0, 64);
}

function normalizeFailureMessage(value: string): string {
    const normalized = String(value || '').trim();
    return (normalized || 'Crystallization could not be finalized.').slice(0, 1000);
}

function normalizeStatus(value: string): CrystallizationAttemptStatus {
    if (
        value === 'submitted'
        || value === 'binding_pending'
        || value === 'binding_synced'
        || value === 'references_synced'
        || value === 'references_failed'
        || value === 'finalization_failed'
        || value === 'finalized'
    ) {
        return value;
    }
    return 'submitted';
}

function mapAttemptRow(row: DraftCrystallizationAttemptRow): DraftCrystallizationAttempt {
    return {
        id: Number(row.id),
        draftPostId: Number(row.draftPostId),
        proofPackageHash: String(row.proofPackageHash || '').toLowerCase(),
        knowledgeId: normalizeOptionalString(row.knowledgeId),
        knowledgeOnChainAddress: String(row.knowledgeOnChainAddress || ''),
        status: normalizeStatus(row.status),
        failureCode: normalizeOptionalString(row.failureCode),
        failureMessage: normalizeOptionalString(row.failureMessage),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function isAttemptRow(value: DraftCrystallizationAttemptRow | undefined): value is DraftCrystallizationAttemptRow {
    return Boolean(
        value
        && Number(value.draftPostId) > 0
        && typeof value.proofPackageHash === 'string'
        && value.proofPackageHash.length === 64
        && typeof value.knowledgeOnChainAddress === 'string'
        && value.knowledgeOnChainAddress.length > 0,
    );
}

function attemptSelectSql(): Prisma.Sql {
    return Prisma.sql`
        id,
        draft_post_id AS "draftPostId",
        proof_package_hash AS "proofPackageHash",
        knowledge_id AS "knowledgeId",
        knowledge_on_chain_address AS "knowledgeOnChainAddress",
        status,
        failure_code AS "failureCode",
        failure_message AS "failureMessage",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;
}

export async function upsertCrystallizationAttempt(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
        knowledgeId?: string | null;
        knowledgeOnChainAddress: string;
    },
): Promise<DraftCrystallizationAttempt> {
    const draftPostId = normalizeDraftPostId(input.draftPostId);
    const proofPackageHash = normalizeProofPackageHash(input.proofPackageHash);
    const knowledgeId = normalizeOptionalString(input.knowledgeId);
    const knowledgeOnChainAddress = normalizeKnowledgeOnChainAddress(input.knowledgeOnChainAddress);

    const rows = await prisma.$queryRaw<DraftCrystallizationAttemptRow[]>(Prisma.sql`
        INSERT INTO draft_crystallization_attempts (
            draft_post_id,
            proof_package_hash,
            knowledge_id,
            knowledge_on_chain_address,
            status
        ) VALUES (
            ${draftPostId},
            ${proofPackageHash},
            ${knowledgeId},
            ${knowledgeOnChainAddress},
            'binding_pending'
        )
        ON CONFLICT (draft_post_id, proof_package_hash) DO UPDATE SET
            knowledge_id = COALESCE(draft_crystallization_attempts.knowledge_id, EXCLUDED.knowledge_id),
            status = CASE
                WHEN draft_crystallization_attempts.status = 'submitted' THEN 'binding_pending'
                ELSE draft_crystallization_attempts.status
            END,
            updated_at = CURRENT_TIMESTAMP
        RETURNING ${attemptSelectSql()}
    `);
    if (!rows[0]) {
        throw new Error('crystallization_attempt_upsert_failed');
    }
    return mapAttemptRow(rows[0]);
}

export async function findResumableCrystallizationAttempt(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
    },
): Promise<DraftCrystallizationAttempt | null> {
    const draftPostId = normalizeDraftPostId(input.draftPostId);
    const proofPackageHash = normalizeProofPackageHash(input.proofPackageHash);
    const rows = await prisma.$queryRaw<DraftCrystallizationAttemptRow[]>(Prisma.sql`
        SELECT ${attemptSelectSql()}
        FROM draft_crystallization_attempts
        WHERE draft_post_id = ${draftPostId}
          AND proof_package_hash = ${proofPackageHash}
          AND status IN (${Prisma.join(RESUMABLE_ATTEMPT_STATUSES)})
        ORDER BY updated_at DESC
        LIMIT 1
    `);
    return isAttemptRow(rows[0]) ? mapAttemptRow(rows[0]) : null;
}

export async function findLatestResumableCrystallizationAttemptForDraft(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
    },
): Promise<DraftCrystallizationAttempt | null> {
    const draftPostId = normalizeDraftPostId(input.draftPostId);
    const rows = await prisma.$queryRaw<DraftCrystallizationAttemptRow[]>(Prisma.sql`
        SELECT ${attemptSelectSql()}
        FROM draft_crystallization_attempts
        WHERE draft_post_id = ${draftPostId}
          AND status IN (${Prisma.join(RESUMABLE_ATTEMPT_STATUSES)})
        ORDER BY updated_at DESC
        LIMIT 1
    `);
    return isAttemptRow(rows[0]) ? mapAttemptRow(rows[0]) : null;
}

async function updateAttemptStatus(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
        status: CrystallizationAttemptStatus;
        knowledgeId?: string | null;
        failureCode?: string | null;
        failureMessage?: string | null;
    },
): Promise<DraftCrystallizationAttempt> {
    const draftPostId = normalizeDraftPostId(input.draftPostId);
    const proofPackageHash = normalizeProofPackageHash(input.proofPackageHash);
    const knowledgeId = normalizeOptionalString(input.knowledgeId);
    const failureCode = input.failureCode ? normalizeFailureCode(input.failureCode) : null;
    const failureMessage = input.failureMessage ? normalizeFailureMessage(input.failureMessage) : null;
    const rows = await prisma.$queryRaw<DraftCrystallizationAttemptRow[]>(Prisma.sql`
        UPDATE draft_crystallization_attempts
        SET
            status = ${input.status},
            knowledge_id = COALESCE(${knowledgeId}, knowledge_id),
            failure_code = ${failureCode},
            failure_message = ${failureMessage},
            updated_at = CURRENT_TIMESTAMP
        WHERE draft_post_id = ${draftPostId}
          AND proof_package_hash = ${proofPackageHash}
        RETURNING ${attemptSelectSql()}
    `);
    if (!rows[0]) {
        throw new Error('crystallization_attempt_not_found');
    }
    return mapAttemptRow(rows[0]);
}

export async function markCrystallizationAttemptBindingSynced(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
        knowledgeId: string;
    },
): Promise<DraftCrystallizationAttempt> {
    return updateAttemptStatus(prisma, {
        ...input,
        status: 'binding_synced',
    });
}

export async function markCrystallizationAttemptReferencesFailed(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
        failureCode: string;
        failureMessage: string;
    },
): Promise<DraftCrystallizationAttempt> {
    return updateAttemptStatus(prisma, {
        ...input,
        status: 'references_failed',
    });
}

export async function markCrystallizationAttemptReferencesSynced(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
    },
): Promise<DraftCrystallizationAttempt> {
    return updateAttemptStatus(prisma, {
        ...input,
        status: 'references_synced',
    });
}

export async function markCrystallizationAttemptFinalizationFailed(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
        failureCode: string;
        failureMessage: string;
    },
): Promise<DraftCrystallizationAttempt> {
    return updateAttemptStatus(prisma, {
        ...input,
        status: 'finalization_failed',
    });
}

export async function markCrystallizationAttemptFinalized(
    prisma: Pick<PrismaClient, '$queryRaw'>,
    input: {
        draftPostId: number;
        proofPackageHash: string;
    },
): Promise<DraftCrystallizationAttempt> {
    return updateAttemptStatus(prisma, {
        ...input,
        status: 'finalized',
    });
}
