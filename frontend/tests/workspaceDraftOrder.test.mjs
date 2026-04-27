import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { prioritizeWorkspaceDrafts } from '../src/lib/circle/workspaceDraftOrder.ts';

const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('prioritizeWorkspaceDrafts moves drafting drafts to the front while preserving relative order', () => {
    const ordered = prioritizeWorkspaceDrafts(
        [
            { id: 11, title: 'review draft' },
            { id: 12, title: 'drafting draft' },
            { id: 13, title: 'archived draft' },
            { id: 14, title: 'second drafting draft' },
        ],
        {
            11: 'review',
            12: 'drafting',
            13: 'archived',
            14: 'drafting',
        },
    );

    assert.deepEqual(
        ordered.map((draft) => draft.id),
        [12, 14, 11, 13],
    );
});

test('prioritizeWorkspaceDrafts leaves the original order intact when no drafting status is known', () => {
    const ordered = prioritizeWorkspaceDrafts(
        [
            { id: 21 },
            { id: 22 },
            { id: 23 },
        ],
        {
            21: null,
            22: 'review',
        },
    );

    assert.deepEqual(
        ordered.map((draft) => draft.id),
        [21, 22, 23],
    );
});

test('CrucibleTab probes draft lifecycle status and prefers drafting drafts in the list order', () => {
    assert.match(crucibleTabSource, /const effectiveDraftWorkspaceStatuses = useMemo/);
    assert.match(crucibleTabSource, /next\[draft\.id\] = draft\.documentStatus/);
    assert.match(crucibleTabSource, /const orderedDrafts = useMemo\(\s*\(\) => prioritizeWorkspaceDrafts\(drafts, effectiveDraftWorkspaceStatuses\)/);
    assert.match(crucibleTabSource, /const draftsMissingGraphqlStatus = drafts\.filter/);
    assert.match(crucibleTabSource, /for \(const draft of draftsMissingGraphqlStatus\)/);
    assert.doesNotMatch(crucibleTabSource, /for \(const draft of drafts\)[\s\S]{0,240}fetchDraftLifecycle/);
    assert.match(crucibleTabSource, /orderedDrafts\.map\(\(draft, i\) => \(/);
    assert.match(crucibleTabSource, /setDraftWorkspaceStatuses\(\(current\) => \{/);
    assert.match(crucibleTabSource, /\[selectedDraftPostId\]: draftLifecycle\.documentStatus/);
});
