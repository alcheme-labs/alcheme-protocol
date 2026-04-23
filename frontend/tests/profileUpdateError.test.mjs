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
    'This wallet does not have an editable on-chain identity yet. Create one or refresh your session and try again.',
  );
});

test('keeps existing user-facing profile save errors unchanged', () => {
  const raw = '当前钱包身份未就绪，无法提交链上资料更新。';

  assert.equal(isMissingOnchainIdentityUpdateError(new Error(raw)), false);
  assert.equal(normalizeProfileUpdateError(new Error(raw)), raw);
});
