import { authenticatedApiFetchJson } from './fetch';
import { fetchNodeJson, type NodeRoutingSurface } from './nodeRouting';
import { getQueryApiBaseUrl } from '../config/queryApiBase';

export type NeutralEvaluationSubjectType = 'post' | 'draft_post' | 'source_material';
export type NeutralEvaluationStatus = 'pending' | 'ready' | 'no_source' | 'blocked_transcript_review' | 'failed' | string;
export type NeutralEvaluationVisibility = 'private' | 'public' | 'retracted' | string;

export interface NeutralEvaluationClaimView {
  id: string;
  text: string;
  evidenceRefIds: string[];
}

export interface NeutralEvaluationEvidenceSummaryView {
  evidenceRefId: string;
  note: string;
}

export interface NeutralEvaluationEvidenceRefView {
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

export interface NeutralEvaluationArtifactView {
  id: string;
  circleId: number;
  subjectType: NeutralEvaluationSubjectType | string;
  subjectId: string;
  authorUserId?: number | null;
  requestedByUserId?: number | null;
  status: NeutralEvaluationStatus;
  visibility: NeutralEvaluationVisibility;
  reviewStatus: 'unreviewed' | 'reviewed' | 'flagged' | string;
  appealStatus: 'none' | 'open' | 'resolved' | string;
  transcriptReviewStatus?: string | null;
  transcriptSourceMaterialId?: number | null;
  summary: string;
  claims: NeutralEvaluationClaimView[];
  evidenceSummary: NeutralEvaluationEvidenceSummaryView[];
  evidenceRefs: NeutralEvaluationEvidenceRefView[];
  assumptions: string[];
  evidenceGaps: string[];
  counterpoints: string[];
  verifiableNextSteps: string[];
  neutralWordingSuggestion: string;
  confidence: 'low' | 'medium' | 'high' | string;
  limitations: string[];
  sourceDigest: string;
  failureCode?: string | null;
  aiJobId?: number | null;
  modelProfile?: string | null;
  promptVersion?: string | null;
  outputSchemaVersion?: string | null;
  publishedAt?: string | null;
  withdrawnAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface NeutralEvaluationCreateResponse {
  ok: boolean;
  status: 'queued' | 'no_source' | 'blocked_transcript_review' | string;
  artifactId?: string;
  jobId?: number;
  contextCapsuleId?: string;
  artifact?: NeutralEvaluationArtifactView;
}

export interface NeutralEvaluationArtifactResponse {
  ok: boolean;
  artifact: NeutralEvaluationArtifactView;
}

export interface NeutralEvaluationListResponse {
  ok: boolean;
  artifacts: NeutralEvaluationArtifactView[];
}

function queryApiBaseUrl(): string {
  return getQueryApiBaseUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL);
}

function neutralEvaluationUrl(path = ''): string {
  return `${queryApiBaseUrl()}/api/v1/ai/evaluations${path}`;
}

function neutralEvaluationRequestSurface(subjectType: NeutralEvaluationSubjectType): NodeRoutingSurface | null {
  if (subjectType === 'draft_post') return 'ghost_draft_private';
  if (subjectType === 'source_material') return 'source_materials';
  return null;
}

function neutralEvaluationFetchJson<T>(
  surface: NodeRoutingSurface | null | undefined,
  path: string,
  init: RequestInit,
): Promise<T> {
  if (surface) {
    return fetchNodeJson<T>(surface, path, { init });
  }
  return authenticatedApiFetchJson<T>(neutralEvaluationUrl(path.replace(/^\/api\/v1\/ai\/evaluations/, '')), { init });
}

export async function requestNeutralEvaluation(input: {
  circleId: number;
  subjectType: NeutralEvaluationSubjectType;
  subjectId: string | number;
  locale?: string;
}): Promise<NeutralEvaluationCreateResponse> {
  const init = {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      circleId: input.circleId,
      subjectType: input.subjectType,
      subjectId: String(input.subjectId),
      locale: input.locale ?? 'en',
    }),
  } satisfies RequestInit;
  const surface = neutralEvaluationRequestSurface(input.subjectType);
  if (surface) {
    return fetchNodeJson<NeutralEvaluationCreateResponse>(surface, '/api/v1/ai/evaluations', { init });
  }
  return authenticatedApiFetchJson<NeutralEvaluationCreateResponse>(neutralEvaluationUrl(), {
    init: {
      ...init,
    },
  });
}

