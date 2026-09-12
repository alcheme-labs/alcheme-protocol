export interface CollabUser {
    name: string;
    color: string;
    /** Wallet address or user ID */
    id: string;
}

export interface DraftSavedSignal {
    draftId: string;
    workingCopyHash: string;
    updatedAt?: string | null;
    actorId: string;
    nonce: string;
    at: string;
}

export interface ActiveBlockEditor extends CollabUser {
    clientId: number;
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

export function pickCollaborationColor(id: string): string {
    const hash = Array.from(id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return COLLAB_COLORS[hash % COLLAB_COLORS.length];
}

export function resolveCollaborationAwarenessSnapshot(
    states: Iterable<[number, any]>,
    localUser: CollabUser,
    draftId: string,
): {
    connectedUsers: CollabUser[];
    activeEditorsByBlockId: Record<string, ActiveBlockEditor[]>;
    latestRemoteSavedSignal: DraftSavedSignal | null;
} {
    const connectedUsers: CollabUser[] = [];
    const activeEditorsByBlockId: Record<string, ActiveBlockEditor[]> = {};
    let latestRemoteSavedSignal: DraftSavedSignal | null = null;
    let latestRemoteSavedAt = 0;

    Array.from(states).forEach(([clientId, state]) => {
        const user = state?.user;
        if (!user || !user.id) return;
        const collabUser: CollabUser = {
            id: String(user.id),
            name: String(user.name || 'anon'),
            color: String(user.color || pickCollaborationColor(String(user.id))),
        };
        connectedUsers.push(collabUser);

        const isLocalUser = collabUser.id === localUser.id;
        const editingBlockId = typeof state?.editingBlockId === 'string'
            ? state.editingBlockId.trim()
            : '';
        if (!isLocalUser && editingBlockId) {
            activeEditorsByBlockId[editingBlockId] = [
                ...(activeEditorsByBlockId[editingBlockId] || []),
                {
                    ...collabUser,
                    clientId,
                },
            ];
        }

        const signal = state?.draftSavedSignal;
        const signalDraftId = typeof signal?.draftId === 'string' ? signal.draftId : '';
        const signalHash = typeof signal?.workingCopyHash === 'string' ? signal.workingCopyHash : '';
        const signalActorId = typeof signal?.actorId === 'string' ? signal.actorId : '';
        const signalAt = typeof signal?.at === 'string' ? Date.parse(signal.at) : 0;
        if (
            draftId
            && signalDraftId === draftId
            && signalHash
            && signalActorId !== localUser.id
            && Number.isFinite(signalAt)
            && signalAt >= latestRemoteSavedAt
        ) {
            latestRemoteSavedAt = signalAt;
            latestRemoteSavedSignal = {
                draftId: signalDraftId,
                workingCopyHash: signalHash,
                updatedAt: typeof signal?.updatedAt === 'string' ? signal.updatedAt : null,
                actorId: signalActorId,
                nonce: typeof signal?.nonce === 'string' ? signal.nonce : '',
                at: signal.at,
            };
        }
    });

    return {
        connectedUsers,
        activeEditorsByBlockId,
        latestRemoteSavedSignal,
    };
}
