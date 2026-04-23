import { test, expect, type Page, type Route } from '@playwright/test';

const DRAFT_POST_ID = 661;
const AI_BASELINE_TEXT = 'AI 生成的第一段。\n\nAI 生成的第二段。';

async function installGraphqlMocks(
    page: Page,
    options?: {
        onGenerateVariables?: (variables: Record<string, unknown> | null) => void;
    },
) {
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
                            name: 'Ghost Draft Circle',
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
                                pubkey: 'ghost_curator_pubkey',
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
                                title: 'Ghost Draft Workflow',
                                excerpt: 'draft for ghost draft ui',
                                heatScore: 12,
                                status: 'ACTIVE',
                                commentCount: 0,
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
                        draftComments: [],
                    },
                }),
            });
            return;
        }

        if (operationName === 'GenerateGhostDraft' || queryText.includes('mutation GenerateGhostDraft')) {
            options?.onGenerateVariables?.((variables as Record<string, unknown>) || null);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        generateGhostDraft: {
                            jobId: 501,
                            status: 'queued',
                            postId: DRAFT_POST_ID,
                            autoApplyRequested: true,
                        },
                    },
                }),
            });
            return;
        }

        if (operationName === 'AcceptGhostDraft' || queryText.includes('mutation AcceptGhostDraft')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        acceptGhostDraft: {
                            generation: {
                                generationId: 31,
                                postId: DRAFT_POST_ID,
                                draftText: AI_BASELINE_TEXT,
                                model: 'ghost-test-model',
                                generatedAt: new Date('2026-03-13T10:10:00.000Z').toISOString(),
                                provenance: {
                                    origin: 'ai',
                                    providerMode: 'builtin',
                                    model: 'ghost-test-model',
                                    promptAsset: 'ghost-draft-comment',
                                    promptVersion: 'v1',
                                    sourceDigest: 'a'.repeat(64),
                                    ghostRunId: null,
                                },
                            },
                            applied: true,
                            changed: true,
                            acceptanceId: 99,
                            acceptanceMode: 'auto_fill',
                            acceptedAt: new Date('2026-03-13T10:11:00.000Z').toISOString(),
                            acceptedByUserId: 2,
                            workingCopyContent: AI_BASELINE_TEXT,
                            workingCopyHash: 'b'.repeat(64),
                            updatedAt: new Date('2026-03-13T10:11:00.000Z').toISOString(),
                            heatScore: 17,
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
    let autoApplied = false;

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
                    text: '',
                    heatScore: 12,
                    updatedAt: new Date('2026-03-13T10:05:00.000Z').toISOString(),
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
                heatScore: 17,
                updatedAt: new Date('2026-03-13T10:11:00.000Z').toISOString(),
                changed: true,
            }),
        });
    });

    await page.route(`**/api/v1/discussion/drafts/${DRAFT_POST_ID}/discussions*`, async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                draftPostId: DRAFT_POST_ID,
                count: 0,
                threads: [],
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
                reviewEntryMode: 'manual_only',
                draftingEndsAt: null,
                reviewEndsAt: null,
                reviewWindowExpiredAt: null,
                transitionMode: 'manual_lock',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 1,
                    sourceKind: null,
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: null,
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: null,
                    createdAt: new Date('2026-03-13T10:00:00.000Z').toISOString(),
                },
                workingCopy: {
                    workingCopyId: `draft:${DRAFT_POST_ID}:working-copy`,
                    draftPostId: DRAFT_POST_ID,
                    basedOnSnapshotVersion: 1,
                    workingCopyContent: autoApplied ? AI_BASELINE_TEXT : '',
                    workingCopyHash: autoApplied ? 'b'.repeat(64) : '0'.repeat(64),
                    status: 'active',
                    roomKey: `crucible-${DRAFT_POST_ID}`,
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: autoApplied
                        ? new Date('2026-03-13T10:11:00.000Z').toISOString()
                        : new Date('2026-03-13T10:05:00.000Z').toISOString(),
                },
                reviewBinding: {
                    boundSnapshotVersion: 1,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
                },
            }),
        });
    });

    await page.route('**/api/v1/ai/ghost-drafts/*', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                generation: {
                    generationId: 31,
                    postId: DRAFT_POST_ID,
                    draftText: AI_BASELINE_TEXT,
                    model: 'ghost-test-model',
                    generatedAt: new Date('2026-03-13T10:10:00.000Z').toISOString(),
                    provenance: {
                        origin: 'ai',
                        providerMode: 'builtin',
                        model: 'ghost-test-model',
                        promptAsset: 'ghost-draft-comment',
                        promptVersion: 'v1',
                        sourceDigest: 'a'.repeat(64),
                        ghostRunId: null,
                    },
                },
            }),
        });
    });

    await page.route('**/api/v1/ai-jobs/*/stream', async (route: Route) => {
        autoApplied = true;
        await route.fulfill({
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
            body: [
                'event: ai-job',
                `data: ${JSON.stringify({
                    jobId: 501,
                    status: 'queued',
                    result: null,
                    error: null,
                })}`,
                '',
                'event: ai-job',
                `data: ${JSON.stringify({
                    jobId: 501,
                    status: 'succeeded',
                    result: {
                        generationId: 31,
                        postId: DRAFT_POST_ID,
                        autoApplied: true,
                        acceptanceId: 99,
                        workingCopyHash: 'b'.repeat(64),
                        updatedAt: new Date('2026-03-13T10:11:00.000Z').toISOString(),
                        heatScore: 17,
                    },
                    error: null,
                })}`,
                '',
            ].join('\n'),
        });
    });

    await page.route('**/api/v1/ai-jobs/*', async (route: Route) => {
        autoApplied = true;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                job: {
                    id: 501,
                    status: 'succeeded',
                    result: {
                        generationId: 31,
                        postId: DRAFT_POST_ID,
                        autoApplied: true,
                        acceptanceId: 99,
                        workingCopyHash: 'b'.repeat(64),
                        updatedAt: new Date('2026-03-13T10:11:00.000Z').toISOString(),
                        heatScore: 17,
                    },
                    lastErrorCode: null,
                    lastErrorMessage: null,
                },
            }),
        });
    });

    await page.route('**/api/v1/temporary-edit-grants/**', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                grants: [],
            }),
        });
    });
}

