import { describe, expect, jest, test } from '@jest/globals';

import {
    resolveCircleAgentPolicy,
    upsertCircleAgentPolicy,
} from '../policy';

describe('agent policy', () => {
    test('returns a stable default policy when a circle has no persisted agent policy yet', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                })),
            },
            circleAgentPolicy: {
                findUnique: jest.fn(async () => null),
            },
        } as any;

        const result = await resolveCircleAgentPolicy(prisma, 7);

        expect(result).toMatchObject({
            circleId: 7,
            triggerScope: 'draft_only',
            costDiscountBps: 0,
            reviewMode: 'owner_review',
        });
    });

    test('upserts policy changes while preserving circle scope and actor attribution', async () => {
        const updatedAt = new Date('2026-03-25T22:30:00.000Z');
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                })),
            },
            circleAgentPolicy: {
                upsert: jest.fn(async ({ create, update }) => ({
                    circleId: 7,
                    triggerScope: update.triggerScope ?? create.triggerScope,
                    costDiscountBps: update.costDiscountBps ?? create.costDiscountBps,
                    reviewMode: update.reviewMode ?? create.reviewMode,
                    updatedByUserId: update.updatedByUserId ?? create.updatedByUserId,
                    createdAt: new Date('2026-03-25T22:00:00.000Z'),
                    updatedAt,
                })),
            },
        } as any;

        const result = await upsertCircleAgentPolicy(prisma, {
            circleId: 7,
            actorUserId: 8,
            patch: {
                triggerScope: 'circle_wide',
                costDiscountBps: 1500,
                reviewMode: 'admin_review',
            },
        });

        expect(prisma.circleAgentPolicy.upsert).toHaveBeenCalledWith({
            where: { circleId: 7 },
            create: {
                circleId: 7,
                triggerScope: 'circle_wide',
                costDiscountBps: 1500,
                reviewMode: 'admin_review',
                updatedByUserId: 8,
            },
            update: {
                triggerScope: 'circle_wide',
                costDiscountBps: 1500,
                reviewMode: 'admin_review',
                updatedByUserId: 8,
            },
        });
        expect(result).toMatchObject({
            circleId: 7,
            triggerScope: 'circle_wide',
            costDiscountBps: 1500,
            reviewMode: 'admin_review',
            updatedByUserId: 8,
        });
    });
});
