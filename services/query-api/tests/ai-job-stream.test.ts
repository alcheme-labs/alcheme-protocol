import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { aiJobsRouter } from '../src/rest/ai-jobs';
import { publishAiJobStreamEvent } from '../src/services/aiJobs/stream';

function getRouteHandler(router: Router, path: string, method: 'get') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = layer?.route?.stack?.find((entry: any) => entry.method === method);
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

describe('ai job stream route', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('stream route emits minimal ai job status events through a dedicated SSE endpoint', async () => {
        const prisma = {
            aiJob: {
                findUnique: jest.fn(async () => ({
                    id: 12,
                    jobType: 'ghost_draft_generate',
                    dedupeKey: 'ghost:12',
                    scopeType: 'draft',
                    scopeDraftPostId: 42,
                    scopeCircleId: 7,
                    requestedByUserId: 9,
                    status: 'queued',
                    attempts: 0,
                    maxAttempts: 3,
                    availableAt: new Date('2026-03-24T20:00:00.000Z'),
                    claimedAt: null,
                    completedAt: null,
                    workerId: null,
                    claimToken: null,
                    payloadJson: { postId: 42 },
                    resultJson: null,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    createdAt: new Date('2026-03-24T20:00:00.000Z'),
                    updatedAt: new Date('2026-03-24T20:00:00.000Z'),
                })),
            },
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
        } as any;

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:jobId/stream', 'get');
        const res = createMockSseResponse();
        let closeHandler: (() => void) | undefined;

        await handler(
            {
                params: { jobId: '12' },
                userId: 8,
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
        expect(res.chunks.join('')).toContain('"status":"queued"');
        expect(res.chunks.join('')).not.toContain('draftText');

        publishAiJobStreamEvent({
            id: 12,
            jobType: 'ghost_draft_generate',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            status: 'succeeded',
            attempts: 1,
            maxAttempts: 3,
            availableAt: new Date('2026-03-24T20:00:00.000Z'),
            claimedAt: null,
            completedAt: new Date('2026-03-24T20:00:03.000Z'),
            workerId: null,
            claimToken: null,
            dedupeKey: 'ghost:12',
            payload: { postId: 42 },
            result: {
                generationId: 99,
                postId: 42,
                autoApplied: false,
            },
            lastErrorCode: null,
            lastErrorMessage: null,
            createdAt: new Date('2026-03-24T20:00:00.000Z'),
            updatedAt: new Date('2026-03-24T20:00:03.000Z'),
        } as any);

        expect(res.chunks.join('')).toContain('"generationId":99');
        expect(res.chunks.join('')).not.toContain('workingCopyContent');

        if (closeHandler) {
            closeHandler();
        }
    });

    test('stream route can observe terminal job state via authoritative db polling even without an in-process publish', async () => {
        const rows = [
            {
                id: 12,
                jobType: 'ghost_draft_generate',
                dedupeKey: 'ghost:12',
                scopeType: 'draft',
                scopeDraftPostId: 42,
                scopeCircleId: 7,
                requestedByUserId: 9,
                status: 'queued',
                attempts: 0,
                maxAttempts: 3,
                availableAt: new Date('2026-03-24T20:00:00.000Z'),
                claimedAt: null,
                completedAt: null,
                workerId: null,
                claimToken: null,
                payloadJson: { postId: 42 },
                resultJson: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                createdAt: new Date('2026-03-24T20:00:00.000Z'),
                updatedAt: new Date('2026-03-24T20:00:00.000Z'),
            },
            {
                id: 12,
                jobType: 'ghost_draft_generate',
                dedupeKey: 'ghost:12',
                scopeType: 'draft',
                scopeDraftPostId: 42,
                scopeCircleId: 7,
                requestedByUserId: 9,
                status: 'succeeded',
                attempts: 1,
                maxAttempts: 3,
                availableAt: new Date('2026-03-24T20:00:00.000Z'),
                claimedAt: null,
                completedAt: new Date('2026-03-24T20:00:02.000Z'),
                workerId: null,
                claimToken: null,
                payloadJson: { postId: 42 },
                resultJson: { generationId: 99, postId: 42 },
                lastErrorCode: null,
                lastErrorMessage: null,
                createdAt: new Date('2026-03-24T20:00:00.000Z'),
                updatedAt: new Date('2026-03-24T20:00:02.000Z'),
            },
        ];
        const findUniqueMock = jest.fn(async () => rows.shift() || rows[rows.length - 1] || null);
        const prisma = {
            aiJob: {
                findUnique: findUniqueMock,
            },
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
        } as any;

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:jobId/stream', 'get');
        const res = createMockSseResponse();
        let closeHandler: (() => void) | undefined;

        await handler(
            {
                params: { jobId: '12' },
                userId: 8,
                on(event: string, callback: () => void) {
                    if (event === 'close') closeHandler = callback;
                    return this;
                },
            } as any,
            res as any,
            jest.fn(),
        );

        await jest.advanceTimersByTimeAsync(1_250);

        expect(res.chunks.join('')).toContain('"status":"succeeded"');
        expect(res.chunks.join('')).toContain('"generationId":99');

        if (closeHandler) {
            closeHandler();
        }
    });
});
