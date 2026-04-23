import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isMissingOnchainIdentityUpdateError,
  normalizeProfileUpdateError,
} from '../src/lib/profile/updateIdentityError.ts';

test('normalizes missing on-chain identity account errors into recovery guidance', () => {
  const raw = 'AnchorError caused by account: user_identity. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.';

  assert.equal(isMissingOnchainIdentityUpdateError(new Error(raw)), true);
  assert.equal(
    normalizeProfileUpdateError(new Error(raw)),
    '当前钱包还没有可编辑的链上身份，请先创建身份或刷新登录态后再试。',
  );
});

test('keeps existing user-facing profile save errors unchanged', () => {
  const raw = '当前钱包身份未就绪，无法提交链上资料更新。';

  assert.equal(isMissingOnchainIdentityUpdateError(new Error(raw)), false);
  assert.equal(normalizeProfileUpdateError(new Error(raw)), raw);
});
