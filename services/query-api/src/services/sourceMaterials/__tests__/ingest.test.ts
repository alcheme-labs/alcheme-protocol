import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const storePrivateTextMock: any = jest.fn();

jest.mock('../../privateContentBridge', () => {
    const actual = jest.requireActual('../../privateContentBridge') as Record<string, unknown>;
    return {
        ...actual,
        storePrivateText: storePrivateTextMock,
    };
});

import { buildSourceMaterialIngestPlan, createSourceMaterial } from '../ingest';

describe('buildSourceMaterialIngestPlan', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('builds stable digest and chunk references for uploaded text materials', () => {
        const plan = buildSourceMaterialIngestPlan({
            name: 'notes.md',
            mimeType: 'text/markdown',
            content: '# Notes\n\nFirst chunk.\n\nSecond chunk.',
        });

        expect(plan.material).toMatchObject({
            name: 'notes.md',
            mimeType: 'text/markdown',
            extractionStatus: 'ready',
        });
        expect(plan.material.contentDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(plan.chunks).toEqual([
            expect.objectContaining({
                chunkIndex: 0,
                locatorType: 'chunk',
                locatorRef: 'chunk:1',
                text: '# Notes',
            }),
            expect.objectContaining({
                chunkIndex: 1,
                locatorType: 'chunk',
                locatorRef: 'chunk:2',
                text: 'First chunk.',
            }),
            expect.objectContaining({
                chunkIndex: 2,
                locatorType: 'chunk',
                locatorRef: 'chunk:3',
                text: 'Second chunk.',
            }),
        ]);
    });

    test('treats uploaded pdf-like materials as extracted text sources before grounding', () => {
        const plan = buildSourceMaterialIngestPlan({
            name: 'appendix.pdf',
            mimeType: 'application/pdf',
            content: 'Page one intro.\n\nPage two detail.',
        });

        expect(plan.material).toMatchObject({
            name: 'appendix.pdf',
            mimeType: 'application/pdf',
            extractionStatus: 'ready',
        });
        expect(plan.extractedText).toContain('Page one intro.');
        expect(plan.chunks.map((chunk) => chunk.locatorRef)).toEqual(['chunk:1', 'chunk:2']);
    });

    test('persists source material locators instead of leaving plaintext in the public read model', async () => {
        storePrivateTextMock
            .mockResolvedValueOnce({
                locator: 'alcheme-private://source-material/raw/digest-material-31',
            })
            .mockResolvedValueOnce({
                locator: 'alcheme-private://source-material/chunk/chunk-digest-1',
            })
            .mockResolvedValueOnce({
                locator: 'alcheme-private://source-material/chunk/chunk-digest-2',
            });

        const sourceMaterialCreate = jest.fn(async ({ data }) => ({
            id: 31,
            circleId: data.circleId,
            draftPostId: data.draftPostId,
            discussionThreadId: data.discussionThreadId,
            seededSourceNodeId: data.seededSourceNodeId,
            name: data.name,
            mimeType: data.mimeType,
            contentDigest: data.contentDigest,
        }));
        const sourceMaterialChunkCreate = jest.fn(async () => ({}));
        const prisma = {
            $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
                sourceMaterial: {
                    create: sourceMaterialCreate,
                },
                sourceMaterialChunk: {
                    create: sourceMaterialChunkCreate,
                },
            }),
        } as any;

        await createSourceMaterial(prisma, {
            circleId: 7,
            uploadedByUserId: 11,
            draftPostId: 19,
            discussionThreadId: null,
            seededSourceNodeId: null,
            name: 'meeting-notes.txt',
            mimeType: 'text/plain',
            content: 'Alpha grounding chunk\n\nBeta grounding chunk',
        });

        expect(storePrivateTextMock).toHaveBeenCalledTimes(3);
        expect(sourceMaterialCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                circleId: 7,
                rawText: null,
                rawTextLocator: expect.stringMatching(/^alcheme-private:\/\/source-material\/raw\/[a-f0-9]{64}$/),
            }),
            select: expect.any(Object),
        });
        expect(sourceMaterialChunkCreate).toHaveBeenNthCalledWith(1, {
            data: expect.objectContaining({
                chunkIndex: 0,
                text: '',
                textLocator: expect.stringMatching(/^alcheme-private:\/\/source-material\/chunk\/[a-f0-9]{64}$/),
            }),
        });
        expect(sourceMaterialChunkCreate).toHaveBeenNthCalledWith(2, {
            data: expect.objectContaining({
                chunkIndex: 1,
                text: '',
                textLocator: expect.stringMatching(/^alcheme-private:\/\/source-material\/chunk\/[a-f0-9]{64}$/),
            }),
        });
    });
});
