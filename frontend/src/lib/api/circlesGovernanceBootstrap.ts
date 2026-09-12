import { authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import {
    parseRetryAfterSeconds,
    runGovernanceBootstrapSingleFlight,
} from './governanceBootstrapRequestControl.mjs';

export class CircleGovernanceBootstrapApiError extends Error {
    readonly status: number;
    readonly retryAfterSeconds: number | null;

    constructor(status: number, message: string, retryAfterSeconds: number | null) {
        super(message);
        this.name = 'CircleGovernanceBootstrapApiError';
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export interface NewCircleGovernanceBootstrapResponse {
    ok: true;
    circleId: number;
    homeIdentityBindingId: string;
    activationState: 'bootstrap_pending';
    chainStateDigest: string;
    observedSlot: number;
}

export interface CircleGovernanceBootstrapPreview {
    schemaVersion: number;
    circleId: number;
    openingInput: {
        ceremonyId: string;
        openedAt: string;
        signatureExpiresAt: string;
        confirmationPolicy: { policy: { waitingPeriodSeconds: number } };
    };
    opening: {
        signedMessage: string;
    };
    [key: string]: unknown;
}

export interface CircleGovernanceBootstrapStatus {
    ok: true;
    circleId: number;
    home: {
        id: string;
        identityVersion: number;
        status: string;
        chainAccountRef: string;
    };
    activation: {
        state: string;
        bootstrapBundleVersion: number | null;
        bootstrapBundleDigest: string | null;
        bootstrapBypassStatus: string;
        failureCode: string | null;
        lastVerifiedAt: string | null;
        activatedAt: string | null;
    };
    runtime: {
        available: boolean;
        blocker: string | null;
        network: 'solana:localnet' | 'solana:devnet' | null;
    };
    latestCeremony: null | {
        id: string;
        state: string;
        waitingPeriodSeconds: number;
        availableAt: string;
        failureCode: string | null;
        effectiveAt: string | null;
        createdAt: string;
        updatedAt: string;
    };
}

async function governanceBootstrapFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const route = await resolveNodeRoute('governance_bootstrap');
    const response = await authenticatedApiFetch(`${route.urlBase}${path}`, init);
    if (!response.ok) {
        throw new CircleGovernanceBootstrapApiError(
            response.status,
            `Circle governance bootstrap failed: ${response.status} ${await response.text()}`,
            parseRetryAfterSeconds(response.headers.get('Retry-After')),
        );
    }
    return response.json() as Promise<T>;
}

export async function fetchCircleGovernanceBootstrapStatus(
    circleId: number,
): Promise<CircleGovernanceBootstrapStatus> {
    return runGovernanceBootstrapSingleFlight(
        `status:${circleId}`,
        () => governanceBootstrapFetch(`/api/v1/circles/${circleId}/governance-bootstrap`),
    );
}

export async function prepareCircleGovernanceBootstrap(
    circleId: number,
): Promise<CircleGovernanceBootstrapPreview> {
    const result = await runGovernanceBootstrapSingleFlight(`preview:${circleId}`, () => governanceBootstrapFetch<{
        ok: true;
        preview: CircleGovernanceBootstrapPreview;
    }>(`/api/v1/circles/${circleId}/governance-bootstrap/ceremony-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
    }));
    return result.preview;
}

export async function openCircleGovernanceBootstrap(input: {
    circleId: number;
    preview: CircleGovernanceBootstrapPreview;
    signatureBase64: string;
}): Promise<{ ok: true; ceremonyId: string; state: string; availableAt: string }> {
    const ceremonyId = encodeURIComponent(input.preview.openingInput.ceremonyId);
    return runGovernanceBootstrapSingleFlight(`open:${input.circleId}:${ceremonyId}`, () => governanceBootstrapFetch(
        `/api/v1/circles/${input.circleId}/governance-bootstrap/ceremonies/${ceremonyId}/open`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preview: input.preview, signatureBase64: input.signatureBase64 }),
        },
    ));
}

export async function activateCircleGovernanceBootstrap(input: {
    circleId: number;
    ceremonyId: string;
}): Promise<{
    ok: true;
    ceremonyId: string;
    state: 'active';
    activationState: 'active';
    effectiveAt: string;
    readbackRef: string;
}> {
    const ceremonyId = encodeURIComponent(input.ceremonyId);
    return runGovernanceBootstrapSingleFlight(`activate:${input.circleId}:${ceremonyId}`, () => governanceBootstrapFetch(
        `/api/v1/circles/${input.circleId}/governance-bootstrap/ceremonies/${ceremonyId}/activate`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        },
    ));
}

export async function syncNewCircleGovernanceBootstrap(input: {
    circleId: number;
    actorPubkey: string;
    creationTxSignature: string;
}): Promise<NewCircleGovernanceBootstrapResponse> {
    const result = await runGovernanceBootstrapSingleFlight(
        `sync:${input.circleId}:${input.creationTxSignature}`,
        () => governanceBootstrapFetch<NewCircleGovernanceBootstrapResponse>(
            `/api/v1/circles/${input.circleId}/governance-bootstrap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
        }),
    );
    if (!result?.ok || result.activationState !== 'bootstrap_pending') {
        throw new Error('new Circle governance bootstrap returned an invalid activation state');
    }
    return result;
}

export async function reenterCircleGovernanceHome(
    circleId: number,
): Promise<NewCircleGovernanceBootstrapResponse> {
    const result = await runGovernanceBootstrapSingleFlight(
        `authoritative-chain-reentry:${circleId}`,
        () => governanceBootstrapFetch<NewCircleGovernanceBootstrapResponse>(
            `/api/v1/circles/${circleId}/governance-bootstrap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'authoritative_chain_reentry' }),
            },
        ),
    );
    if (!result?.ok || result.activationState !== 'bootstrap_pending') {
        throw new Error('Circle governance Home re-entry returned an invalid activation state');
    }
    return result;
}
