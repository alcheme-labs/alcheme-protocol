import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const loadPrivateTextMock: any = jest.fn();

jest.mock('../../privateContentBridge', () => ({
    loadPrivateText: loadPrivateTextMock,
}));

import { buildSourceMaterialGroundingContext } from '../readModel';

describe('buildSourceMaterialGroundingContext', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('reads extracted chunks instead of raw uploaded blob text', async () => {
        const prisma = {
            sourceMaterial: {
                findMany: async () => ([
                    {
                        id: 41,
                        circleId: 7,
                        draftPostId: 11,
                        name: 'appendix.pdf',
                        mimeType: 'application/pdf',
                        extractionStatus: 'ready',
                        contentDigest: 'digest-41',
                        rawText: '%PDF-binary-placeholder%',
                        chunks: [
                            {
                                id: 100,
                                chunkIndex: 0,
                                locatorType: 'chunk',
                                locatorRef: 'chunk:1',
                                text: 'Extracted page summary.',
                                textDigest: 'chunk-digest-1',
                            },
                        ],
                    },
                ]),
            },
        } as any;

        const grounding = await buildSourceMaterialGroundingContext(prisma, {
            circleId: 7,
            draftPostId: 11,
        });

        expect(grounding).toEqual([
            {
                materialId: 41,
                name: 'appendix.pdf',
                mimeType: 'application/pdf',
                contentDigest: 'digest-41',
                locatorType: 'chunk',
                locatorRef: 'chunk:1',
                text: 'Extracted page summary.',
                textDigest: 'chunk-digest-1',
            },
        ]);
    });

    test('hydrates chunk plaintext through the private-content bridge when the public read model only stores locators', async () => {
        loadPrivateTextMock.mockResolvedValueOnce('Extracted page summary from private store.');

        const prisma = {
            sourceMaterial: {
                findMany: async () => ([
                    {
                        id: 77,
                        circleId: 7,
                        draftPostId: 11,
                        name: 'appendix.pdf',
                        mimeType: 'application/pdf',
                        extractionStatus: 'ready',
                        contentDigest: 'digest-77',
                        rawText: null,
                        rawTextLocator: 'alcheme-private://source-material/raw/77',
                        chunks: [
                            {
                                id: 200,
                                chunkIndex: 0,
                                locatorType: 'chunk',
                                locatorRef: 'chunk:1',
                                text: '',
                                textLocator: 'alcheme-private://source-material/chunk/chunk-digest-77-1',
                                textDigest: 'chunk-digest-77-1',
                            },
                        ],
                    },
                ]),
            },
        } as any;

        const grounding = await buildSourceMaterialGroundingContext(prisma, {
            circleId: 7,
            draftPostId: 11,
        });

        expect(loadPrivateTextMock).toHaveBeenCalledWith('alcheme-private://source-material/chunk/chunk-digest-77-1');
        expect(grounding).toEqual([
            {
                materialId: 77,
                name: 'appendix.pdf',
                mimeType: 'application/pdf',
                contentDigest: 'digest-77',
                locatorType: 'chunk',
                locatorRef: 'chunk:1',
                text: 'Extracted page summary from private store.',
                textDigest: 'chunk-digest-77-1',
            },
        ]);
    });
});
