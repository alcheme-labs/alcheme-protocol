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
                            name: 'Source Material Circle',
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
                                title: 'Grounding Draft',
                                excerpt: 'source material grounding',
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

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ data: {} }),
        });
    });
}

async function installCrucibleMocks(page: Page) {
    let sourceMaterials = [] as Array<Record<string, unknown>>;

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

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/content`, async (route: Route) => {
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
    });

    await page.route(`**/api/v1/draft-lifecycle/drafts/${DRAFT_POST_ID}`, async (route: Route) => {
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
                        totalThreadCount: 0,
                        openThreadCount: 0,
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
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions**`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                viewerUserId: 2,
                count: 0,
                threads: [],
            }),
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

    await page.route('**/api/v1/circles/*/source-materials**', async (route: Route) => {
        if (route.request().method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    circleId: 1,
                    materials: sourceMaterials,
                }),
            });
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 120));
        sourceMaterials = [
            {
                id: 31,
                circleId: 1,
                draftPostId: DRAFT_POST_ID,
                name: 'meeting-notes.txt',
                mimeType: 'text/plain',
                status: 'ai_readable',
                contentDigest: 'digest-31',
                chunkCount: 2,
            },
        ];
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                circleId: 1,
                material: sourceMaterials[0],
            }),
        });
    });
}

test.describe('Source material grounding', () => {
    test('shows upload -> extracting -> AI readable in Crucible', async ({ page }) => {
        await installGraphqlMocks(page);
        await installCrucibleMocks(page);

        await page.goto('/circles/1?tab=crucible', { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: '草稿' }).click();
        await page.getByText('Grounding Draft').click();

        const panel = page.getByRole('region', { name: '上传材料' });
        await expect(panel.getByRole('heading', { name: '上传材料' })).toBeVisible();

        await panel.getByLabel('上传材料文件').setInputFiles({
            name: 'meeting-notes.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Alpha grounding chunk\n\nBeta grounding chunk', 'utf8'),
        });
        await panel.getByRole('button', { name: '上传并抽取' }).click();

        await expect(panel.getByText('抽取中').first()).toBeVisible();
        await expect(panel.getByText('AI 可读').first()).toBeVisible();
        await expect(panel.getByText('meeting-notes.txt')).toBeVisible();
    });
});
