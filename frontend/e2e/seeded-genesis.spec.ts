import { Buffer } from 'node:buffer';
import { expect, test, type Page, type Route } from '@playwright/test';
import { installIdentityOnboardingMocks } from './support/identity-onboarding-app';
import { installMockWallet, E2E_WALLET_PUBKEY } from './support/mock-wallet';

const NOW = new Date('2026-03-24T10:00:00.000Z').toISOString();

function readGraphqlOperation(route: Route): {
    operationName: string;
    queryText: string;
    variables: Record<string, unknown>;
} {
    const payload = route.request().postDataJSON() as
        | {
              operationName?: string;
              query?: string;
              variables?: Record<string, unknown>;
          }
        | null;

    return {
        operationName: payload?.operationName || '',
        queryText: payload?.query || '',
        variables: payload?.variables || {},
    };
}

function circleCard(input: {
    id: number;
    name: string;
    description: string;
    mode?: 'knowledge' | 'social';
    genesisMode?: 'BLANK' | 'SEEDED';
}) {
    return {
        __typename: 'Circle',
        id: input.id,
        name: input.name,
        description: input.description,
        avatarUri: null,
        circleType: 'Open',
        level: 0,
        knowledgeCount: input.mode === 'knowledge' ? 1 : 0,
        genesisMode: input.genesisMode ?? 'BLANK',
        kind: 'main',
        mode: input.mode ?? 'knowledge',
        minCrystals: 0,
        parentCircleId: null,
        stats: { __typename: 'CircleStats', members: 1, posts: 0 },
        creator: {
            __typename: 'User',
            id: 501,
            handle: 'alchemist',
            pubkey: E2E_WALLET_PUBKEY,
            displayName: 'The Alchemist',
        },
        createdAt: NOW,
    };
}

async function installSeededCreateMocks(page: Page) {
    const circles = [
        circleCard({
            id: 246,
            name: '测试圈层',
            description: '用于 Seeded genesis e2e。',
            mode: 'social',
            genesisMode: 'BLANK',
        }),
    ];
    let nextCircleId = 880;
    let syncStatusSlot = 990000;
    await page.route('**/graphql', async (route: Route) => {
        const { operationName, queryText } = readGraphqlOperation(route);

        if (operationName === 'GetAllCircles' || queryText.includes('query GetAllCircles')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        allCircles: circles,
                    },
                }),
            });
            return;
        }

        await route.fallback();
    });

    await page.route('**/api/v1/testing/e2e/create-circle', async (route: Route) => {
        const body = route.request().postDataJSON() as Record<string, unknown> | null;
        const circleId = nextCircleId++;
        const mode = body?.mode === 'social' ? 'social' : 'knowledge';
        circles.unshift(
            circleCard({
                id: circleId,
                name: String(body?.name || `Seeded ${circleId}`),
                description: '通过 E2E mock 创建的 Seeded 圈层。',
                mode,
                genesisMode: 'SEEDED',
            }),
        );
        syncStatusSlot += 10;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                circleId,
                signature: `e2e_seeded_circle_${circleId}`,
                signatureSlot: syncStatusSlot,
            }),
        });
    });

    await page.route('**/sync/status', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                indexerId: 'seeded-genesis-e2e',
                readCommitment: 'confirmed',
                indexedSlot: syncStatusSlot,
                stale: false,
                generatedAt: NOW,
                offchain: null,
                offchainPeers: [],
            }),
        });
    });

    await page.route(/\/api\/v1\/circles\/\d+$/, async (route: Route) => {
        const path = new URL(route.request().url()).pathname;
        const circleId = Number(path.split('/').pop() || '0');
        const circle = circles.find((item) => item.id === circleId);
        if (!circle) {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Circle not found' }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: circle.id,
                name: circle.name,
                description: circle.description,
                circleType: circle.circleType,
                level: circle.level,
                kind: circle.kind,
                mode: circle.mode,
                genesisMode: circle.genesisMode,
                minCrystals: circle.minCrystals,
                parentCircleId: circle.parentCircleId,
                creator: circle.creator,
                createdAt: circle.createdAt,
            }),
        });
    });

    await page.route('**/api/v1/circles/*/genesis-mode', async (route: Route) => {
        const latestGenesisModeBody = (route.request().postDataJSON() as Record<string, unknown> | null) || null;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                circleId: Number(new URL(route.request().url()).pathname.split('/')[4] || '0'),
                genesisMode: latestGenesisModeBody?.genesisMode || 'BLANK',
            }),
        });
    });

    await page.route('**/api/v1/circles/*/seeded/import', async (route: Route) => {
        const latestSeededImportBody = (route.request().postDataJSON() as Record<string, unknown> | null) || null;
        const files = Array.isArray(latestSeededImportBody?.files) ? latestSeededImportBody.files : [];
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                circleId: Number(new URL(route.request().url()).pathname.split('/')[4] || '0'),
                fileCount: files.length,
                nodeCount: files.length + 1,
            }),
        });
    });

    await page.route('**/api/v1/membership/circles/*/policy', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                ok: true,
                circleId: Number(new URL(route.request().url()).pathname.split('/')[5] || '0'),
                policy: {
                    joinRequirement: 'Free',
                    circleType: 'Open',
                    minCrystals: 0,
                    requiresApproval: false,
                    requiresInvite: false,
                },
            }),
        });
    });

    await page.route('**/api/v1/policy/circles/*/profile', async (route: Route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                circleId: Number(new URL(route.request().url()).pathname.split('/')[5] || '0'),
                profile: {
                    draftLifecycleTemplate: {
                        templateId: 'fast_deposition',
                        draftGenerationVotingMinutes: 10,
                        draftingWindowMinutes: 30,
                        reviewWindowMinutes: 240,
                        maxRevisionRounds: 1,
                        reviewEntryMode: 'auto_or_manual',
                    },
                    draftWorkflowPolicy: {
                        createIssueMinRole: 'Member',
                        followupIssueMinRole: 'Member',
                        reviewIssueMinRole: 'Moderator',
                        retagIssueMinRole: 'Moderator',
                        applyIssueMinRole: 'Admin',
                        manualEndDraftingMinRole: 'Moderator',
                        advanceFromReviewMinRole: 'Admin',
                        enterCrystallizationMinRole: 'Moderator',
                        allowAuthorWithdrawBeforeReview: true,
                        allowModeratorRetagIssue: true,
                    },
                    forkPolicy: {
                        enabled: true,
                        thresholdMode: 'contribution_threshold',
                        minimumContributions: 1,
                        minimumRole: 'Member',
                        requiresGovernanceVote: false,
                        inheritancePrefillSource: 'lv0_default_profile',
                        knowledgeLineageInheritance: 'upstream_until_fork_node',
                    },
                },
            }),
        });
    });

}

