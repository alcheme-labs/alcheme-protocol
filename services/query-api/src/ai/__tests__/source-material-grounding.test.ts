import { describe, expect, jest, test } from '@jest/globals';

jest.mock('ai', () => ({
    generateText: jest.fn(),
    streamText: jest.fn(),
}));

import { generateText } from 'ai';

import { generateGhostDraft } from '../ghost-draft';
import * as draftDiscussionLifecycleService from '../../services/draftDiscussionLifecycle';

describe('source material grounding for ghost draft', () => {
    test('includes AI-readable uploaded material excerpts in the generated ghost draft prompt', async () => {
        (generateText as any).mockResolvedValue({
            text: 'Grounded AI draft baseline.',
        });
        jest.spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads').mockResolvedValueOnce([
            {
                id: '21',
                draftPostId: 52,
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
                    content: '需要把上传材料里的里程碑变化补进正文。',
                    createdAt: '2026-03-25T08:10:00.000Z',
                },
                messages: [
                    {
                        id: '1',
                        authorId: 3,
                        messageType: 'create',
                        content: '需要把上传材料里的里程碑变化补进正文。',
                        createdAt: '2026-03-25T08:10:00.000Z',
                    },
                ],
            },
        ] as any);

        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 52,
                    text: 'Turn the meeting notes into a first working draft.',
                    tags: ['materials'],
                    author: { handle: 'bob' },
                    circle: {
                        id: 11,
                        name: 'Grounding Circle',
                        description: 'Use uploaded materials for context',
                    },
                    threadRoot: {
                        thread: [
                            { text: 'The uploaded notes have the revised milestones.' },
                        ],
                    },
                })),
            },
            sourceMaterial: {
                findMany: jest.fn(async () => ([{
                    id: 91,
                    name: 'meeting-notes.txt',
                    mimeType: 'text/plain',
                    contentDigest: 'c'.repeat(64),
                    rawText: 'raw text should never be used directly',
                    chunks: [
                        {
                            id: 1,
                            chunkIndex: 0,
                            locatorType: 'chunk',
                            locatorRef: 'chunk:1',
                            text: 'Milestone 1 moves to April and requires a reviewer checklist.',
                            textDigest: 'd'.repeat(64),
                        },
                    ],
                }])),
            },
            ghostDraftGeneration: {
                create: jest.fn(async ({ data }) => ({
                    id: 33,
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
                    createdAt: new Date('2026-03-25T11:00:00.000Z'),
                })),
            },
        } as any;

        await generateGhostDraft(prisma, 52, 3, {
            sourceMaterialIds: [91],
        });

        expect(generateText).toHaveBeenCalledTimes(1);
        const prompt = String((generateText as any).mock.calls[0][0].prompt || '');
        expect(prompt).toContain('Uploaded source materials');
        expect(prompt).toContain('meeting-notes.txt');
        expect(prompt).toContain('chunk:1');
        expect(prompt).toContain('Milestone 1 moves to April and requires a reviewer checklist.');
        expect(prompt).not.toContain('raw text should never be used directly');
    });
});
