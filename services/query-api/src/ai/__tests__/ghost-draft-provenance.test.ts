import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('ai', () => ({
    generateText: jest.fn(),
    streamText: jest.fn(),
}));

import { generateText } from 'ai';

import { serviceConfig } from '../../config/services';
import { generateGhostDraft } from '../ghost-draft';
import * as draftDiscussionLifecycleService from '../../services/draftDiscussionLifecycle';

const DEFAULT_PENDING_ISSUE_THREADS = [
    {
        id: '501',
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
] as any;

describe('ghost draft provenance', () => {
    beforeEach(() => {
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValue(
            DEFAULT_PENDING_ISSUE_THREADS,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('persists a dedicated ghost draft generation artifact with provenance metadata', async () => {
        (generateText as any).mockResolvedValue({
            text: 'AI generated baseline draft.',
        });

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
            draftComment: {
                create: jest.fn(),
            },
        } as any;

        const result = await generateGhostDraft(prisma, 42, 9);

        expect(prisma.ghostDraftGeneration.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                draftPostId: 42,
                requestedByUserId: 9,
                origin: 'ai',
                providerMode: 'builtin',
                model: expect.any(String),
                promptAsset: 'ghost-draft-comment',
                promptVersion: 'v1',
                ghostRunId: null,
            }),
        });
        expect(JSON.parse(prisma.ghostDraftGeneration.create.mock.calls[0][0].data.draftText)).toMatchObject({
            suggestions: [
                {
                    target_type: 'paragraph',
                    target_ref: 'paragraph:0',
                    thread_ids: ['501'],
                    issue_types: ['knowledge_supplement'],
                    suggested_text: 'AI generated baseline draft.',
                },
            ],
        });
        expect(prisma.ghostDraftGeneration.create.mock.calls[0][0].data.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(prisma.draftComment.create).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            generationId: 17,
            postId: 42,
            draftText: 'AI generated baseline draft.',
            suggestions: [
                expect.objectContaining({
                    targetRef: 'paragraph:0',
                    threadIds: ['501'],
                    suggestedText: 'AI generated baseline draft.',
                }),
            ],
            model: expect.any(String),
            generatedAt: createdAt,
            provenance: {
                origin: 'ai',
                providerMode: 'builtin',
                model: expect.any(String),
                promptAsset: 'ghost-draft-comment',
                promptVersion: 'v1',
                ghostRunId: null,
            },
        });
        expect(result.provenance.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('blocks external ghost draft generation for private draft context until explicit private-content consent is configured', async () => {
        const originalMode = serviceConfig.ai.mode;
        const originalExternalUrl = serviceConfig.ai.externalUrl;
        const originalExternalPrivateContentMode = (serviceConfig.ai as any).externalPrivateContentMode;
        const originalFetch = globalThis.fetch;

        try {
            serviceConfig.ai.mode = 'external';
            serviceConfig.ai.externalUrl = 'https://external.example/ai';
            (serviceConfig.ai as any).externalPrivateContentMode = 'deny';
            globalThis.fetch = jest.fn(async () => {
                throw new Error('external fetch should not be called');
            }) as any;

            const prisma = {
                post: {
                    findUnique: jest.fn(async () => ({
                        id: 42,
                        text: 'Original post body',
                        tags: ['ghost'],
                        author: { handle: 'alice' },
                        circle: { id: 7, name: 'Ghost Circle', description: 'AI discussion space' },
                        threadRoot: { thread: [] },
                    })),
                },
                ghostDraftGeneration: {
                    create: jest.fn(),
                },
            } as any;

            await expect(generateGhostDraft(prisma, 42, 9)).rejects.toThrow('external_ai_private_content_consent_required');
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expect(prisma.ghostDraftGeneration.create).not.toHaveBeenCalled();
        } finally {
            serviceConfig.ai.mode = originalMode;
            serviceConfig.ai.externalUrl = originalExternalUrl;
            (serviceConfig.ai as any).externalPrivateContentMode = originalExternalPrivateContentMode;
            globalThis.fetch = originalFetch;
        }
    });

    test('normalizes think traces and json-wrapped ghost draft payloads before persistence', async () => {
        (generateText as any).mockResolvedValue({
            text: [
                '我先整理一下上下文，再输出最终建议。',
                '</think>',
                '```json',
                '{',
                '  "comment": "建议先把新成员前10分钟流程压缩成一条连续引导路径，再补上失败后的明确下一步提示。",',
                '  "suggested_sections": ["核心问题", "成功标准", "两阶段方案"],',
                '  "next_questions": ["第一阶段的发布时间由谁确认？"],',
                '  "confidence": 0.82',
                '}',
                '```',
            ].join('\n'),
        });

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
                    createdAt,
                })),
            },
        } as any;

        const result = await generateGhostDraft(prisma, 42, 9);

        expect(JSON.parse(prisma.ghostDraftGeneration.create.mock.calls[0][0].data.draftText)).toMatchObject({
            suggestions: [
                {
                    target_ref: 'paragraph:0',
                    suggested_text: '建议先把新成员前10分钟流程压缩成一条连续引导路径，再补上失败后的明确下一步提示。',
                },
            ],
        });
        expect(result.draftText).toBe('建议先把新成员前10分钟流程压缩成一条连续引导路径，再补上失败后的明确下一步提示。');
    });

    test('extracts the comment field even when the ghost draft json payload is slightly malformed', async () => {
        (generateText as any).mockResolvedValue({
            text: [
                '先看下上下文。',
                '</think>',
                '{',
                '  "comment": "建议先把开头改成问题定义，再把方案拆成两步落地。",',
                '  "next_questions": ["第一阶段谁负责验收？"],',
                '}',
            ].join('\n'),
        });

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
                    id: 19,
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

        expect(JSON.parse(prisma.ghostDraftGeneration.create.mock.calls[0][0].data.draftText)).toMatchObject({
            suggestions: [
                {
                    target_ref: 'paragraph:0',
                    suggested_text: '建议先把开头改成问题定义，再把方案拆成两步落地。',
                },
            ],
        });
        expect(result.draftText).toBe('建议先把开头改成问题定义，再把方案拆成两步落地。');
    });

    test('persists structured paragraph suggestions grouped by pending issue targets', async () => {
        (generateText as any).mockResolvedValue({
            text: [
                '{',
                '  "suggestions": [',
                '    {',
                '      "target_ref": "paragraph:0",',
                '      "summary": "补上验收人与时间线。",',
                '      "suggested_text": "当前共识：已经确认先保留三段结构，并补充本段的验收人与时间线。",',
                '      "open_questions": ["谁负责最终验收？"]',
                '    }',
                '  ],',
                '  "confidence": 0.81',
                '}',
            ].join('\n'),
        });

        const createdAt = new Date('2026-03-24T10:00:00.000Z');
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    text: [
                        '当前共识：已经确认保留三段结构。',
                        '未解决问题：负责人尚未明确。',
                        '下一步建议：补齐验收人与时间线。',
                    ].join('\n'),
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
                    id: 20,
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

        const persistedDraftPayload = prisma.ghostDraftGeneration.create.mock.calls[0][0].data.draftText;
        const parsedPayload = JSON.parse(String(persistedDraftPayload));
        expect(parsedPayload).toMatchObject({
            suggestions: [
                {
                    target_ref: 'paragraph:0',
                    target_type: 'paragraph',
                    thread_ids: ['501'],
                    issue_types: ['knowledge_supplement'],
                    summary: '补上验收人与时间线。',
                    suggested_text: '当前共识：已经确认先保留三段结构，并补充本段的验收人与时间线。',
                },
            ],
        });
        expect(result.draftText).toBe('当前共识：已经确认先保留三段结构，并补充本段的验收人与时间线。');
        expect(result.suggestions).toEqual([
            expect.objectContaining({
                suggestionId: expect.any(String),
                targetRef: 'paragraph:0',
                targetType: 'paragraph',
                threadIds: ['501'],
                issueTypes: ['knowledge_supplement'],
                summary: '补上验收人与时间线。',
                suggestedText: '当前共识：已经确认先保留三段结构，并补充本段的验收人与时间线。',
            }),
        ]);
    });

    test('extracts draft_text even when the json object is truncated before the closing quote', async () => {
        (generateText as any).mockResolvedValue({
            text: [
                '{',
                '"draft_text": "在优化新成员入门流程方面，可以考虑以下具体措施：\\n\\n1. 身份创建阶段：提供更详细的系统提示，帮助用户快速完成角色创建并了解其权限。\\n\\n2. 加入圈层阶段：优化圈层导航，让用户更容易找到他们感兴趣的内容。\\n\\n3. 首条发言与草稿协作阶段：提供撰写高质量首贴的指导，例如如何',
            ].join('\n'),
        });

        const createdAt = new Date('2026-03-24T10:00:00.000Z');
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    text: [
                        '当前共识：已经确认保留三段结构。',
                        '未解决问题：负责人尚未明确。',
                        '下一步建议：补齐验收人与时间线。',
                    ].join('\n'),
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
                    id: 21,
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

        expect(JSON.parse(prisma.ghostDraftGeneration.create.mock.calls[0][0].data.draftText)).toMatchObject({
            suggestions: [
                {
                    target_ref: 'paragraph:0',
                    suggested_text: [
                        '在优化新成员入门流程方面，可以考虑以下具体措施：',
                        '1. 身份创建阶段：提供更详细的系统提示，帮助用户快速完成角色创建并了解其权限。',
                        '2. 加入圈层阶段：优化圈层导航，让用户更容易找到他们感兴趣的内容。',
                        '3. 首条发言与草稿协作阶段：提供撰写高质量首贴的指导，例如如何',
                    ].join('\n'),
                },
            ],
        });
        expect(result.draftText).toBe([
            '在优化新成员入门流程方面，可以考虑以下具体措施：',
            '1. 身份创建阶段：提供更详细的系统提示，帮助用户快速完成角色创建并了解其权限。',
            '2. 加入圈层阶段：优化圈层导航，让用户更容易找到他们感兴趣的内容。',
            '3. 首条发言与草稿协作阶段：提供撰写高质量首贴的指导，例如如何',
        ].join('\n'));
    });

    test('requires pending issue threads before generating a ghost draft revision', async () => {
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValueOnce([
            {
                ...DEFAULT_PENDING_ISSUE_THREADS[0],
                state: 'applied',
                latestApplication: {
                    appliedBy: 9,
                    appliedEditAnchorId: 'anchor-1',
                    appliedSnapshotHash: 'a'.repeat(64),
                    appliedDraftVersion: 5,
                    reason: null,
                    appliedAt: '2026-03-25T08:30:00.000Z',
                },
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
                create: jest.fn(),
            },
        } as any;

        await expect(generateGhostDraft(prisma, 42, 9)).rejects.toThrow('ghost_draft_requires_pending_issue_threads');
        expect(prisma.ghostDraftGeneration.create).not.toHaveBeenCalled();
    });
});
