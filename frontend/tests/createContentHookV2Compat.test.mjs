import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(new URL('../src/hooks/useCreateContent.ts', import.meta.url), 'utf8');

test('useCreateContent keeps explicit write mode resolver but forces v2', () => {
  assert.match(hookSource, /resolveContentWriteMode/);
  assert.match(hookSource, /NEXT_PUBLIC_CONTENT_WRITE_MODE/);
});

test('useCreateContent passes explicit v2 route flags to SDK createContent', () => {
  assert.match(hookSource, /createV2ContentId/);
  assert.match(hookSource, /isV2ContentIdConflictError/);
  assert.match(hookSource, /buildV2RouteOptions/);
  assert.match(hookSource, /resolveIdentityHandleForV2/);
  assert.match(hookSource, /useV2WritePath\s*=\s*writeMode\s*===\s*'v2'/);
  assert.match(hookSource, /useV2:\s*true/);
  assert.match(hookSource, /enableV1FallbackOnV2Failure:\s*false/);
  assert.match(hookSource, /contentStatus/);
  assert.match(hookSource, /visibilityLevel/);
  assert.match(hookSource, /protocolCircleId/);
  assert.doesNotMatch(hookSource, /options\.visibility === 'Private' \|\| options\.visibility === 'CircleOnly'/);
});

test('useCreateContent binds circle with route-aware identifier', () => {
  assert.match(hookSource, /resolveBindContentId\(/);
  assert.match(hookSource, /contentId:\s*bindContentId/);
  assert.match(hookSource, /fallbackContentIds/);
});
