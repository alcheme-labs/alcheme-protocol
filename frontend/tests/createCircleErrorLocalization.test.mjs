import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hookSource = readFileSync(
  new URL('../src/hooks/useCreateCircle.ts', import.meta.url),
  'utf8',
);

const enMessages = readFileSync(
  new URL('../src/i18n/messages/en.json', import.meta.url),
  'utf8',
);

const zhMessages = readFileSync(
  new URL('../src/i18n/messages/zh.json', import.meta.url),
  'utf8',
);

test('useCreateCircle routes normalized error copy through i18n keys instead of hardcoded Chinese strings', () => {
  assert.match(hookSource, /normalizeCreateCircleError\((err|error),\s*t\)/);
  assert.match(hookSource, /t\('errors\.walletNotConnected'\)/);
  assert.match(hookSource, /t\('errors\.simulationFailed'\)/);
  assert.doesNotMatch(hookSource, /交易模拟失败。请确认钱包网络与当前 RPC 一致/);
  assert.doesNotMatch(hookSource, /请先连接钱包再创建圈层。/);
});

test('CreateCircleFlow locale bundles define the normalized circle creation errors', () => {
  for (const source of [enMessages, zhMessages]) {
    assert.match(source, /"walletNotConnected":/);
    assert.match(source, /"simulationFailed":/);
    assert.match(source, /"circleProgramMissing":/);
    assert.match(source, /"circleManagerMissing":/);
    assert.match(source, /"eventProgramMissing":/);
    assert.match(source, /"eventEmitterMissing":/);
    assert.match(source, /"genericFailure":/);
  }
});
