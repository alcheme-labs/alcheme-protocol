import {
    DEFAULT_QUERY_API_GRAPHQL_URL,
    getQueryApiBaseUrl as getBootstrapPublicBaseUrlFromGraphql,
} from '../config/queryApiBase.ts';
import { apiFetch } from './fetch.ts';

export type NodeRoutingSurface =
    | 'graphql'
    | 'extensions_capabilities'
    | 'membership'
    | 'discussion_protocol'
    | 'policy_profile'
    | 'circle_location_management'
    | 'location_discovery'
    | 'governance'
    | 'circle_agents'
    | 'posts_bind'
    | 'sync_status'
    | 'communication_runtime'
    | 'communication_sidecar'
    | 'voice_runtime'
    | 'voice_provider_webhook'
    | 'neutral_evaluation_lifecycle'
    | 'trend_prompt_lifecycle'
    | 'auth_session'
    | 'source_materials'
    | 'profile_avatar'
    | 'seeded'
    | 'discussion_runtime'
    | 'collab'
    | 'ghost_draft_private'
    | 'governance_bootstrap'
    | 'governance_execution'
    | 'external_program_operator'
    | 'hosted_apps_runtime'
    | 'platform_safety';

export type NodeRoutingTarget = 'public' | 'sidecar';
export type NodeRoutingAuthMode = 'session_cookie';
export type NodeRoutingProxyMode = 'none' | 'ephemeral_same_origin';

export interface NodeCapabilitiesRecord {
    runtimeRole: 'PUBLIC_NODE' | 'PRIVATE_SIDECAR';
    deploymentProfile: 'managed_default' | 'sovereign_private' | 'public_node_only';
    publicBaseUrl?: string | null;
    sidecar?: {
        configured: boolean;
        discoverable: boolean;
        baseUrl: string | null;
        proxyMode: NodeRoutingProxyMode;
        authMode: NodeRoutingAuthMode;
    } | null;
    routing: {
        preferredSource: 'node_capabilities';
        publicNodeSafeApis: NodeRoutingSurface[];
        sidecarOwnedApis: NodeRoutingSurface[];
        hostedOnlyExceptions: string[];
    };
}

export interface ResolvedNodeRoute {
    surface: NodeRoutingSurface;
    urlBase: string;
    authMode: NodeRoutingAuthMode;
    target: NodeRoutingTarget;
    proxyMode: NodeRoutingProxyMode;
}

export interface NodeRoutingErrorLabels {
    privateSidecarRequired?: string;
    surfaceUnavailable?: string;
}

type FetchLike = typeof fetch;

interface ResolveNodeRouteInput {
    graphqlEndpoint?: string;
    bootstrapPublicBaseUrl?: string;
    fetchImpl?: FetchLike;
    resolveCapabilities?: () => Promise<NodeCapabilitiesRecord | null>;
}

interface FetchNodeJsonInput extends ResolveNodeRouteInput {
    init?: RequestInit;
}

export const FALLBACK_PUBLIC_NODE_SAFE_SURFACES: readonly NodeRoutingSurface[] = [
    'graphql',
    'extensions_capabilities',
    'membership',
    'discussion_protocol',
    'policy_profile',
    'circle_location_management',
    'location_discovery',
    'governance',
    'circle_agents',
    'posts_bind',
    'sync_status',
    'communication_runtime',
    'voice_runtime',
    'neutral_evaluation_lifecycle',
    'trend_prompt_lifecycle',
    'platform_safety',
];

export const FALLBACK_SIDECAR_OWNED_SURFACES: readonly NodeRoutingSurface[] = [
    'communication_sidecar',
    'voice_provider_webhook',
    'auth_session',
    'source_materials',
    'profile_avatar',
    'seeded',
    'discussion_runtime',
    'collab',
    'ghost_draft_private',
    'governance_bootstrap',
    'governance_execution',
    'external_program_operator',
    'hosted_apps_runtime',
];
const FRONTEND_PUBLIC_COMPATIBILITY_ALIASES: readonly NodeRoutingSurface[] = [
    'governance',
];
const capabilityCache = new Map<string, Promise<NodeCapabilitiesRecord | null>>();
const CAPABILITY_DISCOVERY_TIMEOUT_MS = 750;
const PRIVATE_SIDECAR_REQUIRED_ERROR = 'private_sidecar_required';
const NODE_SURFACE_UNAVAILABLE_ERROR = 'node_surface_unavailable';

