import { test, expect, type Page, type Route } from '@playwright/test';

type DraftThreadState = 'open' | 'proposed' | 'accepted' | 'rejected' | 'applied';

type DraftThread = {
    id: string;
    draftPostId: number;
    targetType: 'paragraph' | 'structure' | 'document';
    targetRef: string;
    targetVersion: number;
    state: DraftThreadState;
    createdBy: number;
    createdAt: string;
    updatedAt: string;
    latestResolution: {
        resolvedBy: number;
        toState: 'accepted' | 'rejected';
        reason: string | null;
        resolvedAt: string;
    } | null;
    latestApplication: {
        appliedBy: number;
        appliedEditAnchorId: string;
        appliedSnapshotHash: string;
        appliedDraftVersion: number;
        reason: string | null;
        appliedAt: string;
    } | null;
};

const DRAFT_POST_ID = 501;

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
                            name: 'Workflow Circle',
                            description: null,
                            avatarUri: null,
                            circleType: 'Open',
                            level: 0,
                            knowledgeCount: 0,
                            genesisMode: 'BLANK',
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
                            createdAt: new Date('2026-03-13T10:00:00.000Z').toISOString(),
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
                                title: 'Workflow Draft',
                                excerpt: 'discussion workflow draft',
                                heatScore: 26,
                                status: 'ACTIVE',
                                commentCount: 2,
                                ageDays: 0,
                                createdAt: new Date('2026-03-13T10:00:00.000Z').toISOString(),
                                updatedAt: new Date('2026-03-13T10:05:00.000Z').toISOString(),
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
                body: JSON.stringify({
                    data: {
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
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        knowledgeByCircle: [],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetDraftComments' || queryText.includes('query GetDraftComments')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        draftComments: [
                            {
                                __typename: 'DraftComment',
                                id: 1,
                                content: 'initial comment',
                                lineRef: 'paragraph:1',
                                createdAt: new Date('2026-03-13T10:06:00.000Z').toISOString(),
                                user: {
                                    __typename: 'User',
                                    id: 2,
                                    handle: 'curator',
                                    displayName: 'Curator',
                                },
                            },
                        ],
                    },
                }),
            });
            return;
        }

        if (operationName === 'AddDraftComment' || queryText.includes('mutation AddDraftComment')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        addDraftComment: {
                            __typename: 'DraftComment',
                            id: Date.now(),
                            content: String((variables.input as Record<string, unknown> | undefined)?.content || ''),
                            lineRef: String((variables.input as Record<string, unknown> | undefined)?.lineRef || 'paragraph:0'),
                            createdAt: new Date().toISOString(),
                            user: {
                                __typename: 'User',
                                id: 2,
                                handle: 'curator',
                                displayName: 'Curator',
                            },
                        },
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
                        myNotifications: [],
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

async function installMembershipMocks(page: Page) {
    const resolveCircleId = (url: string): number => {
        const parts = new URL(url).pathname.split('/');
        const parsed = Number(parts[5] || '1');
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    };

    await page.route('**/api/v1/membership/circles/*/me', async (route: Route) => {
        const circleId = resolveCircleId(route.request().url());
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
                userCrystals: 18,
                missingCrystals: 0,
                membership: {
                    role: 'Admin',
                    status: 'Active',
                    identityLevel: 'Elder',
                    joinedAt: new Date('2026-03-13T08:00:00.000Z').toISOString(),
                },
            }),
        });
    });

    await page.route('**/api/v1/membership/circles/*/identity-status', async (route: Route) => {
        const circleId = resolveCircleId(route.request().url());
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                authenticated: true,
                circleId,
                currentLevel: 'Elder',
                nextLevel: null,
                messagingMode: 'formal',
                hint: '你已具备完整草稿编辑与决议权限。',
                thresholds: {
                    initiateMessages: 3,
                    memberCitations: 5,
                    elderPercentile: 90,
                    inactivityDays: 30,
                },
                transition: null,
                recentTransition: null,
                history: [],
                progress: {
                    messageCount: 22,
                    citationCount: 9,
                    reputationScore: 88,
                    reputationPercentile: 97,
                    daysSinceActive: 0,
                },
            }),
        });
    });

    await page.route('**/api/v1/membership/circles/*/state', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                joinState: 'joined',
                policy: 'open',
                memberRole: 'Admin',
                membershipStatus: 'Active',
                identityLevel: 'elder',
                userCrystals: 18,
                nextTierCrystals: 24,
                nextTierName: 'Curator+',
            }),
        });
    });

    await page.route('**/api/v1/circles/*/ghost-settings', async (route: Route) => {
        const parts = new URL(route.request().url()).pathname.split('/');
        const parsed = Number(parts[4] || '1');
        const circleId = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                circleId,
                source: 'global_default',
                settings: {
                    summaryUseLLM: false,
                    draftTriggerMode: 'notify_only',
                    triggerSummaryUseLLM: false,
                    triggerGenerateComment: true,
                },
            }),
        });
    });
}

