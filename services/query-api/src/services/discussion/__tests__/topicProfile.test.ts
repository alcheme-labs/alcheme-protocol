import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const embedDiscussionTextMock = jest.fn();
const listSourceMaterialsMock = jest.fn();
const seededSourceNodeFindManyMock = jest.fn();

jest.mock('../../../ai/embedding', () => ({
    embedDiscussionText: (...args: unknown[]) => embedDiscussionTextMock(...args),
}));

jest.mock('../../sourceMaterials/readModel', () => ({
    listSourceMaterials: (...args: unknown[]) => listSourceMaterialsMock(...args),
}));

import {
    invalidateDiscussionTopicProfileCache,
    loadDiscussionTopicProfile,
} from '../topicProfile';

describe('discussion topic profile', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        invalidateDiscussionTopicProfileCache();
    });

    test('builds a stable public-safe snapshot from circle metadata, source materials, and seeded files', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    name: '异步编程讨论组',
                    description: '围绕 async await、事件循环与并发模型',
                })),
            },
            seededSourceNode: {
                findMany: seededSourceNodeFindManyMock,
            },
        } as any;
        (listSourceMaterialsMock as any).mockResolvedValue([
            {
                id: 1,
                circleId: 7,
                draftPostId: null,
                discussionThreadId: null,
                seededSourceNodeId: null,
                name: '异步笔记',
                mimeType: 'text/markdown',
                status: 'ai_readable',
                contentDigest: 'material-digest-1234567890',
                chunkCount: 2,
            },
        ]);
        (seededSourceNodeFindManyMock as any).mockResolvedValue([
            {
                path: 'docs/event-loop.md',
                mimeType: 'text/markdown',
                lineCount: 42,
                contentHash: 'seeded-digest-abcdefghijk',
            },
        ]);
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.1, 0.2, 0.3],
            model: 'nomic-embed-text',
            providerMode: 'builtin',
        });

        const profile = await loadDiscussionTopicProfile(prisma, 7);

        expect(profile.circleId).toBe(7);
        expect(profile.topicProfileVersion).toMatch(/^topic:7:/);
        expect(profile.snapshotText).toContain('异步编程讨论组');
        expect(profile.snapshotText).toContain('异步笔记');
        expect(profile.snapshotText).toContain('docs/event-loop.md');
        expect(profile.snapshotText).not.toContain('IO 等待');
        expect((embedDiscussionTextMock as any).mock.calls[0][0]).toMatchObject({
            purpose: 'circle-topic-profile',
        });
        expect(String((embedDiscussionTextMock as any).mock.calls[0][0].text)).not.toContain('IO 等待');
        expect(profile.embedding).toEqual([0.1, 0.2, 0.3]);
        expect(profile.embeddingProviderMode).toBe('builtin');
    });

    test('reuses cached topic profiles for unchanged circles', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    name: '缓存圈层',
                    description: '测试 profile cache',
                })),
            },
            seededSourceNode: {
                findMany: seededSourceNodeFindManyMock,
            },
        } as any;
        (listSourceMaterialsMock as any).mockResolvedValue([]);
        (seededSourceNodeFindManyMock as any).mockResolvedValue([]);
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.9, 0.1],
            model: 'nomic-embed-text',
            providerMode: 'builtin',
        });

        const first = await loadDiscussionTopicProfile(prisma, 8);
        const second = await loadDiscussionTopicProfile(prisma, 8);

        expect(second).toEqual(first);
        expect(prisma.circle.findUnique).toHaveBeenCalledTimes(1);
        expect(listSourceMaterialsMock).toHaveBeenCalledTimes(1);
        expect(seededSourceNodeFindManyMock).toHaveBeenCalledTimes(1);
        expect(embedDiscussionTextMock).toHaveBeenCalledTimes(1);
    });

    test('changes topic profile version when materials outside the visible snapshot change', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    name: '大语料圈层',
                    description: '测试 topic profile version',
                })),
            },
            seededSourceNode: {
                findMany: seededSourceNodeFindManyMock,
            },
        } as any;
        const buildMaterials = (tailDigest: string) => Array.from({ length: 9 }, (_, index) => ({
            id: index + 1,
            circleId: 12,
            draftPostId: null,
            discussionThreadId: null,
            seededSourceNodeId: null,
            name: `material-${index + 1}`,
            mimeType: 'text/markdown',
            status: 'ai_readable',
            contentDigest: index === 8 ? tailDigest : `digest-${index + 1}`,
            chunkCount: index + 1,
        }));
        (seededSourceNodeFindManyMock as any).mockResolvedValue([]);
        (embedDiscussionTextMock as any).mockResolvedValue({
            embedding: [0.2, 0.8],
            model: 'nomic-embed-text',
            providerMode: 'builtin',
        });

        (listSourceMaterialsMock as any).mockResolvedValue(buildMaterials('digest-9-a'));
        const first = await loadDiscussionTopicProfile(prisma, 12);

        invalidateDiscussionTopicProfileCache(12);
        (listSourceMaterialsMock as any).mockResolvedValue(buildMaterials('digest-9-b'));
        const second = await loadDiscussionTopicProfile(prisma, 12);

        expect(first.snapshotText).toBe(second.snapshotText);
        expect(first.topicProfileVersion).not.toBe(second.topicProfileVersion);
    });

    test('falls back to a versioned snapshot even when embedding provider fails', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    name: '测试圈层',
                    description: null,
                })),
            },
            seededSourceNode: {
                findMany: seededSourceNodeFindManyMock,
            },
        } as any;
        (listSourceMaterialsMock as any).mockResolvedValue([]);
        (seededSourceNodeFindManyMock as any).mockResolvedValue([]);
        (embedDiscussionTextMock as any).mockRejectedValue(new Error('embedding offline'));

        const profile = await loadDiscussionTopicProfile(prisma, 9);

        expect(profile.topicProfileVersion).toMatch(/^topic:9:/);
        expect(profile.embedding).toBeNull();
        expect(profile.embeddingModel).toBeNull();
        expect(profile.embeddingProviderMode).toBeNull();
        expect(profile.snapshotText).toContain('测试圈层');
    });
});
