import { describe, expect, jest, test } from '@jest/globals';

import {
    loadCircleSummarySnapshotByVersion,
    loadLatestCircleSummarySnapshot,
    persistCircleSummarySnapshot,
    type CircleSummarySnapshot,
} from '../snapshot';
import {
    ensureLatestCircleSummarySnapshot,
    isCircleSummarySnapshotStale,
} from '../generator';

function makeSnapshot(overrides: Partial<CircleSummarySnapshot> = {}): CircleSummarySnapshot {
    return {
        summaryId: 'circle-7-v1',
        circleId: 7,
        version: 1,
        issueMap: [{ title: '主问题', body: '当前最成熟的议题入口。' }],
        conceptGraph: {
            nodes: [{ id: 'knowledge-1', label: '结论 A' }],
            edges: [],
        },
        viewpointBranches: [
            {
                knowledgeId: 'knowledge-1',
                title: '结论 A',
                sourceDraftPostId: 42,
                sourceBindingKind: 'snapshot',
            },
        ],
        factExplanationEmotionBreakdown: {
            facts: [{ label: '已结晶输出', value: 1 }],
            explanations: [{ label: '主线说明', body: '当前总览优先从稳定产物进入。' }],
            emotions: [{ label: '总体氛围', value: '聚焦中' }],
        },
        emotionConflictContext: {
            tensionLevel: 'medium',
            notes: ['仍有 1 条问题等待继续澄清。'],
        },
        sedimentationTimeline: [
            {
                key: 'draft-42-v4',
                title: '稳定草稿基线 v4',
                summary: '当前总结以草稿 #42 的稳定版本为来源。',
            },
        ],
        openQuestions: [
            {
                title: '还有哪些问题未被沉淀？',
                body: '需要补齐剩余问题单与引用链。',
            },
        ],
        generatedAt: new Date('2026-03-21T00:10:00.000Z'),
        generatedBy: 'system_projection',
        generationMetadata: {
            providerMode: 'projection',
            model: 'projection',
            promptAsset: 'circle-summary-projection',
            promptVersion: 'v1',
            sourceDigest: 'projection-digest',
        },
        ...overrides,
    };
}

