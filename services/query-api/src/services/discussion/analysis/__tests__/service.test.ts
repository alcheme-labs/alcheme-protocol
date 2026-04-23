import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const loadDiscussionTopicProfileMock = jest.fn();
const analyzeDiscussionMessageMock = jest.fn();
const analyzeDiscussionSemanticFacetsMock = jest.fn();
const embedDiscussionTextMock = jest.fn();

jest.mock('../../topicProfile', () => ({
    loadDiscussionTopicProfile: (...args: unknown[]) => loadDiscussionTopicProfileMock(...args),
}));

jest.mock('../../../../ai/discussion-intelligence/analyzer', () => ({
    analyzeDiscussionMessage: (...args: unknown[]) => analyzeDiscussionMessageMock(...args),
    analyzeDiscussionSemanticFacets: (...args: unknown[]) => analyzeDiscussionSemanticFacetsMock(...args),
}));

jest.mock('../../../../ai/embedding', () => ({
    embedDiscussionText: (...args: unknown[]) => embedDiscussionTextMock(...args),
    cosineSimilarity: (a: number[], b: number[]) => {
        if (a.length === 0 || b.length === 0) return 0;
        const dot = a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
        const aNorm = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
        const bNorm = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
        if (aNorm === 0 || bNorm === 0) return 0;
        return Math.max(0, Math.min(1, dot / (aNorm * bNorm)));
    },
}));

import { analyzeDiscussionMessageCanonical } from '../service';

