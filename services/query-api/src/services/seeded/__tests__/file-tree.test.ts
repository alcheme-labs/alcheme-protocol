import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const loadPrivateTextMock: any = jest.fn();

jest.mock('../../privateContentBridge', () => ({
    loadPrivateText: loadPrivateTextMock,
}));

import { buildSeededFileTree, listSeededFileTree, loadSeededFileContext } from '../file-tree';

describe('buildSeededFileTree', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('builds a stable nested tree ordered by sortOrder within each parent', () => {
        const tree = buildSeededFileTree([
            {
                id: 2,
                parentId: null,
                nodeType: 'directory',
                name: 'docs',
                path: 'docs',
                depth: 0,
                sortOrder: 0,
                mimeType: null,
                byteSize: 0,
                lineCount: null,
                contentDigest: null,
                contentText: null,
            },
            {
                id: 4,
                parentId: 2,
                nodeType: 'file',
                name: 'guide.md',
                path: 'docs/guide.md',
                depth: 1,
                sortOrder: 1,
                mimeType: 'text/markdown',
                byteSize: 128,
                lineCount: 6,
                contentDigest: 'digest-guide',
                contentText: '# Guide\n\nline two',
            },
            {
                id: 3,
                parentId: 2,
                nodeType: 'directory',
                name: 'notes',
                path: 'docs/notes',
                depth: 1,
                sortOrder: 0,
                mimeType: null,
                byteSize: 0,
                lineCount: null,
                contentDigest: null,
                contentText: null,
            },
            {
                id: 5,
                parentId: 3,
                nodeType: 'file',
                name: 'todo.txt',
                path: 'docs/notes/todo.txt',
                depth: 2,
                sortOrder: 0,
                mimeType: 'text/plain',
                byteSize: 42,
                lineCount: 2,
                contentDigest: 'digest-todo',
                contentText: 'todo\nnext',
            },
        ]);

        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({
            path: 'docs',
            nodeType: 'directory',
        });
        expect(tree[0].children.map((node) => node.path)).toEqual([
            'docs/notes',
            'docs/guide.md',
        ]);
        expect(tree[0].children[0].children.map((node) => node.path)).toEqual([
            'docs/notes/todo.txt',
        ]);
        expect(tree[0].children[1]).toMatchObject({
            contentDigest: 'digest-guide',
        });
    });

    test('loadSeededFileContext preserves the stored content hash as grounding digest', async () => {
        const prisma = {
            seededSourceNode: {
                findFirst: async () => ({
                    name: 'guide.md',
                    contentText: '# Guide\nAlpha line\nBeta line',
                    contentHash: 'seeded-hash-123',
                }),
            },
        } as any;

        const context = await loadSeededFileContext(prisma, {
            circleId: 7,
            path: 'docs/guide.md',
            line: 2,
        });

        expect(context).toMatchObject({
            path: 'docs/guide.md',
            line: 2,
            contentDigest: 'seeded-hash-123',
        });
    });

    test('listSeededFileTree hydrates file content through private locators instead of DB plaintext', async () => {
        loadPrivateTextMock.mockResolvedValueOnce('# Guide\nAlpha line\nBeta line');

        const prisma = {
            seededSourceNode: {
                findMany: async () => ([
                    {
                        id: 2,
                        parentId: null,
                        nodeType: 'directory',
                        name: 'docs',
                        path: 'docs',
                        depth: 0,
                        sortOrder: 0,
                        mimeType: null,
                        byteSize: 0,
                        lineCount: null,
                        contentHash: null,
                        contentText: null,
                        contentLocator: null,
                    },
                    {
                        id: 4,
                        parentId: 2,
                        nodeType: 'file',
                        name: 'guide.md',
                        path: 'docs/guide.md',
                        depth: 1,
                        sortOrder: 0,
                        mimeType: 'text/markdown',
                        byteSize: 128,
                        lineCount: 3,
                        contentHash: 'digest-guide',
                        contentText: null,
                        contentLocator: 'alcheme-private://seeded/7/docs/guide.md',
                    },
                ]),
            },
        } as any;

        const tree = await listSeededFileTree(prisma, 7);

        expect(loadPrivateTextMock).toHaveBeenCalledWith('alcheme-private://seeded/7/docs/guide.md');
        expect(tree[0].children[0]).toMatchObject({
            path: 'docs/guide.md',
            contentDigest: 'digest-guide',
            contentText: '# Guide\nAlpha line\nBeta line',
        });
    });
});
