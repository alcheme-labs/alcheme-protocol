import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const requireCircleManagerRoleMock = jest.fn();
const createDraftVersionSnapshotMock = jest.fn();
const publishDraftCandidateSystemNoticesMock = jest.fn();
const generateGhostDraftMock = jest.fn();

jest.mock('../../membership/checks', () => ({
    requireCircleManagerRole: requireCircleManagerRoleMock,
}));

jest.mock('../../draftLifecycle/versionSnapshots', () => ({
    createDraftVersionSnapshot: createDraftVersionSnapshotMock,
}));

jest.mock('../systemNoticeProducer', () => ({
    publishDraftCandidateSystemNotices: publishDraftCandidateSystemNoticesMock,
}));

jest.mock('../../../ai/ghost-draft', () => ({
    generateGhostDraft: generateGhostDraftMock,
}));

import {
    acceptDraftCandidateIntoDraft,
    DraftCandidateAcceptanceError,
} from '../candidateAcceptance';

function createPrismaMock(input?: {
    circleName?: string;
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
        $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
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
    });

    test('creates a draft owned by the circle creator, persists acceptance, and republishes accepted state', async () => {
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
            candidateId: 'cand_001',
            draftPostId: 88,
            created: true,
            ghostDraftGenerationId: 301,
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
                text: 'Discussion Synthesis Lab\n\nA concise candidate summary.',
            }),
            select: { id: true },
        });
        expect(createDraftVersionSnapshotMock).toHaveBeenCalledWith(tx, {
            draftPostId: 88,
            draftVersion: 1,
            contentSnapshot: 'Discussion Synthesis Lab\n\nA concise candidate summary.',
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
        expect(publishDraftCandidateSystemNoticesMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            summary: 'A concise candidate summary.',
            sourceMessageIds: ['env_a', 'env_b'],
            sourceSemanticFacets: ['problem', 'proposal'],
            sourceAuthorAnnotations: ['emotion'],
            draftPostId: 88,
            triggerReason: 'manual_candidate_acceptance',
        });
        expect(generateGhostDraftMock).toHaveBeenCalledWith(prisma, 88, 41);
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
