import { authenticatedApiFetch } from './fetch';
import { resolveNodeRoute } from './nodeRouting';
import { getQueryApiBaseUrl } from '../config/queryApiBase';

import type { ContributionTraceResponse } from '@/features/contribution-trace/adapter';

export class ContributionTraceRequestError extends Error {
    constructor(
        public readonly code: string,
        public readonly status: number,
    ) {
        super(code);
        this.name = 'ContributionTraceRequestError';
    }
}

async function parseContributionTraceResponse(response: Response): Promise<ContributionTraceResponse> {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const code = typeof payload?.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : `http_${response.status}`;
        throw new ContributionTraceRequestError(code, response.status);
    }
    return payload as ContributionTraceResponse;
}

export async function fetchDraftContributionTrace(input: {
    draftPostId: number;
}): Promise<ContributionTraceResponse> {
    const baseUrl = (await resolveNodeRoute('discussion_runtime')).urlBase;
    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/discussion/drafts/${encodeURIComponent(String(input.draftPostId))}/contribution-trace`,
        {
            init: {
                method: 'GET',
                cache: 'no-store',
            },
        },
    );
    return parseContributionTraceResponse(response);
}

export async function fetchCrystalContributionTrace(input: {
    knowledgeId: string;
}): Promise<ContributionTraceResponse> {
    const baseUrl = getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
    const response = await authenticatedApiFetch(
        `${baseUrl}/api/v1/crystals/${encodeURIComponent(input.knowledgeId)}/contribution-trace`,
        {
            init: {
                method: 'GET',
                cache: 'no-store',
            },
        },
    );
    return parseContributionTraceResponse(response);
}
