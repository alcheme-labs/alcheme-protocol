import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { discussionRouter } from '../src/rest/discussion';

function getRouteHandler(router: Router, path: string, method: 'get') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = [...(layer?.route?.stack || [])]
        .reverse()
        .find((entry: any) => entry.method === method);
    if (!routeLayer?.handle) {
        throw new Error(`route handler not found for ${method.toUpperCase()} ${path}`);
    }
    return routeLayer.handle;
}

function createMockSseResponse() {
    return {
        statusCode: 200,
        headers: {} as Record<string, string>,
        chunks: [] as string[],
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        setHeader(name: string, value: string) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        flushHeaders() {
            return this;
        },
        write(chunk: string) {
            this.chunks.push(chunk);
            return true;
        },
        end() {
            return this;
        },
    };
}

describe('discussion plaza sse route', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('opens an unauthenticated Plaza SSE stream, forwards events, emits heartbeat, and cleans up', async () => {
        let messageHandler: ((channel: string, message: string) => void) | undefined;
        const subscriber = {
            subscribe: jest.fn((channel: string, callback?: (error?: Error | null) => void) => {
                callback?.(null);
                return Promise.resolve(1);
            }),
            on: jest.fn((event: string, callback: (...args: any[]) => void) => {
                if (event === 'message') {
                    messageHandler = callback as (channel: string, message: string) => void;
                }
                return subscriber;
            }),
            unsubscribe: jest.fn(async () => 1),
            quit: jest.fn(async () => 'OK'),
        };
        const redis = {
            duplicate: jest.fn(() => subscriber),
        };
        const router = discussionRouter({} as any, redis as any);
        const handler = getRouteHandler(router, '/circles/:id/stream', 'get');
        const res = createMockSseResponse();
        let closeHandler: (() => void) | undefined;

        await handler(
            {
                params: { id: '49' },
                on(event: string, callback: () => void) {
                    if (event === 'close') closeHandler = callback;
                    return this;
                },
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        expect(res.headers['cache-control']).toBe('no-cache, no-transform');
        expect(redis.duplicate).toHaveBeenCalledTimes(1);
        expect(subscriber.subscribe).toHaveBeenCalledWith('discussion:circle:49');

        messageHandler?.(
            'discussion:circle:49',
            JSON.stringify({
                circleId: 49,
                latestLamport: 123,
                envelopeId: 'env-123',
                reason: 'message_created',
            }),
        );
        messageHandler?.(
            'discussion:circle:49',
            JSON.stringify({
                circleId: 49,
                latestLamport: null,
                envelopeId: 'env-refresh',
                reason: 'message_refresh_required',
            }),
        );

        expect(res.chunks.join('')).toContain('event: message_changed');
        expect(res.chunks.join('')).toContain('"reason":"message_created"');
        expect(res.chunks.join('')).toContain('"reason":"message_refresh_required"');

        await jest.advanceTimersByTimeAsync(15_000);
        expect(res.chunks.join('')).toContain(': keepalive');

        closeHandler?.();

        expect(subscriber.unsubscribe).toHaveBeenCalledWith('discussion:circle:49');
        expect(subscriber.quit).toHaveBeenCalledTimes(1);
    });

    test('returns 503 when redis pubsub is unavailable', async () => {
        const router = discussionRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/stream', 'get');
        const res = {
            statusCode: 200,
            payload: null as any,
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            json(payload: any) {
                this.payload = payload;
                return this;
            },
        };

        await handler(
            {
                params: { id: '49' },
                on() {
                    return this;
                },
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(503);
        expect(res.payload).toEqual(expect.objectContaining({ error: 'discussion_realtime_unavailable' }));
    });
});