async function installDiscussionMocks(page: Page) {
    const threads: DraftThread[] = [];
    let nextThreadId = 1;

    const buildNow = () => new Date().toISOString();
    const findThread = (threadId: string) => threads.find((thread) => thread.id === threadId) || null;

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/content`, async (route: Route) => {
        const method = route.request().method().toUpperCase();
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    draftPostId: DRAFT_POST_ID,
                    status: 'Draft',
                    text: '<p>Workflow draft content</p>',
                    heatScore: 26,
                    updatedAt: buildNow(),
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                status: 'Draft',
                heatScore: 27,
                updatedAt: buildNow(),
                changed: true,
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/publish-readiness`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ready: true,
                reason: 'ok',
                mode: 'enforce',
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/proof-package`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                mode: 'enforce',
                draftPostId: DRAFT_POST_ID,
                root: 'e'.repeat(64),
                count: 1,
                proof_package_hash: '9'.repeat(64),
                source_anchor_id: 'a'.repeat(64),
                binding_version: 2,
                generated_at: '2026-03-13T12:00:00.000Z',
                issuer_key_id: '9NwT91mM1qKQ8FQx8M8vNm2A2Sk9g1FQyN1xwH1iT6EY',
                issued_signature: 'b'.repeat(128),
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions*`, async (route: Route) => {
        const method = route.request().method().toUpperCase();
        if (method === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    draftPostId: DRAFT_POST_ID,
                    count: threads.length,
                    threads,
                }),
            });
            return;
        }

        const body = route.request().postDataJSON() as Record<string, unknown>;
        const now = buildNow();
        const thread: DraftThread = {
            id: String(nextThreadId++),
            draftPostId: DRAFT_POST_ID,
            targetType: (body.targetType as DraftThread['targetType']) || 'paragraph',
            targetRef: String(body.targetRef || 'paragraph:1'),
            targetVersion: Number(body.targetVersion || 1),
            state: 'open',
            createdBy: 2,
            createdAt: now,
            updatedAt: now,
            latestResolution: null,
            latestApplication: null,
        };
        threads.push(thread);

        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                thread,
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions/*/propose`, async (route: Route) => {
        const matched = route.request().url().match(/\/discussions\/(\d+)\/propose/);
        const threadId = matched?.[1] || '';
        const thread = findThread(threadId);
        if (!thread) {
            await route.fulfill({ status: 404, body: JSON.stringify({ error: 'thread_not_found' }) });
            return;
        }
        thread.state = 'proposed';
        thread.updatedAt = buildNow();

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                thread,
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions/*/resolve`, async (route: Route) => {
        const matched = route.request().url().match(/\/discussions\/(\d+)\/resolve/);
        const threadId = matched?.[1] || '';
        const thread = findThread(threadId);
        if (!thread) {
            await route.fulfill({ status: 404, body: JSON.stringify({ error: 'thread_not_found' }) });
            return;
        }
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const resolution = body.resolution === 'rejected' ? 'rejected' : 'accepted';
        thread.state = resolution;
        thread.updatedAt = buildNow();
        thread.latestResolution = {
            resolvedBy: 2,
            toState: resolution,
            reason: typeof body.reason === 'string' ? body.reason : null,
            resolvedAt: buildNow(),
        };

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                thread,
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions/*/apply`, async (route: Route) => {
        const matched = route.request().url().match(/\/discussions\/(\d+)\/apply/);
        const threadId = matched?.[1] || '';
        const thread = findThread(threadId);
        if (!thread) {
            await route.fulfill({ status: 404, body: JSON.stringify({ error: 'thread_not_found' }) });
            return;
        }
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const derivedEditAnchorId = typeof body.appliedEditAnchorId === 'string' && body.appliedEditAnchorId
            ? body.appliedEditAnchorId
            : 'auto-edit-anchor-42';
        const derivedSnapshotHash = typeof body.appliedSnapshotHash === 'string' && body.appliedSnapshotHash
            ? body.appliedSnapshotHash
            : 'a'.repeat(64);
        const derivedDraftVersion = Number(body.appliedDraftVersion || 2);
        thread.state = 'applied';
        thread.updatedAt = buildNow();
        thread.latestApplication = {
            appliedBy: 2,
            appliedEditAnchorId: derivedEditAnchorId,
            appliedSnapshotHash: derivedSnapshotHash,
            appliedDraftVersion: derivedDraftVersion,
            reason: typeof body.reason === 'string' ? body.reason : null,
            appliedAt: buildNow(),
        };

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                thread,
            }),
        });
    });
}

test.describe('Draft Discussion Workflow', () => {
    test('supports create -> propose -> accepted -> applied lifecycle', async ({ page }) => {
        await installGraphqlMocks(page);
        await installMembershipMocks(page);
        await installDiscussionMocks(page);

        await page.goto('/circles/1?tab=crucible', { waitUntil: 'domcontentloaded' });

        await page.getByText('Workflow Draft').first().click();
        await expect(page.getByRole('heading', { name: '问题单审议' })).toBeVisible();

        await page.getByLabel('目标段落').selectOption('0');
        await page.getByLabel('问题描述').fill('建议补全开场段论证。');
        await page.getByRole('button', { name: '提交问题单' }).click();

        await expect(page.getByText('建议补全开场段论证。')).toBeVisible();

        await page.getByPlaceholder('补充这条问题为什么要进入审议').fill('提议进入正式审议阶段。');
        await page.getByRole('button', { name: '开始审议' }).click();

        await expect(page.getByRole('button', { name: '通过' })).toBeVisible();
        await page.getByRole('button', { name: '通过' }).click();

        await expect(page.getByRole('button', { name: '标记已解决' })).toBeVisible();
        await page.getByRole('button', { name: '标记已解决' }).click();

        await expect(page.getByText('解决记录')).toBeVisible();
        await expect(page.getByText(`快照哈希：${'a'.repeat(64)}`)).toBeVisible();
    });
});
