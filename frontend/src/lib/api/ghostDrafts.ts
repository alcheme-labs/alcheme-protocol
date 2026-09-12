import { fetchNodeJson } from '@/lib/api/nodeRouting';
import type {
  GhostDraftGenerateInput,
  GhostDraftJobResponse,
} from '@/lib/apollo/types';

type EventSourceFactory = (url: string, init?: EventSourceInit) => EventSource;

export async function fetchGhostDraftGenerationPayload<T>(input: {
  queryApiBaseUrl: string;
  generationId: number;
}): Promise<T> {
  return fetchNodeJson<T>(
    'ghost_draft_private',
    `/api/v1/ai/ghost-drafts/${input.generationId}`,
    {
      init: {
        method: 'GET',
        cache: 'no-store',
      },
    },
  );
}

export async function fetchAiJobPayload<T>(input: {
  queryApiBaseUrl: string;
  jobId: number;
}): Promise<T> {
  return fetchNodeJson<T>(
    'ghost_draft_private',
    `/api/v1/ai-jobs/${input.jobId}`,
    {
      init: {
        method: 'GET',
        cache: 'no-store',
      },
    },
  );
}

export async function fetchDraftAiJobsPayload<T>(input: {
  queryApiBaseUrl: string;
  postId: number;
  limit?: number;
}): Promise<T> {
  return fetchNodeJson<T>(
    'ghost_draft_private',
    `/api/v1/ai-jobs?draftPostId=${encodeURIComponent(String(input.postId))}&limit=${input.limit ?? 10}`,
    {
      init: {
        method: 'GET',
        cache: 'no-store',
      },
    },
  );
}

export async function requestGhostDraftGenerationOnPrivateSidecar(
  input: GhostDraftGenerateInput,
): Promise<GhostDraftJobResponse['generateGhostDraft']> {
  return fetchNodeJson<GhostDraftJobResponse['generateGhostDraft']>(
    'ghost_draft_private',
    '/api/v1/ai/ghost-drafts/generate',
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
      },
    },
  );
}

export function openAiJobEventStream(input: {
  queryApiBaseUrl: string;
  jobId: number;
  eventSourceFactory?: EventSourceFactory;
}): EventSource | null {
  const factory = input.eventSourceFactory
    ?? (typeof EventSource === 'undefined'
      ? null
      : ((url, init) => new EventSource(url, init)));
  if (!factory) {
    return null;
  }

  return factory(`${input.queryApiBaseUrl}/api/v1/ai-jobs/${input.jobId}/stream`, {
    withCredentials: true,
  });
}
