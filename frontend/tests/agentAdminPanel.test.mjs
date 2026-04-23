import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const agentAdminPanelSource = readFileSync(
    new URL('../src/features/agents/AgentAdminPanel.tsx', import.meta.url),
    'utf8',
);
const settingsSheetSource = readFileSync(
    new URL('../src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx', import.meta.url),
    'utf8',
);
const circlePageSource = readFileSync(
    new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
    'utf8',
);

test('AgentAdminPanel exposes trigger scope, discount, and review controls', () => {
    assert.match(agentAdminPanelSource, /触发范围/);
    assert.match(agentAdminPanelSource, /折扣/);
    assert.match(agentAdminPanelSource, /审核门槛/);
});

test('CircleSettingsSheet mounts AgentAdminPanel inside the real settings surface', () => {
    assert.match(settingsSheetSource, /AgentAdminPanel/);
    assert.match(settingsSheetSource, /agentPolicy/);
    assert.match(settingsSheetSource, /agents=/);
});

test('circle detail page wires the agent admin state into CircleSettingsSheet', () => {
    assert.match(circlePageSource, /fetchCircleAgents/);
    assert.match(circlePageSource, /updateCircleAgentPolicy/);
    assert.match(circlePageSource, /agentPolicy=/);
});
