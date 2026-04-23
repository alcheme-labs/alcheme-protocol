import { describe, expect, jest, test } from '@jest/globals';

jest.mock('ai', () => ({
    generateText: jest.fn(),
    streamText: jest.fn(),
}));

import { generateText } from 'ai';

import { generateGhostDraft } from '../ghost-draft';
import * as draftDiscussionLifecycleService from '../../services/draftDiscussionLifecycle';

describe('seeded ghost draft grounding', () => {
    test('includes selected seeded file context in the generated ghost draft prompt', async () => {
        (generateText as any).mockResolvedValue({
            text: 'Seeded AI draft baseline.',
        });
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValueOnce([
            {
                id: '11',
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
                    content: '需要把 API 示例和文档对齐。',
                    createdAt: '2026-03-25T08:10:00.000Z',
                },
                messages: [
                    {
                        id: '1',
                        authorId: 3,
                        messageType: 'create',
                        content: '需要把 API 示例和文档对齐。',
                        createdAt: '2026-03-25T08:10:00.000Z',
                    },
                ],
            },
        ] as any);

        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    text: 'Please fold the spec changes into the baseline draft.',
                    tags: ['seeded'],
                    author: { handle: 'alice' },
                    circle: {
                        id: 7,
                        name: 'Seeded Circle',
                        description: 'Source grounded drafting',
                    },
                    threadRoot: {
                        thread: [
                            { text: 'We should keep the API examples in sync.' },
                        ],
                    },
                })),
            },
            seededSourceNode: {
                findFirst: jest.fn(async () => ({
                    name: 'guide.md',
                    contentText: [
                        '# Guide',
                        'Keep the API examples aligned with the published schema.',
                        'Document every breaking change in the changelog.',
                        'Add rollout notes for reviewers.',
                    ].join('\n'),
                })),
            },
            ghostDraftGeneration: {
                create: jest.fn(async ({ data }) => ({
                    id: 31,
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
                    createdAt: new Date('2026-03-25T10:00:00.000Z'),
                })),
            },
        } as any;

        await generateGhostDraft(prisma, 42, 9, {
            seededReference: {
                path: 'docs/guide.md',
                line: 2,
            },
        });

        expect(generateText).toHaveBeenCalledTimes(1);
        const prompt = String((generateText as any).mock.calls[0][0].prompt || '');
        expect(prompt).toContain('Seeded source context');
        expect(prompt).toContain('docs/guide.md:2');
        expect(prompt).toContain('Keep the API examples aligned with the published schema.');
    });
});
