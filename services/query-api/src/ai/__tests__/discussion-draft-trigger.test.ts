import { afterEach, describe, expect, jest, test } from '@jest/globals';

import * as versionSnapshotService from '../../services/draftLifecycle/versionSnapshots';
import { createInMemoryAiJobPrisma } from '../../services/aiJobs/testStore';
import {
    buildDraftOpportunityNotification,
    buildDraftText,
    createTriggeredDraftPostWithInitialSnapshot,
    enqueueDiscussionTriggerEvaluationJob,
    isDraftTriggerEligibleMessageKind,
} from '../discussion-draft-trigger';

describe('discussion draft trigger initial snapshot transaction', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('creates the draft post and its v1 snapshot inside a single database transaction', async () => {
        const tx = {
            post: {
                create: jest.fn(async () => ({ id: 42 })),
            },
        } as any;
        const prisma = {
            $transaction: jest.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
        } as any;
        const snapshotSpy = jest.spyOn(versionSnapshotService, 'createDraftVersionSnapshot')
            .mockResolvedValue({
                draftPostId: 42,
                draftVersion: 1,
                contentSnapshot: 'Draft body',
                contentHash: 'a'.repeat(64),
                createdFromState: 'drafting',
                createdBy: 9,
                sourceEditAnchorId: null,
                sourceSummaryHash: null,
                sourceMessagesDigest: null,
                createdAt: '2026-03-22T00:00:00.000Z',
            });

        const draftPost = await createTriggeredDraftPostWithInitialSnapshot(prisma, {
            contentId: 'ai-draft:7:1',
            authorId: 9,
            circleId: 7,
            text: 'Draft body',
            onChainAddress: 'offchain_ai_123456789012345678901234567890123456',
        });

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.post.create).toHaveBeenCalledTimes(1);
        expect(snapshotSpy).toHaveBeenCalledWith(tx, {
            draftPostId: 42,
            draftVersion: 1,
            contentSnapshot: 'Draft body',
            createdFromState: 'drafting',
            createdBy: 9,
        });
        expect(draftPost).toEqual({ id: 42 });
    });

    test('does not commit a draft post when the initial v1 snapshot write fails', async () => {
        const committedDrafts: Array<{ id: number }> = [];
        const prisma = {
            $transaction: jest.fn(async (runner: (client: any) => Promise<unknown>) => {
                const stagedDrafts: Array<{ id: number }> = [];
                const tx = {
                    post: {
                        create: jest.fn(async () => {
                            const row = { id: 42 };
                            stagedDrafts.push(row);
                            return row;
                        }),
                    },
                } as any;

                const result = await runner(tx);
                committedDrafts.push(...stagedDrafts);
                return result;
            }),
        } as any;
        jest.spyOn(versionSnapshotService, 'createDraftVersionSnapshot')
            .mockRejectedValue(new Error('snapshot_insert_failed'));

        await expect(createTriggeredDraftPostWithInitialSnapshot(prisma, {
            contentId: 'ai-draft:7:1',
            authorId: 9,
            circleId: 7,
            text: 'Draft body',
            onChainAddress: 'offchain_ai_123456789012345678901234567890123456',
        })).rejects.toThrow('snapshot_insert_failed');

        expect(committedDrafts).toHaveLength(0);
    });

    test('enqueue helper writes a durable discussion trigger job with circle scope truth', async () => {
        const prisma = createInMemoryAiJobPrisma();

        const job = await enqueueDiscussionTriggerEvaluationJob(prisma as any, {
            circleId: 7,
            requestedByUserId: 9,
        });

        expect(job).toMatchObject({
            jobType: 'discussion_trigger_evaluate',
            scopeType: 'circle',
            scopeCircleId: 7,
            requestedByUserId: 9,
            status: 'queued',
        });
    });

    test('enqueue helper reuses the active queued job instead of duplicating discussion trigger work', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                jobType: 'discussion_trigger_evaluate',
                scopeType: 'circle',
                scopeCircleId: 7,
                requestedByUserId: 9,
                status: 'queued',
                payloadJson: { circleId: 7 },
            },
        ]);

        const job = await enqueueDiscussionTriggerEvaluationJob(prisma as any, {
            circleId: 7,
            requestedByUserId: 11,
        });

        expect(job.id).toBe(prisma.__rows[0].id);
        expect(prisma.__rows).toHaveLength(1);
    });

    test('enqueue helper still reuses an existing trigger job when it falls outside the newest-20 active jobs window', async () => {
        const seed = [
            {
                id: 1,
                jobType: 'discussion_trigger_evaluate',
                scopeType: 'circle',
                scopeCircleId: 7,
                requestedByUserId: 9,
                status: 'queued',
                payloadJson: { circleId: 7 },
                createdAt: new Date('2026-04-10T00:00:00.000Z'),
            },
            ...Array.from({ length: 20 }, (_, index) => ({
                id: index + 2,
                jobType: 'discussion_message_analyze',
                scopeType: 'circle',
                scopeCircleId: 7,
                requestedByUserId: 9,
                status: index % 2 === 0 ? 'queued' : 'running',
                payloadJson: { circleId: 7, envelopeId: `env-${index + 2}` },
                createdAt: new Date(`2026-04-10T00:${String(index + 1).padStart(2, '0')}:00.000Z`),
            })),
        ];
        const prisma = createInMemoryAiJobPrisma(seed as any);

        const job = await enqueueDiscussionTriggerEvaluationJob(prisma as any, {
            circleId: 7,
            requestedByUserId: 11,
        });

        expect(job.id).toBe(1);
        expect(prisma.__rows.filter((row) => row.jobType === 'discussion_trigger_evaluate')).toHaveLength(1);
    });

    test('system notice message kinds are excluded from later trigger windows', () => {
        expect(isDraftTriggerEligibleMessageKind('plain')).toBe(true);
        expect(isDraftTriggerEligibleMessageKind('forward')).toBe(true);
        expect(isDraftTriggerEligibleMessageKind('draft_candidate_notice')).toBe(false);
        expect(isDraftTriggerEligibleMessageKind('governance_notice')).toBe(false);
        expect(isDraftTriggerEligibleMessageKind(null)).toBe(true);
    });

    test('draft seed text stays language-neutral and only keeps circle name plus summary', () => {
        expect(buildDraftText({
            circleName: 'Discussion Synthesis Lab',
            summary: 'A draft is forming from the recent discussion.',
            messageCount: 12,
            focusedRatio: 0.75,
            questionCount: 2,
        })).toBe('Discussion Synthesis Lab\n\nA draft is forming from the recent discussion.');
    });

    test('draft opportunity notification uses canonical english copy for later localization', () => {
        expect(buildDraftOpportunityNotification({
            summary: 'A draft is forming.',
            messageCount: 12,
            focusedRatio: 0.75,
            questionCount: 2,
        })).toEqual({
            title: 'Discussion ready for a draft',
            body: 'This discussion is showing draft-ready signals (12 messages, 75% focused, 2 questions).\nOpen the Draft tab to shape it before turning it into a crystal.\nSummary: A draft is forming.',
        });
    });
});
