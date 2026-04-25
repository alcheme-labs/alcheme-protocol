import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const requireCircleManagerRoleMock = jest.fn();
const createDraftVersionSnapshotMock = jest.fn();
const updateDraftVersionSnapshotSourceEvidenceMock = jest.fn();
const createDraftAnchorBatchMock = jest.fn();
const publishDraftCandidateSystemNoticesMock = jest.fn();
const generateGhostDraftMock = jest.fn();
const generateInitialDiscussionDraftMock = jest.fn();
const claimDraftCandidateGenerationAttemptMock = jest.fn();
const markDraftCandidateGenerationSucceededMock = jest.fn();
const markDraftCandidateGenerationFailedMock = jest.fn();
const computeDraftCandidateSourceDigestMock = jest.fn();
const mockDiscussionInitialDraftErrorClass = class DiscussionInitialDraftError extends Error {
    code: string;
    retryable: boolean;
    diagnostics: Record<string, unknown>;

    constructor(input: {
        code: string;
        message: string;
        retryable?: boolean;
        diagnostics?: Record<string, unknown>;
    }) {
        super(input.message);
        this.name = 'DiscussionInitialDraftError';
        this.code = input.code;
        this.retryable = input.retryable ?? true;
        this.diagnostics = input.diagnostics ?? {};
    }
};

jest.mock('../../membership/checks', () => ({
    requireCircleManagerRole: requireCircleManagerRoleMock,
}));

jest.mock('../../draftLifecycle/versionSnapshots', () => ({
    createDraftVersionSnapshot: createDraftVersionSnapshotMock,
    updateDraftVersionSnapshotSourceEvidence: updateDraftVersionSnapshotSourceEvidenceMock,
}));

jest.mock('../../draftAnchor', () => ({
    createDraftAnchorBatch: createDraftAnchorBatchMock,
}));

jest.mock('../systemNoticeProducer', () => ({
    publishDraftCandidateSystemNotices: publishDraftCandidateSystemNoticesMock,
}));

jest.mock('../../../ai/ghost-draft', () => ({
    generateGhostDraft: generateGhostDraftMock,
}));

jest.mock('../../../ai/discussion-initial-draft', () => ({
    generateInitialDiscussionDraft: generateInitialDiscussionDraftMock,
    DiscussionInitialDraftError: mockDiscussionInitialDraftErrorClass,
}));

jest.mock('../candidateGenerationAttempts', () => ({
    claimDraftCandidateGenerationAttempt: claimDraftCandidateGenerationAttemptMock,
    markDraftCandidateGenerationSucceeded: markDraftCandidateGenerationSucceededMock,
    markDraftCandidateGenerationFailed: markDraftCandidateGenerationFailedMock,
    computeDraftCandidateSourceDigest: computeDraftCandidateSourceDigestMock,
}));

import {
    acceptDraftCandidateIntoDraft,
    createDraftFromManualDiscussionSelection,
    DraftCandidateAcceptanceError,
} from '../candidateAcceptance';

function createPrismaMock(input?: {
    circleName?: string;
    circleDescription?: string | null;
    circleCreatorId?: number;
    persistedAcceptance?: { draftPostId: number } | null;
    noticeMetadata?: Record<string, unknown> | null;
    createdDraftPostId?: number;
}) {
    const tx = {
        $executeRaw: jest.fn(async () => 1),
        $queryRaw: jest.fn(async () => (input?.noticeMetadata ? [{ metadata: input.noticeMetadata }] : [])),
        circle: {
            findUnique: jest.fn(async () => ({
                id: 7,
                name: input?.circleName ?? 'Discussion Synthesis Lab',
                description: input?.circleDescription ?? null,
                creatorId: input?.circleCreatorId ?? 11,
            })),
        },
        draftCandidateAcceptance: {
            findUnique: jest.fn(async () => input?.persistedAcceptance ?? null),
            create: jest.fn(async (args: any) => ({
                id: 1,
                ...args.data,
            })),
        },
        post: {
            create: jest.fn(async () => ({
                id: input?.createdDraftPostId ?? 88,
            })),
        },
    } as any;

    const prisma = {
        $queryRaw: jest.fn(async () => (input?.noticeMetadata ? [{ metadata: input.noticeMetadata }] : [])),
        $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
        circle: tx.circle,
        draftCandidateAcceptance: tx.draftCandidateAcceptance,
        post: {
            update: jest.fn(async () => ({})),
        },
    } as any;

    return { prisma, tx };
}

