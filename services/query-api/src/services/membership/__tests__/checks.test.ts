import { describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';
import { canViewCircleMembers } from '../checks';

describe('membership access checks', () => {
    test('rejects unauthenticated circle member reads', async () => {
        const prisma = {
            circleMember: {
                findUnique: jest.fn(),
            },
        } as any;

        await expect(
            canViewCircleMembers(prisma, {
                circleId: 7,
                userId: null,
            }),
        ).resolves.toBe(false);
        expect(prisma.circleMember.findUnique).not.toHaveBeenCalled();
    });

    test('allows circle creator without membership lookup', async () => {
        const prisma = {
            circleMember: {
                findUnique: jest.fn(),
            },
        } as any;

        await expect(
            canViewCircleMembers(prisma, {
                circleId: 7,
                userId: 42,
                creatorId: 42,
            }),
        ).resolves.toBe(true);
        expect(prisma.circleMember.findUnique).not.toHaveBeenCalled();
    });

    test('allows active member to read member directory', async () => {
        const findUnique = jest.fn<() => Promise<{ status: MemberStatus } | null>>()
            .mockResolvedValue({
                status: MemberStatus.Active,
            });
        const prisma = {
            circleMember: {
                findUnique,
            },
        } as any;

        await expect(
            canViewCircleMembers(prisma, {
                circleId: 7,
                userId: 9,
            }),
        ).resolves.toBe(true);
        expect(findUnique).toHaveBeenCalledWith({
            where: {
                circleId_userId: {
                    circleId: 7,
                    userId: 9,
                },
            },
        });
    });

    test('rejects inactive members from member directory', async () => {
        const findUnique = jest.fn<() => Promise<{ status: MemberStatus } | null>>()
            .mockResolvedValue({
                status: MemberStatus.Left,
            });
        const prisma = {
            circleMember: {
                findUnique,
            },
        } as any;

        await expect(
            canViewCircleMembers(prisma, {
                circleId: 7,
                userId: 9,
            }),
        ).resolves.toBe(false);
    });
});
