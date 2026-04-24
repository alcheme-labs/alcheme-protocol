import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const queriesSource = readFileSync(
  new URL('../src/lib/apollo/queries.ts', import.meta.url),
  'utf8',
);

const typesSource = readFileSync(
  new URL('../src/lib/apollo/types.ts', import.meta.url),
  'utf8',
);

const circlesPageSource = readFileSync(
  new URL('../src/app/(main)/circles/page.tsx', import.meta.url),
  'utf8',
);

const circleDetailSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8',
);

const composePageSource = readFileSync(
  new URL('../src/app/(main)/compose/page.tsx', import.meta.url),
  'utf8',
);

const circleUtilsSource = readFileSync(
  new URL('../src/lib/circle/utils.ts', import.meta.url),
  'utf8',
);

test('CircleFields query requests lifecycle projection fields for archived-circle UI', () => {
  assert.match(queriesSource, /fragment CircleFields on Circle \{[\s\S]*lifecycleStatus/);
  assert.match(queriesSource, /fragment CircleFields on Circle \{[\s\S]*archivedAt/);
  assert.match(queriesSource, /fragment CircleFields on Circle \{[\s\S]*archivedByPubkey/);
  assert.match(queriesSource, /fragment CircleFields on Circle \{[\s\S]*archiveReason/);
});

test('frontend circle types expose lifecycle projection state', () => {
  assert.match(typesSource, /export type GQLCircleLifecycleStatus = 'Active' \| 'Archived';/);
  assert.match(typesSource, /lifecycleStatus: GQLCircleLifecycleStatus;/);
  assert.match(typesSource, /archivedAt: string \| null;/);
  assert.match(typesSource, /archivedByPubkey: string \| null;/);
  assert.match(typesSource, /archiveReason: string \| null;/);
});

test('CirclesPage excludes archived circles even if stale cache data still includes them', () => {
  assert.match(circlesPageSource, /circle\.lifecycleStatus !== 'Archived'/);
});

test('circle detail page derives an archived-circle banner state from lifecycleStatus', () => {
  assert.match(circleDetailSource, /const activeCircleArchived = activeDiscussionCircleData\?\.lifecycleStatus === 'Archived';/);
  assert.match(circleDetailSource, /circleDetailT\('archived\.badge'\)/);
  assert.match(circleDetailSource, /circleDetailT\('archived\.notice'\)/);
});

test('compose page excludes archived myCircles targets from write flows', () => {
  assert.match(composePageSource, /myCircles \?\? \[\]\)\.filter\(\(circle\) => circle\.lifecycleStatus !== 'Archived'\)/);
});

test('normalizeJoinActionError maps archived-circle server responses to localized copy', () => {
  assert.match(circleUtilsSource, /circle_archived/);
  assert.match(circleUtilsSource, /copy\.errors\.archived/);
});
