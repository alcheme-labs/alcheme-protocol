import { apiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export interface SourceMaterialRecord {
    id: number;
    circleId: number;
    draftPostId: number | null;
    discussionThreadId: string | null;
    seededSourceNodeId: number | null;
    name: string;
    mimeType: string | null;
    status: 'extracting' | 'ai_readable' | string;
    contentDigest: string;
    chunkCount: number;
}

export async function fetchSourceMaterials(
    circleId: number,
    input?: { draftPostId?: number | null },
): Promise<SourceMaterialRecord[]> {
    const route = await resolveNodeRoute('source_materials');
    const query = new URLSearchParams();
    if (input?.draftPostId && input.draftPostId > 0) {
        query.set('draftPostId', String(input.draftPostId));
    }

    const response = await apiFetch(
        `${route.urlBase}/api/v1/circles/${circleId}/source-materials${query.size > 0 ? `?${query.toString()}` : ''}`,
        {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        },
    );

    if (response.status === 404 || response.status === 409) {
        return [];
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`fetch source materials failed: ${response.status} ${body}`);
    }

    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.materials) ? payload.materials as SourceMaterialRecord[] : [];
}

export async function uploadSourceMaterial(
    circleId: number,
    input: {
        draftPostId?: number | null;
        discussionThreadId?: string | null;
        seededSourceNodeId?: number | null;
        name: string;
        mimeType?: string | null;
        content: string;
    },
): Promise<SourceMaterialRecord> {
    const route = await resolveNodeRoute('source_materials');
    const response = await apiFetch(`${route.urlBase}/api/v1/circles/${circleId}/source-materials`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            draftPostId: input.draftPostId ?? null,
            discussionThreadId: input.discussionThreadId ?? null,
            seededSourceNodeId: input.seededSourceNodeId ?? null,
            name: input.name,
            mimeType: input.mimeType ?? null,
            content: input.content,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`upload source material failed: ${response.status} ${body}`);
    }

    const payload = await response.json().catch(() => null);
    return payload?.material as SourceMaterialRecord;
}
