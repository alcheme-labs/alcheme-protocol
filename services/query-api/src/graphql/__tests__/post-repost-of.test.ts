import { describe, expect, jest, test } from '@jest/globals';
import { resolvers } from '../resolvers';

describe('GraphQL Post.repostOf resolver', () => {
    test('returns repost source post when relation exists', async () => {
        const sourcePost = {
            id: 11,
            contentId: 'source-content',
            text: 'source post',
        };
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue(sourcePost),
            },
        } as any;

        const result = await (resolvers as any).Post.repostOf(
            { repostOfPostId: 11 },
            {},
            { prisma },
        );

        expect(prisma.post.findUnique).toHaveBeenCalledWith({
            where: { id: 11 },
            include: { author: true },
        });
        expect(result).toEqual(sourcePost);
    });

    test('returns null when post is not a repost', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(),
            },
        } as any;

        const result = await (resolvers as any).Post.repostOf(
            { repostOfPostId: null },
            {},
            { prisma },
        );

        expect(prisma.post.findUnique).not.toHaveBeenCalled();
        expect(result).toBeNull();
    });

    test('falls back to repostOfAddress when repostOfPostId is missing', async () => {
        const sourcePost = {
            id: 21,
            contentId: 'v2-root-21',
            text: 'v2 source post',
        };
        const prisma = {
            post: {
                findUnique: jest.fn(),
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(sourcePost),
            },
        } as any;

        const result = await (resolvers as any).Post.repostOf(
            { repostOfPostId: null, repostOfAddress: 'v2-root-21' },
            {},
            { prisma },
        );

        expect(prisma.post.findUnique).not.toHaveBeenCalled();
        expect(prisma.post.findFirst).toHaveBeenCalledWith({
            where: {
                OR: [
                    { contentId: 'v2-root-21' },
                    { onChainAddress: 'v2-root-21' },
                ],
            },
            include: { author: true },
        });
        expect(result).toEqual(sourcePost);
    });
});
