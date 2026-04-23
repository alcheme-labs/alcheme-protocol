import { PrismaClient } from '@prisma/client';

import {
    assertCrystalEntitlementTablesReady,
    parseCrystalEntitlementBackfillArgs,
    runCrystalEntitlementBackfill,
} from '../src/services/crystalEntitlements/backfill';

const prisma = new PrismaClient();

async function main() {
    const args = parseCrystalEntitlementBackfillArgs(process.argv.slice(2));
    await assertCrystalEntitlementTablesReady(prisma);
    const summary = await runCrystalEntitlementBackfill(prisma, args);

    console.log(JSON.stringify(summary, null, 2));

    if (args.requireZeroMissing && summary.missingKnowledgeCount > 0) {
        throw new Error(`crystal entitlement backfill incomplete: ${summary.missingKnowledgeCount} knowledge rows still missing active entitlements`);
    }
}

main()
    .catch((error) => {
        console.error('[backfill-crystal-entitlements] failed', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
