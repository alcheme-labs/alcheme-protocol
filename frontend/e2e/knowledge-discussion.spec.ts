import { test, expect, type Page, type Route } from '@playwright/test';

async function installKnowledgeGraphqlMocks(page: Page) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as {
            operationName?: string;
            query?: string;
            variables?: Record<string, unknown>;
        } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';

        if (operationName === 'GetKnowledge' || queryText.includes('query GetKnowledge(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        knowledge: {
                            id: 31,
                            knowledgeId: 'kn_demo_31',
                            onChainAddress: 'KNDemoOnChain11111111111111111111111111111',
                            title: '链上知识如何保持可审计演化',
                            description: '这是一枚已经完成结晶的知识主题。\n\n后续讨论应该围绕晶体本身展开。',
                            ipfsCid: 'bafybeigdemo',
                            contentHash: 'content-hash-demo',
                            version: 3,
                            contributorsRoot: 'root-demo',
                            contributorsCount: 2,
                            contributors: [
                                {
                                    handle: 'taiyi',
                                    pubkey: 'taiyi_pubkey',
                                    role: 'Author',
                                    weight: 0.7,
                                    authorType: 'HUMAN',
                                    authorityScore: 80,
                                    reputationDelta: 5,
                                    settledAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                                    sourceType: 'SNAPSHOT',
                                    sourceDraftPostId: 21,
                                    sourceAnchorId: 'anchor_demo_21',
                                    sourcePayloadHash: 'payload-hash-demo',
                                    sourceSummaryHash: 'summary-hash-demo',
                                    sourceMessagesDigest: 'messages-digest-demo',
                                },
                            ],
                            author: {
                                id: 1,
                                handle: 'taiyi',
                                pubkey: 'taiyi_pubkey',
                                displayName: 'Taiyi',
                                avatarUri: null,
                            },
                            circle: {
                                id: 7,
                                name: 'Protocol Lab',
                            },
                            sourceCircle: {
                                id: 7,
                                name: 'Protocol Lab',
                            },
                            stats: {
                                qualityScore: 86,
                                citationCount: 4,
                                viewCount: 18,
                                heatScore: 27,
                            },
                            references: [],
                            citedBy: [],
                            versionTimeline: [
                                {
                                    id: 'kv_3',
                                    eventType: 'published',
                                    version: 3,
                                    actorPubkey: 'taiyi_pubkey',
                                    actorHandle: 'taiyi',
                                    contributorsCount: 2,
                                    contributorsRoot: 'root-demo',
                                    sourceEventTimestamp: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                                    eventAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                                    createdAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                                },
                            ],
                            crystalParams: {
                                seed: 31,
                                hue: 42,
                                facets: 5,
                            },
                            createdAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                            updatedAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                        },
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetKnowledgeByOnChainAddress' || queryText.includes('query GetKnowledgeByOnChainAddress(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        knowledgeByOnChainAddress: null,
                    },
                }),
            });
            return;
        }

        await route.continue();
    });
}

async function installKnowledgeDiscussionMocks(page: Page, joined: boolean) {
    await page.route('**/api/v1/membership/circles/7/me', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                authenticated: joined,
                circleId: 7,
                policy: {
                    joinRequirement: 'Free',
                    circleType: 'Open',
                    minCrystals: 0,
                    requiresApproval: false,
                    requiresInvite: false,
                },
                joinState: joined ? 'joined' : 'guest',
                membership: joined
                    ? {
                        role: 'Member',
                        status: 'Active',
                        identityLevel: 'Member',
                        joinedAt: new Date('2026-02-20T10:00:00.000Z').toISOString(),
                    }
                    : null,
                userCrystals: 0,
                missingCrystals: 0,
            }),
        });
    });

    await page.route('**/api/v1/discussion/knowledge/kn_demo_31/messages*', async (route: Route) => {
        if (!joined) {
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: 'discussion_membership_required',
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                knowledgeId: 'kn_demo_31',
                circleId: 7,
                roomKey: 'circle:7',
                count: 2,
                watermark: null,
                messages: [
                    {
                        envelopeId: 'env_floor_1',
                        roomKey: 'circle:7',
                        circleId: 7,
                        senderPubkey: 'alice_pubkey',
                        senderHandle: 'alice',
                        text: '我更关心这条演化链如何回放和审计。',
                        payloadHash: 'hash1',
                        nonce: 'nonce1',
                        signature: null,
                        signatureVerified: true,
                        messageKind: 'plain',
                        metadata: null,
                        subjectType: null,
                        subjectId: null,
                        forwardCard: null,
                        clientTimestamp: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                        lamport: 1,
                        prevEnvelopeId: null,
                        deleted: false,
                        tombstoneReason: null,
                        tombstonedAt: null,
                        createdAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                        updatedAt: new Date('2026-03-01T10:00:00.000Z').toISOString(),
                    },
                    {
                        envelopeId: 'env_floor_2',
                        roomKey: 'circle:7',
                        circleId: 7,
                        senderPubkey: 'bob_pubkey',
                        senderHandle: 'bob',
                        text: '如果未来 fork 形成副本，热度与影响力应该拆开计算。',
                        payloadHash: 'hash2',
                        nonce: 'nonce2',
                        signature: null,
                        signatureVerified: true,
                        messageKind: 'plain',
                        metadata: null,
                        subjectType: null,
                        subjectId: null,
                        forwardCard: null,
                        clientTimestamp: new Date('2026-03-01T10:05:00.000Z').toISOString(),
                        lamport: 2,
                        prevEnvelopeId: 'env_floor_1',
                        deleted: false,
                        tombstoneReason: null,
                        tombstonedAt: null,
                        createdAt: new Date('2026-03-01T10:05:00.000Z').toISOString(),
                        updatedAt: new Date('2026-03-01T10:05:00.000Z').toISOString(),
                    },
                ],
            }),
        });
    });
}

test.describe('Knowledge Discussion', () => {
    test('joined members see a forum-like crystal discussion thread', async ({ page }) => {
        await installKnowledgeGraphqlMocks(page);
        await installKnowledgeDiscussionMocks(page, true);

        await page.goto('/knowledge/kn_demo_31');

        await expect(page.getByRole('heading', { name: '主题讨论' })).toBeVisible();
        await expect(page.getByText('此晶体作为主题帖，以下留言只记录围绕知识本身的延展、质疑与补注。')).toBeVisible();
        await expect(page.getByText('01 楼')).toBeVisible();
        await expect(page.getByText('@alice')).toBeVisible();
        await expect(page.getByText('我更关心这条演化链如何回放和审计。')).toBeVisible();
        await expect(page.getByText('02 楼')).toBeVisible();
        await expect(page.getByText('如果未来 fork 形成副本，热度与影响力应该拆开计算。')).toBeVisible();
    });

    test('guests see an explicit locked state instead of an empty thread', async ({ page }) => {
        await installKnowledgeGraphqlMocks(page);
        await installKnowledgeDiscussionMocks(page, false);

        await page.goto('/knowledge/kn_demo_31');

        await expect(page.getByRole('heading', { name: '主题讨论' })).toBeVisible();
        await expect(page.getByText('加入来源圈层后，可查看围绕该晶体的讨论与留言。')).toBeVisible();
        await expect(page.getByText('01 楼')).toHaveCount(0);
    });
});
