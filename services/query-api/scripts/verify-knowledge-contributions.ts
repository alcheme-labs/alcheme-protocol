import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEFAULT_SAMPLE_LIMIT = 20;

type VerifyArgs = {
    sampleLimit: number;
    strict: boolean;
};

type CoverageRow = {
    eligibleKnowledge: number;
    snapshotCoveredKnowledge: number;
    snapshotRows: number;
};

type ConsistencyRow = {
    missingSnapshotKnowledge: number;
    rootOrCountMismatchKnowledge: number;
};

type ProvenanceRow = {
    snapshotKnowledge: number;
    completeProvenanceKnowledge: number;
    missingSourceDraftPostId: number;
    missingSourceAnchorId: number;
    missingSourceSummaryHash: number;
    missingSourceMessagesDigest: number;
};

type KnowledgeSample = {
    id: number;
    knowledgeId: string;
    onChainAddress: string;
};

function parseArgs(argv: string[]): VerifyArgs {
    const strict = argv.includes('--strict');
    const sampleLimitArg = argv.find((item) => item.startsWith('--sample-limit='));
    const parsed = sampleLimitArg ? Number.parseInt(sampleLimitArg.split('=')[1] || '', 10) : DEFAULT_SAMPLE_LIMIT;
    const sampleLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_LIMIT;
    return { sampleLimit, strict };
}

function safeRate(part: number, whole: number): number {
    if (whole <= 0) return 100;
    return Number(((part / whole) * 100).toFixed(2));
}

async function fetchCoverage(): Promise<CoverageRow> {
    const rows = await prisma.$queryRaw<CoverageRow[]>(Prisma.sql`
        SELECT
            COUNT(*)::INT AS "eligibleKnowledge",
            (
                SELECT COUNT(*)::INT
                FROM knowledge k2
                WHERE k2.source_content_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1
                      FROM knowledge_contributions kc2
                      WHERE kc2.knowledge_id = k2.id
                  )
            ) AS "snapshotCoveredKnowledge",
            (
                SELECT COUNT(*)::INT
                FROM knowledge_contributions kc3
            ) AS "snapshotRows"
        FROM knowledge k
        WHERE k.source_content_id IS NOT NULL
    `);
    return rows[0] || {
        eligibleKnowledge: 0,
        snapshotCoveredKnowledge: 0,
        snapshotRows: 0,
    };
}

async function fetchConsistency(): Promise<ConsistencyRow> {
    const rows = await prisma.$queryRaw<ConsistencyRow[]>(Prisma.sql`
        WITH per_knowledge AS (
            SELECT
                k.id,
                COUNT(kc.id)::INT AS "snapshotRows",
                LOWER(k.contributors_root) AS "indexedRoot",
                LOWER(MAX(kc.contributors_root)) AS "snapshotRoot",
                k.contributors_count::INT AS "indexedCount",
                MAX(kc.contributors_count)::INT AS "snapshotCount"
            FROM knowledge k
            LEFT JOIN knowledge_contributions kc ON kc.knowledge_id = k.id
            WHERE k.source_content_id IS NOT NULL
            GROUP BY k.id, k.contributors_root, k.contributors_count
        )
        SELECT
            COUNT(*) FILTER (WHERE "snapshotRows" = 0)::INT AS "missingSnapshotKnowledge",
            COUNT(*) FILTER (
                WHERE "snapshotRows" > 0 AND (
                    COALESCE("indexedRoot", '') <> COALESCE("snapshotRoot", '')
                    OR COALESCE("indexedCount", -1) <> COALESCE("snapshotCount", -1)
                )
            )::INT AS "rootOrCountMismatchKnowledge"
        FROM per_knowledge
    `);
    return rows[0] || {
        missingSnapshotKnowledge: 0,
        rootOrCountMismatchKnowledge: 0,
    };
}

async function fetchProvenance(): Promise<ProvenanceRow> {
    const rows = await prisma.$queryRaw<ProvenanceRow[]>(Prisma.sql`
        WITH per_knowledge AS (
            SELECT
                kc.knowledge_id,
                BOOL_OR(kc.source_draft_post_id IS NOT NULL) AS "hasSourceDraftPostId",
                BOOL_OR(kc.source_anchor_id IS NOT NULL) AS "hasSourceAnchorId",
                BOOL_OR(kc.source_summary_hash IS NOT NULL) AS "hasSourceSummaryHash",
                BOOL_OR(kc.source_messages_digest IS NOT NULL) AS "hasSourceMessagesDigest"
            FROM knowledge_contributions kc
            GROUP BY kc.knowledge_id
        )
        SELECT
            COUNT(*)::INT AS "snapshotKnowledge",
            COUNT(*) FILTER (
                WHERE "hasSourceDraftPostId"
                  AND "hasSourceAnchorId"
                  AND "hasSourceSummaryHash"
                  AND "hasSourceMessagesDigest"
            )::INT AS "completeProvenanceKnowledge",
            COUNT(*) FILTER (WHERE NOT "hasSourceDraftPostId")::INT AS "missingSourceDraftPostId",
            COUNT(*) FILTER (WHERE NOT "hasSourceAnchorId")::INT AS "missingSourceAnchorId",
            COUNT(*) FILTER (WHERE NOT "hasSourceSummaryHash")::INT AS "missingSourceSummaryHash",
            COUNT(*) FILTER (WHERE NOT "hasSourceMessagesDigest")::INT AS "missingSourceMessagesDigest"
        FROM per_knowledge
    `);
    return rows[0] || {
        snapshotKnowledge: 0,
        completeProvenanceKnowledge: 0,
        missingSourceDraftPostId: 0,
        missingSourceAnchorId: 0,
        missingSourceSummaryHash: 0,
        missingSourceMessagesDigest: 0,
    };
}

