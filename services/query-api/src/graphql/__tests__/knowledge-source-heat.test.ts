import { describe, expect, jest, test } from '@jest/globals';
import { resolvers } from '../resolvers';

describe('GraphQL knowledge source heat wiring', () => {
    test('knowledgeByCircle attaches source draft heat for downstream stats resolution', async () => {
        const prisma = {
            knowledge: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([
                    {
                        id: 9,
                        knowledgeId: 'knowledge-9',
                        circleId: 7,
                        sourceContentId: 'draft-content-42',
                        heatScore: 23.5,
                        qualityScore: 88,
                        citationCount: 3,
                        viewCount: 0,
                        author: { id: 1 },
                        circle: { id: 7 },
                    },
                ]),
            },
            post: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([
                    { contentId: 'draft-content-42', heatScore: 17.5 },
                ]),
            },
        } as any;

        const result = await (resolvers as any).Query.knowledgeByCircle(
            {},
            { circleId: 7, limit: 20, offset: 0 },
            { prisma },
        );

        expect(prisma.post.findMany).toHaveBeenCalledWith({
            where: {
                contentId: { in: ['draft-content-42'] },
            },
            select: {
                contentId: true,
                heatScore: true,
            },
        });
        expect(result[0].sourceDraftHeatScore).toBe(17.5);
        expect((resolvers as any).Knowledge.stats(result[0]).heatScore).toBe(23.5);
    });
});
