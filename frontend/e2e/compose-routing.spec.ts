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
                            createdAt: new Date('2026-02-28T10:00:00.000Z').toISOString(),
                        })),
                    },
                }),
            });
            return;
        }

        await route.continue();
    });
}

test.describe('Compose Routing', () => {
    test('query params preselect target circle and publish intent', async ({ page }) => {
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

        await page.goto('/compose?circleId=11&intent=draft');

        await expect(page.locator('[class*="optionBtn"]')).toContainText('Knowledge Circle');
        await expect(page.locator('[class*="visBtnActive"]')).toContainText('草稿');
    });

    test('knowledge circles disable feed intent and keep draft intent active', async ({ page }) => {
        await installComposeGraphqlMocks(page, [
            {
                id: 11,
                name: 'Knowledge Circle',
                level: 0,
                kind: 'main',
                mode: 'knowledge',
                parentCircleId: null,
            },
        ]);

        await page.goto('/compose?circleId=11&intent=feed');

        await expect(page.locator('[class*="optionBtn"]')).toContainText('Knowledge Circle');
        await expect(page.getByRole('button', { name: '动态' })).toBeDisabled();
        await expect(page.locator('[class*="visBtnActive"]')).toContainText('草稿');
    });

    test('circle dropdown becomes internally scrollable when there are many circles', async ({ page }) => {
        await installComposeGraphqlMocks(
            page,
            Array.from({ length: 16 }, (_, index) => ({
                id: 100 + index,
                name: `Knowledge Circle ${index + 1}`,
                level: 0,
                kind: 'main' as const,
                mode: 'knowledge' as const,
                parentCircleId: null,
            })),
        );

        await page.goto('/compose?circleId=100&intent=draft');
        await page.getByRole('button', { name: /Knowledge Circle 1/ }).click();

        const dropdown = page.locator('[class*="circleDropdown"]');
        await expect(dropdown).toBeVisible();

        const metrics = await dropdown.evaluate((node) => {
            const element = node as HTMLElement;
            const style = window.getComputedStyle(element);
            return {
                overflowY: style.overflowY,
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
            };
        });

        expect(['auto', 'scroll']).toContain(metrics.overflowY);
        expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    });

    test('header stays pinned after the compose page scrolls', async ({ page }) => {
        await page.setViewportSize({ width: 430, height: 932 });
        await installComposeGraphqlMocks(
            page,
            Array.from({ length: 16 }, (_, index) => ({
                id: 200 + index,
                name: `Knowledge Circle ${index + 1}`,
                level: 0,
                kind: 'main' as const,
                mode: 'knowledge' as const,
                parentCircleId: null,
            })),
        );

        await page.goto('/compose?circleId=200&intent=draft');
        await page.getByRole('button', { name: /Knowledge Circle 1/ }).click();

        const header = page.locator('header').first();
        await expect(header).toBeVisible();
        const initialBox = await header.boundingBox();
        expect(initialBox).not.toBeNull();

        await page.evaluate(() => window.scrollTo({ top: 800, behavior: 'instant' }));
        const scrollY = await page.evaluate(() => window.scrollY);
        expect(scrollY).toBeGreaterThan(40);

        const box = await header.boundingBox();
        expect(box).not.toBeNull();
        expect(Math.abs(box!.y - initialBox!.y)).toBeLessThanOrEqual(20);
        expect(box!.y).toBeLessThanOrEqual(24);
    });
});
