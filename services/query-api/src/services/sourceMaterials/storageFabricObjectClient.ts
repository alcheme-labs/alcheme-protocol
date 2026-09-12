import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';

import {
    buildStorageGrantV2,
    canonicalJsonBytes,
    createGrantDigest,
    type StorageFabricObjectGrantConfig,
    type StorageGrantV2Payload,
} from './storageFabricObjectGrantMap';

export interface StorageFabricObjectUploadResult {
    objectId: string;
    uploadIntentId: string;
    contentDigest: string;
    receiptId: string;
    receiptDigest: string;
    tenantId: string;
    scopeRef: string;
}

export interface StorageFabricObjectReadResult {
    bytes: Buffer;
    contentType: string | null;
}

export interface StorageFabricObjectClient {
    uploadObject(input: {
        principalRef: string;
        mimeType: string;
        bytes: Buffer;
        idempotencyKey: string;
    }): Promise<StorageFabricObjectUploadResult>;
    readObject(input: {
        principalRef: string;
        objectId: string;
    }): Promise<StorageFabricObjectReadResult>;
}

interface SignedStorageGrant {
    payload: StorageGrantV2Payload;
    signature: string;
    signatureAlgorithm: 'ed25519';
    digest: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createStorageFabricObjectClientFromRuntime(input: {
    runtimeRole: 'PUBLIC_NODE' | 'PRIVATE_SIDECAR';
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
}): StorageFabricObjectClient | undefined {
    if (input.runtimeRole !== 'PRIVATE_SIDECAR') {
        return undefined;
    }
    const env = input.env ?? process.env;
    if (String(env.SOURCE_MATERIAL_STORAGE_FABRIC_OBJECT_ENABLED ?? '').trim() !== 'true') {
        return undefined;
    }
    const baseUrl = String(env.STORAGE_FABRIC_OBJECT_BASE_URL ?? '').trim();
    const signingKey = String(env.STORAGE_FABRIC_OBJECT_GRANT_SIGNING_KEY ?? '').trim();
    if (!signingKey) {
        throw new Error('storage_fabric_object_signing_key_required');
    }
    if (!baseUrl) {
        throw new Error('storage_fabric_object_base_url_required');
    }
    const config = readGrantConfig(env);
    return createStorageFabricObjectClient({
        baseUrl,
        config,
        signingKey,
        fetchImpl: input.fetchImpl ?? fetch,
        timeoutMs: parseTimeout(env.STORAGE_FABRIC_OBJECT_TIMEOUT_MS),
    });
}

export function createStorageFabricObjectClient(input: {
    baseUrl: string;
    config: StorageFabricObjectGrantConfig;
    signingKey: string;
    fetchImpl: typeof fetch;
    timeoutMs?: number;
}): StorageFabricObjectClient {
    const baseUrl = new URL(input.baseUrl);
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const seed = decodeSigningSeed(input.signingKey);
    const keyPair = nacl.sign.keyPair.fromSeed(seed);

    const signGrant = (payload: StorageGrantV2Payload): SignedStorageGrant => {
        const digest = createGrantDigest(payload);
        const signature = nacl.sign.detached(canonicalJsonBytes(payload), keyPair.secretKey);
        return {
            payload,
            signature: Buffer.from(signature).toString('base64'),
            signatureAlgorithm: 'ed25519',
            digest,
        };
    };

    return {
        async uploadObject(uploadInput) {
            const startedAt = Date.now();
            const remainingMs = () => Math.max(1, timeoutMs - (Date.now() - startedAt));
            const ownerRef = input.config.ownerRef;
            const contentDigest = `sha256:${createHash('sha256').update(uploadInput.bytes).digest('hex')}`;
            const quoteBody = {
                tenantId: input.config.tenantId,
                actionType: 'upload' as const,
                policyId: 'private_fast' as const,
                byteSize: uploadInput.bytes.byteLength,
                mimeType: uploadInput.mimeType,
                scopeRef: input.config.scopeRef,
                objectDigest: contentDigest,
            };
            const quoteGrant = signGrant(buildStorageGrantV2({
                config: input.config,
                principalRef: ownerRef,
                action: 'write',
                command: {
                    method: 'POST',
                    routeId: 'post_v1_quotes',
                    commandBody: quoteBody,
                },
            }));
            const quote = await requestJson(input.fetchImpl, baseUrl, 'POST', '/v1/quotes', {
                body: { ...quoteBody, grant: quoteGrant },
                timeoutMs: remainingMs(),
            }) as { quoteId?: string };
            if (!quote.quoteId) {
                throw new Error('storage_fabric_object_quote_missing');
            }

            const intentBody = {
                tenantId: input.config.tenantId,
                ownerRef,
                scopeRef: input.config.scopeRef,
                policyId: 'private_fast',
                kind: 'application_object',
                mimeType: uploadInput.mimeType,
                byteSize: uploadInput.bytes.byteLength,
                idempotencyKey: uploadInput.idempotencyKey,
                quoteId: quote.quoteId,
            };
            const intentGrant = signGrant(buildStorageGrantV2({
                config: input.config,
                principalRef: ownerRef,
                action: 'write',
                command: {
                    method: 'POST',
                    routeId: 'post_v1_upload_intents',
                    commandBody: intentBody,
                },
            }));
            const intent = await requestJson(input.fetchImpl, baseUrl, 'POST', '/v1/upload-intents', {
                body: { ...intentBody, grant: intentGrant },
                timeoutMs: remainingMs(),
            }) as {
                objectId?: string;
                uploadIntentId?: string;
                upload?: { protocol?: string; endpoint?: string; metadata?: Record<string, string> };
            };
            if (!intent.objectId || !intent.uploadIntentId || intent.upload?.protocol !== 'tus' || !intent.upload.endpoint) {
                throw new Error('storage_fabric_object_intent_invalid');
            }
            assertSidecarReachableUrl(intent.upload.endpoint, baseUrl);

            const uploadUrl = await tusCreate(input.fetchImpl, intent.upload.endpoint, {
                byteLength: uploadInput.bytes.byteLength,
                metadata: intent.upload.metadata ?? {},
                timeoutMs: remainingMs(),
            });
            assertSidecarReachableUrl(uploadUrl, baseUrl);
            await tusPatch(input.fetchImpl, uploadUrl, uploadInput.bytes, remainingMs());

            try {
                await completeOrFollowFinalize(input.fetchImpl, baseUrl, {
                    uploadIntentId: intent.uploadIntentId,
                    objectId: intent.objectId,
                    config: input.config,
                    signGrant,
                    timeoutMs: remainingMs(),
                });
                await pollCompleted(input.fetchImpl, baseUrl, {
                    uploadIntentId: intent.uploadIntentId,
                    objectId: intent.objectId,
                    config: input.config,
                    signGrant,
                    timeoutMs: remainingMs(),
                });
                const receipt = await readTerminalReceipt(input.fetchImpl, baseUrl, {
                    objectId: intent.objectId,
                    config: input.config,
                    signGrant,
                    timeoutMs: remainingMs(),
                });
                return {
                    objectId: intent.objectId,
                    uploadIntentId: intent.uploadIntentId,
                    contentDigest,
                    receiptId: receipt.receiptId,
                    receiptDigest: receipt.receiptDigest,
                    tenantId: input.config.tenantId,
                    scopeRef: input.config.scopeRef,
                };
            } catch (error) {
                const abortGrant = signGrant(buildStorageGrantV2({
                    config: input.config,
                    principalRef: ownerRef,
                    action: 'write',
                    objectId: intent.objectId,
                    command: {
                        method: 'POST',
                        routeId: 'post_v1_upload_intents_uploadintentid_abort',
                        commandBody: { uploadIntentId: intent.uploadIntentId, body: null },
                    },
                }));
                await requestJson(
                    input.fetchImpl,
                    baseUrl,
                    'POST',
                    `/v1/upload-intents/${encodeURIComponent(intent.uploadIntentId)}/abort`,
                    { body: { grant: abortGrant }, timeoutMs: remainingMs() },
                ).catch(() => undefined);
                throw error;
            }
        },

        async readObject(readInput) {
            const grant = signGrant(buildStorageGrantV2({
                config: input.config,
                principalRef: readInput.principalRef,
                action: 'read',
                objectId: readInput.objectId,
            }));
            const link = await requestJson(
                input.fetchImpl,
                baseUrl,
                'POST',
                `/v1/objects/${encodeURIComponent(readInput.objectId)}/access-links`,
                {
                    body: {
                        principalRef: readInput.principalRef,
                        grant,
                    },
                    timeoutMs,
                },
            ) as { access?: { type?: string; url?: string } };
            const resolverUrl = link.access?.type === 'resolver_url' ? link.access.url : undefined;
            if (!resolverUrl) {
                throw new Error('storage_fabric_object_resolver_url_missing');
            }
            const resolved = resolveSidecarObjectUrl(resolverUrl, baseUrl);
            const response = await fetchWithTimeout(input.fetchImpl, resolved, { method: 'GET', timeoutMs });
            if (!response.ok) {
                throw new Error(`storage_fabric_object_http_${response.status}`);
            }
            const bytes = Buffer.from(await response.arrayBuffer());
            return {
                bytes,
                contentType: response.headers.get('content-type'),
            };
        },
    };
}

function readGrantConfig(env: NodeJS.ProcessEnv): StorageFabricObjectGrantConfig {
    return {
        tenantId: requiredEnv(env, 'STORAGE_FABRIC_OBJECT_TENANT_ID'),
        scopeRef: requiredEnv(env, 'STORAGE_FABRIC_OBJECT_SCOPE_REF'),
        ownerRef: requiredEnv(env, 'STORAGE_FABRIC_OBJECT_OWNER_REF'),
        authorityId: requiredEnv(env, 'STORAGE_FABRIC_OBJECT_AUTHORITY_ID'),
        keyVersion: parsePositiveInt(env.STORAGE_FABRIC_OBJECT_KEY_VERSION, 1),
        audience: requiredEnv(env, 'STORAGE_FABRIC_OBJECT_GRANT_AUDIENCE'),
        policyVersion: parsePositiveInt(env.STORAGE_FABRIC_OBJECT_POLICY_VERSION, 0),
        revocationEpoch: parseNonNegativeInt(env.STORAGE_FABRIC_OBJECT_REVOCATION_EPOCH, 0),
    };
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
    const value = String(env[key] ?? '').trim();
    if (!value) {
        throw new Error(`storage_fabric_object_${key.toLowerCase()}_required`);
    }
    return value;
}

function parseTimeout(value: string | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function decodeSigningSeed(value: string): Uint8Array {
    const seed = Buffer.from(value, 'base64');
    if (seed.byteLength !== 32) {
        throw new Error('storage_fabric_object_signing_key_invalid');
    }
    return seed;
}

function resolveSidecarObjectUrl(rawUrl: string, apiBase: URL): string {
    const parsed = new URL(rawUrl, apiBase);
    if (apiBase.protocol === 'https:' && parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
    }
    if (parsed.pathname.startsWith('/v1/resolver/') && parsed.origin !== apiBase.origin) {
        parsed.protocol = apiBase.protocol;
        parsed.host = apiBase.host;
    }
    const resolved = parsed.toString();
    assertSidecarReachableUrl(resolved, apiBase);
    return resolved;
}

function assertSidecarReachableUrl(rawUrl: string, apiBase: URL): void {
    const parsed = new URL(rawUrl);
    const loopback = parsed.hostname === 'localhost'
        || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '::1';
    const apiLoopback = apiBase.hostname === 'localhost'
        || apiBase.hostname === '127.0.0.1'
        || apiBase.hostname === '::1';
    if (loopback && !apiLoopback) {
        throw new Error('storage_fabric_object_tus_endpoint_unreachable');
    }
}

async function tusCreate(
    fetchImpl: typeof fetch,
    endpoint: string,
    input: { byteLength: number; metadata: Record<string, string>; timeoutMs: number },
): Promise<string> {
    const metadata = Object.entries(input.metadata)
        .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
        .join(',');
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
        method: 'POST',
        timeoutMs: input.timeoutMs,
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Length': String(input.byteLength),
            ...(metadata ? { 'Upload-Metadata': metadata } : {}),
        },
    });
    if (response.status !== 201) {
        throw new Error('storage_fabric_object_tus_create_failed');
    }
    const location = response.headers.get('location');
    if (!location) {
        throw new Error('storage_fabric_object_tus_location_missing');
    }
    const resolved = new URL(location, endpoint);
    if (new URL(endpoint).protocol === 'https:' && resolved.protocol === 'http:') {
        resolved.protocol = 'https:';
    }
    return resolved.toString();
}