function normalizeBaseUrl(value: unknown): string | null {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

function resolveBootstrapPublicBaseUrl(input: ResolveNodeRouteInput): string {
    const explicit = normalizeBaseUrl(input.bootstrapPublicBaseUrl);
    if (explicit) return explicit;
    return getBootstrapPublicBaseUrlFromGraphql(
        input.graphqlEndpoint || process.env.NEXT_PUBLIC_GRAPHQL_URL || DEFAULT_QUERY_API_GRAPHQL_URL,
    );
}

function buildCapabilitiesUrl(baseUrl: string): string {
    return `${baseUrl}/api/v1/extensions/capabilities`;
}

async function loadNodeCapabilities(input: ResolveNodeRouteInput): Promise<NodeCapabilitiesRecord | null> {
    if (input.resolveCapabilities) {
        return input.resolveCapabilities();
    }

    const fetchImpl = input.fetchImpl ?? fetch;
    const baseUrl = resolveBootstrapPublicBaseUrl(input);
    const shouldCache = !input.fetchImpl;

    if (shouldCache && capabilityCache.has(baseUrl)) {
        return capabilityCache.get(baseUrl)!;
    }

    const request = (async () => {
        const controller = typeof AbortController === 'function'
            ? new AbortController()
            : null;
        const timeout = controller
            ? setTimeout(() => controller.abort(), CAPABILITY_DISCOVERY_TIMEOUT_MS)
            : null;
        try {
            const response = await apiFetch(buildCapabilitiesUrl(baseUrl), {
                fetchImpl,
                init: {
                    headers: {
                        Accept: 'application/json',
                    },
                    signal: controller?.signal,
                },
            });
            if (!response.ok) {
                return null;
            }
            const payload = await response.json().catch(() => null);
            if (!payload || typeof payload !== 'object' || !('node' in payload)) {
                return null;
            }
            return (payload as { node?: NodeCapabilitiesRecord | null }).node ?? null;
        } catch {
            return null;
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    })();

    if (shouldCache) {
        capabilityCache.set(baseUrl, request);
        void request.then((capabilities) => {
            if (!capabilities && capabilityCache.get(baseUrl) === request) {
                capabilityCache.delete(baseUrl);
            }
        });
    }

    return request;
}

export function getPublicNodeGraphqlUrl(): string {
    return process.env.NEXT_PUBLIC_GRAPHQL_URL || DEFAULT_QUERY_API_GRAPHQL_URL;
}

export async function resolveNodeRoute(
    surface: NodeRoutingSurface,
    input: ResolveNodeRouteInput = {},
): Promise<ResolvedNodeRoute> {
    const bootstrapPublicBaseUrl = resolveBootstrapPublicBaseUrl(input);
    const capabilities = await loadNodeCapabilities(input);
    const publicBaseUrl = normalizeBaseUrl(capabilities?.publicBaseUrl) || bootstrapPublicBaseUrl;
    const sidecarBaseUrl = normalizeBaseUrl(capabilities?.sidecar?.baseUrl)
        || normalizeBaseUrl(process.env.NEXT_PUBLIC_SIDECAR_BASE_URL)
        || (capabilities?.runtimeRole === 'PRIVATE_SIDECAR' ? publicBaseUrl : null);
    const publicNodeSafeApis = capabilities?.routing?.publicNodeSafeApis ?? FALLBACK_PUBLIC_NODE_SAFE_SURFACES;
    const sidecarOwnedApis = capabilities?.routing?.sidecarOwnedApis ?? FALLBACK_SIDECAR_OWNED_SURFACES;
    const isSidecarOwned =
        sidecarOwnedApis.includes(surface)
        || FALLBACK_SIDECAR_OWNED_SURFACES.includes(surface);
    const isPublicSafe =
        !isSidecarOwned && publicNodeSafeApis.includes(surface)
        || FRONTEND_PUBLIC_COMPATIBILITY_ALIASES.includes(surface);

    if (isSidecarOwned) {
        if (!sidecarBaseUrl) {
            throw new Error(PRIVATE_SIDECAR_REQUIRED_ERROR);
        }

        return {
            surface,
            urlBase: sidecarBaseUrl,
            authMode: capabilities?.sidecar?.authMode ?? 'session_cookie',
            target: 'sidecar',
            proxyMode: capabilities?.sidecar?.proxyMode ?? 'none',
        };
    }

    if (isPublicSafe) {
        return {
            surface,
            urlBase: publicBaseUrl,
            authMode: 'session_cookie',
            target: 'public',
            proxyMode: 'none',
        };
    }

    throw new Error(NODE_SURFACE_UNAVAILABLE_ERROR);
}

function mergeHeaders(headers: HeadersInit | undefined): Record<string, string> {
    if (!headers) return {};
    if (Array.isArray(headers)) {
        return Object.fromEntries(headers.map(([key, value]) => [key, String(value)]));
    }
    if (headers instanceof Headers) {
        return Object.fromEntries(headers.entries());
    }
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, String(value)]),
    );
}

