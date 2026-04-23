import { test, expect, type Page, type Route } from '@playwright/test';

import { installIdentityOnboardingMocks } from './support/identity-onboarding-app';
import { E2E_WALLET_PUBKEY, installMockWallet } from './support/mock-wallet';

type PermissionScenario = 'creator' | 'admin' | 'top_contributor' | 'member';

const ROOT_CIRCLE_ID = 246;

function buildKnowledgeRows(scenario: PermissionScenario) {
    if (scenario === 'top_contributor') {
        return [
            {
                __typename: 'Knowledge',
                id: 901,
                knowledgeId: 'kn_top_1',
                onChainAddress: 'kn_top_addr_1',
                title: 'Top knowledge 1',
                description: 'top',
                ipfsCid: null,
                contentHash: 'hash_top_1',
                version: 1,
                contributorsRoot: 'root_top_1',
                contributorsCount: 1,
                contributors: [],
                author: {
                    __typename: 'User',
                    id: 2,
                    handle: 'top-author',
                    pubkey: E2E_WALLET_PUBKEY,
                    displayName: 'Top Author',
                    avatarUri: null,
                },
                circle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
                sourceCircle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
                stats: { __typename: 'KnowledgeStats', qualityScore: 80, citationCount: 0, viewCount: 0, heatScore: 0 },
                references: [],
                citedBy: [],
                versionTimeline: [],
                crystalParams: { __typename: 'CrystalParams', seed: 1, hue: 42, facets: 5 },
                createdAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
                updatedAt: new Date('2026-03-23T10:00:00.000Z').toISOString(),
            },
            {
                __typename: 'Knowledge',
                id: 902,
                knowledgeId: 'kn_top_2',
                onChainAddress: 'kn_top_addr_2',
                title: 'Top knowledge 2',
                description: 'top',
                ipfsCid: null,
                contentHash: 'hash_top_2',
                version: 1,
                contributorsRoot: 'root_top_2',
                contributorsCount: 1,
                contributors: [],
                author: {
                    __typename: 'User',
                    id: 2,
                    handle: 'top-author',
                    pubkey: E2E_WALLET_PUBKEY,
                    displayName: 'Top Author',
                    avatarUri: null,
                },
                circle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
                sourceCircle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
                stats: { __typename: 'KnowledgeStats', qualityScore: 82, citationCount: 0, viewCount: 0, heatScore: 0 },
                references: [],
                citedBy: [],
                versionTimeline: [],
                crystalParams: { __typename: 'CrystalParams', seed: 2, hue: 43, facets: 6 },
                createdAt: new Date('2026-03-23T10:05:00.000Z').toISOString(),
                updatedAt: new Date('2026-03-23T10:05:00.000Z').toISOString(),
            },
            {
                __typename: 'Knowledge',
                id: 903,
                knowledgeId: 'kn_other_1',
                onChainAddress: 'kn_other_addr_1',
                title: 'Other knowledge',
                description: 'other',
                ipfsCid: null,
                contentHash: 'hash_other_1',
                version: 1,
                contributorsRoot: 'root_other_1',
                contributorsCount: 1,
                contributors: [],
                author: {
                    __typename: 'User',
                    id: 3,
                    handle: 'other-author',
                    pubkey: 'other_author_pubkey',
                    displayName: 'Other Author',
                    avatarUri: null,
                },
                circle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
                sourceCircle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
                stats: { __typename: 'KnowledgeStats', qualityScore: 75, citationCount: 0, viewCount: 0, heatScore: 0 },
                references: [],
                citedBy: [],
                versionTimeline: [],
                crystalParams: { __typename: 'CrystalParams', seed: 3, hue: 44, facets: 4 },
                createdAt: new Date('2026-03-23T10:10:00.000Z').toISOString(),
                updatedAt: new Date('2026-03-23T10:10:00.000Z').toISOString(),
            },
        ];
    }

    return [
        {
            __typename: 'Knowledge',
            id: 904,
            knowledgeId: 'kn_other_2',
            onChainAddress: 'kn_other_addr_2',
            title: 'Other knowledge',
            description: 'other',
            ipfsCid: null,
            contentHash: 'hash_other_2',
            version: 1,
            contributorsRoot: 'root_other_2',
            contributorsCount: 1,
            contributors: [],
            author: {
                __typename: 'User',
                id: 3,
                handle: 'other-author',
                pubkey: 'other_author_pubkey',
                displayName: 'Other Author',
                avatarUri: null,
            },
            circle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
            sourceCircle: { __typename: 'Circle', id: ROOT_CIRCLE_ID, name: '测试圈层' },
            stats: { __typename: 'KnowledgeStats', qualityScore: 75, citationCount: 0, viewCount: 0, heatScore: 0 },
            references: [],
            citedBy: [],
            versionTimeline: [],
            crystalParams: { __typename: 'CrystalParams', seed: 4, hue: 45, facets: 4 },
            createdAt: new Date('2026-03-23T10:10:00.000Z').toISOString(),
            updatedAt: new Date('2026-03-23T10:10:00.000Z').toISOString(),
        },
    ];
}

