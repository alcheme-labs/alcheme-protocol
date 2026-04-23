import { test, expect, type Page, type Route } from '@playwright/test';

type MockCircle = {
    id: number;
    name: string;
    level: number;
    kind: 'main' | 'auxiliary';
    mode: 'knowledge' | 'social';
    parentCircleId: number | null;
};

async function installComposeGraphqlMocks(page: Page, circles: MockCircle[]) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as { operationName?: string; query?: string } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';

        if (operationName === 'GetMyCircles' || queryText.includes('myCircles')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        __typename: 'Query',
                        myCircles: circles.map((circle) => ({
                            __typename: 'Circle',
                            ...circle,
                            description: null,
                            avatarUri: null,
                            circleType: 'Open',
                            knowledgeCount: 0,
                            genesisMode: 'BLANK',
                            minCrystals: 0,
                            stats: { __typename: 'CircleStats', members: 0, posts: 0 },
                            creator: {
                                __typename: 'User',
                                id: 1,
                                handle: 'owner',
                                pubkey: 'owner_pubkey',
                                displayName: 'Owner',
                            },
                            createdAt: new Date('2026-03-25T00:00:00.000Z').toISOString(),
                        })),
                    },
                }),
            });
            return;
        }

        await route.continue();
    });
}

test.describe('Compose Page — Creation Flow', () => {
    test.beforeEach(async ({ page }) => {
        await installComposeGraphqlMocks(page, [
            {
                id: 11,
                name: 'Knowledge Circle',
                level: 0,
                kind: 'main',
                mode: 'knowledge',
                parentCircleId: null,
            },
            {
                id: 12,
                name: 'Social Circle',
                level: 0,
                kind: 'main',
                mode: 'social',
                parentCircleId: null,
            },
        ]);
        await page.goto('/compose');
    });

    test('submit button is disabled when empty', async ({ page }) => {
        const submitBtn = page.getByRole('button', { name: '发布', exact: true });
        await expect(submitBtn).toBeDisabled();
    });

    test('submit button activates when content is typed and a circle is selected', async ({ page }) => {
        await page.getByRole('button', { name: '选择发布圈层（必选）' }).click();
        await page.getByRole('button', { name: /Knowledge Circle/ }).click();

        const textarea = page.locator('textarea');
        await textarea.fill('这是一个测试观点');

        const submitBtn = page.getByRole('button', { name: '发布', exact: true });
        await expect(submitBtn).toBeEnabled();
    });

    test('circle selection dropdown works', async ({ page }) => {
        const dropdownBtn = page.locator('[class*="optionBtn"]');
        await dropdownBtn.click();
        await expect(page.locator('[class*="circleDropdown"]')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Knowledge Circle Lv.0' })).toBeVisible();

        await page.getByRole('button', { name: 'Social Circle Lv.0' }).click();
        await expect(dropdownBtn).toContainText('Social Circle');
    });

    test('submit without wallet shows the current wallet guard instead of a success screen', async ({ page }) => {
        await page.getByRole('button', { name: '选择发布圈层（必选）' }).click();
        await page.getByRole('button', { name: /Knowledge Circle/ }).click();
        await page.locator('textarea').fill('知识是安静中结晶的产物');

        const submitBtn = page.getByRole('button', { name: '发布', exact: true });
        await expect(submitBtn).toBeEnabled();
        await submitBtn.click();

        await expect(page.getByText('请先连接钱包')).toBeVisible();
        await expect(page.getByText('观点已发布')).toHaveCount(0);
    });
});