async function openCreateSheet(page: Page) {
    await page.getByRole('button', { name: '创建新圈层' }).click();
    await expect(page.getByText('圈层名称')).toBeVisible();
}

async function completeSeededFlow(page: Page) {
    await page.getByPlaceholder('如：异步编程讨论组').fill('Seeded 协议档案馆');
    await page.getByPlaceholder('描述这个圈层的主题和目标...').fill('用已有资料启动草稿与讨论。');
    await page.getByRole('button', { name: '下一步' }).click();

    await page.getByRole('button', { name: '知识模式' }).click();
    await page.getByRole('button', { name: 'SEEDED' }).click();
    await page.locator('input[type="file"]').setInputFiles([
        {
            name: 'materials/seed-a.md',
            mimeType: 'text/markdown',
            buffer: Buffer.from('# Seed A\n\nThis is the first seeded material.\n'),
        },
        {
            name: 'materials/notes/seed-b.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('Seed B\nline two\n'),
        },
    ]);
    await expect(page.getByText('已选择 2 个文件')).toBeVisible();
    await page.getByRole('button', { name: '下一步' }).click();

    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByText('🌱 SEEDED · 带种子材料')).toBeVisible();
    await expect(page.getByText('已挂载 2 个 Seeded 源文件')).toBeVisible();
}

test.describe('Seeded genesis create flow', () => {
    test('supports SEEDED creation, uploads source files, and syncs import after create', async ({ page }) => {
        await installMockWallet(page);
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
        });
        await installSeededCreateMocks(page);

        await page.goto('/circles', { waitUntil: 'domcontentloaded' });
        await openCreateSheet(page);
        await completeSeededFlow(page);

        await page.getByRole('button', { name: '✨ 创建圈层' }).click();

        await expect(page.getByText('Seeded 协议档案馆')).toBeVisible();
        await expect(page.locator('a[href="/circles/880"]').first()).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('确认创建')).toHaveCount(0);
    });
});
