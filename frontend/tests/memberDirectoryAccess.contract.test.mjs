import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const circlePageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8',
);

test('circle member profile entry remains gated until the viewer is an active joined member', () => {
  assert.match(
    circlePageSource,
    /if \(activeCircleMembershipSnapshot && activeCircleMembershipSnapshot\.joinState !== 'joined'\) \{\s*return circleDetailT\('memberDirectory\.notice\.joinRequired'\);/s,
  );
  assert.match(
    circlePageSource,
    /const canOpenMemberProfiles = !memberDirectoryNotice && activeDiscussionMembers\.length > 0;/,
  );
});
