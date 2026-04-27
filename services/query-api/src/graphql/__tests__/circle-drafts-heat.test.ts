import { describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';
import { resolvers } from '../resolvers';

describe('GraphQL draft heat wiring', () => {
    test('circleDrafts exposes real heatScore', async () => {
        const prisma = {
            circleMember: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ status: MemberStatus.Active }),
            },
            post: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([
                    {
                        id: 7,
                        text: 'Draft title',
                        status: 'Draft',
                        heatScore: 18.5,
                        createdAt: new Date('2026-02-27T00:00:00.000Z'),
                        updatedAt: new Date('2026-02-28T00:00:00.000Z'),
                        _count: { draftComments: 2 },
                    },
                ]),
            },
            draftWorkflowState: {
                findMany: jest.fn<() => Promise<any[]>>().mockResolvedValue([
                    {
                        draftPostId: 7,
                        documentStatus: 'crystallized',
                    },
                ]),
            },
        } as any;

        const result = await (resolvers as any).Query.circleDrafts(
            {},
            { circleId: 12, limit: 10, offset: 0 },
            { prisma, userId: 8 },
        );

        expect(result).toEqual([
            expect.objectContaining({
                postId: 7,
                heatScore: 18.5,
                documentStatus: 'crystallized',
                commentCount: 2,
            }),
        ]);
        expect(prisma.draftWorkflowState.findMany).toHaveBeenCalledWith({
            where: { draftPostId: { in: [7] } },
            select: { draftPostId: true, documentStatus: true },
        });
    });

    test('addDraftComment bumps draft heat in the same transaction', async () => {
        const tx = {
            draftComment: {
                create: jest.fn<() => Promise<any>>().mockResolvedValue({ id: 11, content: 'Nice point', userId: 8, postId: 7, lineRef: null, user: { id: 8, handle: 'alice' } }),
            },
            post: {
                update: jest.fn<() => Promise<any>>().mockResolvedValue({ id: 7, heatScore: 9 }),
                findUnique: jest.fn(),
            },
        } as any;
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 7,
                    authorId: 9,
                    circleId: 12,
                    status: 'Draft',
                }),
            },
            circleMember: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    role: 'Member',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                }),
            },
            $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx)),
        } as any;

        const result = await (resolvers as any).Mutation.addDraftComment(
            {},
            { postId: 7, content: 'Nice point', lineRef: undefined },
            { prisma, userId: 8 },
        );

        expect(result).toMatchObject({ id: 11, content: 'Nice point' });
        expect(tx.post.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { heatScore: { increment: 3 } },
            select: { id: true, heatScore: true },
        });
    });
});
