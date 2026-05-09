import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import * as collabEditAnchorService from '../collabEditAnchor';
import * as draftAnchorService from '../draftAnchor';
import * as versionSnapshotService from '../draftLifecycle/versionSnapshots';
import {
    advanceDraftLifecycleFromReview,
    archiveDraftLifecycle,
    failDraftLifecycleCrystallization,
    enterDraftLifecycleReview,
    enterDraftLifecycleCrystallization,
    finalizeDraftLifecycleCrystallization,
    reconcileActiveDraftWorkflowStates,
    repairDraftLifecycleCrystallizationEvidence,
    restoreDraftLifecycle,
    rollbackDraftLifecycleCrystallizationFailure,
    retryDraftLifecycleCrystallization,
    processDueDraftWorkflowTransitions,
} from '../draftLifecycle/workflowState';
import type { DraftLifecycleTemplateSnapshot } from '../policy/types';

const template: DraftLifecycleTemplateSnapshot = {
    templateId: 'fast_deposition',
    draftGenerationVotingMinutes: 10,
    draftingWindowMinutes: 30,
    reviewWindowMinutes: 120,
    maxRevisionRounds: 2,
    reviewEntryMode: 'auto_or_manual',
};

function parseSqlTimestampValue(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    return new Date(`${value.replace(' ', 'T')}Z`);
}