async function completeOrFollowFinalize(
    fetchImpl: typeof fetch,
    baseUrl: URL,
    input: {
        uploadIntentId: string;
        objectId: string;
        config: StorageFabricObjectGrantConfig;
        signGrant: (payload: StorageGrantV2Payload) => SignedStorageGrant;
        timeoutMs: number;
    },
): Promise<void> {
    const deadline = Date.now() + input.timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadline) {
        const completeGrant = input.signGrant(buildStorageGrantV2({
            config: input.config,
            principalRef: input.config.ownerRef,
            action: 'write',
            objectId: input.objectId,
            command: {
                method: 'POST',
                routeId: 'post_v1_upload_intents_uploadintentid_complete',
                commandBody: { uploadIntentId: input.uploadIntentId, body: null },
            },
        }));
        try {
            await requestJson(
                fetchImpl,
                baseUrl,
                'POST',
                `/v1/upload-intents/${encodeURIComponent(input.uploadIntentId)}/complete`,
                { body: { grant: completeGrant }, timeoutMs: Math.max(1, deadline - Date.now()) },
            );
            return;
        } catch (error) {
            lastError = error;
            if (!isCompleteRaceError(error)) {
                throw error;
            }
            const state = await peekFinalizationState(fetchImpl, baseUrl, {
                ...input,
                timeoutMs: Math.max(1, deadline - Date.now()),
            }).catch(() => null);
            if (state === 'completed' || state === 'queued') {
                return;
            }
            await sleep(150);
        }
    }
    throw lastError instanceof Error ? lastError : new Error('storage_fabric_object_http_500');
}

