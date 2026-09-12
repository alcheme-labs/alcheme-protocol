export const DISCUSSION_FORWARD_PROJECTION_MESSAGE_KINDS = [
    'forward',
    'forward_bundle',
] as const;

export type DiscussionForwardProjectionMessageKind =
    typeof DISCUSSION_FORWARD_PROJECTION_MESSAGE_KINDS[number];

export function normalizeDiscussionMessageKind(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

export function isDiscussionForwardProjectionMessageKind(
    value: unknown,
): value is DiscussionForwardProjectionMessageKind {
    return DISCUSSION_FORWARD_PROJECTION_MESSAGE_KINDS.includes(
        normalizeDiscussionMessageKind(value) as DiscussionForwardProjectionMessageKind,
    );
}
