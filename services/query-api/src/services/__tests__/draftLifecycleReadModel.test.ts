import crypto from 'crypto';

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import * as collabEditAnchorService from '../collabEditAnchor';
import * as draftAnchorService from '../draftAnchor';
import * as draftDiscussionLifecycleService from '../draftDiscussionLifecycle';
import * as policyProfileService from '../policy/profile';
import * as versionSnapshotService from '../draftLifecycle/versionSnapshots';
import * as workflowStateService from '../draftLifecycle/workflowState';
import { computePolicyProfileDigest } from '../policy/digest';
import {
    advanceDraftLifecycleReview as advanceDraftLifecycleReviewReadModel,
    archiveDraftLifecycle as archiveDraftLifecycleReadModel,
    enterDraftLifecycleCrystallization as enterDraftLifecycleCrystallizationReadModel,
    enterDraftLifecycleReview as enterDraftLifecycleReviewReadModel,
    failDraftLifecycleCrystallization as failDraftLifecycleCrystallizationReadModel,
    loadAcceptedCandidateHandoffForDraftPost,
    restoreDraftLifecycle as restoreDraftLifecycleReadModel,
    retryDraftLifecycleCrystallization as retryDraftLifecycleCrystallizationReadModel,
    rollbackDraftLifecycleCrystallizationFailure as rollbackDraftLifecycleCrystallizationFailureReadModel,
    resolveDraftLifecycleReadModel,
} from '../draftLifecycle/readModel';
import { processDueDraftWorkflowTransitions } from '../draftLifecycle/workflowState';

function makeAcceptedNoticeRow(overrides: Record<string, unknown> = {}) {
    const createdAt = overrides.createdAt instanceof Date
        ? overrides.createdAt
        : new Date('2026-03-16T10:00:00.000Z');
    const metadataOverrides = { ...overrides };
    delete metadataOverrides.createdAt;

    return {
        messageKind: 'governance_notice',
        metadata: {
            candidateId: 'cand_001',
            state: 'accepted',
            draftPostId: 42,
            sourceMessageIds: ['env_a', 'env_b'],
            sourceDiscussionLabels: ['fact', 'emotion'],
            lastProposalId: 'gov_777',
            ...metadataOverrides,
        },
        createdAt,
    };
}

function makePost(overrides: Record<string, unknown> = {}) {
    return {
        id: 42,
        authorId: 9,
        circleId: 7,
        text: 'Draft body v1',
        status: 'Draft',
        createdAt: new Date('2026-03-16T09:55:00.000Z'),
        updatedAt: new Date('2026-03-16T10:05:00.000Z'),
        ...overrides,
    };
}

