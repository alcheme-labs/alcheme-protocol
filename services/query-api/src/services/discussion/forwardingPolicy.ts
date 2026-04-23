export interface ForwardingCircleNode {
    id: number;
    parentCircleId: number | null;
    level: number;
    rootCircleId: number;
}

export interface ForwardingDecision {
    allowed: boolean;
    reason:
        | 'ok'
        | 'ephemeral_not_forwardable'
        | 'same_or_lower_level'
        | 'different_tree'
        | 'forward_of_forward_not_allowed';
}

export function isSameCircleTree(
    sourceCircle: ForwardingCircleNode,
    targetCircle: ForwardingCircleNode,
): boolean {
    return sourceCircle.rootCircleId === targetCircle.rootCircleId;
}

export function isStrictUpwardForwardAllowed(
    sourceCircle: ForwardingCircleNode,
    targetCircle: ForwardingCircleNode,
): boolean {
    return targetCircle.level > sourceCircle.level;
}

export function canForwardDiscussionMessage(input: {
    sourceCircle: ForwardingCircleNode;
    targetCircle: ForwardingCircleNode;
    sourceMessageKind: string | null | undefined;
    sourceIsEphemeral?: boolean | null | undefined;
}): ForwardingDecision {
    if (input.sourceIsEphemeral) {
        return {
            allowed: false,
            reason: 'ephemeral_not_forwardable',
        };
    }

    if (String(input.sourceMessageKind || '').trim().toLowerCase() === 'forward') {
        return {
            allowed: false,
            reason: 'forward_of_forward_not_allowed',
        };
    }

    if (!isSameCircleTree(input.sourceCircle, input.targetCircle)) {
        return {
            allowed: false,
            reason: 'different_tree',
        };
    }

    if (!isStrictUpwardForwardAllowed(input.sourceCircle, input.targetCircle)) {
        return {
            allowed: false,
            reason: 'same_or_lower_level',
        };
    }

    return {
        allowed: true,
        reason: 'ok',
    };
}