async function fetchMissingSnapshotSamples(sampleLimit: number): Promise<KnowledgeSample[]> {
    return prisma.$queryRaw<KnowledgeSample[]>(Prisma.sql`
        SELECT
            k.id,
            k.knowledge_id AS "knowledgeId",
            k.on_chain_address AS "onChainAddress"
        FROM knowledge k
        WHERE k.source_content_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM knowledge_contributions kc
              WHERE kc.knowledge_id = k.id
          )
        ORDER BY k.id DESC
        LIMIT ${sampleLimit}
    `);
}

async function fetchMismatchSamples(sampleLimit: number): Promise<KnowledgeSample[]> {
    return prisma.$queryRaw<KnowledgeSample[]>(Prisma.sql`
        WITH per_knowledge AS (
            SELECT
                k.id,
                k.knowledge_id AS "knowledgeId",
                k.on_chain_address AS "onChainAddress",
                COUNT(kc.id)::INT AS "snapshotRows",
                LOWER(k.contributors_root) AS "indexedRoot",
                LOWER(MAX(kc.contributors_root)) AS "snapshotRoot",
                k.contributors_count::INT AS "indexedCount",
                MAX(kc.contributors_count)::INT AS "snapshotCount"
            FROM knowledge k
            LEFT JOIN knowledge_contributions kc ON kc.knowledge_id = k.id
            WHERE k.source_content_id IS NOT NULL
            GROUP BY k.id, k.knowledge_id, k.on_chain_address, k.contributors_root, k.contributors_count
        )
        SELECT
            id,
            "knowledgeId",
            "onChainAddress"
        FROM per_knowledge
        WHERE "snapshotRows" > 0
          AND (
              COALESCE("indexedRoot", '') <> COALESCE("snapshotRoot", '')
              OR COALESCE("indexedCount", -1) <> COALESCE("snapshotCount", -1)
          )
        ORDER BY id DESC
        LIMIT ${sampleLimit}
    `);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const [coverage, consistency, provenance, missingSnapshotSamples, mismatchSamples] = await Promise.all([
        fetchCoverage(),
        fetchConsistency(),
        fetchProvenance(),
        fetchMissingSnapshotSamples(args.sampleLimit),
        fetchMismatchSamples(args.sampleLimit),
    ]);

    const fallbackKnowledge = Math.max(coverage.eligibleKnowledge - coverage.snapshotCoveredKnowledge, 0);
    const result = {
        checkedAt: new Date().toISOString(),
        strict: args.strict,
        sampleLimit: args.sampleLimit,
        coverage: {
            eligibleKnowledge: coverage.eligibleKnowledge,
            snapshotCoveredKnowledge: coverage.snapshotCoveredKnowledge,
            fallbackKnowledge,
            snapshotRows: coverage.snapshotRows,
            coverageRatePct: safeRate(coverage.snapshotCoveredKnowledge, coverage.eligibleKnowledge),
        },
        consistency: {
            missingSnapshotKnowledge: consistency.missingSnapshotKnowledge,
            rootOrCountMismatchKnowledge: consistency.rootOrCountMismatchKnowledge,
        },
        provenance: {
            snapshotKnowledge: provenance.snapshotKnowledge,
            completeProvenanceKnowledge: provenance.completeProvenanceKnowledge,
            missingSourceDraftPostId: provenance.missingSourceDraftPostId,
            missingSourceAnchorId: provenance.missingSourceAnchorId,
            missingSourceSummaryHash: provenance.missingSourceSummaryHash,
            missingSourceMessagesDigest: provenance.missingSourceMessagesDigest,
            completeRatePct: safeRate(
                provenance.completeProvenanceKnowledge,
                provenance.snapshotKnowledge,
            ),
        },
        samples: {
            missingSnapshotKnowledge: missingSnapshotSamples,
            rootOrCountMismatchKnowledge: mismatchSamples,
        },
    };

    console.log(JSON.stringify(result, null, 2));

    const hasBlockingIssue = consistency.missingSnapshotKnowledge > 0 || consistency.rootOrCountMismatchKnowledge > 0;
    if (args.strict && hasBlockingIssue) {
        console.error(
            `[verify-knowledge-contributions] strict failed: missingSnapshotKnowledge=${consistency.missingSnapshotKnowledge}, rootOrCountMismatchKnowledge=${consistency.rootOrCountMismatchKnowledge}`,
        );
        process.exitCode = 2;
    }
}

main()
    .catch((error) => {
        console.error('[verify-knowledge-contributions] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
