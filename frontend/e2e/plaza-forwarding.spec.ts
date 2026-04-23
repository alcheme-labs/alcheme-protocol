import { test, expect, type Page, type Route } from '@playwright/test';

async function installCircleGraphqlMocks(page: Page) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as {
            operationName?: string;
            query?: string;
            variables?: Record<string, unknown>;
        } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';
        const variables = payload?.variables || {};
        const circlesById = {
            1: {
                __typename: 'Circle',
                id: 1,
                name: 'Root Social Circle',
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
                stats: { __typename: 'CircleStats', members: 3, posts: 1 },
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
            2: {
                __typename: 'Circle',
                id: 2,
                name: 'Aux Circle Lv1',
                description: null,
                avatarUri: null,
                circleType: 'Open',
                level: 1,
                knowledgeCount: 0,
                genesisMode: 'BLANK',
                kind: 'auxiliary',
                mode: 'social',
                minCrystals: 0,
                parentCircleId: 1,
                stats: { __typename: 'CircleStats', members: 1, posts: 0 },
                creator: {
                    __typename: 'User',
                    id: 1,
                    handle: 'owner',
                    pubkey: 'owner_pubkey',
                    displayName: 'Owner',
                },
                createdAt: new Date('2026-03-02T08:05:00.000Z').toISOString(),
                members: [],
                posts: [],
            },
            3: {
                __typename: 'Circle',
                id: 3,
                name: 'Aux Circle Lv2',
                description: null,
                avatarUri: null,
                circleType: 'Open',
                level: 2,
                knowledgeCount: 0,
                genesisMode: 'BLANK',
                kind: 'auxiliary',
                mode: 'social',
                minCrystals: 0,
                parentCircleId: 1,
                stats: { __typename: 'CircleStats', members: 1, posts: 0 },
                creator: {
                    __typename: 'User',
                    id: 1,
                    handle: 'owner',
                    pubkey: 'owner_pubkey',
                    displayName: 'Owner',
                },
                createdAt: new Date('2026-03-02T08:10:00.000Z').toISOString(),
                members: [],
                posts: [],
            },
        } as const;

        if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
            const circleId = Number(variables.id ?? 1) as 1 | 2 | 3;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        circle: circlesById[circleId],
                        circleDescendants: circleId === 1 ? [circlesById[2], circlesById[3]] : [],
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

        await route.continue();
    });
}

async function installMembershipMocks(page: Page) {
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
}

