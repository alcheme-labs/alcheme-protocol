import { apiFetch } from './fetch.ts';
import type { Connection } from '@solana/web3.js';
import { resolveNodeRoute } from './nodeRouting.ts';

export interface SyncStatusResponse {
    indexerId: string;
    readCommitment: string;
    indexedSlot: number;
    stale: boolean;
    generatedAt: string;
    offchain?: {
        streamKey: string;
        lastLamport: number;
        lastEnvelopeId: string | null;
        lastIngestedAt: string | null;
        stale: boolean;
    } | null;
    offchainPeers?: Array<{
        peerRef: string;
        lastRemoteLamport: number;
        lastSuccessAt: string | null;
        hasError: boolean;
        stale: boolean;
    }>;
    projectionCompleteness?: ProjectionCompleteness;
}

interface WaitOptions {
    timeoutMs?: number;
    pollMs?: number;
}

export interface ProjectionCompleteness {
    state: 'complete' | 'degraded' | 'unknown';
    unresolvedFailedSlotCount: number;
    oldestUnresolvedFailedSlot: number | null;
    newestUnresolvedFailedSlot: number | null;
}

export type IndexedWaitResult =
    | {
        ok: true;
        indexedSlot: number;
        stale: boolean;
        generatedAt: string | null;
        projectionCompleteness?: ProjectionCompleteness;
    }
    | {
        ok: false;
        reason: 'timeout' | 'stale' | 'degraded' | 'unsafe';
        indexedSlot: number;
        stale: boolean;
        generatedAt: string | null;
        projectionCompleteness?: ProjectionCompleteness;
    };

const DEFAULT_SIGNATURE_WAIT_MS = 20_000;
const DEFAULT_INDEX_WAIT_MS = 30_000;
const DEFAULT_POLL_MS = 1_500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNullableSlot(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeProjectionCompleteness(raw: unknown): ProjectionCompleteness | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const value = raw as Record<string, unknown>;
    const state = typeof value.state === 'string' ? value.state : '';
    if (state !== 'complete' && state !== 'degraded' && state !== 'unknown') return undefined;
    const unresolvedCount = Number(value.unresolvedFailedSlotCount ?? 0);
    return {
        state,
        unresolvedFailedSlotCount: Number.isFinite(unresolvedCount) && unresolvedCount >= 0
            ? unresolvedCount
            : 0,
        oldestUnresolvedFailedSlot: normalizeNullableSlot(value.oldestUnresolvedFailedSlot),
        newestUnresolvedFailedSlot: normalizeNullableSlot(value.newestUnresolvedFailedSlot),
    };
}

function crossesUnresolvedFailedSlot(
    projectionCompleteness: ProjectionCompleteness | undefined,
    targetSlot: number,
): boolean {
    return Boolean(
        projectionCompleteness
        && projectionCompleteness.state === 'degraded'
        && projectionCompleteness.oldestUnresolvedFailedSlot !== null
        && projectionCompleteness.oldestUnresolvedFailedSlot <= targetSlot,
    );
}

function hasUnsafeProjectionCompleteness(
    projectionCompleteness: ProjectionCompleteness | undefined,
): boolean {
    return Boolean(
        projectionCompleteness
        && (
            projectionCompleteness.state === 'unknown'
            || (
                projectionCompleteness.state === 'degraded'
                && projectionCompleteness.unresolvedFailedSlotCount > 0
                && projectionCompleteness.oldestUnresolvedFailedSlot === null
            )
        ),
    );
}

export async function fetchSyncStatus(signal?: AbortSignal): Promise<SyncStatusResponse> {
    const route = await resolveNodeRoute('sync_status');
    const baseUrl = route.urlBase;
    const response = await apiFetch(`${baseUrl}/sync/status`, {
        method: 'GET',
        cache: 'no-store',
        signal,
    });

    if (!response.ok) {
        throw new Error(`sync status request failed: ${response.status}`);
    }

    const json = await response.json();
    return {
        indexerId: String(json.indexerId || ''),
        readCommitment: String(json.readCommitment || ''),
        indexedSlot: Number(json.indexedSlot || 0),
        stale: Boolean(json.stale),
        generatedAt: String(json.generatedAt || ''),
        offchain: json.offchain
            ? {
                streamKey: String(json.offchain.streamKey || ''),
                lastLamport: Number(json.offchain.lastLamport || 0),
                lastEnvelopeId: json.offchain.lastEnvelopeId ? String(json.offchain.lastEnvelopeId) : null,
                lastIngestedAt: json.offchain.lastIngestedAt ? String(json.offchain.lastIngestedAt) : null,
                stale: Boolean(json.offchain.stale),
            }
            : null,
        offchainPeers: Array.isArray(json.offchainPeers)
            ? json.offchainPeers.map((peer: any) => ({
                peerRef: String(peer.peerRef || ''),
                lastRemoteLamport: Number(peer.lastRemoteLamport || 0),
                lastSuccessAt: peer.lastSuccessAt ? String(peer.lastSuccessAt) : null,
                hasError: Boolean(peer.hasError),
                stale: Boolean(peer.stale),
            }))
            : [],
        projectionCompleteness: normalizeProjectionCompleteness(json.projectionCompleteness),
    };
}

export async function waitForSignatureSlot(
    connection: Connection,
    signature: string,
    options: WaitOptions = {},
): Promise<number | null> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SIGNATURE_WAIT_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const statuses = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
        });
        const status = statuses.value[0];
        const slot = status?.slot;

        if (typeof slot === 'number' && slot > 0) {
            return slot;
        }

        await sleep(pollMs);
    }

    return null;
}

export async function waitForIndexedSlot(
    targetSlot: number,
    options: WaitOptions = {},
): Promise<IndexedWaitResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_INDEX_WAIT_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const deadline = Date.now() + timeoutMs;
    let lastKnown: SyncStatusResponse | null = null;

    while (Date.now() < deadline) {
        try {
            const status = await fetchSyncStatus();
            lastKnown = status;
            if (status.indexedSlot >= targetSlot) {
                if (crossesUnresolvedFailedSlot(status.projectionCompleteness, targetSlot)) {
                    return {
                        ok: false,
                        reason: 'degraded',
                        indexedSlot: status.indexedSlot,
                        stale: status.stale,
                        generatedAt: status.generatedAt || null,
                        projectionCompleteness: status.projectionCompleteness,
                    };
                }
                if (hasUnsafeProjectionCompleteness(status.projectionCompleteness)) {
                    return {
                        ok: false,
                        reason: 'unsafe',
                        indexedSlot: status.indexedSlot,
                        stale: status.stale,
                        generatedAt: status.generatedAt || null,
                        projectionCompleteness: status.projectionCompleteness,
                    };
                }
                return {
                    ok: true,
                    indexedSlot: status.indexedSlot,
                    stale: status.stale,
                    generatedAt: status.generatedAt || null,
                    projectionCompleteness: status.projectionCompleteness,
                };
            }
        } catch {
            // ignore transient API errors and continue polling
        }

        await sleep(pollMs);
    }

    return {
        ok: false,
        reason: lastKnown?.stale ? 'stale' : 'timeout',
        indexedSlot: lastKnown?.indexedSlot ?? 0,
        stale: lastKnown?.stale ?? false,
        generatedAt: lastKnown?.generatedAt || null,
        projectionCompleteness: lastKnown?.projectionCompleteness,
    };
}