function buildMembers(scenario: PermissionScenario) {
    const role = scenario === 'admin'
        ? 'Admin'
        : scenario === 'member' || scenario === 'top_contributor'
            ? 'Member'
            : null;

    const members = [
        {
            __typename: 'CircleMember',
            id: 'member-owner',
            role: 'Owner',
            joinedAt: new Date('2026-03-20T10:00:00.000Z').toISOString(),
            identityLevel: 'Member',
            user: {
                __typename: 'User',
                id: 9,
                handle: 'owner',
                pubkey: 'owner_pubkey',
                displayName: 'Owner',
            },
        },
    ];

    if (role) {
        members.push({
            __typename: 'CircleMember',
            id: 'member-viewer',
            role,
            joinedAt: new Date('2026-03-21T10:00:00.000Z').toISOString(),
            identityLevel: 'Member',
            user: {
                __typename: 'User',
                id: 10,
                handle: 'viewer',
                pubkey: E2E_WALLET_PUBKEY,
                displayName: 'Viewer',
            },
        } as any);
    }

    return members;
}

async function installNextLevelPermissionMocks(page: Page, scenario: PermissionScenario) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as {
            operationName?: string;
            query?: string;
            variables?: Record<string, unknown>;
        } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';

        if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
            const creatorPubkey = scenario === 'creator' ? E2E_WALLET_PUBKEY : 'owner_pubkey';
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        circle: {
                            __typename: 'Circle',
                            id: ROOT_CIRCLE_ID,
                            name: '测试圈层',
                            description: '用于 next-level 权限验证。',
                            avatarUri: null,
                            circleType: 'Open',
                            level: 0,
                            knowledgeCount: 3,
                            genesisMode: 'BLANK',
                            kind: 'main',
                            mode: 'knowledge',
                            minCrystals: 0,
                            parentCircleId: null,
                            stats: { __typename: 'CircleStats', members: 3, posts: 0 },
                            creator: {
                                __typename: 'User',
                                id: 9,
                                handle: 'owner',
                                pubkey: creatorPubkey,
                                displayName: scenario === 'creator' ? 'Viewer Creator' : 'Owner',
                            },
                            createdAt: new Date('2026-03-20T10:00:00.000Z').toISOString(),
                            members: buildMembers(scenario),
                            posts: [],
                        },
                        circleDescendants: [
                            {
                                __typename: 'Circle',
                                id: 247,
                                name: '现有辅圈',
                                description: '已存在的辅圈',
                                avatarUri: null,
                                circleType: 'Open',
                                level: 0,
                                knowledgeCount: 0,
                                genesisMode: 'BLANK',
                                kind: 'auxiliary',
                                mode: 'knowledge',
                                minCrystals: 0,
                                parentCircleId: ROOT_CIRCLE_ID,
                                stats: { __typename: 'CircleStats', members: 1, posts: 0 },
                                creator: {
                                    __typename: 'User',
                                    id: 9,
                                    handle: 'owner',
                                    pubkey: creatorPubkey,
                                    displayName: 'Owner',
                                },
                                createdAt: new Date('2026-03-20T10:05:00.000Z').toISOString(),
                                members: [],
                                posts: [],
                            },
                        ],
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
                        knowledgeByCircle: buildKnowledgeRows(scenario),
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
                            id: ROOT_CIRCLE_ID,
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
                    data: {
                        circleDrafts: [],
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

        await route.fallback();
    });
}

async function openCreateSheet(page: Page) {
    const tierPill = page.locator('[class*="tierPill"]').first();
    await tierPill.waitFor({ state: 'visible', timeout: 15000 });
    await tierPill.click();
    await page.getByRole('button', { name: '创建圈层' }).click();
    await page.getByText('创建类型').waitFor({ state: 'visible', timeout: 10000 });
}

test.describe('Circle next-level permissions', () => {
    test.beforeEach(async ({ page }) => {
        await installMockWallet(page);
    });

    for (const scenario of ['creator', 'admin', 'top_contributor'] as const) {
        test(`allows ${scenario} to select next-level circle creation`, async ({ page }) => {
            await installIdentityOnboardingMocks(page, {
                initialRegistered: true,
                initialJoinedCircleIds: [ROOT_CIRCLE_ID],
            });
            await installNextLevelPermissionMocks(page, scenario);

            await page.goto(`/circles/${ROOT_CIRCLE_ID}`, { waitUntil: 'domcontentloaded' });
            await openCreateSheet(page);

            const nextLevelButton = page.getByRole('button', { name: /下级圈层/ }).first();
            await expect(nextLevelButton).toBeEnabled();
            await nextLevelButton.click();
            await expect(nextLevelButton).toHaveClass(/modeCardSelected/);
            await expect(page.getByText('当前账号暂无“创建下一级圈层”权限。')).toHaveCount(0);
        });
    }

    test('keeps next-level creation disabled for regular members without contribution lead', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [ROOT_CIRCLE_ID],
        });
        await installNextLevelPermissionMocks(page, 'member');

        await page.goto(`/circles/${ROOT_CIRCLE_ID}`, { waitUntil: 'domcontentloaded' });
        await openCreateSheet(page);

        const nextLevelButton = page.getByRole('button', { name: /下级圈层/ }).first();
        await expect(nextLevelButton).toBeDisabled();
        await expect(page.getByText('仅创建者、管理员，或当前圈层结晶数第一的用户可创建下一级圈层。')).toBeVisible();
    });
});
