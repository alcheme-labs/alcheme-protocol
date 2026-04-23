import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveTemporaryGrantControls } from '../src/components/circle/CrucibleEditor/temporaryGrantControls.ts';

const crucibleEditorSource = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
    'utf8',
);

test('manager-visible requested grants still expose an issue action even when the paragraph is directly editable', () => {
    const controls = resolveTemporaryGrantControls({
        blockId: 'paragraph:1',
        temporaryEditGrants: [
            {
                grantId: 'grant-requested',
                blockId: 'paragraph:1',
                granteeUserId: 42,
                status: 'requested',
                expiresAt: null,
            },
        ],
        viewerUserId: 9,
        baseCanEditParagraph: true,
        canRequestTemporaryEditGrant: false,
        canManageTemporaryEditGrants: true,
        hasError: false,
    });

    assert.equal(controls.showPanel, true);
    assert.equal(controls.canIssue, true);
    assert.equal(controls.canRevoke, false);
    assert.equal(controls.canRequest, false);
});

test('manager-visible active grants still expose a revoke action even when the paragraph is directly editable', () => {
    const controls = resolveTemporaryGrantControls({
        blockId: 'paragraph:1',
        temporaryEditGrants: [
            {
                grantId: 'grant-active',
                blockId: 'paragraph:1',
                granteeUserId: 42,
                status: 'active',
                expiresAt: '2026-04-14T12:00:00.000Z',
            },
        ],
        viewerUserId: 9,
        baseCanEditParagraph: true,
        canRequestTemporaryEditGrant: false,
        canManageTemporaryEditGrants: true,
        hasError: false,
    });

    assert.equal(controls.showPanel, true);
    assert.equal(controls.canIssue, false);
    assert.equal(controls.canRevoke, true);
    assert.equal(controls.canRequest, false);
});

test('english copy uses the browser-case action label for issuing temporary access', () => {
    const messages = JSON.parse(readFileSync(
        new URL('../src/i18n/messages/en.json', import.meta.url),
        'utf8',
    ));

    assert.equal(
        messages.CrucibleEditor.actions.issueTemporaryGrant,
        'Issue temporary access',
    );
});

test('CrucibleEditor renders temporary grant controls from resolved panel state instead of only the read-only branch', () => {
    assert.match(crucibleEditorSource, /grantControls\.showPanel/);
    assert.match(crucibleEditorSource, /grantControls\.canIssue && grantControls\.requestedGrant/);
    assert.match(crucibleEditorSource, /grantControls\.canRevoke && grantControls\.activeGrant/);
    assert.doesNotMatch(crucibleEditorSource, /!\s*isEditableParagraph\s*&&\s*\(\s*<div className=\{styles\.issueCarryPanel\}>/);
});
