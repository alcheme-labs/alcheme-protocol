import { describe, expect, jest, test } from '@jest/globals';

import { resolvers } from '../src/graphql/resolvers';

describe('Task7 gate: follow read model stays compatible with v2 audiences', () => {
    test('followingFlow continues to reuse prisma.follow and admits FollowersOnly/CircleOnly', async () => {
        const prisma = {
            follow: {
                findMany: jest.fn<() => Promise<Array<{ followingId: number }>>>()
                    .mockResolvedValue([{ followingId: 7 }]),
            },
            post: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
            },
        } as any;

        await (resolvers as any).Query.followingFlow(
            {},
            { limit: 20, offset: 0 },
            { prisma, userId: 11 },
        );

        expect(prisma.follow.findMany).toHaveBeenCalledWith({
            where: { followerId: 11 },
            select: { followingId: true },
            take: 5000,
        });
        expect(prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: expect.arrayContaining([
                    { visibility: 'Public' },
                    { visibility: 'FollowersOnly' },
                    expect.objectContaining({ visibility: 'CircleOnly' }),
                ]),
            }),
        }));
    });
});
