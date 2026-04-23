import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Circle member governance settings coverage', () => {
  const settingsSheetSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx'),
    'utf8',
  );
  const circlePageSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/page.tsx'),
    'utf8',
  );
  const membershipClientSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/lib/circles/membership.ts'),
    'utf8',
  );

  it('exposes invite and member-governance affordances in settings UI', () => {
    assert.match(settingsSheetSource, /邀请成员/);
    assert.match(settingsSheetSource, /设为策展人/);
    assert.match(settingsSheetSource, /取消策展人/);
    assert.match(settingsSheetSource, /移除成员/);
  });

  it('keeps role gating explicit for owner-only mutation and owner-or-curator invite', () => {
    assert.match(settingsSheetSource, /const canManageRoles = currentUserRole === 'owner'/);
    assert.match(settingsSheetSource, /const canInvite = currentUserRole === 'owner' \|\| currentUserRole === 'curator'/);
  });

  it('wires settings actions to membership client calls from the circle page', () => {
    assert.match(circlePageSource, /createCircleInvite/);
    assert.match(circlePageSource, /updateCircleMemberRole/);
    assert.match(circlePageSource, /removeCircleMember/);
    assert.match(circlePageSource, /onInvite=\{\(\) =>/);
    assert.match(circlePageSource, /onRoleChange=\{async \(member, newRole\) =>/);
    assert.match(circlePageSource, /onRemoveMember=\{async \(member\) =>/);
  });

  it('keeps invite, role change, and removal APIs available in the client layer', () => {
    assert.match(membershipClientSource, /export async function createCircleInvite/);
    assert.match(membershipClientSource, /export async function updateCircleMemberRole/);
    assert.match(membershipClientSource, /export async function removeCircleMember/);
  });
});
