import { describe, expect, jest, test } from '@jest/globals';
import { resolvers } from '../resolvers';

describe('GraphQL Query.post dual-stack compatibility', () => {
    test('falls back to onChainAddress lookup when contentId lookup misses', async () => {
        const fallbackPost = {
            id: 301,
            contentId: '1700000000301',
            onChainAddress: 'Post1111111111111111111111111111111111111',
            authorId: 7,
        };
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(null),
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(fallbackPost),
            },
        } as any;
        const cache = {
            get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
            setex: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        } as any;

        const result = await (resolvers as any).Query.post(
            {},
            { contentId: fallbackPost.onChainAddress },
            { prisma, cache },
        );

        expect(prisma.post.findUnique).toHaveBeenCalledWith({
            where: { contentId: fallbackPost.onChainAddress },
            include: {
                author: true,
            },
        });
        expect(prisma.post.findFirst).toHaveBeenCalledWith({
            where: {
                onChainAddress: fallbackPost.onChainAddress,
            },
            include: {
                author: true,
            },
        });
        expect(cache.setex).toHaveBeenCalled();
        expect(result).toEqual(fallbackPost);
    });

    test('queries posts by both contentId and onChainAddress for mixed v1/v2 input', async () => {
        const prisma = {
            post: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
            },
        } as any;

        await (resolvers as any).Query.posts(
            {},
            { contentIds: ['v1-content-id', 'v2-anchor-id'] },
            { prisma },
        );

        expect(prisma.post.findMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    { contentId: { in: ['v1-content-id', 'v2-anchor-id'] } },
                    { onChainAddress: { in: ['v1-content-id', 'v2-anchor-id'] } },
                ],
            },
            include: {
                author: true,
            },
        });
    });
});
