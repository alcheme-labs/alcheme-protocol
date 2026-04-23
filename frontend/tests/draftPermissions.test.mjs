import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveDraftPermissions } from '../src/lib/circle/draftPermissions.ts';

test('visitor and non-member cannot comment, edit, or crystallize drafts', () => {
    assert.deepEqual(deriveDraftPermissions(null), {
        canComment: false,
        canEdit: false,
        canCrystallize: false,
    });

    assert.deepEqual(
        deriveDraftPermissions({
            role: 'Member',
            status: 'Left',
            identityLevel: 'Member',
        }),
        {
            canComment: false,
            canEdit: false,
            canCrystallize: false,
        },
    );
});

test('initiate can comment but cannot edit or crystallize', () => {
    assert.deepEqual(
        deriveDraftPermissions({
            role: 'Member',
            status: 'Active',
            identityLevel: 'Initiate',
        }),
        {
            canComment: true,
            canEdit: false,
            canCrystallize: false,
        },
    );
});

test('member can comment and edit but cannot crystallize', () => {
    assert.deepEqual(
        deriveDraftPermissions({
            role: 'Member',
            status: 'Active',
            identityLevel: 'Member',
        }),
        {
            canComment: true,
            canEdit: true,
            canCrystallize: false,
        },
    );
});

test('owner, admin, and moderator can comment, edit, and crystallize', () => {
    for (const role of ['Owner', 'Admin', 'Moderator']) {
        assert.deepEqual(
            deriveDraftPermissions({
                role,
                status: 'Active',
                identityLevel: 'Visitor',
            }),
            {
                canComment: true,
                canEdit: true,
                canCrystallize: true,
            },
        );
    }
});
