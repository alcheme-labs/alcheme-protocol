import type { IncomingMessage, Server as HttpServer } from 'http';
import type { Socket } from 'net';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import WebSocket, { WebSocketServer } from 'ws';

import {
    getAuthSession,
    getAuthSessionCookieName,
    getCookieValue,
} from '../../../../auth/session';
import {
    checkRateLimitAdmission,
    resolveRateLimitBucketKey,
} from '../../../../middleware/rateLimiter';
import { resolveRequestLocale, type AppLocale } from '../../../../i18n/locale';
import { buildDiscussionRoomKey } from '../../../offchainDiscussion';
import {
    mapRowsToDtos,
} from '../../messagesReadModel';
import {
    normalizeDiscussionRealtimePayload,
    type DiscussionRealtimePayload,
} from '../protocol';
import {
    findDiscussionMessagesAfterLamport,
    mapDiscussionReplayReason,
} from '../replay';
import {
    addDiscussionRealtimeSink,
    removeDiscussionRealtimeSink,
    shutdownDiscussionRealtimeHub,
    type RealtimeSocketSink,
} from '../hub';

const DISCUSSION_REALTIME_WEBSOCKET_PATH = /^\/api\/v1\/discussion\/circles\/([^/?#]+)\/realtime$/;
const DISCUSSION_REALTIME_REPLAY_LIMIT = 200;

let websocketServer: WebSocketServer | null = null;
let upgradeServer: HttpServer | null = null;
let upgradeHandler: ((req: IncomingMessage, socket: Socket, head: Buffer) => void) | null = null;

export interface DiscussionRealtimeReadAdmissionInput {
    circleId: number;
    actorKey: string;
    ip: string;
    userId?: number;
    req: IncomingMessage;
}

export interface DiscussionRealtimeReadAdmissionResult {
    allowed: boolean;
    actorKey: string;
}

export interface DiscussionRealtimeWebSocketOptions {
    readAdmission?: (
        input: DiscussionRealtimeReadAdmissionInput,
    ) => Promise<DiscussionRealtimeReadAdmissionResult> | DiscussionRealtimeReadAdmissionResult;
}

function isDiscussionWebSocketEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    // WebSocket is the default discussion transport. This env is only an
    // operational rollback switch; SSE remains the fallback route, not a
    // separate Plaza discussion product path.
    return String(env.DISCUSSION_WEBSOCKET_ENABLED ?? 'true').toLowerCase() !== 'false';
}

function writeUpgradeResponse(socket: Socket, status: number, reason: string): void {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\n\r\n`);
    socket.destroy();
}

function parseNonNegativeLamport(raw: string | null): bigint | null {
    if (raw === null || raw.trim().length === 0) {
        return BigInt(0);
    }
    if (!/^\d+$/.test(raw.trim())) {
        return null;
    }
    return BigInt(raw.trim());
}

function parseDiscussionRealtimeUrl(req: IncomingMessage): {
    circleId: number;
    afterLamport: bigint;
} | null {
    const url = new URL(req.url || '/', 'http://query-api.local');
    const match = url.pathname.match(DISCUSSION_REALTIME_WEBSOCKET_PATH);
    if (!match) return null;

    const circleId = Number.parseInt(match[1], 10);
    if (!Number.isFinite(circleId) || circleId <= 0) return null;

    const afterLamport = parseNonNegativeLamport(url.searchParams.get('afterLamport'));
    if (afterLamport === null) return null;

    return {
        circleId,
        afterLamport,
    };
}

function resolveDiscussionRealtimeLocale(req: IncomingMessage): AppLocale {
    const url = new URL(req.url || '/', 'http://query-api.local');
    return resolveRequestLocale({
        requestedLocale: url.searchParams.get('locale') ?? req.headers['x-alcheme-locale'],
        acceptLanguage: req.headers['accept-language'],
    });
}

function sendJson(ws: WebSocket, value: unknown): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(value));
}

function sendChanged(ws: WebSocket, payload: DiscussionRealtimePayload): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({
        type: 'message_changed',
        payload,
    }));
    return true;
}

function sendReplayStatus(ws: WebSocket, value: {
    circleId: number;
    afterLamport: bigint;
    ok: boolean;
    truncated: boolean;
    replayedCount: number;
    latestLamport?: number;
}): void {
    sendJson(ws, {
        type: 'replay_status',
        circleId: value.circleId,
        afterLamport: value.afterLamport.toString(),
        ok: value.ok,
        truncated: value.truncated,
        replayedCount: value.replayedCount,
        ...(typeof value.latestLamport === 'number' ? { latestLamport: value.latestLamport } : {}),
    });
}

function resolveRequestIp(req: IncomingMessage): string {
    return String(req.socket?.remoteAddress || (req as any).connection?.remoteAddress || 'unknown');
}

async function resolveDiscussionReadActor(input: {
    req: IncomingMessage;
    redis: Redis;
    circleId: number;
}): Promise<{ actorKey: string; ip: string; userId?: number }> {
    let userId: number | undefined;
    const cookie = input.req.headers?.cookie;
    const cookieHeader = Array.isArray(cookie)
        ? cookie.join('; ')
        : cookie;
    const sessionId = getCookieValue(cookieHeader, getAuthSessionCookieName());
    if (sessionId) {
        try {
            const session = await getAuthSession(input.redis, sessionId);
            const parsedUserId = Number(session?.userId);
            if (Number.isFinite(parsedUserId) && parsedUserId > 0) {
                userId = Math.floor(parsedUserId);
            }
        } catch {
            // Realtime reads stay public when the matching HTTP read is public;
            // session parsing only improves rate-limit actor attribution.
        }
    }

    const ip = resolveRequestIp(input.req);
    return {
        actorKey: resolveRateLimitBucketKey({
            method: 'GET',
            path: `/discussion/circles/${input.circleId}/stream`,
            ip,
            userId,
        }),
        ip,
        ...(typeof userId === 'number' ? { userId } : {}),
    };
}

async function defaultReadAdmission(input: DiscussionRealtimeReadAdmissionInput): Promise<DiscussionRealtimeReadAdmissionResult> {
    const admission = await checkRateLimitAdmission({
        method: 'GET',
        path: `/discussion/circles/${input.circleId}/stream`,
        ip: input.ip,
        userId: input.userId,
    });
    return {
        allowed: admission.allowed,
        actorKey: admission.bucketKey,
    };
}

interface ReplayAwareWebSocketSink extends RealtimeSocketSink {
    sendControl(value: unknown): boolean;
    sendReplayPayload(payload: DiscussionRealtimePayload): boolean;
    finishReplay(): void;
}

function compareRealtimePayloads(left: DiscussionRealtimePayload, right: DiscussionRealtimePayload): number {
    const leftLamport = typeof left.latestLamport === 'number' ? left.latestLamport : Number.MAX_SAFE_INTEGER;
    const rightLamport = typeof right.latestLamport === 'number' ? right.latestLamport : Number.MAX_SAFE_INTEGER;
    if (leftLamport !== rightLamport) return leftLamport - rightLamport;
    return String(left.envelopeId || '').localeCompare(String(right.envelopeId || ''));
}

function createWebSocketSink(ws: WebSocket, id: string): ReplayAwareWebSocketSink {
    let replaying = true;
    const deliveredEnvelopeIds = new Set<string>();
    const bufferedLiveEvents: DiscussionRealtimePayload[] = [];

    const markDelivered = (payload: DiscussionRealtimePayload) => {
        if (payload.envelopeId) {
            deliveredEnvelopeIds.add(payload.envelopeId);
        }
    };

    const sendPayload = (payload: DiscussionRealtimePayload): boolean => {
        const sent = sendChanged(ws, payload);
        if (sent) markDelivered(payload);
        return sent;
    };

    return {
        id,
        kind: 'websocket',
        sendRealtimePayload(payload) {
            if (replaying) {
                if (
                    payload.reason === 'message_refresh_required'
                    && payload.envelopeId
                ) {
                    const existingIndex = bufferedLiveEvents.findIndex((event) =>
                        event.reason === 'message_refresh_required'
                        && event.envelopeId === payload.envelopeId);
                    if (existingIndex >= 0) {
                        bufferedLiveEvents[existingIndex] = payload;
                        return true;
                    }
                }
                bufferedLiveEvents.push(payload);
                return true;
            }
            return sendPayload(payload);
        },
        sendReplayPayload(payload) {
            return sendPayload(payload);
        },
        finishReplay() {
            replaying = false;
            const events = bufferedLiveEvents.splice(0).sort(compareRealtimePayloads);
            for (const event of events) {
                if (event.envelopeId && deliveredEnvelopeIds.has(event.envelopeId)) continue;
                sendPayload(event);
            }
        },
        sendControl(value) {
            if (ws.readyState !== WebSocket.OPEN) return false;
            sendJson(ws, value);
            return true;
        },
        close(code, reason) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(code, reason);
            }
        },
        bufferedAmount() {
            return Number((ws as WebSocket & { bufferedAmount?: number }).bufferedAmount || 0);
        },
        queuedEvents() {
            return bufferedLiveEvents.length;
        },
    };
}

async function replayMissedDiscussionEvents(input: {
    sink: ReplayAwareWebSocketSink;
    prisma: PrismaClient;
    circleId: number;
    afterLamport: bigint;
    locale: AppLocale;
}): Promise<{ replayedCount: number; truncated: boolean; latestLamport?: number }> {
    const rows = await findDiscussionMessagesAfterLamport({
        prisma: input.prisma,
        circleId: input.circleId,
        roomKey: buildDiscussionRoomKey(input.circleId),
        afterLamport: input.afterLamport,
        limit: DISCUSSION_REALTIME_REPLAY_LIMIT,
    });
    const messages = await mapRowsToDtos({
        prisma: input.prisma,
        rows,
        locale: input.locale,
    });

    let latestLamport: number | undefined;
    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        latestLamport = Number(row.lamport);
        input.sink.sendReplayPayload(normalizeDiscussionRealtimePayload({
            circleId: input.circleId,
            latestLamport,
            envelopeId: row.envelopeId,
            reason: mapDiscussionReplayReason(row),
            message: messages[index],
        }));
    }

    return {
        replayedCount: rows.length,
        truncated: rows.length >= DISCUSSION_REALTIME_REPLAY_LIMIT,
        latestLamport,
    };
}

async function attachDiscussionRealtimeConnection(input: {
    ws: WebSocket;
    req: IncomingMessage;
    prisma: PrismaClient;
    redis: Redis;
    options?: DiscussionRealtimeWebSocketOptions;
}): Promise<void> {
    const parsed = parseDiscussionRealtimeUrl(input.req);
    if (!parsed) {
        input.ws.close(1002, 'invalid_discussion_realtime_url');
        return;
    }

    let acknowledgedLamport = parsed.afterLamport;
    const readAdmission = input.options?.readAdmission ?? defaultReadAdmission;
    let cleanup: (() => Promise<void>) | null = null;
    const sink = createWebSocketSink(
        input.ws,
        `ws:${parsed.circleId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    );

    input.ws.on('close', () => {
        void cleanup?.();
    });

    input.ws.on('message', (data) => {
        try {
            const parsedMessage = JSON.parse(data.toString()) as { type?: unknown; latestLamport?: unknown };
            if (parsedMessage.type !== 'ack') return;
            if (typeof parsedMessage.latestLamport === 'number' && Number.isFinite(parsedMessage.latestLamport)) {
                acknowledgedLamport = BigInt(Math.max(0, Math.trunc(parsedMessage.latestLamport)));
            }
        } catch {
            // Ignore malformed client control messages; they are not product data.
        }
    });

    try {
        const actor = await resolveDiscussionReadActor({
            req: input.req,
            redis: input.redis,
            circleId: parsed.circleId,
        });
        const admission = await readAdmission({
            circleId: parsed.circleId,
            actorKey: actor.actorKey,
            ip: actor.ip,
            userId: actor.userId,
            req: input.req,
        });
        if (!admission.allowed) {
            sendReplayStatus(input.ws, {
                circleId: parsed.circleId,
                afterLamport: parsed.afterLamport,
                ok: false,
                truncated: true,
                replayedCount: 0,
            });
            input.ws.close(1008, 'discussion_realtime_read_limited');
            return;
        }

        cleanup = async () => {
            await removeDiscussionRealtimeSink({
                circleId: parsed.circleId,
                sinkId: sink.id,
            });
        };

        await addDiscussionRealtimeSink({
            redis: input.redis,
            circleId: parsed.circleId,
            sink,
        });

        sink.sendControl({
            type: 'ready',
            circleId: parsed.circleId,
            latestLamport: Number(acknowledgedLamport),
        });

        const replayStatus = await replayMissedDiscussionEvents({
            sink,
            prisma: input.prisma,
            circleId: parsed.circleId,
            afterLamport: parsed.afterLamport,
            locale: resolveDiscussionRealtimeLocale(input.req),
        });
        sendReplayStatus(input.ws, {
            circleId: parsed.circleId,
            afterLamport: parsed.afterLamport,
            ok: true,
            truncated: replayStatus.truncated,
            replayedCount: replayStatus.replayedCount,
            latestLamport: replayStatus.latestLamport,
        });
        sink.finishReplay();
    } catch (error) {
        sendReplayStatus(input.ws, {
            circleId: parsed.circleId,
            afterLamport: parsed.afterLamport,
            ok: false,
            truncated: true,
            replayedCount: 0,
        });
        input.ws.close(1011, error instanceof Error ? error.message : 'discussion_realtime_ws_failed');
        await cleanup?.();
    }
}

export function setupDiscussionRealtimeWebSocket(
    server: HttpServer,
    prisma: PrismaClient,
    redis: Redis,
    options: DiscussionRealtimeWebSocketOptions = {},
): void {
    void shutdownDiscussionRealtimeWebSocket();

    websocketServer = new WebSocketServer({ noServer: true });
    websocketServer.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        void attachDiscussionRealtimeConnection({ ws, req, prisma, redis, options });
    });

    upgradeServer = server;
    upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
        const url = new URL(req.url || '/', 'http://query-api.local');
        if (!DISCUSSION_REALTIME_WEBSOCKET_PATH.test(url.pathname)) {
            return;
        }

        if (!isDiscussionWebSocketEnabled()) {
            writeUpgradeResponse(socket, 404, 'Not Found');
            return;
        }

        if (!parseDiscussionRealtimeUrl(req)) {
            writeUpgradeResponse(socket, 400, 'Bad Request');
            return;
        }

        websocketServer?.handleUpgrade(req, socket, head, (ws) => {
            websocketServer?.emit('connection', ws, req);
        });
    };
    server.on('upgrade', upgradeHandler);
}

export async function shutdownDiscussionRealtimeWebSocket(): Promise<void> {
    if (upgradeServer && upgradeHandler) {
        upgradeServer.off('upgrade', upgradeHandler);
    }
    upgradeServer = null;
    upgradeHandler = null;

    const server = websocketServer;
    websocketServer = null;
    if (!server) return;

    for (const client of server.clients) {
        client.close(1001, 'discussion_realtime_shutdown');
    }
    await shutdownDiscussionRealtimeHub();
    await new Promise<void>((resolve) => {
        server.close(() => resolve());
    });
}
