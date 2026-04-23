import type { DiscussionMessagesResponse } from './api';

export interface DiscussionRealtimeEvent {
    circleId: number;
    latestLamport: number | null;
    envelopeId: string | null;
    reason:
        | 'message_created'
        | 'message_tombstoned'
        | 'message_forwarded'
        | 'system_notice_published'
        | 'candidate_notice_updated'
        | 'message_refresh_required';
}

export interface DiscussionRealtimeEventSource {
    addEventListener(type: string, listener: (event: { data: string }) => void): void;
    close(): void;
    onopen: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
}

export interface DiscussionRealtimeSubscription {
    close(): void;
    handleVisibilityChange(): void;
}

type DiscussionRealtimeReason = DiscussionRealtimeEvent['reason'];

interface SubscribeToCircleDiscussionStreamInput {
    circleId: number;
    streamUrl: string;
    eventSourceFactory?: (url: string, init?: { withCredentials?: boolean }) => DiscussionRealtimeEventSource;
    fetchCatchUp: (afterLamport: number) => Promise<DiscussionMessagesResponse>;
    fetchTargetedRefresh: (envelopeIds: string[]) => Promise<DiscussionMessagesResponse>;
    getLastLamport: () => number;
    applyCatchUp: (response: DiscussionMessagesResponse) => void | Promise<void>;
    applyTargetedRefresh: (response: DiscussionMessagesResponse) => void | Promise<void>;
    onError?: (message: string | null) => void;
    isVisible?: () => boolean;
    setTimeoutFn?: (callback: () => void | Promise<void>, delay: number) => unknown;
    clearTimeoutFn?: (timeoutId: unknown) => void;
}

export function computeCatchUpDelay(input: { visible: boolean }): number {
    return input.visible ? 3_000 : 15_000;
}

function normalizeDiscussionRealtimeEvent(value: string): DiscussionRealtimeEvent | null {
    try {
        const parsed = JSON.parse(value) as Partial<DiscussionRealtimeEvent> | null;
        if (!parsed || typeof parsed !== 'object') return null;
        if (typeof parsed.circleId !== 'number' || !Number.isFinite(parsed.circleId) || parsed.circleId <= 0) {
            return null;
        }
        let reason: DiscussionRealtimeReason | null = null;
        if (
            parsed.reason === 'message_created'
            || parsed.reason === 'message_tombstoned'
            || parsed.reason === 'message_forwarded'
            || parsed.reason === 'system_notice_published'
            || parsed.reason === 'candidate_notice_updated'
            || parsed.reason === 'message_refresh_required'
        ) {
            reason = parsed.reason;
        }
        if (reason === null) return null;
        return {
            circleId: parsed.circleId,
            latestLamport: typeof parsed.latestLamport === 'number' && Number.isFinite(parsed.latestLamport)
                ? parsed.latestLamport
                : null,
            envelopeId: typeof parsed.envelopeId === 'string' && parsed.envelopeId.trim()
                ? parsed.envelopeId.trim()
                : null,
            reason,
        };
    } catch {
        return null;
    }
}

export function subscribeToCircleDiscussionStream(
    input: SubscribeToCircleDiscussionStreamInput,
): DiscussionRealtimeSubscription {
    const eventSourceFactory = input.eventSourceFactory
        ?? ((url: string, init?: { withCredentials?: boolean }) => new EventSource(url, init));
    const isVisible = input.isVisible ?? (() => document.visibilityState !== 'hidden');
    const setTimeoutFn = input.setTimeoutFn ?? ((callback: () => void | Promise<void>, delay: number) => window.setTimeout(callback, delay));
    const clearTimeoutFn = input.clearTimeoutFn ?? ((timeoutId: unknown) => window.clearTimeout(timeoutId as number));

    const pendingRefreshEnvelopeIds = new Set<string>();
    let pendingLatestLamport: number | null = null;
    let flushTimer: unknown = null;
    let closed = false;
    let flushInFlight = false;
    let needsPostFlush = false;
    let reconnectCatchUpRequested = false;
    let hasOpenedOnce = false;

    const source = eventSourceFactory(input.streamUrl, { withCredentials: true });

    const flush = async () => {
        flushTimer = null;
        if (closed) return;
        if (flushInFlight) {
            needsPostFlush = true;
            return;
        }

        flushInFlight = true;
        const refreshEnvelopeIds = [...pendingRefreshEnvelopeIds];
        pendingRefreshEnvelopeIds.clear();
        const requestedLatestLamport = pendingLatestLamport;
        pendingLatestLamport = null;
        const shouldCatchUp = reconnectCatchUpRequested
            || (
                typeof requestedLatestLamport === 'number'
                && Number.isFinite(requestedLatestLamport)
                && requestedLatestLamport > input.getLastLamport()
            );
        reconnectCatchUpRequested = false;

        try {
            if (shouldCatchUp) {
                const catchUpResponse = await input.fetchCatchUp(input.getLastLamport());
                await input.applyCatchUp(catchUpResponse);
            }
            if (refreshEnvelopeIds.length > 0) {
                const refreshResponse = await input.fetchTargetedRefresh(refreshEnvelopeIds);
                await input.applyTargetedRefresh(refreshResponse);
            }
            input.onError?.(null);
        } catch (error) {
            input.onError?.(error instanceof Error ? error.message : 'realtime_sync_failed');
        } finally {
            flushInFlight = false;
            if (!closed && needsPostFlush) {
                needsPostFlush = false;
                scheduleFlush();
            }
        }
    };

    const scheduleFlush = () => {
        if (closed || flushTimer !== null) return;
        flushTimer = setTimeoutFn(() => {
            void flush();
        }, computeCatchUpDelay({ visible: isVisible() }));
    };

    source.addEventListener('message_changed', (event) => {
        if (closed) return;
        const payload = normalizeDiscussionRealtimeEvent(event.data);
        if (!payload || payload.circleId !== input.circleId) return;
        if (
            (payload.reason === 'message_refresh_required' || payload.reason === 'message_tombstoned')
            && payload.envelopeId
        ) {
            pendingRefreshEnvelopeIds.add(payload.envelopeId);
        }
        if (typeof payload.latestLamport === 'number' && Number.isFinite(payload.latestLamport)) {
            pendingLatestLamport = pendingLatestLamport === null
                ? payload.latestLamport
                : Math.max(pendingLatestLamport, payload.latestLamport);
        }
        scheduleFlush();
    });

    source.onopen = () => {
        if (closed) return;
        if (!hasOpenedOnce) {
            hasOpenedOnce = true;
            return;
        }
        reconnectCatchUpRequested = true;
        scheduleFlush();
    };

    source.onerror = () => {
        if (closed) return;
        input.onError?.('discussion_realtime_disconnected');
    };

    return {
        close() {
            if (closed) return;
            closed = true;
            if (flushTimer !== null) {
                clearTimeoutFn(flushTimer);
                flushTimer = null;
            }
            source.close();
        },
        handleVisibilityChange() {
            if (closed) return;
            if (flushTimer !== null) {
                clearTimeoutFn(flushTimer);
                flushTimer = null;
            }
            if (isVisible()) {
                reconnectCatchUpRequested = true;
                scheduleFlush();
                return;
            }
            if (pendingLatestLamport !== null || pendingRefreshEnvelopeIds.size > 0 || reconnectCatchUpRequested) {
                scheduleFlush();
            }
        },
    };
}
