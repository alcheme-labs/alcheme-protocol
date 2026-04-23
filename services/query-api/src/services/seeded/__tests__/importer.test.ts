import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const storePrivateTextMock: any = jest.fn();

jest.mock('../../privateContentBridge', () => {
    const actual = jest.requireActual('../../privateContentBridge') as Record<string, unknown>;
    return {
        ...actual,
        storePrivateText: storePrivateTextMock,
    };
});

import { buildSeededImportPlan, importSeededSources } from '../importer';

describe('buildSeededImportPlan', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('builds stable directory and file nodes from a batch of seeded source files', () => {
        const plan = buildSeededImportPlan([
            {
                path: 'docs/intro.md',
                content: '# Intro\nSeeded content',
                mimeType: 'text/markdown',
            },
            {
                path: 'src/lib/util.ts',
                content: 'export const util = 1;\n',
                mimeType: 'application/typescript',
            },
        ]);

        expect(plan.nodes.map((node) => ({
            path: node.path,
            parentPath: node.parentPath,
            nodeType: node.nodeType,
            depth: node.depth,
            sortOrder: node.sortOrder,
        }))).toEqual([
            { path: 'docs', parentPath: null, nodeType: 'directory', depth: 0, sortOrder: 0 },
            { path: 'src', parentPath: null, nodeType: 'directory', depth: 0, sortOrder: 1 },
            { path: 'docs/intro.md', parentPath: 'docs', nodeType: 'file', depth: 1, sortOrder: 0 },
            { path: 'src/lib', parentPath: 'src', nodeType: 'directory', depth: 1, sortOrder: 0 },
            { path: 'src/lib/util.ts', parentPath: 'src/lib', nodeType: 'file', depth: 2, sortOrder: 0 },
        ]);
        expect(plan.fileCount).toBe(2);
        expect(plan.directoryCount).toBe(3);
        expect(plan.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(plan.nodes.find((node) => node.path === 'docs/intro.md')).toMatchObject({
            lineCount: 2,
            mimeType: 'text/markdown',
        });
    });

    test('imports seeded files as manifest metadata plus private locators instead of public plaintext rows', async () => {
        storePrivateTextMock
            .mockResolvedValueOnce({
                locator: 'alcheme-private://seeded/7/docs/intro.md',
            })
            .mockResolvedValueOnce({
                locator: 'alcheme-private://seeded/7/src/lib/util.ts',
            });

        const createdRows: any[] = [];
        const prisma = {
            $transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
                seededSourceNode: {
                    deleteMany: jest.fn(async () => ({ count: 5 })),
                    create: jest.fn(async ({ data }) => {
                        createdRows.push(data);
                        return {
                            id: createdRows.length,
                            path: data.path,
                        };
                    }),
                },
            }),
        } as any;

        await importSeededSources(prisma, {
            circleId: 7,
            files: [
                {
                    path: 'docs/intro.md',
                    content: '# Intro\nSeeded content',
                    mimeType: 'text/markdown',
                },
                {
                    path: 'src/lib/util.ts',
                    content: 'export const util = 1;\n',
                    mimeType: 'application/typescript',
                },
            ],
        });

        expect(storePrivateTextMock).toHaveBeenCalledTimes(2);
        expect(createdRows.find((row) => row.path === 'docs/intro.md')).toMatchObject({
            nodeType: 'file',
            contentText: null,
            contentLocator: 'alcheme-private://seeded/7/docs/intro.md',
        });
        expect(createdRows.find((row) => row.path === 'src/lib/util.ts')).toMatchObject({
            nodeType: 'file',
            contentText: null,
            contentLocator: 'alcheme-private://seeded/7/src/lib/util.ts',
        });
    });
});
