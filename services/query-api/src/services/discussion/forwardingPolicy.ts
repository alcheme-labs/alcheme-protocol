import { isDiscussionForwardProjectionMessageKind } from './discussionMessageKinds';

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
        | 'deleted_not_forwardable'
        | 'empty_source_not_forwardable'
        | 'same_or_lower_level'
        | 'different_tree'
        | 'forward_of_forward_not_allowed'
        | 'unsupported_source_kind';
}

const NON_FORWARDABLE_DISCUSSION_MESSAGE_KINDS = new Set([
    'draft_candidate_notice',
    'governance_notice',
    'announcement_notice',
    'source_material_notice',
    'interaction_result_notice',
]);

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
    sourceIsDeleted?: boolean | null | undefined;
    sourcePayloadText?: string | null | undefined;
}): ForwardingDecision {
    if (input.sourceIsEphemeral) {
        return {
            allowed: false,
            reason: 'ephemeral_not_forwardable',
        };
    }

    if (input.sourceIsDeleted) {
        return {
            allowed: false,
            reason: 'deleted_not_forwardable',
        };
    }

    if (input.sourcePayloadText !== undefined && !String(input.sourcePayloadText || '').trim()) {
        return {
            allowed: false,
            reason: 'empty_source_not_forwardable',
        };
    }

    if (isDiscussionForwardProjectionMessageKind(input.sourceMessageKind)) {
        return {
            allowed: false,
            reason: 'forward_of_forward_not_allowed',
        };
    }

    const normalizedKind = String(input.sourceMessageKind || '').trim().toLowerCase();
    if (NON_FORWARDABLE_DISCUSSION_MESSAGE_KINDS.has(normalizedKind)) {
        return {
            allowed: false,
            reason: 'unsupported_source_kind',
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
