import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class CrystallizationBindingError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'CrystallizationBindingError';
    }
}

export async function bindKnowledgeToDraftSource(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        knowledgeOnChainAddress: string;
    },
) {
    const draft = await prisma.post.findUnique({
        where: { id: input.draftPostId },
        select: {
            id: true,
            circleId: true,
            contentId: true,
            heatScore: true,
        },
    });
    if (!draft) {
        throw new CrystallizationBindingError('draft_not_found', 404, 'draft not found');
    }
    if (!draft.circleId) {
        throw new CrystallizationBindingError('draft_circle_required', 409, 'draft must be circle-bound');
    }
    if (!draft.contentId) {
        throw new CrystallizationBindingError('draft_content_id_missing', 409, 'draft content id is missing');
    }

    const knowledge = await prisma.knowledge.findUnique({
        where: { onChainAddress: input.knowledgeOnChainAddress },
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            sourceContentId: true,
            heatScore: true,
        },
    });
    if (!knowledge) {
        throw new CrystallizationBindingError('knowledge_not_indexed', 409, 'knowledge is not indexed yet');
    }
    if (knowledge.circleId !== draft.circleId) {
        throw new CrystallizationBindingError('knowledge_circle_mismatch', 409, 'draft and knowledge circle mismatch');
    }
    if (knowledge.sourceContentId && knowledge.sourceContentId !== draft.contentId) {
        throw new CrystallizationBindingError('knowledge_source_conflict', 409, 'knowledge is already bound to another draft source');
    }

    if (knowledge.sourceContentId === draft.contentId) {
        return {
            knowledgeId: knowledge.knowledgeId,
            sourceContentId: draft.contentId,
            sourceDraftHeatScore: Number(draft.heatScore ?? 0),
            knowledgeHeatScore: Number(knowledge.heatScore ?? 0),
            created: false,
        };
    }

    const knowledgeHeatScore = Number(knowledge.heatScore ?? 0);
    const seededHeatScore = knowledgeHeatScore > 0
        ? knowledgeHeatScore
        : Number(draft.heatScore ?? 0);

    const updated = await prisma.knowledge.update({
        where: { id: knowledge.id },
        data: {
            sourceContentId: draft.contentId,
            heatScore: seededHeatScore,
        },
        select: {
            id: true,
            knowledgeId: true,
            sourceContentId: true,
            heatScore: true,
        },
    });

    return {
        knowledgeId: updated.knowledgeId,
        sourceContentId: updated.sourceContentId,
        sourceDraftHeatScore: Number(draft.heatScore ?? 0),
        knowledgeHeatScore: Number(updated.heatScore ?? 0),
        created: true,
    };
}
