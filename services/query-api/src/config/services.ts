/**
 * Service Configuration — "builtin first, external override"
 *
 * Each module runs inside query-api by default.
 * Set mode='external' + externalUrl to redirect to a user-hosted service.
 * Frontend reads NEXT_PUBLIC_* env vars to know where to connect.
 */

import { loadAiRuntimeConfig } from './ai';

export interface ServiceEndpoint {
    mode: 'builtin' | 'external';
    externalUrl?: string;
}

export interface AiGatewayAvailability {
    available: boolean;
    reason: 'ok' | 'missing_gateway_url' | 'frontend_dev_server_gateway';
}

export type IdentityNotificationMode = 'all' | 'promotion_only' | 'none';
export type QueryApiRuntimeRole = 'PUBLIC_NODE' | 'PRIVATE_SIDECAR';
export type QueryApiDeploymentProfile =
    | 'managed_default'
    | 'sovereign_private'
    | 'public_node_only';
export type SidecarAuthMode = 'session_cookie';
export type SidecarProxyMode = 'none' | 'ephemeral_same_origin';
export type CrystalMintAdapterMode = 'mock_chain' | 'token2022_local';
export type NodeApiSurface =
    | 'graphql'
    | 'extensions_capabilities'
    | 'membership'
    | 'discussion_protocol'
    | 'policy_profile'
    | 'circle_agents'
    | 'posts_bind'
    | 'sync_status'
    | 'auth_session'
    | 'source_materials'
    | 'seeded'
    | 'discussion_runtime'
    | 'collab'
    | 'ghost_draft_private';

export interface QueryApiRuntimeConfig {
    runtimeRole: QueryApiRuntimeRole;
    deploymentProfile: QueryApiDeploymentProfile;
    publicBaseUrl: string | null;
    sidecarBaseUrl: string | null;
    sidecarDiscoverable: boolean;
    sidecarAuthMode: SidecarAuthMode;
    sidecarProxyMode: SidecarProxyMode;
    publicNodeSafeApis: NodeApiSurface[];
    sidecarOwnedApis: NodeApiSurface[];
    hostedOnlyExceptions: string[];
}

export interface IdentityCirclePolicy {
    initiateMessages?: number;
    memberCitations?: number;
    elderPercentile?: number;
    inactivityDays?: number;
    notificationMode?: IdentityNotificationMode;
}

export interface CrystalMintRuntimeConfig {
    adapterMode: CrystalMintAdapterMode;
    rpcUrl: string | null;
    authoritySecret: string | null;
    masterOwnerPubkey: string | null;
    metadataBaseUrl: string | null;
}

const VALID_IDENTITY_NOTIFICATION_MODES: IdentityNotificationMode[] = [
    'all',
    'promotion_only',
    'none',
];

const VALID_RUNTIME_ROLES: QueryApiRuntimeRole[] = [
    'PUBLIC_NODE',
    'PRIVATE_SIDECAR',
];

const VALID_DEPLOYMENT_PROFILES: QueryApiDeploymentProfile[] = [
    'managed_default',
    'sovereign_private',
    'public_node_only',
];

const VALID_SIDECAR_PROXY_MODES: SidecarProxyMode[] = [
    'none',
    'ephemeral_same_origin',
];
function parseBoundedInteger(
    raw: unknown,
    input: { min: number; max?: number },
): number | null {
    const parsed = typeof raw === 'number'
        ? Math.trunc(raw)
        : (typeof raw === 'string' && /^-?\d+$/.test(raw.trim()))
            ? parseInt(raw.trim(), 10)
            : Number.NaN;
    if (!Number.isFinite(parsed)) return null;
    if (parsed < input.min) return null;
    if (typeof input.max === 'number' && parsed > input.max) return null;
    return parsed;
}

export function parseIdentityNotificationMode(
    raw: string | undefined,
    fallback: IdentityNotificationMode = 'all',
): IdentityNotificationMode {
    const normalized = parseOptionalIdentityNotificationMode(raw);
    if (normalized) return normalized;
    return fallback;
}

function parseRuntimeRole(
    raw: string | undefined,
    fallback: QueryApiRuntimeRole = 'PRIVATE_SIDECAR',
): QueryApiRuntimeRole {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toUpperCase() as QueryApiRuntimeRole;
    return VALID_RUNTIME_ROLES.includes(normalized) ? normalized : fallback;
}