function makeCircleRow() {
    return {
        id: 7,
        level: 1,
        parentCircleId: null,
        createdAt: new Date('2026-03-16T07:00:00.000Z'),
        joinRequirement: 'Free',
        circleType: 'Open',
        minCrystals: 0,
    };
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function parseTestDateValue(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const normalized = value.includes('T')
            ? value
            : `${value.replace(' ', 'T')}Z`;
        const parsed = new Date(normalized);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

function createWorkflowStatePrisma(input?: {
    post?: Record<string, unknown>;
    noticeRows?: unknown[];
}) {
    let workflowStateRow: any = null;
    let versionSnapshotRows: any[] = [];
    const noticeRows = input?.noticeRows || [makeAcceptedNoticeRow()];

    const prisma: any = {
        post: {
            findUnique: jest.fn(async () => makePost(input?.post)),
        },
        circle: {
            findUnique: jest.fn(async () => makeCircleRow()),
        },
        $queryRaw: jest.fn(async (query: any) => {
            const sql = String(query?.strings?.join(' ') || '');
            if (sql.includes('INSERT INTO draft_version_snapshots')) {
                const values = query?.values || [];
                const nextRow = {
                    draftPostId: Number(values[0]),
                    draftVersion: Number(values[1]),
                    contentSnapshot: values[2],
                    contentHash: values[3],
                    createdFromState: values[4],
                    createdBy: values[5] ?? null,
                    sourceEditAnchorId: values[6] ?? null,
                    sourceSummaryHash: values[7] ?? null,
                    sourceMessagesDigest: values[8] ?? null,
                    createdAt: new Date('2026-03-16T08:30:00.000Z'),
                };
                if (!versionSnapshotRows.some((row) =>
                    row.draftPostId === nextRow.draftPostId
                    && row.draftVersion === nextRow.draftVersion,
                )) {
                    versionSnapshotRows = [...versionSnapshotRows, nextRow];
                    return [nextRow];
                }
                return [];
            }
            if (sql.includes('circle_discussion_messages')) {
                return noticeRows;
            }
            if (
                sql.includes('FROM draft_workflow_state')
                && sql.includes("review_entry_mode <> 'manual_only'")
                && sql.includes('drafting_ends_at <=')
            ) {
                const now = parseTestDateValue(query?.values?.[0]) || new Date();
                const limit = Number(query?.values?.[1] || 100);
                if (
                    workflowStateRow
                    && workflowStateRow.documentStatus === 'drafting'
                    && workflowStateRow.reviewEntryMode !== 'manual_only'
                    && workflowStateRow.draftingEndsAt instanceof Date
                    && workflowStateRow.draftingEndsAt.getTime() <= now.getTime()
                ) {
                    return [workflowStateRow].slice(0, limit);
                }
                return [];
            }
            if (sql.includes('draft_workflow_state')) {
                return workflowStateRow ? [workflowStateRow] : [];
            }
            if (sql.includes('FROM draft_version_snapshots')) {
                const draftPostId = Number(query?.values?.[0]);
                const draftVersion = Number(query?.values?.[1]);
                return versionSnapshotRows.filter((row) =>
                    row.draftPostId === draftPostId
                    && row.draftVersion === draftVersion,
                );
            }
            return [];
        }),
        $executeRaw: jest.fn(async (query: any) => {
            const sql = String(query?.strings?.join(' ') || '');
            const values = query?.values || [];
            if (sql.includes('INSERT INTO draft_workflow_state')) {
                workflowStateRow = {
                    draftPostId: values[0],
                    circleId: values[1],
                    documentStatus: 'drafting',
                    currentSnapshotVersion: 1,
                    currentRound: 1,
                    reviewEntryMode: values[2],
                    draftingStartedAt: parseTestDateValue(values[3]),
                    draftingEndsAt: parseTestDateValue(values[4]),
                    reviewStartedAt: null,
                    reviewEndsAt: null,
                    reviewWindowExpiredAt: null,
                    transitionMode: 'seeded',
                    lastTransitionAt: parseTestDateValue(values[8]),
                    lastTransitionBy: values[9] ?? null,
                    createdAt: parseTestDateValue(values[3]),
                    updatedAt: parseTestDateValue(values[3]),
                };
                return 1;
            }
            if (sql.includes('UPDATE draft_discussion_threads') && sql.includes('SET target_version =')) {
                return 1;
            }
            if (sql.includes('UPDATE draft_workflow_state')) {
                if (sql.includes("document_status = 'archived'") && sql.includes("transition_mode = 'archived'")) {
                    const draftPostId = Number(values[values.length - 1]);
                    if (!workflowStateRow || workflowStateRow.draftPostId !== draftPostId) {
                        return 0;
                    }
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'archived',
                        draftingEndsAt: null,
                        reviewEndsAt: null,
                        reviewWindowExpiredAt: null,
                        transitionMode: 'archived',
                        lastTransitionAt: parseTestDateValue(values[0]),
                        lastTransitionBy: values[1],
                        updatedAt: parseTestDateValue(values[0]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'drafting'") && sql.includes("document_status = 'archived'")) {
                    const draftPostId = Number(values[values.length - 1]);
                    if (!workflowStateRow || workflowStateRow.draftPostId !== draftPostId || workflowStateRow.documentStatus !== 'archived') {
                        return 0;
                    }
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'drafting',
                        currentRound: Number(workflowStateRow.currentRound || 1) + 1,
                        draftingStartedAt: parseTestDateValue(values[0]),
                        draftingEndsAt: parseTestDateValue(values[1]),
                        reviewStartedAt: null,
                        reviewEndsAt: null,
                        reviewWindowExpiredAt: null,
                        transitionMode: 'manual_extend',
                        lastTransitionAt: parseTestDateValue(values[4]),
                        lastTransitionBy: values[5],
                        updatedAt: parseTestDateValue(values[4]),
                    };
                    return 1;
                }
                const draftPostId = Number(values[values.length - 1]);
                if (!workflowStateRow || workflowStateRow.draftPostId !== draftPostId || workflowStateRow.documentStatus !== 'drafting') {
                    return 0;
                }
                workflowStateRow = {
                    ...workflowStateRow,
                    documentStatus: 'review',
                    currentSnapshotVersion: values[0],
                    reviewStartedAt: parseTestDateValue(values[1]),
                    reviewEndsAt: parseTestDateValue(values[2]),
                    reviewWindowExpiredAt: parseTestDateValue(values[3]),
                    transitionMode: values[4],
                    lastTransitionAt: parseTestDateValue(values[5]),
                    lastTransitionBy: values[6],
                    updatedAt: parseTestDateValue(values[1]),
                };
                return 1;
            }
            return 0;
        }),
        $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };

    return prisma;
}

describe('draftLifecycle read model', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile').mockResolvedValue({
            circleId: 7,
            sourceType: 'circle_override',
            inheritanceMode: 'independent',
            inheritsFromProfileId: null,
            inheritsFromCircleId: null,
            draftGenerationPolicy: {} as any,
            draftLifecycleTemplate: {
                templateId: 'fast_deposition',
                draftGenerationVotingMinutes: 10,
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 240,
                maxRevisionRounds: 1,
                reviewEntryMode: 'auto_or_manual',
            } as any,
            blockEditEligibilityPolicy: {} as any,
            forkPolicy: {} as any,
            ghostPolicy: {} as any,
            localEditability: 'editable',
            effectiveFrom: new Date('2026-03-16T07:00:00.000Z'),
            resolvedFromProfileVersion: null,
            configVersion: 1,
        } as any);
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockImplementation(async (_prisma, input) => {
            const seed = new Date(input.seedStartedAt);
            const draftingEndsAt = new Date(seed.getTime() + ((input.template?.draftingWindowMinutes || 30) * 60 * 1000));
            return {
                draftPostId: input.draftPostId,
                circleId: input.circleId,
                documentStatus: 'drafting',
                currentSnapshotVersion: 1,
                currentRound: 1,
                reviewEntryMode: input.template?.reviewEntryMode || 'auto_or_manual',
                draftingStartedAt: seed.toISOString(),
                draftingEndsAt: draftingEndsAt.toISOString(),
                reviewStartedAt: null,
                reviewEndsAt: null,
                reviewWindowExpiredAt: null,
                crystallizationPolicyProfileDigest: null,
                crystallizationAnchorSignature: null,
                transitionMode: 'seeded',
                lastTransitionAt: seed.toISOString(),
                lastTransitionBy: null,
            };
        });
    });

    test('loads accepted handoff only through narrowed backend adapter', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async () => ([
                makeAcceptedNoticeRow({
                    candidateId: 'cand_open',
                    state: 'proposal_active',
                }),
                makeAcceptedNoticeRow({
                    candidateId: 'cand_accepted',
                    sourceMessageIds: ['env_b', 'env_a', 'env_b'],
                    sourceDiscussionLabels: ['emotion', 'fact', 'invalid'],
                    governanceCandidateStatus: 'executed',
                    canRollback: true,
                }),
            ])),
        } as any;

        const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, 42);

        expect(handoff).toEqual({
            candidateId: 'cand_accepted',
            draftPostId: 42,
            sourceMessageIds: ['env_b', 'env_a'],
            sourceSemanticFacets: ['fact', 'emotion'],
            sourceAuthorAnnotations: [],
            lastProposalId: 'gov_777',
            acceptedAt: '2026-03-16T10:00:00.000Z',
        });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    test('recovers accepted handoff from succeeded generation attempt when the accepted notice is missing', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [];
                }
                if (sql.includes('draft_candidate_generation_attempts')) {
                    return [{
                        candidateId: 'cand_attempt',
                        draftPostId: 42,
                        sourceMessageIds: ['env_c', 'env_a', 'env_c'],
                        sourceSemanticFacets: ['proposal', 'fact', 'invalid'],
                        sourceAuthorAnnotations: ['explanation', 'unknown'],
                        lastProposalId: 'gov_attempt',
                        acceptedAt: new Date('2026-03-16T09:56:00.000Z'),
                    }];
                }
                return [];
            }),
        } as any;

        const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, 42);

        expect(handoff).toEqual({
            candidateId: 'cand_attempt',
            draftPostId: 42,
            sourceMessageIds: ['env_c', 'env_a'],
            sourceSemanticFacets: ['fact', 'proposal'],
            sourceAuthorAnnotations: ['explanation'],
            lastProposalId: 'gov_attempt',
            acceptedAt: '2026-03-16T09:56:00.000Z',
        });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    test('uses the draft post creation time when accepted notice timestamps are clearly skewed', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost({
                    createdAt: new Date('2026-04-10T20:41:55.489Z'),
                })),
            },
            $queryRaw: jest.fn(async () => ([
                makeAcceptedNoticeRow({
                    createdAt: new Date('2026-04-11T04:41:56.099Z'),
                }),
            ])),
        } as any;

        const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, 42);

        expect(handoff?.acceptedAt).toBe('2026-04-10T20:41:55.489Z');
    });

    test.each([
        {
            label: 'enter review',
            wrapper: enterDraftLifecycleReviewReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'enterDraftLifecycleReview'),
            input: {},
        },
        {
            label: 'advance review',
            wrapper: advanceDraftLifecycleReviewReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'advanceDraftLifecycleFromReview'),
            input: {},
        },
        {
            label: 'enter crystallization',
            wrapper: enterDraftLifecycleCrystallizationReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'enterDraftLifecycleCrystallization'),
            input: {
                anchorSignature: 'sig_enter_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        },
        {
            label: 'fail crystallization',
            wrapper: failDraftLifecycleCrystallizationReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'failDraftLifecycleCrystallization'),
            input: {},
        },
        {
            label: 'retry crystallization',
            wrapper: retryDraftLifecycleCrystallizationReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'retryDraftLifecycleCrystallization'),
            input: {
                anchorSignature: 'sig_retry_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        },
        {
            label: 'rollback crystallization failure',
            wrapper: rollbackDraftLifecycleCrystallizationFailureReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'rollbackDraftLifecycleCrystallizationFailure'),
            input: {},
        },
        {
            label: 'archive lifecycle',
            wrapper: archiveDraftLifecycleReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'archiveDraftLifecycle'),
            input: { anchorSignature: 'sig_archive_001' },
        },
        {
            label: 'restore lifecycle',
            wrapper: restoreDraftLifecycleReadModel as any,
            createSpy: () => jest.spyOn(workflowStateService, 'restoreDraftLifecycle'),
            input: { anchorSignature: 'sig_restore_001' },
        },
    ])('passes circle workflow context through the $label mutation wrapper', async ({ wrapper, createSpy, input }) => {
        const prismaForMutationWrapperTest = {
            post: {
                findUnique: jest.fn(async () => makePost({
                    circleId: 7,
                    createdAt: new Date('2026-03-16T09:55:00.000Z'),
                })),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow({
                        createdAt: new Date('2026-03-16T10:00:00.000Z'),
                    })];
                }
                return [];
            }),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const transitionSpy = createSpy()
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 1,
                currentRound: 1,
                reviewEntryMode: 'manual_only',
                draftingStartedAt: '2026-03-16T10:00:00.000Z',
                draftingEndsAt: '2026-03-16T10:30:00.000Z',
                reviewStartedAt: '2026-03-16T10:40:00.000Z',
                reviewEndsAt: '2026-03-16T14:40:00.000Z',
                reviewWindowExpiredAt: null,
                transitionMode: 'manual_lock',
                lastTransitionAt: '2026-03-16T10:40:00.000Z',
                lastTransitionBy: 9,
            } as any);

        await wrapper(prismaForMutationWrapperTest, {
            draftPostId: 42,
            actorUserId: 9,
            now: '2026-03-16T10:40:00.000Z',
            ...input,
        });

        expect(transitionSpy).toHaveBeenCalledWith(prismaForMutationWrapperTest, expect.objectContaining({
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template: expect.objectContaining({
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 240,
                maxRevisionRounds: 1,
                reviewEntryMode: 'auto_or_manual',
            }),
            seedStartedAt: new Date('2026-03-16T10:00:00.000Z'),
        }));
    });

    test('legacy accepted AI suggestion applications still require explicit confirmation before review advance', async () => {
        const beforeText = '第一段：原始内容。';
        const afterText = '第一段：AI 已根据问题线程补充了限定条件。';
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost({
                    text: afterText,
                    updatedAt: new Date('2026-03-16T12:02:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                findMany: jest.fn(async () => ([
                    {
                        id: 91,
                        acceptanceMode: 'accept_suggestion',
                        requestWorkingCopyHash: sha256Hex(beforeText),
                        resultingWorkingCopyHash: sha256Hex(afterText),
                        acceptedThreadIds: ['501'],
                        changed: true,
                        acceptedAt: new Date('2026-03-16T12:01:30.000Z'),
                    },
                ])),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([
            {
                id: '501',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 1,
                issueType: 'knowledge_supplement',
                state: 'accepted',
                createdBy: 11,
                createdAt: '2026-03-16T11:00:00.000Z',
                updatedAt: '2026-03-16T12:00:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: null,
                messages: [],
            },
        ] as any);
        const advanceSpy = jest.spyOn(workflowStateService, 'advanceDraftLifecycleFromReview')
            .mockResolvedValue({} as any);

        await expect(advanceDraftLifecycleReviewReadModel(prisma, {
            draftPostId: 42,
            actorUserId: 9,
        } as any)).rejects.toMatchObject({
            code: 'draft_review_apply_confirmation_required',
            statusCode: 409,
            pendingThreadIds: ['501'],
            pendingThreadCount: 1,
        });

        expect(advanceSpy).not.toHaveBeenCalled();
    });

    test('legacy accepted AI suggestion applications can still be chained into review advance after confirmation', async () => {
        const initialText = '第一段：原始内容。\n\n第二段：原始内容。';
        const afterFirstSuggestion = '第一段：补上上下文限定。\n\n第二段：原始内容。';
        const afterSecondSuggestion = '第一段：补上上下文限定。\n\n第二段：补上时间线和责任人。';
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost({
                    text: afterSecondSuggestion,
                    updatedAt: new Date('2026-03-16T12:04:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                findMany: jest.fn(async () => ([
                    {
                        id: 92,
                        acceptanceMode: 'accept_suggestion',
                        requestWorkingCopyHash: sha256Hex(afterFirstSuggestion),
                        resultingWorkingCopyHash: sha256Hex(afterSecondSuggestion),
                        acceptedThreadIds: ['502'],
                        changed: true,
                        acceptedAt: new Date('2026-03-16T12:03:30.000Z'),
                    },
                    {
                        id: 91,
                        acceptanceMode: 'accept_suggestion',
                        requestWorkingCopyHash: sha256Hex(initialText),
                        resultingWorkingCopyHash: sha256Hex(afterFirstSuggestion),
                        acceptedThreadIds: ['501'],
                        changed: true,
                        acceptedAt: new Date('2026-03-16T12:01:30.000Z'),
                    },
                ])),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([
            {
                id: '501',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 1,
                issueType: 'knowledge_supplement',
                state: 'accepted',
                createdBy: 11,
                createdAt: '2026-03-16T11:00:00.000Z',
                updatedAt: '2026-03-16T12:00:00.000Z',
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
                targetVersion: 1,
                issueType: 'question_and_supplement',
                state: 'accepted',
                createdBy: 12,
                createdAt: '2026-03-16T11:10:00.000Z',
                updatedAt: '2026-03-16T12:03:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: null,
                messages: [],
            },
        ] as any);
        const applySpy = jest.spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread')
            .mockResolvedValue({} as any);
        const advanceSpy = jest.spyOn(workflowStateService, 'advanceDraftLifecycleFromReview')
            .mockResolvedValue({} as any);

        await advanceDraftLifecycleReviewReadModel(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            confirmApplyAcceptedGhostThreads: true,
        } as any);

        expect(applySpy).toHaveBeenCalledTimes(2);
        expect(applySpy).toHaveBeenNthCalledWith(1, prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 501,
            actorUserId: 9,
            appliedSnapshotHash: sha256Hex(afterFirstSuggestion),
            appliedDraftVersion: 1,
        }));
        expect(applySpy).toHaveBeenNthCalledWith(2, prisma, expect.objectContaining({
            draftPostId: 42,
            threadId: 502,
            actorUserId: 9,
            appliedSnapshotHash: sha256Hex(afterSecondSuggestion),
            appliedDraftVersion: 1,
        }));
        expect(advanceSpy).toHaveBeenCalledTimes(1);
    });

    test('legacy queued accepted ghost suggestions can still be carried into the next drafting round before transition', async () => {
        const beforeText = [
            '第一段：原始内容。',
            '',
            '第二段：原始内容。',
            '',
            '第三段：',
            '1. 保持原样',
            '2. 这一段的格式不应该被压平',
        ].join('\n');
        const afterText = [
            '第一段：补上上下文限定。',
            '',
            '第二段：原始内容。',
            '',
            '第三段：',
            '1. 保持原样',
            '2. 这一段的格式不应该被压平',
        ].join('\n');
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce(makePost({
            text: beforeText,
            updatedAt: new Date('2026-03-16T12:00:00.000Z'),
            heatScore: 4,
        }));
        postFindUnique.mockResolvedValueOnce(makePost({
            text: beforeText,
            updatedAt: new Date('2026-03-16T12:00:00.000Z'),
            heatScore: 4,
        }));
        postFindUnique.mockResolvedValueOnce(makePost({
            text: beforeText,
            updatedAt: new Date('2026-03-16T12:00:00.000Z'),
            heatScore: 4,
        }));
        postFindUnique.mockResolvedValueOnce(makePost({
            text: beforeText,
            updatedAt: new Date('2026-03-16T12:00:00.000Z'),
            heatScore: 4,
        }));
        postFindUnique.mockResolvedValueOnce(makePost({
            text: afterText,
            updatedAt: new Date('2026-03-16T12:03:00.000Z'),
            heatScore: 9,
        }));
        postFindUnique.mockResolvedValueOnce(makePost({
            text: afterText,
            updatedAt: new Date('2026-03-16T12:03:00.000Z'),
            heatScore: 9,
        }));
        const prisma = {
            post: {
                findUnique: postFindUnique,
                updateMany: jest.fn(async () => ({ count: 1 })),
            },
            ghostDraftAcceptance: {
                findMany: jest.fn(async () => ([
                    {
                        id: 91,
                        acceptanceMode: 'accept_suggestion',
                        acceptedSuggestionId: 'paragraph:0#501',
                        acceptedThreadIds: ['501'],
                        requestWorkingCopyHash: sha256Hex(beforeText),
                        resultingWorkingCopyHash: sha256Hex(beforeText),
                        changed: false,
                        acceptedAt: new Date('2026-03-16T12:01:30.000Z'),
                        generation: {
                            id: 17,
                            draftPostId: 42,
                            draftText: JSON.stringify({
                                suggestions: [
                                    {
                                        suggestion_id: 'paragraph:0#501',
                                        target_type: 'paragraph',
                                        target_ref: 'paragraph:0',
                                        thread_ids: ['501'],
                                        issue_types: ['knowledge_supplement'],
                                        summary: '补上上下文限定。',
                                        suggested_text: '第一段：补上上下文限定。',
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
                            createdAt: new Date('2026-03-16T12:00:30.000Z'),
                        },
                    },
                ])),
                update: jest.fn(async () => ({})),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([
            {
                id: '501',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 1,
                issueType: 'knowledge_supplement',
                state: 'accepted',
                createdBy: 11,
                createdAt: '2026-03-16T11:00:00.000Z',
                updatedAt: '2026-03-16T12:00:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: null,
                messages: [],
            },
        ] as any);
        const advanceSpy = jest.spyOn(workflowStateService, 'advanceDraftLifecycleFromReview')
            .mockResolvedValue({} as any);

        await advanceDraftLifecycleReviewReadModel(prisma, {
            draftPostId: 42,
            actorUserId: 9,
        } as any);

        expect(prisma.post.updateMany).toHaveBeenCalledWith({
            where: {
                id: 42,
                status: 'Draft',
                updatedAt: new Date('2026-03-16T12:00:00.000Z'),
                text: beforeText,
            },
            data: {
                text: afterText,
                heatScore: { increment: 5 },
            },
        });
        expect(prisma.ghostDraftAcceptance.update).toHaveBeenCalledWith({
            where: { id: 91 },
            data: {
                requestWorkingCopyHash: sha256Hex(beforeText),
                resultingWorkingCopyHash: sha256Hex(afterText),
                changed: true,
            },
        });
        expect(advanceSpy).toHaveBeenCalledTimes(1);
    });

    test('builds v1 seed snapshot and active working copy from accepted handoff', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue({
            anchorId: 'a'.repeat(64),
            summaryHash: 'b'.repeat(64),
            messagesDigest: 'c'.repeat(64),
            status: 'anchored',
            createdAt: '2026-03-16T10:00:30.000Z',
        } as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([
            {
                anchorId: 'd'.repeat(64),
                snapshotHash: 'e'.repeat(64),
                status: 'anchored',
                createdAt: '2026-03-16T10:05:00.000Z',
                updatedAt: '2026-03-16T10:05:00.000Z',
                roomKey: 'crucible-42',
            },
        ] as any);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });

        expect(lifecycle.documentStatus).toBe('drafting');
        expect(lifecycle.currentSnapshotVersion).toBe(1);
        expect(lifecycle.handoff).toMatchObject({
            candidateId: 'cand_001',
            draftPostId: 42,
        });
        expect(lifecycle.stableSnapshot).toMatchObject({
            draftVersion: 1,
            sourceKind: 'accepted_candidate_v1_seed',
            seedDraftAnchorId: 'a'.repeat(64),
            sourceSummaryHash: 'b'.repeat(64),
            sourceMessagesDigest: 'c'.repeat(64),
        });
        expect(lifecycle.workingCopy).toMatchObject({
            draftPostId: 42,
            basedOnSnapshotVersion: 1,
            status: 'active',
            roomKey: 'crucible-42',
            latestEditAnchorId: 'd'.repeat(64),
        });
        expect(lifecycle.workingCopy.workingCopyHash).toMatch(/^[a-f0-9]{64}$/);
        expect(lifecycle.reviewBinding).toMatchObject({
            boundSnapshotVersion: 1,
            totalThreadCount: 0,
            mismatchedApplicationCount: 0,
        });
    });

    test('prefers a persisted v1 snapshot over reconstructed seed fallback', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(versionSnapshotService, 'loadDraftVersionSnapshot').mockResolvedValue({
            draftPostId: 42,
            draftVersion: 1,
            contentSnapshot: 'Draft body v1',
            contentHash: 'f'.repeat(64),
            createdFromState: 'drafting',
            createdBy: 9,
            sourceEditAnchorId: null,
            sourceSummaryHash: 'b'.repeat(64),
            sourceMessagesDigest: 'c'.repeat(64),
            createdAt: '2026-03-16T10:00:30.000Z',
        });
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue({
            anchorId: 'a'.repeat(64),
            summaryHash: 'b'.repeat(64),
            messagesDigest: 'c'.repeat(64),
            status: 'anchored',
            createdAt: '2026-03-16T10:00:30.000Z',
        } as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });

        expect(lifecycle.stableSnapshot).toMatchObject({
            draftVersion: 1,
            sourceKind: 'accepted_candidate_v1_seed',
            contentHash: 'f'.repeat(64),
            createdAt: '2026-03-16T10:00:30.000Z',
        });
    });

    test('prefers the persisted crystallization milestone digest over a newly recomputed live policy digest', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'crystallization_active',
            currentSnapshotVersion: 2,
            currentRound: 1,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T10:00:00.000Z',
            draftingEndsAt: null,
            reviewStartedAt: '2026-03-16T10:10:00.000Z',
            reviewEndsAt: '2026-03-16T11:10:00.000Z',
            reviewWindowExpiredAt: null,
            crystallizationPolicyProfileDigest: 'f'.repeat(64),
            crystallizationAnchorSignature: '5'.repeat(88),
            transitionMode: 'enter_crystallization',
            lastTransitionAt: '2026-03-16T11:00:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(versionSnapshotService, 'loadDraftVersionSnapshot').mockResolvedValue({
            draftPostId: 42,
            draftVersion: 2,
            contentSnapshot: 'Draft body v2',
            contentHash: 'e'.repeat(64),
            createdFromState: 'drafting',
            createdBy: 9,
            sourceEditAnchorId: 'd'.repeat(64),
            sourceSummaryHash: 'b'.repeat(64),
            sourceMessagesDigest: 'c'.repeat(64),
            createdAt: '2026-03-16T10:30:30.000Z',
        });
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue({
            anchorId: 'a'.repeat(64),
            summaryHash: 'b'.repeat(64),
            messagesDigest: 'c'.repeat(64),
            status: 'anchored',
            createdAt: '2026-03-16T10:00:30.000Z',
        } as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });

        expect(lifecycle.policyProfileDigest).toBe('f'.repeat(64));
    });

    test('returns the live policy digest again after a crystallization failure is rolled back to review', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'review',
            currentSnapshotVersion: 2,
            currentRound: 1,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T10:00:00.000Z',
            draftingEndsAt: null,
            reviewStartedAt: '2026-03-16T10:10:00.000Z',
            reviewEndsAt: '2026-03-16T11:10:00.000Z',
            reviewWindowExpiredAt: null,
            crystallizationPolicyProfileDigest: 'f'.repeat(64),
            crystallizationAnchorSignature: '5'.repeat(88),
            transitionMode: 'rollback_to_review',
            lastTransitionAt: '2026-03-16T11:00:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(versionSnapshotService, 'loadDraftVersionSnapshot').mockResolvedValue({
            draftPostId: 42,
            draftVersion: 2,
            contentSnapshot: 'Draft body v2',
            contentHash: 'e'.repeat(64),
            createdFromState: 'drafting',
            createdBy: 9,
            sourceEditAnchorId: 'd'.repeat(64),
            sourceSummaryHash: 'b'.repeat(64),
            sourceMessagesDigest: 'c'.repeat(64),
            createdAt: '2026-03-16T10:30:30.000Z',
        });
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue({
            anchorId: 'a'.repeat(64),
            summaryHash: 'b'.repeat(64),
            messagesDigest: 'c'.repeat(64),
            status: 'anchored',
            createdAt: '2026-03-16T10:00:30.000Z',
        } as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });
        const livePolicyDigest = computePolicyProfileDigest(
            policyProfileService.buildPublicPolicyDigestSnapshot(await policyProfileService.resolveCirclePolicyProfile(prisma, 7)),
        );

        expect(lifecycle.policyProfileDigest).toBe(livePolicyDigest);
        expect(lifecycle.policyProfileDigest).not.toBe('f'.repeat(64));
    });

    test('returns lifecycle with missing-source state when draft has no accepted candidate handoff', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async () => ([])),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });

        expect(lifecycle.handoff).toBeNull();
        expect(lifecycle.stableSnapshot).toMatchObject({
            draftVersion: 1,
            sourceKind: null,
            seedDraftAnchorId: null,
            sourceSummaryHash: null,
            sourceMessagesDigest: null,
        });
        expect(lifecycle.warnings).toContain(
            'draft source handoff is missing; treating candidate source as unavailable for this draft',
        );
    });

    test('binds review threads to stable snapshot version while keeping appliedDraftVersion as evidence only', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost({
                    text: 'Working copy advanced beyond seed',
                    updatedAt: new Date('2026-03-16T12:00:00.000Z'),
                })),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue({
            anchorId: 'a'.repeat(64),
            summaryHash: 'b'.repeat(64),
            messagesDigest: 'c'.repeat(64),
            status: 'anchored',
            createdAt: '2026-03-16T10:00:30.000Z',
        } as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'review',
            currentSnapshotVersion: 2,
            currentRound: 1,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T10:00:00.000Z',
            draftingEndsAt: '2026-03-16T10:30:00.000Z',
            reviewStartedAt: '2026-03-16T10:31:00.000Z',
            reviewEndsAt: '2026-03-16T14:31:00.000Z',
            reviewWindowExpiredAt: null,
            transitionMode: 'manual_lock',
            lastTransitionAt: '2026-03-16T10:31:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([
            {
                id: 'thread-2',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 2,
                state: 'accepted',
                createdBy: 11,
                createdAt: '2026-03-16T11:00:00.000Z',
                updatedAt: '2026-03-16T11:30:00.000Z',
                latestResolution: {
                    resolvedBy: 12,
                    toState: 'accepted',
                    reason: 'ship this round',
                    resolvedAt: '2026-03-16T11:20:00.000Z',
                },
                latestApplication: {
                    appliedBy: 12,
                    appliedEditAnchorId: 'f'.repeat(64),
                    appliedSnapshotHash: '1'.repeat(64),
                    appliedDraftVersion: 99,
                    reason: 'sealed in review',
                    appliedAt: '2026-03-16T11:25:00.000Z',
                },
                latestMessage: null,
            },
        ] as any);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });

        expect(lifecycle.currentSnapshotVersion).toBe(2);
        expect(lifecycle.stableSnapshot).toMatchObject({
            draftVersion: 2,
            sourceKind: 'review_bound_snapshot',
            contentHash: '1'.repeat(64),
            sourceEditAnchorId: 'f'.repeat(64),
        });
        expect(lifecycle.workingCopy.basedOnSnapshotVersion).toBe(2);
        expect(lifecycle.reviewBinding).toMatchObject({
            boundSnapshotVersion: 2,
            totalThreadCount: 1,
            acceptedThreadCount: 1,
            mismatchedApplicationCount: 1,
        });
        expect(lifecycle.warnings).toContain(
            'draft discussion application evidence uses legacy appliedDraftVersion values and may not match the current stable snapshot evidence',
        );
    });

    test('does not let thread targetVersion forge a future stable snapshot version', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => makePost()),
            },
            $queryRaw: jest.fn(async (query: any) => {
                const sql = String(query?.strings?.join(' ') || '');
                if (sql.includes('circle_discussion_messages')) {
                    return [makeAcceptedNoticeRow()];
                }
                return [];
            }),
        } as any;

        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'review',
            currentSnapshotVersion: 2,
            currentRound: 1,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T10:00:00.000Z',
            draftingEndsAt: '2026-03-16T10:30:00.000Z',
            reviewStartedAt: '2026-03-16T10:31:00.000Z',
            reviewEndsAt: '2026-03-16T14:31:00.000Z',
            reviewWindowExpiredAt: null,
            transitionMode: 'manual_lock',
            lastTransitionAt: '2026-03-16T10:31:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([
            {
                id: 'thread-future',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 999,
                state: 'open',
                createdBy: 11,
                createdAt: '2026-03-16T11:00:00.000Z',
                updatedAt: '2026-03-16T11:30:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: null,
            },
        ] as any);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: 42 });

        expect(lifecycle.currentSnapshotVersion).toBe(2);
        expect(lifecycle.stableSnapshot.draftVersion).toBe(2);
        expect(lifecycle.reviewBinding.boundSnapshotVersion).toBe(2);
    });

    test('keeps drafting on read even after drafting window elapses until workflow sweep runs', async () => {
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockRestore();
        const prisma = createWorkflowStatePrisma({
            post: {
                createdAt: new Date('2026-03-16T08:00:00.000Z'),
                updatedAt: new Date('2026-03-16T08:10:00.000Z'),
            },
            noticeRows: [makeAcceptedNoticeRow({
                createdAt: new Date('2026-03-16T08:00:00.000Z'),
            })],
        });

        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile').mockResolvedValue({
            circleId: 7,
            sourceType: 'circle_override',
            inheritanceMode: 'independent',
            inheritsFromProfileId: null,
            inheritsFromCircleId: null,
            draftGenerationPolicy: {} as any,
            draftLifecycleTemplate: {
                templateId: 'fast_deposition',
                draftGenerationVotingMinutes: 10,
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 120,
                maxRevisionRounds: 1,
                reviewEntryMode: 'auto_or_manual',
            } as any,
            blockEditEligibilityPolicy: {} as any,
            forkPolicy: {} as any,
            ghostPolicy: {} as any,
            localEditability: 'editable',
            effectiveFrom: new Date('2026-03-16T07:00:00.000Z'),
            resolvedFromProfileVersion: null,
            configVersion: 1,
        } as any);
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
            draftPostId: 42,
            now: '2026-03-16T10:45:00.000Z',
        } as any) as any;

        expect(lifecycle.documentStatus).toBe('drafting');
        expect(lifecycle.transitionMode).toBe('seeded');
        expect(lifecycle.reviewEndsAt).toBeNull();
        expect(lifecycle.draftingEndsAt).toBe('2026-03-16T08:30:00.000Z');
    });

    test('workflow sweep transitions overdue drafting into review before lifecycle read', async () => {
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockRestore();
        const prisma = createWorkflowStatePrisma({
            post: {
                createdAt: new Date('2026-03-16T08:00:00.000Z'),
                updatedAt: new Date('2026-03-16T08:10:00.000Z'),
            },
            noticeRows: [makeAcceptedNoticeRow({
                createdAt: new Date('2026-03-16T08:00:00.000Z'),
            })],
        });

        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile').mockResolvedValue({
            circleId: 7,
            sourceType: 'circle_override',
            inheritanceMode: 'independent',
            inheritsFromProfileId: null,
            inheritsFromCircleId: null,
            draftGenerationPolicy: {} as any,
            draftLifecycleTemplate: {
                templateId: 'fast_deposition',
                draftGenerationVotingMinutes: 10,
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 120,
                maxRevisionRounds: 1,
                reviewEntryMode: 'auto_or_manual',
            } as any,
            blockEditEligibilityPolicy: {} as any,
            forkPolicy: {} as any,
            ghostPolicy: {} as any,
            localEditability: 'editable',
            effectiveFrom: new Date('2026-03-16T07:00:00.000Z'),
            resolvedFromProfileVersion: null,
            configVersion: 1,
        } as any);
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        await resolveDraftLifecycleReadModel(prisma, {
            draftPostId: 42,
            now: '2026-03-16T08:05:00.000Z',
        } as any);

        const sweep = await processDueDraftWorkflowTransitions(prisma, {
            now: new Date('2026-03-16T10:45:00.000Z'),
        });
        expect(sweep.transitionedCount).toBe(1);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
            draftPostId: 42,
            now: '2026-03-16T10:45:00.000Z',
        } as any) as any;

        expect(lifecycle.documentStatus).toBe('review');
        expect(lifecycle.currentRound).toBe(1);
        expect(lifecycle.transitionMode).toBe('auto_lock');
        expect(lifecycle.draftingEndsAt).toBe('2026-03-16T08:30:00.000Z');
        expect(lifecycle.reviewEndsAt).toBe('2026-03-16T10:30:00.000Z');
    });

    test('workflow sweep ignores manual-only drafts after the window elapses', async () => {
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockRestore();
        const prisma = createWorkflowStatePrisma({
            post: {
                createdAt: new Date('2026-03-16T08:00:00.000Z'),
                updatedAt: new Date('2026-03-16T08:10:00.000Z'),
            },
            noticeRows: [makeAcceptedNoticeRow({
                createdAt: new Date('2026-03-16T08:00:00.000Z'),
            })],
        });

        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile').mockResolvedValue({
            circleId: 7,
            sourceType: 'circle_override',
            inheritanceMode: 'independent',
            inheritsFromProfileId: null,
            inheritsFromCircleId: null,
            draftGenerationPolicy: {} as any,
            draftLifecycleTemplate: {
                templateId: 'fast_deposition',
                draftGenerationVotingMinutes: 10,
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 120,
                maxRevisionRounds: 1,
                reviewEntryMode: 'manual_only',
            } as any,
            blockEditEligibilityPolicy: {} as any,
            forkPolicy: {} as any,
            ghostPolicy: {} as any,
            localEditability: 'editable',
            effectiveFrom: new Date('2026-03-16T07:00:00.000Z'),
            resolvedFromProfileVersion: null,
            configVersion: 1,
        } as any);
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const sweep = await processDueDraftWorkflowTransitions(prisma, {
            now: new Date('2026-03-16T10:00:00.000Z'),
        });
        expect(sweep.transitionedCount).toBe(0);

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
            draftPostId: 42,
            now: '2026-03-16T10:00:00.000Z',
        } as any) as any;

        expect(lifecycle.documentStatus).toBe('drafting');
        expect(lifecycle.transitionMode).toBe('seeded');
        expect(lifecycle.reviewEndsAt).toBeNull();
        expect(lifecycle.draftingEndsAt).toBe('2026-03-16T08:30:00.000Z');
    });

    test('archive mutation wrapper returns archived lifecycle with public policy digest attached', async () => {
        const prisma = createWorkflowStatePrisma();

        jest.spyOn(workflowStateService, 'archiveDraftLifecycle').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'archived',
            currentSnapshotVersion: 1,
            currentRound: 1,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T10:00:00.000Z',
            draftingEndsAt: null,
            reviewStartedAt: null,
            reviewEndsAt: null,
            reviewWindowExpiredAt: null,
            transitionMode: 'archived',
            lastTransitionAt: '2026-03-16T12:00:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'archived',
            currentSnapshotVersion: 1,
            currentRound: 1,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T10:00:00.000Z',
            draftingEndsAt: null,
            reviewStartedAt: null,
            reviewEndsAt: null,
            reviewWindowExpiredAt: null,
            transitionMode: 'archived',
            lastTransitionAt: '2026-03-16T12:00:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await archiveDraftLifecycleReadModel(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            anchorSignature: 'sig_archive_001',
            now: '2026-03-16T12:00:00.000Z',
        } as any);

        expect(lifecycle.documentStatus).toBe('archived');
        expect(lifecycle.transitionMode).toBe('archived');
        expect(lifecycle.policyProfileDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('restore mutation wrapper returns archived drafts to drafting', async () => {
        const prisma = createWorkflowStatePrisma();

        jest.spyOn(workflowStateService, 'restoreDraftLifecycle').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'drafting',
            currentSnapshotVersion: 1,
            currentRound: 2,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T12:00:00.000Z',
            draftingEndsAt: '2026-03-16T12:30:00.000Z',
            reviewStartedAt: null,
            reviewEndsAt: null,
            reviewWindowExpiredAt: null,
            transitionMode: 'manual_extend',
            lastTransitionAt: '2026-03-16T12:00:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(workflowStateService, 'resolveDraftWorkflowState').mockResolvedValue({
            draftPostId: 42,
            circleId: 7,
            documentStatus: 'drafting',
            currentSnapshotVersion: 1,
            currentRound: 2,
            reviewEntryMode: 'auto_or_manual',
            draftingStartedAt: '2026-03-16T12:00:00.000Z',
            draftingEndsAt: '2026-03-16T12:30:00.000Z',
            reviewStartedAt: null,
            reviewEndsAt: null,
            reviewWindowExpiredAt: null,
            transitionMode: 'manual_extend',
            lastTransitionAt: '2026-03-16T12:00:00.000Z',
            lastTransitionBy: 9,
        } as any);
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue([]);

        const lifecycle = await restoreDraftLifecycleReadModel(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            anchorSignature: 'sig_restore_001',
            now: '2026-03-16T12:00:00.000Z',
        } as any);

        expect(lifecycle.documentStatus).toBe('drafting');
        expect(lifecycle.currentRound).toBe(2);
        expect(lifecycle.transitionMode).toBe('manual_extend');
    });
});
