'use client';

import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import { authenticatedApiFetch } from '@/lib/api/fetch';

export interface SessionUser {
    id: number;
    pubkey: string;
    handle: string;
    displayName: string | null;
    avatarUri: string | null;
    createdAt: string;
}

export interface SessionMeResponse {
    authenticated: boolean;
    user?: SessionUser;
}

export interface PublicDemoAdmissionPolicy {
    required: boolean;
    version: string;
    jurisdiction: 'US';
    minimumAge: 18;
    supportedRegions: readonly ('US' | 'OTHER')[];
    chinaAvailability: 'unavailable_pending_separate_compliance';
    dataBoundary: 'attestation_only_no_birth_date_or_identity_document';
}

export interface PublicDemoAdmissionInput {
    policyVersion: string;
    jurisdiction: 'US';
    region: 'US' | 'OTHER' | 'CN';
    adultAttested: true;
    termsAccepted: true;
    privacyAccepted: true;
    safetyPolicyAccepted: true;
}

export interface EnsureWalletSessionInput {
    publicKey: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    publicDemoAdmission?: PublicDemoAdmissionInput;
}

export interface EnsureWalletSessionResult {
    status: 'already_authenticated' | 'created' | 'switched_wallet';
}

export type QueryApiErrorCode =
    | 'identity_not_registered'
    | 'identity_verification_unavailable'
    | 'invalid_signature'
    | 'public_demo_admission_required'
    | 'public_demo_admission_invalid'
    | 'public_demo_region_not_supported'
    | 'unknown';

export class QueryApiRequestError extends Error {
    readonly status: number;
    readonly code: QueryApiErrorCode;
    readonly body: unknown;

    constructor(input: {
        status: number;
        code?: string;
        message: string;
        body: unknown;
    }) {
        super(input.message);
        this.name = 'QueryApiRequestError';
        this.status = input.status;
        this.code = normalizeErrorCode(input.code);
        this.body = input.body;
    }
}

const inflightSessionRequests = new Map<string, Promise<EnsureWalletSessionResult>>();

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function normalizeErrorCode(code: unknown): QueryApiErrorCode {
    const normalized = String(code || '').trim();
    if (normalized === 'identity_not_registered') return normalized;
    if (normalized === 'identity_verification_unavailable') return normalized;
    if (normalized === 'invalid_signature') return normalized;
    if (normalized === 'public_demo_admission_required') return normalized;
    if (normalized === 'public_demo_admission_invalid') return normalized;
    if (normalized === 'public_demo_region_not_supported') return normalized;
    return 'unknown';
}

async function parseJsonBody<T>(response: Response): Promise<T | null> {
    const raw = await response.text();
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

async function fetchJsonOrThrow(input: RequestInfo | URL, init?: RequestInit): Promise<any> {
    const response = await authenticatedApiFetch(input, { init });
    if (!response.ok) {
        const body = await parseJsonBody<Record<string, unknown>>(response);
        const fallback = response.statusText || 'Request failed';
        const message = String(body?.error || body?.message || fallback);
        throw new QueryApiRequestError({
            status: response.status,
            code: typeof body?.code === 'string' ? body.code : undefined,
            message: `${response.status} ${message}`,
            body,
        });
    }
    return parseJsonBody(response);
}

export function isIdentityNotRegisteredError(error: unknown): boolean {
    return error instanceof QueryApiRequestError
        && error.status === 401
        && error.code === 'identity_not_registered';
}

export function isIdentityVerificationUnavailableError(error: unknown): boolean {
    return error instanceof QueryApiRequestError
        && error.status === 503
        && error.code === 'identity_verification_unavailable';
}

export function isPublicDemoAdmissionRequiredError(error: unknown): boolean {
    return error instanceof QueryApiRequestError
        && error.status === 403
        && (
            error.code === 'public_demo_admission_required'
            || error.code === 'public_demo_admission_invalid'
        );
}

export function isPublicDemoRegionNotSupportedError(error: unknown): boolean {
    return error instanceof QueryApiRequestError
        && error.status === 403
        && error.code === 'public_demo_region_not_supported';
}

export async function fetchPublicDemoAdmissionPolicy(): Promise<PublicDemoAdmissionPolicy> {
    const route = await resolveNodeRoute('auth_session');
    return fetchJsonOrThrow(`${route.urlBase}/api/v1/auth/public-demo-policy`, {
        method: 'GET',
        cache: 'no-store',
    });
}

export async function fetchSessionMe(): Promise<SessionMeResponse> {
    const route = await resolveNodeRoute('auth_session');
    const baseUrl = route.urlBase;
    return fetchJsonOrThrow(`${baseUrl}/api/v1/auth/session/me`, {
        method: 'GET',
        cache: 'no-store',
    });
}

export async function logoutSession(): Promise<void> {
    const route = await resolveNodeRoute('auth_session');
    const baseUrl = route.urlBase;
    await fetchJsonOrThrow(`${baseUrl}/api/v1/auth/session/logout`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });
}