export async function getNeutralEvaluation(
  artifactId: string,
  options: { surface?: NodeRoutingSurface | null } = {},
): Promise<NeutralEvaluationArtifactView> {
  const payload = await neutralEvaluationFetchJson<NeutralEvaluationArtifactResponse>(
    options.surface,
    `/api/v1/ai/evaluations/${encodeURIComponent(artifactId)}`,
    {
      method: 'GET',
      cache: 'no-store',
    },
  );
  return payload.artifact;
}

export async function listNeutralEvaluations(input: {
  circleId: number;
  subjectType?: NeutralEvaluationSubjectType | null;
  subjectId?: string | number | null;
  limit?: number;
}): Promise<NeutralEvaluationArtifactView[]> {
  const params = new URLSearchParams({
    circleId: String(input.circleId),
    limit: String(input.limit ?? 10),
  });
  if (input.subjectType) params.set('subjectType', input.subjectType);
  if (input.subjectId) params.set('subjectId', String(input.subjectId));
  const surface = input.subjectType ? neutralEvaluationRequestSurface(input.subjectType) : 'ghost_draft_private';
  const payload = await neutralEvaluationFetchJson<NeutralEvaluationListResponse>(
    surface,
    `/api/v1/ai/evaluations?${params.toString()}`,
    {
      method: 'GET',
      cache: 'no-store',
    },
  );
  return payload.artifacts ?? [];
}

export async function publishNeutralEvaluation(input: {
  artifactId: string;
  confirmationText?: string;
  surface?: NodeRoutingSurface | null;
}): Promise<NeutralEvaluationArtifactView> {
  const payload = await neutralEvaluationFetchJson<NeutralEvaluationArtifactResponse>(
    input.surface,
    `/api/v1/ai/evaluations/${encodeURIComponent(input.artifactId)}/publish`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        confirmationText: input.confirmationText ?? 'publish evaluation',
      }),
    },
  );
  return payload.artifact;
}

export async function retractNeutralEvaluation(input: {
  artifactId: string;
  reason?: string;
  surface?: NodeRoutingSurface | null;
}): Promise<NeutralEvaluationArtifactView> {
  const payload = await neutralEvaluationFetchJson<NeutralEvaluationArtifactResponse>(
    input.surface,
    `/api/v1/ai/evaluations/${encodeURIComponent(input.artifactId)}/retract`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: input.reason ?? '',
      }),
    },
  );
  return payload.artifact;
}

export async function submitNeutralEvaluationAppeal(input: {
  artifactId: string;
  appealText: string;
  surface?: NodeRoutingSurface | null;
}): Promise<void> {
  await neutralEvaluationFetchJson(
    input.surface,
    `/api/v1/ai/evaluations/${encodeURIComponent(input.artifactId)}/appeals`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        appealText: input.appealText,
      }),
    },
  );
}

export async function submitNeutralEvaluationReview(input: {
  artifactId: string;
  reviewStatus: 'reviewed' | 'flagged';
  note?: string;
  surface?: NodeRoutingSurface | null;
}): Promise<void> {
  await neutralEvaluationFetchJson(
    input.surface,
    `/api/v1/ai/evaluations/${encodeURIComponent(input.artifactId)}/reviews`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reviewStatus: input.reviewStatus,
        note: input.note ?? '',
      }),
    },
  );
}
