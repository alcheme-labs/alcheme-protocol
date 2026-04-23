import { expect, test, type Page, type Route } from '@playwright/test';

const DRAFT_POST_ID = 777;

async function installGraphqlMocks(page: Page) {
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
                        circle: {
                            __typename: 'Circle',
                            id: Number(variables.id ?? 1),
                            name: 'Seeded Reference Circle',
                            description: null,
                            avatarUri: null,
                            circleType: 'Open',
                            level: 0,
                            knowledgeCount: 0,
                            genesisMode: 'SEEDED',
                            kind: 'main',
                            mode: 'knowledge',
                            minCrystals: 0,
                            parentCircleId: null,
                            stats: { __typename: 'CircleStats', members: 3, posts: 1 },
                            creator: {
                                __typename: 'User',
                                id: 2,
                                handle: 'curator',
                                pubkey: 'curator_pubkey',
                                displayName: 'Curator',
                            },
                            createdAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                            members: [],
                            posts: [],
                        },
                        circleDescendants: [],
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
                    data: {
                        circleDrafts: [
                            {
                                __typename: 'DraftSummary',
                                postId: DRAFT_POST_ID,
                                title: 'Seeded Reference Draft',
                                excerpt: 'source-linked draft',
                                heatScore: 12,
                                status: 'ACTIVE',
                                commentCount: 0,
                                ageDays: 0,
                                createdAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                                updatedAt: new Date('2026-03-25T10:01:00.000Z').toISOString(),
                            },
                        ],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetCirclePosts' || queryText.includes('query GetCirclePosts')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { circle: { __typename: 'Circle', id: 1, posts: [] } } }),
            });
            return;
        }

        if (operationName === 'GetKnowledgeByCircle' || queryText.includes('query GetKnowledgeByCircle')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { knowledgeByCircle: [] } }),
            });
            return;
        }

        if (operationName === 'GetDraftComments' || queryText.includes('query GetDraftComments')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { draftComments: [] } }),
            });
            return;
        }

        if (operationName === 'GetNotifications' || queryText.includes('query GetNotifications')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ data: { myNotifications: [] } }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: {} }),
        });
    });
}

