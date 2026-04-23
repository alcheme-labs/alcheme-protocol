import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as contributorProofModule from '../contributorProof';
import {
    KnowledgeContributionSyncError,
    syncKnowledgeContributionsFromDraftProof,
} from '../knowledgeContributions';

describe('knowledgeContributions', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('syncs contributor snapshot rows from draft proof', async () => {
        jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 2,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 7000,
                    leafHex: 'f'.repeat(64),
                },
                {
                    pubkey: '11111111111111111111111111111112',
                    role: 'Discussant',
                    weightBps: 3000,
                    leafHex: '1'.repeat(64),
                },
            ],
        } as any);

        const deleteMany = jest.fn(async () => ({ count: 0 }));
        const createMany = jest.fn(async () => ({ count: 2 }));
        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 2,
                    binding: {
                        sourceAnchorId: 'a'.repeat(64),
                        proofPackageHash: '9'.repeat(64),
                        contributorsRoot: 'e'.repeat(64),
                        contributorsCount: 2,
                    },
                })),
            },
            user: {
                findMany: jest.fn(async () => ([
                    { pubkey: '11111111111111111111111111111111', handle: 'alice' },
                    { pubkey: '11111111111111111111111111111112', handle: 'bob' },
                ])),
            },
            knowledgeContribution: {
                deleteMany,
                createMany,
            },
            $transaction: jest.fn(async (cb: any) => cb({
                knowledgeContribution: {
                    deleteMany,
                    createMany,
                },
            })),
        } as any;

        const result = await syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        });

        expect(result).toMatchObject({
            synced: true,
            knowledgeId: 'deadbeef',
            contributorsCount: 2,
            contributorsRoot: 'e'.repeat(64),
        });
        expect(deleteMany).toHaveBeenCalledTimes(1);
        expect(createMany).toHaveBeenCalledTimes(1);
        const createManyCalls = ((createMany as any).mock?.calls as any[]) || [];
        const createManyArgs = createManyCalls[0]?.[0] || {};
        expect(createManyArgs.data).toEqual([
            expect.objectContaining({
                contributorPubkey: '11111111111111111111111111111111',
                contributorHandle: 'alice',
                contributionWeightBps: 7000,
                contributionWeight: 0.7,
            }),
            expect.objectContaining({
                contributorPubkey: '11111111111111111111111111111112',
                contributorHandle: 'bob',
                contributionWeightBps: 3000,
                contributionWeight: 0.3,
            }),
        ]);
    });

    test('falls back to the agent directory handle when a contributor proof row belongs to an agent pubkey', async () => {
        jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111112',
                    role: 'Discussant',
                    weightBps: 3000,
                    leafHex: '1'.repeat(64),
                },
            ],
        } as any);

        const createMany = jest.fn(async () => ({ count: 1 }));
        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                })),
            },
            user: {
                findMany: jest.fn(async () => ([])),
            },
            agent: {
                findMany: jest.fn(async () => ([
                    {
                        agentPubkey: '11111111111111111111111111111112',
                        handle: 'scribe-bot',
                    },
                ])),
            },
            knowledgeContribution: {
                deleteMany: jest.fn(async () => ({ count: 0 })),
                createMany,
            },
            $transaction: jest.fn(async (cb: any) => cb({
                knowledgeContribution: {
                    deleteMany: jest.fn(async () => ({ count: 0 })),
                    createMany,
                },
            })),
        } as any;

        await syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        });

        const createManyCalls = ((createMany as any).mock?.calls as any[]) || [];
        const createManyArgs = createManyCalls[0]?.[0] || {};
        expect(createManyArgs.data).toEqual([
            expect.objectContaining({
                contributorPubkey: '11111111111111111111111111111112',
                contributorHandle: 'scribe-bot',
            }),
        ]);
    });

    test('throws when indexed contributor root mismatches proof root', async () => {
        jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: '1'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        } as any);

        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: '2'.repeat(64),
                    contributorsCount: 1,
                    binding: {
                        sourceAnchorId: 'a'.repeat(64),
                        proofPackageHash: '9'.repeat(64),
                        contributorsRoot: '2'.repeat(64),
                        contributorsCount: 1,
                    },
                })),
            },
        } as any;

        await expect(syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        })).rejects.toBeInstanceOf(KnowledgeContributionSyncError);
    });

    test('throws when strict mode requires projected knowledge binding but projection is missing', async () => {
        jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        } as any);

        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                })),
            },
            $queryRaw: jest.fn(async () => ([])),
        } as any;

        await expect(syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        }, {
            requireBindingProjection: true,
        })).rejects.toMatchObject({
            code: 'proof_binding_required',
        });
    });

    test('throws when projected knowledge binding diverges from draft contributor proof', async () => {
        jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        } as any);

        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                })),
            },
            $queryRaw: jest.fn(async () => ([
                {
                    sourceAnchorId: 'f'.repeat(64),
                    contributorsRoot: '1'.repeat(64),
                    contributorsCount: 2,
                },
            ])),
        } as any;

        await expect(syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        }, {
            requireBindingProjection: true,
        })).rejects.toMatchObject({
            code: 'proof_binding_required',
        });
    });

    test('replays contributor proof against provided source anchor when snapshot anchor is provided', async () => {
        const proofSpy = jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        } as any);

        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                })),
            },
            user: {
                findMany: jest.fn(async () => ([
                    { pubkey: '11111111111111111111111111111111', handle: 'alice' },
                ])),
            },
            knowledgeContribution: {
                deleteMany: jest.fn(async () => ({ count: 0 })),
                createMany: jest.fn(async () => ({ count: 1 })),
            },
            $transaction: jest.fn(async (cb: any) => cb({
                knowledgeContribution: {
                    deleteMany: jest.fn(async () => ({ count: 0 })),
                    createMany: jest.fn(async () => ({ count: 1 })),
                },
            })),
        } as any;

        await syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        }, {
            proofAnchorId: 'a'.repeat(64),
            expectedContributorsRoot: 'e'.repeat(64),
            expectedContributorsCount: 1,
        });

        expect(proofSpy).toHaveBeenCalledWith(
            expect.anything(),
            42,
            { anchorId: 'a'.repeat(64) },
        );
    });

    test('throws when projected proof package hash diverges from request snapshot in strict mode', async () => {
        jest.spyOn(contributorProofModule, 'getDraftContributorProof').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            anchorId: 'a'.repeat(64),
            payloadHash: 'b'.repeat(64),
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            rootHex: 'e'.repeat(64),
            count: 1,
            contributors: [
                {
                    pubkey: '11111111111111111111111111111111',
                    role: 'Author',
                    weightBps: 10000,
                    leafHex: 'f'.repeat(64),
                },
            ],
        } as any);

        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    id: 99,
                    knowledgeId: 'deadbeef',
                    circleId: 7,
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                })),
            },
            $queryRaw: jest.fn(async () => ([
                {
                    sourceAnchorId: 'a'.repeat(64),
                    proofPackageHash: '1'.repeat(64),
                    contributorsRoot: 'e'.repeat(64),
                    contributorsCount: 1,
                },
            ])),
        } as any;

        await expect(syncKnowledgeContributionsFromDraftProof(prisma, {
            draftPostId: 42,
            knowledgeOnChainAddress: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        }, {
            requireBindingProjection: true,
            expectedProofPackageHash: '9'.repeat(64),
            proofAnchorId: 'a'.repeat(64),
            expectedContributorsRoot: 'e'.repeat(64),
            expectedContributorsCount: 1,
        })).rejects.toMatchObject({
            code: 'proof_binding_required',
        });
    });
});
