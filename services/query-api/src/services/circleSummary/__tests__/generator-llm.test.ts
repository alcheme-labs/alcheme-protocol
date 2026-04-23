import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateTextMock = jest.fn();
const loadCircleGhostSettingsPatchMock = jest.fn();
const resolveCircleGhostSettingsMock = jest.fn();
const loadGhostConfigMock = jest.fn();

jest.mock('ai', () => ({
    generateText: generateTextMock,
}));

jest.mock('../../../ai/ghost/circle-settings', () => ({
    loadCircleGhostSettingsPatch: loadCircleGhostSettingsPatchMock,
    resolveCircleGhostSettings: resolveCircleGhostSettingsMock,
}));

jest.mock('../../../ai/ghost/config', () => ({
    loadGhostConfig: loadGhostConfigMock,
}));

import { ensureLatestCircleSummarySnapshot } from '../generator';

function getQueryText(query: any): string {
    return Array.isArray(query?.strings)
        ? query.strings.join(' ')
        : String(query || '');
}

describe('circle summary llm generation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (loadCircleGhostSettingsPatchMock as any).mockResolvedValue({
            summaryUseLLM: true,
        });
        resolveCircleGhostSettingsMock.mockReturnValue({
            summaryUseLLM: true,
        });
        loadGhostConfigMock.mockReturnValue({
            summary: { useLLM: false },
            trigger: { summaryUseLLM: false },
            relevance: { mode: 'rule' },
            admin: { token: null },
        });
        (generateTextMock as any).mockResolvedValue({
            text: '当前共识：结论 A 已收敛。\n未解决问题：来源证据还需要继续补齐。\n下一步建议：回到草稿与讨论补全引用链。',
        });
    });

    test('generates a persisted system_llm snapshot when circle summaryUseLLM is enabled', async () => {
        const now = new Date('2026-03-24T22:00:00.000Z');
        const prisma = {
            $queryRaw: jest.fn(async (query: any) => {
                const queryText = getQueryText(query);

                if (queryText.includes('FROM circle_summary_snapshots')) {
                    return [];
                }
                if (queryText.includes('latestSourceUpdatedAt')) {
                    return [{ latestSourceUpdatedAt: new Date('2026-03-24T21:30:00.000Z') }];
                }
                if (queryText.includes('FROM knowledge k')) {
                    return [{
                        knowledgeId: 'knowledge-1',
                        title: '结论 A',
                        version: 3,
                        citationCount: 5,
                        createdAt: new Date('2026-03-24T20:00:00.000Z'),
                        contributorsCount: 2,
                        sourceDraftPostId: 42,
                        sourceAnchorId: 'anchor-1',
                        sourceSummaryHash: 'summary-hash',
                        sourceMessagesDigest: 'messages-digest',
                        proofPackageHash: 'proof-hash',
                        bindingVersion: 2,
                        bindingCreatedAt: new Date('2026-03-24T20:30:00.000Z'),
                        outboundReferenceCount: 1,
                        inboundReferenceCount: 2,
                    }];
                }
                if (queryText.includes('FROM draft_workflow_state dws')) {
                    return [{
                        draftPostId: 42,
                        documentStatus: 'drafting',
                        currentSnapshotVersion: 4,
                        updatedAt: new Date('2026-03-24T21:00:00.000Z'),
                        draftVersion: 4,
                        sourceSummaryHash: 'summary-hash',
                        sourceMessagesDigest: 'messages-digest',
                    }];
                }
                if (queryText.includes('FROM draft_discussion_threads')) {
                    return [{
                        openThreadCount: 1,
                        totalThreadCount: 2,
                    }];
                }
                if (queryText.includes('FROM circle_discussion_messages')) {
                    expect(queryText).toContain("COALESCE(relevance_status, 'ready') = 'ready'");
                    return [{
                        payloadText: '我们已经基本收敛到结论 A。',
                        senderPubkey: 'pubkey-1',
                        senderHandle: 'alice',
                        createdAt: new Date('2026-03-24T21:10:00.000Z'),
                        relevanceScore: 0.92,
                        semanticScore: 0.92,
                    }];
                }
                if (queryText.includes('SELECT COALESCE(MAX(version), 0) + 1')) {
                    return [{ nextVersion: 1 }];
                }

                throw new Error(`unexpected query: ${queryText}`);
            }),
            $queryRawUnsafe: jest.fn(async () => ([{
                summaryId: 'circle-7-v1',
                circleId: 7,
                version: 1,
                issueMap: [{ title: 'LLM 总结入口', body: '当前共识：结论 A 已收敛。' }],
                conceptGraph: { nodes: [], edges: [] },
                viewpointBranches: [],
                factExplanationEmotionBreakdown: { facts: [], explanations: [], emotions: [] },
                emotionConflictContext: { tensionLevel: 'medium', notes: [] },
                sedimentationTimeline: [],
                openQuestions: [{ title: '还缺什么', body: '来源证据待补。' }],
                generatedAt: now,
                generatedBy: 'system_llm',
                generationMetadata: {
                    providerMode: 'builtin',
                    model: 'qwen2.5:7b',
                    promptAsset: 'circle-summary-inline',
                    promptVersion: 'v1',
                    sourceDigest: 'abc123',
                },
            }])),
        } as any;

        const snapshot = await ensureLatestCircleSummarySnapshot(prisma, {
            circleId: 7,
            now,
        });

        expect(loadCircleGhostSettingsPatchMock).toHaveBeenCalledWith(prisma, 7);
        expect(resolveCircleGhostSettingsMock).toHaveBeenCalled();
        expect(generateTextMock).toHaveBeenCalledTimes(1);
        expect(snapshot).toMatchObject({
            summaryId: 'circle-7-v1',
            generatedBy: 'system_llm',
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen2.5:7b',
                promptAsset: 'circle-summary-inline',
                promptVersion: 'v1',
                sourceDigest: 'abc123',
            },
        });
    });
});
