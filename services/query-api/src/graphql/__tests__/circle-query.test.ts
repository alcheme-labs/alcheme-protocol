import { describe, expect, jest, test } from '@jest/globals';

import { resolvers } from '../resolvers';

describe('GraphQL circle query', () => {
    test('Circle.knowledgeCount resolves from knowledge truth instead of the stored row proxy', async () => {
        const knowledgeCount = jest.fn(async () => 6);
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 9,
                    knowledgeCount: 2,
                    creator: {
                        id: 9,
                        handle: 'owner',
                        pubkey: 'owner-pubkey',
                        displayName: 'Owner',
                    },
                })),
            },
            knowledge: {
                count: knowledgeCount,
            },
        } as any;

        const circle = await (resolvers as any).Query.circle(
            null,
            { id: 7 },
            { prisma },
        );
        const resolvedKnowledgeCount = await (resolvers as any).Circle.knowledgeCount(
            circle,
            {},
            { prisma },
        );

        expect(resolvedKnowledgeCount).toBe(6);
        expect(knowledgeCount).toHaveBeenCalledWith({
            where: {
                circleId: 7,
            },
        });
    });
});
