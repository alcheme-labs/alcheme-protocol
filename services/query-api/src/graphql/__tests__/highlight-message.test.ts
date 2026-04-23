import { describe, expect, jest, test } from '@jest/globals';
import { resolvers } from '../resolvers';

describe('GraphQL highlightMessage resolver', () => {
    test('persists first member highlight and returns stable count', async () => {
        const insertedAt = new Date('2026-02-28T10:00:00.000Z');
        const cache = {
            publish: jest.fn(async () => 1),
        };
        const tx = {
            discussionMessageHighlight: {
                createMany: jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 }),
                count: jest.fn<() => Promise<number>>().mockResolvedValue(1),
            },
            circleDiscussionMessage: {
                update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
            },
            $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(1),
        } as any;
        const prisma = {
            circleMember: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 'Active' }),
            },
            circleDiscussionMessage: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    senderPubkey: 'Sender11111111111111111111111111111111111',
                    circleId: 12,
                    deleted: false,
                    featuredAt: null,
                }),
            },
            user: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ pubkey: 'Viewer11111111111111111111111111111111111' }),
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ id: 77 }),
            },
            $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)),
        } as any;

        const result = await (resolvers as any).Mutation.highlightMessage(
            {},
            { circleId: 12, envelopeId: 'env-1' },
            {
                prisma,
                userId: 9,
                cache,
            },
        );

        expect(result).toEqual({
            ok: true,
            highlightCount: 1,
            isFeatured: true,
            alreadyHighlighted: false,
        });
        expect(tx.discussionMessageHighlight.createMany).toHaveBeenCalledWith({
            data: [{ envelopeId: 'env-1', userId: 9 }],
            skipDuplicates: true,
        });
        expect(tx.circleDiscussionMessage.update).toHaveBeenCalledWith({
            where: { envelopeId: 'env-1' },
            data: {
                isFeatured: true,
                featuredAt: expect.any(Date),
                featureReason: 'member_highlight',
            },
        });
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(cache.publish).toHaveBeenCalledWith(
            'discussion:circle:12',
            JSON.stringify({
                circleId: 12,
                latestLamport: null,
                envelopeId: 'env-1',
                reason: 'message_refresh_required',
            }),
        );
        expect(insertedAt).toBeInstanceOf(Date);
    });

    test('returns alreadyHighlighted on duplicate member highlight without re-notifying', async () => {
        const existingFeaturedAt = new Date('2026-02-28T08:00:00.000Z');
        const tx = {
            discussionMessageHighlight: {
                createMany: jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 0 }),
                count: jest.fn<() => Promise<number>>().mockResolvedValue(3),
            },
            circleDiscussionMessage: {
                update: jest.fn<() => Promise<unknown>>().mockResolvedValue({}),
            },
            $executeRaw: jest.fn<() => Promise<number>>().mockResolvedValue(0),
        } as any;
        const prisma = {
            circleMember: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 'Active' }),
            },
            circleDiscussionMessage: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    senderPubkey: 'Sender11111111111111111111111111111111111',
                    circleId: 12,
                    deleted: false,
                    featuredAt: existingFeaturedAt,
                }),
            },
            user: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ pubkey: 'Viewer11111111111111111111111111111111111' }),
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ id: 77 }),
            },
            $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)),
        } as any;

        const result = await (resolvers as any).Mutation.highlightMessage(
            {},
            { circleId: 12, envelopeId: 'env-1' },
            { prisma, userId: 9 },
        );

        expect(result).toEqual({
            ok: true,
            highlightCount: 3,
            isFeatured: true,
            alreadyHighlighted: true,
        });
        expect(tx.circleDiscussionMessage.update).toHaveBeenCalledWith({
            where: { envelopeId: 'env-1' },
            data: {
                isFeatured: true,
                featuredAt: existingFeaturedAt,
                featureReason: 'member_highlight',
            },
        });
        expect(tx.$executeRaw).not.toHaveBeenCalled();
    });

    test('rejects self-highlight', async () => {
        const prisma = {
            circleMember: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 'Active' }),
            },
            circleDiscussionMessage: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    senderPubkey: 'Viewer11111111111111111111111111111111111',
                    circleId: 12,
                    deleted: false,
                    featuredAt: null,
                }),
            },
            user: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ pubkey: 'Viewer11111111111111111111111111111111111' }),
            },
            $transaction: jest.fn(),
        } as any;

        await expect(
            (resolvers as any).Mutation.highlightMessage(
                {},
                { circleId: 12, envelopeId: 'env-1' },
                { prisma, userId: 9 },
            ),
        ).rejects.toThrow('Cannot highlight own message');
    });

    test('rejects deleted messages', async () => {
        const prisma = {
            circleMember: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 'Active' }),
            },
            circleDiscussionMessage: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    senderPubkey: 'Sender11111111111111111111111111111111111',
                    circleId: 12,
                    deleted: true,
                    featuredAt: null,
                }),
            },
            user: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ pubkey: 'Viewer11111111111111111111111111111111111' }),
            },
            $transaction: jest.fn(),
        } as any;

        await expect(
            (resolvers as any).Mutation.highlightMessage(
                {},
                { circleId: 12, envelopeId: 'env-1' },
                { prisma, userId: 9 },
            ),
        ).rejects.toThrow('Message not found');
    });

    test('rejects ephemeral visitor dust messages', async () => {
        const prisma = {
            circleMember: {
                findFirst: jest.fn<() => Promise<any>>().mockResolvedValue({ status: 'Active' }),
            },
            circleDiscussionMessage: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    senderPubkey: 'Sender11111111111111111111111111111111111',
                    circleId: 12,
                    deleted: false,
                    isEphemeral: true,
                    featuredAt: null,
                }),
            },
            user: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ pubkey: 'Viewer11111111111111111111111111111111111' }),
            },
            $transaction: jest.fn(),
        } as any;

        await expect(
            (resolvers as any).Mutation.highlightMessage(
                {},
                { circleId: 12, envelopeId: 'env-1' },
                { prisma, userId: 9 },
            ),
        ).rejects.toThrow('Cannot highlight ephemeral message');
    });
});
