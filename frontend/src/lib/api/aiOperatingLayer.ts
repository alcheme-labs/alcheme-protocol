import { fetchNodeJson } from './nodeRouting';

export interface TrendPlacePromptRequest {
  placeSeed: string;
  locale?: 'en' | 'zh' | 'fr' | 'es';
  communityType?: string | null;
  mode?: 'social' | 'knowledge' | null;
}

export interface TrendPlacePromptSuggestion {
  id: string;
  title: string;
  namePatch: string | null;
  descriptionPatch: string;
  promptText: string;
  rationale: string;
  confidence: number;
  evidenceRefIds: string[];
}

export interface TrendPlacePromptView {
  status: 'pending' | 'ready' | 'fallback' | 'failed';
  failureCode: string | null;
  generatedAt: string | null;
  expiresAt: string | null;
  query: {
    display: string;
    digest: string;
  };
  confidence: number;
  sourceDigest: string;
  suggestions: TrendPlacePromptSuggestion[];
  evidenceRefs: Array<{
    sourceType: 'trend_receipt';
    sourceId: string;
    digest: string;
    visibility: 'public';
    locator?: {
      type: string;
      ref: string;
    };
    permissionSnapshot?: {
      sourceKey?: string;
      licenseNote?: string;
      queryDigest?: string;
      cacheKey?: string;
      visibility?: string;
    };
    expiresAt?: string | null;
  }>;
}

export interface TrendPlacePromptResponse {
  ok: boolean;
  status: 'queued' | 'pending' | 'ready' | 'fallback' | 'failed' | 'expired';
  jobId?: number | null;
  promptId: string;
  cacheKey?: string;
  prompt?: TrendPlacePromptView | null;
  proposalArtifactId?: string | null;
}

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function requestTrendPlacePrompt(
  input: TrendPlacePromptRequest,
): Promise<TrendPlacePromptResponse> {
  return fetchNodeJson<TrendPlacePromptResponse>('trend_prompt_lifecycle', '/api/v1/ai/trend-prompts', {
    init: {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  });
}

export async function getTrendPlacePrompt(
  promptId: string,
): Promise<TrendPlacePromptResponse> {
  return fetchNodeJson<TrendPlacePromptResponse>(
    'trend_prompt_lifecycle',
    `/api/v1/ai/trend-prompts/${encodeURIComponent(promptId)}`,
    {
      init: {
        method: 'GET',
        cache: 'no-store',
      },
    },
  );
}

export async function pollTrendPlacePrompt(
  promptId: string,
  options: PollOptions = {},
): Promise<TrendPlacePromptResponse> {
  const intervalMs = options.intervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 20000;
  const startedAt = Date.now();

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('Trend prompt polling aborted', 'AbortError');
    }
    const response = await getTrendPlacePrompt(promptId);
    if (response.status !== 'queued' && response.status !== 'pending') {
      return response;
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return {
        ...response,
        ok: false,
        status: 'expired',
      };
    }
    await sleep(intervalMs, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Trend prompt polling aborted', 'AbortError'));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException('Trend prompt polling aborted', 'AbortError'));
    }, { once: true });
  });
}
