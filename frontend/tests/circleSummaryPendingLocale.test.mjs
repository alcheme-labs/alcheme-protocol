import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const scaffoldSource = readFileSync(
  new URL('../src/features/circle-summary/CircleSummaryScaffold.tsx', import.meta.url),
  'utf8',
);

test('summary snapshots without settled outputs use current-locale pending copy instead of persisted issue text', () => {
  assert.match(scaffoldSource, /buildCircleSummaryMapViewModel/);
  assert.match(scaffoldSource, /const pendingLocaleSummaryMap = useMemo\(\(\) => buildCircleSummaryMapViewModel\(\{/);
  assert.match(scaffoldSource, /const shouldUsePendingLocaleSummaryMap = Boolean\(presentation\.summaryMap && outputs\.length === 0\);/);
  assert.match(
    scaffoldSource,
    /const summaryMap = shouldUsePendingLocaleSummaryMap\s*\?\s*pendingLocaleSummaryMap\s*:\s*presentation\.summaryMap;/,
  );
  assert.match(scaffoldSource, /const emptyRouteBody = t\('sections\.primaryRoutes\.empty\.bodyFallback'\);/);
  assert.doesNotMatch(
    scaffoldSource,
    /summaryMap\.issueMap\[0\]\?\.body \|\| t\('sections\.primaryRoutes\.empty\.bodyFallback'\)/,
  );
});
