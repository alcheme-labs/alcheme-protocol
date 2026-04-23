import { describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';
import { resolvers } from '../resolvers';

describe('GraphQL Circle.members resolver', () => {
    test('returns empty list for unauthenticated viewers', async () => {
        const findUnique = jest.fn();
        const findMany = jest.fn();
        const prisma = {
            circleMember: {
                findUnique,
                findMany,
            },
        } as any;

        const result = await (resolvers as any).Circle.members(
            { id: 12, creatorId: 99 },
            { limit: 5 },
            { prisma, userId: undefined },
        );

        expect(result).toEqual([]);
        expect(findUnique).not.toHaveBeenCalled();
        expect(findMany).not.toHaveBeenCalled();
    });

    test('returns active members for active circle member viewer', async () => {
        const findUnique = jest.fn<() => Promise<{ status: MemberStatus } | null>>()
            .mockResolvedValue({
                status: MemberStatus.Active,
            });
        const rows = [
            {
                userId: 7,
                role: 'Member',
                status: MemberStatus.Active,
                user: { id: 7, handle: 'alice' },
            },
        ];
        const findMany = jest.fn<() => Promise<typeof rows>>().mockResolvedValue(rows);
        const prisma = {
            circleMember: {
                findUnique,
                findMany,
            },
        } as any;

        const result = await (resolvers as any).Circle.members(
            { id: 12, creatorId: 99 },
            { limit: 5 },
            { prisma, userId: 7 },
        );

        expect(findUnique).toHaveBeenCalledWith({
            where: {
                circleId_userId: {
                    circleId: 12,
                    userId: 7,
                },
            },
        });
        expect(findMany).toHaveBeenCalledWith({
            where: {
                circleId: 12,
                status: MemberStatus.Active,
            },
            take: 5,
            include: { user: true },
        });
        expect(result).toEqual(rows);
    });

    test('returns active members for creator without membership lookup', async () => {
        const findUnique = jest.fn();
        const rows = [
            {
                userId: 99,
                role: 'Owner',
                status: MemberStatus.Active,
                user: { id: 99, handle: 'owner' },
            },
        ];
        const findMany = jest.fn<() => Promise<typeof rows>>().mockResolvedValue(rows);
        const prisma = {
            circleMember: {
                findUnique,
                findMany,
            },
        } as any;

        const result = await (resolvers as any).Circle.members(
            { id: 12, creatorId: 99 },
            { limit: 5 },
            { prisma, userId: 99 },
        );

        expect(findUnique).not.toHaveBeenCalled();
        expect(findMany).toHaveBeenCalled();
        expect(result).toEqual(rows);
    });
});
