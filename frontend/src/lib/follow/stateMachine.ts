export const FOLLOW_INDEX_TIMEOUT_RECOVERY_POLL_MS = 3_000;
export const FOLLOW_INDEX_TIMEOUT_RECOVERY_WINDOW_MS = 90_000;

export type PendingFollowStatus = 'syncing' | 'indexed' | 'index_timeout';

export interface PendingFollowState {
    userId: number;
    desiredFollowState: boolean;
    status: PendingFollowStatus;
    startedAt: number;
    expiresAt: number;
}

export interface ResolvedFollowViewState {
    viewerFollows: boolean;
    syncing: boolean;
    indexTimeout: boolean;
    pendingActive: boolean;
}

export function normalizeFollowTargetPubkey(targetPubkey: string | null | undefined): string | null {
    const normalized = String(targetPubkey || '').trim();
    return normalized.length > 0 ? normalized : null;
}

export function createPendingFollowState(
    userId: number,
    desiredFollowState: boolean,
    nowMs = Date.now(),
): PendingFollowState {
    return {
        userId,
        desiredFollowState,
        status: 'syncing',
        startedAt: nowMs,
        expiresAt: nowMs + FOLLOW_INDEX_TIMEOUT_RECOVERY_WINDOW_MS,
    };
}

export function markPendingFollowIndexTimeout(
    pending: PendingFollowState,
    nowMs = Date.now(),
): PendingFollowState {
    return {
        ...pending,
        status: 'index_timeout',
        startedAt: pending.startedAt || nowMs,
        expiresAt: pending.expiresAt || (nowMs + FOLLOW_INDEX_TIMEOUT_RECOVERY_WINDOW_MS),
    };
}

export function markPendingFollowIndexed(
    pending: PendingFollowState,
    nowMs = Date.now(),
): PendingFollowState {
    return {
        ...pending,
        status: 'indexed',
        startedAt: pending.startedAt || nowMs,
        expiresAt: pending.expiresAt || (nowMs + FOLLOW_INDEX_TIMEOUT_RECOVERY_WINDOW_MS),
    };
}

export function hasPendingFollowExpired(
    pending: PendingFollowState | null | undefined,
    nowMs = Date.now(),
): boolean {
    if (!pending) return true;
    return nowMs > pending.expiresAt;
}

export function shouldClearPendingFollow(
    pending: PendingFollowState | null | undefined,
    serverViewerFollows: boolean,
    nowMs = Date.now(),
): boolean {
    if (!pending) return true;
    if (serverViewerFollows === pending.desiredFollowState) return true;
    return hasPendingFollowExpired(pending, nowMs);
}

export function resolveFollowStateFromServer(input: {
    serverViewerFollows: boolean;
    pendingState?: PendingFollowState | null;
    nowMs?: number;
}): ResolvedFollowViewState {
    const nowMs = input.nowMs ?? Date.now();
    const pending = input.pendingState;

    if (!pending || hasPendingFollowExpired(pending, nowMs)) {
        return {
            viewerFollows: input.serverViewerFollows,
            syncing: false,
            indexTimeout: false,
            pendingActive: false,
        };
    }

    return {
        viewerFollows: pending.desiredFollowState,
        syncing: pending.status === 'syncing',
        indexTimeout: pending.status === 'index_timeout',
        pendingActive: true,
    };
}

export function canStartFollowWrite(inFlightUserId: number | null): boolean {
    return inFlightUserId === null;
}

export function beginFollowWrite(targetUserId: number): number {
    return targetUserId;
}

export function completeFollowWrite(inFlightUserId: number | null, targetUserId: number): number | null {
    if (inFlightUserId === targetUserId) return null;
    return inFlightUserId;
}
