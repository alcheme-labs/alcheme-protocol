import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notificationsStyles = readFileSync(
  new URL('../src/app/(main)/notifications/page.module.css', import.meta.url),
  'utf8',
);
const circlePageStyles = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.module.css', import.meta.url),
  'utf8',
);

test('notifications keep timestamp text on the higher-contrast secondary token', () => {
  assert.match(
    notificationsStyles,
    /\.notificationTime\s*\{[\s\S]*color:\s*var\(--color-text-secondary\);/,
  );
});

test('dimmed message overlay keeps an explicit high-contrast label treatment', () => {
  assert.match(
    circlePageStyles,
    /\.msgDimLabel\s*\{[\s\S]*color:\s*var\(--color-text-primary\);/,
  );
  assert.match(
    circlePageStyles,
    /\.msgDimLabel\s*\{[\s\S]*background:\s*rgba\(18,\s*22,\s*20,\s*0\.94\);/,
  );
});
