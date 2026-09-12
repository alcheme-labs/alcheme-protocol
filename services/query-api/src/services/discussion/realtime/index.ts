// Single Plaza discussion realtime boundary. SSE and WebSocket are transports,
// not separate product chains.
export {
    buildDiscussionRealtimeChannel,
    normalizeDiscussionRealtimePayload,
    parseDiscussionRealtimePayload,
    type DiscussionRealtimePayload,
    type DiscussionRealtimeReason,
} from './protocol';
export {
    publishDiscussionRealtimeEvent,
} from './publisher';
export {
    findDiscussionMessagesAfterLamport,
    mapDiscussionReplayReason,
    type DiscussionReplayEventRow,
} from './replay';
export {
    serializeDiscussionRealtimeHeartbeat,
    serializeDiscussionRealtimeSseEvent,
} from './transports/sse';
export {
    addDiscussionRealtimeSink,
    DISCUSSION_REALTIME_MAX_BUFFERED_BYTES,
    DISCUSSION_REALTIME_MAX_QUEUED_EVENTS,
    getDiscussionRealtimeHubStats,
    removeDiscussionRealtimeSink,
    shutdownDiscussionRealtimeHub,
    type RealtimeSocketSink,
} from './hub';
export {
    setupDiscussionRealtimeWebSocket,
    shutdownDiscussionRealtimeWebSocket,
} from './transports/websocket';
