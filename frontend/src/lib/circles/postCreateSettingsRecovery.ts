import type { CirclePostCreateSettingsPatch } from '@/lib/api/circlesPostCreateSettings';

export interface PendingPostCreateSettingsRecord {
    circleId: number;
    patch: CirclePostCreateSettingsPatch;
    createdAt: string;
    reason: 'read_model_pending' | 'sync_failed' | 'requires_governance';
}

const STORAGE_PREFIX = 'alcheme.pendingPostCreateSettings.';

function getStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function keyFor(circleId: number): string {
    return `${STORAGE_PREFIX}${circleId}`;
}

function hasPatchFields(patch: CirclePostCreateSettingsPatch): boolean {
    return Object.keys(patch).length > 0;
}

function normalizePendingReason(value: unknown): PendingPostCreateSettingsRecord['reason'] {
    if (value === 'sync_failed' || value === 'requires_governance') {
        return value;
    }
    return 'read_model_pending';
}

export function savePendingPostCreateSettings(record: PendingPostCreateSettingsRecord): void {
    if (!hasPatchFields(record.patch)) return;
    const storage = getStorage();
    if (!storage) return;
    storage.setItem(keyFor(record.circleId), JSON.stringify(record));
}

export function loadPendingPostCreateSettings(circleId: number): PendingPostCreateSettingsRecord | null {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(keyFor(circleId));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (
            !parsed
            || Number(parsed.circleId) !== circleId
            || !parsed.patch
            || typeof parsed.patch !== 'object'
        ) {
            return null;
        }
        return {
            circleId,
            patch: parsed.patch,
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
            reason: normalizePendingReason(parsed.reason),
        };
    } catch {
        return null;
    }
}

export function clearPendingPostCreateSettings(circleId: number): void {
    const storage = getStorage();
    if (!storage) return;
    storage.removeItem(keyFor(circleId));
}
