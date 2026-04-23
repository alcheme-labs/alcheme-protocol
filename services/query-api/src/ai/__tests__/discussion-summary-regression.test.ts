import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateAiTextMock = jest.fn() as any;

jest.mock('../provider', () => {
    const actual = jest.requireActual('../provider') as Record<string, unknown>;
    return {
        ...actual,
        generateAiText: generateAiTextMock,
    };
});

import { summarizeDiscussionThread } from '../discussion-summary';

interface SummaryFixtureMessage {
    senderHandle: string | null;
    senderPubkey: string;
    text: string;
    createdAt: string;
    relevanceScore?: number | null;
}

interface SummaryFixtureCase {
    input: {
        circleName?: string | null;
        circleDescription?: string | null;
        useLLM?: boolean;
        messages: SummaryFixtureMessage[];
    };
    llmText?: string;
    expected: {
        method: 'rule' | 'llm';
        messageCount: number;
        summary: string;
        generationMetadata: {
            providerMode: string;
            model: string;
            promptAsset: string;
            promptVersion: string;
        };
    };
}

function loadFixture(): Record<string, SummaryFixtureCase> {
    const filePath = path.resolve(__dirname, '../evals/fixtures/discussion-summary.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, SummaryFixtureCase>;
}

function toInputMessages(messages: SummaryFixtureMessage[]) {
    return messages.map((message) => ({
        ...message,
        createdAt: new Date(message.createdAt),
    }));
}

describe('discussion summary regression pack', () => {
    const fixture = loadFixture();

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('rule summary fixture stays stable', async () => {
        const current = fixture.rule_consensus;
        const result = await summarizeDiscussionThread({
            ...current.input,
            messages: toInputMessages(current.input.messages),
        });

        expect(result.summary).toBe(current.expected.summary);
        expect(result.method).toBe(current.expected.method);
        expect(result.messageCount).toBe(current.expected.messageCount);
        expect(result.generationMetadata).toMatchObject(current.expected.generationMetadata);
        expect(result.generationMetadata.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('llm summary fixture stays stable', async () => {
        const current = fixture.llm_consensus;
        generateAiTextMock.mockResolvedValueOnce({
            text: current.llmText as string,
            providerMode: 'builtin',
            model: 'qwen2.5:7b',
        } as any);

        const result = await summarizeDiscussionThread({
            ...current.input,
            messages: toInputMessages(current.input.messages),
        });

        expect(generateAiTextMock).toHaveBeenCalledTimes(1);
        expect(result.summary).toBe(current.expected.summary);
        expect(result.method).toBe(current.expected.method);
        expect(result.messageCount).toBe(current.expected.messageCount);
        expect(result.generationMetadata).toMatchObject(current.expected.generationMetadata);
        expect(result.generationMetadata.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('llm summary strips think traces and recovers structured summary from json output', async () => {
        generateAiTextMock.mockResolvedValueOnce({
            text: [
                '好，我现在需要先梳理讨论重点。',
                '确保语言简洁，只基于提供内容，不编造。',
                '</think>',
                '```json',
                '{',
                '  "summary": "当前共识：先聚焦加入后的前十分钟。\\n未解决问题：身份创建和首条发言引导仍然割裂。\\n下一步建议：先把首屏步骤与系统提示收束成一条新手路径。",',
                '  "consensus": "先聚焦加入后的前十分钟。",',
                '  "open_questions": ["身份创建和首条发言引导仍然割裂。"],',
                '  "next_actions": ["先把首屏步骤与系统提示收束成一条新手路径。"],',
                '  "confidence": 0.78',
                '}',
                '```',
            ].join('\n'),
            providerMode: 'builtin',
            model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        } as any);

        const result = await summarizeDiscussionThread({
            circleName: '新成员入门流程优化',
            useLLM: true,
            messages: toInputMessages([
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice-pubkey',
                    text: '我们先聚焦新成员加入后的前十分钟体验，尤其是身份创建、加入圈层和首条发言。',
                    createdAt: '2026-04-08T01:00:00.000Z',
                    relevanceScore: 0.9,
                },
            ]),
        });

        expect(result.method).toBe('llm');
        expect(result.summary).toBe([
            '当前共识：先聚焦加入后的前十分钟。',
            '未解决问题：身份创建和首条发言引导仍然割裂。',
            '下一步建议：先把首屏步骤与系统提示收束成一条新手路径。',
        ].join('\n'));
        expect(result.summary).not.toContain('</think>');
        expect(result.summary).not.toContain('```json');
    });

    test('malformed llm self-talk falls back to the rule summary instead of leaking into the result', async () => {
        generateAiTextMock.mockResolvedValueOnce({
            text: [
                '好，我现在需要帮用户总结一个关于圈层欢迎页和首条发言流程优化的讨论。',
                '现在，我需要把这些信息浓缩成一个JSON摘要。',
                '我会先梳理当前共识、未解决问题和下一步建议。',
            ].join('\n'),
            providerMode: 'builtin',
            model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
            rawFinishReason: 'stop',
        } as any);

        const result = await summarizeDiscussionThread({
            circleName: '圈层欢迎页与首条发言流程优化',
            useLLM: true,
            messages: toInputMessages([
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice-pubkey',
                    text: '欢迎页现在信息太散了，新成员看完还是不知道下一步先做什么。',
                    createdAt: '2026-04-10T03:00:00.000Z',
                    relevanceScore: 0.92,
                },
                {
                    senderHandle: 'bob',
                    senderPubkey: 'bob-pubkey',
                    text: '那是不是应该先把欢迎页、加入步骤和首条发言引导收成一条清晰路径？',
                    createdAt: '2026-04-10T03:01:00.000Z',
                    relevanceScore: 0.9,
                },
            ]),
        });

        expect(result.method).toBe('rule');
        expect(result.summary).not.toContain('我现在需要帮用户总结');
        expect(result.summary).not.toContain('JSON摘要');
        expect(result.fallbackDiagnostics).toMatchObject({
            attemptedMethod: 'llm',
            reason: 'llm_output_unparseable',
            rawFinishReason: 'stop',
        });
        expect(result.fallbackDiagnostics?.rawResponseSnippet).toContain('我现在需要帮用户总结');
    });

    test('truncated llm output records a length fallback reason with the raw response snippet', async () => {
        generateAiTextMock.mockResolvedValueOnce({
            text: '好，我现在需要处理这个用户的查询。用户希望我作为讨论总结器，帮助他们总结这段讨论。',
            providerMode: 'builtin',
            model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
            rawFinishReason: 'length',
        } as any);

        const result = await summarizeDiscussionThread({
            circleName: '新成员加入圈层后的前10分钟体验优化',
            useLLM: true,
            messages: toInputMessages([
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice-pubkey',
                    text: '欢迎页和加入流程之间缺少一条很清楚的新手路径。',
                    createdAt: '2026-04-10T22:12:51.365Z',
                    relevanceScore: 0.91,
                },
                {
                    senderHandle: 'bob',
                    senderPubkey: 'bob-pubkey',
                    text: '那是不是应该先把欢迎提示和首条发言引导收成一个最小闭环？',
                    createdAt: '2026-04-10T22:12:59.268Z',
                    relevanceScore: 0.92,
                },
            ]),
        });

        expect(result.method).toBe('rule');
        expect(result.fallbackDiagnostics).toMatchObject({
            attemptedMethod: 'llm',
            reason: 'llm_output_truncated',
            rawFinishReason: 'length',
        });
        expect(result.fallbackDiagnostics?.rawResponseSnippet).toContain('用户希望我作为讨论总结器');
    });

    test('llm summary requests structured json output with a token budget large enough for the schema response', async () => {
        generateAiTextMock.mockResolvedValueOnce({
            text: JSON.stringify({
                summary: '讨论先聚焦新成员加入后的前十分钟体验。',
                consensus: '先收小到身份创建、加入圈层、欢迎提示和首条发言四个节点。',
                open_questions: ['如何验证提示链路是否真正变清晰？'],
                next_actions: ['先定义最低成功标准并做小范围试点。'],
                confidence: 0.72,
            }),
            providerMode: 'builtin',
            model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        } as any);

        await summarizeDiscussionThread({
            circleName: '新成员加入圈层后的前10分钟体验优化',
            circleDescription: '聚焦身份创建、加入圈层、欢迎提示和首条发言的关键问题。',
            useLLM: true,
            messages: toInputMessages([
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice-pubkey',
                    text: '我们先聚焦四个关键节点，不要把范围放太大。',
                    createdAt: '2026-04-10T22:13:28.388Z',
                    relevanceScore: 0.93,
                },
                {
                    senderHandle: 'bob',
                    senderPubkey: 'bob-pubkey',
                    text: '最低成功标准也要先定清楚，比如5分钟内理解状态，10分钟内完成加入并发消息。',
                    createdAt: '2026-04-10T22:13:35.075Z',
                    relevanceScore: 0.94,
                },
            ]),
        });

        expect(generateAiTextMock).toHaveBeenCalledTimes(1);
        expect(generateAiTextMock).toHaveBeenCalledWith(expect.objectContaining({
            maxOutputTokens: expect.any(Number),
            responseFormat: expect.objectContaining({
                type: 'json',
                name: 'discussion_summary',
            }),
        }));
        expect((generateAiTextMock.mock.calls[0][0] as any).maxOutputTokens).toBeGreaterThan(240);
    });

    test('llm prompt follows the discussion language instead of forcing chinese output', async () => {
        generateAiTextMock.mockResolvedValueOnce({
            text: [
                'Current consensus: focus on the first ten minutes after a member joins.',
                'Unresolved questions: identity creation and first-message guidance still feel fragmented.',
                'Next steps: turn the onboarding path into a single guided flow.',
            ].join('\n'),
            providerMode: 'builtin',
            model: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
        } as any);

        const result = await summarizeDiscussionThread({
            circleName: 'New Member Onboarding',
            useLLM: true,
            messages: toInputMessages([
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice-pubkey',
                    text: 'We should focus on the first ten minutes after a member joins, especially identity setup and the first post.',
                    createdAt: '2026-04-08T02:00:00.000Z',
                    relevanceScore: 0.92,
                },
            ]),
        });

        expect(generateAiTextMock).toHaveBeenCalledTimes(1);
        expect((generateAiTextMock.mock.calls[0][0] as any).userPrompt).toContain(
            'Summarize the discussion below in the same language used by the discussion participants.',
        );
        expect((generateAiTextMock.mock.calls[0][0] as any).userPrompt).not.toContain('输出中文摘要');
        expect(result.summary).toContain('Current consensus');
        expect(result.summary).not.toContain('当前共识');
    });

    test('rule summary follows the discussion language for english threads', async () => {
        const result = await summarizeDiscussionThread({
            circleName: 'Onboarding Improvements',
            useLLM: false,
            messages: toInputMessages([
                {
                    senderHandle: 'A',
                    senderPubkey: 'sender-a',
                    text: 'The first ten minutes after joining still feel fragmented, and new members do not know what to do next.',
                    createdAt: '2026-04-05T20:00:00.000Z',
                    focusScore: 0.52,
                    semanticFacets: ['problem'],
                } as any,
                {
                    senderHandle: 'B',
                    senderPubkey: 'sender-b',
                    text: 'A safe next step is to simplify identity creation and first-message guidance before touching the rest of the flow.',
                    createdAt: '2026-04-05T20:01:00.000Z',
                    focusScore: 0.61,
                    semanticFacets: ['proposal'],
                } as any,
            ]),
        });

        expect(result.method).toBe('rule');
        expect(result.summary).toContain('Unresolved questions');
        expect(result.summary).toContain('Latest signals');
        expect(result.summary).not.toContain('未解决问题');
        expect(result.summary).not.toContain('最新进展');
    });

    test('rule summary surfaces problem facets as unresolved issues', async () => {
        const result = await summarizeDiscussionThread({
            circleName: '讨论沉淀实验室',
            messages: toInputMessages([
                {
                    senderHandle: 'A',
                    senderPubkey: 'sender-a',
                    text: '我这两天有点焦虑，我们圈子里的讨论经常很热，但聊完就散了，最后没有明确结论，也没人知道下一步该做什么。',
                    createdAt: '2026-04-05T20:00:00.000Z',
                    focusScore: 0.52,
                    semanticFacets: ['problem', 'emotion'],
                } as any,
                {
                    senderHandle: 'B',
                    senderPubkey: 'sender-b',
                    text: '那是不是可以先试一个保守方案：系统先生成一版草稿，只写背景、核心问题和下一步建议。',
                    createdAt: '2026-04-05T20:01:00.000Z',
                    focusScore: 0.61,
                    semanticFacets: ['question', 'proposal'],
                } as any,
            ]),
        });

        expect(result.method).toBe('rule');
        expect(result.summary).toContain('未解决问题');
        expect(result.summary).toContain('聊完就散');
    });
});
