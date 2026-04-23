import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    fullyParallel: true,
    retries: 1,
    reporter: [['html', { open: 'never' }]],
    use: {
        baseURL: 'http://127.0.0.1:3000',
        screenshot: 'only-on-failure',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'Mobile Chrome',
            testIgnore: /(identity-onboarding|profile|circle-next-level-permission|seeded-genesis|agent-contribution)\.spec\.ts/,
            use: {
                ...devices['Pixel 7'],
                baseURL: 'http://127.0.0.1:3000',
            },
        },
        {
            name: 'Desktop Chrome',
            testIgnore: /(identity-onboarding|profile|circle-next-level-permission|seeded-genesis|agent-contribution)\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://127.0.0.1:3000',
            },
        },
        {
            name: 'Onboarding Mobile',
            testMatch: /(identity-onboarding|profile|circle-next-level-permission|seeded-genesis|agent-contribution)\.spec\.ts/,
            use: {
                ...devices['Pixel 7'],
                baseURL: 'http://127.0.0.1:3001',
            },
        },
        {
            name: 'Onboarding Desktop',
            testMatch: /(identity-onboarding|profile|circle-next-level-permission|seeded-genesis|agent-contribution)\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://127.0.0.1:3001',
            },
        },
    ],
    webServer: [
        {
            command: 'NEXT_DIST_DIR=.next-playwright-default NEXT_PUBLIC_EXTENSION_GATE_ENABLED=true NEXT_PUBLIC_EXTENSION_ALLOWLIST=contribution-engine NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL=https://apps.example/contribution-engine ./node_modules/.bin/next build && NEXT_DIST_DIR=.next-playwright-default NEXT_PUBLIC_EXTENSION_GATE_ENABLED=true NEXT_PUBLIC_EXTENSION_ALLOWLIST=contribution-engine NEXT_PUBLIC_EXTENSION_CONTRIBUTION_ENGINE_URL=https://apps.example/contribution-engine ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3000',
            url: 'http://127.0.0.1:3000',
            reuseExistingServer: false,
            timeout: 120_000,
        },
        {
            command: 'NEXT_DIST_DIR=.next-playwright-onboarding NEXT_PUBLIC_E2E_WALLET_MOCK=1 NEXT_PUBLIC_GRAPHQL_URL=http://127.0.0.1:3001/graphql ./node_modules/.bin/next build && NEXT_DIST_DIR=.next-playwright-onboarding NEXT_PUBLIC_E2E_WALLET_MOCK=1 NEXT_PUBLIC_GRAPHQL_URL=http://127.0.0.1:3001/graphql ./node_modules/.bin/next start --hostname 127.0.0.1 --port 3001',
            url: 'http://127.0.0.1:3001',
            reuseExistingServer: false,
            timeout: 120_000,
        },
    ],
});
