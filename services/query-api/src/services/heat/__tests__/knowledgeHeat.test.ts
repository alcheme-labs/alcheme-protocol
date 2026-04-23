import { describe, expect, jest, test } from '@jest/globals';

import { KNOWLEDGE_HEAT_EVENTS, bumpKnowledgeHeat } from '../knowledgeHeat';

describe('knowledge heat service', () => {
    test('bumpKnowledgeHeat increments knowledge heat score with positive delta', async () => {
        const update = jest.fn<() => Promise<any>>().mockResolvedValue({ id: 9, heatScore: 14 });
        const prisma = { knowledge: { update } } as any;

        await bumpKnowledgeHeat(prisma, { knowledgeId: 'knowledge-9', delta: KNOWLEDGE_HEAT_EVENTS.discussion });

        expect(update).toHaveBeenCalledWith({
            where: { knowledgeId: 'knowledge-9' },
            data: { heatScore: { increment: 3 } },
            select: { id: true, heatScore: true },
        });
    });

    test('bumpKnowledgeHeat ignores zero or negative delta', async () => {
        const update = jest.fn();
        const prisma = { knowledge: { update } } as any;

        await bumpKnowledgeHeat(prisma, { knowledgeId: 'knowledge-9', delta: 0 });
        await bumpKnowledgeHeat(prisma, { knowledgeId: 'knowledge-9', delta: -2 });

        expect(update).not.toHaveBeenCalled();
    });
});
