import test from 'node:test';
import assert from 'node:assert/strict';

import { getGovernedForwardTargets, getPlazaForwardAction } from '../src/lib/circle/plazaForwarding.ts';

test('forward targets only include stricly deeper circles', () => {
    const targets = getGovernedForwardTargets({
        currentLevel: 0,
        currentSubCircleId: '1',
        circles: [
            { groupId: 1, groupName: 'Root', subCircleId: '1', subCircleName: 'Lv0', level: 0, accessRequirement: { type: 'free' } },
            { groupId: 1, groupName: 'Root', subCircleId: '2', subCircleName: 'Lv1', level: 1, accessRequirement: { type: 'free' } },
            { groupId: 1, groupName: 'Root', subCircleId: '3', subCircleName: 'Lv2', level: 2, accessRequirement: { type: 'free' } },
        ],
    });

    assert.deepEqual(targets.map((item) => item.subCircleId), ['2', '3']);
});

test('forward action is disabled for forwarded cards', () => {
    const action = getPlazaForwardAction({
        viewerJoined: true,
        envelopeId: 'env-forward-1',
        messageKind: 'forward',
        deleted: false,
        availableTargetCount: 2,
    });

    assert.equal(action.enabled, false);
    assert.equal(action.labelKey, 'actions.forward');
    assert.equal(action.reasonKey, 'forwardCard');
});

test('forward action is disabled for ephemeral messages', () => {
    const action = getPlazaForwardAction({
        viewerJoined: true,
        envelopeId: 'env-ephemeral-1',
        messageKind: 'plain',
        ephemeral: true,
        deleted: false,
        availableTargetCount: 2,
    });

    assert.equal(action.enabled, false);
    assert.equal(action.reasonKey, 'ephemeral');
});

test('forward action is enabled for a plain joined message with eligible targets', () => {
    const action = getPlazaForwardAction({
        viewerJoined: true,
        envelopeId: 'env-source-1',
        messageKind: 'plain',
        deleted: false,
        availableTargetCount: 1,
    });

    assert.equal(action.enabled, true);
    assert.equal(action.labelKey, 'actions.forward');
    assert.equal(action.reasonKey, null);
});