export function getNodeRoutingErrorCode(error: unknown): string | null {
    if (!(error instanceof Error)) return null;
    return error.message === PRIVATE_SIDECAR_REQUIRED_ERROR || error.message === NODE_SURFACE_UNAVAILABLE_ERROR
        ? error.message
        : null;
}

export function formatNodeRoutingError(
    error: unknown,
    fallback: string,
    labels: NodeRoutingErrorLabels = {},
): string {
    const code = getNodeRoutingErrorCode(error);
    if (code === PRIVATE_SIDECAR_REQUIRED_ERROR) {
        return labels.privateSidecarRequired ?? 'This action requires a private sidecar node.';
    }
    if (code === NODE_SURFACE_UNAVAILABLE_ERROR) {
        return labels.surfaceUnavailable ?? 'This action is not available from the connected node.';
    }
    return error instanceof Error ? error.message : fallback;
}

async function readNodeRouteErrorCode(response: Response): Promise<string | null> {
    try {
        const readable = typeof response.clone === 'function' ? response.clone() : response;
        const payload = await readable.json();
        const error = typeof payload?.error === 'string' ? payload.error : null;
        return error === PRIVATE_SIDECAR_REQUIRED_ERROR || error === NODE_SURFACE_UNAVAILABLE_ERROR
            ? error
            : null;
    } catch {
        return null;
    }
}

export async function fetchNodeJson<T>(
    surface: NodeRoutingSurface,
    path: string,
    input: FetchNodeJsonInput = {},
): Promise<T> {
    const fetchImpl = input.fetchImpl ?? fetch;
    const route = await resolveNodeRoute(surface, input);
    const url = path.startsWith('http://') || path.startsWith('https://')
        ? path
        : `${route.urlBase}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = mergeHeaders(input.init?.headers);
    const response = await apiFetch(url, {
        fetchImpl,
        init: {
            ...input.init,
            headers,
            credentials: route.authMode === 'session_cookie'
                ? 'include'
                : input.init?.credentials,
        },
    });

    if (!response.ok) {
        const errorCode = await readNodeRouteErrorCode(response);
        if (errorCode) {
            throw new Error(errorCode);
        }
        throw new Error(`node route request failed: ${response.status}`);
    }

    return response.json() as Promise<T>;
}

export async function resolveCollabWsBaseUrl(input: ResolveNodeRouteInput = {}): Promise<string> {
    const explicit = normalizeBaseUrl(process.env.NEXT_PUBLIC_COLLAB_WS_URL);
    if (explicit) {
        return explicit;
    }

    const route = await resolveNodeRoute('collab', input);
    try {
        const parsed = new URL(route.urlBase);
        parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
        parsed.pathname = '/collab';
        return parsed.toString().replace(/\/+$/, '');
    } catch {
        return 'ws://127.0.0.1:4000/collab';
    }
}
