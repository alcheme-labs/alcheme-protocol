import { getQueryApiBaseUrl } from '../config/queryApiBase';

export interface ExternalAppDiscoveryItem {
    id: string;
    name: string;
    registryStatus: string;
    discoveryStatus: string;
    managedNodePolicy: string;
    capabilityPolicies?: Record<string, string> | null;
    trustScore?: string | null;
    riskScore?: string | null;
    communityBackingLevel?: string | null;
    updatedAt?: string | null;
}

export async function listExternalAppDiscovery(): Promise<ExternalAppDiscoveryItem[]> {
    const response = await fetch(`${getQueryApiBaseUrl()}/api/v1/external-apps/discovery`, {
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`external_app_discovery_failed:${response.status}`);
    }
    const data = await response.json() as { apps?: ExternalAppDiscoveryItem[] };
    return Array.isArray(data.apps) ? data.apps : [];
}
