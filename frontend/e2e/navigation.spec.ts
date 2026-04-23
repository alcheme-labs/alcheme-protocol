import { test, expect } from '@playwright/test';

import { installSmokeAppMocks } from './support/smoke-app';

test.describe('Navigation & Core Pages', () => {
    test.beforeEach(async ({ page }) => {
        await installSmokeAppMocks(page);
    });

    test('home page loads with greeting and current dashboard sections', async ({ page }) => {
        await page.goto('/home');
        await expect(page.getByRole('heading', { name: '继续你的思考' })).toBeVisible();
        await expect(page.getByText('Lv0 精选讨论')).toBeVisible();
        await expect(page.getByText('Lv0 最新结晶')).toBeVisible();
        await expect(page.getByText('发现圈层')).toBeVisible();
    });

    test('bottom nav has 5 items including FAB', async ({ page }) => {
        await page.goto('/home');
        const nav = page.locator('nav[aria-label="Main navigation"]');
        await expect(nav).toBeVisible();
        await expect(nav.locator('a')).toHaveCount(5);
    });

    test('navigate to circles page', async ({ page }) => {
        await page.goto('/circles');
        await expect(page.locator('h1')).toContainText('圈层');
    });

    test('navigate to notifications page', async ({ page }) => {
        await page.goto('/notifications');
        await expect(page.locator('h1')).toContainText('通知');
    });

    test('navigate to profile page', async ({ page }) => {
        await page.goto('/profile');
        await expect(page.getByText('The Alchemist')).toBeVisible();
        await expect(page.getByText('@alchemist')).toBeVisible();
    });

    test('navigate to compose page', async ({ page }) => {
        await page.goto('/compose');
        await expect(page.locator('h1')).toContainText('发布观点');
        await expect(page.locator('textarea')).toBeVisible();
    });
});
