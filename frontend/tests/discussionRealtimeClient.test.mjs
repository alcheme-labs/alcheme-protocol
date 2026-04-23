import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeCatchUpDelay,
    subscribeToCircleDiscussionStream,
} from '../src/lib/discussion/realtime.ts';

function createResponse(messages = []) {
    return {
        circleId: 49,
        roomKey: 'circle:49',
        count: messages.length,
        watermark: {
            lastLamport: messages.at(-1)?.lamport ?? 10,
            lastEnvelopeId: messages.at(-1)?.envelopeId ?? null,
            lastIngestedAt: null,
        },
        messages,
    };
}

function createTimerHarness() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();

    return {
        setTimeout(callback, delay) {
            const id = nextId++;
            timers.set(id, { callback, at: now + delay });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        async advance(ms) {
            now += ms;
            while (true) {
                const dueEntries = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= now)
                    .sort((left, right) => left[1].at - right[1].at);
                if (dueEntries.length === 0) {
                    break;
                }
                const [id, timer] = dueEntries[0];
                timers.delete(id);
                await timer.callback();
            }
        },
    };
}

function createEventSourceHarness() {
    const sources = [];

    class FakeEventSource {
        constructor(url, init = undefined) {
            this.url = url;
            this.init = init;
            this.listeners = new Map();
            this.onopen = null;
            this.onerror = null;
            this.closed = false;
            sources.push(this);
        }

        addEventListener(type, listener) {
            const current = this.listeners.get(type) || [];
            current.push(listener);
            this.listeners.set(type, current);
        }

        close() {
            this.closed = true;
        }

        emit(type, payload) {
            const listeners = this.listeners.get(type) || [];
            for (const listener of listeners) {
                listener({ data: JSON.stringify(payload) });
            }
        }

        emitOpen() {
            this.onopen?.({});
        }

        emitError() {
            this.onerror?.({});
        }
    }

    return {
        sources,
        create(url, init) {
            return new FakeEventSource(url, init);
        },
    };
}

test('computeCatchUpDelay keeps visible/hidden fetch ceilings aligned with old polling', () => {
    assert.equal(computeCatchUpDelay({ visible: true }), 3000);
    assert.equal(computeCatchUpDelay({ visible: false }), 15000);
});

test('opens one stream per circle and coalesces append events into one catch-up fetch', async () => {
    const timers = createTimerHarness();
    const eventSource = createEventSourceHarness();
    const catchUpCalls = [];

    const subscription = subscribeToCircleDiscussionStream({
        circleId: 49,
        streamUrl: 'http://127.0.0.1:4000/api/v1/discussion/circles/49/stream',
        eventSourceFactory: eventSource.create,
        fetchCatchUp: async (afterLamport) => {
            catchUpCalls.push(afterLamport);
            return createResponse([{ envelopeId: 'env-12', lamport: 12 }]);
        },
        fetchTargetedRefresh: async () => createResponse([]),
        getLastLamport: () => 10,
        applyCatchUp: () => {},
        applyTargetedRefresh: () => {},
        isVisible: () => true,
        setTimeoutFn: timers.setTimeout,
        clearTimeoutFn: timers.clearTimeout,
    });

    assert.equal(eventSource.sources.length, 1);
    assert.equal(eventSource.sources[0].url, 'http://127.0.0.1:4000/api/v1/discussion/circles/49/stream');

    eventSource.sources[0].emit('message_changed', {
        circleId: 49,
        latestLamport: 11,
        envelopeId: 'env-11',
        reason: 'message_created',
    });
    eventSource.sources[0].emit('message_changed', {
        circleId: 49,
        latestLamport: 12,
        envelopeId: 'env-12',
        reason: 'message_created',
    });

    await timers.advance(2999);
    assert.deepEqual(catchUpCalls, []);
    await timers.advance(1);
    assert.deepEqual(catchUpCalls, [10]);

    subscription.close();
  });

