import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(
    new URL('../src/components/knowledge/KnowledgeCitationPanel/KnowledgeCitationPanel.tsx', import.meta.url),
    'utf8',
);
const zhMessages = readFileSync(
    new URL('../src/i18n/messages/zh.json', import.meta.url),
    'utf8',
);
const enMessages = readFileSync(
    new URL('../src/i18n/messages/en.json', import.meta.url),
    'utf8',
);

test('KnowledgeCitationPanel copy is framed as post-crystallization citation management', () => {
    assert.match(panelSource, /useI18n\('KnowledgeCitationPanel'\)/);
    assert.match(zhMessages, /已结晶/);
    assert.match(zhMessages, /补充|管理/);
    assert.match(enMessages, /already crystallized/);
    assert.match(enMessages, /manage|supplement/);
});
