import { apiFetch } from '../api/fetch.ts';
import { resolveNodeRoute } from '../api/nodeRouting.ts';

export interface IndexedIdentityProjection {
    handle: string;
    pubkey: string;
    displayName?: string | null;
    bio?: string | null;
    avatarUri?: string | null;
}

export type IndexedIdentityWaitResult =
    | { ok: true; attempts: number }
    | { ok: false; reason: 'timeout' | 'identity_mismatch'; attempts: number };

interface WaitForIndexedIdentityInput {
    handle: string;
    publicKey: string;
    expectedProfile?: {
        displayName: string;
        bio: string;
        avatarUri?: string;
    };
    timeoutMs?: number;
    pollMs?: number;
    readIdentity?: (handle: string) => Promise<IndexedIdentityProjection | null>;
}

const DEFAULT_IDENTITY_PROJECTION_WAIT_MS = 180_000;
const DEFAULT_IDENTITY_PROJECTION_POLL_MS = 1_500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchIndexedIdentity(
    handle: string,
): Promise<IndexedIdentityProjection | null> {
    const route = await resolveNodeRoute('sync_status');
    const response = await apiFetch(
        `${route.urlBase}/api/v1/users/${encodeURIComponent(handle)}`,
        {
            init: {
                method: 'GET',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
            },
        },
    );

    if (response.status === 404) return null;
    if (!response.ok) {
        throw new Error(`identity projection read failed: ${response.status}`);
    }

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const projectedHandle = typeof payload?.handle === 'string' ? payload.handle : '';
    const projectedPubkey = typeof payload?.pubkey === 'string' ? payload.pubkey : '';
    if (!projectedHandle || !projectedPubkey) {
        throw new Error('identity projection response is incomplete');
    }

    return {
        handle: projectedHandle,
        pubkey: projectedPubkey,
        displayName: typeof payload?.displayName === 'string' ? payload.displayName : null,
        bio: typeof payload?.bio === 'string' ? payload.bio : null,
        avatarUri: typeof payload?.avatarUri === 'string' ? payload.avatarUri : null,
    };
}

function matchesExpectedProfile(
    identity: IndexedIdentityProjection,
    expectedProfile: WaitForIndexedIdentityInput['expectedProfile'],
): boolean {
    if (!expectedProfile) return true;
    if (expectedProfile.avatarUri && (identity.avatarUri ?? '') !== expectedProfile.avatarUri) {
        return false;
    }
    return (identity.displayName ?? '') === expectedProfile.displayName
        && (identity.bio ?? '') === expectedProfile.bio;
}

export async function waitForIndexedIdentity(
    input: WaitForIndexedIdentityInput,
): Promise<IndexedIdentityWaitResult> {
    const timeoutMs = Math.max(1, input.timeoutMs ?? DEFAULT_IDENTITY_PROJECTION_WAIT_MS);
    const pollMs = Math.max(1, input.pollMs ?? DEFAULT_IDENTITY_PROJECTION_POLL_MS);
    const readIdentity = input.readIdentity ?? fetchIndexedIdentity;
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;

    while (Date.now() < deadline) {
        attempts += 1;
        try {
            const identity = await readIdentity(input.handle);
            if (identity) {
                if (identity.handle !== input.handle || identity.pubkey !== input.publicKey) {
                    return { ok: false, reason: 'identity_mismatch', attempts };
                }
                if (matchesExpectedProfile(identity, input.expectedProfile)) {
                    return { ok: true, attempts };
                }
            }
        } catch {
            // Query/API availability is transient during deployment or indexer catch-up.
            // Keep the bounded, identity-specific readback loop alive.
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs > 0) {
            await sleep(Math.min(pollMs, remainingMs));
        }
    }

    return { ok: false, reason: 'timeout', attempts };
}
