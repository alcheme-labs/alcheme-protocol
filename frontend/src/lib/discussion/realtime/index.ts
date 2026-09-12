import {
    createDiscussionRealtimeEngine,
    type DiscussionRealtimeEngineInput,
    type DiscussionRealtimeSubscription,
} from './engine.ts';
import {
    resolveDiscussionRealtimeTransportMode,
    type DiscussionRealtimeTransportMode,
} from './config.ts';
import {
    startDiscussionRealtimeSseTransport,
    type DiscussionRealtimeEventSource,
    type DiscussionRealtimeTransport,
} from './transports/sse.ts';
import {
    startDiscussionRealtimeWebSocketTransport,
    type DiscussionRealtimeWebSocket,
} from './transports/websocket.ts';
import type { DiscussionRealtimeEvent } from './protocol.ts';

export type { DiscussionRealtimeEvent, DiscussionRealtimeReason } from './protocol.ts';
export type { DiscussionRealtimeSubscription } from './engine.ts';
export {
    computeCatchUpDelay,
    computeRealtimeFlushDelay,
    computeRealtimeReconcileDelay,
} from './engine.ts';

export interface SubscribeToCircleDiscussionRealtimeInput extends DiscussionRealtimeEngineInput {
    streamUrl: string;
    eventSourceFactory?: (url: string, init?: { withCredentials?: boolean }) => DiscussionRealtimeEventSource;
    webSocketFactory?: (url: string) => DiscussionRealtimeWebSocket;
    transportMode?: DiscussionRealtimeTransportMode;
}

function shouldLogDiscussionRealtimeProbe(): boolean {
    return (
        process.env.NODE_ENV === 'development'
        || process.env.NEXT_PUBLIC_DISCUSSION_REALTIME_PROBE === 'true'
    )
        && typeof console !== 'undefined'
        && typeof console.info === 'function';
}

function logDiscussionRealtimeProbe(
    circleId: number,
    event: string,
    details: Record<string, unknown> = {},
): void {
    if (!shouldLogDiscussionRealtimeProbe()) return;
    console.info('[discussion realtime]', {
        circleId,
        event,
        ...details,
    });
}

function buildStreamUrlWithAfterLamport(streamUrl: string, afterLamport: number): string {
    const url = new URL(streamUrl);
    url.searchParams.set('afterLamport', String(Math.max(0, Math.trunc(afterLamport))));
    return url.toString();
}

function buildWebSocketUrlFromStreamUrl(streamUrl: string, afterLamport: number): string {
    const url = new URL(buildStreamUrlWithAfterLamport(streamUrl, afterLamport));
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = url.pathname.replace(/\/stream$/, '/realtime');
    return url.toString();
}

