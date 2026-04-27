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

    test('myNotifications localizes indexer-generated crystal notifications for en locale', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 7,
                        type: 'crystal',
                        title: '知识已结晶',
                        body: '你的知识「# Alcheme Founder Vision: From Recognition Gap to Social Infrastructure for Know」已成功结晶',
                        sourceType: 'knowledge',
                        sourceId: 'knowledge-1',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:06:00.000Z'),
                    },
                    {
                        id: 8,
                        type: 'crystal',
                        title: '你的图腾开始萌芽了',
                        body: '你的首个知识晶体为图腾注入了生命',
                        sourceType: 'totem',
                        sourceId: 'totem:sprout',
                        circleId: null,
                        read: false,
                        createdAt: new Date('2026-04-03T10:07:00.000Z'),
                    },
                    {
                        id: 9,
                        type: 'citation',
                        title: '你的晶体被引用了',
                        body: '你的知识「Alpha」被其他晶体引用',
                        sourceType: 'knowledge',
                        sourceId: 'ref:source:target',
                        circleId: null,
                        read: false,
                        createdAt: new Date('2026-04-03T10:08:00.000Z'),
                    },
                    {
                        id: 10,
                        type: 'circle',
                        title: '晶体里程碑',
                        body: '你已拥有 5 枚知识晶体！继续探索更多圈层吧',
                        sourceType: 'milestone',
                        sourceId: 'milestone:5',
                        circleId: null,
                        read: false,
                        createdAt: new Date('2026-04-03T10:09:00.000Z'),
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
                id: 7,
                displayTitle: 'Knowledge crystallized',
                displayBody: 'Your knowledge “# Alcheme Founder Vision: From Recognition Gap to Social Infrastructure for Know” was successfully crystallized.',
            }),
            expect.objectContaining({
                id: 8,
                displayTitle: 'Your totem began to sprout',
                displayBody: 'Your first knowledge crystal brought your totem to life.',
            }),
            expect.objectContaining({
                id: 9,
                displayTitle: 'Your crystal was cited',
                displayBody: 'Your knowledge “Alpha” was cited by another crystal.',
            }),
            expect.objectContaining({
                id: 10,
                displayTitle: 'Crystal milestone',
                displayBody: 'You now have 5 knowledge crystals. Keep exploring more circles.',
            }),
        ]);
    });

    test('myNotifications prefers structured notification metadata over stored body parsing', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 11,
                        type: 'crystal',
                        title: 'knowledge.crystallized',
                        body: null,
                        metadata: {
                            messageKey: 'knowledge.crystallized',
                            params: {
                                knowledgeTitle: 'Structured Contract',
                            },
                        },
                        sourceType: 'knowledge',
                        sourceId: 'knowledge-structured',
                        circleId: null,
                        read: false,
                        createdAt: new Date('2026-04-03T10:10:00.000Z'),
                    },
                    {
                        id: 12,
                        type: 'circle',
                        title: 'knowledge.crystal_milestone',
                        body: 'legacy body intentionally not parseable',
                        metadata: {
                            messageKey: 'knowledge.crystal_milestone',
                            params: {
                                milestone: 10,
                            },
                        },
                        sourceType: 'milestone',
                        sourceId: 'legacy-source',
                        circleId: null,
                        read: false,
                        createdAt: new Date('2026-04-03T10:11:00.000Z'),
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
                id: 11,
                displayTitle: 'Knowledge crystallized',
                displayBody: 'Your knowledge “Structured Contract” was successfully crystallized.',
            }),
            expect.objectContaining({
                id: 12,
                displayTitle: 'Crystal milestone',
                displayBody: 'You now have 10 knowledge crystals. Keep exploring more circles.',
            }),
        ]);
    });

    test('myNotifications localizes structured identity demotion reasons without Chinese fallback', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 13,
                        type: 'identity',
                        title: 'identity.level_changed',
                        body: null,
                        metadata: {
                            messageKey: 'identity.level_changed',
                            params: {
                                circleName: 'Alpha',
                                previousLevel: 'Elder',
                                nextLevel: 'Member',
                                reasonKey: 'identity.reputation_demotion',
                                reasonParams: {
                                    reputationPercentile: '35',
                                    threshold: '10',
                                },
                            },
                        },
                        sourceType: 'circle_identity',
                        sourceId: 'Elder->Member',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:12:00.000Z'),
                    },
                    {
                        id: 14,
                        type: 'identity',
                        title: 'identity.level_changed',
                        body: null,
                        metadata: {
                            messageKey: 'identity.level_changed',
                            params: {
                                previousLevel: 'Member',
                                nextLevel: 'Initiate',
                                reasonKey: 'identity.inactivity_demotion',
                                reasonParams: {
                                    daysInactive: 45,
                                    threshold: 30,
                                },
                            },
                        },
                        sourceType: 'circle_identity',
                        sourceId: 'Member->Initiate',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:13:00.000Z'),
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
                id: 13,
                displayTitle: 'Identity updated to Member',
                displayBody: 'Your role in “Alpha” changed from Elder to Member. Your reputation is now in the top 35%, outside the Elder threshold of 10%, so your role changed to Member.',
            }),
            expect.objectContaining({
                id: 14,
                displayTitle: 'Identity updated to Initiate',
                displayBody: 'Your role in “Alpha” changed from Member to Initiate. You have been inactive for 45 days; the inactivity threshold is 30 days.',
            }),
        ]);
        expect(result.map((notification: any) => notification.displayBody).join('\n')).not.toMatch(/[\u4e00-\u9fff]/);
    });

    test('myNotifications localizes source-neutral structured identity notifications for zh locale', async () => {
        const prisma = {
            notification: {
                findMany: jest.fn(async () => ([
                    {
                        id: 15,
                        type: 'identity',
                        title: 'identity.level_changed',
                        body: null,
                        metadata: {
                            messageKey: 'identity.level_changed',
                            params: {
                                circleName: 'Alpha',
                                previousLevel: 'Elder',
                                nextLevel: 'Member',
                                reasonKey: 'identity.reputation_demotion',
                                reasonParams: {
                                    reputationPercentile: '35',
                                    threshold: '10',
                                },
                            },
                        },
                        sourceType: 'circle_identity',
                        sourceId: 'Elder->Member',
                        circleId: 7,
                        read: false,
                        createdAt: new Date('2026-04-03T10:14:00.000Z'),
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
                locale: 'zh',
            },
        );

        expect(result).toEqual([
            expect.objectContaining({
                id: 15,
                title: 'identity.level_changed',
                body: null,
                displayTitle: '身份调整为成员',
                displayBody: '你在「Alpha」的身份由长老变更为成员。原因：当前信誉已降至前 35% 之外（阈值前 10%），身份调整为成员。',
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
                        type: 'system',
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
