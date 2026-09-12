import {
    normalizeDiscussionRealtimeEvent,
    normalizeDiscussionRealtimeReplayStatus,
    type DiscussionRealtimeEvent,
    type DiscussionRealtimeReplayStatus,
} from '../protocol.ts';
import type { DiscussionRealtimeTransport } from './sse.ts';

export interface DiscussionRealtimeWebSocket {
    close(): void;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    send(value: string): void;
}

export function startDiscussionRealtimeWebSocketTransport(input: {
    webSocketUrl: string;
    webSocketFactory?: (url: string) => DiscussionRealtimeWebSocket;
    onCloseAfterReady: () => void;
    onCloseBeforeReady: () => void;
    onEvent: (payload: DiscussionRealtimeEvent | null) => void;
    onReplayStatus?: (status: DiscussionRealtimeReplayStatus | null) => void;
    onReady: () => void;
}): DiscussionRealtimeTransport {
    const webSocketFactory = input.webSocketFactory ?? ((url: string) => new WebSocket(url));
    const socket = webSocketFactory(input.webSocketUrl);
    let closedByClient = false;
    let ready = false;
    let handledClose = false;

    const handleClose = () => {
        if (closedByClient || handledClose) return;
        handledClose = true;
        if (ready) {
            input.onCloseAfterReady();
        } else {
            input.onCloseBeforeReady();
        }
    };

    socket.onmessage = (event: { data: string }) => {
        try {
            const parsed = JSON.parse(event.data) as ({
                type?: unknown;
                payload?: Partial<DiscussionRealtimeEvent> | null;
            } & Partial<DiscussionRealtimeReplayStatus>) | null;
            if (!parsed || typeof parsed !== 'object') return;
            if (parsed.type === 'ready') {
                ready = true;
                input.onReady();
                return;
            }
            if (parsed.type === 'message_changed') {
                input.onEvent(normalizeDiscussionRealtimeEvent(parsed.payload ?? null));
                return;
            }
            if (parsed.type === 'replay_status') {
                input.onReplayStatus?.(normalizeDiscussionRealtimeReplayStatus(parsed));
            }
        } catch {
            input.onEvent(null);
        }
    };
    socket.onclose = handleClose;
    socket.onerror = handleClose;

    return {
        close() {
            closedByClient = true;
            socket.close();
        },
    };
}
