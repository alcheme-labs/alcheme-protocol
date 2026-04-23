import { Prisma, type PrismaClient } from '@prisma/client';

import { reconcileCrystalEntitlements } from './reconcile';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_CRYSTAL_ENTITLEMENT_BACKFILL_BATCH_SIZE = 100;

export type CrystalEntitlementBackfillArgs = {
    apply: boolean;
    batchSize: number;
    knowledgeRowId: number | null;
    requireZeroMissing: boolean;
};

export type CrystalEntitlementBackfillCandidateRow = {
    id: number;
    knowledgeId: string;
    contributorCount: number;
    activeEntitlementCount: number;
    contributorPubkeys: string[];
    activeEntitlementOwnerPubkeys: string[];
};

export type CrystalEntitlementBackfillSummary = {
    mode: 'apply' | 'dry_run';
    batchSize: number;
    knowledgeRowId: number | null;
    scanned: number;
    missingKnowledgeCount: number;
    missingKnowledgeCountBeforeRepair: number;
    repairedKnowledgeCount: number;
    repairedEntitlementCount: number;
    samples: Array<{
        knowledgeRowId: number;
        knowledgePublicId: string;
        contributorCount: number;
        activeEntitlementCount: number;
    }>;
};

export function parseCrystalEntitlementBackfillArgs(argv: string[]): CrystalEntitlementBackfillArgs {
    const apply = argv.includes('--apply');
    const requireZeroMissing = argv.includes('--require-zero-missing');
    const batchArg = argv.find((arg) => arg.startsWith('--batch-size='));
    const knowledgeRowIdArg = argv.find((arg) => arg.startsWith('--knowledge-row-id='));
    const parsedBatchSize = batchArg
        ? Number.parseInt(batchArg.split('=')[1] || '', 10)
        : DEFAULT_CRYSTAL_ENTITLEMENT_BACKFILL_BATCH_SIZE;
    const batchSize = Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
        ? parsedBatchSize
        : DEFAULT_CRYSTAL_ENTITLEMENT_BACKFILL_BATCH_SIZE;
    const parsedKnowledgeRowId = knowledgeRowIdArg
        ? Number.parseInt(knowledgeRowIdArg.split('=')[1] || '', 10)
        : Number.NaN;

    return {
        apply,
        batchSize,
        knowledgeRowId: Number.isFinite(parsedKnowledgeRowId) && parsedKnowledgeRowId > 0
            ? parsedKnowledgeRowId
            : null,
        requireZeroMissing,
    };
}

export async function assertCrystalEntitlementTablesReady(prisma: PrismaLike): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ crystalEntitlements: string | null; crystalReceipts: string | null }>>(Prisma.sql`
        SELECT
            to_regclass('public.crystal_entitlements')::text AS "crystalEntitlements",
            to_regclass('public.crystal_receipts')::text AS "crystalReceipts"
    `);
    const first = rows[0] || { crystalEntitlements: null, crystalReceipts: null };
    if (!first.crystalEntitlements) {
        throw new Error(
            'crystal entitlement tables are not migrated yet; apply the query-api Prisma migrations before running backfill:crystal-entitlements',
        );
    }
}

export async function fetchCrystalEntitlementBackfillBatch(
    prisma: PrismaLike,
    lastId: number,
    input: {
        batchSize: number;
        knowledgeRowId: number | null;
    },
): Promise<CrystalEntitlementBackfillCandidateRow[]> {
    const whereKnowledgeId = input.knowledgeRowId ? Prisma.sql`AND k.id = ${input.knowledgeRowId}` : Prisma.empty;
    return prisma.$queryRaw<CrystalEntitlementBackfillCandidateRow[]>(Prisma.sql`
        SELECT
            k.id,
            k.knowledge_id AS "knowledgeId",
            COUNT(DISTINCT kc.contributor_pubkey)::int AS "contributorCount",
            COUNT(DISTINCT CASE WHEN ce.status = 'active' THEN ce.owner_pubkey END)::int AS "activeEntitlementCount",
            COALESCE(
                ARRAY_AGG(DISTINCT kc.contributor_pubkey ORDER BY kc.contributor_pubkey),
                ARRAY[]::text[]
            ) AS "contributorPubkeys",
            COALESCE(
                ARRAY_AGG(DISTINCT ce.owner_pubkey ORDER BY ce.owner_pubkey) FILTER (WHERE ce.status = 'active'),
                ARRAY[]::text[]
            ) AS "activeEntitlementOwnerPubkeys"
        FROM knowledge k
        INNER JOIN knowledge_binding kb
            ON kb.knowledge_id = k.knowledge_id
        INNER JOIN knowledge_contributions kc
            ON kc.knowledge_id = k.id
        LEFT JOIN crystal_entitlements ce
            ON ce.knowledge_row_id = k.id
        WHERE k.id > ${lastId}
        ${whereKnowledgeId}
        GROUP BY k.id, k.knowledge_id
        HAVING COALESCE(
            ARRAY_AGG(DISTINCT kc.contributor_pubkey ORDER BY kc.contributor_pubkey),
            ARRAY[]::text[]
        ) IS DISTINCT FROM COALESCE(
            ARRAY_AGG(DISTINCT ce.owner_pubkey ORDER BY ce.owner_pubkey) FILTER (WHERE ce.status = 'active'),
            ARRAY[]::text[]
        )
        ORDER BY k.id ASC
        LIMIT ${input.batchSize}
    `);
}

