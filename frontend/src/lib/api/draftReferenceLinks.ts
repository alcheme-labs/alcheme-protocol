import { apiFetch } from './fetch.ts';
import { getQueryApiBaseUrl } from '../config/queryApiBase.ts';
import {
    pickDraftReferenceLinks,
    type DraftReferenceLink,
} from '../../features/crystal-output/adapter.ts';

type JsonPayload = Record<string, any> | null;

export type { DraftReferenceLink };

export async function fetchDraftReferenceLinks(input: {
    draftPostId: number;
}): Promise<DraftReferenceLink[]> {
    const response = await apiFetch(
        `${getQueryApiBaseUrl()}/api/v1/drafts/${input.draftPostId}/reference-links`,
        {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        } as RequestInit,
    );
    const payload = await response.json().catch(() => null) as JsonPayload;
    if (!response.ok) {
        const message = typeof payload?.message === 'string'
            ? payload.message
            : typeof payload?.error === 'string'
                ? payload.error
                : `request failed: ${response.status}`;
        throw new Error(message);
    }

    return pickDraftReferenceLinks(payload?.referenceLinks);
}
