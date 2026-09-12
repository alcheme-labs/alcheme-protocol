import { fetchNodeJson, type NodeRoutingSurface } from './nodeRouting';

export type SettingsTextAssistField = 'profile.displayName' | 'profile.bio' | 'circle_alias.alias';

export interface SettingsTextAssistRequest {
  field: SettingsTextAssistField;
  circleId?: number;
  locale?: 'en' | 'zh' | 'fr' | 'es';
  userIntent?: string;
  currentValue: string;
  surroundingValues?: Record<string, unknown>;
}

export interface SettingsTextAssistResponse {
  ok: boolean;
  status: 'queued' | 'disabled';
  reasonCode?: string;
  jobId?: number;
  proposalSubjectType?: string;
  proposalSubjectId?: string;
}

export interface SettingsTextAssistProposalView {
  id: string;
  taskType: 'settings.field_text_suggestion.v1';
  subjectType: 'profile' | 'circle_alias';
  subjectId: string;
  status: string;
  riskLevel: 'low';
  proposedAction: 'settings_text.apply_local_suggestion';
  proposedDiff: {
    field?: SettingsTextAssistField;
    previousValue?: string;
    suggestedValue?: string | null;
    reason?: string;
    confidence?: number | null;
    requiredPermission?: string;
  };
  validationErrors: Array<{
    field?: string | null;
    reasonCode?: string;
    message?: string;
  }>;
  reviewRequired: boolean;
}

export interface SettingsTextAiJobView {
  id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: {
    proposalArtifactId?: string | null;
    status?: string;
    field?: SettingsTextAssistField;
    riskLevel?: 'low';
    validationErrorCount?: number;
    failureCode?: string | null;
  } | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  surface?: NodeRoutingSurface;
}

export const SETTINGS_TEXT_ASSIST_POLL_TIMEOUT_MS = 45_000;

function aiJobPath(jobId: number): string {
  return `/api/v1/ai-jobs/${encodeURIComponent(String(jobId))}`;
}

function aiProposalPath(proposalId: string): string {
  return `/api/v1/ai-operating-layer/proposals/${encodeURIComponent(proposalId)}`;
}

export async function requestSettingsTextAssist(
  input: SettingsTextAssistRequest,
): Promise<SettingsTextAssistResponse> {
  return fetchNodeJson<SettingsTextAssistResponse>(
    'ghost_draft_private',
    '/api/v1/ai/settings-text-assist/proposals',
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

export async function getSettingsTextAiJob(
  jobId: number,
  surface: NodeRoutingSurface = 'ghost_draft_private',
): Promise<SettingsTextAiJobView> {
  const payload = await fetchNodeJson<{ok: boolean; job: SettingsTextAiJobView}>(surface, aiJobPath(jobId), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.job;
}

export async function getSettingsTextProposal(
  proposalId: string,
  surface: NodeRoutingSurface = 'ghost_draft_private',
): Promise<SettingsTextAssistProposalView> {
  const payload = await fetchNodeJson<{ok: boolean; proposal: SettingsTextAssistProposalView}>(surface, aiProposalPath(proposalId), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.proposal;
}

export async function pollSettingsTextAssistProposal(
  jobId: number,
  options: PollOptions = {},
): Promise<SettingsTextAssistProposalView | null> {
  const intervalMs = options.intervalMs ?? 900;
  const timeoutMs = options.timeoutMs ?? SETTINGS_TEXT_ASSIST_POLL_TIMEOUT_MS;
  const surface = options.surface ?? 'ghost_draft_private';
  const startedAt = Date.now();

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('Settings Text Assist polling aborted', 'AbortError');
    }
    const job = await getSettingsTextAiJob(jobId, surface);
    if (job.status === 'succeeded') {
      const proposalArtifactId = typeof job.result?.proposalArtifactId === 'string'
        ? job.result.proposalArtifactId
        : '';
      return proposalArtifactId ? getSettingsTextProposal(proposalArtifactId, surface) : null;
    }
    if (job.status === 'failed') {
      throw new Error(job.lastErrorCode || job.lastErrorMessage || 'settings_text_assist_failed');
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return null;
    }
    await sleep(intervalMs, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Settings Text Assist polling aborted', 'AbortError'));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException('Settings Text Assist polling aborted', 'AbortError'));
    }, { once: true });
  });
}
