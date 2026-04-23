import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const circleDetailPageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8'
);
const circleSummaryApiSource = readFileSync(
  new URL('../src/features/circle-summary/api.ts', import.meta.url),
  'utf8'
);
const circleSummaryPageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/summary/page.tsx', import.meta.url),
  'utf8'
);

test('Wave D part 7 removes the last raw membership and lineage copy from the circle detail page', () => {
  assert.match(circleDetailPageSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    circleDetailPageSource,
    /Current role cannot perform this action\.|That member no longer exists here or their state already changed\. Refresh and try again\.|This member is already in the circle\.|That member role cannot be changed here right now\.|You cannot remove yourself here\. Use leave circle instead\.|Changing your own role is not supported here right now\.|Fork lineage/
  );
});

test('Wave D part 7 routes circle summary warnings through translated page copy instead of hardcoded fallback strings', () => {
  assert.match(circleSummaryPageSource, /fetchCircleSummaryKnowledgeOutputs\(\{\s*circleId,\s*messages:/s);

  assert.doesNotMatch(
    circleSummaryApiSource,
    /有 .*正式 CrystalOutput 暂不可读|formal output read failed/
  );
});