function isCompleteRaceError(error: unknown): boolean {
    return error instanceof Error
        && (error.message === 'storage_fabric_object_http_500'
            || error.message === 'storage_fabric_object_http_409');
}

async function peekFinalizationState(
    fetchImpl: typeof fetch,
    baseUrl: URL,
    input: {
        uploadIntentId: string;
        objectId: string;
        config: StorageFabricObjectGrantConfig;
        signGrant: (payload: StorageGrantV2Payload) => SignedStorageGrant;
        timeoutMs: number;
    },
): Promise<string | undefined> {
    const grant = input.signGrant(buildStorageGrantV2({
        config: input.config,
        principalRef: input.config.ownerRef,
        action: 'write',
        objectId: input.objectId,
    }));
    const status = await requestJson(
        fetchImpl,
        baseUrl,
        'GET',
        `/v1/upload-intents/${encodeURIComponent(input.uploadIntentId)}`,
        {
            timeoutMs: input.timeoutMs,
            headers: { 'x-storage-fabric-grant': encodeGrantHeader(grant) },
        },
    ) as { finalizationState?: string; status?: string };
    if (status.finalizationState === 'completed' || status.status === 'completed') {
        return 'completed';
    }
    if (
        status.finalizationState === 'queued'
        || status.status === 'finalization_queued'
        || status.status === 'finalizing'
    ) {
        return 'queued';
    }
    return status.finalizationState ?? status.status;
}

