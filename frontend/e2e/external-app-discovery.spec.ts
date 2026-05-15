import { test, expect } from '@playwright/test';

test('external app discovery page renders without implying install or shutdown controls', async ({ page }) => {
    await page.route('**/api/v1/external-apps/discovery**', async (route) => {
        await route.fulfill({
            contentType: 'application/json',
            headers: {
                'access-control-allow-origin': '*',
            },
            body: JSON.stringify({
                apps: [
                    {
                        id: 'last-ignition',
                        name: 'Last Ignition',
                        registryStatus: 'active',
                        discoveryStatus: 'listed',
                        managedNodePolicy: 'normal',
                        stabilityProjection: {
                            policyEpochId: 'epoch-1',
                            challengeState: 'dispute',
                            projectionStatus: 'projection_disputed',
                            publicLabels: ['Under Challenge', 'Risk Notice'],
                            riskScore: 72,
                            trustScore: 28,
                            supportSignalLevel: 3,
                            supportIndependenceScore: 0.5,
                            rollout: {
                                exposed: true,
                                bucket: 44,
                                exposureBasisPoints: 5000,
                            },
                            statusProvenance: {
                                registryStatus: { source: 'external_apps' },
                            },
                            bondDispositionState: {
                                state: 'locked_for_case',
                                activeLockedAmountRaw: '250',
                                totalRoutedAmountRaw: '0',
                                activeCaseCount: 1,
                                riskDisclaimerAccepted: true,
                                riskDisclaimerRequired: true,
                            },
                            governanceState: {
                                captureReviewStatus: 'open',
                                projectionDisputeStatus: 'open',
                                emergencyHoldStatus: 'none',
                                highImpactActionsPaused: true,
                                labels: ['Capture Review'],
                            },
                        },
                        storeProjection: {
                            listingState: 'listed_limited',
                            categoryTags: ['game'],
                            rankingOutput: {
                                score: 40,
                                provenance: ['v3a_store_projection'],
                                fallbackMode: false,
                            },
                            continuityLabels: ['App-Operated Node Declared'],
                        },
                    },
                ],
            }),
        });
    });
    await page.goto('/apps');
    await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible();
    await expect(page.getByText('Last Ignition')).toBeVisible();
    await expect(page.getByText('listed', { exact: true })).toBeVisible();
    await expect(page.getByText('Under Challenge').first()).toBeVisible();
    await expect(page.getByText('Risk 72')).toBeVisible();
    await expect(page.getByText(/without endorsement/i)).toBeVisible();
    await expect(page.getByText('Bond locked')).toBeVisible();
    await expect(page.getByText(/Rule-based bond record/i)).toBeVisible();
    await expect(page.getByText('Capture Review')).toBeVisible();
    await expect(page.getByText(/Review-sensitive actions are paused/i)).toBeVisible();
    await expect(page.getByLabel('Search apps')).toBeVisible();
    await expect(page.getByLabel('Category')).toBeVisible();
    await expect(page.getByRole('button', { name: 'featured' })).toBeVisible();
    await expect(page.getByText('App-Operated Node Declared')).toBeVisible();
    await expect(page.getByRole('button', { name: /install|disable|shutdown/i })).toHaveCount(0);
});
