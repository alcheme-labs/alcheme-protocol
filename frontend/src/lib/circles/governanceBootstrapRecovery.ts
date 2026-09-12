export interface PendingNewCircleGovernanceBootstrap {
    circleId: number;
    actorPubkey: string;
    creationTxSignature: string;
    createdAt: string;
    reason: 'read_model_pending' | 'sync_failed';
}

const STORAGE_PREFIX = 'alcheme.pendingNewCircleGovernanceBootstrap.';

function storage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

export function savePendingNewCircleGovernanceBootstrap(
    record: PendingNewCircleGovernanceBootstrap,
): void {
    storage()?.setItem(`${STORAGE_PREFIX}${record.circleId}`, JSON.stringify(record));
}

export function clearPendingNewCircleGovernanceBootstrap(circleId: number): void {
    storage()?.removeItem(`${STORAGE_PREFIX}${circleId}`);
}

export function listPendingNewCircleGovernanceBootstraps(
    actorPubkey: string,
): PendingNewCircleGovernanceBootstrap[] {
    const target = storage();
    if (!target) return [];
    const records: PendingNewCircleGovernanceBootstrap[] = [];
    for (let index = 0; index < target.length; index += 1) {
        const key = target.key(index);
        if (!key?.startsWith(STORAGE_PREFIX)) continue;
        try {
            const parsed = JSON.parse(target.getItem(key) ?? 'null');
            if (
                Number.isInteger(parsed?.circleId)
                && parsed.actorPubkey === actorPubkey
                && typeof parsed.creationTxSignature === 'string'
            ) {
                records.push(parsed as PendingNewCircleGovernanceBootstrap);
            }
        } catch {
            // Malformed recovery records are ignored and cannot trigger network writes.
        }
    }
    return records.sort((left, right) => left.circleId - right.circleId);
}
