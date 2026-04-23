import { describe, expect, jest, test } from '@jest/globals';

import { resolveUserCrystalBalance } from '../engine';
import { resolveOwnedCrystalCount } from '../../crystalEntitlements/runtime';

function createPrismaMock() {
    const parentById = new Map<number, number | null>([
        [7, null],
        [8, 7],
        [9, 8],
    ]);
    const entitlements = [
        { ownerPubkey: 'user-88-pubkey', status: 'active', circleId: 7 },
        { ownerPubkey: 'user-88-pubkey', status: 'active', circleId: 8 },
        { ownerPubkey: 'user-88-pubkey', status: 'active', circleId: 9 },
        { ownerPubkey: 'user-88-pubkey', status: 'revoked', circleId: 9 },
        { ownerPubkey: 'someone-else', status: 'active', circleId: 8 },
    ];

    return {
        user: {
            findUnique: async ({ where }: any) => {
                if (where?.id === 88) {
                    return { pubkey: 'user-88-pubkey' };
                }
                return null;
            },
        },
        circle: {
            findUnique: async ({ where }: any) => ({
                parentCircleId: parentById.get(Number(where?.id)) ?? null,
            }),
            findMany: async ({ where }: any) => {
                const ids = Array.isArray(where?.parentCircleId?.in)
                    ? where.parentCircleId.in.map((value: unknown) => Number(value))
                    : [];
                return Array.from(parentById.entries())
                    .filter(([, parentId]) => parentId !== null && ids.includes(parentId))
                    .map(([id]) => ({ id }));
            },
        },
        knowledge: {
            count: jest.fn(async () => 5),
        },
        crystalEntitlement: {
            count: async ({ where }: any) => entitlements.filter((row) => {
                if (where?.ownerPubkey && row.ownerPubkey !== where.ownerPubkey) return false;
                if (where?.status && row.status !== where.status) return false;
                const circleIds = Array.isArray(where?.circleId?.in)
                    ? where.circleId.in.map((value: unknown) => Number(value))
                    : null;
                if (circleIds && !circleIds.includes(row.circleId)) return false;
                return true;
            }).length,
        },
    };
}

describe('crystal entitlement-backed balance resolution', () => {
    test('counts active entitlements across the target circle hierarchy', async () => {
        const prisma = createPrismaMock();

        const count = await resolveUserCrystalBalance(prisma as any, 88, 8);

        expect(count).toBe(3);
        expect((prisma.knowledge.count as any)).not.toHaveBeenCalled();
    });

    test('can resolve owned crystal count directly from a wallet pubkey', async () => {
        const prisma = createPrismaMock();

        const count = await resolveOwnedCrystalCount(prisma as any, {
            ownerPubkey: 'user-88-pubkey',
            circleId: 8,
        });

        expect(count).toBe(3);
    });
});
