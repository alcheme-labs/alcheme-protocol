import type { DiscussionMessageDto, DiscussionMessagesResponse } from '../api.ts';
import type {
    DiscussionAnchoredInteractionDto,
    DiscussionAnchoredInteractionResponse,
} from '../anchoredInteractions.ts';
import type { DiscussionRealtimeEvent, DiscussionRealtimeReplayStatus } from './protocol.ts';

export interface DiscussionRealtimeSubscription {
    close(): void;
    handleVisibilityChange(): void;
}

export interface DiscussionRealtimeEngine {
    close(): void;
    handleDisconnect(): void;
    handleOpen(options?: { replayStatusExpected?: boolean }): void;
    handleRealtimeEvent(payload: DiscussionRealtimeEvent | null): void;
    handleReplayStatus(status: DiscussionRealtimeReplayStatus | null): void;
    handleVisibilityChange(): void;
}

export interface DiscussionRealtimeEngineInput {
    circleId: number;
    fetchCatchUp: (afterLamport: number) => Promise<DiscussionMessagesResponse>;
    fetchTargetedRefresh: (envelopeIds: string[]) => Promise<DiscussionMessagesResponse>;
    fetchInteractionRefresh?: (interactionIds: string[]) => Promise<DiscussionAnchoredInteractionResponse>;
    fetchInteractionCatchUp?: (afterProjectionCursor: number) => Promise<DiscussionAnchoredInteractionResponse>;
    fetchAnnouncementRefresh?: (announcementIds: string[]) => Promise<void> | void;
    getLastLamport: () => number;
    getLastInteractionProjectionCursor?: () => number;
    getRefreshableEnvelopeIds?: () => string[];
    maxRefreshableEnvelopeIds?: number;
    applyCatchUp: (response: DiscussionMessagesResponse) => void | Promise<void>;
    applyTargetedRefresh: (response: DiscussionMessagesResponse) => void | Promise<void>;
    applyRealtimeMessages?: (response: DiscussionMessagesResponse) => void | Promise<void>;
    applyInteractionRefresh?: (response: DiscussionAnchoredInteractionResponse) => void | Promise<void>;
    applyRealtimeInteractions?: (response: DiscussionAnchoredInteractionResponse) => void | Promise<void>;
    onError?: (message: string | null) => void;
    onRealtimeEventApplied?: (
        event: DiscussionRealtimeEvent,
        timing: { receivedAt: string; appliedAt: string },
    ) => void;
    isVisible?: () => boolean;
    setTimeoutFn?: (callback: () => void | Promise<void>, delay: number) => unknown;
    clearTimeoutFn?: (timeoutId: unknown) => void;
}

const DEFAULT_FAST_VISIBLE_FLUSH_MS = 300;
const DEFAULT_VISIBLE_RECONCILE_MS = 30_000;
const DEFAULT_HIDDEN_RECONCILE_MS = 120_000;
const DEFAULT_RECONCILE_REFRESH_LIMIT = 120;

export function computeCatchUpDelay(input: { visible: boolean }): number {
    return input.visible ? 3_000 : 15_000;
}

export function computeRealtimeFlushDelay(input: { visible: boolean; urgent?: boolean }): number {
    if (input.visible && input.urgent) {
        return DEFAULT_FAST_VISIBLE_FLUSH_MS;
    }
    return computeCatchUpDelay({ visible: input.visible });
}

export function computeRealtimeReconcileDelay(input: { visible: boolean }): number {
    return input.visible ? DEFAULT_VISIBLE_RECONCILE_MS : DEFAULT_HIDDEN_RECONCILE_MS;
}

function createDiscussionMessagesResponse(
    circleId: number,
    messages: DiscussionMessageDto[],
): DiscussionMessagesResponse {
    const lastMessage = messages.at(-1) ?? null;
    return {
        circleId,
        roomKey: lastMessage?.roomKey ?? `circle:${circleId}`,
        count: messages.length,
        watermark: lastMessage
            ? {
                lastLamport: lastMessage.lamport,
                lastEnvelopeId: lastMessage.envelopeId,
                lastIngestedAt: null,
            }
            : null,
        messages,
    };
}

interface PendingRealtimeMessage {
    event: DiscussionRealtimeEvent;
    message: DiscussionMessageDto;
    receivedAt: string;
}

interface PendingRealtimeInteraction {
    event: DiscussionRealtimeEvent;
    interaction: DiscussionAnchoredInteractionDto;
    receivedAt: string;
}

