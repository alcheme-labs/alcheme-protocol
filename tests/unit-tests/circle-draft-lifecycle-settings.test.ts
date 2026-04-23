import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Circle draft lifecycle settings entry points', () => {
  const createSheetSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx'),
    'utf8',
  );
  const settingsSheetSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx'),
    'utf8',
  );
  const createHookSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/hooks/useCreateCircle.ts'),
    'utf8',
  );
  const policySource = readFileSync(
    resolve(process.cwd(), 'frontend/src/lib/circles/policyProfile.ts'),
    'utf8',
  );

  it('exposes draft lifecycle controls in the create circle sheet', () => {
    assert.match(createSheetSource, /草稿与审阅/);
    assert.match(createSheetSource, /进入审阅方式/);
    assert.match(createSheetSource, /自动进入审阅时间/);
    assert.match(createSheetSource, /审阅阶段时长/);
    assert.match(createSheetSource, /最多修订轮次/);
  });

  it('exposes draft lifecycle controls in the circle settings sheet', () => {
    assert.match(settingsSheetSource, /草稿流程设置/);
    assert.match(settingsSheetSource, /进入审阅方式/);
    assert.match(settingsSheetSource, /自动进入审阅时间/);
    assert.match(settingsSheetSource, /审阅阶段时长/);
    assert.match(settingsSheetSource, /最多修订轮次/);
  });

  it('also exposes draft workflow policy controls in the product surfaces', () => {
    assert.match(createSheetSource, /问题单与阶段权限/);
    assert.match(createSheetSource, /谁可提交问题单/);
    assert.match(createSheetSource, /谁可结束编辑/);
    assert.match(createSheetSource, /谁可发起结晶/);
    assert.match(settingsSheetSource, /问题单与阶段权限/);
    assert.match(settingsSheetSource, /谁可提交问题单/);
    assert.match(settingsSheetSource, /谁可结束本轮审阅/);
    assert.match(settingsSheetSource, /提交者在审议前可撤回/);
  });

  it('wires draft workflow policy through create and update requests', () => {
    assert.match(createHookSource, /draftWorkflowPolicy\?: CircleDraftWorkflowPolicy/);
    assert.match(createHookSource, /updateCircleDraftWorkflowPolicy/);
    assert.match(createHookSource, /syncCircleDraftWorkflowPolicyWithRetry/);
    assert.match(policySource, /export async function updateCircleDraftWorkflowPolicy/);
  });
});
