import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const KNOWLEDGE_HEAT_EVENTS = {
    citation: 10,
    discussion: 3,
} as const;

export async function bumpKnowledgeHeat(
    prisma: PrismaLike,
    input: { knowledgeId: string; delta: number },
) {
    if (!Number.isFinite(input.delta) || input.delta <= 0) {
        return null;
    }

    return prisma.knowledge.update({
        where: { knowledgeId: input.knowledgeId },
        data: {
            heatScore: { increment: input.delta },
        },
        select: {
            id: true,
            heatScore: true,
        },
    });
}
