import { describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';
import { resolvers } from '../resolvers';

describe('GraphQL memberProfile resolver', () => {
    test('returns null for unauthenticated viewers', async () => {
        const prisma = {
            circleMember: {
                findFirst: jest.fn(),
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 7 },
            { prisma, userId: undefined },
        );

        expect(result).toBeNull();
    });

    test('returns null for viewers outside the member directory ACL', async () => {
        const findUnique = jest.fn<() => Promise<any>>().mockResolvedValue(null);
        const findFirst = jest.fn();
        const aggregate = jest.fn();
        const count = jest.fn();
        const findMany = jest.fn();
        const circleFindUnique = jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 77 });
        const prisma = {
            circleMember: {
                findUnique,
                findFirst,
                count,
                findMany,
            },
            knowledge: {
                aggregate,
                findMany,
            },
            circle: {
                findUnique: circleFindUnique,
                findMany,
            },
            post: {
                findMany,
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 7 },
            { prisma, userId: 88 },
        );

        expect(result).toBeNull();
        expect(findUnique).toHaveBeenCalledWith({
            where: {
                circleId_userId: {
                    circleId: 12,
                    userId: 88,
                },
            },
        });
        expect(findFirst).not.toHaveBeenCalled();
        expect(aggregate).not.toHaveBeenCalled();
        expect(count).not.toHaveBeenCalled();
        expect(findMany).not.toHaveBeenCalled();
    });

    test('returns enriched member profile for active member viewers', async () => {
        const viewerMembershipLookup = jest
            .fn<() => Promise<{ status: MemberStatus } | null>>()
            .mockResolvedValue({ status: MemberStatus.Active });
        const targetMembership = {
            circleId: 12,
            userId: 7,
            role: 'Moderator',
            joinedAt: new Date('2026-02-10T00:00:00.000Z'),
            user: {
                id: 7,
                handle: 'alice',
                pubkey: 'AlicePubkey1111111111111111111111111111111',
                displayName: 'Alice',
                avatarUri: null,
                reputationScore: 12.5,
                followersCount: 0,
                followingCount: 0,
                postsCount: 0,
                circlesCount: 0,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        };
        const findFirst = jest.fn<() => Promise<any>>().mockResolvedValue(targetMembership);
        const knowledgeAggregate = jest.fn<() => Promise<any>>().mockResolvedValue({
            _count: 3,
            _sum: { citationCount: 11 },
        });
        const membershipCount = jest.fn<() => Promise<any>>().mockResolvedValue(4);
        const sharedCircleRows = [
            { id: 12, name: 'Alpha', kind: 'main', level: 0 },
            { id: 19, name: 'Beta', kind: 'auxiliary', level: 1 },
        ];
        const circleMembershipsFindMany = jest.fn<() => Promise<any>>()
            .mockResolvedValueOnce([
                { circleId: 12 },
                { circleId: 19 },
                { circleId: 33 },
            ])
            .mockResolvedValueOnce([
                { circleId: 12 },
                { circleId: 19 },
                { circleId: 44 },
            ]);
        const circleFindMany = jest.fn<() => Promise<any>>().mockResolvedValue(sharedCircleRows);
        const postFindMany = jest.fn<() => Promise<any>>().mockResolvedValue([
            {
                status: 'Active',
                createdAt: new Date('2026-02-27T12:00:00.000Z'),
            },
            {
                status: 'Draft',
                createdAt: new Date('2026-02-27T10:00:00.000Z'),
            },
        ]);
        const knowledgeFindMany = jest.fn<() => Promise<any>>().mockResolvedValue([
            {
                createdAt: new Date('2026-02-27T11:00:00.000Z'),
            },
        ]);
        const followFindFirst = jest.fn<() => Promise<any>>().mockResolvedValue(null);
        const circleFindUnique = jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 99 });
        const prisma = {
            circleMember: {
                findUnique: viewerMembershipLookup,
                findFirst,
                count: membershipCount,
                findMany: circleMembershipsFindMany,
            },
            knowledge: {
                aggregate: knowledgeAggregate,
                findMany: knowledgeFindMany,
            },
            circle: {
                findUnique: circleFindUnique,
                findMany: circleFindMany,
            },
            post: {
                findMany: postFindMany,
            },
            follow: {
                findFirst: followFindFirst,
            },
            crystalEntitlement: {
                count: jest.fn<() => Promise<any>>().mockResolvedValue(4),
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 7 },
            { prisma, userId: 88 },
        );

        expect(result).toMatchObject({
            user: targetMembership.user,
            viewerFollows: false,
            isSelf: false,
            role: 'Moderator',
            joinedAt: targetMembership.joinedAt,
            knowledgeCount: 3,
            ownedCrystalCount: 4,
            totalCitations: 11,
            circleCount: 4,
            sharedCircles: sharedCircleRows,
        });
        expect(result.recentActivity).toEqual([
            {
                type: 'post',
                text: '发布了一条动态',
                createdAt: new Date('2026-02-27T12:00:00.000Z'),
            },
            {
                type: 'crystal',
                text: '结晶了一枚知识',
                createdAt: new Date('2026-02-27T11:00:00.000Z'),
            },
            {
                type: 'draft',
                text: '更新了一份草稿',
                createdAt: new Date('2026-02-27T10:00:00.000Z'),
            },
        ]);
        expect(circleFindMany).toHaveBeenCalled();
        expect(postFindMany).toHaveBeenCalled();
        expect(knowledgeFindMany).toHaveBeenCalled();
    });

    test('returns enriched member profile for creator without membership lookup', async () => {
        const findUnique = jest.fn();
        const circleFindUnique = jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 99 });
        const findFirst = jest.fn<() => Promise<any>>().mockResolvedValue({
            circleId: 12,
            userId: 99,
            role: 'Owner',
            joinedAt: new Date('2026-02-01T00:00:00.000Z'),
            user: {
                id: 99,
                handle: 'owner',
                pubkey: 'OwnerPubkey111111111111111111111111111111',
                displayName: 'Owner',
                avatarUri: null,
                reputationScore: 8.2,
                followersCount: 0,
                followingCount: 0,
                postsCount: 0,
                circlesCount: 0,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        });
        const prisma = {
            circleMember: {
                findUnique,
                findFirst,
                count: jest.fn<() => Promise<any>>().mockResolvedValue(1),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([{ circleId: 12 }]),
            },
            knowledge: {
                aggregate: jest.fn<() => Promise<any>>().mockResolvedValue({
                    _count: 1,
                    _sum: { citationCount: 2 },
                }),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            circle: {
                findUnique: circleFindUnique,
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([{ id: 12, name: 'Alpha', kind: 'main', level: 0 }]),
            },
            post: {
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            follow: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue(null),
            },
            crystalEntitlement: {
                count: jest.fn<() => Promise<any>>().mockResolvedValue(1),
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 99 },
            { prisma, userId: 99 },
        );

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            isSelf: true,
            viewerFollows: false,
            ownedCrystalCount: 1,
        });
        expect(findUnique).not.toHaveBeenCalled();
    });

    test('returns viewerFollows=true when viewer already follows target user', async () => {
        const viewerMembershipLookup = jest
            .fn<() => Promise<{ status: MemberStatus } | null>>()
            .mockResolvedValue({ status: MemberStatus.Active });
        const targetMembership = {
            circleId: 12,
            userId: 7,
            role: 'Member',
            joinedAt: new Date('2026-02-10T00:00:00.000Z'),
            user: {
                id: 7,
                handle: 'alice',
                pubkey: 'AlicePubkey1111111111111111111111111111111',
                displayName: 'Alice',
                avatarUri: null,
                reputationScore: 12.5,
                followersCount: 0,
                followingCount: 0,
                postsCount: 0,
                circlesCount: 0,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
            },
        };
        const findFirst = jest.fn<() => Promise<any>>().mockResolvedValue(targetMembership);
        const prisma = {
            circleMember: {
                findUnique: viewerMembershipLookup,
                findFirst,
                count: jest.fn<() => Promise<any>>().mockResolvedValue(1),
                findMany: jest
                    .fn<() => Promise<any>>()
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
            circle: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ creatorId: 99 }),
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([{ id: 12, name: 'Alpha', kind: 'main', level: 0 }]),
            },
            post: {
                findMany: jest.fn<() => Promise<any>>().mockResolvedValue([]),
            },
            follow: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ followerId: 88 }),
            },
            crystalEntitlement: {
                count: jest.fn<() => Promise<any>>().mockResolvedValue(0),
            },
        } as any;

        const result = await (resolvers as any).Query.memberProfile(
            {},
            { circleId: 12, userId: 7 },
            { prisma, userId: 88 },
        );

        expect(result).toMatchObject({
            isSelf: false,
            viewerFollows: true,
            ownedCrystalCount: 0,
        });
        expect(prisma.follow.findFirst).toHaveBeenCalledWith({
            where: {
                followerId: 88,
                followingId: 7,
            },
            select: { followerId: true },
        });
    });
});

describe('GraphQL updateUser mutation', () => {
    test('rejects protocol-owned profile writes through centralized mutation path', async () => {
        const update = jest.fn();
        const findUnique = jest.fn<() => Promise<any>>().mockResolvedValue({
            id: 7,
            handle: 'alice',
            pubkey: 'AlicePubkey1111111111111111111111111111111',
            displayName: 'Alice',
            bio: null,
            avatarUri: null,
            bannerUri: null,
            website: null,
            location: null,
            reputationScore: 0,
            followersCount: 0,
            followingCount: 0,
            postsCount: 0,
            circlesCount: 0,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        const prisma = {
            user: {
                update,
                findUnique,
            },
        } as any;

        await expect(
            (resolvers as any).Mutation.updateUser(
                {},
                {
                    input: {
                        displayName: 'New Alice',
                        bio: 'centralized shadow truth',
                    },
                },
                { prisma, userId: 7 },
            ),
        ).rejects.toThrow('wallet-signed identity transaction');

        expect(update).not.toHaveBeenCalled();
    });
});