describe('circle summary snapshot', () => {
    test('stores versioned summary truth with frozen outer fields and structured payload blocks', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => ([{ nextVersion: 3 }])),
            $queryRawUnsafe: jest.fn(async () => ([{
                summaryId: 'circle-7-v3',
                circleId: 7,
                version: 3,
                issueMap: [{ title: '主问题', body: '当前最成熟的议题入口。' }],
                conceptGraph: { nodes: [{ id: 'knowledge-1', label: '结论 A' }], edges: [] },
                viewpointBranches: [{ knowledgeId: 'knowledge-1', title: '结论 A' }],
                factExplanationEmotionBreakdown: {
                    facts: [{ label: '已结晶输出', value: 1 }],
                    explanations: [],
                    emotions: [],
                },
                emotionConflictContext: { tensionLevel: 'medium', notes: ['仍有分歧'] },
                sedimentationTimeline: [{ key: 'draft-42-v4', title: '稳定草稿基线 v4' }],
                openQuestions: [{ title: '还有哪些问题未被沉淀？', body: '需要补齐引用链。' }],
                generatedAt: new Date('2026-03-21T00:10:00.000Z'),
                generatedBy: 'user_requested',
                generationMetadata: {
                    providerMode: 'projection',
                    model: 'projection',
                    promptAsset: 'circle-summary-projection',
                    promptVersion: 'v1',
                    sourceDigest: 'projection-digest',
                },
            }])),
        } as any;

        const persisted = await persistCircleSummarySnapshot(prisma, makeSnapshot({
            version: 0,
            summaryId: 'pending',
            generatedBy: 'user_requested',
        }));

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(persisted).toMatchObject({
            summaryId: 'circle-7-v3',
            circleId: 7,
            version: 3,
            generatedBy: 'user_requested',
            generationMetadata: {
                providerMode: 'projection',
                model: 'projection',
                promptAsset: 'circle-summary-projection',
                promptVersion: 'v1',
                sourceDigest: 'projection-digest',
            },
        });
        expect(Array.isArray(persisted.issueMap)).toBe(true);
        expect(Array.isArray((persisted.conceptGraph as any).nodes)).toBe(true);
        expect(Array.isArray(persisted.viewpointBranches)).toBe(true);
        expect(Array.isArray(persisted.openQuestions)).toBe(true);
        expect((persisted as any).payload).toBeUndefined();
    });

    test('reuses the latest compatible snapshot unless it is stale or explicitly regenerated', async () => {
        const latest = makeSnapshot();
        const prisma = {
            $queryRaw: jest.fn(async (query: any) => {
                const queryText = Array.isArray(query?.strings)
                    ? query.strings.join(' ')
                    : String(query || '');

                if (queryText.includes('FROM circle_summary_snapshots')) {
                    return [latest];
                }
                if (queryText.includes('latestSourceUpdatedAt')) {
                    return [{
                        latestSourceUpdatedAt: new Date('2026-03-21T00:09:00.000Z'),
                    }];
                }
                throw new Error(`unexpected query: ${queryText}`);
            }),
            $queryRawUnsafe: jest.fn(),
        } as any;

        const reused = await ensureLatestCircleSummarySnapshot(prisma, {
            circleId: 7,
            now: new Date('2026-03-21T00:12:00.000Z'),
        });

        expect(reused.version).toBe(1);
        expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    test('marks snapshots stale by source freshness', async () => {
        expect(isCircleSummarySnapshotStale(
            makeSnapshot({
                generatedAt: new Date('2026-03-21T00:00:00.000Z'),
            }),
            new Date('2026-03-21T00:30:00.000Z'),
        )).toBe(true);
    });

    test('loads latest and versioned snapshots through dedicated read functions', async () => {
        const row = {
            summaryId: 'circle-7-v2',
            circleId: 7,
            version: 2,
            issueMap: [],
            conceptGraph: { nodes: [], edges: [] },
            viewpointBranches: [],
            factExplanationEmotionBreakdown: { facts: [], explanations: [], emotions: [] },
            emotionConflictContext: { tensionLevel: 'low', notes: [] },
            sedimentationTimeline: [],
            openQuestions: [],
            generatedAt: new Date('2026-03-21T00:15:00.000Z'),
            generatedBy: 'system_llm',
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen2.5:7b',
                promptAsset: 'circle-summary-inline',
                promptVersion: 'v1',
                sourceDigest: 'llm-digest',
            },
        };
        const prisma = {
            $queryRaw: jest.fn(async () => ([row])),
        } as any;

        await expect(loadLatestCircleSummarySnapshot(prisma, 7)).resolves.toMatchObject({
            summaryId: 'circle-7-v2',
            generatedBy: 'system_llm',
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen2.5:7b',
                promptAsset: 'circle-summary-inline',
                promptVersion: 'v1',
                sourceDigest: 'llm-digest',
            },
        });
        await expect(loadCircleSummarySnapshotByVersion(prisma, 7, 2)).resolves.toMatchObject({
            version: 2,
        });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    test('returns the latest snapshot when a concurrent insert wins the version race', async () => {
        const latest = makeSnapshot({
            summaryId: 'circle-7-v2',
            version: 2,
            generatedAt: new Date('2026-03-21T00:20:00.000Z'),
        });
        const uniqueViolation = Object.assign(
            new Error('duplicate key value violates unique constraint "circle_summary_snapshots_circle_id_version_key"'),
            {
                code: 'P2010',
                meta: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint "circle_summary_snapshots_circle_id_version_key"',
                },
            },
        );
        let rawCallCount = 0;
        const prisma = {
            $queryRaw: jest.fn(async () => {
                rawCallCount += 1;
                return rawCallCount === 1
                    ? [{ nextVersion: 2 }]
                    : [latest];
            }),
            $queryRawUnsafe: jest.fn(async () => {
                throw uniqueViolation;
            }),
        } as any;

        await expect(persistCircleSummarySnapshot(prisma, makeSnapshot({
            version: 0,
            summaryId: 'pending',
        }))).resolves.toMatchObject({
            summaryId: 'circle-7-v2',
            version: 2,
        });

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });
});
