import { test, expect } from '@playwright/test';

import { installIdentityOnboardingMocks } from './support/identity-onboarding-app';
import { E2E_WALLET_PUBKEY, installMockWallet } from './support/mock-wallet';

const SECOND_WALLET_PUBKEY = 'Stake11111111111111111111111111111111111111';

test.describe('Identity onboarding', () => {
    test.beforeEach(async ({ page }) => {
        await installMockWallet(page);
    });

    test('keeps unregistered wallets on connect and shows the create-identity flow', async ({ page }) => {
        await installIdentityOnboardingMocks(page);
        await page.goto('/connect', { waitUntil: 'domcontentloaded' });
        const onboardingDialog = page.getByRole('dialog', { name: '创建链上身份' });

        await expect(page).toHaveURL(/\/connect$/);
        await expect(onboardingDialog).toBeVisible();
        await expect(onboardingDialog.getByLabel('身份 handle')).toBeVisible();
    });

    test('can skip first prompt and still see a lightweight reminder on home', async ({ page }) => {
        await installIdentityOnboardingMocks(page);
        await page.goto('/connect', { waitUntil: 'domcontentloaded' });
        const onboardingDialog = page.getByRole('dialog', { name: '创建链上身份' });

        await onboardingDialog.getByRole('button', { name: '稍后再说' }).click();
        await page.getByRole('button', { name: '稍后再说，先去首页 →' }).click();

        await expect(page).toHaveURL(/\/home$/);
        await expect(page.getByText('已连接钱包，但还没有链上身份')).toBeVisible();
        await expect(page.getByRole('button', { name: '稍后再说' })).toBeVisible();
        await expect(page.getByText('加入圈层后才能正式发言并进入沉淀链路')).toBeVisible();
    });

    test('completes standalone registration and transitions to the registered UI', async ({ page }) => {
        await installIdentityOnboardingMocks(page);
        await page.goto('/connect', { waitUntil: 'domcontentloaded' });
        const onboardingDialog = page.getByRole('dialog', { name: '创建链上身份' });

        await onboardingDialog.getByLabel('身份 handle').fill('alchemy_test');
        await onboardingDialog.getByRole('button', { name: '创建身份', exact: true }).click();

        await expect(page).toHaveURL(/\/home$/);
        await expect(page.getByText('已连接钱包，但还没有链上身份')).toHaveCount(0);

        await page.goto('/profile');
        await expect(page.getByText('@alchemy_test')).toBeVisible();
    });

    test('shows a funded-wallet hint when identity creation fails for an unfunded wallet', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            e2eRegisterIdentityError: "Simulation failed. Message: Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.",
        });
        await page.goto('/connect', { waitUntil: 'domcontentloaded' });
        const onboardingDialog = page.getByRole('dialog', { name: '创建链上身份' });

        await onboardingDialog.getByLabel('身份 handle').fill('alchemy_test');
        await onboardingDialog.getByRole('button', { name: '创建身份', exact: true }).click();

        await expect(page.getByText('当前钱包在本地链上没有可用 SOL，无法支付创建身份交易费用。请先给这个钱包空投测试 SOL，再重试。')).toBeVisible();
    });

    test('shows retry confirmation instead of create-identity when session confirmation fails', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            sessionLoginMode: 'server_error',
        });

        await page.goto('/connect', { waitUntil: 'domcontentloaded' });

        await expect(page).toHaveURL(/\/connect$/);
        await expect(page.getByRole('button', { name: '重试确认' })).toBeVisible();
        await expect(page.getByRole('dialog', { name: '创建链上身份' })).toHaveCount(0);
        await expect(page.getByText('身份状态确认失败，请重试')).toBeVisible();
    });

    test('does not mark the wallet as registered until session/me confirms authentication', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            forceSessionMeUnauthenticated: true,
        });

        await page.goto('/connect', { waitUntil: 'domcontentloaded' });

        await expect(page).toHaveURL(/\/connect$/);
        await expect(page.getByRole('button', { name: '重试确认' })).toBeVisible();
        await expect(page.getByText('身份状态确认失败，请重试')).toBeVisible();
    });

    test('shows a retry entry on home when identity confirmation is in session_error', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            forceSessionMeUnauthenticated: true,
        });

        await page.goto('/home', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('身份状态确认失败，请重试')).toBeVisible();
        await expect(page.getByRole('button', { name: '重试确认' })).toBeVisible();
        await expect(page.getByText('已连接钱包，但还没有链上身份')).toHaveCount(0);
    });

    test('shows profile fallback entry and hides profile editing before identity registration', async ({ page }) => {
        await installIdentityOnboardingMocks(page);
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('未创建身份')).toBeVisible();
        await expect(page.getByRole('button', { name: '创建身份', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '编辑资料' })).toHaveCount(0);
        await expect(page.getByText('创建身份后，这里会展示你的图腾演化状态')).toBeVisible();
        await expect(page.getByText('加入圈层并贡献内容后，这里会展示你的晶体沉淀')).toBeVisible();
        await expect(page.getByText('你还没有晶体，在圈层中贡献知识来获得')).toHaveCount(0);
    });

    test('keeps profile in a loading state while identity confirmation is pending', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            sessionLoginDelayMs: 1500,
        });
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('heading', { name: '身份确认中…' })).toBeVisible();
        await expect(page.getByText('正在确认当前钱包的链上身份，请稍候。')).toBeVisible();
        await expect(page.getByRole('button', { name: '编辑资料' })).toHaveCount(0);
        await expect(page.getByText('@unknown')).toHaveCount(0);
        await expect(page.getByText('等待创建链上身份')).toHaveCount(0);
        await expect(page.getByText('正在确认身份，确认完成后这里会展示你的图腾演化状态')).toBeVisible();
        await expect(page.getByText('正在确认身份，确认完成并加入圈层后，这里会展示你的晶体沉淀')).toBeVisible();

        await expect(page.getByText('@alchemist')).toBeVisible();
    });

    test('shows a retry entry on profile when identity confirmation is in session_error', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            forceSessionMeUnauthenticated: true,
        });
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('heading', { name: '身份状态确认失败' })).toBeVisible();
        await expect(page.getByRole('button', { name: '重试确认' })).toBeVisible();
        await expect(page.getByRole('button', { name: '编辑资料' })).toHaveCount(0);
        await expect(page.getByText('@alchemist')).toHaveCount(0);
    });

    test('clears cached registered UI when switching to an unregistered wallet', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
        });
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('@alchemist')).toBeVisible();

        await page.evaluate((nextPubkey) => {
            window.localStorage.setItem('alcheme_e2e_wallet_pubkey', nextPubkey);
        }, SECOND_WALLET_PUBKEY);

        await page.getByRole('button', { name: '断开' }).click();
        await page.getByRole('button', { name: '连接钱包' }).click();
        await page.getByRole('button', { name: 'Codex E2E Wallet' }).click();

        await expect(page.getByText('未创建身份')).toBeVisible();
        await expect(page.getByText('@alchemist')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '编辑资料' })).toHaveCount(0);
    });

    test('keeps circle join as an explicit action and continues joining after identity registration', async ({ page }) => {
        await installIdentityOnboardingMocks(page);
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('dialog', { name: '创建身份并加入圈层' })).toHaveCount(0);

        await page.getByRole('button', { name: '创建身份后加入' }).click();
        const joinDialog = page.getByRole('dialog', { name: '创建身份并加入圈层' });
        await expect(joinDialog).toBeVisible();

        await joinDialog.getByLabel('身份 handle').fill('joiner_test');
        await joinDialog.getByRole('button', { name: '创建并加入' }).click();

        await expect(joinDialog).toHaveCount(0);
        await expect(page.getByRole('button', { name: '创建身份后加入' })).toHaveCount(0);
    });

    test('finalizes first invite-approved join through the membership claim bridge', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            membershipJoinMode: 'claim_invite',
        });
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible();
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });

        const joinButton = page.locator('button').filter({ hasText: '加入圈层' }).first();
        await expect(joinButton).toBeVisible({ timeout: 15_000 });

        const finalizeRequest = page.waitForRequest((request) => {
            if (!request.url().includes('/api/v1/testing/e2e/finalize-membership')) return false;
            if (request.method() !== 'POST') return false;
            const body = request.postDataJSON() as Record<string, unknown> | null;
            return body?.action === 'claim_membership' && body?.kind === 'Invite' && body?.circleId === 246;
        });

        await joinButton.click();
        await finalizeRequest;

        await expect(joinButton).toHaveCount(0);
    });

    test('finalizes first approval-approved join through the membership claim bridge', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            membershipJoinMode: 'claim_approval',
        });
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible();
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });

        const joinButton = page.locator('button').filter({ hasText: '加入圈层' }).first();
        await expect(joinButton).toBeVisible({ timeout: 15_000 });

        const finalizeRequest = page.waitForRequest((request) => {
            if (!request.url().includes('/api/v1/testing/e2e/finalize-membership')) return false;
            if (request.method() !== 'POST') return false;
            const body = request.postDataJSON() as Record<string, unknown> | null;
            return body?.action === 'claim_membership' && body?.kind === 'Approval' && body?.circleId === 246;
        });

        await joinButton.click();
        await finalizeRequest;

        await expect(joinButton).toHaveCount(0);
    });

    test('shows a compact one-line identity progress summary in the circle header', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
        });

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible();
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });

        const progressToggle = page.locator('[class*="identityProgressToggle"]').first();
        await expect(progressToggle).toBeVisible({ timeout: 15000 });
        await expect(progressToggle.getByText('参与者', { exact: true })).toBeVisible();
        await expect(page.getByText('当前为参与者', { exact: true })).toHaveCount(0);
        await expect(page.getByText('身份进度', { exact: true })).toHaveCount(0);
        await expect(page.getByText('下一阶 · 成员', { exact: true })).toHaveCount(0);
        await progressToggle.click();
        await expect(page.locator('p', { hasText: '已获得 0 次引用，达到 2 次可晋升为成员。' })).toBeVisible();
        await expect(page.getByText('下一阶 · 成员', { exact: true })).toBeVisible();
    });

    test('allows dismissing the identity transition banner for the current session', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
            identityRecentTransition: {
                from: 'Visitor',
                to: 'Initiate',
                reason: '已发送 5 条消息，达到 5 条门槛，已晋升为入局者。',
                changedAt: '2026-03-09T09:00:00.000Z',
            },
        });

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible({ timeout: 15000 });
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });

        await expect(page.locator('[class*="identityProgressToggle"]').first()).toBeVisible({ timeout: 15000 });
        const transitionBanner = page.locator('[class*="identityTransitionBanner"]').first();
        await expect(transitionBanner).toBeVisible();
        await expect(transitionBanner).toContainText('身份变化');
        await expect(transitionBanner).toContainText('游客 → 参与者');
        await expect(transitionBanner).toContainText('已发送 5 条消息，达到 5 条门槛，已晋升为参与者。');

        await page.getByRole('button', { name: '关闭身份变化提示' }).click();
        await expect(page.locator('[class*="identityTransitionBanner"]')).toHaveCount(0);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('[class*="identityProgressToggle"]').first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[class*="identityTransitionBanner"]')).toHaveCount(0);
    });

    test('does not reuse a dismissed identity transition banner across wallet switches', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegisteredPubkeys: [E2E_WALLET_PUBKEY, SECOND_WALLET_PUBKEY],
            initialJoinedCircleIdsByWallet: {
                [E2E_WALLET_PUBKEY]: [246],
                [SECOND_WALLET_PUBKEY]: [246],
            },
            identityRecentTransition: {
                from: 'Visitor',
                to: 'Initiate',
                reason: '已发送 5 条消息，达到 5 条门槛，已晋升为入局者。',
                changedAt: '2026-03-09T09:00:00.000Z',
            },
        });

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible({ timeout: 15000 });
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[class*="identityProgressToggle"]').first()).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: '关闭身份变化提示' }).click();
        await expect(page.locator('[class*="identityTransitionBanner"]')).toHaveCount(0);

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await page.evaluate((nextPubkey) => {
            window.localStorage.setItem('alcheme_e2e_wallet_pubkey', nextPubkey);
        }, SECOND_WALLET_PUBKEY);
        await page.getByRole('button', { name: '断开' }).click();
        await page.getByRole('button', { name: '连接钱包' }).click();
        await page.getByRole('button', { name: 'Codex E2E Wallet' }).click();

        await expect(page.getByText('@alchemist')).toBeVisible({ timeout: 15000 });
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[class*="identityProgressToggle"]').first()).toBeVisible({ timeout: 15000 });
        const transitionBanner = page.locator('[class*="identityTransitionBanner"]').first();
        await expect(transitionBanner).toBeVisible();
        await expect(transitionBanner).toContainText('身份变化');
    });

    test('shows a new identity transition when the dismissed transition key changes', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
            identityRecentTransition: {
                from: 'Initiate',
                to: 'Member',
                reason: '已获得 2 次引用，达到 2 次门槛，已晋升为成员。',
                changedAt: '2026-03-09T09:30:00.000Z',
            },
        });

        await page.goto('/home', { waitUntil: 'domcontentloaded' });
        await page.evaluate((walletPubkey) => {
            window.sessionStorage.setItem(
                `alcheme_identity_transition_dismissed:${walletPubkey}:246:2026-03-09T09:00:00.000Z`,
                '1',
            );
        }, E2E_WALLET_PUBKEY);

        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[class*="identityProgressToggle"]').first()).toBeVisible({ timeout: 15000 });
        const transitionBanner = page.locator('[class*="identityTransitionBanner"]').first();
        await expect(transitionBanner).toBeVisible();
        await expect(transitionBanner).toContainText('身份变化');
        await expect(transitionBanner).toContainText('参与者 → 成员');
        await expect(transitionBanner).toContainText('已获得 2 次引用，达到 2 次门槛，已晋升为成员。');
    });

    test('shows the composer identity hint only when the affordance is tapped and keeps it visible beyond the old timeout', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
        });

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible();
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });

        const composerHint = page.getByText('当前为参与者 · 已获得 0 次引用，达到 2 次可晋升为成员。', { exact: true });
        await expect(composerHint).toHaveCount(0);
        await expect(page.getByText('身份提示', { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '查看发言身份提示' }).click();
        await expect(composerHint).toBeVisible();
        await page.waitForTimeout(4500);
        await expect(composerHint).toBeVisible();
        await page.getByPlaceholder('在广场中发言...').focus();
        await expect(composerHint).toHaveCount(0);
    });

    test('keeps circle identity rules expanded after ghost settings are saved back into the page state', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
        });

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible();
        await page.goto('/circles/246', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('[class*="identityProgressToggle"]').first()).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: '圈层设置' }).click();
        await expect(page.getByRole('button', { name: /圈层身份规则.*点击查看/ })).toBeVisible();
        await expect(page.getByText('游客 → 参与者')).toHaveCount(0);
        await page.getByRole('button', { name: /圈层身份规则.*点击查看/ }).click();
        await expect(page.getByText('游客 → 参与者')).toBeVisible();
        await page.getByRole('button', { name: '混合（LLM）' }).click();
        await page.getByRole('button', { name: '保存 AI 配置' }).click();
        await expect(page.getByText('游客 → 参与者')).toBeVisible();
        await expect(page.getByText('发送 5 条消息后晋升为参与者。')).toBeVisible();
        await expect(page.getByText('参与者 → 成员')).toBeVisible();
        await expect(page.getByText('成员 → 长老')).toBeVisible();
        await expect(page.getByText('正式发言需先创建身份并加入圈层。')).toBeVisible();
    });
});
