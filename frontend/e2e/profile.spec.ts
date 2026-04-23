import { test, expect } from '@playwright/test';

import { installIdentityOnboardingMocks } from './support/identity-onboarding-app';
import { installMockWallet } from './support/mock-wallet';

test.describe('Profile Page', () => {
    test.beforeEach(async ({ page }) => {
        await installMockWallet(page);
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
        });
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible();
    });

    test('shows profile header with stats', async ({ page }) => {
        await expect(page.getByRole('heading', { name: 'The Alchemist' })).toBeVisible();
        await expect(page.getByText('@alchemist')).toBeVisible();
        // Stats grid has 4 items
        const statItems = page.locator('[class*="statItem"]');
        const count = await statItems.count();
        expect(count).toBe(4);
        await expect(page.getByRole('heading', { name: '图腾' })).toBeVisible();
        await expect(page.getByRole('heading', { name: '我的晶体' })).toBeVisible();
    });

    test('edit profile modal opens and saves', async ({ page }) => {
        // Click edit button
        await page.getByRole('button', { name: '编辑资料' }).click();

        // Modal should appear
        await expect(page.getByText('昵称')).toBeVisible();
        await expect(page.getByText('简介')).toBeVisible();

        // Edit name
        const nameInput = page.locator('input[type="text"]').last();
        await nameInput.clear();
        await nameInput.fill('新炼金术师');
        const bioInput = page.locator('textarea');
        await bioInput.clear();
        await bioInput.fill('把分散观点炼成可回放的知识。');

        // Save
        await page.getByRole('button', { name: '保存' }).click();

        // Modal closes and name updates
        await expect(page.locator('textarea')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: '新炼金术师' })).toBeVisible();
        await expect(
            page.locator('[class*="bio"]').filter({ hasText: '把分散观点炼成可回放的知识。' }),
        ).toBeVisible();
    });

    test('shows empty-state crystals instead of legacy achievements', async ({ page }) => {
        await expect(page.getByText('你还没有晶体，在圈层中贡献知识来获得')).toBeVisible();
        await expect(page.getByText('成就')).toHaveCount(0);
    });
});