export function createDiscussionRealtimeEngine(input: DiscussionRealtimeEngineInput): DiscussionRealtimeEngine {
    const isVisible = input.isVisible ?? (() => document.visibilityState !== 'hidden');
    const setTimeoutFn = input.setTimeoutFn ?? ((callback: () => void | Promise<void>, delay: number) => window.setTimeout(callback, delay));
    const clearTimeoutFn = input.clearTimeoutFn ?? ((timeoutId: unknown) => window.clearTimeout(timeoutId as number));

    const pendingRefreshEnvelopeIds = new Set<string>();
    const pendingInteractionRefreshIds = new Set<string>();
    const pendingAnnouncementRefreshIds = new Set<string>();
    const pendingRealtimeAppendMessages: PendingRealtimeMessage[] = [];
    const pendingRealtimeRefreshMessages: PendingRealtimeMessage[] = [];
    const pendingRealtimeInteractions: PendingRealtimeInteraction[] = [];
    let pendingLatestLamport: number | null = null;
    let flushTimer: unknown = null;
    let flushTimerDelay: number | null = null;
    let reconcileTimer: unknown = null;
    let closed = false;
    let flushInFlight = false;
    let needsPostFlush = false;
    let needsImmediatePostFlush = false;
    let reconnectCatchUpRequested = false;
    let interactionCatchUpRequested = false;
    let replayStatusExpected = false;
    let hasOpenedOnce = false;

    const clearFlushTimer = () => {
        if (flushTimer === null) return;
        clearTimeoutFn(flushTimer);
        flushTimer = null;
        flushTimerDelay = null;
    };

    const clearReconcileTimer = () => {
        if (reconcileTimer === null) return;
        clearTimeoutFn(reconcileTimer);
        reconcileTimer = null;
    };

    const enqueueRefreshableEnvelopeIds = () => {
        const getEnvelopeIds = input.getRefreshableEnvelopeIds;
        if (!getEnvelopeIds) return;
        const limit = Math.max(0, Math.trunc(input.maxRefreshableEnvelopeIds ?? DEFAULT_RECONCILE_REFRESH_LIMIT));
        if (limit <= 0) return;

        for (const value of getEnvelopeIds().slice(0, limit)) {
            const envelopeId = typeof value === 'string' ? value.trim() : '';
            if (envelopeId) {
                pendingRefreshEnvelopeIds.add(envelopeId);
            }
        }
    };

    const flush = async () => {
        flushTimer = null;
        flushTimerDelay = null;
        if (closed) return;
        if (flushInFlight) {
            needsPostFlush = true;
            return;
        }

        flushInFlight = true;
        const refreshEnvelopeIds = [...pendingRefreshEnvelopeIds];
        const refreshInteractionIds = [...pendingInteractionRefreshIds];
        const refreshAnnouncementIds = [...pendingAnnouncementRefreshIds];
        pendingRefreshEnvelopeIds.clear();
        pendingInteractionRefreshIds.clear();
        pendingAnnouncementRefreshIds.clear();
        const realtimeAppendEvents = pendingRealtimeAppendMessages.splice(0);
        const realtimeRefreshEvents = pendingRealtimeRefreshMessages.splice(0);
        const realtimeInteractionEvents = pendingRealtimeInteractions.splice(0);
        const requestedLatestLamport = pendingLatestLamport;
        pendingLatestLamport = null;
        const shouldCatchUp = reconnectCatchUpRequested
            || (
                typeof requestedLatestLamport === 'number'
                && Number.isFinite(requestedLatestLamport)
                && requestedLatestLamport > input.getLastLamport()
            );
        reconnectCatchUpRequested = false;
        const shouldInteractionCatchUp =
            interactionCatchUpRequested
            && !!input.fetchInteractionCatchUp
            && !!(input.applyRealtimeInteractions ?? input.applyInteractionRefresh);
        interactionCatchUpRequested = false;

        try {
            if (realtimeInteractionEvents.length > 0 && (input.applyRealtimeInteractions ?? input.applyInteractionRefresh)) {
                const realtimeInteractions = realtimeInteractionEvents.map((event) => event.interaction);
                const maxCursor = Math.max(...realtimeInteractions.map((interaction) => interaction.projectionCursor));
                const response: DiscussionAnchoredInteractionResponse = {
                    interactions: realtimeInteractions,
                    watermark: {
                        lastProjectionCursor: Number.isFinite(maxCursor) ? maxCursor : null,
                    },
                };
                await (input.applyRealtimeInteractions ?? input.applyInteractionRefresh)?.(response);
                const appliedAt = new Date().toISOString();
                for (const event of realtimeInteractionEvents) {
                    input.onRealtimeEventApplied?.(event.event, {
                        receivedAt: event.receivedAt,
                        appliedAt,
                    });
                }
            }
            if (realtimeAppendEvents.length > 0) {
                const realtimeAppendMessages = realtimeAppendEvents.map((event) => event.message);
                const response = createDiscussionMessagesResponse(input.circleId, realtimeAppendMessages);
                await (input.applyRealtimeMessages ?? input.applyCatchUp)(response);
                const appliedAt = new Date().toISOString();
                for (const event of realtimeAppendEvents) {
                    input.onRealtimeEventApplied?.(event.event, {
                        receivedAt: event.receivedAt,
                        appliedAt,
                    });
                }
            }
            if (realtimeRefreshEvents.length > 0) {
                const realtimeRefreshMessages = realtimeRefreshEvents.map((event) => event.message);
                const response = createDiscussionMessagesResponse(input.circleId, realtimeRefreshMessages);
                await input.applyTargetedRefresh(response);
                const appliedAt = new Date().toISOString();
                for (const event of realtimeRefreshEvents) {
                    input.onRealtimeEventApplied?.(event.event, {
                        receivedAt: event.receivedAt,
                        appliedAt,
                    });
                }
            }
            if (shouldCatchUp) {
                const catchUpResponse = await input.fetchCatchUp(input.getLastLamport());
                await input.applyCatchUp(catchUpResponse);
            }
            if (shouldInteractionCatchUp && input.fetchInteractionCatchUp) {
                const interactionCatchUpResponse = await input.fetchInteractionCatchUp(
                    input.getLastInteractionProjectionCursor?.() ?? 0,
                );
                if (
                    interactionCatchUpResponse.interactions.length > 0
                    || typeof interactionCatchUpResponse.watermark?.lastProjectionCursor === 'number'
                ) {
                    await (input.applyRealtimeInteractions ?? input.applyInteractionRefresh)?.(interactionCatchUpResponse);
                }
            }
            if (refreshEnvelopeIds.length > 0) {
                const refreshResponse = await input.fetchTargetedRefresh(refreshEnvelopeIds);
                await input.applyTargetedRefresh(refreshResponse);
            }
            if (
                refreshInteractionIds.length > 0
                && input.fetchInteractionRefresh
                && input.applyInteractionRefresh
            ) {
                const refreshResponse = await input.fetchInteractionRefresh(refreshInteractionIds);
                await input.applyInteractionRefresh(refreshResponse);
            }
            if (refreshAnnouncementIds.length > 0 && input.fetchAnnouncementRefresh) {
                await input.fetchAnnouncementRefresh(refreshAnnouncementIds);
            }
            input.onError?.(null);
        } catch (error) {
            input.onError?.(error instanceof Error ? error.message : 'realtime_sync_failed');
        } finally {
            flushInFlight = false;
            if (!closed && needsPostFlush) {
                const runImmediatePostFlush = needsImmediatePostFlush;
                needsPostFlush = false;
                needsImmediatePostFlush = false;
                if (runImmediatePostFlush) {
                    scheduleImmediateFlush();
                } else {
                    scheduleFlush();
                }
            }
        }
    };

    const scheduleImmediateFlush = () => {
        if (closed) return;
        if (flushInFlight) {
            needsPostFlush = true;
            needsImmediatePostFlush = true;
            return;
        }
        clearFlushTimer();
        flushTimerDelay = 0;
        flushTimer = setTimeoutFn(() => {
            void flush();
        }, 0);
    };

    const scheduleFlush = (options: { urgent?: boolean } = {}) => {
        if (closed) return;
        const delay = computeRealtimeFlushDelay({ visible: isVisible(), urgent: options.urgent });
        if (flushTimer !== null) {
            if (flushTimerDelay === null || delay >= flushTimerDelay) {
                return;
            }
            clearFlushTimer();
        }
        flushTimerDelay = delay;
        flushTimer = setTimeoutFn(() => {
            void flush();
        }, delay);
    };

    const hasPendingFlushWork = () => (
        pendingLatestLamport !== null
        || pendingRefreshEnvelopeIds.size > 0
        || pendingInteractionRefreshIds.size > 0
        || pendingAnnouncementRefreshIds.size > 0
        || pendingRealtimeAppendMessages.length > 0
        || pendingRealtimeRefreshMessages.length > 0
        || pendingRealtimeInteractions.length > 0
        || reconnectCatchUpRequested
        || interactionCatchUpRequested
    );

    const runReconcile = async () => {
        if (closed) return;
        reconnectCatchUpRequested = true;
        interactionCatchUpRequested = true;
        enqueueRefreshableEnvelopeIds();
        clearFlushTimer();
        await flush();
    };

    const scheduleReconcile = () => {
        if (closed || reconcileTimer !== null) return;
        reconcileTimer = setTimeoutFn(async () => {
            reconcileTimer = null;
            await runReconcile();
            scheduleReconcile();
        }, computeRealtimeReconcileDelay({ visible: isVisible() }));
    };

    scheduleReconcile();

    return {
        close() {
            if (closed) return;
            closed = true;
            clearFlushTimer();
            clearReconcileTimer();
        },
        handleDisconnect() {
            if (closed) return;
            if (replayStatusExpected) {
                replayStatusExpected = false;
                reconnectCatchUpRequested = true;
                interactionCatchUpRequested = true;
                scheduleFlush();
            }
            input.onError?.('discussion_realtime_disconnected');
        },
        handleOpen(options = {}) {
            if (closed) return;
            if (!hasOpenedOnce) {
                hasOpenedOnce = true;
            }
            if (options.replayStatusExpected) {
                replayStatusExpected = true;
                reconnectCatchUpRequested = false;
                interactionCatchUpRequested = true;
                return;
            }
            replayStatusExpected = false;
            reconnectCatchUpRequested = true;
            interactionCatchUpRequested = true;
            scheduleFlush();
        },
        handleRealtimeEvent(payload) {
            if (closed) return;
            if (!payload || payload.circleId !== input.circleId) return;
            const receivedAt = new Date().toISOString();
            if (payload.message) {
                if (
                    payload.reason === 'message_created'
                    || payload.reason === 'message_forwarded'
                    || payload.reason === 'candidate_notice_updated'
                    || payload.reason === 'system_notice_published'
                    || payload.reason === 'interaction_result_published'
                ) {
                    pendingRealtimeAppendMessages.push({
                        event: payload,
                        message: payload.message,
                        receivedAt,
                    });
                } else {
                    pendingRealtimeRefreshMessages.push({
                        event: payload,
                        message: payload.message,
                        receivedAt,
                    });
                }
                if (isVisible()) {
                    scheduleImmediateFlush();
                    return;
                }
                scheduleFlush({ urgent: true });
                return;
            }
            if (
                payload.reason === 'interaction_projection_changed'
                || payload.reason === 'interaction_result_published'
            ) {
                if (!input.applyRealtimeInteractions && !input.applyInteractionRefresh) {
                    return;
                }
                if (payload.interaction) {
                    pendingRealtimeInteractions.push({
                        event: payload,
                        interaction: payload.interaction,
                        receivedAt,
                    });
                    if (isVisible()) {
                        scheduleImmediateFlush();
                        return;
                    }
                    scheduleFlush({ urgent: true });
                    return;
                }
                if (payload.interactionId && input.fetchInteractionRefresh && input.applyInteractionRefresh) {
                    pendingInteractionRefreshIds.add(payload.interactionId);
                    if (isVisible()) {
                        scheduleImmediateFlush();
                        return;
                    }
                    scheduleFlush({ urgent: true });
                }
                return;
            }
            if (payload.reason === 'announcement_projection_changed') {
                if (payload.announcementId) {
                    pendingAnnouncementRefreshIds.add(payload.announcementId);
                } else {
                    pendingAnnouncementRefreshIds.add('*');
                }
                if (payload.discussionRootEnvelopeId) {
                    pendingRefreshEnvelopeIds.add(payload.discussionRootEnvelopeId);
                }
                if (typeof payload.latestLamport === 'number' && Number.isFinite(payload.latestLamport)) {
                    pendingLatestLamport = pendingLatestLamport === null
                        ? payload.latestLamport
                        : Math.max(pendingLatestLamport, payload.latestLamport);
                }
                if (isVisible()) {
                    scheduleImmediateFlush();
                    return;
                }
                scheduleFlush({ urgent: true });
                return;
            }
            if (
                (
                    payload.reason === 'message_refresh_required'
                    || payload.reason === 'message_tombstoned'
                    || payload.reason === 'candidate_notice_updated'
                    || payload.reason === 'system_notice_published'
                )
                && payload.envelopeId
            ) {
                pendingRefreshEnvelopeIds.add(payload.envelopeId);
            }
            if (typeof payload.latestLamport === 'number' && Number.isFinite(payload.latestLamport)) {
                pendingLatestLamport = pendingLatestLamport === null
                    ? payload.latestLamport
                    : Math.max(pendingLatestLamport, payload.latestLamport);
            }
            scheduleFlush({ urgent: true });
        },
        handleReplayStatus(status) {
            if (closed || !status || status.circleId !== input.circleId) return;
            replayStatusExpected = false;
            if (status.ok && !status.truncated) {
                reconnectCatchUpRequested = false;
                if (!hasPendingFlushWork()) {
                    clearFlushTimer();
                } else if (isVisible()) {
                    scheduleImmediateFlush();
                } else {
                    scheduleFlush();
                }
                return;
            }
            reconnectCatchUpRequested = true;
            interactionCatchUpRequested = true;
            scheduleFlush();
        },
        handleVisibilityChange() {
            if (closed) return;
            clearFlushTimer();
            clearReconcileTimer();
            scheduleReconcile();
            if (isVisible()) {
                if (!replayStatusExpected) {
                    reconnectCatchUpRequested = true;
                    interactionCatchUpRequested = true;
                    scheduleFlush();
                }
                return;
            }
            if (hasPendingFlushWork()) {
                scheduleFlush();
            }
        },
    };
}
