import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getCreateCircleSignerUnavailableError,
  settleCreateCirclePostCreateSync,
  waitForCircleReadModelVisibility,
} from '../src/lib/circles/createCircleFlow.ts';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
const hookPath = path.join(frontendRoot, 'src/hooks/useCreateCircle.ts');

function read(targetPath) {
  assert.equal(fs.existsSync(targetPath), true, `missing file: ${targetPath}`);
  return fs.readFileSync(targetPath, 'utf8');
}

test('create-circle signing preflight returns a clear error when message signing is unavailable', () => {
  assert.equal(
    getCreateCircleSignerUnavailableError(undefined),
    '当前钱包不支持消息签名，无法完成圈层配置保存。请切换支持消息签名的钱包后再创建。',
  );
  assert.equal(
    getCreateCircleSignerUnavailableError(async () => new Uint8Array([1])),
    null,
  );
});

test('waitForCircleReadModelVisibility retries through 404 until the circle becomes visible', async () => {
  let attempts = 0;
  const visible = await waitForCircleReadModelVisibility({
    circleId: 42,
    baseUrl: 'https://public.alcheme.test',
    pollMs: 1,
    timeoutMs: 20,
    fetchImpl: async (input) => {
      attempts += 1;
      if (attempts < 3) {
        return {
          ok: false,
          status: 404,
        };
      }
      return {
        ok: true,
        status: 200,
      };
    },
  });

  assert.equal(visible, true);
  assert.equal(attempts, 3);
});

test('waitForCircleReadModelVisibility returns false when the circle never appears before timeout', async () => {
  let attempts = 0;
  const visible = await waitForCircleReadModelVisibility({
    circleId: 99,
    baseUrl: 'https://public.alcheme.test',
    pollMs: 1,
    timeoutMs: 5,
    fetchImpl: async () => {
      attempts += 1;
      return {
        ok: false,
        status: 404,
      };
    },
  });

  assert.equal(visible, false);
  assert.ok(attempts >= 1);
});

test('settleCreateCirclePostCreateSync returns timeout when post-create signing never resolves', async () => {
  const startedAt = Date.now();
  const result = await settleCreateCirclePostCreateSync(
    () => new Promise(() => {}),
    { timeoutMs: 5 },
  );

  assert.deepEqual(result, { status: 'timeout' });
  assert.ok(Date.now() - startedAt < 100);
});

test('settleCreateCirclePostCreateSync reports post-create sync failures before timeout', async () => {
  const expected = new Error('settings failed');
  const result = await settleCreateCirclePostCreateSync(
    async () => {
      throw expected;
    },
    { timeoutMs: 100 },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.error, expected);
});

test('useCreateCircle gates partial creation on message signing and waits for circle read-model visibility', () => {
  const source = read(hookPath);

  assert.match(source, /getCreateCircleSignerUnavailableError/);
  assert.match(source, /settleCreateCirclePostCreateSync/);
  assert.match(source, /waitForCircleReadModelVisibility/);
});