export async function ensureWalletSession(
    input: EnsureWalletSessionInput,
): Promise<EnsureWalletSessionResult> {
    const publicKey = String(input.publicKey || '').trim();
    if (!publicKey) {
        throw new Error('publicKey is required');
    }

    const existingRequest = inflightSessionRequests.get(publicKey);
    if (existingRequest) {
        return existingRequest;
    }

    const request = (async (): Promise<EnsureWalletSessionResult> => {
        let before: SessionMeResponse;
        try {
            before = await fetchSessionMe();
        } catch (error) {
            if (!input.publicDemoAdmission || !isPublicDemoAdmissionRequiredError(error)) {
                throw error;
            }
            before = { authenticated: false };
        }
        if (before.authenticated && before.user?.pubkey === publicKey) {
            return { status: 'already_authenticated' };
        }

        if (before.authenticated && before.user?.pubkey && before.user.pubkey !== publicKey) {
            await logoutSession();
        }

        const route = await resolveNodeRoute('auth_session');
        const baseUrl = route.urlBase;
        const nonceQuery = new URLSearchParams({ publicKey });
        if (input.publicDemoAdmission) {
            nonceQuery.set('admissionPolicyVersion', input.publicDemoAdmission.policyVersion);
            nonceQuery.set('admissionJurisdiction', input.publicDemoAdmission.jurisdiction);
            nonceQuery.set('admissionRegion', input.publicDemoAdmission.region);
            nonceQuery.set('adultAttested', 'true');
            nonceQuery.set('termsAccepted', 'true');
            nonceQuery.set('privacyAccepted', 'true');
            nonceQuery.set('safetyPolicyAccepted', 'true');
        }
        const noncePayload = await fetchJsonOrThrow(
            `${baseUrl}/api/v1/auth/session/nonce?${nonceQuery.toString()}`,
            {
                method: 'GET',
                cache: 'no-store',
            },
        );
        const message = String(noncePayload?.message || '');
        if (!message) {
            throw new Error('session nonce response missing message');
        }

        let signature: string | undefined;
        if (input.signMessage) {
            const signatureBytes = await input.signMessage(new TextEncoder().encode(message));
            signature = bytesToBase64(signatureBytes);
        }

        await fetchJsonOrThrow(`${baseUrl}/api/v1/auth/session/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                publicKey,
                message,
                signature,
            }),
        });

        return {
            status:
                before.authenticated && before.user?.pubkey && before.user.pubkey !== publicKey
                    ? 'switched_wallet'
                    : 'created',
        };
    })();

    inflightSessionRequests.set(publicKey, request);
    try {
        return await request;
    } finally {
        if (inflightSessionRequests.get(publicKey) === request) {
            inflightSessionRequests.delete(publicKey);
        }
    }
}
