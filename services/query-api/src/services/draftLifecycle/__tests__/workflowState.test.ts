import { describe, expect, jest, test } from '@jest/globals';

import {
    getPersistedDraftWorkflowState,
    processDueDraftWorkflowTransitions,
    reconcileActiveDraftWorkflowStates,
    resolveDraftWorkflowState,
} from '../workflowState';

function createWorkflowStateRow(overrides: Record<string, unknown> = {}) {
    return {
        draftPostId: 1,
        circleId: null,
        documentStatus: 'drafting',
        currentSnapshotVersion: 1,
        currentRound: 1,
        reviewEntryMode: 'auto_or_manual',
        draftingStartedAt: new Date('2026-04-11T12:41:56.099Z'),
        draftingEndsAt: new Date('2026-04-11T13:11:56.099Z'),
        reviewStartedAt: null,
        reviewEndsAt: null,
        reviewWindowExpiredAt: null,
        crystallizationPolicyProfileDigest: null,
        crystallizationAnchorSignature: null,
        transitionMode: 'seeded',
        lastTransitionAt: new Date('2026-04-11T12:41:56.099Z'),
        lastTransitionBy: null,
        createdAt: new Date('2026-04-11T04:42:17.511Z'),
        updatedAt: new Date('2026-04-11T04:42:17.511Z'),
        ...overrides,
    };
}

function getQueryText(query: unknown): string {
    return Array.isArray((query as { strings?: string[] } | null)?.strings)
        ? ((query as { strings: string[] }).strings.join(' '))
        : String(query || '');
}

