import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import * as draftDiscussionLifecycleService from '../draftDiscussionLifecycle';
import * as draftLifecycleService from '../draftLifecycle/readModel';
import {
    resolveDraftBlockReadModel,
    resolveStableDraftReferenceLinkInputs,
} from '../draftBlocks/readModel';

describe('draftBlocks read model', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
    });

    test('derives argument block snapshots and draft reference links from the current draft text using paragraph compatibility ids', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
        } as any;

        jest.spyOn(draftLifecycleService, 'resolveDraftLifecycleReadModel').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'drafting',
            currentSnapshotVersion: 2,
            handoff: {
                candidateId: 'cand_001',
                draftPostId: 42,
                sourceMessageIds: ['env_a', 'env_b'],
                sourceDiscussionLabels: ['fact', 'explanation'],
                lastProposalId: 'gov_777',
                acceptedAt: '2026-03-16T10:00:00.000Z',
            },
            stableSnapshot: {
                draftVersion: 2,
                sourceKind: 'review_bound_snapshot',
                seedDraftAnchorId: 'a'.repeat(64),
                sourceEditAnchorId: 'b'.repeat(64),
                sourceSummaryHash: 'c'.repeat(64),
                sourceMessagesDigest: 'd'.repeat(64),
                contentHash: 'e'.repeat(64),
                createdAt: '2026-03-16T10:30:00.000Z',
            },
            workingCopy: {
                workingCopyId: 'draft:42:working-copy',
                draftPostId: 42,
                basedOnSnapshotVersion: 2,
                workingCopyContent: [
                    'Claim alpha with @crystal(Seed Crystal).',
                    'Explanation beta with @crystal(Seed Crystal#support-block).',
                ].join('\n\n'),
                workingCopyHash: 'f'.repeat(64),
                status: 'active',
                roomKey: 'crucible-42',
                latestEditAnchorId: '1'.repeat(64),
                latestEditAnchorStatus: 'anchored',
                updatedAt: '2026-03-16T10:45:00.000Z',
            },
            reviewBinding: {
                boundSnapshotVersion: 2,
                totalThreadCount: 1,
                openThreadCount: 1,
                proposedThreadCount: 0,
                acceptedThreadCount: 0,
                appliedThreadCount: 0,
                mismatchedApplicationCount: 0,
                latestThreadUpdatedAt: '2026-03-16T10:45:00.000Z',
            },
            warnings: [],
        } as any);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([
            {
                id: 'thread-001',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 2,
                state: 'open',
                createdBy: 77,
                createdAt: '2026-03-16T10:31:00.000Z',
                updatedAt: '2026-03-16T10:44:00.000Z',
                latestResolution: {
                    resolvedBy: 88,
                    toState: 'accepted',
                    reason: 'looks good',
                    resolvedAt: '2026-03-16T10:40:00.000Z',
                },
                latestApplication: {
                    appliedBy: 99,
                    appliedEditAnchorId: '9'.repeat(64),
                    appliedSnapshotHash: '8'.repeat(64),
                    appliedDraftVersion: 2,
                    reason: 'bound into review',
                    appliedAt: '2026-03-16T10:43:00.000Z',
                },
                latestMessage: null,
            },
        ] as any);

        const readModel = await resolveDraftBlockReadModel(prisma, {
            draftPostId: 42,
            viewerUserId: 77,
            temporaryGrants: [
                {
                    blockId: 'paragraph:1',
                    userId: 77,
                    grantedBy: 1,
                    expiresAt: '2026-03-16T12:00:00.000Z',
                },
            ],
            now: '2026-03-16T11:00:00.000Z',
        });

        expect(readModel.draftVersion).toBe(2);
        expect(readModel.blocks).toHaveLength(2);
        expect(readModel.blocks[0]).toMatchObject({
            blockId: 'paragraph:0',
            draftPostId: 42,
            draftVersion: 2,
            legacyTargetType: 'paragraph',
            legacyTargetRef: 'paragraph:0',
            orderIndex: 0,
            sourceMessageIds: ['env_a', 'env_b'],
            discussionThreadIds: ['thread-001'],
            participantUserIds: [9, 77, 88, 99],
            status: 'active',
        });
        expect(readModel.blocks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(readModel.blocks[1]).toMatchObject({
            blockId: 'paragraph:1',
            legacyTargetRef: 'paragraph:1',
            discussionThreadIds: [],
        });

        expect(readModel.referenceLinks).toEqual([
            expect.objectContaining({
                draftPostId: 42,
                draftVersion: 2,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Seed Crystal',
                crystalBlockAnchor: null,
                markerKnowledgeId: null,
                markerRaw: '@crystal(Seed Crystal)',
                status: 'parsed',
            }),
            expect.objectContaining({
                draftPostId: 42,
                draftVersion: 2,
                sourceBlockId: 'paragraph:1',
                crystalName: 'Seed Crystal',
                crystalBlockAnchor: 'support-block',
                markerKnowledgeId: null,
                markerRaw: '@crystal(Seed Crystal#support-block)',
                status: 'parsed',
            }),
        ]);
        expect(readModel.referenceLinks[0].referenceId).toMatch(/^[a-f0-9]{64}$/);

        expect(readModel.viewerPermissions).toEqual([
            expect.objectContaining({
                blockId: 'paragraph:0',
                userId: 77,
                canEdit: true,
                canClaimLease: true,
                permissionSources: ['block_discussion_participant'],
            }),
            expect.objectContaining({
                blockId: 'paragraph:1',
                userId: 77,
                canEdit: true,
                canClaimLease: true,
                permissionSources: ['temporary_grant'],
                temporaryGrantExpiresAt: '2026-03-16T12:00:00.000Z',
            }),
        ]);
    });

    test('gives managers global block edit permission without promoting temporary grant fields to shared contract', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 51,
                    authorId: 19,
                    circleId: 8,
                    status: 'Draft',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Moderator',
                    status: 'Active',
                    identityLevel: 'Visitor',
                })),
            },
        } as any;

        jest.spyOn(draftLifecycleService, 'resolveDraftLifecycleReadModel').mockResolvedValue({
            draftPostId: 51,
            circleId: 8,
            documentStatus: 'drafting',
            currentSnapshotVersion: 1,
            handoff: {
                candidateId: 'cand_051',
                draftPostId: 51,
                sourceMessageIds: ['env_51'],
                sourceDiscussionLabels: ['fact'],
                lastProposalId: 'gov_051',
                acceptedAt: '2026-03-16T09:00:00.000Z',
            },
            stableSnapshot: {
                draftVersion: 1,
                sourceKind: 'accepted_candidate_v1_seed',
                seedDraftAnchorId: null,
                sourceEditAnchorId: null,
                sourceSummaryHash: null,
                sourceMessagesDigest: null,
                contentHash: null,
                createdAt: '2026-03-16T09:00:00.000Z',
            },
            workingCopy: {
                workingCopyId: 'draft:51:working-copy',
                draftPostId: 51,
                basedOnSnapshotVersion: 1,
                workingCopyContent: 'Only paragraph.',
                workingCopyHash: '7'.repeat(64),
                status: 'active',
                roomKey: 'crucible-51',
                latestEditAnchorId: null,
                latestEditAnchorStatus: null,
                updatedAt: '2026-03-16T09:05:00.000Z',
            },
            reviewBinding: {
                boundSnapshotVersion: 1,
                totalThreadCount: 0,
                openThreadCount: 0,
                proposedThreadCount: 0,
                acceptedThreadCount: 0,
                appliedThreadCount: 0,
                mismatchedApplicationCount: 0,
                latestThreadUpdatedAt: null,
            },
            warnings: [],
        } as any);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const readModel = await resolveDraftBlockReadModel(prisma, {
            draftPostId: 51,
            viewerUserId: 201,
            now: '2026-03-16T09:10:00.000Z',
        });

        expect(readModel.viewerPermissions).toEqual([
            expect.objectContaining({
                blockId: 'paragraph:0',
                userId: 201,
                canEdit: true,
                canClaimLease: true,
                canManageGrants: true,
                permissionSources: ['manager_override'],
            }),
        ]);
    });

    test('projects Team 04 consumable DraftReferenceLink inputs using only Checkpoint 2 frozen fields', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 61,
                    authorId: 29,
                    circleId: 11,
                    status: 'Draft',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
        } as any;

        jest.spyOn(draftLifecycleService, 'resolveDraftLifecycleReadModel').mockResolvedValue({
            draftPostId: 61,
            circleId: 11,
            documentStatus: 'drafting',
            currentSnapshotVersion: 3,
            handoff: {
                candidateId: 'cand_061',
                draftPostId: 61,
                sourceMessageIds: ['env_x'],
                sourceDiscussionLabels: ['fact'],
                lastProposalId: 'gov_061',
                acceptedAt: '2026-03-16T13:00:00.000Z',
            },
            stableSnapshot: {
                draftVersion: 3,
                sourceKind: 'review_bound_snapshot',
                seedDraftAnchorId: '3'.repeat(64),
                sourceEditAnchorId: '4'.repeat(64),
                sourceSummaryHash: '5'.repeat(64),
                sourceMessagesDigest: '6'.repeat(64),
                contentHash: '7'.repeat(64),
                createdAt: '2026-03-16T13:05:00.000Z',
            },
            workingCopy: {
                workingCopyId: 'draft:61:working-copy',
                draftPostId: 61,
                basedOnSnapshotVersion: 3,
                workingCopyContent: 'Gamma claim with @crystal(Frozen Crystal#anchor-1){kid=K-source}.',
                workingCopyHash: '8'.repeat(64),
                status: 'active',
                roomKey: 'crucible-61',
                latestEditAnchorId: '9'.repeat(64),
                latestEditAnchorStatus: 'anchored',
                updatedAt: '2026-03-16T13:06:00.000Z',
            },
            reviewBinding: {
                boundSnapshotVersion: 3,
                totalThreadCount: 0,
                openThreadCount: 0,
                proposedThreadCount: 0,
                acceptedThreadCount: 0,
                appliedThreadCount: 0,
                mismatchedApplicationCount: 0,
                latestThreadUpdatedAt: null,
            },
            warnings: [],
        } as any);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const stableInputs = await resolveStableDraftReferenceLinkInputs(prisma, {
            draftPostId: 61,
        });

        expect(stableInputs).toEqual([
            {
                referenceId: expect.stringMatching(/^[a-f0-9]{64}$/),
                draftPostId: 61,
                draftVersion: 3,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Frozen Crystal',
                crystalBlockAnchor: 'anchor-1',
                markerKnowledgeId: 'K-source',
                markerRaw: '@crystal(Frozen Crystal#anchor-1){kid=K-source}',
                status: 'parsed',
            },
        ]);
        expect('linkText' in stableInputs[0]).toBe(false);
    });
});
