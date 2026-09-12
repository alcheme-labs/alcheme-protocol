'use client';

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { resolveCollabWsBaseUrl } from '@/lib/api/nodeRouting';
import {
    pickCollaborationColor,
    resolveCollaborationAwarenessSnapshot,
    type ActiveBlockEditor,
    type CollabUser,
    type DraftSavedSignal,
} from './awareness';

/* ════════════════════════════════════════════════════
   useCollaboration — Yjs document lifecycle hook
   ════════════════════════════════════════════════════
   Phase 1: Local Y.Doc per draft (no server)
   Phase 2: Swap in WebsocketProvider to connect to
            y-websocket backend service.
   ════════════════════════════════════════════════════ */

export interface UseCollaborationOptions {
    viewer?: Partial<CollabUser> | null;
}

interface UseCollaborationReturn {
    /** Yjs document for this draft */
    ydoc: Y.Doc;
    /** Whether the provider is connected */
    isConnected: boolean;
    /** Currently connected collaborators */
    connectedUsers: CollabUser[];
    /** Remote users editing each paragraph block. */
    activeEditorsByBlockId: Record<string, ActiveBlockEditor[]>;
    /** Latest remote saved signal for this draft. */
    latestRemoteSavedSignal: DraftSavedSignal | null;
    /** Broadcast current paragraph editing state. */
    setEditingBlockId: (blockId: string | null) => void;
    /** Broadcast a saved working copy signal. */
    announceDraftSaved: (input: { workingCopyHash: string; updatedAt?: string | null }) => void;
    /** Cleanup function */
    destroy: () => void;
}

const LOCAL_COLLAB_USER_KEY = 'alcheme_collab_user';

function collabEnabled(): boolean {
    return process.env.NEXT_PUBLIC_COLLAB_ENABLED !== 'false';
}

function randomId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getLocalUser(): CollabUser {
    if (typeof window === 'undefined') {
        return { id: 'local-dev', name: 'me.sol', color: pickCollaborationColor('local-dev') };
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
        color: pickCollaborationColor(randomId('seed')),
    };

    try {
        window.localStorage.setItem(LOCAL_COLLAB_USER_KEY, JSON.stringify(user));
    } catch {
        // Ignore localStorage quota or privacy mode failures.
    }

    return user;
}

function normalizeCollabUser(input: Partial<CollabUser> | null | undefined, fallback: CollabUser): CollabUser {
    const rawId = typeof input?.id === 'string' ? input.id.trim() : '';
    const rawName = typeof input?.name === 'string' ? input.name.trim() : '';
    const rawColor = typeof input?.color === 'string' ? input.color.trim() : '';
    const id = rawId || fallback.id;
    return {
        id,
        name: rawName || fallback.name,
        color: rawColor || fallback.color || pickCollaborationColor(id),
    };
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

/**
 * Manages a Yjs document for a given draft.
 *
 * Connects to y-websocket with local fallback:
 * - If WS is available, provides multi-user real-time sync.
 * - If WS/auth fails, editor still works locally (single-user).
 */
export function useCollaboration(
    draftId: string,
    options: UseCollaborationOptions = {},
): UseCollaborationReturn {
    const roomName = `crucible-${draftId}`;

    const ydoc = useMemo(() => {
        const doc = new Y.Doc();
        // Tag with room name for debugging
        doc.gc = true;
        return doc;
    }, [roomName]); // eslint-disable-line react-hooks/exhaustive-deps

    const localFallbackUser = useMemo(() => getLocalUser(), []);
    const localUser = useMemo(
        () => normalizeCollabUser(options.viewer, localFallbackUser),
        [localFallbackUser, options.viewer?.color, options.viewer?.id, options.viewer?.name],
    );
    const localUserRef = useRef(localUser);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [connectedUsers, setConnectedUsers] = useState<CollabUser[]>([localUser]);
    const [activeEditorsByBlockId, setActiveEditorsByBlockId] = useState<Record<string, ActiveBlockEditor[]>>({});
    const [latestRemoteSavedSignal, setLatestRemoteSavedSignal] = useState<DraftSavedSignal | null>(null);

    useEffect(() => {
        localUserRef.current = localUser;
        setConnectedUsers((current) => (current.length === 1 && current[0]?.id === localFallbackUser.id ? [localUser] : current));
        const provider = providerRef.current;
        if (provider) {
            provider.awareness.setLocalStateField('user', localUser);
        }
    }, [localFallbackUser.id, localUser]);

    const updateAwarenessSnapshot = (provider: WebsocketProvider) => {
        const snapshot = resolveCollaborationAwarenessSnapshot(
            provider.awareness.getStates(),
            localUserRef.current,
            draftId,
        );
        setConnectedUsers(snapshot.connectedUsers.length > 0 ? snapshot.connectedUsers : [localUserRef.current]);
        setActiveEditorsByBlockId(snapshot.activeEditorsByBlockId);
        setLatestRemoteSavedSignal(snapshot.latestRemoteSavedSignal);
    };

    useEffect(() => {
        if (!collabEnabled()) {
            setIsConnected(false);
            setConnectedUsers([localUser]);
            setActiveEditorsByBlockId({});
            setLatestRemoteSavedSignal(null);
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
            updateAwarenessSnapshot(provider);

            onStatus = (event: { status: string }) => {
                setIsConnected(event.status === 'connected');
                if (event.status !== 'connected') {
                    setConnectedUsers([localUser]);
                    setActiveEditorsByBlockId({});
                    setLatestRemoteSavedSignal(null);
                }
            };
            onAwarenessChange = () => {
                updateAwarenessSnapshot(provider!);
            };

            provider.on('status', onStatus);
            provider.awareness.on('change', onAwarenessChange);
        })();

        return () => {
            cancelled = true;
            if (provider) {
                provider.awareness.setLocalStateField('editingBlockId', null);
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
            setActiveEditorsByBlockId({});
            setLatestRemoteSavedSignal(null);
        };
    }, [draftId, localUser, roomName, ydoc]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            providerRef.current?.destroy();
            providerRef.current = null;
            ydoc.destroy();
        };
    }, [ydoc]);

    const destroy = () => {
        providerRef.current?.awareness.setLocalStateField('editingBlockId', null);
        providerRef.current?.destroy();
        providerRef.current = null;
        ydoc.destroy();
        setIsConnected(false);
        setConnectedUsers([localUser]);
        setActiveEditorsByBlockId({});
        setLatestRemoteSavedSignal(null);
    };

    const setEditingBlockId = useCallback((blockId: string | null) => {
        const provider = providerRef.current;
        if (!provider) return;
        provider.awareness.setLocalStateField('editingBlockId', blockId);
    }, []);

    const announceDraftSaved = useCallback((input: { workingCopyHash: string; updatedAt?: string | null }) => {
        const provider = providerRef.current;
        if (!provider || !input.workingCopyHash) return;
        const actor = localUserRef.current;
        provider.awareness.setLocalStateField('draftSavedSignal', {
            draftId,
            workingCopyHash: input.workingCopyHash,
            updatedAt: input.updatedAt ?? null,
            actorId: actor.id,
            nonce: randomId('draft-save'),
            at: new Date().toISOString(),
        } satisfies DraftSavedSignal);
    }, [draftId]);

    return {
        ydoc,
        isConnected,
        connectedUsers,
        activeEditorsByBlockId,
        latestRemoteSavedSignal,
        setEditingBlockId,
        announceDraftSaved,
        destroy,
    };
}
