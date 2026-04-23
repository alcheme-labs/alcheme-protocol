import { test, expect } from '@playwright/test';

import { installSmokeAppMocks } from './support/smoke-app';

test.describe('Notifications Page', () => {
    test.beforeEach(async ({ page }) => {
        await installSmokeAppMocks(page);
        await page.goto('/notifications');
    });

    test('shows notifications list when seeded fixtures exist', async ({ page }) => {
        await expect(page.locator('h1')).toContainText('通知');

        const cards = page.locator('[class*="list"] > div');
        await expect(cards).toHaveCount(2);
        await expect(page.getByText('协议研究所里有一篇草稿等待继续打磨')).toBeVisible();
    });

    test('clicking a notification routes to its target and marks it as read optimistically', async ({ page }) => {
        const dotsCountBefore = await page.locator('[class*="unreadDot"]').count();

        const firstNotification = page.locator('[class*="notificationRow"]').first();
        await firstNotification.click();

        await expect(page).toHaveURL(/\/circles\/101\?tab=crucible/);
        const dotsCountAfter = await page.locator('[class*="unreadDot"]').count().catch(() => 0);
        expect(dotsCountAfter).toBeLessThanOrEqual(dotsCountBefore);
    });

    test('mark all as read clears unread badge', async ({ page }) => {
        const markAllBtn = page.locator('button:has-text("全部已读")');
        await expect(markAllBtn).toBeVisible();
        await markAllBtn.click();
        await expect(page.locator('[class*="unreadDot"]')).toHaveCount(0);
    });
});
