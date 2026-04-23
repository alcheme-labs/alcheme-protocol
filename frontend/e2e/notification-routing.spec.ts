import { test, expect, type Page, type Route } from '@playwright/test';

type MockNotification = {
    id: number;
    type: string;
    title: string;
    body: string | null;
    sourceType: string | null;
    sourceId: string | null;
    circleId: number | null;
    read: boolean;
    createdAt: string;
};

async function installNotificationGraphqlMocks(page: Page, notifications: MockNotification[]) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as { operationName?: string; query?: string; variables?: Record<string, unknown> } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';
        const variables = payload?.variables || {};

        if (operationName === 'GetNotifications' || queryText.includes('query GetNotifications')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        myNotifications: notifications,
                    },
                }),
            });
            return;
        }

        if (operationName === 'MarkNotificationsRead' || queryText.includes('mutation MarkNotificationsRead')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        markNotificationsRead: true,
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
            const circleId = Number(variables.id ?? 1);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        circle: {
                            __typename: 'Circle',
                            id: circleId,
                            name: `Circle ${circleId}`,
                            description: null,
                            avatarUri: null,
                            circleType: 'Open',
                            level: 0,
                            knowledgeCount: 0,
                            genesisMode: 'BLANK',
                            kind: 'main',
                            mode: 'social',
                            minCrystals: 0,
                            parentCircleId: null,
                            stats: { __typename: 'CircleStats', members: 1, posts: 0 },
                            creator: {
                                __typename: 'User',
                                id: 1,
                                handle: 'owner',
                                pubkey: 'owner_pubkey',
                                displayName: 'Owner',
                            },
                            createdAt: new Date('2026-03-02T08:00:00.000Z').toISOString(),
                            members: [],
                            posts: [],
                        },
                        circleDescendants: [],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetCirclePosts' || queryText.includes('query GetCirclePosts')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        circle: {
                            __typename: 'Circle',
                            id: Number(variables.id ?? 1),
                            posts: [],
                        },
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetCircleDrafts' || queryText.includes('query GetCircleDrafts')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { __typename: 'Query', circleDrafts: [] },
                }),
            });
            return;
        }

        if (operationName === 'GetKnowledgeByCircle' || queryText.includes('query GetKnowledgeByCircle')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { __typename: 'Query', knowledgeByCircle: [] },
                }),
            });
            return;
        }

        if (operationName === 'GetKnowledge' || queryText.includes('query GetKnowledge(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        knowledge: {
                            __typename: 'Knowledge',
                            id: 42,
                            knowledgeId: 'kn_target_42',
                            onChainAddress: 'kn_target_42',
                            title: 'Target Crystal',
                            description: 'Knowledge target body',
                            ipfsCid: null,
                            contentHash: null,
                            version: 1,
                            contributorsRoot: null,
                            contributorsCount: 1,
                            createdAt: new Date('2026-03-01T09:00:00.000Z').toISOString(),
                            crystalParams: null,
                            author: {
                                __typename: 'User',
                                id: 1,
                                handle: 'author',
                                pubkey: 'author_pubkey',
                                displayName: 'Author',
                            },
                            circle: {
                                __typename: 'Circle',
                                id: 7,
                                name: 'Knowledge Circle',
                            },
                            sourceCircle: null,
                            contributors: [],
                            stats: {
                                __typename: 'KnowledgeStats',
                                qualityScore: 0.8,
                                citationCount: 1,
                                heatScore: 10,
                            },
                        },
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetKnowledgeByOnChainAddress' || queryText.includes('query GetKnowledgeByOnChainAddress')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        knowledgeByOnChainAddress: null,
                    },
                }),
            });
            return;
        }

        await route.continue();
    });

    await page.route('**/api/v1/membership/circles/*/me', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                authenticated: true,
                circleId: 1,
                joinState: 'joined',
                policy: {
                    joinRequirement: 'Free',
                    circleType: 'Open',
                    minCrystals: 0,
                    requiresApproval: false,
                    requiresInvite: false,
                },
                userCrystals: 0,
                missingCrystals: 0,
                membership: {
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                    joinedAt: new Date('2026-03-02T08:00:00.000Z').toISOString(),
                },
            }),
        });
    });

    await page.route('**/api/v1/discussion/circles/*/messages*', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                circleId: 1,
                roomKey: 'circle:1',
                count: 0,
                watermark: null,
                messages: [],
            }),
        });
    });
}

test.describe('Notification Routing', () => {
    test('draft notifications route to the target circle crucible tab', async ({ page }) => {
        await installNotificationGraphqlMocks(page, [
            {
                id: 101,
                type: 'draft',
                title: '讨论可转草稿',
                body: '建议进入草稿页继续整理',
                sourceType: 'discussion_trigger',
                sourceId: '7',
                circleId: 7,
                read: false,
                createdAt: new Date('2026-02-28T10:00:00.000Z').toISOString(),
            },
        ]);

        await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('建议进入草稿页继续整理')).toBeVisible();
        await Promise.all([
            page.waitForURL(/\/circles\/7\?tab=crucible$/),
            page.getByText('建议进入草稿页继续整理').click(),
        ]);
    });

    test('highlight notifications route to the target circle plaza tab', async ({ page }) => {
        await installNotificationGraphqlMocks(page, [
            {
                id: 202,
                type: 'highlight',
                title: '你的发言被点亮了',
                body: '你在讨论中的发言被其他成员点亮',
                sourceType: 'discussion',
                sourceId: 'env_abc',
                circleId: 9,
                read: false,
                createdAt: new Date('2026-02-28T10:05:00.000Z').toISOString(),
            },
        ]);

        await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('你在讨论中的发言被其他成员点亮')).toBeVisible();
        await Promise.all([
            page.waitForURL(/\/circles\/9\?tab=plaza$/),
            page.getByText('你在讨论中的发言被其他成员点亮').click(),
        ]);
    });

    test('forward notifications route to the target circle plaza tab with message focus', async ({ page }) => {
        await installNotificationGraphqlMocks(page, [
            {
                id: 250,
                type: 'forward',
                title: '你的消息被转发了',
                body: '另一位成员将你的消息转发到了目标圈层',
                sourceType: 'discussion',
                sourceId: 'env_forward_target_1',
                circleId: 12,
                read: false,
                createdAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
            },
        ]);

        await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('另一位成员将你的消息转发到了目标圈层')).toBeVisible();
        await Promise.all([
            page.waitForURL(/\/circles\/12\?tab=plaza&focusEnvelopeId=env_forward_target_1$/),
            page.getByText('另一位成员将你的消息转发到了目标圈层').click(),
        ]);
    });

    test('citation notifications route to the cited crystal instead of the composite reference id', async ({ page }) => {
        await installNotificationGraphqlMocks(page, [
            {
                id: 303,
                type: 'citation',
                title: '你的晶体被引用了',
                body: '另一枚晶体引用了你的知识',
                sourceType: 'knowledge',
                sourceId: 'ref:kn_source_11:kn_target_42',
                circleId: 7,
                read: false,
                createdAt: new Date('2026-03-01T09:00:00.000Z').toISOString(),
            },
        ]);

        await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('另一枚晶体引用了你的知识')).toBeVisible();
        await Promise.all([
            page.waitForURL(/\/knowledge\/kn_target_42$/),
            page.getByText('另一枚晶体引用了你的知识').click(),
        ]);
    });
});