test('hidden tabs cap catch-up fetches at one per 15 seconds', async () => {
    const timers = createTimerHarness();
    const eventSource = createEventSourceHarness();
    const catchUpCalls = [];

    const subscription = subscribeToCircleDiscussionStream({
        circleId: 49,
        streamUrl: 'http://127.0.0.1:4000/api/v1/discussion/circles/49/stream',
        eventSourceFactory: eventSource.create,
        fetchCatchUp: async (afterLamport) => {
            catchUpCalls.push(afterLamport);
            return createResponse([{ envelopeId: 'env-20', lamport: 20 }]);
        },
        fetchTargetedRefresh: async () => createResponse([]),
        getLastLamport: () => 10,
        applyCatchUp: () => {},
        applyTargetedRefresh: () => {},
        isVisible: () => false,
        setTimeoutFn: timers.setTimeout,
        clearTimeoutFn: timers.clearTimeout,
    });

    eventSource.sources[0].emit('message_changed', {
        circleId: 49,
        latestLamport: 20,
        envelopeId: 'env-20',
        reason: 'message_created',
    });

    await timers.advance(14999);
    assert.deepEqual(catchUpCalls, []);
    await timers.advance(1);
    assert.deepEqual(catchUpCalls, [10]);

    subscription.close();
});

test('reconnect schedules one catch-up fetch without waiting for a new append event', async () => {
    const timers = createTimerHarness();
    const eventSource = createEventSourceHarness();
    const catchUpCalls = [];

    const subscription = subscribeToCircleDiscussionStream({
        circleId: 49,
        streamUrl: 'http://127.0.0.1:4000/api/v1/discussion/circles/49/stream',
        eventSourceFactory: eventSource.create,
        fetchCatchUp: async (afterLamport) => {
            catchUpCalls.push(afterLamport);
            return createResponse([]);
        },
        fetchTargetedRefresh: async () => createResponse([]),
        getLastLamport: () => 33,
        applyCatchUp: () => {},
        applyTargetedRefresh: () => {},
        isVisible: () => true,
        setTimeoutFn: timers.setTimeout,
        clearTimeoutFn: timers.clearTimeout,
    });

    eventSource.sources[0].emitOpen();
    await timers.advance(3000);
    assert.deepEqual(catchUpCalls, []);

    eventSource.sources[0].emitError();
    eventSource.sources[0].emitOpen();

    await timers.advance(3000);
    assert.deepEqual(catchUpCalls, [33]);

    subscription.close();
});

test('targeted refresh events refresh only envelope-scoped messages and can coexist with append catch-up', async () => {
    const timers = createTimerHarness();
    const eventSource = createEventSourceHarness();
    const catchUpCalls = [];
    const targetedCalls = [];

    const subscription = subscribeToCircleDiscussionStream({
        circleId: 49,
        streamUrl: 'http://127.0.0.1:4000/api/v1/discussion/circles/49/stream',
        eventSourceFactory: eventSource.create,
        fetchCatchUp: async (afterLamport) => {
            catchUpCalls.push(afterLamport);
            return createResponse([{ envelopeId: 'env-40', lamport: 40 }]);
        },
        fetchTargetedRefresh: async (envelopeIds) => {
            targetedCalls.push(envelopeIds);
            return createResponse([{ envelopeId: envelopeIds[0], lamport: 12 }]);
        },
        getLastLamport: () => 10,
        applyCatchUp: () => {},
        applyTargetedRefresh: () => {},
        isVisible: () => true,
        setTimeoutFn: timers.setTimeout,
        clearTimeoutFn: timers.clearTimeout,
    });

    eventSource.sources[0].emit('message_changed', {
        circleId: 49,
        latestLamport: 40,
        envelopeId: 'env-40',
        reason: 'message_created',
    });
    eventSource.sources[0].emit('message_changed', {
        circleId: 49,
        latestLamport: null,
        envelopeId: 'env-highlight',
        reason: 'message_refresh_required',
    });

    await timers.advance(3000);

    assert.deepEqual(catchUpCalls, [10]);
    assert.deepEqual(targetedCalls, [['env-highlight']]);

    subscription.close();
});
