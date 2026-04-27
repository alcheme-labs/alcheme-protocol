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
const enMessages = JSON.parse(
    readFileSync(new URL('../src/i18n/messages/en.json', import.meta.url), 'utf8'),
);
const zhMessages = JSON.parse(
    readFileSync(new URL('../src/i18n/messages/zh.json', import.meta.url), 'utf8'),
);

test('circle knowledge cards copy their knowledge detail link from CrystalDetailSheet', () => {
    assert.match(detailSheetSource, /onCopy\?: \(\) => void/);
    assert.doesNotMatch(circlePageSource, /navigator\.clipboard\.writeText\(selectedCrystal\.content\)/);
    assert.match(circlePageSource, /new URL\(`\/knowledge\/\$\{selectedCrystal\.knowledgeId\}`,\s*window\.location\.origin\)/);
    assert.match(circlePageSource, /navigator\.clipboard\.writeText\(crystalHref\)/);
});

test('CrystalDetailSheet copy action is labeled as copying a link', () => {
    assert.equal(enMessages.CrystalDetailSheet.actions.copy, 'Copy link');
    assert.equal(zhMessages.CrystalDetailSheet.actions.copy, '复制链接');
});
