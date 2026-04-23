/**
 * Collaborative Editing — WebSocket Setup
 *
 * Mounts y-websocket onto the existing query-api HTTP server.
 * Supports builtin mode (local y-websocket) and external proxy mode.
 *
 * Endpoint: ws://query-api:4000/collab/{roomName}?token={jwt}
 */

import crypto from 'crypto';
import { Server as HttpServer, IncomingMessage } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import {
    docs as yDocs,
    setPersistence,
    setupWSConnection,
} from 'y-websocket/bin/utils';
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    authenticateCollabRequest,
    CollabAuthError,
    CollabUser,
} from './auth';
import {
    closePersistence,
    getConfiguredCollabStorageInfo,
    getPersistence,
} from './persistence';
import { loadNodeRuntimeConfig, serviceConfig } from '../config/services';
import {
    CollabEditUpdateInput,
    createCollabEditAnchorBatch,
} from '../services/collabEditAnchor';

let wss: WebSocketServer | null = null;

const COLLAP_BATCH_FLUSH_MS = parsePositiveInt(process.env.COLLAB_EDIT_BATCH_FLUSH_MS, 5000);
const COLLAP_BATCH_MAX_UPDATES = parsePositiveInt(process.env.COLLAB_EDIT_BATCH_MAX_UPDATES, 50);

interface CollabUpgradeRequest extends IncomingMessage {
    collabUser?: CollabUser;
    collabRoomName?: string;
}

interface RoomBatchState {
    nextSeq: number;
    pending: CollabEditUpdateInput[];
    timer: NodeJS.Timeout | null;
    flushing: boolean;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseDraftPostIdFromRoom(roomName: string): number | null {
    const match = roomName.match(/^crucible-(\d+)$/);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sha256HexBytes(bytes: Uint8Array): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Setup collaborative editing on the given HTTP server.
 */
export function setupCollaboration(server: HttpServer, prisma: PrismaClient, redis: Redis): void {
    const runtime = loadNodeRuntimeConfig();
    if (runtime.runtimeRole !== 'PRIVATE_SIDECAR') {
        setupPrivateSidecarRequiredGate(server);
        console.log('🤝 Collab: disabled on public node (private sidecar required)');
        return;
    }

    if (serviceConfig.collab.mode === 'external') {
        console.log(`🔌 Collab: external mode → ${serviceConfig.collab.externalUrl}`);
        setupExternalProxy(server);
        return;
    }

    setupBuiltinCollab(server, prisma, redis);
}

/**
 * Builtin mode: run y-websocket server locally on the same port.
 */
function setupBuiltinCollab(server: HttpServer, prisma: PrismaClient, redis: Redis): void {
    const collabStorage = getConfiguredCollabStorageInfo();
    const persistence = getPersistence();
    const wsUserMap = new WeakMap<WebSocket, CollabUser>();
    const roomStates = new Map<string, RoomBatchState>();
    const boundDocNames = new Set<string>();

    const flushRoomBatch = async (roomName: string): Promise<void> => {
        const state = roomStates.get(roomName);
        if (!state || state.flushing || state.pending.length === 0) return;

        const draftPostId = parseDraftPostIdFromRoom(roomName);
        if (!draftPostId) {
            state.pending = [];
            return;
        }

        const pending = state.pending.splice(0, state.pending.length);
        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }
        state.flushing = true;

        try {
            const post = await prisma.post.findUnique({
                where: { id: draftPostId },
                select: { id: true, circleId: true, status: true },
            });
            if (!post?.circleId) {
                return;
            }

            const ydoc = yDocs.get(roomName);
            const snapshotBytes = ydoc ? Y.encodeStateAsUpdate(ydoc) : new Uint8Array();
            const snapshotHash = sha256HexBytes(snapshotBytes);

            const anchor = await createCollabEditAnchorBatch({
                prisma,
                draftPostId: post.id,
                circleId: post.circleId,
                roomKey: roomName,
                snapshotHash,
                updates: pending,
            });

            if (anchor.status === 'failed') {
                console.warn(
                    `🤝 Collab batch anchor failed for ${roomName}: ${anchor.errorMessage || 'unknown_error'}`,
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`🤝 Collab batch flush error for ${roomName}: ${message}`);
        } finally {
            state.flushing = false;
            if (state.pending.length > 0 && !state.timer) {
                state.timer = setTimeout(() => {
                    state.timer = null;
                    void flushRoomBatch(roomName);
                }, Math.min(1000, COLLAP_BATCH_FLUSH_MS));
            }
        }
    };

    const enqueueRoomUpdate = (input: {
        roomName: string;
        update: Uint8Array;
        user: CollabUser | null;
    }): void => {
        let state = roomStates.get(input.roomName);
        if (!state) {
            state = {
                nextSeq: 0,
                pending: [],
                timer: null,
                flushing: false,
            };
            roomStates.set(input.roomName, state);
        }

        state.nextSeq += 1;
        state.pending.push({
            seq: state.nextSeq,
            updateHash: sha256HexBytes(input.update),
            updateBytes: input.update.byteLength,
            editorUserId: input.user?.userId ?? null,
            editorHandle: input.user?.handle ?? null,
            receivedAt: new Date(),
        });

        if (state.pending.length >= COLLAP_BATCH_MAX_UPDATES) {
            void flushRoomBatch(input.roomName);
            return;
        }
        if (!state.timer) {
            state.timer = setTimeout(() => {
                state!.timer = null;
                void flushRoomBatch(input.roomName);
            }, COLLAP_BATCH_FLUSH_MS);
        }
    };

    setPersistence({
        provider: persistence,
        bindState: async (docName: string, ydoc: Y.Doc) => {
            const persistedYdoc = await persistence.getYDoc(docName);
            const initialUpdates = Y.encodeStateAsUpdate(ydoc);
            await persistence.storeUpdate(docName, initialUpdates);
            Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));

            if (boundDocNames.has(docName)) return;
            boundDocNames.add(docName);

            ydoc.on('update', (update: Uint8Array, origin: unknown) => {
                void persistence.storeUpdate(docName, update);
                const user =
                    origin && typeof origin === 'object'
                        ? wsUserMap.get(origin as WebSocket) || null
                        : null;
                enqueueRoomUpdate({
                    roomName: docName,
                    update,
                    user,
                });
            });

            ydoc.on('destroy', () => {
                boundDocNames.delete(docName);
                const state = roomStates.get(docName);
                if (state?.timer) {
                    clearTimeout(state.timer);
                }
                roomStates.delete(docName);
            });
        },
        writeState: async (_docName: string, _ydoc: Y.Doc) => {
            // No-op: updates are already persisted incrementally per Yjs update.
        },
    });

