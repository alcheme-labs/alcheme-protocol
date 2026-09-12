import { createHash, randomUUID } from 'node:crypto';

export const STORAGE_GRANT_V2_PAYLOAD_KEYS = new Set([
    'version',
    'grantId',
    'audience',
    'tenantId',
    'authorityId',
    'keyVersion',
    'principalRef',
    'action',
    'scopeRef',
    'objectId',
    'targetDigest',
    'constraintsDigest',
    'policyVersion',
    'nonce',
    'maxAccessTTLSeconds',
    'maxSignedUrlTTLSeconds',
    'cachePurgePolicy',
    'issuedAt',
    'notBefore',
    'expiresAt',
    'revocationEpoch',
    'replayPolicy',
]);

export type StorageGrantV2Action = 'write' | 'read';

export type StorageGrantReplayPolicy =
    | { kind: 'reusable_short_lived' }
    | { kind: 'idempotent_command'; commandDigest: string };

export interface StorageFabricObjectGrantConfig {
    tenantId: string;
    scopeRef: string;
    ownerRef: string;
    authorityId: string;
    keyVersion: number;
    audience: string;
    policyVersion: number;
    revocationEpoch: number;
}

export interface StorageGrantV2Payload {
    version: '2';
    grantId: string;
    audience: string;
    tenantId: string;
    authorityId: string;
    keyVersion: number;
    principalRef: string;
    action: StorageGrantV2Action;
    scopeRef: string;
    objectId?: string;
    targetDigest: string;
    constraintsDigest: string;
    policyVersion: number;
    nonce: string;
    maxAccessTTLSeconds: number;
    maxSignedUrlTTLSeconds: number;
    cachePurgePolicy: 'revoke_only';
    issuedAt: string;
    notBefore: string;
    expiresAt: string;
    revocationEpoch: number;
    replayPolicy: StorageGrantReplayPolicy;
}

const MAX_ACCESS_TTL_SECONDS = 60;
const MAX_SIGNED_URL_TTL_SECONDS = 60;

export function buildStorageGrantV2(input: {
    config: StorageFabricObjectGrantConfig;
    principalRef: string;
    action: StorageGrantV2Action;
    objectId?: string;
    command?: { method: string; routeId: string; commandBody: unknown };
    now?: Date;
}): StorageGrantV2Payload {
    const now = input.now ?? new Date();
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + MAX_ACCESS_TTL_SECONDS * 1000).toISOString();
    const replayPolicy: StorageGrantReplayPolicy = input.command
        ? {
            kind: 'idempotent_command',
            commandDigest: createStorageGrantCommandDigest({
                method: input.command.method,
                routeId: input.command.routeId,
                commandBody: input.command.commandBody,
                resource: {
                    tenantId: input.config.tenantId,
                    ...(input.objectId ? { objectId: input.objectId } : {}),
                },
            }),
        }
        : { kind: 'reusable_short_lived' };

    const payload: StorageGrantV2Payload = {
        version: '2',
        grantId: `grant_${randomUUID()}`,
        audience: input.config.audience,
        tenantId: input.config.tenantId,
        authorityId: input.config.authorityId,
        keyVersion: input.config.keyVersion,
        principalRef: input.principalRef,
        action: input.action,
        scopeRef: input.config.scopeRef,
        ...(input.objectId ? { objectId: input.objectId } : {}),
        targetDigest: '',
        constraintsDigest: '',
        policyVersion: input.config.policyVersion,
        nonce: randomUUID(),
        maxAccessTTLSeconds: MAX_ACCESS_TTL_SECONDS,
        maxSignedUrlTTLSeconds: MAX_SIGNED_URL_TTL_SECONDS,
        cachePurgePolicy: 'revoke_only',
        issuedAt,
        notBefore: issuedAt,
        expiresAt,
        revocationEpoch: input.config.revocationEpoch,
        replayPolicy,
    };

    payload.targetDigest = createStorageGrantTargetDigest(payload);
    payload.constraintsDigest = createStorageGrantConstraintsDigest(payload);
    return payload;
}

export function createStorageGrantTargetDigest(
    grant: Pick<StorageGrantV2Payload, 'tenantId' | 'action' | 'scopeRef' | 'objectId'>,
): string {
    return digestStorageGrantBinding({
        tenantId: grant.tenantId,
        action: grant.action,
        scopeRef: grant.scopeRef,
        objectId: grant.objectId ?? null,
    });
}

export function createStorageGrantConstraintsDigest(
    grant: Pick<
        StorageGrantV2Payload,
        | 'policyVersion'
        | 'maxAccessTTLSeconds'
        | 'maxSignedUrlTTLSeconds'
        | 'cachePurgePolicy'
        | 'replayPolicy'
    >,
): string {
    return digestStorageGrantBinding({
        policyVersion: grant.policyVersion,
        maxAccessTTLSeconds: grant.maxAccessTTLSeconds,
        maxSignedUrlTTLSeconds: grant.maxSignedUrlTTLSeconds,
        cachePurgePolicy: grant.cachePurgePolicy,
        replayPolicy: grant.replayPolicy,
    });
}

export function createStorageGrantCommandDigest(input: {
    method: string;
    routeId: string;
    commandBody: unknown;
    resource: { tenantId: string; objectId?: string };
}): string {
    return digestStorageGrantBinding({
        method: input.method.toUpperCase(),
        routeId: input.routeId,
        commandBody: input.commandBody,
        resource: {
            tenantId: input.resource.tenantId,
            objectId: input.resource.objectId ?? null,
        },
    });
}

export function createGrantDigest(payload: StorageGrantV2Payload): string {
    return digestStorageGrantBinding(payload);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
    return Buffer.from(canonicalReceiptJson(value), 'utf8');
}

function digestStorageGrantBinding(value: unknown): string {
    return `sha256:${createHash('sha256').update(canonicalReceiptJson(value), 'utf8').digest('hex')}`;
}

function canonicalReceiptJson(value: unknown): string {
    return serializeCanonicalReceiptJson(value);
}

function serializeCanonicalReceiptJson(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    switch (typeof value) {
        case 'boolean':
            return value ? 'true' : 'false';
        case 'number':
            if (!Number.isFinite(value)) {
                throw new Error('unsupported_canonical_json_value');
            }
            return JSON.stringify(value);
        case 'string':
            return JSON.stringify(value);
        case 'object':
            if (Array.isArray(value)) {
                return `[${value.map((item) => serializeCanonicalReceiptJson(item)).join(',')}]`;
            }
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null) {
                throw new Error('unsupported_canonical_json_value');
            }
            const record = value as Record<string, unknown>;
            const members = Object.keys(record)
                .sort()
                .map((key) => {
                    const member = record[key];
                    if (member === undefined) {
                        throw new Error('unsupported_canonical_json_value');
                    }
                    return `${JSON.stringify(key)}:${serializeCanonicalReceiptJson(member)}`;
                });
            return `{${members.join(',')}}`;
        default:
            throw new Error('unsupported_canonical_json_value');
    }
}
