import { describe, expect, jest, test } from '@jest/globals';
import { bindKnowledgeToDraftSource } from '../crystallizationBinding';

describe('crystallization binding', () => {
    test('binds indexed knowledge to the draft source content id', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 42,
                    circleId: 7,
                    contentId: 'draft-content-42',
                    heatScore: 17.5,
                }),
            },
            knowledge: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    circleId: 7,
                    onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                    sourceContentId: null,
                    heatScore: 0,
                }),
                update: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    sourceContentId: 'draft-content-42',
                    heatScore: 17.5,
                }),
            },
        } as any;

        const result = await bindKnowledgeToDraftSource(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
        });

        expect(prisma.knowledge.update).toHaveBeenCalledWith({
            where: { id: 9 },
            data: {
                sourceContentId: 'draft-content-42',
                heatScore: 17.5,
            },
            select: {
                id: true,
                knowledgeId: true,
                sourceContentId: true,
                heatScore: true,
            },
        });
        expect(result).toMatchObject({
            knowledgeId: 'knowledge-9',
            sourceContentId: 'draft-content-42',
            sourceDraftHeatScore: 17.5,
            knowledgeHeatScore: 17.5,
            created: true,
        });
    });

    test('is idempotent when the knowledge is already bound to the same draft source', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 42,
                    circleId: 7,
                    contentId: 'draft-content-42',
                    heatScore: 12,
                }),
            },
            knowledge: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    circleId: 7,
                    onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                    sourceContentId: 'draft-content-42',
                    heatScore: 21,
                }),
                update: jest.fn(),
            },
        } as any;

        const result = await bindKnowledgeToDraftSource(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
        });

        expect(prisma.knowledge.update).not.toHaveBeenCalled();
        expect(result.created).toBe(false);
        expect(result.sourceDraftHeatScore).toBe(12);
        expect(result.knowledgeHeatScore).toBe(21);
    });

    test('preserves existing knowledge heat when binding happens after crystal-side activity', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 42,
                    circleId: 7,
                    contentId: 'draft-content-42',
                    heatScore: 17.5,
                }),
            },
            knowledge: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    circleId: 7,
                    onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                    sourceContentId: null,
                    heatScore: 31,
                }),
                update: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    sourceContentId: 'draft-content-42',
                    heatScore: 31,
                }),
            },
        } as any;

        const result = await bindKnowledgeToDraftSource(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
        });

        expect(prisma.knowledge.update).toHaveBeenCalledWith({
            where: { id: 9 },
            data: {
                sourceContentId: 'draft-content-42',
                heatScore: 31,
            },
            select: {
                id: true,
                knowledgeId: true,
                sourceContentId: true,
                heatScore: true,
            },
        });
        expect(result).toMatchObject({
            knowledgeId: 'knowledge-9',
            sourceContentId: 'draft-content-42',
            sourceDraftHeatScore: 17.5,
            knowledgeHeatScore: 31,
            created: true,
        });
    });

    test('does not create duplicate output-side persistence while binding existing knowledge truth', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 42,
                    circleId: 7,
                    contentId: 'draft-content-42',
                    heatScore: 17.5,
                }),
            },
            knowledge: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    circleId: 7,
                    onChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
                    sourceContentId: null,
                    heatScore: 0,
                }),
                update: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 9,
                    knowledgeId: 'knowledge-9',
                    sourceContentId: 'draft-content-42',
                    heatScore: 17.5,
                }),
            },
            knowledgeBinding: {
                upsert: jest.fn(),
            },
            knowledgeContribution: {
                createMany: jest.fn(),
            },
        } as any;

        await bindKnowledgeToDraftSource(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '5x62odtFr3qup81zNr4p8XxBWKzxjuqwiNjiJbXHCTJH',
        });

        expect(prisma.knowledge.update).toHaveBeenCalledTimes(1);
        expect(prisma.knowledgeBinding.upsert).not.toHaveBeenCalled();
        expect(prisma.knowledgeContribution.createMany).not.toHaveBeenCalled();
    });
});
