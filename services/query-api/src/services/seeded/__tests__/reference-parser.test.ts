import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const loadPrivateTextMock: any = jest.fn();

jest.mock('../../privateContentBridge', () => ({
    loadPrivateText: loadPrivateTextMock,
}));

import {
    extractSeededReferenceTokens,
    parseSeededReferenceToken,
    resolveSeededReference,
} from '../reference-parser';

describe('seeded reference parser', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('parses a single @file:path:line token into a structured reference', () => {
        expect(parseSeededReferenceToken('@file:docs/guide.md:12')).toEqual({
            raw: '@file:docs/guide.md:12',
            path: 'docs/guide.md',
            line: 12,
            index: 0,
        });
    });

    test('extracts multiple file references from free text without losing positions', () => {
        expect(extractSeededReferenceTokens(
            '先看 @file:docs/guide.md:3，再比对 @file:notes/todo.txt:1。',
        )).toEqual([
            {
                raw: '@file:docs/guide.md:3',
                path: 'docs/guide.md',
                line: 3,
                index: 3,
            },
            {
                raw: '@file:notes/todo.txt:1',
                path: 'notes/todo.txt',
                line: 1,
                index: 29,
            },
        ]);
    });

    test('resolves an @file reference against seeded source nodes and returns the target line text', async () => {
        const prisma = {
            seededSourceNode: {
                findFirst: async () => ({
                    name: 'guide.md',
                    contentText: '# Guide\nAlpha line\nBeta line',
                    contentHash: 'seeded-hash-246',
                }),
            },
        } as any;

        await expect(resolveSeededReference(prisma, {
            circleId: 246,
            value: '@file:docs/guide.md:2',
        })).resolves.toEqual({
            raw: '@file:docs/guide.md:2',
            path: 'docs/guide.md',
            line: 2,
            index: 0,
            fileName: 'guide.md',
            lineText: 'Alpha line',
            contentDigest: 'seeded-hash-246',
        });
    });

    test('resolves an @file reference through the private-content locator bridge when plaintext is not stored in DB', async () => {
        loadPrivateTextMock.mockResolvedValueOnce('# Guide\nAlpha line\nBeta line');

        const prisma = {
            seededSourceNode: {
                findFirst: async () => ({
                    name: 'guide.md',
                    contentText: null,
                    contentLocator: 'alcheme-private://seeded/246/docs/guide.md',
                    contentHash: 'seeded-hash-777',
                }),
            },
        } as any;

        await expect(resolveSeededReference(prisma, {
            circleId: 246,
            value: '@file:docs/guide.md:2',
        })).resolves.toEqual({
            raw: '@file:docs/guide.md:2',
            path: 'docs/guide.md',
            line: 2,
            index: 0,
            fileName: 'guide.md',
            lineText: 'Alpha line',
            contentDigest: 'seeded-hash-777',
        });
        expect(loadPrivateTextMock).toHaveBeenCalledWith('alcheme-private://seeded/246/docs/guide.md');
    });
});
