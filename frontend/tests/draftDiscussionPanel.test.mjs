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
    assert.match(panelSource, /targetTypeOptions[\s\S]*value:\s*'paragraph'[\s\S]*formatTargetType\('paragraph'\)/);
    assert.match(panelSource, /targetTypeOptions[\s\S]*value:\s*'structure'[\s\S]*formatTargetType\('structure'\)/);
    assert.match(panelSource, /targetTypeOptions[\s\S]*value:\s*'document'[\s\S]*formatTargetType\('document'\)/);
});

test('DraftDiscussionPanel blocks creation when target_ref is missing', () => {
    assert.match(panelSource, /if \(paragraphIndex === null\) \{/);
    assert.match(panelSource, /setInlineError\(t\('errors\.selectParagraph'\)\)/);
});

test('DraftDiscussionPanel paragraph mode uses paragraph selector and derived target_ref', () => {
    assert.match(panelSource, /targetType === 'paragraph'/);
    assert.match(panelSource, /id="draft-discussion-target-paragraph"/);
    assert.match(panelSource, /setTargetRef\(`paragraph:\$\{parsed\}`\)/);
    assert.match(panelSource, /t\('create\.paragraphSelectHint'\)/);
});

test('DraftDiscussionPanel uses custom mobile-safe listboxes for rendered dropdowns', () => {
    assert.match(panelSource, /function DraftSelect/);
    assert.match(panelSource, /role="listbox"/);
    assert.match(panelSource, /role="option"/);
    assert.match(panelSource, /<DraftSelect\s+id="draft-discussion-target-type"/);
    assert.match(panelSource, /<DraftSelect\s+id="draft-discussion-issue-type"/);
    assert.match(panelSource, /<DraftSelect\s+id="draft-discussion-target-paragraph"/);
    assert.match(panelSource, /<DraftSelect\s+id=\{`thread-issue-type-\$\{thread\.id\}`\}/);
});

test('DraftDiscussionPanel only allows legal lifecycle transitions in UI handlers', () => {
    assert.match(panelSource, /if \(thread\.state !== 'open'\) return;/);
    assert.match(panelSource, /if \(thread\.state !== 'proposed'\) return;/);
    assert.match(panelSource, /if \(thread\.state !== 'accepted'\) return;/);
});

test('DraftDiscussionPanel renders applied evidence and hides manual proof inputs', () => {
    assert.match(panelSource, /t\('threads\.evidence\.snapshotHash',\s*\{hash:\s*thread\.latestApplication\.appliedSnapshotHash\}\)/);
    assert.match(panelSource, /t\('threads\.evidence\.draftVersion',\s*\{version:\s*thread\.latestApplication\.appliedDraftVersion\}\)/);
    assert.match(panelSource, /t\('threads\.actions\.apply'\)/);
    assert.doesNotMatch(panelSource, /placeholder="applied_edit_anchor_id"/);
    assert.doesNotMatch(panelSource, /placeholder="applied_snapshot_hash \(64 hex\)"/);
    assert.doesNotMatch(panelSource, /placeholder="applied_draft_version"/);
});

test('DraftDiscussionPanel keeps touch targets mobile-safe', () => {
    assert.match(panelStyles, /min-height:\s*44px/);
    assert.match(panelStyles, /\.selectTrigger\s*\{[\s\S]*?min-height:\s*48px/);
    assert.match(panelStyles, /\.selectMenu\s*\{[\s\S]*?max-height:\s*min\(288px,\s*46dvh\)/);
    assert.match(panelStyles, /\.selectOption\s*\{[\s\S]*?min-height:\s*44px/);
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
