import type { Redis } from 'ioredis';

import {
    buildDiscussionRealtimeChannel,
    parseDiscussionRealtimePayload,
    type DiscussionRealtimePayload,
} from './protocol';

export const DISCUSSION_REALTIME_MAX_BUFFERED_BYTES = 1_000_000;
export const DISCUSSION_REALTIME_MAX_QUEUED_EVENTS = 200;

export interface RealtimeSocketSink {
    id: string;
    kind: 'websocket' | 'sse';
    sendRealtimePayload(payload: DiscussionRealtimePayload): boolean;
    sendControl?(value: unknown): boolean;
    close(code: number, reason: string): void;
    bufferedAmount(): number;
    queuedEvents?(): number;
}

interface CircleRealtimeHubState {
    circleId: number;
    channel: string;
    sinks: Map<string, RealtimeSocketSink>;
    idleTimer: ReturnType<typeof setTimeout> | null;
}

const hubs = new Map<number, CircleRealtimeHubState>();
const activeChannels = new Set<string>();
const pendingChannelSubscribes = new Map<string, Promise<void>>();
let processSubscriber: Redis | null = null;
let processSubscriberConnections = 0;
let processSubscriberRedis: Redis | null = null;

function isPromiseLike(value: unknown): value is Promise<unknown> {
    return Boolean(value) && typeof (value as Promise<unknown>).then === 'function';
}

async function callMaybePromise(value: unknown): Promise<void> {
    if (isPromiseLike(value)) {
        await value;
    }
}

function ensureSubscriber(redis: Redis): Redis {
    if (processSubscriber && processSubscriberRedis === redis) {
        return processSubscriber;
    }
    if (processSubscriber) {
        void shutdownDiscussionRealtimeHub();
    }

    const duplicate = (redis as Redis & { duplicate?: () => Redis }).duplicate;
    if (typeof duplicate !== 'function') {
        throw new Error('discussion_realtime_redis_duplicate_unavailable');
    }
    processSubscriber = duplicate.call(redis);
    processSubscriberRedis = redis;
    processSubscriberConnections = 1;
    processSubscriber.on('message', handleRedisMessage);
    processSubscriber.on('ready', () => {
        for (const channel of activeChannels) {
            void Promise.resolve(processSubscriber?.subscribe(channel)).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`discussion realtime resubscribe failed for ${channel}: ${message}`);
            });
        }
    });
    return processSubscriber;
}

function handleRedisMessage(channel: string, rawMessage: string): void {
    const payload = parseDiscussionRealtimePayload(rawMessage);
    if (!payload) return;
    const hub = hubs.get(payload.circleId);
    if (!hub || hub.channel !== channel) return;

    const closeBackpressuredSink = (sink: RealtimeSocketSink) => {
        sink.close(1013, 'discussion_realtime_backpressure');
        hub.sinks.delete(sink.id);
        if (hub.sinks.size === 0) {
            void removeDiscussionRealtimeSink({ circleId: hub.circleId, sinkId: sink.id });
        }
    };

    for (const sink of [...hub.sinks.values()]) {
        const queuedEvents = typeof sink.queuedEvents === 'function' ? sink.queuedEvents() : 0;
        if (
            sink.bufferedAmount() > DISCUSSION_REALTIME_MAX_BUFFERED_BYTES
            || queuedEvents > DISCUSSION_REALTIME_MAX_QUEUED_EVENTS
        ) {
            closeBackpressuredSink(sink);
            continue;
        }
        const accepted = sink.sendRealtimePayload(payload);
        if (!accepted) {
            closeBackpressuredSink(sink);
        }
    }
}

async function subscribeChannel(redis: Redis, channel: string): Promise<void> {
    if (activeChannels.has(channel)) return;
    const pending = pendingChannelSubscribes.get(channel);
    if (pending) {
        await pending;
        return;
    }

    const promise = (async () => {
        const subscriber = ensureSubscriber(redis);
        await callMaybePromise(subscriber.subscribe(channel));
        activeChannels.add(channel);
    })();
    pendingChannelSubscribes.set(channel, promise);
    try {
        await promise;
    } finally {
        pendingChannelSubscribes.delete(channel);
    }
}

