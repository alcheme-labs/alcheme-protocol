export type ExtensionManifestSource = 'configured' | 'auto_discovered' | 'missing';
export type ExtensionRuntimeSource = 'chain' | 'unavailable';
export type ExtensionRegistrationStatus =
    | 'not_registered'
    | 'registered_enabled'
    | 'registered_disabled'
    | 'runtime_unavailable';

export interface ExtensionConsistencySnapshot {
    indexerId: string;
    readCommitment: string;
    indexedSlot: number;
    stale: boolean;
}

export interface ExtensionRuntimeRecord {
    registered: boolean;
    enabled: boolean | null;
    permissions: string[] | null;
    source: ExtensionRuntimeSource;
    registrationStatus: ExtensionRegistrationStatus;
    reason: string | null;
}

export interface ExtensionCapabilityRecord {
    extensionId: string;
    displayName: string;
    programId: string;
    version: string;
    parserVersion: string;
    status: string;
    reason: string | null;
    sdkPackage: string;
    requiredPermissions: string[];
    tags: string[];
    runtime: ExtensionRuntimeRecord;
    indexedSlot: number;
    stale: boolean;
}

export interface NodeCapabilitySurfaceRouting {
    preferredSource: 'node_capabilities';
    publicNodeSafeApis: string[];
    sidecarOwnedApis: string[];
    hostedOnlyExceptions: string[];
}

export interface NodeCapabilityRecord {
    runtimeRole: 'PUBLIC_NODE' | 'PRIVATE_SIDECAR';
    deploymentProfile: 'managed_default' | 'sovereign_private' | 'public_node_only';
    trustMode: 'public_protocol' | 'trusted_private';
    publicBaseUrl: string | null;
    sidecar: {
        configured: boolean;
        discoverable: boolean;
        baseUrl: string | null;
        proxyMode: 'none' | 'ephemeral_same_origin';
        authMode: 'session_cookie';
    };
    routing: NodeCapabilitySurfaceRouting;
}

export interface ExtensionCapabilitiesResponse {
    generatedAt: string;
    manifestSource: ExtensionManifestSource;
    manifestReason: string | null;
    consistency: ExtensionConsistencySnapshot;
    skippedManifests: string[];
    capabilities: ExtensionCapabilityRecord[];
    node?: NodeCapabilityRecord;
}

export type ExtensionAvailabilityState =
    | 'available'
    | 'disabled'
    | 'syncing'
    | 'temporarily_unavailable'
    | 'misconfigured'
    | 'not_registered';

export interface NormalizedExtensionCapability {
    extensionId: string;
    displayName: string;
    state: ExtensionAvailabilityState;
    reasonCode: string | null;
    indexedSlot: number;
}

export interface ExtensionEntryDefinition {
    extensionId: string;
    title: string;
    description: string;
    surface: 'home';
    href: string | null;
    icon: 'sparkles';
    visibility: 'public';
    type: 'external';
}

export interface ExtensionCardModel {
    extensionId: string;
    title: string;
    description: string;
    state: ExtensionAvailabilityState;
    badge: string;
    message: string;
    meta: string;
    cta: {
        enabled: boolean;
        label: string;
        href: string | null;
        external: boolean;
    };
    showRetry: boolean;
}
