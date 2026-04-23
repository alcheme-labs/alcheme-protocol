import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const createCircleStyles = readFileSync(
  new URL('../src/components/circle/CreateCircleSheet/CreateCircleSheet.module.css', import.meta.url),
  'utf8',
);

test('CreateCircleSheet keeps its primary text input at a mobile-safe 44px touch target', () => {
  assert.match(
    createCircleStyles,
    /\.inputField\s*\{[^}]*min-height:\s*44px;/,
  );
});
