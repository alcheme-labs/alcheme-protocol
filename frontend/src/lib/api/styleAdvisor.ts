import { fetchNodeJson, type NodeRoutingSurface } from './nodeRouting';

export type StyleAdvisorScope = 'personal' | 'circle' | 'session_preview';
export type StyleRiskLevel = 'low' | 'medium' | 'high';
export type StyleTokenName = 'surface' | 'text' | 'accent' | 'motion';

export interface StyleTokenSelections {
  surface: string;
  text: string;
  accent: string;
  motion: string;
}

export interface StyleLifeFeelInputs {
  colorTemperature?: {
    zone?: 'cool' | 'neutral' | 'warm';
  };
  emphasisLevel?: number;
  curiosityEvents?: string[];
}

export interface StyleTokenChange {
  token: StyleTokenName;
  previousValue: string;
  proposedValue: string;
  reason: string;
}

export interface StyleAccessibilityCheck {
  check: 'contrast' | 'intensity' | string;
  passed: boolean;
  ratio?: number;
  minRatio?: number;
  message: string;
}

export interface StyleProposalView {
  id: string;
  taskType: 'style.life_feel_advisor.v1';
  subjectType: 'style_user' | 'circle' | 'style_session';
  subjectId: string;
  status: string;
  riskLevel: StyleRiskLevel;
  proposedAction: 'style.preview_personal_preferences' | 'style.preview_circle_style';
  proposedDiff: {
    scope?: StyleAdvisorScope;
    reason?: string;
    riskLevel?: StyleRiskLevel;
    tokenPolicyVersion?: string;
    styleIntent?: string;
    tone?: string;
    tokenSelections?: StyleTokenSelections;
    tokenDiff?: StyleTokenChange[];
    lifeFeelInputs?: StyleLifeFeelInputs;
    previewState?: {
      scope?: StyleAdvisorScope;
      tokenSelections?: StyleTokenSelections;
      lifeFeelInputs?: StyleLifeFeelInputs;
      swatches?: Array<{
        token: StyleTokenName;
        value: string;
        hex?: string | null;
      }>;
    };
    accessibilityChecks?: StyleAccessibilityCheck[];
  };
  validationErrors: Array<{
    field?: string | null;
    reasonCode?: string;
    message?: string;
  }>;
  reviewRequired: boolean;
}

export interface StyleAdvisorRequest {
  scope: StyleAdvisorScope;
  circleId?: number;
  sessionPreviewId?: string;
  locale?: 'en' | 'zh' | 'fr' | 'es';
  userIntent: string;
  currentPreference?: Record<string, unknown>;
  lifeFeelSignals?: Record<string, unknown>;
  publicCircleSnapshot?: Record<string, unknown> | null;
}

export interface StyleAdvisorResponse {
  ok: boolean;
  status: 'queued' | 'disabled';
  reasonCode?: string;
  jobId?: number;
  proposalSubjectType?: string;
  proposalSubjectId?: string;
}

export interface StyleAiJobView {
  id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: {
    proposalArtifactId?: string | null;
    status?: string;
    scope?: StyleAdvisorScope;
    riskLevel?: StyleRiskLevel;
    tokenChangeCount?: number;
    validationErrorCount?: number;
    failureCode?: string | null;
  } | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface StylePreferenceView {
  id: string;
  scopeType: 'personal' | 'circle' | string;
  userId?: number | null;
  circleId?: number | null;
  status: string;
  preferencePayload: {
    scope?: StyleAdvisorScope;
    tokenPolicyVersion?: string;
    tokenSelections?: Partial<StyleTokenSelections>;
    lifeFeelInputs?: StyleLifeFeelInputs;
  };
  sourceProposalId?: string | null;
  updatedAt?: string | null;
}

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  surface?: NodeRoutingSurface;
}

export interface StyleAdvisorEventInput {
  proposalId: string;
  eventType: 'previewed' | 'ignored' | 'personal_applied' | 'circle_applied' | 'reset' | 'deleted' | 'exported';
  scope?: StyleAdvisorScope;
  clientStateDigest?: string;
}

function stylePreferencesUrl(path = ''): string {
  return `/api/v1/style-preferences${path}`;
}