async function tusPatch(
    fetchImpl: typeof fetch,
    uploadUrl: string,
    bytes: Buffer,
    timeoutMs: number,
): Promise<void> {
    const response = await fetchWithTimeout(fetchImpl, uploadUrl, {
        method: 'PATCH',
        timeoutMs,
        headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': '0',
            'Content-Type': 'application/offset+octet-stream',
        },
        body: Uint8Array.from(bytes),
    });
    if (response.status !== 204 && response.status !== 200) {
        throw new Error('storage_fabric_object_tus_patch_failed');
    }
}

async function pollCompleted(
    fetchImpl: typeof fetch,
    baseUrl: URL,
    input: {
        uploadIntentId: string;
        objectId: string;
        config: StorageFabricObjectGrantConfig;
        signGrant: (payload: StorageGrantV2Payload) => SignedStorageGrant;
        timeoutMs: number;
    },
): Promise<void> {
    const deadline = Date.now() + input.timeoutMs;
    while (Date.now() < deadline) {
        const grant = input.signGrant(buildStorageGrantV2({
            config: input.config,
            principalRef: input.config.ownerRef,
            action: 'write',
            objectId: input.objectId,
        }));
        const status = await requestJson(
            fetchImpl,
            baseUrl,
            'GET',
            `/v1/upload-intents/${encodeURIComponent(input.uploadIntentId)}`,
            {
                timeoutMs: Math.max(1, deadline - Date.now()),
                headers: { 'x-storage-fabric-grant': encodeGrantHeader(grant) },
            },
        ) as { finalizationState?: string; status?: string };
        if (status.finalizationState === 'completed' || status.status === 'completed') {
            return;
        }
        if (status.finalizationState === 'blocked') {
            throw new Error('storage_fabric_object_upload_blocked');
        }
        await sleep(50);
    }
    throw new Error('storage_fabric_object_upload_timeout');
}

