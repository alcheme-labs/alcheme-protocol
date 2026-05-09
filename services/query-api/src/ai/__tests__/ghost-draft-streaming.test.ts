import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockStreamText = jest.fn();
const mockGetBuiltinTextModel = jest.fn(() => ({ api: 'chat_completions', modelId: 'llama3.1:8b' }));
const mockGetModelId = jest.fn(() => 'llama3.1:8b');

jest.mock('ai', () => ({
    streamText: mockStreamText,
}));

jest.mock('../provider', () => ({
    generateAiText: jest.fn(),
    getBuiltinTextModel: mockGetBuiltinTextModel,
    getModelId: mockGetModelId,
}));

import { serviceConfig } from '../../config/services';
import { streamGhostDraft } from '../ghost-draft';

describe('ghost draft streaming', () => {
    const originalAiMode = serviceConfig.ai.mode;

    beforeEach(() => {
        jest.clearAllMocks();
        serviceConfig.ai.mode = 'builtin';
        mockStreamText.mockReturnValue({ stream: 'ok' });
    });

    afterEach(() => {
        serviceConfig.ai.mode = originalAiMode;
    });

    test('reuses builtin text model selection instead of directly calling the provider default path', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    text: 'Original post body',
                    tags: ['ghost'],
                    author: { handle: 'alice' },
                    circle: null,
                    threadRoot: null,
                })),
            },
            $queryRaw: jest.fn<() => Promise<any>>()
                .mockResolvedValueOnce([{
                    id: BigInt(1),
                    draftPostId: 42,
                    targetType: 'paragraph',
                    targetRef: 'paragraph:0',
                    targetVersion: 1,
                    issueType: 'question_and_supplement',
                    state: 'open',
                    createdBy: 7,
                    createdAt: new Date('2026-03-20T10:00:00.000Z'),
                    updatedAt: new Date('2026-03-20T10:00:00.000Z'),
                }])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{
                    id: BigInt(10),
                    authorId: 7,
                    messageType: 'comment',
                    content: 'Please clarify the opening paragraph.',
                    createdAt: new Date('2026-03-20T10:01:00.000Z'),
                }]),
        } as any;

        const result = await streamGhostDraft(prisma, 42);

        expect(mockGetModelId).toHaveBeenCalledWith('ghost-draft');
        expect(mockGetBuiltinTextModel).toHaveBeenCalledWith('llama3.1:8b');
        expect(mockStreamText).toHaveBeenCalledWith(expect.objectContaining({
            model: {
                api: 'chat_completions',
                modelId: 'llama3.1:8b',
            },
        }));
        expect(result).toEqual({ stream: 'ok' });
    });
});
