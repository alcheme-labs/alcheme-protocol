import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const utilsSource = readFileSync(
    new URL('../src/lib/circle/utils.ts', import.meta.url),
    'utf8',
);

test('uses server highlightCount instead of collapsing featured messages to 1', () => {
    assert.match(
        utilsSource,
        /highlights:\s*[\s\S]*typeof dto\.highlightCount === 'number'[\s\S]*Math\.max\(0, dto\.highlightCount\)/,
    );
});

test('keeps highlight count at 0 for ai-featured messages with no member highlights', () => {
    assert.match(
        utilsSource,
        /highlights:\s*[\s\S]*typeof dto\.highlightCount === 'number'[\s\S]*:\s*0,/,
    );
    assert.match(utilsSource, /isFeatured:\s*Boolean\(dto\.isFeatured\)/);
});