async function unsubscribeChannel(channel: string): Promise<void> {
    if (!processSubscriber || !activeChannels.has(channel)) return;
    activeChannels.delete(channel);
    try {
        await callMaybePromise(processSubscriber.unsubscribe(channel));
    } catch {
        // Keep shutdown/remove best-effort; replay is the recovery path.
    }
}

export async function addDiscussionRealtimeSink(input: {
    redis: Redis;
    circleId: number;
    sink: RealtimeSocketSink;
    idleCloseMs?: number;
}): Promise<void> {
    const circleId = Math.max(0, Math.trunc(input.circleId));
    if (circleId <= 0) {
        throw new Error('invalid_discussion_realtime_circle');
    }
    const channel = buildDiscussionRealtimeChannel(circleId);
    let hub = hubs.get(circleId);
    if (!hub) {
        hub = {
            circleId,
            channel,
            sinks: new Map(),
            idleTimer: null,
        };
        hubs.set(circleId, hub);
    }
    if (hub.idleTimer) {
        clearTimeout(hub.idleTimer);
        hub.idleTimer = null;
    }
    hub.sinks.set(input.sink.id, input.sink);
    try {
        await subscribeChannel(input.redis, channel);
    } catch (error) {
        hub.sinks.delete(input.sink.id);
        if (hub.sinks.size === 0 && hubs.get(circleId) === hub) {
            hubs.delete(circleId);
        }
        throw error;
    }

    const currentHub = hubs.get(circleId);
    if (!currentHub || currentHub.sinks.size === 0) {
        await unsubscribeChannel(channel);
    }
}

export async function removeDiscussionRealtimeSink(input: {
    circleId: number;
    sinkId: string;
    idleCloseMs?: number;
}): Promise<void> {
    const hub = hubs.get(input.circleId);
    if (!hub) return;
    hub.sinks.delete(input.sinkId);
    if (hub.sinks.size > 0 || hub.idleTimer) return;

    const close = async () => {
        const current = hubs.get(input.circleId);
        if (!current || current.sinks.size > 0) return;
        hubs.delete(input.circleId);
        await unsubscribeChannel(current.channel);
    };

    const idleCloseMs = Math.max(0, Math.trunc(input.idleCloseMs ?? 0));
    if (idleCloseMs === 0) {
        await close();
        return;
    }
    hub.idleTimer = setTimeout(() => {
        hub.idleTimer = null;
        void close();
    }, idleCloseMs);
}

export function getDiscussionRealtimeHubStats() {
    let activeSinks = 0;
    for (const hub of hubs.values()) {
        activeSinks += hub.sinks.size;
    }
    return {
        activeHubs: hubs.size,
        activeSinks,
        redisSubscriberConnections: processSubscriberConnections,
        activeChannelSubscriptions: activeChannels.size,
    };
}

export async function shutdownDiscussionRealtimeHub(): Promise<void> {
    for (const hub of hubs.values()) {
        if (hub.idleTimer) {
            clearTimeout(hub.idleTimer);
        }
        for (const sink of hub.sinks.values()) {
            sink.close(1001, 'discussion_realtime_shutdown');
        }
    }
    hubs.clear();
    activeChannels.clear();
    pendingChannelSubscribes.clear();

    const subscriber = processSubscriber;
    processSubscriber = null;
    processSubscriberRedis = null;
    processSubscriberConnections = 0;
    if (!subscriber) return;
    if (typeof (subscriber as Redis & { off?: Redis['off'] }).off === 'function') {
        subscriber.off('message', handleRedisMessage);
    }
    try {
        await callMaybePromise(subscriber.quit());
    } catch {
        // Ignore shutdown errors in dev/test teardown.
    }
}
