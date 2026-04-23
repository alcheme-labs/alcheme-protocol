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
});
