import { apiFetch } from '@/lib/api/fetch';
import { getQueryApiBaseUrl } from '@/lib/config/queryApiBase';

import type { CrystallizationOutputRecordInput } from '@/features/crystal-output/adapter';

type JsonPayload = Record<string, unknown> | null;

export async function fetchCrystallizationOutputRecordByKnowledgeId(input: {
    knowledgeId: string;
}): Promise<CrystallizationOutputRecordInput | null> {
    const knowledgeId = String(input.knowledgeId || '').trim();
    if (!knowledgeId) {
        return null;
    }

    const response = await apiFetch(
        `${getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL)}/api/v1/crystallization/knowledge/${encodeURIComponent(knowledgeId)}/output`,
        {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        } as any,
    );
    const payload = await response.json().catch(() => null) as JsonPayload;
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }
    return payload as CrystallizationOutputRecordInput;
}
