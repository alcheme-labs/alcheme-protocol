import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('Accessibility Audit', () => {
    const pages = ['/home', '/circles', '/notifications', '/profile', '/compose'];

    for (const path of pages) {
        test(`a11y scan: ${path}`, async ({ page }) => {
            await page.goto(path);
            await page.waitForLoadState('networkidle');

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa'])
                .exclude('[class*="BreathingBg"]') // Decorative canvas element
                .analyze();

            // Log violations for debugging
            if (results.violations.length) {
                console.log(
                    `a11y violations on ${path}:`,
                    results.violations.map(v => ({
                        id: v.id,
                        impact: v.impact,
                        description: v.description,
                        count: v.nodes.length,
                    }))
                );
            }

            // Allow minor violations but flag critical/serious ones
            const critical = results.violations.filter(
                v => v.impact === 'critical' || v.impact === 'serious'
            );
            expect(
                critical,
                `Critical a11y violations on ${path}: ${critical.map(v => v.id).join(', ')}`
            ).toHaveLength(0);
        });
    }
});
