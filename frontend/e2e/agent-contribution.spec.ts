import { test, expect, type Route } from '@playwright/test';

import { installIdentityOnboardingMocks } from './support/identity-onboarding-app';
import { installMockWallet } from './support/mock-wallet';

// CircleSettingsSheet keeps SHOW_AGENT_GOVERNANCE_PANEL disabled until agent policy drives runtime behavior.
test.describe.skip('Agent contribution admin', () => {
    test.beforeEach(async ({ page }) => {
        await installMockWallet(page);
    });

    test('shows agent admin controls inside the real circle settings surface', async ({ page }) => {
        await installIdentityOnboardingMocks(page, {
            initialRegistered: true,
            initialJoinedCircleIds: [246],
        });

        await page.route('**/api/v1/membership/circles/*/me', async (route: Route) => {
            const parts = new URL(route.request().url()).pathname.split('/');
            const circleId = Number(parts[5] || '246');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    authenticated: true,
                    circleId,
                    policy: {
                        joinRequirement: 'Free',
                        circleType: 'Open',
                        minCrystals: 0,
                        requiresApproval: false,
                        requiresInvite: false,
                    },
                    joinState: 'joined',
                    membership: {
                        role: 'Owner',
                        status: 'Active',
                        identityLevel: 'Member',
                        joinedAt: new Date('2026-03-25T22:00:00.000Z').toISOString(),
                    },
                    userCrystals: 0,
                    missingCrystals: 0,
                }),
            });
        });

        let policyState = {
            circleId: 246,
            triggerScope: 'draft_only',
            costDiscountBps: 0,
            reviewMode: 'owner_review',
            updatedByUserId: 1,
        };

        await page.route('**/api/v1/circles/*/agents', async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    circleId: 246,
                    agents: [
                        {
                            id: 15,
                            circleId: 246,
                            handle: 'scribe-bot',
                            agentPubkey: 'AgentPubkey111111111111111111111111111111111',
                            displayName: 'Scribe Bot',
                            description: 'Turns debate into first drafts.',
                            ownerUserId: 1,
                            status: 'active',
                        },
                    ],
                }),
            });
        });

        await page.route('**/api/v1/circles/*/agents/policy', async (route: Route) => {
            if (route.request().method() === 'PUT') {
                const patch = route.request().postDataJSON() as Record<string, unknown>;
                policyState = {
                    ...policyState,
                    ...patch,
                };
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    circleId: 246,
                    policy: policyState,
                }),
            });
        });

        await page.route('**/api/v1/policy/circles/*/profile', async (route: Route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    circleId: 246,
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

        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('@alchemist')).toBeVisible({ timeout: 10000 });
        await Promise.all([
            page.waitForResponse((response) => response.url().includes('/api/v1/membership/circles/246/me') && response.ok()),
            page.waitForResponse((response) => response.url().includes('/api/v1/membership/circles/246/identity-status') && response.ok()),
            page.goto('/circles/246', { waitUntil: 'domcontentloaded' }),
        ]);

        const settingsButton = page.getByRole('button', { name: /圈层设置|Open circle settings/ });
        await expect(settingsButton).toBeVisible();
        await Promise.all([
            page.waitForResponse((response) => (
                response.url().includes('/api/v1/circles/246/agents')
                && !response.url().includes('/api/v1/circles/246/agents/policy')
                && response.request().method() === 'GET'
                && response.ok()
            )),
            page.waitForResponse((response) => (
                response.url().includes('/api/v1/circles/246/agents/policy')
                && response.request().method() === 'GET'
                && response.ok()
            )),
            page.waitForResponse((response) => response.url().includes('/api/v1/policy/circles/246/profile') && response.ok()),
            settingsButton.click(),
        ]);
        await expect(page.getByText(/测试圈层 · (设置|Settings)/)).toBeVisible({ timeout: 15000 });

        const triggerScopeSelect = page.getByLabel(/Agent (触发范围|trigger scope)/);
        await expect(triggerScopeSelect).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/Agent (管理与审计|governance and audit)/)).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('scribe-bot')).toBeVisible({ timeout: 15000 });
        await triggerScopeSelect.click();
        await page.getByRole('option', { name: /circle_wide|Circle-wide/ }).click();
        await expect(triggerScopeSelect).toContainText(/circle_wide|Circle-wide/);

        const savePolicyResponse = page.waitForResponse((response) => (
            response.url().includes('/api/v1/circles/246/agents/policy')
            && response.request().method() === 'PUT'
            && response.ok()
        ));
        await page.getByRole('button', { name: /保存 Agent 策略|Save agent policy/ }).click();
        await savePolicyResponse;
        expect(policyState.triggerScope).toBe('circle_wide');
    });
});