function createPrismaWithWorkflowState(rowOverrides: Record<string, unknown> = {}) {
    let workflowStateRow: any = {
        draftPostId: 42,
        circleId: 7,
        documentStatus: 'review',
        currentSnapshotVersion: 1,
        currentRound: 1,
        reviewEntryMode: 'auto_or_manual',
        draftingStartedAt: new Date('2026-03-16T08:00:00.000Z'),
        draftingEndsAt: new Date('2026-03-16T08:30:00.000Z'),
        reviewStartedAt: new Date('2026-03-16T08:30:00.000Z'),
        reviewEndsAt: new Date('2026-03-16T10:30:00.000Z'),
        reviewWindowExpiredAt: null,
        crystallizationPolicyProfileDigest: null,
        crystallizationAnchorSignature: null,
        transitionMode: 'auto_lock',
        lastTransitionAt: new Date('2026-03-16T08:30:00.000Z'),
        lastTransitionBy: null,
        createdAt: new Date('2026-03-16T08:00:00.000Z'),
        updatedAt: new Date('2026-03-16T08:30:00.000Z'),
        ...rowOverrides,
    };
    let versionSnapshotRows: any[] = [{
        draftPostId: 42,
        draftVersion: Number((rowOverrides.currentSnapshotVersion as number | undefined) || 1),
        contentSnapshot: 'Draft body v2',
        contentHash: '1'.repeat(64),
        createdFromState: 'drafting',
        createdBy: 9,
        sourceEditAnchorId: null,
        sourceSummaryHash: null,
        sourceMessagesDigest: null,
        createdAt: new Date('2026-03-16T08:30:00.000Z'),
    }];

    const prisma: any = {
        post: {
            findUnique: jest.fn(async () => ({
                id: 42,
                text: 'Draft body v2',
            })),
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
            if (sql.includes('FROM draft_workflow_state') && sql.includes('WHERE draft_post_id =')) {
                return workflowStateRow ? [workflowStateRow] : [];
            }
            if (
                sql.includes('FROM draft_workflow_state')
                && sql.includes("review_entry_mode <> 'manual_only'")
                && sql.includes('drafting_ends_at <=')
            ) {
                const now = parseSqlTimestampValue(query?.values?.[0]) || new Date();
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
            if (
                sql.includes('FROM draft_workflow_state')
                && sql.includes("document_status = 'review'")
                && sql.includes('review_window_expired_at IS NULL')
            ) {
                const now = parseSqlTimestampValue(query?.values?.[0]) || new Date();
                const limit = Number(query?.values?.[1] || 100);
                if (
                    workflowStateRow
                    && workflowStateRow.documentStatus === 'review'
                    && workflowStateRow.reviewEndsAt instanceof Date
                    && workflowStateRow.reviewEndsAt.getTime() <= now.getTime()
                    && !workflowStateRow.reviewWindowExpiredAt
                ) {
                    return [workflowStateRow].slice(0, limit);
                }
                return [];
            }
            if (sql.includes('FROM draft_version_snapshots')) {
                const draftPostId = Number(query?.values?.[0]);
                const draftVersion = Number(query?.values?.[1]);
                return versionSnapshotRows.filter((row) =>
                    row.draftPostId === draftPostId && row.draftVersion === draftVersion,
                );
            }
            return [];
        }),
        $executeRaw: jest.fn(async (query: any) => {
            const sql = String(query?.strings?.join(' ') || '');
            const values = query?.values || [];
            if (sql.includes('UPDATE draft_discussion_threads') && sql.includes('SET target_version =')) {
                return 1;
            }
            if (sql.includes('UPDATE draft_workflow_state')) {
                if (sql.includes('review_window_expired_at =') && sql.includes("transition_mode = 'review_window_elapsed'")) {
                    const draftPostId = Number(values.find((value: unknown) =>
                        Number(value) === Number(workflowStateRow?.draftPostId)));
                    if (!workflowStateRow || workflowStateRow.draftPostId !== draftPostId) return 0;
                    if (workflowStateRow.documentStatus !== 'review') return 0;
                    workflowStateRow = {
                        ...workflowStateRow,
                        reviewWindowExpiredAt: parseSqlTimestampValue(values[0]),
                        transitionMode: 'review_window_elapsed',
                        lastTransitionAt: parseSqlTimestampValue(values[1]),
                        updatedAt: parseSqlTimestampValue(values[2]),
                    };
                    return 1;
                }
                if (sql.includes('WHERE circle_id =') && sql.includes("document_status = 'drafting'")) {
                    const circleId = Number(values.find((value: unknown) => Number(value) === Number(workflowStateRow?.circleId)));
                    if (!workflowStateRow || workflowStateRow.circleId !== circleId) return 0;
                    if (workflowStateRow.documentStatus !== 'drafting') return 0;
                    const nextReviewEntryMode = values.find((value: unknown) => typeof value === 'string');
                    const draftingWindowMinutes = Number(values.find((value: unknown) => typeof value === 'number'));
                    workflowStateRow = {
                        ...workflowStateRow,
                        reviewEntryMode: String(nextReviewEntryMode || workflowStateRow.reviewEntryMode),
                        draftingEndsAt: new Date(
                            workflowStateRow.draftingStartedAt.getTime()
                            + (draftingWindowMinutes * 60 * 1000),
                        ),
                    };
                    return 1;
                }
                if (sql.includes('review_started_at IS NULL THEN review_ends_at')) {
                    const circleId = Number(values.find((value: unknown) => Number(value) === Number(workflowStateRow?.circleId)));
                    if (!workflowStateRow || workflowStateRow.circleId !== circleId) return 0;
                    if (workflowStateRow.documentStatus !== 'review') return 0;
                    const reviewWindowMinutes = Number(values.find((value: unknown) => typeof value === 'number'));
                    const now = (values.find((value: unknown) => value instanceof Date) as Date | undefined) || new Date();
                    const nextReviewEndsAt = new Date(
                        workflowStateRow.reviewStartedAt.getTime()
                        + (reviewWindowMinutes * 60 * 1000),
                    );
                    workflowStateRow = {
                        ...workflowStateRow,
                        reviewEndsAt: nextReviewEndsAt,
                        reviewWindowExpiredAt: nextReviewEndsAt.getTime() <= now.getTime()
                            ? (workflowStateRow.reviewWindowExpiredAt || nextReviewEndsAt)
                            : null,
                        transitionMode: nextReviewEndsAt.getTime() <= now.getTime()
                            ? 'review_window_elapsed'
                            : workflowStateRow.transitionMode === 'review_window_elapsed'
                                ? 'manual_lock'
                                : workflowStateRow.transitionMode,
                    };
                    return 1;
                }
                const draftPostId = Number(values[values.length - 1]);
                if (!workflowStateRow || workflowStateRow.draftPostId !== draftPostId) {
                    return 0;
                }
                if (sql.includes("document_status = 'drafting'") && sql.includes('current_round = current_round + 1')) {
                    const allowsRestoreFromArchive = sql.includes("document_status = 'archived'");
                    if (workflowStateRow.documentStatus !== 'review') {
                        if (!allowsRestoreFromArchive || workflowStateRow.documentStatus !== 'archived') return 0;
                    }
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'drafting',
                        currentRound: Number(workflowStateRow.currentRound || 1) + 1,
                        draftingStartedAt: parseSqlTimestampValue(values[0]),
                        draftingEndsAt: parseSqlTimestampValue(values[1]),
                        reviewStartedAt: null,
                        reviewEndsAt: null,
                        reviewWindowExpiredAt: null,
                        crystallizationPolicyProfileDigest: values[5],
                        crystallizationAnchorSignature: values[6],
                        transitionMode: 'manual_extend',
                        lastTransitionAt: parseSqlTimestampValue(values[7]),
                        lastTransitionBy: values[8],
                        updatedAt: parseSqlTimestampValue(values[9]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'archived'") && sql.includes("transition_mode = 'archived'")) {
                    if (
                        workflowStateRow.documentStatus !== 'drafting'
                        && workflowStateRow.documentStatus !== 'review'
                        && workflowStateRow.documentStatus !== 'crystallization_active'
                        && workflowStateRow.documentStatus !== 'crystallization_failed'
                    ) {
                        return 0;
                    }
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'archived',
                        draftingEndsAt: null,
                        reviewEndsAt: null,
                        reviewWindowExpiredAt: null,
                        crystallizationPolicyProfileDigest: values[3],
                        crystallizationAnchorSignature: values[4],
                        transitionMode: 'archived',
                        lastTransitionAt: parseSqlTimestampValue(values[5]),
                        lastTransitionBy: values[6],
                        updatedAt: parseSqlTimestampValue(values[7]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'crystallized'")) {
                    if (workflowStateRow.documentStatus !== 'crystallization_active') return 0;
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'crystallized',
                        transitionMode: 'crystallization_succeeded',
                        lastTransitionAt: parseSqlTimestampValue(values[0]),
                        lastTransitionBy: values[1],
                        updatedAt: parseSqlTimestampValue(values[2]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'crystallization_failed'") && sql.includes("transition_mode = 'crystallization_failed'")) {
                    if (workflowStateRow.documentStatus !== 'crystallization_active') return 0;
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'crystallization_failed',
                        transitionMode: 'crystallization_failed',
                        lastTransitionAt: parseSqlTimestampValue(values[0]),
                        lastTransitionBy: values[1],
                        updatedAt: parseSqlTimestampValue(values[2]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'review'") && sql.includes("transition_mode = 'rollback_to_review'")) {
                    if (workflowStateRow.documentStatus !== 'crystallization_failed') return 0;
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'review',
                        reviewStartedAt: parseSqlTimestampValue(values[0]),
                        reviewEndsAt: parseSqlTimestampValue(values[1]),
                        reviewWindowExpiredAt: parseSqlTimestampValue(values[2]),
                        crystallizationPolicyProfileDigest: values[3],
                        crystallizationAnchorSignature: values[4],
                        transitionMode: 'rollback_to_review',
                        lastTransitionAt: parseSqlTimestampValue(values[5]),
                        lastTransitionBy: values[6],
                        updatedAt: parseSqlTimestampValue(values[7]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'crystallization_active'") && sql.includes("transition_mode = 'enter_crystallization'")) {
                    const allowsRetryFromFailure = sql.includes("document_status = 'crystallization_failed'");
                    if (workflowStateRow.documentStatus !== 'review') {
                        if (!allowsRetryFromFailure || workflowStateRow.documentStatus !== 'crystallization_failed') {
                            return 0;
                        }
                    }
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'crystallization_active',
                        reviewEndsAt: workflowStateRow.reviewEndsAt || values[0],
                        crystallizationPolicyProfileDigest: values[1],
                        crystallizationAnchorSignature: values[2],
                        transitionMode: 'enter_crystallization',
                        lastTransitionAt: parseSqlTimestampValue(values[3]),
                        lastTransitionBy: values[4],
                        updatedAt: parseSqlTimestampValue(values[5]),
                    };
                    return 1;
                }
                if (sql.includes("document_status = 'review'")) {
                    if (workflowStateRow.documentStatus !== 'drafting') return 0;
                    workflowStateRow = {
                        ...workflowStateRow,
                        documentStatus: 'review',
                        currentSnapshotVersion: values[0],
                        reviewStartedAt: parseSqlTimestampValue(values[1]),
                        reviewEndsAt: parseSqlTimestampValue(values[2]),
                        reviewWindowExpiredAt: parseSqlTimestampValue(values[3]),
                        transitionMode: values[4],
                        lastTransitionAt: parseSqlTimestampValue(values[5]),
                        lastTransitionBy: values[6],
                        updatedAt: parseSqlTimestampValue(values[7]),
                    };
                    return 1;
                }
            }
            return 0;
        }),
        $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => callback(prisma)),
    };

    return prisma;
}

describe('draft workflow state service', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(draftAnchorService, 'getLatestDraftAnchorByPostId').mockResolvedValue(null as any);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId').mockResolvedValue([]);
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsBySnapshotHash').mockResolvedValue([]);
        jest.spyOn(collabEditAnchorService, 'createCollabEditAnchorBatch').mockResolvedValue({
            anchorId: 'c'.repeat(64),
            draftPostId: 42,
            circleId: 7,
            roomKey: 'crucible-42',
            fromSeq: '1',
            toSeq: '1',
            updateCount: 1,
            updatesDigest: 'd'.repeat(64),
            snapshotHash: '1'.repeat(64),
            payloadHash: 'c'.repeat(64),
            canonicalPayload: null,
            chain: 'solana',
            memoText: 'memo',
            txSignature: '5'.repeat(88),
            txSlot: '123',
            status: 'anchored',
            errorMessage: null,
            createdAt: new Date('2026-03-16T08:30:00.000Z').toISOString(),
            anchoredAt: new Date('2026-03-16T08:30:01.000Z').toISOString(),
            updatedAt: new Date('2026-03-16T08:30:01.000Z').toISOString(),
        } as any);
        jest.spyOn(collabEditAnchorService, 'verifyCollabEditAnchor').mockReturnValue({
            verifiable: true,
        } as any);
        jest.spyOn(versionSnapshotService, 'updateDraftVersionSnapshotSourceEvidence').mockResolvedValue({
            draftPostId: 42,
            draftVersion: 2,
            contentSnapshot: 'Draft body v2',
            contentHash: '1'.repeat(64),
            createdFromState: 'drafting',
            createdBy: 9,
            sourceEditAnchorId: 'c'.repeat(64),
            sourceSummaryHash: null,
            sourceMessagesDigest: null,
            createdAt: new Date('2026-03-16T08:30:00.000Z').toISOString(),
        });
    });
    test('manual enter-review is idempotent when draft is already in review', async () => {
        const prisma = createPrismaWithWorkflowState();

        const state = await enterDraftLifecycleReview(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T08:45:00.000Z'),
        });

        expect(state.documentStatus).toBe('review');
        expect(state.transitionMode).toBe('auto_lock');
        expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    test('enter-review does not emit lifecycle collab anchors while materializing the review snapshot', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'drafting',
            currentSnapshotVersion: 1,
            reviewStartedAt: null,
            reviewEndsAt: null,
            transitionMode: 'seeded',
            lastTransitionAt: new Date('2026-03-16T08:00:00.000Z'),
        });

        await enterDraftLifecycleReview(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T08:45:00.000Z'),
        });

        expect(collabEditAnchorService.createCollabEditAnchorBatch).not.toHaveBeenCalled();
        expect(versionSnapshotService.updateDraftVersionSnapshotSourceEvidence).not.toHaveBeenCalled();
    });

    test('workflow sweep transitions each due draft at most once', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'drafting',
            reviewStartedAt: null,
            reviewEndsAt: null,
            transitionMode: 'seeded',
            lastTransitionAt: new Date('2026-03-16T08:00:00.000Z'),
        });

        const first = await processDueDraftWorkflowTransitions(prisma, {
            now: new Date('2026-03-16T08:45:00.000Z'),
            template,
        });
        const second = await processDueDraftWorkflowTransitions(prisma, {
            now: new Date('2026-03-16T08:46:00.000Z'),
            template,
        });

        expect(first.transitionedCount).toBe(1);
        expect(second.transitionedCount).toBe(0);
    });

    test('workflow sweep marks expired review windows without auto-advancing review decisions', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'review',
            reviewEndsAt: new Date('2026-03-16T08:40:00.000Z'),
            reviewWindowExpiredAt: null,
            transitionMode: 'manual_lock',
        });

        const sweep = await processDueDraftWorkflowTransitions(prisma, {
            now: new Date('2026-03-16T08:45:00.000Z'),
            template,
        });

        expect(sweep.transitionedCount).toBe(0);
        expect(sweep.reviewWindowExpiredCount).toBe(1);
        expect(sweep.reviewWindowExpiredDraftPostIds).toEqual([42]);
    });

    test('advance-from-review opens a new drafting round based on the same lifecycle template', async () => {
        const prisma = createPrismaWithWorkflowState();

        const state = await advanceDraftLifecycleFromReview(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:00:00.000Z'),
        });

        expect(state.documentStatus).toBe('drafting');
        expect(state.currentRound).toBe(2);
        expect(state.transitionMode).toBe('manual_extend');
        expect(state.reviewEndsAt).toBeNull();
    });

    test('advance-from-review respects maxRevisionRounds', async () => {
        const prisma = createPrismaWithWorkflowState({
            currentRound: 2,
        });

        await expect(advanceDraftLifecycleFromReview(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:00:00.000Z'),
        })).rejects.toMatchObject({
            code: 'draft_max_revision_rounds_reached',
        });
    });

    test('enter-crystallization moves review drafts into crystallization_active', async () => {
        const prisma = createPrismaWithWorkflowState();

        const state = await enterDraftLifecycleCrystallization(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            anchorSignature: 'sig_enter_001',
            policyProfileDigest: '8'.repeat(64),
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:05:00.000Z'),
        });

        expect(state.documentStatus).toBe('crystallization_active');
        expect(state.transitionMode).toBe('enter_crystallization');
        expect(state.currentRound).toBe(1);
    });

    test('enter-crystallization backfills a lifecycle collab anchor when the stable snapshot has no bound evidence', async () => {
        const prisma = createPrismaWithWorkflowState();

        await enterDraftLifecycleCrystallization(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            anchorSignature: 'sig_enter_001',
            policyProfileDigest: '8'.repeat(64),
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:05:00.000Z'),
        });

        expect(collabEditAnchorService.createCollabEditAnchorBatch).toHaveBeenCalledWith(
            expect.objectContaining({
                draftPostId: 42,
                circleId: 7,
                roomKey: 'crucible-42',
            }),
        );
        expect(versionSnapshotService.updateDraftVersionSnapshotSourceEvidence).toHaveBeenCalledWith(
            prisma,
            expect.objectContaining({
                draftPostId: 42,
                draftVersion: 1,
                sourceEditAnchorId: 'c'.repeat(64),
            }),
        );
    });

    test('enter-crystallization refuses to reuse a matching collab anchor until it is fully anchored', async () => {
        const prisma = createPrismaWithWorkflowState();
        jest.spyOn(collabEditAnchorService, 'getCollabEditAnchorsBySnapshotHash').mockResolvedValueOnce([
            {
                anchorId: 'p'.repeat(64),
                draftPostId: 42,
                circleId: 7,
                roomKey: 'crucible-42',
                fromSeq: '1',
                toSeq: '1',
                updateCount: 1,
                updatesDigest: 'd'.repeat(64),
                snapshotHash: '1'.repeat(64),
                payloadHash: 'p'.repeat(64),
                canonicalPayload: null,
                chain: 'solana',
                memoText: 'memo',
                txSignature: null,
                txSlot: null,
                status: 'pending',
                errorMessage: null,
                createdAt: new Date('2026-03-16T08:30:00.000Z').toISOString(),
                anchoredAt: null,
                updatedAt: new Date('2026-03-16T08:30:01.000Z').toISOString(),
            },
        ] as any);

        await expect(enterDraftLifecycleCrystallization(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            anchorSignature: 'sig_enter_001',
            policyProfileDigest: '8'.repeat(64),
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:05:00.000Z'),
        })).rejects.toMatchObject({
            code: 'draft_collab_anchor_pending',
        });

        expect(collabEditAnchorService.createCollabEditAnchorBatch).not.toHaveBeenCalled();
    });

    test('repair-crystallization-evidence backfills a lifecycle collab anchor for an already active crystallization draft', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'crystallization_active',
            transitionMode: 'enter_crystallization',
            currentSnapshotVersion: 2,
        });

        const state = await repairDraftLifecycleCrystallizationEvidence(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
        });

        expect(collabEditAnchorService.createCollabEditAnchorBatch).toHaveBeenCalledWith(
            expect.objectContaining({
                draftPostId: 42,
                circleId: 7,
                roomKey: 'crucible-42',
            }),
        );
        expect(versionSnapshotService.updateDraftVersionSnapshotSourceEvidence).toHaveBeenCalledWith(
            prisma,
            expect.objectContaining({
                draftPostId: 42,
                draftVersion: 2,
                sourceEditAnchorId: 'c'.repeat(64),
            }),
        );
        expect(state.documentStatus).toBe('crystallization_active');
    });

    test('finalize-crystallization marks active drafts as crystallized', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'crystallization_active',
            transitionMode: 'enter_crystallization',
        });

        const state = await finalizeDraftLifecycleCrystallization(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:20:00.000Z'),
        });

        expect(state.documentStatus).toBe('crystallized');
        expect(state.transitionMode).toBe('crystallization_succeeded');
    });

    test('fail-crystallization marks active drafts as crystallization_failed', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'crystallization_active',
            transitionMode: 'enter_crystallization',
        });

        const state = await failDraftLifecycleCrystallization(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:22:00.000Z'),
        });

        expect(state.documentStatus).toBe('crystallization_failed');
        expect(state.transitionMode).toBe('crystallization_failed');
    });

    test('retry-crystallization re-enters crystallization from failure state', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'crystallization_failed',
            transitionMode: 'crystallization_failed',
        });

        const state = await retryDraftLifecycleCrystallization(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            anchorSignature: 'sig_retry_001',
            policyProfileDigest: '9'.repeat(64),
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:24:00.000Z'),
        });

        expect(state.documentStatus).toBe('crystallization_active');
        expect(state.transitionMode).toBe('enter_crystallization');
    });

    test('rollback-crystallization returns failed drafts to review', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'crystallization_failed',
            transitionMode: 'crystallization_failed',
        });

        const state = await rollbackDraftLifecycleCrystallizationFailure(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T09:25:00.000Z'),
        });

        expect(state.documentStatus).toBe('review');
        expect(state.transitionMode).toBe('rollback_to_review');
    });

    test('rollback-crystallization reopens a fresh review window', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'crystallization_failed',
            transitionMode: 'crystallization_failed',
            reviewStartedAt: new Date('2026-03-16T08:30:00.000Z'),
            reviewEndsAt: new Date('2026-03-16T10:30:00.000Z'),
            reviewWindowExpiredAt: new Date('2026-03-16T10:30:00.000Z'),
            crystallizationPolicyProfileDigest: 'a'.repeat(64),
            crystallizationAnchorSignature: '5'.repeat(88),
        });

        const state = await rollbackDraftLifecycleCrystallizationFailure(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T11:00:00.000Z'),
        });

        expect(state.documentStatus).toBe('review');
        expect(state.transitionMode).toBe('rollback_to_review');
        expect(state.reviewStartedAt).toBe('2026-03-16T11:00:00.000Z');
        expect(state.reviewEndsAt).toBe('2026-03-16T13:00:00.000Z');
        expect(state.reviewWindowExpiredAt).toBeNull();
        expect(state.crystallizationPolicyProfileDigest).toBeNull();
        expect(state.crystallizationAnchorSignature).toBeNull();
    });

    test('archive transitions active drafts into archived milestone state', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'review',
            crystallizationPolicyProfileDigest: 'a'.repeat(64),
            crystallizationAnchorSignature: '5'.repeat(88),
        });

        const state = await archiveDraftLifecycle(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T11:05:00.000Z'),
        });

        expect(state.documentStatus).toBe('archived');
        expect(state.transitionMode).toBe('archived');
        expect(state.reviewEndsAt).toBeNull();
        expect(state.reviewWindowExpiredAt).toBeNull();
        expect(state.crystallizationPolicyProfileDigest).toBeNull();
        expect(state.crystallizationAnchorSignature).toBeNull();
        expect(state.lastTransitionBy).toBe(9);
    });

    test('restore reopens archived drafts as a fresh drafting round', async () => {
        const prisma = createPrismaWithWorkflowState({
            documentStatus: 'archived',
            currentRound: 2,
            draftingEndsAt: null,
            reviewEndsAt: null,
            transitionMode: 'archived',
            crystallizationPolicyProfileDigest: 'a'.repeat(64),
            crystallizationAnchorSignature: '5'.repeat(88),
        });

        const state = await restoreDraftLifecycle(prisma, {
            draftPostId: 42,
            circleId: 7,
            actorUserId: 9,
            template,
            seedStartedAt: new Date('2026-03-16T08:00:00.000Z'),
            now: new Date('2026-03-16T11:30:00.000Z'),
        });

        expect(state.documentStatus).toBe('drafting');
        expect(state.currentRound).toBe(3);
        expect(state.transitionMode).toBe('manual_extend');
        expect(state.draftingEndsAt).toBe('2026-03-16T12:00:00.000Z');
        expect(state.crystallizationPolicyProfileDigest).toBeNull();
        expect(state.crystallizationAnchorSignature).toBeNull();
        expect(state.lastTransitionBy).toBe(9);
    });

    test('reconcileActiveDraftWorkflowStates reports refreshed drafting and review rows', async () => {
        const prisma: any = {
            $executeRaw: jest.fn(async () => 1),
        };

        const result = await reconcileActiveDraftWorkflowStates(prisma, {
            circleId: 7,
            template: {
                ...template,
                draftingWindowMinutes: 45,
                reviewWindowMinutes: 60,
                reviewEntryMode: 'auto_only',
            },
            now: new Date('2026-03-16T10:00:00.000Z'),
        });

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
        expect(result).toEqual({
            draftingUpdatedCount: 1,
            reviewUpdatedCount: 1,
        });
    });
});