function aiJobPath(jobId: number): string {
  return `/api/v1/ai-jobs/${encodeURIComponent(String(jobId))}`;
}

function aiProposalPath(proposalId: string): string {
  return `/api/v1/ai-operating-layer/proposals/${encodeURIComponent(proposalId)}`;
}

export async function requestStyleAdvisor(input: StyleAdvisorRequest): Promise<StyleAdvisorResponse> {
  return fetchNodeJson<StyleAdvisorResponse>(
    'ghost_draft_private',
    '/api/v1/ai/style-advisor/proposals',
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

export async function getStyleAiJob(
  jobId: number,
  surface: NodeRoutingSurface = 'ghost_draft_private',
): Promise<StyleAiJobView> {
  const payload = await fetchNodeJson<{ok: boolean; job: StyleAiJobView}>(surface, aiJobPath(jobId), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.job;
}

export async function getStyleProposal(
  proposalId: string,
  surface: NodeRoutingSurface = 'ghost_draft_private',
): Promise<StyleProposalView> {
  const payload = await fetchNodeJson<{ok: boolean; proposal: StyleProposalView}>(surface, aiProposalPath(proposalId), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.proposal;
}

export async function pollStyleAdvisorProposal(
  jobId: number,
  options: PollOptions = {},
): Promise<StyleProposalView | null> {
  const intervalMs = options.intervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? 25000;
  const surface = options.surface ?? 'ghost_draft_private';
  const startedAt = Date.now();

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('Style Advisor polling aborted', 'AbortError');
    }
    const job = await getStyleAiJob(jobId, surface);
    if (job.status === 'succeeded') {
      const proposalArtifactId = typeof job.result?.proposalArtifactId === 'string'
        ? job.result.proposalArtifactId
        : '';
      return proposalArtifactId ? getStyleProposal(proposalArtifactId, surface) : null;
    }
    if (job.status === 'failed') {
      throw new Error(job.lastErrorCode || job.lastErrorMessage || 'style_advisor_failed');
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return null;
    }
    await sleep(intervalMs, options.signal);
  }
}

export async function recordStyleAdvisorEvent(input: StyleAdvisorEventInput): Promise<void> {
  await fetchNodeJson<void>(
    'ghost_draft_private',
    `/api/v1/ai/style-advisor/proposals/${encodeURIComponent(input.proposalId)}/events`,
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          eventType: input.eventType,
          scope: input.scope,
          clientStateDigest: input.clientStateDigest,
        }),
      },
    },
  );
}

export async function getCurrentStylePreference(input: {
  scope: 'personal' | 'circle';
  circleId?: number;
}): Promise<StylePreferenceView | null> {
  const params = new URLSearchParams({ scope: input.scope });
  if (input.circleId) params.set('circleId', String(input.circleId));
  const payload = await fetchNodeJson<{ok: boolean; preference: StylePreferenceView | null}>('ghost_draft_private', stylePreferencesUrl(`/current?${params.toString()}`), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.preference;
}

export async function applyStylePreference(input: {
  scope: 'personal' | 'circle';
  proposalId: string;
  circleId?: number;
}): Promise<StylePreferenceView | null> {
  const payload = await fetchNodeJson<{ok: boolean; preference: StylePreferenceView | null}>('ghost_draft_private', stylePreferencesUrl('/apply'), {
    init: {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    },
  });
  return payload.preference;
}

export async function exportStylePreferences(): Promise<{preferences: StylePreferenceView[]}> {
  return fetchNodeJson<{preferences: StylePreferenceView[]}>('ghost_draft_private', stylePreferencesUrl('/export'), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
}

export async function deletePersonalStylePreferences(): Promise<{deletedCount: number}> {
  return fetchNodeJson<{deletedCount: number}>('ghost_draft_private', stylePreferencesUrl('/personal'), {
    init: {
      method: 'DELETE',
      cache: 'no-store',
    },
  });
}

export async function resetCircleStylePreference(circleId: number): Promise<{resetCount: number}> {
  return fetchNodeJson<{resetCount: number}>('ghost_draft_private', stylePreferencesUrl('/circle/reset'), {
    init: {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ circleId }),
    },
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Style Advisor polling aborted', 'AbortError'));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException('Style Advisor polling aborted', 'AbortError'));
    }, { once: true });
  });
}
