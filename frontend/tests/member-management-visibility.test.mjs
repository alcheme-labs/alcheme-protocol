import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildInvitableUsers,
    resolveCircleSettingsActionFlags,
    resolveInviteSourceCircleId,
} from '../src/lib/circle/memberManagement.ts';

test('auxiliary invite flow resolves the parent circle as the member source', () => {
    assert.equal(resolveInviteSourceCircleId({
        targetCircleId: 126,
        targetKind: 'auxiliary',
        targetParentCircleId: 110,
    }), 110);

    assert.equal(resolveInviteSourceCircleId({
        targetCircleId: 110,
        targetKind: 'main',
        targetParentCircleId: 126,
    }), 110);
});

test('invitable users are built from active source members and mark already-in targets', () => {
    const users = buildInvitableUsers({
        sourceMembers: [
            {
                user: { id: 1, handle: 'owner', displayName: 'Owner', pubkey: 'owner-pubkey' },
                role: 'Owner',
                status: 'Active',
            },
            {
                user: { id: 2, handle: 'candidate', displayName: 'Candidate', pubkey: 'candidate-pubkey' },
                role: 'Member',
                status: 'Active',
            },
            {
                user: { id: 3, handle: 'already-in', displayName: 'Already In', pubkey: 'already-pubkey' },
                role: 'Moderator',
                status: 'Active',
            },
            {
                user: { id: 4, handle: 'left-user', displayName: 'Left User', pubkey: 'left-pubkey' },
                role: 'Member',
                status: 'Left',
            },
        ],
        targetMembers: [
            {
                user: { id: 3, handle: 'already-in', displayName: 'Already In', pubkey: 'already-pubkey' },
                role: 'Member',
                status: 'Active',
            },
        ],
    });

    assert.deepEqual(users, [
        {
            userId: 3,
            handle: 'already-in',
            name: 'Already In',
            role: 'curator',
            alreadyIn: true,
        },
        {
            userId: 2,
            handle: 'candidate',
            name: 'Candidate',
            role: 'member',
            alreadyIn: false,
        },
        {
            userId: 1,
            handle: 'owner',
            name: 'Owner',
            role: 'member',
            alreadyIn: false,
        },
    ]);
});

test('circle settings action flags expose invite for managers and leave for non-owner members', () => {
    assert.deepEqual(resolveCircleSettingsActionFlags('owner'), {
        canManageRoles: true,
        canInvite: true,
        canLeave: false,
    });
    assert.deepEqual(resolveCircleSettingsActionFlags('curator'), {
        canManageRoles: false,
        canInvite: true,
        canLeave: true,
    });
    assert.deepEqual(resolveCircleSettingsActionFlags('member'), {
        canManageRoles: false,
        canInvite: false,
        canLeave: true,
    });
});
