import { test, expect, type Page, type Route } from '@playwright/test';

type CircleNode = {
    id: number;
    name: string;
    level: number;
    kind: 'main' | 'auxiliary';
    mode: 'knowledge' | 'social';
    parentCircleId: number | null;
};

function makeCircle(circle: CircleNode) {
    return {
        __typename: 'Circle',
        id: circle.id,
        name: circle.name,
        description: null,
        avatarUri: null,
        circleType: 'Open',
        level: circle.level,
        knowledgeCount: 0,
        genesisMode: 'BLANK',
        kind: circle.kind,
        mode: circle.mode,
        minCrystals: 0,
        parentCircleId: circle.parentCircleId,
        stats: { __typename: 'CircleStats', members: 3, posts: 0 },
        creator: {
            __typename: 'User',
            id: 1,
            handle: 'owner',
            pubkey: 'owner_pubkey',
            displayName: 'Owner',
        },
        createdAt: new Date('2026-02-28T10:00:00.000Z').toISOString(),
        members: [],
        posts: [],
    };
}

async function installCircleGraphqlMocks(page: Page) {
    const requestedKnowledgeCircleIds: number[] = [];

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
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        circle: makeCircle({
                            id: 1,
                            name: 'Root Knowledge Circle',
                            level: 0,
                            kind: 'main',
                            mode: 'knowledge',
                            parentCircleId: null,
                        }),
                        circleDescendants: [
                            makeCircle({
                                id: 2,
                                name: 'Aux Knowledge Circle',
                                level: 1,
                                kind: 'auxiliary',
                                mode: 'knowledge',
                                parentCircleId: 1,
                            }),
                        ],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetCircleDrafts' || queryText.includes('query GetCircleDrafts')) {
            const requestedCircleId = Number(variables.circleId);
            const drafts = requestedCircleId === 2
                ? [
                    {
                        __typename: 'DraftSummary',
                        postId: 201,
                        title: 'Aux Draft',
                        excerpt: 'sub-circle draft',
                        status: 'ACTIVE',
                        commentCount: 1,
                        ageDays: 0,
                        createdAt: '2026-02-28T10:00:00.000Z',
                        updatedAt: '2026-02-28T10:05:00.000Z',
                    },
                ]
                : [
                    {
                        __typename: 'DraftSummary',
                        postId: 101,
                        title: 'Root Draft',
                        excerpt: 'root-circle draft',
                        status: 'ACTIVE',
                        commentCount: 2,
                        ageDays: 0,
                        createdAt: '2026-02-28T09:00:00.000Z',
                        updatedAt: '2026-02-28T09:10:00.000Z',
                    },
                ];

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        circleDrafts: drafts,
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

        if (operationName === 'GetKnowledgeByCircle' || queryText.includes('query GetKnowledgeByCircle')) {
            const requestedCircleId = Number(variables.circleId);
            requestedKnowledgeCircleIds.push(requestedCircleId);

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        knowledgeByCircle: [],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetNotifications' || queryText.includes('query GetNotifications')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        myNotifications: [],
                    },
                }),
            });
            return;
        }

        await route.continue();
    });

    return { requestedKnowledgeCircleIds };
}

async function installMembershipMocks(page: Page) {
    await page.route('**/api/v1/membership/circles/*/state', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                joinState: 'joined',
                policy: 'open',
                memberRole: 'Member',
                membershipStatus: 'Active',
                identityLevel: 'member',
                userCrystals: 0,
            }),
        });
    });
}

test.describe('Circle Crucible Scope', () => {
    test('knowledge auxiliary circle uses its own draft list', async ({ page }) => {
        await installCircleGraphqlMocks(page);
        await installMembershipMocks(page);
        await page.addInitScript(() => {
            window.localStorage.setItem('alcheme_active_tier_1', '2');
        });

        await page.goto('/circles/1?tab=crucible');

        await expect(page.getByText('Aux Draft')).toBeVisible();
        await expect(page.getByText('Root Draft')).toHaveCount(0);
    });

    test('knowledge auxiliary circle uses its own sanctuary list', async ({ page }) => {
        const { requestedKnowledgeCircleIds } = await installCircleGraphqlMocks(page);
        await installMembershipMocks(page);
        await page.addInitScript(() => {
            window.localStorage.setItem('alcheme_active_tier_1', '2');
        });

        await page.goto('/circles/1?tab=sanctuary');
        await expect.poll(() => requestedKnowledgeCircleIds.at(-1) ?? null).toBe(2);
    });
});
