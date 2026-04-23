import type { Prisma, PrismaClient } from '@prisma/client';

import { upsertCrystalEntitlementsForKnowledge } from './upsert';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function reconcileCrystalEntitlements(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        limit?: number;
        now?: Date;
    } = {},
): Promise<{
        processedKnowledgeCount: number;
        totalEntitlements: number;
        knowledgeRowIds: number[];
    }> {
    const take = Math.max(1, Math.min(500, Number(input.limit || 100)));
    const rows = await prisma.knowledge.findMany({
        where: Number.isFinite(Number(input.knowledgeRowId)) && Number(input.knowledgeRowId) > 0
            ? {
                id: Number(input.knowledgeRowId),
                binding: { isNot: null },
                contributions: { some: {} },
            }
            : {
                binding: { isNot: null },
                contributions: { some: {} },
            },
        orderBy: { id: 'asc' },
        take,
        select: {
            id: true,
            knowledgeId: true,
        },
    });

    let totalEntitlements = 0;
    const knowledgeRowIds: number[] = [];

    for (const row of rows) {
        const synced = await upsertCrystalEntitlementsForKnowledge(prisma, {
            knowledgeRowId: row.id,
            now: input.now,
        });
        totalEntitlements += synced.entitlementCount;
        knowledgeRowIds.push(synced.knowledgeRowId);
    }

    return {
        processedKnowledgeCount: rows.length,
        totalEntitlements,
        knowledgeRowIds,
    };
}
