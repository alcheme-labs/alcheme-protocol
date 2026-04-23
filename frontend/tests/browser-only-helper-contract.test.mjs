import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getBrowserOnlyMockUnsupportedError } from '../src/lib/testing/browserOnlyMockPolicy.ts';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');

function read(relativePath) {
    const targetPath = path.join(frontendRoot, relativePath);
    assert.equal(fs.existsSync(targetPath), true, `missing file: ${targetPath}`);
    return fs.readFileSync(targetPath, 'utf8');
}

test('browser-only mock mode returns explicit unsupported guidance for chain-dependent actions', () => {
    assert.equal(
        getBrowserOnlyMockUnsupportedError('identity_registration'),
        '当前浏览器 mock 钱包模式不支持注册链上身份，请使用真实钱包手动验证该流程。',
    );
    assert.equal(
        getBrowserOnlyMockUnsupportedError('create_circle'),
        '当前浏览器 mock 钱包模式不支持创建链上圈层，请使用真实钱包手动验证该流程。',
    );
    assert.equal(
        getBrowserOnlyMockUnsupportedError('join_circle'),
        '当前浏览器 mock 钱包模式不支持完成链上成员确认，请使用真实钱包手动验证该流程。',
    );
});

test('shipping frontend code no longer calls testing/e2e helper routes', () => {
    const registerIdentitySource = read('src/hooks/useRegisterIdentity.ts');
    const createCircleSource = read('src/hooks/useCreateCircle.ts');
    const membershipSource = read('src/lib/circles/membership.ts');

    assert.doesNotMatch(registerIdentitySource, /\/api\/v1\/testing\/e2e\/register-identity/);
    assert.doesNotMatch(createCircleSource, /\/api\/v1\/testing\/e2e\/create-circle/);
    assert.doesNotMatch(membershipSource, /\/api\/v1\/testing\/e2e\/finalize-membership/);
});