describe('canonical discussion analysis service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (analyzeDiscussionSemanticFacetsMock as any).mockResolvedValue(null);
    });

    test('uses embedding-first scoring and semantic facets when embeddings are available', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:7:abcd',
            snapshotText: '异步编程讨论组\nSource Materials:\n- await 让 IO 等待脱离主流程',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any)
            .mockResolvedValueOnce({
                semanticScore: 0.3,
                qualityScore: 0.72,
                spamScore: 0.08,
                confidence: 0.55,
                isOnTopic: false,
                method: 'rule',
                rationale: 'rule_fallback',
            })
            .mockResolvedValueOnce({
                semanticScore: 0.74,
                qualityScore: 0.76,
                spamScore: 0.04,
                confidence: 0.82,
                isOnTopic: true,
                method: 'hybrid',
                rationale: 'llm_confirmed_topic_alignment',
            });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.5, 0.5],
            providerMode: 'builtin',
            model: 'nomic-embed-text',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {} as any,
            circleId: 7,
            text: '我建议先看事件循环里的微任务调度问题',
            authorAnnotations: ['explanation'],
        });

        expect(result.relevanceStatus).toBe('ready');
        expect(result.actualMode).toBe('embedding_llm');
        expect(result.relevanceMethod).toBe('embedding_llm');
        expect(result.embeddingScore).toBeGreaterThan(0.6);
        expect(result.focusLabel).toBe('focused');
        expect(result.semanticFacets).toEqual(expect.arrayContaining(['proposal', 'explanation']));
        expect(result.topicProfileVersion).toBe('topic:7:abcd');
    });

    test('falls back to rule-only analysis when topic profile embedding is unavailable', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:8:efgh',
            snapshotText: '测试圈层',
            embedding: null,
        });
        (analyzeDiscussionMessageMock as any).mockResolvedValue({
            semanticScore: 0.61,
            qualityScore: 0.66,
            spamScore: 0.03,
            confidence: 0.58,
            isOnTopic: true,
            method: 'rule',
            rationale: 'rule_signals_indicate_topic_alignment',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {} as any,
            circleId: 8,
            text: '这个问题为什么会阻塞主线程？',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('fallback_rule');
        expect(result.relevanceMethod).toBe('fallback_rule');
        expect(result.embeddingScore).toBeNull();
        expect(result.isFeatured).toBe(false);
        expect(result.semanticFacets).toContain('question');
    });

    test('keeps provider rate-limit diagnostics when embedding falls back to rule', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:9:ijkl',
            snapshotText: '讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any).mockResolvedValue({
            semanticScore: 0.2,
            qualityScore: 0.7,
            spamScore: 0.01,
            confidence: 0.6,
            isOnTopic: false,
            method: 'rule',
            rationale: 'rule_fallback',
        });
        (embedDiscussionTextMock as any).mockRejectedValue(Object.assign(
            new Error('RPM limit exceeded. Please complete identity verification to lift the restriction.'),
            { code: 'provider_rate_limited' },
        ));

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {} as any,
            circleId: 9,
            text: '那我们是不是应该让系统在讨论成熟到一定程度时，自动帮我们起一个草稿？',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('fallback_rule');
        expect(result.focusLabel).toBe('off_topic');
        expect(result.analysisErrorCode).toBe('discussion_provider_rate_limited');
        expect(result.analysisErrorMessage).toContain('RPM limit exceeded');
    });

    test('adds recent discussion context to second-pass analysis and compresses long windows into a summary', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => ([
                {
                    payloadText: '我这两天有点焦虑，我们圈子里的讨论经常很热，但聊完就散了。',
                    senderHandle: 'A',
                    senderPubkey: 'sender-a',
                    focusScore: 0.52,
                    semanticFacets: ['emotion'],
                    createdAt: new Date('2026-04-05T20:00:00.000Z'),
                },
                {
                    payloadText: '那我们是不是应该让系统在讨论成熟到一定程度时，自动帮我们起一个草稿？',
                    senderHandle: 'B',
                    senderPubkey: 'sender-b',
                    focusScore: 0.64,
                    semanticFacets: ['question', 'proposal'],
                    createdAt: new Date('2026-04-05T20:01:00.000Z'),
                },
                {
                    payloadText: '我担心如果系统太激进，会把还没想清楚的争论过早包装成正式方案，所以条件要更明确一些。'.repeat(6),
                    senderHandle: 'A',
                    senderPubkey: 'sender-a',
                    focusScore: 0.6,
                    semanticFacets: ['emotion', 'proposal'],
                    createdAt: new Date('2026-04-05T20:02:00.000Z'),
                },
                {
                    payloadText: '如果系统只是提醒而不直接替我们下结论，大家更容易接受，而且后续也更方便人工修订。'.repeat(4),
                    senderHandle: 'B',
                    senderPubkey: 'sender-b',
                    focusScore: 0.58,
                    semanticFacets: ['proposal', 'explanation'],
                    createdAt: new Date('2026-04-05T20:03:00.000Z'),
                },
                {
                    payloadText: '我们已经有几次深入讨论最后没人整理，所以我现在更在意的是沉淀机制，而不是单次讨论有多热闹。'.repeat(4),
                    senderHandle: 'A',
                    senderPubkey: 'sender-a',
                    focusScore: 0.57,
                    semanticFacets: ['emotion', 'problem'],
                    createdAt: new Date('2026-04-05T20:04:00.000Z'),
                },
                {
                    payloadText: '对，我会这么看：第一，要有来回讨论，不是单人刷屏；第二，要围绕同一个主题；第三，要出现可执行提案；第四，要能看出真实顾虑。'.repeat(3),
                    senderHandle: 'B',
                    senderPubkey: 'sender-b',
                    focusScore: 0.59,
                    semanticFacets: ['criteria'],
                    createdAt: new Date('2026-04-05T20:04:00.000Z'),
                },
            ])),
        } as any;
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:abcd',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any)
            .mockResolvedValueOnce({
                semanticScore: 0.22,
                qualityScore: 0.7,
                spamScore: 0.02,
                confidence: 0.55,
                isOnTopic: false,
                method: 'rule',
                rationale: 'rule_fallback',
            })
            .mockResolvedValueOnce({
                semanticScore: 0.76,
                qualityScore: 0.8,
                spamScore: 0.01,
                confidence: 0.84,
                isOnTopic: true,
                method: 'hybrid',
                rationale: 'context_confirms_topic_alignment',
            });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.45, 0.55],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        await analyzeDiscussionMessageCanonical({
            prisma,
            circleId: 51,
            envelopeId: 'env-51',
            text: '那你觉得最低条件应该是什么？是不是至少要有两个以上的人来回讨论，而且要出现明确问题？',
            authorAnnotations: [],
        });

        expect(analyzeDiscussionMessageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            useLLM: true,
            recentContext: expect.stringContaining('Recent discussion summary'),
        }));
        expect(analyzeDiscussionMessageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            recentContext: expect.stringContaining('Unresolved problems'),
        }));
        expect(analyzeDiscussionMessageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            recentContext: expect.stringContaining('Decision criteria'),
        }));
    });

    test('uses recent context LLM pass for low-embedding follow-up questions', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => ([
                {
                    payloadText: 'Progression is a structure for knowledge, not a hierarchy for people.',
                    senderHandle: 'A',
                    senderPubkey: 'sender-a',
                    focusScore: 0.47,
                    semanticFacets: ['explanation'],
                    createdAt: new Date('2026-04-05T20:00:00.000Z'),
                },
                {
                    payloadText: 'Real contribution should stay visible across the whole chain of participation.',
                    senderHandle: 'B',
                    senderPubkey: 'sender-b',
                    focusScore: 0.45,
                    semanticFacets: [],
                    createdAt: new Date('2026-04-05T20:01:00.000Z'),
                },
            ])),
        } as any;
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:189:thin',
            snapshotText: '圈层主题：Alcheme Founder Vision Interview\n圈层描述：How discussion becomes knowledge',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any)
            .mockResolvedValueOnce({
                semanticScore: 0.26,
                qualityScore: 0.55,
                spamScore: 0.01,
                confidence: 0.55,
                isOnTopic: false,
                method: 'rule',
                rationale: 'rule_fallback',
            })
            .mockResolvedValueOnce({
                semanticScore: 0.72,
                qualityScore: 0.76,
                spamScore: 0.01,
                confidence: 0.84,
                isOnTopic: true,
                method: 'hybrid',
                rationale: 'recent_context_confirms_follow_up',
                semanticFacets: ['question'],
            });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.36, Math.sqrt(1 - 0.36 * 0.36)],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma,
            circleId: 189,
            envelopeId: 'env-contribution-question',
            text: 'Then why does contribution need to be part of the structure too?',
            authorAnnotations: [],
        });

        expect(analyzeDiscussionMessageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
            useLLM: true,
            recentContext: expect.stringContaining('Real contribution should stay visible'),
        }));
        expect(result.actualMode).toBe('embedding_llm');
        expect(result.semanticScore).toBeGreaterThan(0.5);
        expect(result.focusLabel).toBe('contextual');
    });

    test('uses storage precision before assigning the contextual boundary label', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:precision',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any).mockResolvedValue({
            semanticScore: 0.3496,
            qualityScore: 0.72,
            spamScore: 0,
            confidence: 0.55,
            isOnTopic: false,
            method: 'rule',
            rationale: 'rule_fallback',
        });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.3496, Math.sqrt(1 - 0.3496 * 0.3496)],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {} as any,
            circleId: 51,
            envelopeId: 'env-precision',
            text: 'Contribution structure sits near the topic boundary.',
            authorAnnotations: [],
        });

        expect(analyzeDiscussionMessageMock).toHaveBeenCalledTimes(1);
        expect(result.focusScore).toBe(0.35);
        expect(result.focusLabel).toBe('contextual');
    });

    test('prefers llm semantic facets over regex fallback when second-pass returns them', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:llm-facets',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any)
            .mockResolvedValueOnce({
                semanticScore: 0.24,
                qualityScore: 0.71,
                spamScore: 0.02,
                confidence: 0.55,
                isOnTopic: false,
                method: 'rule',
                rationale: 'rule_fallback',
            })
            .mockResolvedValueOnce({
                semanticScore: 0.58,
                qualityScore: 0.8,
                spamScore: 0.01,
                confidence: 0.84,
                isOnTopic: true,
                method: 'hybrid',
                rationale: 'context_confirms_topic_alignment',
                semanticFacets: ['proposal', 'question'],
            });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.45, 0.55],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {
                $queryRaw: jest.fn(async () => []),
            } as any,
            circleId: 51,
            envelopeId: 'env-llm-facets',
            text: '我这两天有点焦虑，我们圈子里的讨论经常很热，但聊完就散了，最后没有明确结论，也没人知道下一步该做什么。',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('embedding_llm');
        expect(result.semanticFacets).toEqual(['proposal', 'question']);
        expect(result.semanticFacets).not.toContain('emotion');
    });

    test('uses dedicated semantic-facets llm pass even when relevance stays embedding-only', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:facet-pass',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any).mockResolvedValue({
            semanticScore: 0.12,
            qualityScore: 0.72,
            spamScore: 0.03,
            confidence: 0.55,
            isOnTopic: false,
            method: 'rule',
            rationale: 'rule_fallback',
        });
        (analyzeDiscussionSemanticFacetsMock as any).mockResolvedValue(['proposal']);
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [1, 0],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {} as any,
            circleId: 51,
            text: '对，我会这么看：第一，要有来回讨论，不是单人刷屏；第二，要围绕同一个主题；第三，要出现可执行提案；第四，要能看出真实顾虑。',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('embedding');
        expect(result.semanticFacets).toEqual(['proposal']);
    });

    test('passes circle topic context to semantic-facets pass and keeps an explicit empty AI result', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:facet-empty',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any).mockResolvedValue({
            semanticScore: 0.12,
            qualityScore: 0.74,
            spamScore: 0.03,
            confidence: 0.55,
            isOnTopic: false,
            method: 'rule',
            rationale: 'rule_fallback',
        });
        (analyzeDiscussionSemanticFacetsMock as any).mockResolvedValue([]);
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [1, 0],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {} as any,
            circleId: 51,
            text: '这个问题为什么会阻塞主线程？',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('embedding');
        expect(analyzeDiscussionSemanticFacetsMock).toHaveBeenCalledWith(expect.objectContaining({
            circleContext: '圈层主题：讨论沉淀实验室',
            text: '这个问题为什么会阻塞主线程？',
        }));
        expect(result.semanticFacets).toEqual([]);
    });

    test('promotes strong proposal-and-question messages to focused when semantic score is mid-high', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:focused',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any)
            .mockResolvedValueOnce({
                semanticScore: 0.22,
                qualityScore: 0.72,
                spamScore: 0.01,
                confidence: 0.55,
                isOnTopic: false,
                method: 'rule',
                rationale: 'rule_fallback',
            })
            .mockResolvedValueOnce({
                semanticScore: 0.57,
                qualityScore: 0.81,
                spamScore: 0.01,
                confidence: 0.84,
                isOnTopic: true,
                method: 'hybrid',
                rationale: 'context_confirms_topic_alignment',
            });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.45, 0.55],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {
                $queryRaw: jest.fn(async () => []),
            } as any,
            circleId: 51,
            envelopeId: 'env-focused',
            text: '那我们是不是应该让系统在讨论成熟到一定程度时，自动帮我们起一个草稿，把核心分歧和候选方案先沉淀下来？',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('embedding_llm');
        expect(result.focusScore).toBeGreaterThanOrEqual(0.5);
        expect(result.semanticFacets).toEqual(expect.arrayContaining(['question', 'proposal']));
        expect(result.focusLabel).toBe('focused');
    });

    test('keeps emotion-heavy reflection contextual when it lacks enough strong semantic facets', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:51:contextual',
            snapshotText: '圈层主题：讨论沉淀实验室',
            embedding: [1, 0],
        });
        (analyzeDiscussionMessageMock as any)
            .mockResolvedValueOnce({
                semanticScore: 0.24,
                qualityScore: 0.7,
                spamScore: 0.02,
                confidence: 0.55,
                isOnTopic: false,
                method: 'rule',
                rationale: 'rule_fallback',
            })
            .mockResolvedValueOnce({
                semanticScore: 0.52,
                qualityScore: 0.76,
                spamScore: 0.01,
                confidence: 0.82,
                isOnTopic: true,
                method: 'hybrid',
                rationale: 'context_confirms_topic_alignment',
            });
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.44, 0.56],
            providerMode: 'builtin',
            model: 'BAAI/bge-m3',
        });

        const result = await analyzeDiscussionMessageCanonical({
            prisma: {
                $queryRaw: jest.fn(async () => []),
            } as any,
            circleId: 51,
            envelopeId: 'env-contextual',
            text: '我这两天有点焦虑，我们圈子里的讨论经常很热，但聊完就散了，最后没有明确结论，也没人知道下一步该做什么。',
            authorAnnotations: [],
        });

        expect(result.actualMode).toBe('embedding_llm');
        expect(result.semanticFacets).toContain('emotion');
        expect(result.focusLabel).toBe('contextual');
    });
});
