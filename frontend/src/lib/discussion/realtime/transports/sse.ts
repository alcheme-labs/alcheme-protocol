import {
    parseDiscussionRealtimeEvent,
    type DiscussionRealtimeEvent,
} from '../protocol.ts';

export interface DiscussionRealtimeEventSource {
    addEventListener(type: string, listener: (event: { data: string }) => void): void;
    close(): void;
    onopen: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
}

export interface DiscussionRealtimeTransport {
    close(): void;
}

export function startDiscussionRealtimeSseTransport(input: {
    streamUrl: string;
    eventSourceFactory?: (url: string, init?: { withCredentials?: boolean }) => DiscussionRealtimeEventSource;
    onDisconnect: () => void;
    onEvent: (payload: DiscussionRealtimeEvent | null) => void;
    onOpen: () => void;
}): DiscussionRealtimeTransport {
    const eventSourceFactory = input.eventSourceFactory
        ?? ((url: string, init?: { withCredentials?: boolean }) => new EventSource(url, init));
    const source = eventSourceFactory(input.streamUrl, { withCredentials: true });

    source.addEventListener('message_changed', (event) => {
        input.onEvent(parseDiscussionRealtimeEvent(event.data));
    });
    source.onopen = () => {
        input.onOpen();
    };
    source.onerror = () => {
        input.onDisconnect();
    };

    return {
        close() {
            source.close();
        },
    };
}
