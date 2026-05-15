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
    stabilityProjection?: ExternalAppStabilityProjection | null;
    storeProjection?: ExternalAppStoreProjection | null;
}

export interface ExternalAppStabilityProjection {
    policyEpochId: string;
    challengeState: string;
    projectionStatus: string;
    publicLabels: string[];
    riskScore: number;
    trustScore: number;
    supportSignalLevel: number;
    supportIndependenceScore: number;
    rollout?: {
        exposed?: boolean;
        bucket?: number;
        exposureBasisPoints?: number;
        cohort?: string;
        policyEpoch?: string;
    } | null;
    statusProvenance?: Record<string, unknown> | null;
    bondDispositionState?: {
        state?: string;
        activeLockedAmountRaw?: string;
        totalRoutedAmountRaw?: string;
        activeCaseCount?: number;
        riskDisclaimerAccepted?: boolean;
        riskDisclaimerRequired?: boolean;
    } | null;
    governanceState?: {
        captureReviewStatus?: string;
        projectionDisputeStatus?: string;
        emergencyHoldStatus?: string;
        highImpactActionsPaused?: boolean;
        labels?: string[];
    } | null;
}

export interface ExternalAppStoreProjection {
    listingState: string;
    categoryTags: string[];
    rankingOutput?: {
        score?: number;
        provenance?: string[];
        fallbackMode?: boolean;
    } | null;
    continuityLabels?: string[];
}

export interface ExternalAppDiscoveryQuery {
    q?: string;
    category?: string;
    sort?: 'latest' | 'featured' | 'trending';
}

export async function listExternalAppDiscovery(
    query: ExternalAppDiscoveryQuery = {},
): Promise<ExternalAppDiscoveryItem[]> {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.sort) params.set('sort', query.sort);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${getQueryApiBaseUrl()}/api/v1/external-apps/discovery${suffix}`, {
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`external_app_discovery_failed:${response.status}`);
    }
    const data = await response.json() as { apps?: ExternalAppDiscoveryItem[] };
    return Array.isArray(data.apps) ? data.apps : [];
}