async function installMembershipAndDraftMocks(page: Page) {
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
                userCrystals: 18,
                missingCrystals: 0,
                membership: {
                    role: 'Admin',
                    status: 'Active',
                    identityLevel: 'Elder',
                    joinedAt: new Date('2026-03-25T08:00:00.000Z').toISOString(),
                },
            }),
        });
    });

    await page.route('**/api/v1/membership/circles/*/identity-status', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                authenticated: true,
                circleId: 1,
                currentLevel: 'Elder',
                nextLevel: null,
                messagingMode: 'formal',
                hint: '你已具备完整草稿编辑与决议权限。',
                thresholds: {
                    initiateMessages: 3,
                    memberCitations: 2,
                    elderPercentile: 90,
                    inactivityDays: 30,
                },
                progress: {
                    messageCount: 6,
                    citationCount: 5,
                    reputationScore: 88,
                    reputationPercentile: 99,
                    daysSinceActive: 0,
                },
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/content`, async (route: Route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    text: '第一段正文。\n\n第二段正文。',
                    heatScore: 12,
                    updatedAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                }),
            });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`**/api/v1/draft-lifecycle/drafts/${DRAFT_POST_ID}`, async (route: Route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    lifecycle: {
                        draftPostId: DRAFT_POST_ID,
                        circleId: 1,
                        documentStatus: 'drafting',
                        currentSnapshotVersion: 1,
                        currentRound: 1,
                        policyProfileDigest: null,
                        reviewEntryMode: 'auto_or_manual',
                        draftingEndsAt: null,
                        reviewEndsAt: null,
                        reviewWindowExpiredAt: null,
                        transitionMode: 'seeded',
                        handoff: null,
                        stableSnapshot: {
                            draftVersion: 1,
                            sourceKind: 'accepted_candidate_v1_seed',
                            seedDraftAnchorId: 'anchor-seeded-1',
                            sourceEditAnchorId: null,
                            sourceSummaryHash: null,
                            sourceMessagesDigest: null,
                            contentHash: 'seeded-hash',
                            createdAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                        },
                        workingCopy: {
                            workingCopyId: 'working-copy-seeded-1',
                            draftPostId: DRAFT_POST_ID,
                            basedOnSnapshotVersion: 1,
                            workingCopyContent: '第一段正文。\n\n第二段正文。',
                            workingCopyHash: 'working-copy-hash',
                            status: 'active',
                            roomKey: `crucible-${DRAFT_POST_ID}`,
                            latestEditAnchorId: null,
                            latestEditAnchorStatus: null,
                            updatedAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                        },
                        reviewBinding: {
                            boundSnapshotVersion: 1,
                            totalThreadCount: 1,
                            openThreadCount: 1,
                            proposedThreadCount: 0,
                            acceptedThreadCount: 0,
                            appliedThreadCount: 0,
                            mismatchedApplicationCount: 0,
                            latestThreadUpdatedAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                        },
                        warnings: [],
                    },
                }),
            });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions**`, async (route: Route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    draftPostId: DRAFT_POST_ID,
                    viewerUserId: 2,
                    count: 1,
                    threads: [
                        {
                            id: 'thread-seeded-1',
                            draftPostId: DRAFT_POST_ID,
                            targetType: 'document',
                            targetRef: 'document',
                            targetVersion: 1,
                            issueType: 'knowledge_supplement',
                            state: 'open',
                            createdBy: 2,
                            createdAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                            updatedAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                            latestResolution: null,
                            latestApplication: null,
                            latestMessage: {
                                authorId: 2,
                                messageType: 'create',
                                content: '请回看 @file:materials/seed-a.md:2 的定义。',
                                createdAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                            },
                            messages: [
                                {
                                    id: 'message-seeded-1',
                                    authorId: 2,
                                    messageType: 'create',
                                    content: '请回看 @file:materials/seed-a.md:2 的定义。',
                                    createdAt: new Date('2026-03-25T10:00:00.000Z').toISOString(),
                                },
                            ],
                        },
                    ],
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true }),
        });
    });

    await page.route('**/api/v1/revision-directions/**', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                proposals: [],
                acceptedDirections: [],
            }),
        });
    });

    await page.route('**/api/v1/temporary-edit-grants/drafts/*/temporary-edit-grants', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, grants: [] }),
        });
    });

    await page.route('**/api/v1/circles/*/seeded/tree', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                circleId: 1,
                nodes: [
                    {
                        id: 1,
                        nodeType: 'directory',
                        name: 'materials',
                        path: 'materials',
                        depth: 0,
                        sortOrder: 0,
                        mimeType: null,
                        byteSize: 0,
                        lineCount: null,
                        contentText: null,
                        children: [
                            {
                                id: 2,
                                nodeType: 'file',
                                name: 'seed-a.md',
                                path: 'materials/seed-a.md',
                                depth: 1,
                                sortOrder: 0,
                                mimeType: 'text/markdown',
                                byteSize: 48,
                                lineCount: 3,
                                contentText: '# Seed A\nDefinition line\nClosing line',
                                children: [],
                            },
                        ],
                    },
                ],
            }),
        });
    });
}

test.describe('Seeded file references', () => {
    test('opens the seeded file tree, inserts @file:line references, and jumps from thread references', async ({ page }) => {
        await installGraphqlMocks(page);
        await installMembershipAndDraftMocks(page);

        await page.goto('/circles/1?tab=crucible', { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: '草稿' }).click();
        await page.getByText('Seeded Reference Draft').click();

        const seededRegion = page.getByRole('region', { name: '源文件引用' });
        await expect(seededRegion.getByRole('heading', { name: '源文件引用' })).toBeVisible();
        await seededRegion.getByRole('button', { name: 'seed-a.md', exact: true }).click();
        await seededRegion.getByRole('button', { name: 'L2', exact: true }).click();

        await page.getByRole('button', { name: '插入当前源文件引用' }).click();
        await expect(page.getByPlaceholder('描述问题、影响范围，以及你希望如何修订')).toHaveValue(
            '@file:materials/seed-a.md:2',
        );

        await page.getByRole('button', { name: '@file seed-a.md:2' }).first().click();
        await expect(page.getByText('当前定位: @file:materials/seed-a.md:2')).toBeVisible();
    });
});
