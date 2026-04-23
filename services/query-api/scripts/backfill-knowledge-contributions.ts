import { PrismaClient, Prisma } from '@prisma/client';

import { mapContributionSyncError, syncKnowledgeContributionsFromDraftProof } from '../src/services/knowledgeContributions';

const prisma = new PrismaClient();
const DEFAULT_BATCH_SIZE = 100;

type CandidateRow = {
    id: number;
    knowledgeId: string;
    onChainAddress: string;
    draftPostId: number;
};

function parseArgs(argv: string[]) {
    const dryRun = argv.includes('--dry-run');
    const batchArg = argv.find((arg) => arg.startsWith('--batch-size='));
    const parsedBatchSize = batchArg ? Number.parseInt(batchArg.split('=')[1] || '', 10) : DEFAULT_BATCH_SIZE;
    const batchSize = Number.isFinite(parsedBatchSize) && parsedBatchSize > 0
        ? parsedBatchSize
        : DEFAULT_BATCH_SIZE;
    return { dryRun, batchSize };
}

async function fetchBatch(lastId: number, batchSize: number): Promise<CandidateRow[]> {
    return prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
        SELECT
            k.id,
            k.knowledge_id AS "knowledgeId",
            k.on_chain_address AS "onChainAddress",
            p.id AS "draftPostId"
        FROM knowledge k
        INNER JOIN posts p ON p.content_id = k.source_content_id
        WHERE k.source_content_id IS NOT NULL
          AND k.id > ${lastId}
          AND NOT EXISTS (
              SELECT 1 FROM knowledge_contributions kc
              WHERE kc.knowledge_id = k.id
          )
        ORDER BY k.id ASC
        LIMIT ${batchSize}
    `);
}

async function main() {
    const { dryRun, batchSize } = parseArgs(process.argv.slice(2));
    let lastId = 0;
    let scanned = 0;
    let synced = 0;
    let failed = 0;
    const errorBuckets = new Map<string, number>();

    for (;;) {
        const rows = await fetchBatch(lastId, batchSize);
        if (rows.length === 0) break;

        scanned += rows.length;
        lastId = rows[rows.length - 1]?.id || lastId;

        if (dryRun) {
            continue;
        }

        for (const row of rows) {
            try {
                await syncKnowledgeContributionsFromDraftProof(prisma, {
                    draftPostId: row.draftPostId,
                    knowledgeOnChainAddress: row.onChainAddress,
                });
                synced += 1;
            } catch (error) {
                failed += 1;
                const mapped = mapContributionSyncError(error);
                errorBuckets.set(
                    mapped.code,
                    (errorBuckets.get(mapped.code) || 0) + 1,
                );
            }
        }
    }

    console.log(JSON.stringify({
        dryRun,
        batchSize,
        scanned,
        synced: dryRun ? scanned : synced,
        failed: dryRun ? 0 : failed,
        errorBuckets: Object.fromEntries([...errorBuckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    }));
}

main()
    .catch((error) => {
        console.error('[backfill-knowledge-contributions] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
