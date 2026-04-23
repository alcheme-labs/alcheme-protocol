import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const circlePageSource = readFileSync(
    new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
    'utf8',
);
const detailSheetSource = readFileSync(
    new URL('../src/components/circle/CrystalDetailSheet/CrystalDetailSheet.tsx', import.meta.url),
    'utf8',
);

test('circle knowledge cards provide a copy-safe fallback body into CrystalDetailSheet', () => {
    assert.match(detailSheetSource, /onCopy\?: \(\) => void/);
    assert.match(circlePageSource, /navigator\.clipboard\.writeText\(selectedCrystal\.content\)/);
    assert.match(
        circlePageSource,
        /content:\s*\(k\.description && k\.description\.trim\(\)\)\s*\|\|\s*k\.title/,
    );
});