describe('draft workflow state timezone regressions', () => {
    test('getPersistedDraftWorkflowState repairs seeded drafting rows whose transition timestamp drifted ahead of the accepted handoff', async () => {
        const acceptedAt = new Date('2026-04-11T04:41:56.099Z');
        const postCreatedAt = new Date('2026-04-10T20:41:55.489Z');
        let workflowRow = createWorkflowStateRow();
        const prisma: any = {
            $queryRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('FROM draft_workflow_state')) return [workflowRow];
                if (queryText.includes('FROM circle_discussion_messages')) return [{ createdAt: acceptedAt }];
                if (queryText.includes('FROM posts')) return [{ createdAt: postCreatedAt }];
                return [];
            }),
            $executeRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('UPDATE draft_workflow_state')) {
                    workflowRow = createWorkflowStateRow({
                        draftingStartedAt: postCreatedAt,
                        draftingEndsAt: new Date('2026-04-10T21:11:55.489Z'),
                        lastTransitionAt: postCreatedAt,
                    });
                    return 1;
                }
                return 0;
            }),
        };

        const state = await getPersistedDraftWorkflowState(prisma, 1);

        expect(state).toMatchObject({
            draftPostId: 1,
            documentStatus: 'drafting',
            transitionMode: 'seeded',
            lastTransitionAt: '2026-04-10T20:41:55.489Z',
            draftingStartedAt: '2026-04-10T20:41:55.489Z',
            draftingEndsAt: '2026-04-10T21:11:55.489Z',
        });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    test('resolveDraftWorkflowState repairs skewed seeded rows using the provided seedStartedAt', async () => {
        const acceptedAt = new Date('2026-04-11T04:41:56.099Z');
        let workflowRow = createWorkflowStateRow();
        const prisma: any = {
            $queryRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('FROM draft_workflow_state')) return [workflowRow];
                return [];
            }),
            $executeRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('UPDATE draft_workflow_state')) {
                    workflowRow = createWorkflowStateRow({
                        draftingStartedAt: acceptedAt,
                        draftingEndsAt: new Date('2026-04-11T05:11:56.099Z'),
                        lastTransitionAt: acceptedAt,
                    });
                    return 1;
                }
                return 0;
            }),
        };

        const state = await resolveDraftWorkflowState(prisma, {
            draftPostId: 1,
            circleId: null,
            template: {
                templateId: 'fast_deposition',
                draftGenerationVotingMinutes: 30,
                reviewEntryMode: 'auto_or_manual',
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 180,
                maxRevisionRounds: 3,
            },
            seedStartedAt: acceptedAt,
        });

        expect(state).toMatchObject({
            lastTransitionAt: '2026-04-11T04:41:56.099Z',
            draftingStartedAt: '2026-04-11T04:41:56.099Z',
            draftingEndsAt: '2026-04-11T05:11:56.099Z',
        });
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    test('getPersistedDraftWorkflowState repairs auto-lock review rows derived from a skewed accepted handoff', async () => {
        const acceptedAt = new Date('2026-04-11T04:41:56.099Z');
        const postCreatedAt = new Date('2026-04-10T20:41:55.489Z');
        let workflowRow = createWorkflowStateRow({
            documentStatus: 'review',
            currentSnapshotVersion: 2,
            draftingStartedAt: new Date('2026-04-11T04:41:56.099Z'),
            draftingEndsAt: new Date('2026-04-11T05:11:56.099Z'),
            reviewStartedAt: new Date('2026-04-11T05:11:56.099Z'),
            reviewEndsAt: new Date('2026-04-11T09:11:56.099Z'),
            transitionMode: 'auto_lock',
            lastTransitionAt: new Date('2026-04-11T05:11:56.099Z'),
        });
        const prisma: any = {
            $queryRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('FROM draft_workflow_state')) return [workflowRow];
                if (queryText.includes('FROM circle_discussion_messages')) return [{ createdAt: acceptedAt }];
                if (queryText.includes('FROM posts')) return [{ createdAt: postCreatedAt }];
                return [];
            }),
            $executeRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('UPDATE draft_workflow_state')) {
                    workflowRow = createWorkflowStateRow({
                        documentStatus: 'review',
                        currentSnapshotVersion: 2,
                        draftingStartedAt: postCreatedAt,
                        draftingEndsAt: new Date('2026-04-10T21:11:55.489Z'),
                        reviewStartedAt: new Date('2026-04-10T21:11:55.489Z'),
                        reviewEndsAt: new Date('2026-04-11T00:11:55.489Z'),
                        transitionMode: 'auto_lock',
                        lastTransitionAt: new Date('2026-04-10T21:11:55.489Z'),
                    });
                    return 1;
                }
                return 0;
            }),
        };

        const state = await getPersistedDraftWorkflowState(prisma, 1);

        expect(state).toMatchObject({
            documentStatus: 'review',
            transitionMode: 'auto_lock',
            draftingStartedAt: '2026-04-10T20:41:55.489Z',
            draftingEndsAt: '2026-04-10T21:11:55.489Z',
            reviewStartedAt: '2026-04-10T21:11:55.489Z',
            reviewEndsAt: '2026-04-11T00:11:55.489Z',
            lastTransitionAt: '2026-04-10T21:11:55.489Z',
        });
    });

    test('getPersistedDraftWorkflowState repairs prematurely expired review rows back to an active review state', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-04-10T22:01:13.000Z'));
        const postCreatedAt = new Date('2026-04-10T20:41:55.489Z');
        const reviewStartedAt = new Date('2026-04-10T21:11:55.489Z');
        const reviewEndsAt = new Date('2026-04-11T01:11:55.489Z');
        let workflowRow = createWorkflowStateRow({
            documentStatus: 'review',
            currentSnapshotVersion: 2,
            draftingStartedAt: postCreatedAt,
            draftingEndsAt: reviewStartedAt,
            reviewStartedAt,
            reviewEndsAt,
            reviewWindowExpiredAt: reviewEndsAt,
            transitionMode: 'review_window_elapsed',
            lastTransitionAt: reviewEndsAt,
        });
        const prisma: any = {
            $queryRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('FROM draft_workflow_state')) return [workflowRow];
                if (queryText.includes('FROM circle_discussion_messages')) return [];
                if (queryText.includes('FROM posts')) return [{ createdAt: postCreatedAt }];
                return [];
            }),
            $executeRaw: jest.fn(async (...args: any[]) => {
                const queryText = getQueryText(args[0]);
                if (queryText.includes('UPDATE draft_workflow_state')) {
                    workflowRow = createWorkflowStateRow({
                        documentStatus: 'review',
                        currentSnapshotVersion: 2,
                        draftingStartedAt: postCreatedAt,
                        draftingEndsAt: reviewStartedAt,
                        reviewStartedAt,
                        reviewEndsAt,
                        reviewWindowExpiredAt: null,
                        transitionMode: 'auto_lock',
                        lastTransitionAt: reviewStartedAt,
                    });
                    return 1;
                }
                return 0;
            }),
        };

        try {
            const state = await getPersistedDraftWorkflowState(prisma, 1);

            expect(state).toMatchObject({
                documentStatus: 'review',
                transitionMode: 'auto_lock',
                reviewWindowExpiredAt: null,
                lastTransitionAt: '2026-04-10T21:11:55.489Z',
                reviewEndsAt: '2026-04-11T01:11:55.489Z',
            });
            expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('processDueDraftWorkflowTransitions uses timezone-stable timestamp strings for due lookups', async () => {
        const prisma: any = {
            $queryRaw: jest.fn(async () => []),
        };

        await processDueDraftWorkflowTransitions(prisma, {
            now: new Date('2026-04-10T22:01:13.000Z'),
            limit: 10,
        });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        for (const [query] of prisma.$queryRaw.mock.calls) {
            expect(Array.isArray(query.values)).toBe(true);
            expect(query.values.some((value: unknown) => value instanceof Date)).toBe(false);
            expect(query.values).toContain('2026-04-10 22:01:13.000');
        }
    });

    test('reconcileActiveDraftWorkflowStates uses timezone-stable timestamp strings for review expiry comparisons', async () => {
        const prisma: any = {
            $executeRaw: jest.fn(async () => 0),
        };

        await reconcileActiveDraftWorkflowStates(prisma, {
            circleId: 125,
            template: {
                templateId: 'fast_deposition',
                draftGenerationVotingMinutes: 30,
                reviewEntryMode: 'auto_or_manual',
                draftingWindowMinutes: 30,
                reviewWindowMinutes: 240,
                maxRevisionRounds: 3,
            },
            now: new Date('2026-04-10T22:01:13.000Z'),
        });

        expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
        for (const [query] of prisma.$executeRaw.mock.calls) {
            expect(Array.isArray(query.values)).toBe(true);
            expect(query.values.some((value: unknown) => value instanceof Date)).toBe(false);
        }
        expect(prisma.$executeRaw.mock.calls[1][0].values).toContain('2026-04-10 22:01:13.000');
    });
});
