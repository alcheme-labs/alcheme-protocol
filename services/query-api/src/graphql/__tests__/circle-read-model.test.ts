import { describe, expect, jest, test } from '@jest/globals';

import { resolvers } from '../resolvers';
import * as circleSettingsService from '../../services/policy/settingsEnvelope';

describe('GraphQL circle read model projection', () => {
    test('Query.circle projects membership policy state before Circle field readers consume it', async () => {
        const findUnique = jest.fn(async () => ({
            id: 7,
            creatorId: 9,
            circleType: 'Open',
            minCrystals: 1,
            joinRequirement: 'Free',
            genesisMode: 'SEEDED',
            creator: {
                id: 9,
                handle: 'owner',
                pubkey: 'owner-pubkey',
                displayName: 'Owner',
            },
        }));
        const prisma = {
            circle: {
                findUnique,
            },
        } as any;
        jest.spyOn(circleSettingsService, 'resolveProjectedCircleSettings').mockResolvedValue({
            joinRequirement: 'ApprovalRequired',
            circleType: 'Closed',
            minCrystals: 5,
            source: 'signed_envelope',
        });

        const result = await (resolvers as any).Query.circle(
            null,
            { id: 7 },
            { prisma },
        );

        expect(findUnique).toHaveBeenCalledWith({
            where: { id: 7 },
            include: {
                creator: true,
            },
        });
        expect((result as any).__projectedCircleSettings).toMatchObject({
            joinRequirement: 'ApprovalRequired',
            circleType: 'Closed',
            minCrystals: 5,
            source: 'signed_envelope',
        });
    });

    test('Circle.circleType and Circle.minCrystals prefer projected protocol state over raw row fields', async () => {
        const circle = {
            id: 7,
            circleType: 'Open',
            minCrystals: 1,
            __projectedCircleSettings: {
                joinRequirement: 'ApprovalRequired',
                circleType: 'Closed',
                minCrystals: 5,
                source: 'signed_envelope',
            },
        };

        await expect((resolvers as any).Circle.circleType(circle, {}, { prisma: {} })).resolves.toBe('Closed');
        await expect((resolvers as any).Circle.minCrystals(circle, {}, { prisma: {} })).resolves.toBe(5);
    });

    test('Query.allCircles excludes archived circles from public listings', async () => {
        const findMany = jest.fn(async () => ([
            {
                id: 7,
                creatorId: 9,
                lifecycleStatus: 'Active',
                joinRequirement: 'Free',
                circleType: 'Open',
                minCrystals: 0,
                creator: {
                    id: 9,
                    handle: 'owner',
                    pubkey: 'owner-pubkey',
                    displayName: 'Owner',
                },
            },
        ]));
        const prisma = {
            circle: {
                findMany,
            },
        } as any;

        await (resolvers as any).Query.allCircles(
            null,
            { limit: 20, offset: 0 },
            { prisma },
        );

        expect(findMany).toHaveBeenCalledWith({
            where: {
                lifecycleStatus: 'Active',
            },
            take: 20,
            skip: 0,
            orderBy: { createdAt: 'desc' },
            include: { creator: true },
        });
    });

    test('Query.searchCircles excludes archived circles from public search results', async () => {
        const findMany = jest.fn(async () => []);
        const prisma = {
            circle: {
                findMany,
            },
        } as any;

        await (resolvers as any).Query.searchCircles(
            null,
            { query: 'knowledge', limit: 20 },
            { prisma },
        );

        expect(findMany).toHaveBeenCalledWith({
            where: {
                lifecycleStatus: 'Active',
                OR: [
                    { name: { contains: 'knowledge', mode: 'insensitive' } },
                    { description: { contains: 'knowledge', mode: 'insensitive' } },
                ],
            },
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: { creator: true },
        });
    });

    test('Query.circleDescendants excludes archived descendants from navigation trees', async () => {
        const findMany = jest.fn(async () => []);
        const prisma = {
            circle: {
                findMany,
            },
        } as any;

        await (resolvers as any).Query.circleDescendants(
            null,
            { rootId: 7 },
            { prisma },
        );

        expect(findMany).toHaveBeenCalledWith({
            where: {
                parentCircleId: { in: [7] },
                lifecycleStatus: 'Active',
            },
            orderBy: { createdAt: 'desc' },
            include: { creator: true },
        });
    });

    test('Query.myCircles keeps archived memberships visible for read and leave flows', async () => {
        const archivedCircle = {
            id: 17,
            creatorId: 9,
            lifecycleStatus: 'Archived',
            joinRequirement: 'Free',
            circleType: 'Open',
            minCrystals: 0,
            creator: {
                id: 9,
                handle: 'owner',
                pubkey: 'owner-pubkey',
                displayName: 'Owner',
            },
        };
        const findMany = jest.fn(async () => ([
            {
                userId: 3,
                status: 'Active',
                circle: archivedCircle,
            },
        ]));
        const prisma = {
            circleMember: {
                findMany,
            },
        } as any;

        const result = await (resolvers as any).Query.myCircles(
            null,
            {},
            { prisma, userId: 3 },
        );

        expect(findMany).toHaveBeenCalledWith({
            where: {
                userId: 3,
                status: 'Active',
            },
            include: { circle: true },
        });
        expect(result).toEqual([expect.objectContaining({
            id: 17,
            lifecycleStatus: 'Archived',
        })]);
    });
});
