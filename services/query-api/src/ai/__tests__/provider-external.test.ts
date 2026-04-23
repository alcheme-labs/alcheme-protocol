import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('ai', () => ({
    generateText: jest.fn(),
    streamText: jest.fn(),
}));

import { generateText } from 'ai';

import { serviceConfig } from '../../config/services';
import { generateGhostDraft } from '../ghost-draft';
import { summarizeDiscussionThread } from '../discussion-summary';
import { generateAiText } from '../provider';
import { generateCircleSummarySnapshot } from '../../services/circleSummary/generator';
import * as draftDiscussionLifecycleService from '../../services/draftDiscussionLifecycle';

function makeExternalJsonResponse(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as Response;
}

function getQueryText(query: any): string {
    return Array.isArray(query?.strings)
        ? query.strings.join(' ')
        : String(query || '');
}

describe('external ai mode', () => {
    const originalAiMode = serviceConfig.ai.mode;
    const originalExternalUrl = serviceConfig.ai.externalUrl;
    const originalExternalTimeoutMs = (serviceConfig.ai as any).externalTimeoutMs;
    const originalExternalPrivateContentMode = (serviceConfig.ai as any).externalPrivateContentMode;
    const originalFetch = globalThis.fetch;
    const originalScoringModel = process.env.SCORING_MODEL;
    const originalGhostDraftModel = process.env.GHOST_DRAFT_MODEL;
    const originalDiscussionSummaryModel = process.env.DISCUSSION_SUMMARY_MODEL;

    beforeEach(() => {
        jest.clearAllMocks();
        serviceConfig.ai.mode = 'external';
        serviceConfig.ai.externalUrl = 'https://external.example/ai';
        (serviceConfig.ai as any).externalTimeoutMs = 2500;
        (serviceConfig.ai as any).externalPrivateContentMode = 'deny';
        process.env.SCORING_MODEL = 'qwen2.5:7b';
        process.env.GHOST_DRAFT_MODEL = 'llama3.1:8b';
        process.env.DISCUSSION_SUMMARY_MODEL = 'qwen2.5:7b';
    });

    afterEach(() => {
        serviceConfig.ai.mode = originalAiMode;
        serviceConfig.ai.externalUrl = originalExternalUrl;
        (serviceConfig.ai as any).externalTimeoutMs = originalExternalTimeoutMs;
        (serviceConfig.ai as any).externalPrivateContentMode = originalExternalPrivateContentMode;
        globalThis.fetch = originalFetch;
        if (originalScoringModel === undefined) {
            delete process.env.SCORING_MODEL;
        } else {
            process.env.SCORING_MODEL = originalScoringModel;
        }
        if (originalGhostDraftModel === undefined) {
            delete process.env.GHOST_DRAFT_MODEL;
        } else {
            process.env.GHOST_DRAFT_MODEL = originalGhostDraftModel;
        }
        if (originalDiscussionSummaryModel === undefined) {
            delete process.env.DISCUSSION_SUMMARY_MODEL;
        } else {
            process.env.DISCUSSION_SUMMARY_MODEL = originalDiscussionSummaryModel;
        }
    });

    test('provider routes text generation to AI_EXTERNAL_URL instead of builtin gateway', async () => {
        const fetchMock = jest.fn(async () => makeExternalJsonResponse({
            text: 'external draft text',
        }));
        globalThis.fetch = fetchMock as any;

        const result = await generateAiText({
            task: 'ghost-draft',
            systemPrompt: 'system prompt',
            userPrompt: 'user prompt',
            temperature: 0.4,
            maxOutputTokens: 128,
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'https://external.example/ai/generate-text',
            expect.objectContaining({
                method: 'POST',
            }),
        );
        expect(generateText).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            text: 'external draft text',
            providerMode: 'external',
            model: 'llama3.1:8b',
        });
    });

    test('provider propagates external response errors instead of silently falling back', async () => {
        const fetchMock = jest.fn(async () => makeExternalJsonResponse({
            error: 'upstream overloaded',
        }, 503));
        globalThis.fetch = fetchMock as any;

        await expect(generateAiText({
            task: 'discussion-summary',
            systemPrompt: 'system prompt',
            userPrompt: 'user prompt',
        })).rejects.toThrow(/upstream overloaded/i);
    });

    test('provider propagates external request timeouts instead of hanging or falling back', async () => {
        (serviceConfig.ai as any).externalTimeoutMs = 5;
        const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
            const signal = init?.signal;
            return await new Promise<Response>((_resolve, reject) => {
                signal?.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            });
        });
        globalThis.fetch = fetchMock as any;

        await expect(generateAiText({
            task: 'ghost-draft',
            systemPrompt: 'system prompt',
            userPrompt: 'user prompt',
        })).rejects.toThrow(/timed out/i);
    });

    test('ghost draft generation persists external provider provenance while keeping the same artifact contract', async () => {
        (serviceConfig.ai as any).externalPrivateContentMode = 'allow';
        const fetchMock = jest.fn(async () => makeExternalJsonResponse({
            text: 'External AI generated baseline draft.',
        }));
        globalThis.fetch = fetchMock as any;
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValueOnce([
            {
                id: '31',
                draftPostId: 42,
                targetType: 'paragraph',
                targetRef: 'paragraph:0',
                targetVersion: 2,
                issueType: 'knowledge_supplement',
                state: 'proposed',
                createdBy: 3,
                createdAt: '2026-03-25T08:00:00.000Z',
                updatedAt: '2026-03-25T08:10:00.000Z',
                latestResolution: null,
                latestApplication: null,
                latestMessage: {
                    authorId: 3,
                    messageType: 'create',
                    content: '需要把讨论里确认的补充说明合并进正文。',
                    createdAt: '2026-03-25T08:10:00.000Z',
                },
                messages: [
                    {
                        id: '1',
                        authorId: 3,
                        messageType: 'create',
                        content: '需要把讨论里确认的补充说明合并进正文。',
                        createdAt: '2026-03-25T08:10:00.000Z',
                    },
                ],
            },
        ] as any);

        const createdAt = new Date('2026-03-24T10:00:00.000Z');
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
                    createdAt,
                })),
            },
        } as any;

        const result = await generateGhostDraft(prisma, 42, 9);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            generationId: 17,
            postId: 42,
            draftText: 'External AI generated baseline draft.',
            provenance: {
                providerMode: 'external',
                model: 'llama3.1:8b',
            },
        });
    });

    test('discussion and circle summaries consume external ai while preserving existing response contracts', async () => {
        const fetchMock = jest.fn(async () => makeExternalJsonResponse({
            text: '当前共识：结论 A 已形成。\n未解决问题：证据链待补。\n下一步建议：补齐引用。',
        }));
        globalThis.fetch = fetchMock as any;

        const discussion = await summarizeDiscussionThread({
            circleName: 'Alpha',
            circleDescription: '讨论场',
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

        expect(discussion).toMatchObject({
            method: 'llm',
            generationMetadata: {
                providerMode: 'external',
                model: 'qwen2.5:7b',
            },
        });

        const prisma = {
            $queryRaw: jest.fn(async (query: any) => {
                const queryText = getQueryText(query);
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
                    return [{
                        payloadText: '我们已经基本收敛到结论 A。',
                        senderPubkey: 'pubkey-1',
                        senderHandle: 'alice',
                        createdAt: new Date('2026-03-24T21:10:00.000Z'),
                        relevanceScore: 0.92,
                        semanticScore: 0.92,
                    }];
                }
                throw new Error(`unexpected query: ${queryText}`);
            }),
        } as any;

        const circleSummary = await generateCircleSummarySnapshot(prisma, {
            circleId: 7,
            generatedAt: new Date('2026-03-24T22:00:00.000Z'),
            forceGenerate: false,
            useLLM: true,
        });

        expect(circleSummary.generatedBy).toBe('system_llm');
        expect(circleSummary.generationMetadata).toMatchObject({
            providerMode: 'external',
            model: 'qwen2.5:7b',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
