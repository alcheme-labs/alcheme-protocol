export interface PendingForkFinalization {
    sourceCircleId: number;
    declarationId: string;
    declarationText: string;
    targetCircleId: number | null;
    executionAnchorDigest: string | null;
    originAnchorRef: string;
    governanceRequestId: string | null;
}

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function getPendingForkFinalizationStorageKey(sourceCircleId: number): string | null {
    const normalizedSourceCircleId = asPositiveInteger(sourceCircleId);
    if (!normalizedSourceCircleId) {
        return null;
    }
    return `alcheme_pending_fork_finalization:${normalizedSourceCircleId}`;
}

function getLocalStorage(): StorageLike | null {
    const root = globalThis as {
        localStorage?: StorageLike;
        window?: {
            localStorage?: StorageLike;
        };
    };
    const storage = root.localStorage ?? root.window?.localStorage ?? null;
    if (
        !storage
        || typeof storage.getItem !== 'function'
        || typeof storage.setItem !== 'function'
        || typeof storage.removeItem !== 'function'
    ) {
        return null;
    }
    return storage;
}

export function readPendingForkFinalization(sourceCircleId: number): PendingForkFinalization | null {
    const storageKey = getPendingForkFinalizationStorageKey(sourceCircleId);
    const storage = getLocalStorage();
    if (!storageKey || !storage) {
        return null;
    }

    try {
        const raw = storage.getItem(storageKey);
        if (!raw) {
            return null;
        }
        const payload = JSON.parse(raw) as Record<string, unknown>;
        const sourceCircleIdValue = asPositiveInteger(payload.sourceCircleId);
        const declarationId = asNonEmptyString(payload.declarationId);
        const declarationText = asNonEmptyString(payload.declarationText);
        const targetCircleId = asPositiveInteger(payload.targetCircleId);
        const executionAnchorDigest = asNonEmptyString(payload.executionAnchorDigest);
        const originAnchorRef = asNonEmptyString(payload.originAnchorRef);
        const governanceRequestId = asNonEmptyString(payload.governanceRequestId);
        const isGovernancePending = Boolean(governanceRequestId && !targetCircleId && !executionAnchorDigest);
        const isFinalizationPending = Boolean(targetCircleId && executionAnchorDigest);

        if (
            !sourceCircleIdValue
            || !declarationId
            || !declarationText
            || !originAnchorRef
            || (!isGovernancePending && !isFinalizationPending)
        ) {
            storage.removeItem(storageKey);
            return null;
        }

        return {
            sourceCircleId: sourceCircleIdValue,
            declarationId,
            declarationText,
            targetCircleId,
            executionAnchorDigest,
            originAnchorRef,
            governanceRequestId,
        };
    } catch {
        try {
            storage.removeItem(storageKey);
        } catch {
            // Ignore storage cleanup failures.
        }
        return null;
    }
}

export function writePendingForkFinalization(value: PendingForkFinalization): void {
    const storageKey = getPendingForkFinalizationStorageKey(value.sourceCircleId);
    const storage = getLocalStorage();
    if (!storageKey || !storage) {
        return;
    }

    try {
        storage.setItem(storageKey, JSON.stringify(value));
    } catch {
        // Ignore storage quota or privacy mode failures.
    }
}

export function clearPendingForkFinalization(sourceCircleId: number): void {
    const storageKey = getPendingForkFinalizationStorageKey(sourceCircleId);
    const storage = getLocalStorage();
    if (!storageKey || !storage) {
        return;
    }

    try {
        storage.removeItem(storageKey);
    } catch {
        // Ignore storage cleanup failures.
    }
}
