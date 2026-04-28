import { apiFetch } from '@/lib/api/fetch';
import {
    buildCrystalOutputViewModelFromRecord,
    type CrystalOutputViewModel,
    type CrystallizationOutputRecordInput,
} from '@/features/crystal-output/adapter';
import { fetchCrystallizationOutputRecordByKnowledgeId } from '@/lib/api/crystalOutput';
import {
    fetchDraftReferenceLinks,
    type DraftReferenceLink,
} from '@/lib/api/draftReferenceLinks';

import {
    pickCircleSummarySnapshot,
    pickFrozenSummaryDraftConsumption,
    type CircleSummarySnapshot,
    type FrozenSummaryDraftConsumption,
} from '@/features/circle-summary/adapter';

interface CircleKnowledgeDigestRow {
    knowledgeId: string;
    title: string;
    version: number;
    contributorsCount: number;
    createdAt: string;
    stats: {
        citationCount: number;
    };
    contributors: Array<{
        sourceType?: 'SNAPSHOT' | 'SETTLEMENT' | null;
        sourceDraftPostId?: number | null;
        sourceAnchorId?: string | null;
        sourceSummaryHash?: string | null;
        sourceMessagesDigest?: string | null;
    }>;
    references: Array<{ knowledgeId: string }>;
    citedBy: Array<{ knowledgeId: string }>;
}

interface CircleDraftDigestRow {
    postId: number;
}

type JsonPayload = Record<string, any> | null;

export interface CircleSummaryKnowledgeOutputsResult {
    outputs: CrystalOutputViewModel[];
    warning: string | null;
}

export interface CircleSummaryKnowledgeOutputMessages {
    formalOutputReadFailed: (input: {knowledgeId: string}) => string;
    partialOutputsWarning: (input: {count: number; firstWarning: string}) => string;
}

function getGraphqlUrl(): string {
    return process.env.NEXT_PUBLIC_GRAPHQL_URL || 'http://127.0.0.1:4000/graphql';
}

function getQueryApiBaseUrl(): string {
    try {
        return new URL(getGraphqlUrl()).origin;
    } catch {
        return 'http://127.0.0.1:4000';
    }
}

export async function fetchFrozenSummaryDraftConsumption(input: {
    draftPostId: number;
}): Promise<FrozenSummaryDraftConsumption> {
    const response = await apiFetch(
        `${getQueryApiBaseUrl()}/api/v1/draft-lifecycle/drafts/${input.draftPostId}`,
        {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
        } as any,
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
    return pickFrozenSummaryDraftConsumption(payload?.lifecycle);
}

export async function fetchCircleSummarySnapshot(input: {
    circleId: number;
    regenerate?: boolean;
}): Promise<CircleSummarySnapshot | null> {
    const url = new URL(
        `/api/v1/circles/${input.circleId}/summary-snapshots/latest`,
        getQueryApiBaseUrl(),
    );
    if (input.regenerate) {
        url.searchParams.set('regenerate', 'true');
    }

    const response = await apiFetch(url.toString(), {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
    } as any);
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

    const snapshotPayload = payload?.snapshot && typeof payload.snapshot === 'object'
        ? payload.snapshot
        : null;
    if (snapshotPayload?.generationMetadata && typeof snapshotPayload.generationMetadata !== 'object') {
        throw new Error('invalid_circle_summary_generation_metadata');
    }

    return pickCircleSummarySnapshot(snapshotPayload);
}

export { fetchDraftReferenceLinks };

export async function fetchCircleSummaryKnowledgeOutputs(input: {
    circleId: number;
    limit?: number;
    messages: CircleSummaryKnowledgeOutputMessages;
}): Promise<CircleSummaryKnowledgeOutputsResult> {
    const response = await apiFetch(getGraphqlUrl(), {
        method: 'POST',
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({
            query: `
                query Team04CircleSummaryKnowledge($circleId: Int!, $limit: Int!) {
                  knowledgeByCircle(circleId: $circleId, limit: $limit, offset: 0) {
                    knowledgeId
                    title
                    version
                    contributorsCount
                    createdAt
                    stats {
                      citationCount
                    }
                    contributors {
                      sourceType
                      sourceDraftPostId
                      sourceAnchorId
                      sourceSummaryHash
                      sourceMessagesDigest
                    }
                    references(limit: 6) {
                      knowledgeId
                    }
                    citedBy(limit: 6) {
                      knowledgeId
                    }
                  }
                }
            `,
            variables: {
                circleId: input.circleId,
                limit: Math.max(1, Math.min(input.limit ?? 6, 12)),
            },
        }),
    } as any);

    const payload = await response.json().catch(() => null) as JsonPayload;
    if (!response.ok || payload?.errors?.length) {
        const message = typeof payload?.errors?.[0]?.message === 'string'
            ? payload.errors[0].message
            : `request failed: ${response.status}`;
        throw new Error(message);
    }

    const rows = Array.isArray(payload?.data?.knowledgeByCircle)
        ? payload.data.knowledgeByCircle as CircleKnowledgeDigestRow[]
        : [];

    const formalReadWarnings: string[] = [];
    const outputs = await Promise.all(
        rows.map(async (row) => {
            let record: CrystallizationOutputRecordInput | null = null;
            try {
                record = await fetchCrystallizationOutputRecordByKnowledgeId({
                    knowledgeId: row.knowledgeId,
                });
            } catch (error) {
                formalReadWarnings.push(
                    error instanceof Error && error.message.trim().length > 0
                        ? error.message
                        : input.messages.formalOutputReadFailed({knowledgeId: row.knowledgeId}),
                );
                record = null;
            }
            return buildCrystalOutputViewModelFromRecord({
                knowledge: row,
                record,
            });
        }),
    );

    return {
        outputs: outputs.filter((row): row is CrystalOutputViewModel => row !== null),
        warning: formalReadWarnings.length > 0
            ? input.messages.partialOutputsWarning({
                count: formalReadWarnings.length,
                firstWarning: formalReadWarnings[0],
            })
            : null,
    };
}

export async function fetchCircleSummaryDraftCandidates(input: {
    circleId: number;
    limit?: number;
}): Promise<FrozenSummaryDraftConsumption[]> {
    const response = await apiFetch(getGraphqlUrl(), {
        method: 'POST',
        credentials: 'include',
        headers: {
            'content-type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({
            query: `
                query Team04CircleSummaryDraftCandidates($circleId: Int!, $limit: Int!) {
                  circleDrafts(circleId: $circleId, limit: $limit, offset: 0) {
                    postId
                  }
                }
            `,
            variables: {
                circleId: input.circleId,
                limit: Math.max(1, Math.min(input.limit ?? 8, 12)),
            },
        }),
    } as any);

    const payload = await response.json().catch(() => null) as JsonPayload;
    if (!response.ok || payload?.errors?.length) {
        const message = typeof payload?.errors?.[0]?.message === 'string'
            ? payload.errors[0].message
            : `request failed: ${response.status}`;
        throw new Error(message);
    }

    const rows = Array.isArray(payload?.data?.circleDrafts)
        ? payload.data.circleDrafts as CircleDraftDigestRow[]
        : [];

    const results = await Promise.all(
        rows
            .map((row) => Number(row.postId))
            .filter((postId) => Number.isFinite(postId) && postId > 0)
            .map(async (draftPostId) => {
                try {
                    return await fetchFrozenSummaryDraftConsumption({ draftPostId });
                } catch {
                    return null;
                }
            }),
    );

    return results.filter((item): item is FrozenSummaryDraftConsumption => Boolean(item));
}
