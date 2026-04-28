import crypto from 'crypto';

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { MemberStatus } from '@prisma/client';

import { acceptGhostDraftIntoWorkingCopy } from '../acceptance';
import * as draftDiscussionLifecycleService from '../../draftDiscussionLifecycle';
import * as draftWorkflowPermissionsService from '../../policy/draftWorkflowPermissions';

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

describe('ghost draft acceptance', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    test('auto fill applies only when the working copy precondition still matches and the draft is empty', async () => {
        const requestUpdatedAt = new Date('2026-03-24T12:00:00.000Z');
        const persistedUpdatedAt = new Date('2026-03-24T12:01:00.000Z');
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: 'AI baseline',
            heatScore: 9,
            updatedAt: persistedUpdatedAt,
        });
        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(),
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 15,
                    draftPostId: 42,
                    draftText: 'AI baseline',
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(async ({ data }) => ({
                    id: 88,
                    ghostDraftGenerationId: data.ghostDraftGenerationId,
                    draftPostId: data.draftPostId,
                    acceptedByUserId: data.acceptedByUserId,
                    acceptanceMode: data.acceptanceMode,
                    requestWorkingCopyHash: data.requestWorkingCopyHash,
                    requestWorkingCopyUpdatedAt: data.requestWorkingCopyUpdatedAt,
                    resultingWorkingCopyHash: data.resultingWorkingCopyHash,
                    changed: data.changed,
                    acceptedAt: new Date('2026-03-24T12:01:30.000Z'),
                })),
            },
        } as any;

        const result = await acceptGhostDraftIntoWorkingCopy(prisma, {
            draftPostId: 42,
            generationId: 15,
            userId: 8,
            mode: 'auto_fill',
            workingCopyHash: sha256Hex(''),
            workingCopyUpdatedAt: requestUpdatedAt.toISOString(),
        });

        expect(prisma.post.update).not.toHaveBeenCalled();
        expect(prisma.post.updateMany).toHaveBeenCalledWith({
            where: {
                id: 42,
                status: 'Draft',
                updatedAt: requestUpdatedAt,
                text: '',
            },
            data: {
                text: 'AI baseline',
                heatScore: { increment: 5 },
            },
        });
        expect(prisma.ghostDraftAcceptance.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                ghostDraftGenerationId: 15,
                draftPostId: 42,
                acceptedByUserId: 8,
                acceptanceMode: 'auto_fill',
                requestWorkingCopyHash: sha256Hex(''),
                requestWorkingCopyUpdatedAt: requestUpdatedAt,
                changed: true,
            }),
        });
        expect(result).toMatchObject({
            applied: true,
            changed: true,
            workingCopyContent: 'AI baseline',
            workingCopyHash: sha256Hex('AI baseline'),
            heatScore: 9,
            acceptanceMode: 'auto_fill',
            generation: {
                generationId: 15,
            },
        });
    });

    test('precondition mismatch degrades auto fill into a candidate without overwriting working copy', async () => {
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: 'Human revision',
            heatScore: 4,
            updatedAt: new Date('2026-03-24T12:05:00.000Z'),
        });
        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 15,
                    draftPostId: 42,
                    draftText: 'AI baseline',
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(),
            },
        } as any;

        const result = await acceptGhostDraftIntoWorkingCopy(prisma, {
            draftPostId: 42,
            generationId: 15,
            userId: 8,
            mode: 'auto_fill',
            workingCopyHash: sha256Hex(''),
            workingCopyUpdatedAt: '2026-03-24T12:00:00.000Z',
        });

        expect(prisma.post.update).not.toHaveBeenCalled();
        expect(prisma.ghostDraftAcceptance.create).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            applied: false,
            changed: false,
            workingCopyContent: 'Human revision',
            workingCopyHash: sha256Hex('Human revision'),
            heatScore: 4,
            acceptanceId: null,
            acceptanceMode: null,
        });
    });

    test('auto fill degrades to candidate when another edit lands after the precondition check but before the write commits', async () => {
        const requestUpdatedAt = new Date('2026-03-24T12:00:00.000Z');
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: 'Human revision',
            heatScore: 11,
            updatedAt: new Date('2026-03-24T12:00:30.000Z'),
        });
        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(async () => ({
                    id: 42,
                    status: 'Draft',
                    updatedAt: new Date('2026-03-24T12:01:00.000Z'),
                    heatScore: 16,
                })),
                updateMany: jest.fn(async () => ({ count: 0 })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 15,
                    draftPostId: 42,
                    draftText: 'AI baseline',
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(),
            },
        } as any;

        const result = await acceptGhostDraftIntoWorkingCopy(prisma, {
            draftPostId: 42,
            generationId: 15,
            userId: 8,
            mode: 'auto_fill',
            workingCopyHash: sha256Hex(''),
            workingCopyUpdatedAt: requestUpdatedAt.toISOString(),
        });

        expect(prisma.post.update).not.toHaveBeenCalled();
        expect(prisma.post.updateMany).toHaveBeenCalledWith({
            where: {
                id: 42,
                status: 'Draft',
                updatedAt: requestUpdatedAt,
                text: '',
            },
            data: {
                text: 'AI baseline',
                heatScore: { increment: 5 },
            },
        });
        expect(prisma.ghostDraftAcceptance.create).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            applied: false,
            changed: false,
            acceptanceId: null,
            acceptanceMode: null,
            workingCopyContent: 'Human revision',
            workingCopyHash: sha256Hex('Human revision'),
            heatScore: 11,
        });
    });

    test('acceptance writes normalized suggestion text when a historical generation stored think and json wrappers', async () => {
        const requestUpdatedAt = new Date('2026-03-24T12:00:00.000Z');
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '建议先把前10分钟流程压缩成一条连续引导路径。',
            heatScore: 9,
            updatedAt: new Date('2026-03-24T12:01:00.000Z'),
        });

        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(),
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 16,
                    draftPostId: 42,
                    draftText: [
                        '我先整理一下上下文。',
                        '</think>',
                        '{',
                        '  "comment": "建议先把前10分钟流程压缩成一条连续引导路径。",',
                        '  "next_questions": ["负责人由谁确认？"]',
                        '}',
                    ].join('\n'),
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(async ({ data }) => ({
                    id: 89,
                    ghostDraftGenerationId: data.ghostDraftGenerationId,
                    draftPostId: data.draftPostId,
                    acceptedByUserId: data.acceptedByUserId,
                    acceptanceMode: data.acceptanceMode,
                    requestWorkingCopyHash: data.requestWorkingCopyHash,
                    requestWorkingCopyUpdatedAt: data.requestWorkingCopyUpdatedAt,
                    resultingWorkingCopyHash: data.resultingWorkingCopyHash,
                    changed: data.changed,
                    acceptedAt: new Date('2026-03-24T12:01:30.000Z'),
                })),
            },
        } as any;

        const result = await acceptGhostDraftIntoWorkingCopy(prisma, {
            draftPostId: 42,
            generationId: 16,
            userId: 8,
            mode: 'auto_fill',
            workingCopyHash: sha256Hex(''),
            workingCopyUpdatedAt: requestUpdatedAt.toISOString(),
        });

        expect(prisma.post.updateMany).toHaveBeenCalledWith({
            where: {
                id: 42,
                status: 'Draft',
                updatedAt: requestUpdatedAt,
                text: '',
            },
            data: {
                text: '建议先把前10分钟流程压缩成一条连续引导路径。',
                heatScore: { increment: 5 },
            },
        });
        expect(result).toMatchObject({
            applied: true,
            workingCopyContent: '建议先把前10分钟流程压缩成一条连续引导路径。',
            workingCopyHash: sha256Hex('建议先把前10分钟流程压缩成一条连续引导路径。'),
            generation: {
                draftText: '建议先把前10分钟流程压缩成一条连续引导路径。',
            },
        });
    });

    test('accepting a paragraph suggestion writes it into the working copy and moves linked issues into applied', async () => {
        const requestUpdatedAt = new Date('2026-03-24T12:00:00.000Z');
        const currentBody = [
            '第一段：保留结构。',
            '第二段：这里还没有验收人和时间线。',
            '第三段：后续再完善。',
        ].join('\n\n');
        const updatedBody = [
            '第一段：保留结构。',
            '第二段：补上验收人为治理小组，时间线为本周五前完成首轮确认。',
            '第三段：后续再完善。',
        ].join('\n\n');
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: currentBody,
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: currentBody,
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: updatedBody,
            heatScore: 9,
            updatedAt: new Date('2026-03-24T12:01:00.000Z'),
        });

        const proposeSpy = jest.spyOn(draftDiscussionLifecycleService, 'proposeDraftDiscussionThread')
            .mockResolvedValue({
                id: '501',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:3',
                targetVersion: 3,
                issueType: 'knowledge_supplement',
                state: 'proposed',
                createdBy: 5,
                createdAt: '2026-03-24T11:00:00.000Z',
                updatedAt: '2026-03-24T12:01:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: null,
                messages: [],
            } as any);
        const resolveSpy = jest.spyOn(draftDiscussionLifecycleService, 'resolveDraftDiscussionThread')
            .mockResolvedValue({
                id: '501',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:1',
                targetVersion: 3,
                issueType: 'knowledge_supplement',
                state: 'accepted',
                createdBy: 5,
                createdAt: '2026-03-24T11:00:00.000Z',
                updatedAt: '2026-03-24T12:01:10.000Z',
                latestResolution: {
                    resolvedBy: 8,
                    toState: 'accepted',
                    reason: 'Accepted from AI paragraph suggestion',
                    resolvedAt: '2026-03-24T12:01:10.000Z',
                },
                latestApplication: null,
                latestMessage: null,
                messages: [],
            } as any);
        const applySpy = jest.spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread')
            .mockResolvedValue({
                id: '501',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:1',
                targetVersion: 3,
                issueType: 'knowledge_supplement',
                state: 'applied',
                createdBy: 5,
                createdAt: '2026-03-24T11:00:00.000Z',
                updatedAt: '2026-03-24T12:01:10.000Z',
                latestResolution: {
                    resolvedBy: 8,
                    toState: 'accepted',
                    reason: 'Accepted from AI paragraph suggestion',
                    resolvedAt: '2026-03-24T12:01:10.000Z',
                },
                latestApplication: {
                    appliedBy: 8,
                    appliedEditAnchorId: 'd'.repeat(64),
                    appliedSnapshotHash: sha256Hex(updatedBody),
                    appliedDraftVersion: 3,
                    reason: '补上验收人与时间线。',
                    appliedAt: '2026-03-24T12:01:20.000Z',
                },
                latestMessage: null,
                messages: [],
            } as any);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads')
            .mockResolvedValue([
                {
                    id: '501',
                    draftPostId: 42,
                    targetType: 'paragraph',
                    targetRef: 'paragraph:3',
                    targetVersion: 3,
                    issueType: 'knowledge_supplement',
                    state: 'open',
                    createdBy: 5,
                    createdAt: '2026-03-24T11:00:00.000Z',
                    updatedAt: '2026-03-24T11:30:00.000Z',
                    latestResolution: null,
                    latestApplication: null,
                    latestMessage: null,
                    messages: [],
                },
                {
                    id: '502',
                    draftPostId: 42,
                    targetType: 'paragraph',
                    targetRef: 'paragraph:1',
                    targetVersion: 3,
                    issueType: 'question_and_supplement',
                    state: 'proposed',
                    createdBy: 6,
                    createdAt: '2026-03-24T11:10:00.000Z',
                    updatedAt: '2026-03-24T11:40:00.000Z',
                    latestResolution: null,
                    latestApplication: null,
                    latestMessage: null,
                    messages: [],
                },
            ] as any);
        jest.spyOn(draftWorkflowPermissionsService, 'resolveDraftWorkflowPermission')
            .mockResolvedValue({
                allowed: true,
                policy: {} as any,
                minRole: null,
                reasonCode: 'ok',
                reason: 'ok',
            });

        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(),
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Admin',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                })),
            },
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 9,
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 21,
                    draftPostId: 42,
                    draftText: JSON.stringify({
                        suggestions: [
                            {
                                suggestion_id: 'paragraph:1#501',
                                target_type: 'paragraph',
                                target_ref: 'paragraph:1',
                                thread_ids: ['501', '502'],
                                issue_types: ['knowledge_supplement', 'question_and_supplement'],
                                summary: '补上验收人与时间线。',
                                suggested_text: '第二段：补上验收人为治理小组，时间线为本周五前完成首轮确认。',
                            },
                        ],
                    }),
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(async ({ data }) => ({
                    id: 91,
                    ghostDraftGenerationId: data.ghostDraftGenerationId,
                    draftPostId: data.draftPostId,
                    acceptedByUserId: data.acceptedByUserId,
                    acceptanceMode: data.acceptanceMode,
                    requestWorkingCopyHash: data.requestWorkingCopyHash,
                    requestWorkingCopyUpdatedAt: data.requestWorkingCopyUpdatedAt,
                    resultingWorkingCopyHash: data.resultingWorkingCopyHash,
                    changed: data.changed,
                    acceptedAt: new Date('2026-03-24T12:01:30.000Z'),
                })),
            },
        } as any;

        const result = await acceptGhostDraftIntoWorkingCopy(prisma, {
            draftPostId: 42,
            generationId: 21,
            suggestionId: 'paragraph:1#501',
            userId: 8,
            mode: 'accept_suggestion',
            workingCopyHash: sha256Hex(currentBody),
            workingCopyUpdatedAt: requestUpdatedAt.toISOString(),
        } as any);

        expect(prisma.post.update).not.toHaveBeenCalled();
        expect(prisma.post.updateMany).toHaveBeenCalledTimes(1);
        expect(proposeSpy).toHaveBeenCalledWith(prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 501,
            actorUserId: 8,
        }));
        expect(resolveSpy).toHaveBeenCalledTimes(2);
        expect(resolveSpy).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 501,
            actorUserId: 8,
            resolution: 'accepted',
        }));
        expect(resolveSpy).toHaveBeenNthCalledWith(2, prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 502,
            actorUserId: 8,
            resolution: 'accepted',
        }));
        expect(applySpy).toHaveBeenCalledTimes(2);
        expect(applySpy).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 501,
            actorUserId: 8,
            appliedSnapshotHash: sha256Hex(updatedBody),
            appliedDraftVersion: 3,
        }));
        expect(applySpy).toHaveBeenNthCalledWith(2, prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 502,
            actorUserId: 8,
            appliedSnapshotHash: sha256Hex(updatedBody),
            appliedDraftVersion: 3,
        }));
        expect(prisma.ghostDraftAcceptance.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                acceptanceMode: 'accept_suggestion',
                acceptedSuggestionId: 'paragraph:1#501',
                acceptedThreadIds: ['501', '502'],
                requestWorkingCopyHash: sha256Hex(currentBody),
                resultingWorkingCopyHash: sha256Hex(updatedBody),
                changed: true,
            }),
        });
        expect(result).toMatchObject({
            applied: true,
            changed: true,
            acceptanceMode: 'accept_suggestion',
            workingCopyContent: updatedBody,
            acceptedThreadIds: ['501', '502'],
            acceptedSuggestion: {
                suggestionId: 'paragraph:1#501',
                targetRef: 'paragraph:1',
                suggestedText: '第二段：补上验收人为治理小组，时间线为本周五前完成首轮确认。',
            },
        });
    });

    test('accepting a paragraph suggestion is forbidden when the reviewer can resolve issues but cannot apply accepted changes', async () => {
        const requestUpdatedAt = new Date('2026-03-24T12:00:00.000Z');
        const currentBody = [
            '第一段：保留结构。',
            '第二段：这里还没有验收人和时间线。',
            '第三段：后续再完善。',
        ].join('\n\n');
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: currentBody,
            heatScore: 4,
            updatedAt: requestUpdatedAt,
        });

        const resolvePermissionSpy = jest.spyOn(
            draftWorkflowPermissionsService,
            'resolveDraftWorkflowPermission',
        );
        resolvePermissionSpy
            .mockResolvedValueOnce({
                allowed: false,
                policy: {} as any,
                minRole: 'Moderator',
                reasonCode: 'role_required_apply_issue',
                reason: 'Only moderators can apply accepted issues',
            })
            .mockResolvedValueOnce({
                allowed: true,
                policy: {} as any,
                minRole: null,
                reasonCode: 'ok',
                reason: 'ok',
            });

        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(),
                updateMany: jest.fn(),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: MemberStatus.Active,
                    identityLevel: 'Member',
                })),
            },
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 9,
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 21,
                    draftPostId: 42,
                    draftText: JSON.stringify({
                        suggestions: [
                            {
                                suggestion_id: 'paragraph:1#501',
                                target_type: 'paragraph',
                                target_ref: 'paragraph:1',
                                thread_ids: ['501'],
                                issue_types: ['knowledge_supplement'],
                                summary: '补上验收人与时间线。',
                                suggested_text: '第二段：补上验收人为治理小组，时间线为本周五前完成首轮确认。',
                            },
                        ],
                    }),
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(),
            },
        } as any;

        await expect(acceptGhostDraftIntoWorkingCopy(prisma, {
            draftPostId: 42,
            generationId: 21,
            suggestionId: 'paragraph:1#501',
            userId: 8,
            mode: 'accept_suggestion',
            workingCopyHash: sha256Hex(currentBody),
            workingCopyUpdatedAt: requestUpdatedAt.toISOString(),
        } as any)).rejects.toMatchObject({
            statusCode: 403,
            code: 'ghost_draft_apply_permission_denied',
        });

        expect(resolvePermissionSpy).toHaveBeenCalledTimes(1);
        expect(resolvePermissionSpy).toHaveBeenCalledWith(prisma, expect.objectContaining({
            circleId: 7,
            userId: 8,
            action: 'apply_accepted_issue',
        }));
        expect(prisma.post.update).not.toHaveBeenCalled();
        expect(prisma.post.updateMany).not.toHaveBeenCalled();
        expect(prisma.ghostDraftAcceptance.create).not.toHaveBeenCalled();
    });
});
