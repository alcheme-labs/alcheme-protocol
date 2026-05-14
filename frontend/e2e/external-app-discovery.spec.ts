import { test, expect } from '@playwright/test';

test('external app discovery page renders without implying install or shutdown controls', async ({ page }) => {
    await page.route('**/api/v1/external-apps/discovery', async (route) => {
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
                    },
                ],
            }),
        });
    });
    await page.goto('/apps');
    await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible();
    await expect(page.getByText('Last Ignition')).toBeVisible();
    await expect(page.getByText('listed')).toBeVisible();
    await expect(page.getByRole('button', { name: /install|disable|shutdown/i })).toHaveCount(0);
});
