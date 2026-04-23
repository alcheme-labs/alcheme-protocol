import { describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';

import { resolvers } from '../resolvers';

describe('GraphQL memberProfile follow state fields', () => {
    test('resolves viewerFollows=true when follow row exists', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 9 }),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([{ id: 12, name: 'Alpha', kind: 'main', level: 0 }]),
            },
            circleMember: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ status: MemberStatus.Active }),
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({
                    circleId: 12,
                    userId: 7,
                    role: 'Member',
                    joinedAt: new Date('2026-03-10T00:00:00.000Z'),
                    user: {
                        id: 7,
                        handle: 'alice',
                        pubkey: 'AlicePubkey1111111111111111111111111111111',
                        displayName: 'Alice',
                        avatarUri: null,
                        reputationScore: 10,
                        followersCount: 0,
                        followingCount: 0,
                        postsCount: 0,
                        circlesCount: 0,
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                }),
                count: jest.fn<() => Promise<number>>().mockResolvedValue(1),
                findMany: jest
                    .fn<() => Promise<Array<{ circleId: number }>>>()
                    .mockResolvedValueOnce([{ circleId: 12 }])
                    .mockResolvedValueOnce([{ circleId: 12 }]),
            },
            knowledge: {
                aggregate: jest.fn<() => Promise<any>>().mockResolvedValue({
                    _count: 0,
                    _sum: { citationCount: 0 },
                }),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            post: {
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            follow: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ followerId: 88 }),
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 7 },
            { prisma, userId: 88 },
        );

        expect(result).toMatchObject({
            viewerFollows: true,
            isSelf: false,
        });
    });

    test('resolves isSelf=true and viewerFollows=false when viewer equals target', async () => {
        const followFindFirst = jest.fn<() => Promise<any>>().mockResolvedValue({ followerId: 9 });
        const prisma = {
            circle: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 9 }),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([{ id: 12, name: 'Alpha', kind: 'main', level: 0 }]),
            },
            circleMember: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ status: MemberStatus.Active }),
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({
                    circleId: 12,
                    userId: 9,
                    role: 'Owner',
                    joinedAt: new Date('2026-03-10T00:00:00.000Z'),
                    user: {
                        id: 9,
                        handle: 'owner',
                        pubkey: 'OwnerPubkey111111111111111111111111111111',
                        displayName: 'Owner',
                        avatarUri: null,
                        reputationScore: 10,
                        followersCount: 0,
                        followingCount: 0,
                        postsCount: 0,
                        circlesCount: 0,
                        createdAt: new Date('2026-01-01T00:00:00.000Z'),
                    },
                }),
                count: jest.fn<() => Promise<number>>().mockResolvedValue(1),
                findMany: jest
                    .fn<() => Promise<Array<{ circleId: number }>>>()
                    .mockResolvedValueOnce([{ circleId: 12 }])
                    .mockResolvedValueOnce([{ circleId: 12 }]),
            },
            knowledge: {
                aggregate: jest.fn<() => Promise<any>>().mockResolvedValue({
                    _count: 0,
                    _sum: { citationCount: 0 },
                }),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            post: {
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            follow: {
                findFirst: followFindFirst,
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 9 },
            { prisma, userId: 9 },
        );

        expect(result).toMatchObject({
            viewerFollows: false,
            isSelf: true,
        });
        expect(followFindFirst).not.toHaveBeenCalled();
    });
});
