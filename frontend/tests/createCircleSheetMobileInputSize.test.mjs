import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheetStyles = readFileSync(
  new URL('../src/components/circle/CreateCircleSheet/CreateCircleSheet.module.css', import.meta.url),
  'utf8',
);

test('CreateCircleSheet keeps focused inputs at 16px to avoid iOS auto-zoom', () => {
  assert.match(
    sheetStyles,
    /\.inputField\s*\{[\s\S]*font-size:\s*16px;/,
  );
  assert.match(
    sheetStyles,
    /\.textareaField\s*\{[\s\S]*font-size:\s*16px;/,
  );
});