    // Create WebSocket server (no own HTTP server — attached to existing one)
    wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket connections
    wss.on('connection', async (ws: WebSocket, req: IncomingMessage, doc: any) => {
        const collabReq = req as CollabUpgradeRequest;
        if (collabReq.collabUser) {
            wsUserMap.set(ws, collabReq.collabUser);
        }

        const docName = doc?.docName || collabReq.collabRoomName || 'default';
        setupWSConnection(ws, req, {
            docName,
            gc: true, // garbage collection enabled
        });
    });

    // Handle HTTP upgrade to WebSocket
    server.on('upgrade', async (req: IncomingMessage, socket, head) => {
        const url = req.url || '';

        // Only handle /collab/* routes
        if (!url.startsWith('/collab/')) {
            return; // Let other upgrade handlers (e.g., HMR) handle it
        }

        try {
            // Authenticate
            const user = await authenticateCollabRequest(req, prisma, redis);

            // Extract room name from URL
            const roomMatch = url.match(/^\/collab\/([^/?#]+)/);
            const roomName = roomMatch ? decodeURIComponent(roomMatch[1]) : 'default';
            const collabReq = req as CollabUpgradeRequest;
            collabReq.collabUser = user;
            collabReq.collabRoomName = roomName;

            console.log(`🤝 Collab: ${user.handle} (${user.identityLevel}) joined ${roomName}`);

            // Accept the WebSocket upgrade
            wss!.handleUpgrade(req, socket, head, (ws) => {
                wss!.emit('connection', ws, req, { docName: roomName });
            });
        } catch (error) {
            if (error instanceof CollabAuthError) {
                console.warn(`🤝 Collab auth rejected: ${error.message}`);
                socket.write(
                    `HTTP/1.1 ${error.code === 4401 ? 401 : error.code === 4403 ? 403 : 400} ${error.message}\r\n\r\n`,
                );
            } else {
                console.error('🤝 Collab upgrade error:', error);
                socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            }
            socket.destroy();
        }
    });

    console.log(
        `🤝 Collab: builtin y-websocket mounted on /collab/*`
        + ` (storage=${collabStorage.storagePolicy}, shareable=batch_anchors,snapshot_digests,watermarks)`,
    );
}

/**
 * External proxy mode: forward WebSocket connections to external server.
 */
function setupExternalProxy(server: HttpServer): void {
    const targetUrl = serviceConfig.collab.externalUrl;
    if (!targetUrl) {
        console.error('🤝 Collab: COLLAB_EXTERNAL_URL not set, skipping proxy');
        return;
    }

    server.on('upgrade', (req, socket, head) => {
        const url = req.url || '';
        if (!url.startsWith('/collab/')) return;

        // Create proxy connection to external server
        const target = new WebSocket(targetUrl + url.replace('/collab', ''));

        target.on('open', () => {
            // Pipe data bidirectionally
            socket.on('data', (data: Buffer) => target.send(data));
            target.on('message', (data: WebSocket.Data) => {
                if (socket.writable) {
                    socket.write(data as Buffer);
                }
            });
        });

        target.on('error', (err) => {
            console.error('🤝 Collab proxy error:', err);
            socket.destroy();
        });

        socket.on('error', () => target.close());
        socket.on('close', () => target.close());
        target.on('close', () => socket.destroy());
    });

    console.log(`🤝 Collab: proxy mode → ${targetUrl}`);
}

function setupPrivateSidecarRequiredGate(server: HttpServer): void {
    server.on('upgrade', (req, socket) => {
        const url = req.url || '';
        if (!url.startsWith('/collab/')) return;

        const payload = JSON.stringify({
            error: 'private_sidecar_required',
            route: 'collab',
        });
        socket.write(
            'HTTP/1.1 409 Conflict\r\n'
            + 'Content-Type: application/json\r\n'
            + `Content-Length: ${Buffer.byteLength(payload)}\r\n`
            + 'Connection: close\r\n'
            + '\r\n'
            + payload,
        );
        socket.destroy();
    });
}

/**
 * Cleanup on shutdown.
 */
export async function shutdownCollaboration(): Promise<void> {
    if (wss) {
        wss.close();
        wss = null;
    }
    setPersistence(null);
    await closePersistence();
    console.log('🤝 Collab: shutdown complete');
}
