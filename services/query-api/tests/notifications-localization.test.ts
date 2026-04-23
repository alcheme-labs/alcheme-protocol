import { describe, expect, test, jest } from '@jest/globals';

import { resolvers } from '../src/graphql/resolvers';

describe('notifications localization', () => {
    test('myNotifications returns localized display fields for known product notifications', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 1,
                        type: 'identity',
                        title: '身份晋升为入局者',
                        body: '你在「Alpha」的身份由游客变更为入局者。原因：已发送 3 条消息，达到 3 条门槛，已晋升为入局者。',
                        sourceType: 'circle_identity',
                        sourceId: 'Visitor->Initiate',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:00:00.000Z'),
                    },
                    {
                        id: 2,
                        type: 'forward',
                        title: '你的消息被转发了',
                        body: 'alice 将你的消息转发到了 Alpha',
                        sourceType: 'discussion',
                        sourceId: 'env-1',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:01:00.000Z'),
                    },
                    {
                        id: 3,
                        type: 'highlight',
                        title: '你的发言被点亮了',
                        body: '你在讨论中的发言被其他成员点亮',
                        sourceType: 'discussion',
                        sourceId: 'env-2',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:02:00.000Z'),
                    },
                    {
                        id: 4,
                        type: 'draft',
                        title: 'Discussion ready for a draft',
                        body: 'This discussion is showing draft-ready signals (12 messages, 75% focused, 2 questions).\nOpen the Draft tab to shape it before turning it into a crystal.\nSummary: A draft is forming.',
                        sourceType: 'discussion_trigger',
                        sourceId: '7',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:03:00.000Z'),
                    },
                ])),
            },
            circle: {
                findMany: jest.fn(async () => ([
                    { id: 7, name: 'Alpha' },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Query.myNotifications(
            null,
            { limit: 20, offset: 0 },
            {
                prisma,
                userId: 42,
                locale: 'en',
            },
        );

        expect(result).toEqual([
            expect.objectContaining({
                id: 1,
                displayTitle: 'Promoted to Initiate',
                displayBody: 'Your role in “Alpha” changed from Visitor to Initiate. You reached 3 sent messages and crossed the 3-message threshold for Initiate.',
            }),
            expect.objectContaining({
                id: 2,
                displayTitle: 'Your message was forwarded',
                displayBody: 'alice forwarded your message to Alpha.',
            }),
            expect.objectContaining({
                id: 3,
                displayTitle: 'Your message was highlighted',
                displayBody: 'Another member highlighted your discussion message.',
            }),
            expect.objectContaining({
                id: 4,
                displayTitle: 'Discussion ready for a draft',
                displayBody: 'This discussion is showing draft-ready signals (12 messages, 75% focused, 2 questions).\nOpen the Draft tab to shape it before turning it into a crystal.\nSummary: A draft is forming.',
            }),
        ]);
    });

    test('myNotifications localizes canonical english draft notifications back into zh display copy', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 6,
                        type: 'draft',
                        title: 'Discussion ready for a draft',
                        body: 'This discussion is showing draft-ready signals (12 messages, 75% focused, 2 questions).\nOpen the Draft tab to shape it before turning it into a crystal.\nSummary: A draft is forming.',
                        sourceType: 'discussion_trigger',
                        sourceId: '7',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:05:00.000Z'),
                    },
                ])),
            },
            circle: {
                findMany: jest.fn(async () => ([
                    { id: 7, name: 'Alpha' },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Query.myNotifications(
            null,
            { limit: 20, offset: 0 },
            {
                prisma,
                userId: 42,
                locale: 'zh',
            },
        );

        expect(result).toEqual([
            expect.objectContaining({
                id: 6,
                displayTitle: '讨论可转草稿',
                displayBody: '这段讨论已经出现草稿信号（12 条消息，聚焦 75%，问题 2 条）。\n打开「草稿」页继续整理，再决定是否结晶。\n总结：A draft is forming.',
            }),
        ]);
    });

    test('myNotifications keeps unknown notification copy untouched', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 5,
                        type: 'citation',
                        title: '引用提醒',
                        body: '有人引用了你的内容',
                        sourceType: 'knowledge',
                        sourceId: 'k-1',
                        circleId: null,
                        read: false,
                        createdAt: new Date('2026-04-03T10:04:00.000Z'),
                    },
                ])),
            },
            circle: {
                findMany: jest.fn(async () => ([])),
            },
        } as any;

        const result = await (resolvers as any).Query.myNotifications(
            null,
            { limit: 20, offset: 0 },
            {
                prisma,
                userId: 42,
                locale: 'fr',
            },
        );

        expect(result).toEqual([
            expect.objectContaining({
                id: 5,
                title: '引用提醒',
                body: '有人引用了你的内容',
                displayTitle: '引用提醒',
                displayBody: '有人引用了你的内容',
            }),
        ]);
    });

    test('identity notifications keep the historical circle name from the stored event snapshot', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 6,
                        type: 'identity',
                        title: '身份晋升为成员',
                        body: '你在「Alpha」的身份由入局者变更为成员。原因：已获得 2 次引用，达到 2 次门槛，已晋升为成员。',
                        sourceType: 'circle_identity',
                        sourceId: 'Initiate->Member',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:05:00.000Z'),
                    },
                ])),
            },
            circle: {
                findMany: jest.fn(async () => ([
                    { id: 7, name: 'Beta' },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Query.myNotifications(
            null,
            { limit: 20, offset: 0 },
            {
                prisma,
                userId: 42,
                locale: 'en',
            },
        );

        expect(result).toEqual([
            expect.objectContaining({
                id: 6,
                displayBody: 'Your role in “Alpha” changed from Initiate to Member. You reached 2 citations and crossed the 2-citation threshold for Member.',
            }),
        ]);
    });
});