export function subscribeToCircleDiscussionRealtime(
    input: SubscribeToCircleDiscussionRealtimeInput,
): DiscussionRealtimeSubscription {
    let closed = false;
    let transport: DiscussionRealtimeTransport | null = null;
    let activeTransport: 'websocket' | 'sse' =
        resolveDiscussionRealtimeTransportMode({ override: input.transportMode }) === 'sse'
            ? 'sse'
            : 'websocket';
    const logAppliedEvent = (
        event: DiscussionRealtimeEvent,
        timing: { receivedAt: string; appliedAt: string },
    ) => {
        input.onRealtimeEventApplied?.(event, timing);
        logDiscussionRealtimeProbe(input.circleId, 'message_applied', {
            transport: activeTransport,
            reason: event.reason,
            envelopeId: event.envelopeId,
            latestLamport: event.latestLamport,
            interactionId: event.interactionId ?? null,
            projectionVersion: event.projectionVersion ?? null,
            projectionCursor: event.projectionCursor ?? null,
            hasInteractionPayload: !!event.interaction,
            eventId: event.timing?.eventId ?? null,
            publishedAt: event.timing?.publishedAt ?? null,
            receivedAt: timing.receivedAt,
            appliedAt: timing.appliedAt,
            latencyMs: event.timing?.publishedAt
                ? Date.parse(timing.appliedAt) - Date.parse(event.timing.publishedAt)
                : null,
        });
    };
    const engine = createDiscussionRealtimeEngine({
        ...input,
        onRealtimeEventApplied: logAppliedEvent,
    });

    const closeTransport = () => {
        transport?.close();
        transport = null;
    };

    logDiscussionRealtimeProbe(input.circleId, 'subscribe', {
        requestedTransport: resolveDiscussionRealtimeTransportMode({ override: input.transportMode }),
        streamUrl: input.streamUrl,
    });

    const startSse = () => {
        closeTransport();
        activeTransport = 'sse';
        logDiscussionRealtimeProbe(input.circleId, 'sse_start', {
            url: input.streamUrl,
        });
        transport = startDiscussionRealtimeSseTransport({
            streamUrl: input.streamUrl,
            eventSourceFactory: input.eventSourceFactory,
            onDisconnect: () => {
                logDiscussionRealtimeProbe(input.circleId, 'sse_disconnect');
                engine.handleDisconnect();
            },
            onEvent: (payload) => {
                logDiscussionRealtimeProbe(input.circleId, 'sse_event', {
                    reason: payload?.reason ?? null,
                    envelopeId: payload?.envelopeId ?? null,
                    latestLamport: payload?.latestLamport ?? null,
                    interactionId: payload?.interactionId ?? null,
                    projectionVersion: payload?.projectionVersion ?? null,
                    projectionCursor: payload?.projectionCursor ?? null,
                    hasInteractionPayload: !!payload?.interaction,
                    hasMessagePayload: !!payload?.message,
                });
                engine.handleRealtimeEvent(payload);
            },
            onOpen: () => {
                logDiscussionRealtimeProbe(input.circleId, 'sse_open');
                engine.handleOpen();
            },
        });
    };

    const startWebSocket = () => {
        closeTransport();
        activeTransport = 'websocket';
        const webSocketUrl = buildWebSocketUrlFromStreamUrl(input.streamUrl, input.getLastLamport());
        logDiscussionRealtimeProbe(input.circleId, 'websocket_start', {
            url: webSocketUrl,
        });
        transport = startDiscussionRealtimeWebSocketTransport({
            webSocketUrl,
            webSocketFactory: input.webSocketFactory,
            onCloseAfterReady: () => {
                if (closed) return;
                logDiscussionRealtimeProbe(input.circleId, 'websocket_close_after_ready_reconnect');
                engine.handleDisconnect();
                startWebSocket();
            },
            onCloseBeforeReady: () => {
                if (closed) return;
                logDiscussionRealtimeProbe(input.circleId, 'websocket_close_before_ready_fallback_sse');
                startSse();
            },
            onEvent: (payload) => {
                logDiscussionRealtimeProbe(input.circleId, 'websocket_event', {
                    reason: payload?.reason ?? null,
                    envelopeId: payload?.envelopeId ?? null,
                    latestLamport: payload?.latestLamport ?? null,
                    interactionId: payload?.interactionId ?? null,
                    projectionVersion: payload?.projectionVersion ?? null,
                    projectionCursor: payload?.projectionCursor ?? null,
                    hasInteractionPayload: !!payload?.interaction,
                    hasMessagePayload: !!payload?.message,
                });
                engine.handleRealtimeEvent(payload);
            },
            onReplayStatus: (status) => {
                logDiscussionRealtimeProbe(input.circleId, 'websocket_replay_status', {
                    ok: status?.ok ?? null,
                    truncated: status?.truncated ?? null,
                    replayedCount: status?.replayedCount ?? null,
                    latestLamport: status?.latestLamport ?? null,
                });
                engine.handleReplayStatus(status);
            },
            onReady: () => {
                logDiscussionRealtimeProbe(input.circleId, 'websocket_ready');
                engine.handleOpen({ replayStatusExpected: true });
            },
        });
    };

    // WebSocket is the default transport and SSE is fallback/rollback only.
    // Both transports feed the same engine so catch-up, targeted refresh,
    // visibility recovery, error mapping, and rendering cannot fork.
    if (resolveDiscussionRealtimeTransportMode({ override: input.transportMode }) === 'sse') {
        startSse();
    } else {
        startWebSocket();
    }

    return {
        close() {
            if (closed) return;
            closed = true;
            logDiscussionRealtimeProbe(input.circleId, 'close');
            closeTransport();
            engine.close();
        },
        handleVisibilityChange() {
            engine.handleVisibilityChange();
        },
    };
}
