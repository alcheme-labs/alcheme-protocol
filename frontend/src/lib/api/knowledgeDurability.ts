import { authenticatedApiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl } from '@/lib/config/queryApiBase';

export interface KnowledgeDurabilityReadback {
    schemaVersion: 1;
    knowledgeId: string;
    knowledgeVersion: number;
    sourceDraftPostId: number;
    sourceDraftVersion: number;
    visibility: 'private' | 'members' | 'public';
    tier: 'local_private' | 'local_members' | 'local_published';
    contentDigest: string;
    manifestDigest: string;
    policy: {
        verificationIntervalSeconds: number;
        rpoSeconds: number;
        rtoSeconds: number;
        repairOwner: 'target_circle_custodian';
        productionProviderStatus: 'not_configured';
    };
    policyDigest: string;
    replicaProvider: string;
    replicaDigest: string;
    replicaByteSize: number;
    status: 'healthy' | 'corrupt' | 'unavailable' | 'repair_pending';
    lastVerifiedAt: string;
    verificationDueAt: string;
    verificationOverdue: boolean;
    lastRepairedAt: string | null;
    repairCount: number;
    events: Array<{
        id: string;
        eventType: string;
        status: string;
        evidenceDigest: string;
        occurredAt: string;
    }>;
}

async function requestDurability(
    knowledgeId: string,
    action?: 'verify' | 'repair',
): Promise<KnowledgeDurabilityReadback> {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/crystals/${encodeURIComponent(knowledgeId)}/durability${action ? `/${action}` : ''}`,
        { method: action ? 'POST' : 'GET', cache: 'no-store' } as any,
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const error = new Error(payload?.message || payload?.error || `request failed: ${response.status}`) as Error & { code?: string };
        error.code = payload?.error;
        throw error;
    }
    return payload.durability as KnowledgeDurabilityReadback;
}

export function fetchKnowledgeDurability(knowledgeId: string): Promise<KnowledgeDurabilityReadback> {
    return requestDurability(knowledgeId);
}

export function verifyKnowledgeDurability(knowledgeId: string): Promise<KnowledgeDurabilityReadback> {
    return requestDurability(knowledgeId, 'verify');
}

export function repairKnowledgeDurability(knowledgeId: string): Promise<KnowledgeDurabilityReadback> {
    return requestDurability(knowledgeId, 'repair');
}

export async function downloadKnowledgeDurabilityExport(knowledgeId: string): Promise<void> {
    const response = await authenticatedApiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/crystals/${encodeURIComponent(knowledgeId)}/durability/export`,
        { method: 'GET', cache: 'no-store' } as any,
    );
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || payload?.error || `request failed: ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `alcheme-knowledge-${knowledgeId}-durability.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}