function parseDeploymentProfile(
    raw: string | undefined,
    fallback: QueryApiDeploymentProfile = 'managed_default',
): QueryApiDeploymentProfile {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toLowerCase() as QueryApiDeploymentProfile;
    return VALID_DEPLOYMENT_PROFILES.includes(normalized) ? normalized : fallback;
}

function parseSidecarProxyMode(
    raw: string | undefined,
    fallback: SidecarProxyMode = 'none',
): SidecarProxyMode {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toLowerCase() as SidecarProxyMode;
    return VALID_SIDECAR_PROXY_MODES.includes(normalized) ? normalized : fallback;
}

function parseOptionalIdentityNotificationMode(raw: unknown): IdentityNotificationMode | undefined {
    if (typeof raw !== 'string') return undefined;
    const normalized = raw.trim().toLowerCase() as IdentityNotificationMode;
    return VALID_IDENTITY_NOTIFICATION_MODES.includes(normalized) ? normalized : undefined;
}

function parseIdentityCirclePolicy(raw: unknown): IdentityCirclePolicy | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const policy = raw as Record<string, unknown>;
    const initiateMessages = parseBoundedInteger(policy.initiateMessages, { min: 1 });
    const memberCitations = parseBoundedInteger(policy.memberCitations, { min: 0 });
    const elderPercentile = parseBoundedInteger(policy.elderPercentile, { min: 1, max: 100 });
    const inactivityDays = parseBoundedInteger(policy.inactivityDays, { min: 1 });
    const notificationMode = parseOptionalIdentityNotificationMode(policy.notificationMode);

    const hasFields = (
        initiateMessages !== null
        || memberCitations !== null
        || elderPercentile !== null
        || inactivityDays !== null
        || notificationMode !== undefined
    );
    if (!hasFields) return null;

    return {
        ...(initiateMessages !== null ? { initiateMessages } : {}),
        ...(memberCitations !== null ? { memberCitations } : {}),
        ...(elderPercentile !== null ? { elderPercentile } : {}),
        ...(inactivityDays !== null ? { inactivityDays } : {}),
        ...(notificationMode ? { notificationMode } : {}),
    };
}

export function parseIdentityPolicyByCircle(raw: string | undefined): Record<number, IdentityCirclePolicy> {
    if (!raw || !raw.trim()) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const result: Record<number, IdentityCirclePolicy> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            const circleId = parseBoundedInteger(key, { min: 1 });
            if (circleId === null) continue;
            const policy = parseIdentityCirclePolicy(value);
            if (!policy) continue;
            result[circleId] = policy;
        }
        return result;
    } catch {
        return {};
    }
}

export function loadNodeRuntimeConfig(): QueryApiRuntimeConfig {
    const runtimeRole = parseRuntimeRole(process.env.QUERY_API_RUNTIME_ROLE);
    const deploymentProfile = parseDeploymentProfile(process.env.QUERY_API_DEPLOYMENT_PROFILE);
    const publicBaseUrl = String(process.env.QUERY_API_PUBLIC_BASE_URL || '').trim() || null;
    const sidecarBaseUrl = String(process.env.QUERY_API_SIDECAR_BASE_URL || '').trim() || null;
    const sidecarAuthMode: SidecarAuthMode = 'session_cookie';
    const sidecarProxyMode = parseSidecarProxyMode(process.env.QUERY_API_SIDECAR_PROXY_MODE);
    const publicNodeSafeApis: NodeApiSurface[] = [
        'graphql',
        'extensions_capabilities',
        'membership',
        'discussion_protocol',
        'policy_profile',
        'circle_agents',
        'posts_bind',
        'sync_status',
    ];
    const sidecarOwnedApis: NodeApiSurface[] = [
        'auth_session',
        'source_materials',
        'seeded',
        'discussion_runtime',
        'collab',
        'ghost_draft_private',
    ];

    return {
        runtimeRole,
        deploymentProfile,
        publicBaseUrl,
        sidecarBaseUrl,
        sidecarDiscoverable: runtimeRole === 'PUBLIC_NODE' && !!sidecarBaseUrl,
        sidecarAuthMode,
        sidecarProxyMode,
        publicNodeSafeApis,
        sidecarOwnedApis,
        hostedOnlyExceptions: [
            'draft_working_copy',
            'temporary_edit_grants',
            'storage_upload',
        ],
    };
}

