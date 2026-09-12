import type { DiscussionRealtimePayload } from '../protocol';

export function serializeDiscussionRealtimeSseEvent(event: DiscussionRealtimePayload): string {
    return `event: message_changed\ndata: ${JSON.stringify(event)}\n\n`;
}

export function serializeDiscussionRealtimeHeartbeat(): string {
    return ': keepalive\n\n';
}
