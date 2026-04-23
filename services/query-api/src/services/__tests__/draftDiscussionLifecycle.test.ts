import { jest } from '@jest/globals';

import { listDraftDiscussionThreads } from '../draftDiscussionLifecycle';

function makeThreadRow(overrides: Record<string, unknown> = {}) {
    return {
        id: BigInt(2),
        draftPostId: 187,
        targetType: 'paragraph',
        targetRef: 'paragraph:0',
        targetVersion: 1,
        issueType: 'knowledge_supplement',
        state: 'proposed',
        createdBy: 11,
        createdAt: new Date('2026-03-14T08:00:00.000Z'),
        updatedAt: new Date('2026-03-14T08:02:00.000Z'),
        ...overrides,
    };
}

describe('draftDiscussionLifecycle list projection', () => {
    test('includes latest message payload for each thread', async () => {
        const queryResults: any[] = [
            [makeThreadRow()],
            [],
            [],
            [
                {
                    id: BigInt(7),
                    authorId: 22,
                    messageType: 'propose',
                    content: '补充 proposal 内容',
                    createdAt: new Date('2026-03-14T08:01:00.000Z'),
                },
            ],
        ];
        const queryRaw = jest.fn(async () => queryResults.shift());

        const records = await listDraftDiscussionThreads(
            { $queryRaw: queryRaw } as any,
            { draftPostId: 187, limit: 20 },
        );

        expect(queryRaw).toHaveBeenCalledTimes(4);
        expect((records[0] as any).issueType).toBe('knowledge_supplement');
        expect((records[0] as any).latestMessage).toMatchObject({
            authorId: 22,
            messageType: 'propose',
            content: '补充 proposal 内容',
        });
        expect((records[0] as any).messages).toHaveLength(1);
        expect((records[0] as any).messages[0]).toMatchObject({
            id: '7',
            messageType: 'propose',
            content: '补充 proposal 内容',
        });
    });

    test('sets latestMessage to null when thread has no message rows', async () => {
        const queryResults: any[] = [
            [makeThreadRow({ id: BigInt(3), state: 'open' })],
            [],
            [],
            [],
        ];
        const queryRaw = jest.fn(async () => queryResults.shift());

        const records = await listDraftDiscussionThreads(
            { $queryRaw: queryRaw } as any,
            { draftPostId: 187, limit: 20 },
        );

        expect(queryRaw).toHaveBeenCalledTimes(4);
        expect((records[0] as any).latestMessage).toBeNull();
        expect((records[0] as any).messages).toEqual([]);
    });

    test('keeps withdrawn issue tickets in the projection', async () => {
        const queryResults: any[] = [
            [makeThreadRow({ id: BigInt(4), state: 'withdrawn', issueType: 'question_and_supplement' })],
            [],
            [],
            [
                {
                    id: BigInt(9),
                    authorId: 11,
                    messageType: 'withdraw',
                    content: '先撤回，等补充清楚再提',
                    createdAt: new Date('2026-03-14T08:03:00.000Z'),
                },
            ],
        ];
        const queryRaw = jest.fn(async () => queryResults.shift());

        const records = await listDraftDiscussionThreads(
            { $queryRaw: queryRaw } as any,
            { draftPostId: 187, limit: 20 },
        );

        expect((records[0] as any)).toMatchObject({
            issueType: 'question_and_supplement',
            state: 'withdrawn',
            latestMessage: {
                messageType: 'withdraw',
            },
        });
    });
});
