import { apiFetch } from '@/lib/api/fetch';

type EventSourceFactory = (url: string, init?: EventSourceInit) => EventSource;

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : `request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchGhostDraftGenerationPayload<T>(input: {
  queryApiBaseUrl: string;
  generationId: number;
}): Promise<T> {
  return fetchJson<T>(
    `${input.queryApiBaseUrl}/api/v1/ai/ghost-drafts/${input.generationId}`,
    {
      method: 'GET',
    },
  );
}

export async function fetchAiJobPayload<T>(input: {
  queryApiBaseUrl: string;
  jobId: number;
}): Promise<T> {
  return fetchJson<T>(
    `${input.queryApiBaseUrl}/api/v1/ai-jobs/${input.jobId}`,
    {
      method: 'GET',
    },
  );
}

export async function fetchDraftAiJobsPayload<T>(input: {
  queryApiBaseUrl: string;
  postId: number;
  limit?: number;
}): Promise<T> {
  return fetchJson<T>(
    `${input.queryApiBaseUrl}/api/v1/ai-jobs?draftPostId=${encodeURIComponent(String(input.postId))}&limit=${input.limit ?? 10}`,
    {
      method: 'GET',
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