test.describe('Plaza Forwarding', () => {
    test('opens governed picker and forwards to a valid target circle', async ({ page }) => {
        let forwardedPayload: { targetCircleId?: number } | null = null;

        await installCircleGraphqlMocks(page);
        await installMembershipMocks(page);

        await page.route('**/api/v1/discussion/circles/1/messages*', async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    circleId: 1,
                    roomKey: 'circle:1',
                    count: 1,
                    watermark: null,
                    messages: [
                        {
                            envelopeId: 'env-source-1',
                            roomKey: 'circle:1',
                            circleId: 1,
                            senderPubkey: 'source_pubkey',
                            senderHandle: 'alice',
                            messageKind: 'plain',
                            text: '原始讨论材料',
                            payloadHash: 'f'.repeat(64),
                            nonce: 'abc123',
                            signature: null,
                            signatureVerified: true,
                            authMode: 'session_token',
                            sessionId: null,
                            relevanceScore: 1,
                            semanticScore: 1,
                            qualityScore: 0.5,
                            spamScore: 0,
                            decisionConfidence: 0.5,
                            relevanceMethod: 'rule',
                            isFeatured: false,
                            highlightCount: 0,
                            featureReason: null,
                            featuredAt: null,
                            clientTimestamp: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            lamport: 42,
                            prevEnvelopeId: null,
                            deleted: false,
                            tombstoneReason: null,
                            tombstonedAt: null,
                            createdAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            updatedAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            subjectType: null,
                            subjectId: null,
                            metadata: null,
                            forwardCard: null,
                        },
                    ],
                }),
            });
        });

        await page.route('**/api/v1/discussion/messages/env-source-1/forward', async (route: Route) => {
            forwardedPayload = route.request().postDataJSON() as { targetCircleId?: number };
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    message: {
                        envelopeId: 'env-forward-1',
                        roomKey: 'circle:2',
                        circleId: 2,
                        senderPubkey: 'forwarder_pubkey',
                        senderHandle: 'bob',
                        messageKind: 'forward',
                        text: '原始讨论材料',
                        payloadHash: 'e'.repeat(64),
                        nonce: 'def456',
                        signature: null,
                        signatureVerified: true,
                        authMode: 'session_token',
                        sessionId: null,
                        relevanceScore: 1,
                        semanticScore: 1,
                        qualityScore: 0.5,
                        spamScore: 0,
                        decisionConfidence: 0.5,
                        relevanceMethod: 'rule',
                        isFeatured: false,
                        highlightCount: 0,
                        featureReason: null,
                        featuredAt: null,
                        clientTimestamp: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                        lamport: 88,
                        prevEnvelopeId: null,
                        deleted: false,
                        tombstoneReason: null,
                        tombstonedAt: null,
                        createdAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                        updatedAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                        subjectType: 'discussion_message',
                        subjectId: 'env-source-1',
                        metadata: {
                            sourceEnvelopeId: 'env-source-1',
                        },
                        forwardCard: {
                            sourceEnvelopeId: 'env-source-1',
                            sourceCircleId: 1,
                            sourceCircleName: 'Root Social Circle',
                            sourceLevel: 0,
                            sourceAuthorHandle: 'alice',
                            forwarderHandle: 'bob',
                            sourceMessageCreatedAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            forwardedAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                            sourceDeleted: false,
                            snapshotText: '原始讨论材料',
                        },
                    },
                }),
            });
        });

        await page.goto('/circles/1?tab=plaza', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-envelope-id="env-source-1"]')).toContainText('原始讨论材料', { timeout: 15_000 });

        await page.locator('[data-envelope-id="env-source-1"]').click();
        await page.getByTestId('message-action-forward').click();

        await expect(page.getByTestId('circle-picker-item-2')).toBeVisible();
        await expect(page.getByTestId('circle-picker-item-3')).toBeVisible();

        await page.getByTestId('circle-picker-item-2').click();

        await expect.poll(() => forwardedPayload?.targetCircleId ?? null).toBe(2);
        await expect(page.getByText('已转发到 Aux Circle Lv1，等待目标圈层同步显示')).toBeVisible();
    });

    test('forward card source link routes back to the source plaza context', async ({ page }) => {
        await installCircleGraphqlMocks(page);
        await installMembershipMocks(page);

        await page.route('**/api/v1/discussion/circles/2/messages*', async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    circleId: 2,
                    roomKey: 'circle:2',
                    count: 1,
                    watermark: null,
                    messages: [
                        {
                            envelopeId: 'env-forward-1',
                            roomKey: 'circle:2',
                            circleId: 2,
                            senderPubkey: 'forwarder_pubkey',
                            senderHandle: 'bob',
                            messageKind: 'forward',
                            text: '原始讨论材料',
                            payloadHash: 'e'.repeat(64),
                            nonce: 'def456',
                            signature: null,
                            signatureVerified: true,
                            authMode: 'session_token',
                            sessionId: null,
                            relevanceScore: 1,
                            semanticScore: 1,
                            qualityScore: 0.5,
                            spamScore: 0,
                            decisionConfidence: 0.5,
                            relevanceMethod: 'rule',
                            isFeatured: false,
                            highlightCount: 0,
                            featureReason: null,
                            featuredAt: null,
                            clientTimestamp: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                            lamport: 88,
                            prevEnvelopeId: null,
                            deleted: false,
                            tombstoneReason: null,
                            tombstonedAt: null,
                            createdAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                            updatedAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                            subjectType: 'discussion_message',
                            subjectId: 'env-source-1',
                            metadata: {
                                sourceEnvelopeId: 'env-source-1',
                            },
                            forwardCard: {
                                sourceEnvelopeId: 'env-source-1',
                                sourceCircleId: 1,
                                sourceCircleName: 'Root Social Circle',
                                sourceLevel: 0,
                                sourceAuthorHandle: 'alice',
                                forwarderHandle: 'bob',
                                sourceMessageCreatedAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                                forwardedAt: new Date('2026-03-02T10:05:00.000Z').toISOString(),
                                sourceDeleted: false,
                                snapshotText: '原始讨论材料',
                            },
                        },
                    ],
                }),
            });
        });

        await page.route('**/api/v1/discussion/circles/1/messages*', async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    circleId: 1,
                    roomKey: 'circle:1',
                    count: 1,
                    watermark: null,
                    messages: [
                        {
                            envelopeId: 'env-source-1',
                            roomKey: 'circle:1',
                            circleId: 1,
                            senderPubkey: 'source_pubkey',
                            senderHandle: 'alice',
                            messageKind: 'plain',
                            text: '原始讨论材料',
                            payloadHash: 'f'.repeat(64),
                            nonce: 'abc123',
                            signature: null,
                            signatureVerified: true,
                            authMode: 'session_token',
                            sessionId: null,
                            relevanceScore: 1,
                            semanticScore: 1,
                            qualityScore: 0.5,
                            spamScore: 0,
                            decisionConfidence: 0.5,
                            relevanceMethod: 'rule',
                            isFeatured: false,
                            highlightCount: 0,
                            featureReason: null,
                            featuredAt: null,
                            clientTimestamp: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            lamport: 42,
                            prevEnvelopeId: null,
                            deleted: false,
                            tombstoneReason: null,
                            tombstonedAt: null,
                            createdAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            updatedAt: new Date('2026-03-02T10:00:00.000Z').toISOString(),
                            subjectType: null,
                            subjectId: null,
                            metadata: null,
                            forwardCard: null,
                        },
                    ],
                }),
            });
        });

        await page.goto('/circles/2?tab=plaza', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[data-envelope-id="env-forward-1"]')).toContainText('原始讨论材料', { timeout: 15_000 });
        await expect(page.getByTestId('forward-card-view-source')).toBeVisible();
        await page.getByTestId('forward-card-view-source').click();

        await expect(page).toHaveURL(/\/circles\/1\?tab=plaza&focusEnvelopeId=env-source-1$/);
        await expect(page.locator('[data-envelope-id="env-source-1"]')).toBeVisible();
    });
});
