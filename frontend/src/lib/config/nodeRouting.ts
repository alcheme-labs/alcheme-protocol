import {
    DEFAULT_QUERY_API_GRAPHQL_URL,
    getQueryApiBaseUrl as getBootstrapPublicBaseUrlFromGraphql,
} from './queryApiBase.ts';

export type NodeRoutingSurface =
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

const DEFAULT_SIDECAR_SURFACES: NodeRoutingSurface[] = [
    'auth_session',
    'source_materials',
    'seeded',
    'discussion_runtime',
    'collab',
    'ghost_draft_private',
];
const capabilityCache = new Map<string, Promise<NodeCapabilitiesRecord | null>>();
const CAPABILITY_DISCOVERY_TIMEOUT_MS = 750;

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
            const response = await fetchImpl(buildCapabilitiesUrl(baseUrl), {
                headers: {
                    Accept: 'application/json',
                },
                signal: controller?.signal,
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
    const sidecarOwnedApis = capabilities?.routing?.sidecarOwnedApis ?? DEFAULT_SIDECAR_SURFACES;
    const isSidecarOwned = sidecarOwnedApis.includes(surface);

    if (!isSidecarOwned) {
        return {
            surface,
            urlBase: publicBaseUrl,
            authMode: 'session_cookie',
            target: 'public',
            proxyMode: 'none',
        };
    }

    if (!sidecarBaseUrl) {
        const explicitlyUnavailable = Boolean(
            capabilities
            && capabilities.runtimeRole === 'PUBLIC_NODE'
            && capabilities.sidecar
            && !capabilities.sidecar.discoverable
            && !capabilities.sidecar.baseUrl
            && capabilities.deploymentProfile === 'public_node_only',
        );
        if (explicitlyUnavailable) {
            throw new Error('private_sidecar_required');
        }

        return {
            surface,
            urlBase: publicBaseUrl,
            authMode: 'session_cookie',
            target: 'public',
            proxyMode: 'none',
        };
    }

    return {
        surface,
        urlBase: sidecarBaseUrl,
        authMode: capabilities?.sidecar?.authMode ?? 'session_cookie',
        target: 'sidecar',
        proxyMode: capabilities?.sidecar?.proxyMode ?? 'none',
    };
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
    const response = await fetchImpl(url, {
        ...input.init,
        headers,
        credentials: route.authMode === 'session_cookie'
            ? 'include'
            : input.init?.credentials,
    });

    if (!response.ok) {
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