describe('candidateAcceptance', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (requireCircleManagerRoleMock as any).mockResolvedValue(true);
        (createDraftVersionSnapshotMock as any).mockResolvedValue({
            draftPostId: 88,
            draftVersion: 1,
        });
        (publishDraftCandidateSystemNoticesMock as any).mockResolvedValue({
            candidateId: 'cand_001',
            candidateState: 'accepted',
            draftCandidateNoticeEnvelopeId: 'env_notice',
            governanceNoticeEnvelopeId: null,
        });
        (generateGhostDraftMock as any).mockResolvedValue({
            generationId: 301,
        });
        (generateInitialDiscussionDraftMock as any).mockResolvedValue({
            title: 'Knowledge Circle Learning Path',
            draftText: [
                '# Knowledge Circle Learning Path',
                '',
                '## Context',
                'The group is designing a staged path for newcomers.',
                '',
                '## Current Conclusion',
                'Start with participation before synthesis.',
            ].join('\n'),
            sections: [
                {
                    heading: 'Context',
                    body: 'The group is designing a staged path for newcomers.',
                },
                {
                    heading: 'Current Conclusion',
                    body: 'Start with participation before synthesis.',
                },
            ],
            sourceDigest: 'a'.repeat(64),
            generationMetadata: {
                providerMode: 'builtin',
                model: 'llama3.1:8b',
                promptAsset: 'discussion-initial-draft',
                promptVersion: 'v1',
                sourceDigest: 'a'.repeat(64),
            },
            rawFinishReason: 'stop',
            sourceMessages: [
                {
                    envelopeId: 'env_b',
                    payloadHash: 'payload_hash_b',
                    lamport: BigInt(12),
                    senderPubkey: 'sender_b',
                    createdAt: new Date('2026-04-24T00:02:00.000Z'),
                    semanticScore: 0.84,
                    relevanceMethod: 'llm',
                },
                {
                    envelopeId: 'env_a',
                    payloadHash: 'payload_hash_a',
                    lamport: BigInt(11),
                    senderPubkey: 'sender_a',
                    createdAt: new Date('2026-04-24T00:01:00.000Z'),
                    semanticScore: 0.91,
                    relevanceMethod: 'llm',
                },
            ],
        });
        (createDraftAnchorBatchMock as any).mockResolvedValue({
            status: 'anchored',
            anchorId: 'anchor_001',
            payloadHash: 'payload_hash',
            summaryHash: 'c'.repeat(64),
            messagesDigest: 'd'.repeat(64),
            txSignature: 'tx_001',
            txSlot: '123',
            errorMessage: null,
            createdAt: '2026-04-24T00:03:00.000Z',
        });
        (updateDraftVersionSnapshotSourceEvidenceMock as any).mockResolvedValue({
            draftPostId: 88,
            draftVersion: 1,
            sourceSummaryHash: 'c'.repeat(64),
            sourceMessagesDigest: 'd'.repeat(64),
        });
        (computeDraftCandidateSourceDigestMock as any).mockReturnValue('b'.repeat(64));
        (claimDraftCandidateGenerationAttemptMock as any).mockResolvedValue({
            status: 'claimed',
            attemptId: 501,
            claimToken: 'claim_token_501',
            claimedUntil: new Date('2026-04-24T01:00:00.000Z'),
            attemptCount: 1,
        });
        (markDraftCandidateGenerationSucceededMock as any).mockResolvedValue(true);
        (markDraftCandidateGenerationFailedMock as any).mockResolvedValue(undefined);
    });

    test('creates a formal initial draft from source messages, persists acceptance, and republishes accepted state', async () => {
        const noticeMetadata = {
            candidateId: 'cand_001',
            state: 'open',
            summary: 'A concise candidate summary.',
            sourceMessageIds: ['env_a', 'env_b'],
            sourceSemanticFacets: ['problem', 'proposal'],
            sourceAuthorAnnotations: ['emotion'],
            draftPostId: null,
        };
        const { prisma, tx } = createPrismaMock({
            noticeMetadata,
            circleCreatorId: 41,
        });

        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        expect(result).toEqual({
            status: 'created',
            candidateId: 'cand_001',
            draftPostId: 88,
            created: true,
            ghostDraftGenerationId: null,
        });
        expect(requireCircleManagerRoleMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            userId: 19,
            allowModerator: true,
        });
        expect(tx.$executeRaw).toHaveBeenCalled();
        expect(tx.post.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                authorId: 41,
                circleId: 7,
                contentType: 'ai/discussion-draft',
                status: 'Draft',
                visibility: 'CircleOnly',
                text: [
                    '# Knowledge Circle Learning Path',
                    '',
                    '## Context',
                    'The group is designing a staged path for newcomers.',
                    '',
                    '## Current Conclusion',
                    'Start with participation before synthesis.',
                ].join('\n'),
            }),
            select: { id: true },
        });
        expect(createDraftVersionSnapshotMock).toHaveBeenCalledWith(tx, {
            draftPostId: 88,
            draftVersion: 1,
            contentSnapshot: [
                '# Knowledge Circle Learning Path',
                '',
                '## Context',
                'The group is designing a staged path for newcomers.',
                '',
                '## Current Conclusion',
                'Start with participation before synthesis.',
            ].join('\n'),
            createdFromState: 'drafting',
            createdBy: 41,
        });
        expect(tx.draftCandidateAcceptance.create).toHaveBeenCalledWith({
            data: {
                circleId: 7,
                candidateId: 'cand_001',
                draftPostId: 88,
                acceptedByUserId: 19,
            },
        });
        expect(markDraftCandidateGenerationSucceededMock).toHaveBeenCalledWith(tx, {
            attemptId: 501,
            claimToken: 'claim_token_501',
            draftPostId: 88,
            draftGenerationMethod: 'llm',
            draftGenerationDiagnostics: expect.objectContaining({
                sourceDigest: 'a'.repeat(64),
                promptAsset: 'discussion-initial-draft',
                promptVersion: 'v1',
            }),
        });
        expect(publishDraftCandidateSystemNoticesMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            summary: 'A concise candidate summary.',
            sourceMessageIds: ['env_a', 'env_b'],
            sourceSemanticFacets: ['problem', 'proposal'],
            sourceAuthorAnnotations: ['emotion'],
            draftPostId: 88,
            triggerReason: 'manual_candidate_acceptance',
        });
        expect(createDraftAnchorBatchMock).toHaveBeenCalledWith({
            prisma,
            circleId: 7,
            draftPostId: 88,
            roomKey: 'circle:7',
            triggerReason: 'manual_candidate_acceptance',
            summaryText: 'A concise candidate summary.',
            summaryMethod: 'llm',
            messages: [
                {
                    envelopeId: 'env_b',
                    payloadHash: 'payload_hash_b',
                    lamport: BigInt(12),
                    senderPubkey: 'sender_b',
                    createdAt: new Date('2026-04-24T00:02:00.000Z'),
                    semanticScore: 0.84,
                    relevanceMethod: 'llm',
                },
                {
                    envelopeId: 'env_a',
                    payloadHash: 'payload_hash_a',
                    lamport: BigInt(11),
                    senderPubkey: 'sender_a',
                    createdAt: new Date('2026-04-24T00:01:00.000Z'),
                    semanticScore: 0.91,
                    relevanceMethod: 'llm',
                },
            ],
        });
        expect(updateDraftVersionSnapshotSourceEvidenceMock).toHaveBeenCalledWith(prisma, {
            draftPostId: 88,
            draftVersion: 1,
            sourceSummaryHash: 'c'.repeat(64),
            sourceMessagesDigest: 'd'.repeat(64),
        });
        expect(prisma.post.update).toHaveBeenCalledWith({
            where: { id: 88 },
            data: { storageUri: 'solana://tx/tx_001' },
        });
        expect(generateInitialDiscussionDraftMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            circleName: 'Discussion Synthesis Lab',
            circleDescription: null,
            sourceMessageIds: ['env_a', 'env_b'],
        });
        expect(generateGhostDraftMock).not.toHaveBeenCalled();
        expect(claimDraftCandidateGenerationAttemptMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
            circleId: 7,
            candidateId: 'cand_001',
            sourceMessagesDigest: 'b'.repeat(64),
            sourceMessageIds: ['env_a', 'env_b'],
            attemptedByUserId: 19,
        }));
    });

    test('creates a manual discussion candidate notice before accepting selected messages', async () => {
        const noticeMetadata = {
            candidateId: 'cand_001',
            state: 'open',
            summary: 'Manual draft request from 2 discussion messages.',
            sourceMessageIds: ['env_a', 'env_b'],
            sourceSemanticFacets: [],
            sourceAuthorAnnotations: [],
            draftPostId: null,
        };
        const { prisma } = createPrismaMock({
            noticeMetadata,
            circleCreatorId: 41,
        });

        const result = await createDraftFromManualDiscussionSelection(prisma, {
            circleId: 7,
            sourceMessageIds: ['env_a', 'env_b'],
            userId: 19,
        });

        expect(result).toEqual({
            status: 'created',
            candidateId: 'cand_001',
            draftPostId: 88,
            created: true,
            ghostDraftGenerationId: null,
        });
        expect(publishDraftCandidateSystemNoticesMock).toHaveBeenNthCalledWith(1, prisma, {
            circleId: 7,
            summary: 'Manual draft request from 2 discussion messages.',
            sourceMessageIds: ['env_a', 'env_b'],
            sourceSemanticFacets: [],
            sourceAuthorAnnotations: [],
            draftPostId: null,
            triggerReason: 'manual_discussion_selection',
        });
        expect(generateInitialDiscussionDraftMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            circleName: 'Discussion Synthesis Lab',
            circleDescription: null,
            sourceMessageIds: ['env_a', 'env_b'],
        });
    });

    test('keeps manual candidate draft creation successful when post-commit anchor evidence fails', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        (createDraftAnchorBatchMock as any).mockRejectedValue(new Error('anchor unavailable'));
        const { prisma } = createPrismaMock({
            noticeMetadata: {
                candidateId: 'cand_001',
                state: 'open',
                summary: 'A concise candidate summary.',
                sourceMessageIds: ['env_a'],
                draftPostId: null,
            },
        });

        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        expect(result).toEqual({
            status: 'created',
            candidateId: 'cand_001',
            draftPostId: 88,
            created: true,
            ghostDraftGenerationId: null,
        });
        expect(createDraftAnchorBatchMock).toHaveBeenCalledWith(expect.objectContaining({
            prisma,
            circleId: 7,
            draftPostId: 88,
            triggerReason: 'manual_candidate_acceptance',
        }));
        expect(updateDraftVersionSnapshotSourceEvidenceMock).not.toHaveBeenCalled();
        expect(publishDraftCandidateSystemNoticesMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
            draftPostId: 88,
            triggerReason: 'manual_candidate_acceptance',
        }));
        expect(warnSpy).toHaveBeenCalledWith(
            'candidate acceptance: failed to anchor source evidence (anchor unavailable)',
        );
        warnSpy.mockRestore();
    });

    test('returns and publishes pending without starting generation when another request owns the active claim', async () => {
        (claimDraftCandidateGenerationAttemptMock as any).mockResolvedValue({
            status: 'pending',
            attemptId: 501,
            claimedUntil: new Date('2026-04-24T01:00:00.000Z'),
            attemptCount: 1,
        });
        const { prisma, tx } = createPrismaMock({
            noticeMetadata: {
                candidateId: 'cand_001',
                state: 'pending',
                summary: 'A concise candidate summary.',
                sourceMessageIds: ['env_a'],
                draftPostId: null,
            },
        });

        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        expect(result).toEqual({
            status: 'pending',
            candidateId: 'cand_001',
            attemptId: 501,
            claimedUntil: new Date('2026-04-24T01:00:00.000Z'),
            created: false,
        });
        expect(generateInitialDiscussionDraftMock).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(tx.post.create).not.toHaveBeenCalled();
        expect(publishDraftCandidateSystemNoticesMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
            circleId: 7,
            sourceMessageIds: ['env_a'],
            draftPostId: null,
            candidateStateOverride: 'pending',
            draftGenerationStatus: 'pending',
        }));
    });

    test('rolls back candidate draft creation when the generation claim is lost before success is recorded', async () => {
        (markDraftCandidateGenerationSucceededMock as any).mockResolvedValue(false);
        const { prisma } = createPrismaMock({
            noticeMetadata: {
                candidateId: 'cand_001',
                state: 'open',
                summary: 'A concise candidate summary.',
                sourceMessageIds: ['env_a'],
                draftPostId: null,
            },
        });

        await expect(acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        })).rejects.toMatchObject({
            code: 'draft_candidate_generation_claim_lost',
        } satisfies Partial<DraftCandidateAcceptanceError>);

        expect(createDraftAnchorBatchMock).not.toHaveBeenCalled();
        expect(publishDraftCandidateSystemNoticesMock).not.toHaveBeenCalled();
    });

    test('persists a retryable failure and creates no draft when initial generation fails', async () => {
        const generationError = new mockDiscussionInitialDraftErrorClass({
            code: 'initial_draft_generation_failed',
            message: 'provider unavailable',
            diagnostics: { providerMode: 'builtin' },
        });
        (generateInitialDiscussionDraftMock as any).mockRejectedValue(generationError);
        const { prisma, tx } = createPrismaMock({
            noticeMetadata: {
                candidateId: 'cand_001',
                state: 'open',
                summary: 'A concise candidate summary.',
                sourceMessageIds: ['env_a'],
                draftPostId: null,
            },
        });

        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        expect(result).toEqual({
            status: 'generation_failed',
            candidateId: 'cand_001',
            canRetry: true,
            draftGenerationError: 'initial_draft_generation_failed',
            created: false,
        });
        expect(markDraftCandidateGenerationFailedMock).toHaveBeenCalledWith(prisma, {
            attemptId: 501,
            claimToken: 'claim_token_501',
            draftGenerationError: 'initial_draft_generation_failed',
            draftGenerationDiagnostics: expect.objectContaining({
                message: 'provider unavailable',
                providerMode: 'builtin',
            }),
        });
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(tx.post.create).not.toHaveBeenCalled();
        expect(publishDraftCandidateSystemNoticesMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
            circleId: 7,
            draftPostId: null,
            candidateStateOverride: 'generation_failed',
            draftGenerationError: 'initial_draft_generation_failed',
        }));
    });

    test('casts advisory lock inputs to int4 so postgres uses the two-integer overload', async () => {
        const noticeMetadata = {
            candidateId: 'cand_001',
            state: 'open',
            summary: 'A concise candidate summary.',
            sourceMessageIds: ['env_a'],
            draftPostId: null,
        };
        const { prisma, tx } = createPrismaMock({
            noticeMetadata,
            circleCreatorId: 41,
        });

        await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        const [strings, circleId, candidateId] = tx.$executeRaw.mock.calls[0] ?? [];
        expect(strings).toEqual([
            '\n        SELECT pg_advisory_xact_lock(\n            CAST(',
            ' AS integer),\n            hashtext(',
            ')::integer\n        )\n    ',
        ]);
        expect(circleId).toBe(7);
        expect(candidateId).toBe('cand_001');
    });

    test('returns the persisted draft when the candidate was already accepted in storage', async () => {
        const { prisma, tx } = createPrismaMock({
            persistedAcceptance: { draftPostId: 55 },
            noticeMetadata: {
                candidateId: 'cand_001',
                state: 'open',
                summary: 'Should not matter.',
                sourceMessageIds: ['env_a'],
                draftPostId: null,
            },
        });

        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        expect(result).toEqual({
            status: 'existing',
            candidateId: 'cand_001',
            draftPostId: 55,
            created: false,
            ghostDraftGenerationId: null,
        });
        expect(tx.post.create).not.toHaveBeenCalled();
        expect(tx.draftCandidateAcceptance.create).not.toHaveBeenCalled();
        expect(publishDraftCandidateSystemNoticesMock).not.toHaveBeenCalled();
        expect(generateGhostDraftMock).not.toHaveBeenCalled();
    });

    test('returns the latest accepted draft when the newest notice is already accepted', async () => {
        const { prisma, tx } = createPrismaMock({
            noticeMetadata: {
                candidateId: 'cand_001',
                state: 'accepted',
                summary: 'Already accepted.',
                sourceMessageIds: ['env_a'],
                draftPostId: 55,
            },
        });

        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        });

        expect(result).toEqual({
            status: 'existing',
            candidateId: 'cand_001',
            draftPostId: 55,
            created: false,
            ghostDraftGenerationId: null,
        });
        expect(tx.post.create).not.toHaveBeenCalled();
        expect(tx.draftCandidateAcceptance.create).not.toHaveBeenCalled();
        expect(publishDraftCandidateSystemNoticesMock).not.toHaveBeenCalled();
    });

    test('rejects non-manager actors', async () => {
        (requireCircleManagerRoleMock as any).mockResolvedValue(false);
        const { prisma } = createPrismaMock();

        await expect(acceptDraftCandidateIntoDraft(prisma, {
            circleId: 7,
            candidateId: 'cand_001',
            userId: 19,
        })).rejects.toMatchObject({
            statusCode: 403,
            code: 'candidate_generation_forbidden',
        } satisfies Partial<DraftCandidateAcceptanceError>);
    });
});
