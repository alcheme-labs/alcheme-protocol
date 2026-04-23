import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panelSource = readFileSync(
    new URL('../src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx', import.meta.url),
    'utf8',
);
const panelStyles = readFileSync(
    new URL('../src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.module.css', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('DraftDiscussionPanel create form exposes paragraph/structure/document targets', () => {
    assert.match(panelSource, /<option value="paragraph">\{formatDraftDiscussionTargetType\('paragraph'\)\}<\/option>/);
    assert.match(panelSource, /<option value="structure">\{formatDraftDiscussionTargetType\('structure'\)\}<\/option>/);
    assert.match(panelSource, /<option value="document">\{formatDraftDiscussionTargetType\('document'\)\}<\/option>/);
});

test('DraftDiscussionPanel blocks creation when target_ref is missing', () => {
    assert.match(panelSource, /if \(paragraphIndex === null\) \{/);
    assert.match(panelSource, /请先在编辑器中点选段落，或在下拉框里选择目标段落。/);
});

test('DraftDiscussionPanel paragraph mode uses paragraph selector and derived target_ref', () => {
    assert.match(panelSource, /targetType === 'paragraph'/);
    assert.match(panelSource, /id="draft-discussion-target-paragraph"/);
    assert.match(panelSource, /setTargetRef\(`paragraph:\$\{parsed\}`\)/);
    assert.match(panelSource, /请先在编辑器中点选段落，或在下拉框里选择目标段落/);
});

test('DraftDiscussionPanel only allows legal lifecycle transitions in UI handlers', () => {
    assert.match(panelSource, /if \(thread\.state !== 'open'\) return;/);
    assert.match(panelSource, /if \(thread\.state !== 'proposed'\) return;/);
    assert.match(panelSource, /if \(thread\.state !== 'accepted'\) return;/);
});

test('DraftDiscussionPanel renders applied evidence and hides manual proof inputs', () => {
    assert.match(panelSource, /快照哈希：\{thread\.latestApplication\.appliedSnapshotHash\}/);
    assert.match(panelSource, /草稿版本：\{thread\.latestApplication\.appliedDraftVersion\}/);
    assert.match(panelSource, /解决并写入正文/);
    assert.doesNotMatch(panelSource, /placeholder="applied_edit_anchor_id"/);
    assert.doesNotMatch(panelSource, /placeholder="applied_snapshot_hash \(64 hex\)"/);
    assert.doesNotMatch(panelSource, /placeholder="applied_draft_version"/);
});

test('DraftDiscussionPanel keeps touch targets mobile-safe', () => {
    assert.match(panelStyles, /min-height:\s*44px/);
});

test('CrucibleTab mounts DraftDiscussionPanel and wires lifecycle actions', () => {
    assert.match(crucibleTabSource, /<DraftDiscussionPanel/);
    assert.match(crucibleTabSource, /onCreate=\{handleCreateDiscussion\}/);
    assert.match(crucibleTabSource, /onPropose=\{handleProposeDiscussion\}/);
    assert.match(crucibleTabSource, /onResolve=\{handleResolveDiscussion\}/);
    assert.match(crucibleTabSource, /onApply=\{handleApplyDiscussion\}/);
    assert.match(crucibleTabSource, /paragraphOptions=\{paragraphOptions\}/);
    assert.match(crucibleTabSource, /selectedParagraphIndex=\{selectedParagraphIndex\}/);
    assert.match(crucibleTabSource, /onSelectParagraph=\{setSelectedParagraphIndex\}/);
});