test.describe('Ghost Draft Entry', () => {
    test('allows generating an AI baseline from Crucible and surfaces completion state', async ({ page }) => {
        await installGraphqlMocks(page);
        await installMembershipMocks(page);
        await installDiscussionMocks(page);

        await page.goto('/circles/1?tab=crucible', { waitUntil: 'domcontentloaded' });

        await page.getByText('Ghost Draft Workflow').first().click();
        await expect(page.getByRole('button', { name: '生成 AI 草稿基线' })).toBeVisible();

        await page.getByRole('button', { name: '生成 AI 草稿基线' }).click();

        await expect(page.getByText('AI 草稿已作为正文基线填入。')).toBeVisible();
        await expect(page.getByText('ghost-test-model')).toBeVisible();
    });

    test('passes selected seeded references and AI-readable source materials into ghost draft generation', async ({ page }) => {
        let capturedGenerateVariables: Record<string, unknown> | null = null;
        await installGraphqlMocks(page, {
            onGenerateVariables(variables) {
                capturedGenerateVariables = variables;
            },
        });
        await installMembershipMocks(page);
        await installDiscussionMocks(page);

        await page.route('**/api/v1/circles/*/seeded/tree', async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    tree: [
                        {
                            id: 300,
                            nodeType: 'file',
                            name: 'guide.md',
                            path: 'docs/guide.md',
                            depth: 0,
                            sortOrder: 1,
                            mimeType: 'text/markdown',
                            byteSize: 128,
                            lineCount: 4,
                            contentText: '# Guide\nKeep the API examples aligned.\nAdd rollout notes.\n',
                            children: [],
                        },
                    ],
                }),
            });
        });

        await page.route('**/api/v1/circles/*/source-materials**', async (route: Route) => {
            if (route.request().method().toUpperCase() !== 'GET') {
                await route.fulfill({ status: 405, body: 'method not allowed' });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    materials: [
                        {
                            id: 91,
                            circleId: 1,
                            draftPostId: DRAFT_POST_ID,
                            discussionThreadId: null,
                            seededSourceNodeId: null,
                            name: 'meeting-notes.txt',
                            mimeType: 'text/plain',
                            status: 'ai_readable',
                            contentDigest: 'c'.repeat(64),
                            chunkCount: 1,
                        },
                    ],
                }),
            });
        });

        await page.goto('/circles/1?tab=crucible', { waitUntil: 'domcontentloaded' });
        await page.getByText('Ghost Draft Workflow').first().click();

        const referenceRegion = page.getByRole('region', { name: '源文件引用' });
        await referenceRegion.getByRole('button', { name: 'guide.md' }).click();
        await referenceRegion.getByRole('button', { name: 'L2' }).click();
        await expect(page.getByText('meeting-notes.txt')).toBeVisible();
        await expect(page.getByText('AI 可读')).toBeVisible();

        await page.getByRole('button', { name: '生成 AI 草稿基线' }).click();

        await expect.poll(() => capturedGenerateVariables).not.toBeNull();
        assertSeededGhostDraftVariables(capturedGenerateVariables);
    });
});

function assertSeededGhostDraftVariables(value: Record<string, unknown> | null) {
    expect(value).not.toBeNull();
    const input = value?.input as Record<string, unknown> | undefined;
    expect(input).toBeTruthy();
    expect(input?.seededReference).toEqual({
        path: 'docs/guide.md',
        line: 2,
    });
    expect(input?.sourceMaterialIds).toEqual([91]);
}