export function loadCrystalMintRuntimeConfig(env: NodeJS.ProcessEnv = process.env): CrystalMintRuntimeConfig {
    const rpcUrl = String(env.CRYSTAL_MINT_RPC_URL || '').trim() || null;
    const authoritySecret = String(env.CRYSTAL_MINT_AUTHORITY_SECRET || '').trim() || null;
    const masterOwnerPubkey = String(env.CRYSTAL_MASTER_OWNER_PUBKEY || '').trim() || null;
    const metadataBaseUrl = String(env.CRYSTAL_METADATA_BASE_URL || '').trim() || null;
    const isProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
    const hasRealMintCredentials = !!(rpcUrl && authoritySecret);
    if (isProduction && !hasRealMintCredentials) {
        throw new Error('crystal_mint_credentials_required');
    }
    const adapterMode: CrystalMintAdapterMode = hasRealMintCredentials ? 'token2022_local' : 'mock_chain';

    return {
        adapterMode,
        rpcUrl,
        authoritySecret,
        masterOwnerPubkey,
        metadataBaseUrl,
    };
}

export function requirePrivateSidecarSurface(surface: Extract<
    NodeApiSurface,
    'auth_session' | 'source_materials' | 'seeded' | 'discussion_runtime' | 'collab' | 'ghost_draft_private'
>): { ok: true } | {
    ok: false;
    statusCode: 409;
    error: 'private_sidecar_required';
    route: typeof surface;
} {
    const runtime = loadNodeRuntimeConfig();
    if (runtime.runtimeRole === 'PRIVATE_SIDECAR') {
        return { ok: true };
    }

    return {
        ok: false,
        statusCode: 409,
        error: 'private_sidecar_required',
        route: surface,
    };
}

export function assessBuiltinAiGatewayAvailability(gatewayUrl: string | null | undefined): AiGatewayAvailability {
    const normalized = String(gatewayUrl || '').trim();
    if (!normalized) {
        return {
            available: false,
            reason: 'missing_gateway_url',
        };
    }

    try {
        const parsed = new URL(normalized);
        const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        const isFrontendDevPort = parsed.port === '3000';
        if (isLoopback && isFrontendDevPort) {
            return {
                available: false,
                reason: 'frontend_dev_server_gateway',
            };
        }
    } catch {
        return {
            available: false,
            reason: 'missing_gateway_url',
        };
    }

    return {
        available: true,
        reason: 'ok',
    };
}

export const serviceConfig = {
    /** Yjs collaborative editing WebSocket */
    collab: {
        mode: (process.env.COLLAB_MODE || 'builtin') as 'builtin' | 'external',
        externalUrl: process.env.COLLAB_EXTERNAL_URL,
    } satisfies ServiceEndpoint,

    /** AI services (Ghost Draft + Message Scoring) */
    ai: loadAiRuntimeConfig(),

    /** Identity thresholds (Circle-level overridable) */
    identity: {
        /** Messages required for Visitor → Initiate */
        initiateThreshold: parseInt(process.env.IDENTITY_INITIATE_MESSAGES || '3', 10),
        /** Citations required for Initiate → Member */
        memberCitations: parseInt(process.env.IDENTITY_MEMBER_CITATIONS || '2', 10),
        /** Reputation top X% for Member → Elder */
        elderPercentile: parseInt(process.env.IDENTITY_ELDER_PERCENTILE || '10', 10),
        /** Days of inactivity before demotion */
        inactivityDays: parseInt(process.env.IDENTITY_INACTIVITY_DAYS || '30', 10),
        /** Notification policy for identity transitions */
        notificationMode: parseIdentityNotificationMode(process.env.IDENTITY_NOTIFICATION_MODE),
        /** Optional per-circle overrides, keyed by circleId */
        circlePolicies: parseIdentityPolicyByCircle(process.env.IDENTITY_POLICY_BY_CIRCLE_JSON),
    },
};
