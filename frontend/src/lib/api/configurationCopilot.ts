import { fetchNodeJson, type NodeRoutingSurface } from './nodeRouting';

export type ConfigurationCopilotEntrypoint = 'create_circle' | 'circle_settings' | 'fork_create';
export type ConfigurationRiskLevel = 'low' | 'medium' | 'high';

export interface ConfigurationFieldChange {
  field: string;
  previousValue: unknown;
  proposedValue: unknown;
  reason: string;
  riskLevel: ConfigurationRiskLevel;
  requiredPermission: string;
  section: string;
  conflicts: string[];
}

export interface ConfigurationProposalView {
  id: string;
  taskType: 'configuration.copilot.v1';
  subjectType: 'circle_create_session' | 'circle' | 'circle_fork_session';
  subjectId: string;
  status: string;
  riskLevel: ConfigurationRiskLevel;
  proposedAction: 'configuration.apply_to_create_circle_form' | 'configuration.apply_to_circle_settings_form' | 'configuration.apply_to_fork_create_form';
  proposedDiff: {
    reason?: string;
    riskLevel?: ConfigurationRiskLevel;
    affectedFields?: string[];
    configDiff?: ConfigurationFieldChange[];
  };
  validationErrors: Array<{
    field?: string | null;
    reasonCode?: string;
    message?: string;
  }>;
  reviewRequired: boolean;
}

export interface ConfigurationCopilotRequest {
  entrypoint: ConfigurationCopilotEntrypoint;
  createSessionId?: string;
  forkSessionId?: string;
  circleId?: number;
  locale?: 'en' | 'zh' | 'fr' | 'es';
  userIntent: string;
  currentSnapshot: Record<string, unknown>;
  targetFields?: string[];
  interactionMode?: 'field_inline' | 'section_diff' | 'full_panel';
  sourceMaterialIds?: number[];
}

export interface ConfigurationCopilotResponse {
  ok: boolean;
  status: 'queued' | 'disabled';
  reasonCode?: string;
  jobId?: number;
  proposalSubjectType?: string;
  proposalSubjectId?: string;
}

export interface ConfigurationAiJobView {
  id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: {
    proposalArtifactId?: string | null;
    status?: string;
    riskLevel?: ConfigurationRiskLevel;
    affectedFields?: string[];
    validationErrorCount?: number;
    failureCode?: string | null;
  } | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
}

export interface ConfigurationCopilotEventInput {
  proposalId: string;
  eventType: 'field_accepted' | 'all_fields_accepted' | 'ignored' | 'local_undo' | 'local_draft_applied';
  field?: string;
  fields?: string[];
  clientStateDigest?: string;
}

export interface PollOptions {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  surface?: NodeRoutingSurface;
}

export const CONFIGURATION_COPILOT_POLL_TIMEOUT_MS = 75_000;

function aiJobPath(jobId: number): string {
  return `/api/v1/ai-jobs/${encodeURIComponent(String(jobId))}`;
}

function aiProposalPath(proposalId: string): string {
  return `/api/v1/ai-operating-layer/proposals/${encodeURIComponent(proposalId)}`;
}

function configurationCopilotRequestSurface(input: ConfigurationCopilotRequest): NodeRoutingSurface {
  return Array.isArray(input.sourceMaterialIds) && input.sourceMaterialIds.length > 0
    ? 'source_materials'
    : 'ghost_draft_private';
}

export async function requestConfigurationCopilot(
  input: ConfigurationCopilotRequest,
): Promise<ConfigurationCopilotResponse> {
  return fetchNodeJson<ConfigurationCopilotResponse>(
    configurationCopilotRequestSurface(input),
    '/api/v1/ai/configuration-copilot/proposals',
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

export async function getConfigurationAiJob(
  jobId: number,
  surface: NodeRoutingSurface = 'ghost_draft_private',
): Promise<ConfigurationAiJobView> {
  const payload = await fetchNodeJson<{ok: boolean; job: ConfigurationAiJobView}>(surface, aiJobPath(jobId), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.job;
}

export async function getConfigurationProposal(
  proposalId: string,
  surface: NodeRoutingSurface = 'ghost_draft_private',
): Promise<ConfigurationProposalView> {
  const payload = await fetchNodeJson<{ok: boolean; proposal: ConfigurationProposalView}>(surface, aiProposalPath(proposalId), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.proposal;
}

export async function pollConfigurationCopilotProposal(
  jobId: number,
  options: PollOptions = {},
): Promise<ConfigurationProposalView | null> {
  const intervalMs = options.intervalMs ?? 1200;
  const timeoutMs = options.timeoutMs ?? CONFIGURATION_COPILOT_POLL_TIMEOUT_MS;
  const surface = options.surface ?? 'ghost_draft_private';
  const startedAt = Date.now();

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('Configuration Copilot polling aborted', 'AbortError');
    }
    const job = await getConfigurationAiJob(jobId, surface);
    if (job.status === 'succeeded') {
      const proposalArtifactId = typeof job.result?.proposalArtifactId === 'string'
        ? job.result.proposalArtifactId
        : '';
      return proposalArtifactId ? getConfigurationProposal(proposalArtifactId, surface) : null;
    }
    if (job.status === 'failed') {
      throw new Error(job.lastErrorCode || job.lastErrorMessage || 'configuration_copilot_failed');
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return null;
    }
    await sleep(intervalMs, options.signal);
  }
}

export async function recordConfigurationCopilotEvent(input: ConfigurationCopilotEventInput): Promise<void> {
  await fetchNodeJson<void>(
    'ghost_draft_private',
    `/api/v1/ai/configuration-copilot/proposals/${encodeURIComponent(input.proposalId)}/events`,
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          eventType: input.eventType,
          field: input.field,
          fields: input.fields,
          clientStateDigest: input.clientStateDigest,
        }),
      },
    },
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Configuration Copilot polling aborted', 'AbortError'));
      return;
    }
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      globalThis.clearTimeout(timeout);
      reject(new DOMException('Configuration Copilot polling aborted', 'AbortError'));
    }, { once: true });
  });
}
