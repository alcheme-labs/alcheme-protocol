import { afterEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('ai', () => ({
    generateText: jest.fn(),
    streamText: jest.fn(),
    Output: {
        object: jest.fn((input) => input),
    },
    jsonSchema: jest.fn((schema) => schema),
}));

const generateStructuredOutputMock = jest.fn();

jest.mock('../discussion-intelligence/llm', () => ({
    generateStructuredOutput: generateStructuredOutputMock,
}));

import { generateText } from 'ai';

import { generateGhostDraft } from '../ghost-draft';
import { summarizeDiscussionThread } from '../discussion-summary';
import { judgeDiscussionTrigger } from '../discussion-intelligence/trigger-judge';
import { getPromptSchema, getSystemPrompt } from '../prompts/registry';
import { DISCUSSION_SEMANTIC_FACETS } from '../../services/discussion/analysis/types';
import * as draftDiscussionLifecycleService from '../../services/draftDiscussionLifecycle';

function readSemanticFacetEnum(schema: unknown): string[] {
    const value = schema as {
        properties?: {
            semantic_facets?: {
                items?: {
                    enum?: string[];
                };
            };
        };
    };
    return value.properties?.semantic_facets?.items?.enum ?? [];
}

describe('prompt registry integration', () => {
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('discussion prompt schemas use the canonical semantic facet enum', () => {
        expect(readSemanticFacetEnum(getPromptSchema('discussion-relevance'))).toEqual([
            ...DISCUSSION_SEMANTIC_FACETS,
        ]);
        expect(readSemanticFacetEnum(getPromptSchema('discussion-semantic-facets'))).toEqual([
            ...DISCUSSION_SEMANTIC_FACETS,
        ]);
    });

    test('discussion semantic facet system prompt documents every canonical facet', () => {
        const systemPrompt = getSystemPrompt('discussion-semantic-facets');
        for (const facet of DISCUSSION_SEMANTIC_FACETS) {
            expect(systemPrompt).toContain(`\`${facet}\``);
        }
    });

    test('ghost draft generation uses the registry-backed system prompt asset', async () => {
        (generateText as any).mockResolvedValueOnce({
            text: 'AI generated baseline draft.',
        });
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValueOnce([
            {
                id: '88',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 3,
                issueType: 'knowledge_supplement',
                state: 'proposed',
                createdBy: 5,
                createdAt: '2026-03-25T08:00:00.000Z',
                updatedAt: '2026-03-25T08:10:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: {
                    authorId: 5,
                    messageType: 'propose',
                    content: '需要补上验收人和时间线，避免正文停留在抽象建议层。',
                    createdAt: '2026-03-25T08:10:00.000Z',
                },
                messages: [
                    {
                        id: '1',
                        authorId: 5,
                        messageType: 'create',
                        content: '需要补上验收人和时间线，避免正文停留在抽象建议层。',
                        createdAt: '2026-03-25T08:00:00.000Z',
                    },
                ],
            },
        ] as any);

        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    text: 'Original post body',
                    tags: ['ghost'],
                    author: { handle: 'alice' },
                    circle: { name: 'Ghost Circle', description: 'AI discussion space' },
                    threadRoot: {
                        thread: [
                            { text: 'first reply' },
                            { text: 'second reply' },
                        ],
                    },
                })),
            },
            ghostDraftGeneration: {
                create: jest.fn(async ({ data }) => ({
                    id: 17,
                    draftPostId: data.draftPostId,
                    requestedByUserId: data.requestedByUserId,
                    origin: data.origin,
                    providerMode: data.providerMode,
                    model: data.model,
                    promptAsset: data.promptAsset,
                    promptVersion: data.promptVersion,
                    sourceDigest: data.sourceDigest,
                    ghostRunId: data.ghostRunId,
                    draftText: data.draftText,
                    createdAt: new Date('2026-03-24T10:00:00.000Z'),
                })),
            },
        } as any;

        await generateGhostDraft(prisma, 42, 9);

        expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
            system: getSystemPrompt('ghost-draft-comment'),
        }));
        const prompt = String(((generateText as any).mock.calls[0][0] as any).prompt || '');
        expect(prompt).toContain(
            JSON.stringify(getPromptSchema('ghost-draft-comment')),
        );
        expect(prompt).toContain('"suggested_text"');
        expect(prompt).toContain('Suggestion targets to revise');
        expect(prompt).toContain('Pending issue threads to address in this revision:');
        expect(prompt).toContain('需要补上验收人和时间线');
        expect(prompt).toContain('Current draft body:');
        expect(prompt).toContain('Match the primary language already used by the current draft body and the issue-thread summaries.');
        expect(prompt).not.toContain('@alice wrote:');
    });

    test('ghost draft generation excludes already accepted issue threads from the revision prompt', async () => {
        (generateText as any).mockResolvedValueOnce({
            text: JSON.stringify({
                suggestions: [
                    {
                        target_ref: 'paragraph:1',
                        summary: '补上开放问题的修订。',
                        suggested_text: '第二段：补上开放问题对应的修订建议。',
                        open_questions: [],
                    },
                ],
                confidence: 0.74,
            }),
        });
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValueOnce([
            {
                id: '88',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 3,
                issueType: 'knowledge_supplement',
                state: 'accepted',
                createdBy: 5,
                createdAt: '2026-03-25T08:00:00.000Z',
                updatedAt: '2026-03-25T08:10:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: {
                    authorId: 5,
                    messageType: 'propose',
                    content: '这条已经 accepted，不应该继续进 AI 建议池。',
                    createdAt: '2026-03-25T08:10:00.000Z',
                },
                messages: [],
            },
            {
                id: '89',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:1',
                targetVersion: 3,
                issueType: 'question_and_supplement',
                state: 'open',
                createdBy: 6,
                createdAt: '2026-03-25T08:20:00.000Z',
                updatedAt: '2026-03-25T08:30:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: {
                    authorId: 6,
                    messageType: 'create',
                    content: '这条 open 线程应该进入 AI 建议池。',
                    createdAt: '2026-03-25T08:30:00.000Z',
                },
                messages: [],
            },
        ] as any);

        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    text: 'Original post body',
                    tags: ['ghost'],
                    author: { handle: 'alice' },
                    circle: { name: 'Ghost Circle', description: 'AI discussion space' },
                    threadRoot: { thread: [] },
                })),
            },
            ghostDraftGeneration: {
                create: jest.fn(async ({ data }) => ({
                    id: 18,
                    draftPostId: data.draftPostId,
                    requestedByUserId: data.requestedByUserId,
                    origin: data.origin,
                    providerMode: data.providerMode,
                    model: data.model,
                    promptAsset: data.promptAsset,
                    promptVersion: data.promptVersion,
                    sourceDigest: data.sourceDigest,
                    ghostRunId: data.ghostRunId,
                    draftText: data.draftText,
                    createdAt: new Date('2026-03-24T10:00:00.000Z'),
                })),
            },
        } as any;

        await generateGhostDraft(prisma, 42, 9);

        const prompt = String(((generateText as any).mock.calls.at(-1)?.[0] as any)?.prompt || '');
        expect(prompt).toContain('这条 open 线程应该进入 AI 建议池。');
        expect(prompt).not.toContain('这条已经 accepted，不应该继续进 AI 建议池。');
    });

    test('discussion summary llm path uses the registry-backed system prompt asset', async () => {
        (generateText as any).mockResolvedValueOnce({
            text: '当前共识：结论 A 已形成。未解决问题：证据链待补。下一步建议：补齐引用。',
        });

        await summarizeDiscussionThread({
            circleName: 'Alpha',
            useLLM: true,
            messages: [
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice-pubkey',
                    text: '我们已经对结论 A 形成了共识。',
                    createdAt: new Date('2026-03-24T21:00:00.000Z'),
                    relevanceScore: 0.95,
                },
            ],
        });

        expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
            system: getSystemPrompt('discussion-summary'),
        }));
    });

    test('trigger judge continues to use registry-backed system prompt and schema', async () => {
        (generateStructuredOutputMock as any).mockResolvedValueOnce({
            should_trigger: true,
            recommended_action: 'notify_only',
            reason_code: 'llm_signal_pass',
            reason: 'discussion should notify',
            confidence: 0.8,
            risk_flags: [],
        });

        await judgeDiscussionTrigger({
            circleName: 'Alpha',
            mode: 'notify_only',
            allowLLM: true,
            messageCount: 12,
            focusedRatio: 0.8,
            questionCount: 3,
            participantCount: 4,
            spamRatio: 0.1,
            topicHeat: 0.7,
            summary: '当前共识正在收敛。',
        });

        expect(generateStructuredOutputMock).toHaveBeenCalledWith(expect.objectContaining({
            systemPrompt: getSystemPrompt('discussion-trigger-judge'),
        }));
        expect(((generateStructuredOutputMock as any).mock.calls[0][0] as any).userPrompt).toContain(
            JSON.stringify(getPromptSchema('discussion-trigger-judge')),
        );
    });
});
