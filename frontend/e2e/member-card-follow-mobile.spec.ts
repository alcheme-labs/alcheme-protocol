import { expect, test, type Route } from '@playwright/test';

import { installIdentityOnboardingMocks } from './support/identity-onboarding-app';
import { installMockWallet } from './support/mock-wallet';

const NOW = new Date('2026-03-12T10:00:00.000Z').toISOString();

function json(body: unknown, status = 200) {
    return {
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    };
}

function readGraphQLOperation(route: Route): { operationName: string; queryText: string } {
    const payload = route.request().postDataJSON() as
        | {
            operationName?: string;
            query?: string;
        }
        | null;

    return {
        operationName: payload?.operationName || '',
        queryText: payload?.query || '',
    };
}

function buildCirclePayload() {
    return {
        data: {
            circle: {
                __typename: 'Circle',
                id: 246,
                name: '测试圈层',
                description: '用于 follow mobile e2e。',
                avatarUri: null,
                circleType: 'Open',
                level: 0,
                knowledgeCount: 0,
                genesisMode: 'BLANK',
                kind: 'main',
                mode: 'social',
                minCrystals: 0,
                parentCircleId: null,
                stats: {
                    __typename: 'CircleStats',
                    members: 2,
                    posts: 1,
                },
                creator: {
                    __typename: 'User',
                    id: 1,
                    handle: 'owner',
                    pubkey: 'owner_pubkey',
                    displayName: 'Owner',
                },
                createdAt: NOW,
                members: [
                    {
                        __typename: 'CircleMember',
                        user: {
                            __typename: 'User',
                            id: 77,
                            handle: 'followed_author',
                            pubkey: 'Bn8P3o2FJszHh2WwS2NnW5p7knmVQmUdH5XVRkTx7wdM',
                            displayName: 'Followed Author',
                            avatarUri: null,
                        },
                        role: 'Member',
                        status: 'Active',
                        identityLevel: 'Member',
                        joinedAt: NOW,
                    },
                ],
                posts: [
                    {
                        __typename: 'Post',
                        id: 9001,
                        contentId: 'feed_post_1',
                        text: '这是一条用于 follow 按钮回归测试的动态。',
                        contentType: 'text',
                        tags: [],
                        status: 'Published',
                        visibility: 'Public',
                        relevanceScore: 0.9,
                        liked: false,
                        repostOfAddress: null,
                        repostOf: null,
                        stats: {
                            __typename: 'PostStats',
                            likes: 0,
                            reposts: 0,
                            replies: 0,
                            views: 0,
                            heatScore: 0,
                        },
                        author: {
                            __typename: 'User',
                            id: 77,
                            handle: 'followed_author',
                            pubkey: 'Bn8P3o2FJszHh2WwS2NnW5p7knmVQmUdH5XVRkTx7wdM',
                            displayName: 'Followed Author',
                            avatarUri: null,
                            reputationScore: 0,
                        },
                        circle: {
                            __typename: 'Circle',
                            id: 246,
                            name: '测试圈层',
                        },
                        createdAt: NOW,
                        updatedAt: NOW,
                    },
                ],
            },
            circleDescendants: [],
        },
    };
}

test.describe('MemberCard follow mobile entry', () => {
    test.beforeEach(async ({ page }) => {
        await installMockWallet(page);
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
        });
    });

    test('shows follow button on member card with mobile touch target size', async ({ page }) => {
        await page.route('**/graphql', async (route: Route) => {
            const { operationName, queryText } = readGraphQLOperation(route);

            if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
                await route.fulfill(json(buildCirclePayload()));
                return;
            }

            if (operationName === 'GetCirclePosts' || queryText.includes('query GetCirclePosts')) {
                await route.fulfill(json({
                    data: {
                        circle: {
                            __typename: 'Circle',
                            id: 246,
                            posts: buildCirclePayload().data.circle.posts,
                        },
                    },
                }));
                return;
            }

            if (operationName === 'GetMemberProfile' || queryText.includes('query GetMemberProfile')) {
                await route.fulfill(json({
                    data: {
                        memberProfile: {
                            user: {
                                id: 77,
                                handle: 'followed_author',
                                pubkey: 'Bn8P3o2FJszHh2WwS2NnW5p7knmVQmUdH5XVRkTx7wdM',
                                displayName: 'Followed Author',
                                avatarUri: null,
                                reputationScore: 12,
                            },
                            viewerFollows: false,
                            isSelf: false,
                            role: 'Member',
                            joinedAt: NOW,
                            knowledgeCount: 1,
                            totalCitations: 2,
                            circleCount: 1,
                            sharedCircles: [],
                            recentActivity: [],
                        },
                    },
                }));
                return;
            }

            await route.fallback();
        });

        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: '动态' }).click();
        await page.locator('[class*="feedAvatar"]').first().click();

        const followButton = page.getByRole('button', { name: '关注' });
        await expect(followButton).toBeVisible();

        const box = await followButton.boundingBox();
        expect(box?.width || 0).toBeGreaterThanOrEqual(44);
        expect(box?.height || 0).toBeGreaterThanOrEqual(44);
    });

    test('does not show follow button when viewing self profile', async ({ page }) => {
        await page.route('**/graphql', async (route: Route) => {
            const { operationName, queryText } = readGraphQLOperation(route);

            if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
                await route.fulfill(json(buildCirclePayload()));
                return;
            }

            if (operationName === 'GetCirclePosts' || queryText.includes('query GetCirclePosts')) {
                await route.fulfill(json({
                    data: {
                        circle: {
                            __typename: 'Circle',
                            id: 246,
                            posts: buildCirclePayload().data.circle.posts,
                        },
                    },
                }));
                return;
            }

            if (operationName === 'GetMemberProfile' || queryText.includes('query GetMemberProfile')) {
                await route.fulfill(json({
                    data: {
                        memberProfile: {
                            user: {
                                id: 77,
                                handle: 'followed_author',
                                pubkey: 'Bn8P3o2FJszHh2WwS2NnW5p7knmVQmUdH5XVRkTx7wdM',
                                displayName: 'Followed Author',
                                avatarUri: null,
                                reputationScore: 12,
                            },
                            viewerFollows: false,
                            isSelf: true,
                            role: 'Member',
                            joinedAt: NOW,
                            knowledgeCount: 1,
                            totalCitations: 2,
                            circleCount: 1,
                            sharedCircles: [],
                            recentActivity: [],
                        },
                    },
                }));
                return;
            }

            await route.fallback();
        });

        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: '动态' }).click();
        await page.locator('[class*="feedAvatar"]').first().click();

        await expect(page.getByRole('button', { name: '关注' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '已关注' })).toHaveCount(0);
    });
});
