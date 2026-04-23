import { describe, expect, test } from '@jest/globals';

import {
    canForwardDiscussionMessage,
    isSameCircleTree,
    isStrictUpwardForwardAllowed,
    type ForwardingCircleNode,
} from '../forwardingPolicy';

function circle(overrides: Partial<ForwardingCircleNode>): ForwardingCircleNode {
    return {
        id: 1,
        parentCircleId: null,
        level: 0,
        rootCircleId: 1,
        ...overrides,
    };
}

describe('forwarding policy helpers', () => {
    test('allows only strict upward forwarding within the same tree', () => {
        const source = circle({ id: 11, rootCircleId: 1, level: 0, parentCircleId: null });
        const target = circle({ id: 12, rootCircleId: 1, level: 1, parentCircleId: 11 });

        expect(isSameCircleTree(source, target)).toBe(true);
        expect(isStrictUpwardForwardAllowed(source, target)).toBe(true);
        expect(canForwardDiscussionMessage({
            sourceCircle: source,
            targetCircle: target,
            sourceMessageKind: 'plain',
        }).allowed).toBe(true);
    });

    test('rejects same-level forwarding', () => {
        const source = circle({ id: 21, rootCircleId: 2, level: 1, parentCircleId: 20 });
        const target = circle({ id: 22, rootCircleId: 2, level: 1, parentCircleId: 20 });

        expect(isStrictUpwardForwardAllowed(source, target)).toBe(false);
        expect(canForwardDiscussionMessage({
            sourceCircle: source,
            targetCircle: target,
            sourceMessageKind: 'plain',
        })).toMatchObject({
            allowed: false,
            reason: 'same_or_lower_level',
        });
    });

    test('rejects downward forwarding', () => {
        const source = circle({ id: 31, rootCircleId: 3, level: 2, parentCircleId: 30 });
        const target = circle({ id: 30, rootCircleId: 3, level: 1, parentCircleId: 3 });

        expect(isStrictUpwardForwardAllowed(source, target)).toBe(false);
        expect(canForwardDiscussionMessage({
            sourceCircle: source,
            targetCircle: target,
            sourceMessageKind: 'plain',
        })).toMatchObject({
            allowed: false,
            reason: 'same_or_lower_level',
        });
    });

    test('rejects circles outside the same tree', () => {
        const source = circle({ id: 41, rootCircleId: 4, level: 0 });
        const target = circle({ id: 51, rootCircleId: 5, level: 1, parentCircleId: 50 });

        expect(isSameCircleTree(source, target)).toBe(false);
        expect(canForwardDiscussionMessage({
            sourceCircle: source,
            targetCircle: target,
            sourceMessageKind: 'plain',
        })).toMatchObject({
            allowed: false,
            reason: 'different_tree',
        });
    });

    test('rejects already-forwarded cards', () => {
        const source = circle({ id: 61, rootCircleId: 6, level: 0 });
        const target = circle({ id: 62, rootCircleId: 6, level: 2, parentCircleId: 61 });

        expect(canForwardDiscussionMessage({
            sourceCircle: source,
            targetCircle: target,
            sourceMessageKind: 'forward',
        })).toMatchObject({
            allowed: false,
            reason: 'forward_of_forward_not_allowed',
        });
    });

    test('rejects ephemeral source messages', () => {
        const source = circle({ id: 71, rootCircleId: 7, level: 0 });
        const target = circle({ id: 72, rootCircleId: 7, level: 1, parentCircleId: 71 });

        expect(canForwardDiscussionMessage({
            sourceCircle: source,
            targetCircle: target,
            sourceMessageKind: 'plain',
            sourceIsEphemeral: true,
        })).toMatchObject({
            allowed: false,
            reason: 'ephemeral_not_forwardable',
        });
    });
});
