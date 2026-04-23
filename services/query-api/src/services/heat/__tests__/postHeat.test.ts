import { describe, expect, jest, test } from '@jest/globals';

import { DRAFT_HEAT_EVENTS, bumpPostHeat, updateDraftContentAndHeat } from '../postHeat';

describe('draft post heat service', () => {
    test('bumpPostHeat increments heat score with positive delta', async () => {
        const update = jest.fn<() => Promise<any>>().mockResolvedValue({ id: 7, heatScore: 12 });
        const prisma = { post: { update } } as any;

        await bumpPostHeat(prisma, { postId: 7, delta: DRAFT_HEAT_EVENTS.edit });

        expect(update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { heatScore: { increment: 5 } },
            select: { id: true, heatScore: true },
        });
    });

    test('bumpPostHeat ignores zero or negative delta', async () => {
        const update = jest.fn();
        const prisma = { post: { update } } as any;

        await bumpPostHeat(prisma, { postId: 7, delta: 0 });
        await bumpPostHeat(prisma, { postId: 7, delta: -3 });

        expect(update).not.toHaveBeenCalled();
    });

    test('updateDraftContentAndHeat bumps heat only when text changes', async () => {
        const findUnique = jest.fn<() => Promise<any>>()
            .mockResolvedValueOnce({ id: 7, status: 'Draft', text: 'same', updatedAt: new Date('2026-02-28T12:00:00.000Z') })
            .mockResolvedValueOnce({ id: 7, status: 'Draft', text: 'before', updatedAt: new Date('2026-02-28T12:00:00.000Z') });
        const update = jest.fn<() => Promise<any>>().mockResolvedValue({
            id: 7,
            status: 'Draft',
            updatedAt: new Date('2026-02-28T12:05:00.000Z'),
            heatScore: 18,
        });
        const prisma = { post: { findUnique, update } } as any;

        const unchanged = await updateDraftContentAndHeat(prisma, { postId: 7, text: 'same' });
        const changed = await updateDraftContentAndHeat(prisma, { postId: 7, text: 'after' });

        expect(unchanged.changed).toBe(false);
        expect(changed.changed).toBe(true);
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: {
                text: 'after',
                heatScore: { increment: 5 },
            },
            select: {
                id: true,
                status: true,
                updatedAt: true,
                heatScore: true,
            },
        });
    });
});
