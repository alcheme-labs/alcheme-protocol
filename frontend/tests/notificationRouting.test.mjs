import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCircleTabHref,
    resolveNotificationHref,
} from '../src/lib/notifications/routing.ts';

test('buildCircleTabHref adds focus envelope when provided', () => {
    assert.equal(
        buildCircleTabHref(12, 'plaza', 'env_forward_target_1'),
        '/circles/12?tab=plaza&focusEnvelopeId=env_forward_target_1',
    );
});

test('resolveNotificationHref routes forward notifications to focused plaza context', () => {
    assert.equal(
        resolveNotificationHref({
            type: 'forward',
            sourceType: 'discussion',
            sourceId: 'env_forward_target_1',
            circleId: 12,
        }),
        '/circles/12?tab=plaza&focusEnvelopeId=env_forward_target_1',
    );
});

test('resolveNotificationHref keeps citation target extraction intact', () => {
    assert.equal(
        resolveNotificationHref({
            type: 'citation',
            sourceType: 'knowledge',
            sourceId: 'ref:kn_source_11:kn_target_42',
            circleId: 7,
        }),
        '/knowledge/kn_target_42',
    );
});
