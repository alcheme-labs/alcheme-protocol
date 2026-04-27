import { describe, expect, test, jest } from '@jest/globals';

import { serviceConfig } from '../../config/services';
import { evaluateAndUpdate } from '../machine';
import { IdentityLevel } from '../thresholds';

describe('identity machine feedback side effects', () => {
    const originalNotificationMode = serviceConfig.identity.notificationMode;
    afterEach(() => {
        serviceConfig.identity.notificationMode = originalNotificationMode;
    });

    test('persists membership event and notification when identity changes', async () => {
        const tx = {
            circleMember: {
                update: jest.fn(async () => ({})),
            },
            circleMembershipEvent: {
                create: jest.fn(async () => ({})),
            },
            notification: {
                create: jest.fn(async () => ({})),
            },
        };

        const prisma = {
            circleMember: {
                findUnique: jest.fn(async () => ({
                    identityLevel: IdentityLevel.Visitor,
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 8 } },
                    { userId: 12, user: { reputationScore: 6 } },
                ])),
            },
            post: {
                count: jest.fn(async () => 4),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-02T09:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    reputationScore: 8,
                })),
            },
            $transaction: jest.fn(async (callback: (txClient: typeof tx) => Promise<void>) => callback(tx)),
        } as any;

        const result = await evaluateAndUpdate(prisma, 11, 7, { circleName: 'E2E Circle 8' });

        expect(result.changed).toBe(true);
        expect(result.previousLevel).toBe(IdentityLevel.Visitor);
        expect(result.newLevel).toBe(IdentityLevel.Initiate);
        expect(result.reason).toBe('已发送 4 条消息，达到 3 条可晋升为入局者。');
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.circleMember.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { circleId_userId: { circleId: 7, userId: 11 } },
            data: { identityLevel: IdentityLevel.Initiate },
        }));
        expect(tx.circleMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                circleId: 7,
                userId: 11,
                eventType: 'IdentityChanged',
                reason: '已发送 4 条消息，达到 3 条门槛，已晋升为入局者。',
                metadata: expect.objectContaining({
                    fromLevel: IdentityLevel.Visitor,
                    toLevel: IdentityLevel.Initiate,
                    source: 'identity_cron',
                }),
            }),
        }));
        expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                userId: 11,
                type: 'identity',
                title: 'identity.level_changed',
                sourceType: 'circle_identity',
                sourceId: 'Visitor->Initiate',
                circleId: 7,
                read: false,
                body: null,
                metadata: expect.objectContaining({
                    messageKey: 'identity.level_changed',
                    params: expect.objectContaining({
                        circleName: 'E2E Circle 8',
                        previousLevel: IdentityLevel.Visitor,
                        nextLevel: IdentityLevel.Initiate,
                        reasonKey: 'identity.message_threshold_promoted',
                        reasonParams: {
                            messageCount: '4',
                            threshold: '3',
                        },
                    }),
                }),
            }),
        }));
    });

    test('does not emit side effects when identity level does not change', async () => {
        const prisma = {
            circleMember: {
                findUnique: jest.fn(async () => ({
                    identityLevel: IdentityLevel.Initiate,
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 8 } },
                    { userId: 12, user: { reputationScore: 6 } },
                ])),
            },
            post: {
                count: jest.fn(async () => 1),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-02T09:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    reputationScore: 8,
                })),
            },
            $transaction: jest.fn(async () => undefined),
        } as any;

        const result = await evaluateAndUpdate(prisma, 11, 7);

        expect(result.changed).toBe(false);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('skips identity notification when notification policy is none', async () => {
        serviceConfig.identity.notificationMode = 'none';
        const tx = {
            circleMember: {
                update: jest.fn(async () => ({})),
            },
            circleMembershipEvent: {
                create: jest.fn(async () => ({})),
            },
            notification: {
                create: jest.fn(async () => ({})),
            },
        };

        const prisma = {
            circleMember: {
                findUnique: jest.fn(async () => ({
                    identityLevel: IdentityLevel.Visitor,
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 8 } },
                    { userId: 12, user: { reputationScore: 6 } },
                ])),
            },
            post: {
                count: jest.fn(async () => 4),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-02T09:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    reputationScore: 8,
                })),
            },
            $transaction: jest.fn(async (callback: (txClient: typeof tx) => Promise<void>) => callback(tx)),
        } as any;

        const result = await evaluateAndUpdate(prisma, 11, 7, { circleName: 'E2E Circle 8' });

        expect(result.changed).toBe(true);
        expect(tx.circleMembershipEvent.create).toHaveBeenCalledTimes(1);
        expect(tx.notification.create).not.toHaveBeenCalled();
    });

    test('persists completed promotion wording for elder upgrades', async () => {
        const tx = {
            circleMember: {
                update: jest.fn(async () => ({})),
            },
            circleMembershipEvent: {
                create: jest.fn(async () => ({})),
            },
            notification: {
                create: jest.fn(async () => ({})),
            },
        };

        const prisma = {
            circleMember: {
                findUnique: jest.fn(async () => ({
                    identityLevel: IdentityLevel.Member,
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 100 } },
                    { userId: 12, user: { reputationScore: 90 } },
                    { userId: 13, user: { reputationScore: 80 } },
                    { userId: 14, user: { reputationScore: 70 } },
                    { userId: 15, user: { reputationScore: 60 } },
                    { userId: 16, user: { reputationScore: 50 } },
                    { userId: 17, user: { reputationScore: 40 } },
                    { userId: 18, user: { reputationScore: 30 } },
                    { userId: 19, user: { reputationScore: 20 } },
                    { userId: 20, user: { reputationScore: 10 } },
                ])),
            },
            post: {
                count: jest.fn(async () => 0),
                findMany: jest.fn(async () => []),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date(),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    reputationScore: 100,
                })),
            },
            $transaction: jest.fn(async (callback: (txClient: typeof tx) => Promise<void>) => callback(tx)),
        } as any;

        const result = await evaluateAndUpdate(prisma, 11, 7, { circleName: 'E2E Circle 8' });

        expect(result.changed).toBe(true);
        expect(result.previousLevel).toBe(IdentityLevel.Member);
        expect(result.newLevel).toBe(IdentityLevel.Elder);
        expect(result.reason).toBe('当前信誉位于前 10%（阈值前 10%）可晋升为长老。');
        expect(tx.circleMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                reason: '当前信誉位于前 10%（阈值前 10%），已晋升为长老。',
            }),
        }));
        expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                title: 'identity.level_changed',
                body: null,
                metadata: expect.objectContaining({
                    messageKey: 'identity.level_changed',
                    params: expect.objectContaining({
                        reasonKey: 'identity.reputation_threshold_promoted',
                        reasonParams: {
                            reputationPercentile: '10',
                            threshold: '10',
                        },
                    }),
                }),
            }),
        }));
    });

    test('persists completed promotion wording for member upgrades', async () => {
        const tx = {
            circleMember: {
                update: jest.fn(async () => ({})),
            },
            circleMembershipEvent: {
                create: jest.fn(async () => ({})),
            },
            notification: {
                create: jest.fn(async () => ({})),
            },
        };

        const prisma = {
            circleMember: {
                findUnique: jest.fn(async () => ({
                    identityLevel: IdentityLevel.Initiate,
                })),
                findMany: jest.fn(async () => ([
                    { userId: 11, user: { reputationScore: 40 } },
                    { userId: 12, user: { reputationScore: 20 } },
                ])),
            },
            post: {
                count: jest.fn(async (input?: { where?: { parentPostId?: { in?: number[] } } }) => (
                    input?.where?.parentPostId ? 3 : 0
                )),
                findMany: jest.fn(async () => [{ id: 91 }, { id: 92 }]),
                findFirst: jest.fn(async () => ({
                    createdAt: new Date('2026-03-02T09:00:00.000Z'),
                })),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    reputationScore: 40,
                })),
            },
            $transaction: jest.fn(async (callback: (txClient: typeof tx) => Promise<void>) => callback(tx)),
        } as any;

        const result = await evaluateAndUpdate(prisma, 11, 7, { circleName: 'E2E Circle 8' });

        expect(result.changed).toBe(true);
        expect(result.previousLevel).toBe(IdentityLevel.Initiate);
        expect(result.newLevel).toBe(IdentityLevel.Member);
        expect(result.reason).toBe('已获得 3 次引用，达到 2 次可晋升为成员。');
        expect(tx.circleMembershipEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                reason: '已获得 3 次引用，达到 2 次门槛，已晋升为成员。',
            }),
        }));
        expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                title: 'identity.level_changed',
                body: null,
                metadata: expect.objectContaining({
                    messageKey: 'identity.level_changed',
                    params: expect.objectContaining({
                        reasonKey: 'identity.citation_threshold_promoted',
                        reasonParams: {
                            citationCount: '3',
                            threshold: '2',
                        },
                    }),
                }),
            }),
        }));
    });
});
