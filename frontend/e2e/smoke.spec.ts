import { test, expect } from '@playwright/test';

import { installSmokeAppMocks } from './support/smoke-app';

test.describe('@smoke App Smoke', () => {
    test.beforeEach(async ({ page }) => {
        await installSmokeAppMocks(page);
    });

    test('@smoke landing redirects into home and renders dashboard essentials', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 });
        await expect(page.getByRole('heading', { name: '继续你的思考' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
        await expect(page.getByText('链上身份如何做最小可信同步')).toBeVisible();
        await expect(page.getByRole('heading', { name: '协议研究所', exact: true })).toBeVisible();
    });

    test('@smoke public Lv0 crystals navigate into knowledge detail', async ({ page }) => {
        await page.goto('/home');

        await Promise.all([
            page.waitForURL('**/knowledge/knowledge_1'),
            page.getByRole('link', { name: '查看结晶 知识晶体需要独立热度模型' }).click(),
        ]);

        await expect(page.getByRole('heading', { name: '知识晶体需要独立热度模型', level: 1 })).toBeVisible();
        await expect(page.getByText('协议研究所')).toBeVisible();
    });

    test('@smoke bottom navigation reaches primary surfaces', async ({ page }) => {
        await page.goto('/home');

        await Promise.all([
            page.waitForURL('**/circles'),
            page.getByRole('link', { name: '圈层' }).click(),
        ]);
        await expect(page.getByRole('heading', { name: '圈层' })).toBeVisible();
        await expect(page.getByPlaceholder('搜索圈层...')).toBeVisible();

        await Promise.all([
            page.waitForURL('**/notifications'),
            page.getByRole('link', { name: '通知' }).click(),
        ]);
        await expect(page.getByRole('heading', { name: '通知' })).toBeVisible();
        await expect(page.getByText('协议研究所里有一篇草稿等待继续打磨')).toBeVisible();

        await Promise.all([
            page.waitForURL('**/profile'),
            page.getByRole('link', { name: '我的' }).click(),
        ]);
        await expect(page.getByRole('heading', { name: 'The Alchemist' })).toBeVisible();

        await Promise.all([
            page.waitForURL('**/compose'),
            page.getByLabel('发布').click(),
        ]);
        await expect(page.getByRole('heading', { name: '发布观点' })).toBeVisible();
    });

    test('@smoke compose enforces circle selection and surfaces wallet guard', async ({ page }) => {
        await page.goto('/compose');

        const submitButton = page.getByRole('button', { name: '发布', exact: true });
        await expect(submitButton).toBeDisabled();

        await page.getByRole('button', { name: '选择发布圈层（必选）' }).click();
        await page.getByRole('button', { name: /协议研究所/ }).click();
        await page.getByRole('textbox').fill('为 smoke test 预留的一条最小发布内容。');

        await expect(submitButton).toBeEnabled();
        await submitButton.click();
        await expect(page.getByText('请先连接钱包')).toBeVisible();
    });

    test('@smoke notifications and profile expose core actions', async ({ page }) => {
        await page.goto('/notifications');

        await expect(page.getByRole('button', { name: /全部已读/ })).toBeVisible();
        await page.getByRole('button', { name: /全部已读/ }).click();
        await expect(page.getByRole('button', { name: /全部已读/ })).toHaveCount(0);

        await page.goto('/profile');
        await expect(page.getByText('@alchemist')).toBeVisible();
        await page.getByRole('button', { name: '编辑资料' }).click();
        await expect(page.getByRole('heading', { name: '编辑资料' })).toBeVisible();
    });
});
