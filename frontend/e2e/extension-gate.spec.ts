import { test, expect, type Page, type Route } from '@playwright/test';

function fulfillGraphql(route: Route, page: Page) {
  const request = route.request();
  if (request.method() !== 'POST') {
    return route.continue();
  }

  const body = request.postDataJSON() as { operationName?: string };
  const operationName = body?.operationName;

  if (operationName === 'GetPublicFlow') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { publicFlow: [] } }),
    });
  }

  if (operationName === 'GetFollowingFlow') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { followingFlow: [] } }),
    });
  }

  if (operationName === 'GetAllCircles') {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { allCircles: [] } }),
    });
  }

  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: {} }),
  });
}

test.describe('Extension gate on Home', () => {
  test('renders pilot extension card when catalog reports available capability', async ({ page }) => {
    await page.route('**/graphql', (route) => fulfillGraphql(route, page));
    await page.route('http://127.0.0.1:4000/api/v1/extensions/capabilities', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-03-07T00:00:00.000Z',
          manifestSource: 'configured',
          manifestReason: null,
          consistency: {
            indexerId: 'indexer-test',
            readCommitment: 'confirmed',
            indexedSlot: 12345,
            stale: false,
          },
          skippedManifests: [],
          capabilities: [
            {
              extensionId: 'contribution-engine',
              displayName: 'Contribution Engine',
              programId: 'Contrib11111111111111111111111111111111111',
              version: '1.0.0',
              parserVersion: 'v1',
              status: 'active',
              reason: null,
              sdkPackage: '@alcheme/sdk',
              requiredPermissions: ['ReputationWrite'],
              tags: ['knowledge'],
              runtime: {
                registered: true,
                enabled: true,
                permissions: ['ReputationWrite'],
                source: 'chain',
                registrationStatus: 'registered_enabled',
                reason: null,
              },
              indexedSlot: 12345,
              stale: false,
            },
          ],
        }),
      });
    });

    await page.goto('/home');

    await expect(page.getByTestId('extension-capability-section')).toBeVisible();
    await expect(page.getByText('贡献引擎')).toBeVisible();
    await expect(page.getByRole('link', { name: '打开应用' })).toBeVisible();
  });

  test('keeps Home content visible when capability endpoint is unavailable', async ({ page }) => {
    await page.route('**/graphql', (route) => fulfillGraphql(route, page));
    await page.route('http://127.0.0.1:4000/api/v1/extensions/capabilities', async (route) => {
      await route.abort('failed');
    });

    await page.goto('/home');

    await expect(page.getByRole('heading', { name: '继续你的思考' })).toBeVisible();
    await expect(page.getByText('发现圈层')).toBeVisible();
    await expect(page.getByTestId('extension-capability-section')).toBeVisible();
    await expect(page.getByText('运行状态暂不可确认，请稍后重试')).toBeVisible();
  });
});
