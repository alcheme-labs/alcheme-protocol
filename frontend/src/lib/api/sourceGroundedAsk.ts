import { fetchNodeJson, type NodeRoutingSurface } from './nodeRouting';

export type SourceGroundedAskScope =
  | 'current_circle'
  | 'current_draft'
  | 'source_materials'
  | 'formal_references'
  | 'trend_receipts';

export interface SourceGroundedCitationView {
  refId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  locator?: {
    type?: string;
    ref?: string;
  } | null;
  visibility: string;
  stale: boolean;
  capturedAt?: string | null;
  createdAt?: string | null;
  fetchedAt?: string | null;
  expiresAt?: string | null;
  sourceStatus?: string | null;
  licenseNote?: string | null;
  note?: string | null;
}

export interface SourceGroundedEvidenceRefView {
  sourceType: string;
  sourceId: string;
  digest: string;
  visibility: string;
  locator?: {
    type?: string;
    ref?: string;
  } | null;
  capturedAt?: string | null;
  expiresAt?: string | null;
}

export interface SourceGroundedAnswerView {
  id: string;
  circleId: number;
  draftPostId?: number | null;
  ownerUserId?: number | null;
  question: string;
  locale: string;
  status: 'pending' | 'ready' | 'no_source' | 'failed' | string;
  failureCode?: string | null;
  answerText: string;
  limitations: string[];
  citations: SourceGroundedCitationView[];
  evidenceRefs: SourceGroundedEvidenceRefView[];
  sourceDigest: string;
  scopeSnapshot?: Record<string, unknown>;
  aiJobId?: number | null;
  modelProfile?: string | null;
  promptVersion?: string | null;
  outputSchemaVersion?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SourceGroundedAskCreateResponse {
  ok: boolean;
  status: 'queued' | 'no_source' | string;
  answerId?: string;
  jobId?: number;
  answer?: SourceGroundedAnswerView;
}

export interface SourceGroundedAnswerResponse {
  ok: boolean;
  answer: SourceGroundedAnswerView;
}

export interface SourceGroundedAnswerListResponse {
  ok: boolean;
  answers: SourceGroundedAnswerView[];
}

function sourceGroundedAskPath(path = ''): string {
  return `/api/v1/ai/source-grounded-asks${path}`;
}

export function resolveSourceGroundedAskSurface(input: {
  draftPostId?: number | null;
  scopes: SourceGroundedAskScope[];
  sourceMaterialIds?: number[];
}): NodeRoutingSurface {
  const scopes = Array.isArray(input.scopes) ? input.scopes : [];
  if (
    Number(input.draftPostId ?? 0) > 0
    || scopes.includes('current_draft')
    || scopes.includes('source_materials')
    || (Array.isArray(input.sourceMaterialIds) && input.sourceMaterialIds.length > 0)
  ) {
    return 'source_materials';
  }
  return 'ghost_draft_private';
}

export async function requestSourceGroundedAsk(input: {
  circleId: number;
  draftPostId?: number | null;
  question: string;
  scopes: SourceGroundedAskScope[];
  sourceMaterialIds?: number[];
  knowledgeIds?: string[];
  trendReceiptIds?: string[];
  locale?: string;
}): Promise<SourceGroundedAskCreateResponse> {
  return fetchNodeJson<SourceGroundedAskCreateResponse>(
    resolveSourceGroundedAskSurface(input),
    '/api/v1/ai/source-grounded-asks',
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          circleId: input.circleId,
          draftPostId: input.draftPostId ?? null,
          question: input.question,
          scopes: input.scopes,
          sourceMaterialIds: input.sourceMaterialIds ?? [],
          knowledgeIds: input.knowledgeIds ?? [],
          trendReceiptIds: input.trendReceiptIds ?? [],
          locale: input.locale ?? 'en',
        }),
      },
    },
  );
}

export async function getSourceGroundedAnswer(
  answerId: string,
  options: { surface?: NodeRoutingSurface } = {},
): Promise<SourceGroundedAnswerView> {
  const payload = await fetchNodeJson<SourceGroundedAnswerResponse>(
    options.surface ?? 'ghost_draft_private',
    sourceGroundedAskPath(`/${encodeURIComponent(answerId)}`),
    {
      init: {
        method: 'GET',
        cache: 'no-store',
      },
    },
  );
  return payload.answer;
}

export async function listSourceGroundedAnswers(input: {
  circleId: number;
  draftPostId?: number | null;
  limit?: number;
  surface?: NodeRoutingSurface;
}): Promise<SourceGroundedAnswerView[]> {
  const params = new URLSearchParams({
    circleId: String(input.circleId),
    limit: String(input.limit ?? 10),
  });
  if (input.draftPostId) params.set('draftPostId', String(input.draftPostId));
  const payload = await fetchNodeJson<SourceGroundedAnswerListResponse>(
    input.surface ?? (input.draftPostId ? 'source_materials' : 'ghost_draft_private'),
    sourceGroundedAskPath(`?${params.toString()}`),
    {
      init: {
        method: 'GET',
        cache: 'no-store',
      },
    },
  );
  return payload.answers ?? [];
}
