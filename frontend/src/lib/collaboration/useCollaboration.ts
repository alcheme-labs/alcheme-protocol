'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { resolveCollabWsBaseUrl } from '@/lib/config/nodeRouting';

/* ════════════════════════════════════════════════════
   useCollaboration — Yjs document lifecycle hook
   ════════════════════════════════════════════════════
   Phase 1: Local Y.Doc per draft (no server)
   Phase 2: Swap in WebsocketProvider to connect to
            y-websocket backend service.
   ════════════════════════════════════════════════════ */

export interface CollabUser {
    name: string;
    color: string;
    /** Wallet address or user ID */
    id: string;
}

interface UseCollaborationReturn {
    /** Yjs document for this draft */
    ydoc: Y.Doc;
    /** Whether the provider is connected */
    isConnected: boolean;
    /** Currently connected collaborators */
    connectedUsers: CollabUser[];
    /** Cleanup function */
    destroy: () => void;
}

/** Palette for collaboration cursors */
const COLLAB_COLORS = [
    '#C7A86B', // gold
    '#7FAACC', // light blue
    '#E6A07C', // coral
    '#8FBC8F', // sage
    '#C9A0DC', // lavender
    '#F0C674', // sand
];

const LOCAL_COLLAB_USER_KEY = 'alcheme_collab_user';

function collabEnabled(): boolean {
    return process.env.NEXT_PUBLIC_COLLAB_ENABLED !== 'false';
}

function randomId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function pickColor(id: string): string {
    const hash = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
}

function getLocalUser(): CollabUser {
    if (typeof window === 'undefined') {
        return { id: 'local-dev', name: 'me.sol', color: COLLAB_COLORS[0] };
    }

    try {
        const cached = window.localStorage.getItem(LOCAL_COLLAB_USER_KEY);
        if (cached) {
            const parsed = JSON.parse(cached) as CollabUser;
            if (parsed?.id && parsed?.name && parsed?.color) {
                return parsed;
            }
        }
    } catch {
        // Ignore malformed local value and regenerate.
    }

    const user: CollabUser = {
        id: randomId('collab'),
        name: 'me.sol',
        color: pickColor(randomId('seed')),
    };

    try {
        window.localStorage.setItem(LOCAL_COLLAB_USER_KEY, JSON.stringify(user));
    } catch {
        // Ignore localStorage quota or privacy mode failures.
    }

    return user;
}

function getOptionalCollabToken(): string | undefined {
    if (typeof window === 'undefined') return undefined;

    try {
        const fromStorage = window.localStorage.getItem('alcheme_collab_token');
        if (fromStorage && fromStorage.trim().length > 0) {
            return fromStorage.trim();
        }
    } catch {
        // Ignore localStorage access failures.
    }

    const fromEnv = process.env.NEXT_PUBLIC_COLLAB_TOKEN;
    if (fromEnv && fromEnv.trim().length > 0) {
        return fromEnv.trim();
    }

    return undefined;
}

function listConnectedUsers(provider: WebsocketProvider, fallbackUser: CollabUser): CollabUser[] {
    const users: CollabUser[] = [];
    provider.awareness.getStates().forEach((state: any) => {
        const user = state?.user;
        if (!user || !user.id) return;
        users.push({
            id: String(user.id),
            name: String(user.name || 'anon'),
            color: String(user.color || pickColor(String(user.id))),
        });
    });

    if (users.length === 0) {
        return [fallbackUser];
    }

    return users;
}

/**
 * Manages a Yjs document for a given draft.
 *
 * Connects to y-websocket with local fallback:
 * - If WS is available, provides multi-user real-time sync.
 * - If WS/auth fails, editor still works locally (single-user).
 */
export function useCollaboration(draftId: string): UseCollaborationReturn {
    const roomName = `crucible-${draftId}`;

    const ydoc = useMemo(() => {
        const doc = new Y.Doc();
        // Tag with room name for debugging
        doc.gc = true;
        return doc;
    }, [roomName]); // eslint-disable-line react-hooks/exhaustive-deps

    const localUser = useMemo(() => getLocalUser(), []);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState<CollabUser[]>([localUser]);

    useEffect(() => {
        if (!collabEnabled()) {
            setIsConnected(false);
            setConnectedUsers([localUser]);
            return;
        }

        let provider: WebsocketProvider | null = null;
        let cancelled = false;
        let onStatus: ((event: { status: string }) => void) | null = null;
        let onAwarenessChange: (() => void) | null = null;

        void (async () => {
            const wsBaseUrl = await resolveCollabWsBaseUrl();
            if (cancelled) return;
            const token = getOptionalCollabToken();

            provider = new WebsocketProvider(wsBaseUrl, roomName, ydoc, {
                connect: true,
                params: token ? { token } : undefined,
            });
            providerRef.current = provider;

            provider.awareness.setLocalStateField('user', localUser);
            setConnectedUsers(listConnectedUsers(provider, localUser));

            onStatus = (event: { status: string }) => {
                setIsConnected(event.status === 'connected');
                if (event.status !== 'connected') {
                    setConnectedUsers([localUser]);
                }
            };
            onAwarenessChange = () => {
                setConnectedUsers(listConnectedUsers(provider!, localUser));
            };

            provider.on('status', onStatus);
            provider.awareness.on('change', onAwarenessChange);
        })();

        return () => {
            cancelled = true;
            if (provider) {
                if (onAwarenessChange) {
                    provider.awareness.off('change', onAwarenessChange);
                }
                if (onStatus) {
                    provider.off('status', onStatus);
                }
                provider.destroy();
            }
            if (providerRef.current === provider) {
                providerRef.current = null;
            }
            setIsConnected(false);
            setConnectedUsers([localUser]);
        };
    }, [localUser, roomName, ydoc]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            providerRef.current?.destroy();
            providerRef.current = null;
            ydoc.destroy();
        };
    }, [ydoc]);

    const destroy = () => {
        providerRef.current?.destroy();
        providerRef.current = null;
        ydoc.destroy();
        setIsConnected(false);
        setConnectedUsers([localUser]);
    };

    return {
        ydoc,
        isConnected,
        connectedUsers,
        destroy,
    };
}