async function readTerminalReceipt(
    fetchImpl: typeof fetch,
    baseUrl: URL,
    input: {
        objectId: string;
        config: StorageFabricObjectGrantConfig;
        signGrant: (payload: StorageGrantV2Payload) => SignedStorageGrant;
        timeoutMs: number;
    },
): Promise<{ receiptId: string; receiptDigest: string }> {
    const grant = input.signGrant(buildStorageGrantV2({
        config: input.config,
        principalRef: input.config.ownerRef,
        action: 'read',
        objectId: input.objectId,
    }));
    const body = await requestJson(
        fetchImpl,
        baseUrl,
        'GET',
        `/v1/objects/${encodeURIComponent(input.objectId)}/receipts`,
        {
            timeoutMs: input.timeoutMs,
            headers: { 'x-storage-grant': encodeGrantHeader(grant) },
        },
    ) as { receipts?: Array<{ receiptId?: string; receiptDigest?: string }> };
    const receipt = body.receipts?.find((item) => item.receiptId && item.receiptDigest);
    if (!receipt?.receiptId || !receipt.receiptDigest) {
        throw new Error('storage_fabric_object_receipt_missing');
    }
    return { receiptId: receipt.receiptId, receiptDigest: receipt.receiptDigest };
}

function encodeGrantHeader(grant: SignedStorageGrant): string {
    return Buffer.from(JSON.stringify(grant), 'utf8').toString('base64url');
}

async function requestJson(
    fetchImpl: typeof fetch,
    baseUrl: URL,
    method: string,
    path: string,
    input: { body?: unknown; timeoutMs: number; headers?: Record<string, string> },
): Promise<unknown> {
    const response = await fetchWithTimeout(fetchImpl, new URL(path, baseUrl).toString(), {
        method,
        timeoutMs: input.timeoutMs,
        headers: {
            ...(input.body ? { 'content-type': 'application/json' } : {}),
            ...input.headers,
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) {
        throw new Error(`storage_fabric_object_http_${response.status}`);
    }
    return response.json();
}

async function fetchWithTimeout(
    fetchImpl: typeof fetch,
    url: string,
    input: { method: string; timeoutMs: number; headers?: Record<string, string>; body?: BodyInit },
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
        return await fetchImpl(url, {
            method: input.method,
            headers: input.headers,
            body: input.body,
            signal: controller.signal,
            redirect: 'error',
        });
    } finally {
        clearTimeout(timer);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
