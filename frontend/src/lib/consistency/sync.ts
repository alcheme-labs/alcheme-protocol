import type { Connection } from '@solana/web3.js';
import { resolveNodeRoute } from '@/lib/config/nodeRouting';

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
        peerUrl: string;
        lastRemoteLamport: number;
        lastSuccessAt: string | null;
        lastError: string | null;
        stale: boolean;
    }>;
}

interface WaitOptions {
    timeoutMs?: number;
    pollMs?: number;
}

export type IndexedWaitResult =
    | {
        ok: true;
        indexedSlot: number;
        stale: boolean;
        generatedAt: string | null;
    }
    | {
        ok: false;
        reason: 'timeout' | 'stale';
        indexedSlot: number;
        stale: boolean;
        generatedAt: string | null;
    };

const DEFAULT_SIGNATURE_WAIT_MS = 20_000;
const DEFAULT_INDEX_WAIT_MS = 30_000;
const DEFAULT_POLL_MS = 1_500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchSyncStatus(signal?: AbortSignal): Promise<SyncStatusResponse> {
    const route = await resolveNodeRoute('sync_status');
    const baseUrl = route.urlBase;
    const response = await fetch(`${baseUrl}/sync/status`, {
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
                peerUrl: String(peer.peerUrl || ''),
                lastRemoteLamport: Number(peer.lastRemoteLamport || 0),
                lastSuccessAt: peer.lastSuccessAt ? String(peer.lastSuccessAt) : null,
                lastError: peer.lastError ? String(peer.lastError) : null,
                stale: Boolean(peer.stale),
            }))
            : [],
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
                return {
                    ok: true,
                    indexedSlot: status.indexedSlot,
                    stale: status.stale,
                    generatedAt: status.generatedAt || null,
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
    };
}
