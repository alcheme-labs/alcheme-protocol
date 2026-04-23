import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const HUE_ANCHORS = [42, 200, 280, 150] as const;
const DEFAULT_CRYSTAL_FACETS = 6;
const DEFAULT_BATCH_SIZE = 100;

type KnowledgeRow = {
    id: number;
    knowledgeId: string;
    contributorsCount: number;
    circleName: string | null;
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

function deriveCrystalSeedHex(knowledgeId: string): string {
    if (knowledgeId.length >= 16) {
        return `0x${knowledgeId.slice(0, 16)}`;
    }
    return `0x${knowledgeId}`;
}

function deriveCrystalHue(circleName: string | null): number {
    const source = circleName || 'unknown';
    let hash = 0x811c9dc5;
    for (const byte of Buffer.from(source)) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return HUE_ANCHORS[hash % HUE_ANCHORS.length];
}

function normalizeCrystalFacets(contributorsCount: number): number {
    return contributorsCount > 0 ? contributorsCount : DEFAULT_CRYSTAL_FACETS;
}

function buildCrystalParams(row: KnowledgeRow) {
    return {
        seed: deriveCrystalSeedHex(row.knowledgeId),
        hue: deriveCrystalHue(row.circleName),
        facets: normalizeCrystalFacets(row.contributorsCount),
    };
}

async function fetchBatch(lastId: number, batchSize: number): Promise<KnowledgeRow[]> {
    return prisma.$queryRaw<KnowledgeRow[]>(Prisma.sql`
        SELECT
            k.id,
            k.knowledge_id AS "knowledgeId",
            k.contributors_count AS "contributorsCount",
            c.name AS "circleName"
        FROM knowledge k
        LEFT JOIN circles c ON c.id = k.circle_id
        WHERE k.crystal_params IS NULL
          AND k.id > ${lastId}
        ORDER BY k.id ASC
        LIMIT ${batchSize}
    `);
}

async function main() {
    const { dryRun, batchSize } = parseArgs(process.argv.slice(2));
    let lastId = 0;
    let scanned = 0;
    let updated = 0;
    let failed = 0;

    for (;;) {
        const rows = await fetchBatch(lastId, batchSize);
        if (rows.length === 0) break;

        scanned += rows.length;
        lastId = rows[rows.length - 1]?.id || lastId;

        if (dryRun) {
            continue;
        }

        const results = await Promise.allSettled(
            rows.map((row) =>
                prisma.knowledge.update({
                    where: { id: row.id },
                    data: {
                        crystalParams: buildCrystalParams(row) as Prisma.InputJsonValue,
                    },
                }),
            ),
        );

        for (const result of results) {
            if (result.status === 'fulfilled') {
                updated += 1;
            } else {
                failed += 1;
            }
        }
    }

    if (dryRun) {
        updated = scanned;
    }

    console.log(JSON.stringify({
        dryRun,
        batchSize,
        scanned,
        updated,
        skipped: scanned - updated - failed,
        failed,
    }));
}

main()
    .catch((error) => {
        console.error('[backfill-knowledge-crystal-params] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
