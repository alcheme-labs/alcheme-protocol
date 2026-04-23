import { test, expect, type Page, type Route } from '@playwright/test';

const ROOT_POST = {
    __typename: 'Post',
    id: 901,
    contentId: 'FeedThreadRoot11111111111111111111111111111',
    text: '根动态：讨论热度如何进入知识热度',
    contentType: 'Post',
    tags: [],
    status: 'Published',
    visibility: 'Public',
    relevanceScore: null,
    liked: false,
    repostOfAddress: null,
    repostOf: null,
    stats: {
        __typename: 'PostStats',
        likes: 3,
        reposts: 1,
        replies: 2,
        views: 18,
        heatScore: 9,
    },
    author: {
        __typename: 'User',
        id: 18,
        handle: 'alice',
        displayName: 'Alice',
        avatarUri: null,
        reputationScore: 42,
    },
    circle: {
        __typename: 'Circle',
        id: 2,
        name: 'E2E Feed Circle',
    },
    createdAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
};

const THREAD_REPLIES = [
    {
        __typename: 'Post',
        id: 902,
        contentId: 'FeedThreadReplyA111111111111111111111111111',
        text: '第一条回复：先拆分 warmness 和 radiance。',
        contentType: 'Post',
        tags: [],
        status: 'Published',
        visibility: 'Public',
        relevanceScore: null,
        liked: false,
        repostOfAddress: null,
        repostOf: null,
        stats: {
            __typename: 'PostStats',
            likes: 1,
            reposts: 0,
            replies: 0,
            views: 4,
            heatScore: 2,
        },
        author: {
            __typename: 'User',
            id: 19,
            handle: 'bob',
            displayName: 'Bob',
            avatarUri: null,
            reputationScore: 31,
        },
        circle: {
            __typename: 'Circle',
            id: 2,
            name: 'E2E Feed Circle',
        },
        createdAt: new Date('2026-03-02T10:02:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-02T10:02:00.000Z').toISOString(),
    },
    {
        __typename: 'Post',
        id: 903,
        contentId: 'FeedThreadReplyB111111111111111111111111111',
        text: '第二条回复：显式引用再计入知识热度。',
        contentType: 'Post',
        tags: [],
        status: 'Published',
        visibility: 'Public',
        relevanceScore: null,
        liked: false,
        repostOfAddress: null,
        repostOf: null,
        stats: {
            __typename: 'PostStats',
            likes: 0,
            reposts: 0,
            replies: 0,
            views: 3,
            heatScore: 1,
        },
        author: {
            __typename: 'User',
            id: 20,
            handle: 'carol',
            displayName: 'Carol',
            avatarUri: null,
            reputationScore: 28,
        },
        circle: {
            __typename: 'Circle',
            id: 2,
            name: 'E2E Feed Circle',
        },
        createdAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
        updatedAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
    },
];

function buildCirclePayload(circleId: number, overrides?: Partial<{
    kind: 'main' | 'auxiliary';
    mode: 'social' | 'knowledge';
    parentCircleId: number | null;
}>) {
    return {
        __typename: 'Circle',
        id: circleId,
        name: 'E2E Feed Circle',
        description: null,
        avatarUri: null,
        circleType: 'Open',
        level: 0,
        knowledgeCount: 0,
        genesisMode: 'BLANK',
        kind: overrides?.kind || 'auxiliary',
        mode: overrides?.mode || 'social',
        minCrystals: 0,
        parentCircleId: overrides?.parentCircleId === undefined ? 1 : overrides.parentCircleId,
        stats: { __typename: 'CircleStats', members: 3, posts: 1 },
        creator: {
            __typename: 'User',
            id: 1,
            handle: 'owner',
            pubkey: 'owner_pubkey',
            displayName: 'Owner',
        },
        createdAt: new Date('2026-03-02T09:00:00.000Z').toISOString(),
        members: [],
        posts: [ROOT_POST],
    };
}

async function installCircleGraphqlMocks(page: Page, circleOverrides?: Partial<{
    kind: 'main' | 'auxiliary';
    mode: 'social' | 'knowledge';
    parentCircleId: number | null;
}>) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as {
            operationName?: string;
            query?: string;
            variables?: Record<string, unknown>;
        } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';
        const variables = payload?.variables || {};

        if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
            const circleId = Number(variables.id ?? 2);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        circle: buildCirclePayload(circleId, circleOverrides),
                        circleDescendants: [],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetCirclePosts' || queryText.includes('query GetCirclePosts')) {
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
                            posts: circleId === 2 ? [ROOT_POST] : [],
                        },
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetPostThread' || queryText.includes('query GetPostThread(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        post: {
                            ...ROOT_POST,
                            replies: THREAD_REPLIES,
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

        if (operationName === 'GetNotifications' || queryText.includes('query GetNotifications')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: { __typename: 'Query', myNotifications: [] },
                }),
            });
            return;
        }

        await route.continue();
    });
}

async function installMembershipMocks(page: Page) {
    await page.route('**/api/v1/membership/circles/*/me', async (route: Route) => {
        const url = new URL(route.request().url());
        const circleId = Number(url.pathname.split('/').at(-2) || 1);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                authenticated: true,
                circleId,
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
                    joinedAt: new Date('2026-03-02T09:00:00.000Z').toISOString(),
                },
            }),
        });
    });

    await page.route('**/api/v1/membership/circles/*/identity-status', async (route: Route) => {
        const url = new URL(route.request().url());
        const circleId = Number(url.pathname.split('/').at(-2) || 1);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                circleId,
                currentIdentityLevel: 'Member',
                promotedBy: null,
                demotedBy: null,
                promotedAt: null,
                demotedAt: null,
                targetIdentityLevel: 'Member',
                progressPercent: 100,
                policy: {
                    notificationMode: 'all',
                },
                history: [],
            }),
        });
    });
}

test.describe('Feed Thread', () => {
    test('comment action opens focused thread sheet with replies', async ({ page }) => {
        await installCircleGraphqlMocks(page);
        await installMembershipMocks(page);

        await page.goto('/circles/2', { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: '动态' }).click();

        const feedPost = page.getByTestId(`feed-post-${ROOT_POST.contentId}`).first();
        await expect(feedPost).toBeVisible();

        await feedPost.getByTestId(`feed-post-comment-${ROOT_POST.contentId}`).click();

        const sheet = page.getByTestId('feed-thread-sheet');
        await expect(sheet.getByRole('heading', { name: '围绕这条动态的回复' })).toBeVisible();
        await expect(sheet.getByTestId('feed-thread-root-text')).toHaveText('根动态：讨论热度如何进入知识热度');
        await expect(sheet.getByText('2 条回复')).toBeVisible();
        await expect(sheet.getByTestId('feed-thread-reply-text')).toContainText([
            '第一条回复：先拆分 warmness 和 radiance。',
            '第二条回复：显式引用再计入知识热度。',
        ]);
        await expect(sheet.getByPlaceholder('连接钱包后可回复')).toBeVisible();

        await sheet.getByRole('button', { name: '关闭动态讨论' }).click();
        await expect(page.getByTestId('feed-thread-sheet')).toHaveCount(0);
    });

    test('main social circles also expose the feed tab and render posts', async ({ page }) => {
        await installCircleGraphqlMocks(page, {
            kind: 'main',
            mode: 'social',
            parentCircleId: null,
        });
        await installMembershipMocks(page);

        await page.goto('/circles/2', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[role="tab"]').nth(1)).toBeVisible();

        await page.goto('/circles/2?tab=feed', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId(`feed-post-${ROOT_POST.contentId}`).first()).toBeVisible();
    });
});