export function hasCrystalEntitlementSetMismatch(input: {
    contributorPubkeys: string[];
    activeEntitlementOwnerPubkeys: string[];
}): boolean {
    const contributorPubkeys = Array.from(new Set(
        (Array.isArray(input.contributorPubkeys) ? input.contributorPubkeys : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
    )).sort();
    const activeEntitlementOwnerPubkeys = Array.from(new Set(
        (Array.isArray(input.activeEntitlementOwnerPubkeys) ? input.activeEntitlementOwnerPubkeys : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean),
    )).sort();

    if (contributorPubkeys.length !== activeEntitlementOwnerPubkeys.length) {
        return true;
    }

    return contributorPubkeys.some((value, index) => value !== activeEntitlementOwnerPubkeys[index]);
}

async function countRemainingMissingKnowledgeRows(
    prisma: PrismaLike,
    input: {
        batchSize: number;
        knowledgeRowId: number | null;
    },
): Promise<number> {
    let lastId = 0;
    let count = 0;

    for (;;) {
        const rows = await fetchCrystalEntitlementBackfillBatch(prisma, lastId, input);
        if (rows.length === 0) {
            return count;
        }

        count += rows.length;
        lastId = rows[rows.length - 1]?.id || lastId;
    }
}

export async function runCrystalEntitlementBackfill(
    prisma: PrismaLike,
    args: CrystalEntitlementBackfillArgs,
): Promise<CrystalEntitlementBackfillSummary> {
    let lastId = 0;
    let scanned = 0;
    let missingKnowledgeCountBeforeRepair = 0;
    let repairedKnowledgeCount = 0;
    let repairedEntitlementCount = 0;
    const samples: CrystalEntitlementBackfillSummary['samples'] = [];

    for (;;) {
        const rows = await fetchCrystalEntitlementBackfillBatch(prisma, lastId, {
            batchSize: args.batchSize,
            knowledgeRowId: args.knowledgeRowId,
        });
        if (rows.length === 0) break;

        const mismatchedRows = rows.filter((row) => hasCrystalEntitlementSetMismatch({
            contributorPubkeys: row.contributorPubkeys,
            activeEntitlementOwnerPubkeys: row.activeEntitlementOwnerPubkeys,
        }));
        if (mismatchedRows.length === 0) {
            lastId = rows[rows.length - 1]?.id || lastId;
            continue;
        }

        scanned += mismatchedRows.length;
        missingKnowledgeCountBeforeRepair += mismatchedRows.length;
        lastId = rows[rows.length - 1]?.id || lastId;

        for (const row of mismatchedRows) {
            if (samples.length < 20) {
                samples.push({
                    knowledgeRowId: row.id,
                    knowledgePublicId: row.knowledgeId,
                    contributorCount: row.contributorCount,
                    activeEntitlementCount: row.activeEntitlementCount,
                });
            }

            if (!args.apply) {
                continue;
            }

            const reconciled = await reconcileCrystalEntitlements(prisma, {
                knowledgeRowId: row.id,
                limit: 1,
            });
            repairedKnowledgeCount += reconciled.processedKnowledgeCount;
            repairedEntitlementCount += reconciled.totalEntitlements;
        }
    }

    const missingKnowledgeCount = args.apply
        ? await countRemainingMissingKnowledgeRows(prisma, {
            batchSize: args.batchSize,
            knowledgeRowId: args.knowledgeRowId,
        })
        : missingKnowledgeCountBeforeRepair;

    return {
        mode: args.apply ? 'apply' : 'dry_run',
        batchSize: args.batchSize,
        knowledgeRowId: args.knowledgeRowId,
        scanned,
        missingKnowledgeCount,
        missingKnowledgeCountBeforeRepair,
        repairedKnowledgeCount,
        repairedEntitlementCount,
        samples,
    };
}
