import { describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';

import { resolvers } from '../resolvers';

describe('GraphQL circle stats resolver', () => {
    test('Circle.stats resolves live membership and post counts instead of stale stored counters', async () => {
        const activeMemberCount = jest.fn<() => Promise<number>>().mockResolvedValue(3);
        const postCount = jest.fn<() => Promise<number>>().mockResolvedValue(8);
        const prisma = {
            circleMember: {
                count: activeMemberCount,
            },
            post: {
                count: postCount,
            },
        } as any;

        const result = await (resolvers as any).Circle.stats(
            {
                id: 17,
                membersCount: 0,
                postsCount: 0,
            },
            {},
            { prisma },
        );

        expect(result).toEqual({
            members: 3,
            posts: 8,
        });
        expect(activeMemberCount).toHaveBeenCalledWith({
            where: {
                circleId: 17,
                status: MemberStatus.Active,
            },
        });
        expect(postCount).toHaveBeenCalledWith({
            where: {
                circleId: 17,
            },
        });
    });
});
