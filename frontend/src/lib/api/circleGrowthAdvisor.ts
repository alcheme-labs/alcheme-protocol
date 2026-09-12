import { fetchNodeJson } from './nodeRouting';
import type { ConfigurationFieldChange, ConfigurationRiskLevel } from './configurationCopilot';

export type CircleGrowthProposalStatus =
  | 'pending'
  | 'ready'
  | 'no_signal'
  | 'failed'
  | 'snoozed'
  | 'rejected'
  | 'converted';

export interface CircleGrowthSignalItem {
  key: string;
  label?: string;
  value?: number | string | boolean | null;
  severity?: 'positive' | 'neutral' | 'warning' | 'critical' | string;
  evidenceRefIds?: string[];
}

export interface CircleGrowthMissingSignal {
  key: string;
  label?: string;
  severity?: 'warning' | 'critical' | string;
}

export interface CircleGrowthEvidenceRef {
  sourceType: string;
  sourceId: string;
  digest: string;
  visibility: string;
  locator?: {
    type?: string;
    ref?: string;
  } | null;
  permissionSnapshot?: Record<string, unknown>;
  capturedAt?: string | null;
  expiresAt?: string | null;
}

export interface CircleGrowthProposalView {
  id: string;
  circleId: number;
  signalId?: string | null;
  status: CircleGrowthProposalStatus;
  recommendedStage?: string | null;
  explanation: string;
  configDiff: ConfigurationFieldChange[];
  currentSignals: CircleGrowthSignalItem[];
  counterSignals: CircleGrowthSignalItem[];
  missingSignals: CircleGrowthMissingSignal[];
  metricsSnapshot?: Record<string, unknown>;
  cognitiveMapProjection?: Record<string, unknown>;
  evidenceRefs: CircleGrowthEvidenceRef[];
  failureCode?: string | null;
  failureMessage?: string | null;
  rejectReason?: string | null;
  cooldownUntil?: string | null;
  guardianFindingId?: string | null;
  configurationProposalId?: string | null;
  aiJobId?: number | null;
  modelProfile?: string | null;
  promptVersion?: string | null;
  outputSchemaVersion?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CircleGrowthAdvisorRequestResponse {
  ok: boolean;
  status: 'queued' | 'no_signal' | 'deduped' | 'disabled';
  reasonCode?: string;
  jobId?: number;
  proposalId?: string;
  signalId?: string;
  contextCapsuleId?: string;
  proposal?: CircleGrowthProposalView;
}

export interface CircleGrowthProposalListResponse {
  ok: boolean;
  proposals: CircleGrowthProposalView[];
}

export interface CircleGrowthProposalReadResponse {
  ok: boolean;
  proposal: CircleGrowthProposalView;
  events?: Array<Record<string, unknown>>;
}

export interface CircleGrowthActionResponse {
  ok: boolean;
  proposal: CircleGrowthProposalView;
}

function growthAdvisorPath(path = ''): string {
  return `/api/v1/ai/circle-growth-advisor/proposals${path}`;
}

export async function requestCircleGrowthAdvisor(input: {
  circleId: number;
}): Promise<CircleGrowthAdvisorRequestResponse> {
  return fetchNodeJson<CircleGrowthAdvisorRequestResponse>(
    'ghost_draft_private',
    '/api/v1/ai/circle-growth-advisor/proposals',
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          circleId: input.circleId,
        }),
      },
    },
  );
}

export async function listCircleGrowthProposals(input: {
  circleId: number;
  limit?: number;
}): Promise<CircleGrowthProposalView[]> {
  const params = new URLSearchParams({
    circleId: String(input.circleId),
    limit: String(input.limit ?? 20),
  });
  const payload = await fetchNodeJson<CircleGrowthProposalListResponse>('ghost_draft_private', growthAdvisorPath(`?${params.toString()}`), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.proposals ?? [];
}

export async function getCircleGrowthProposal(proposalId: string): Promise<CircleGrowthProposalView> {
  const payload = await fetchNodeJson<CircleGrowthProposalReadResponse>('ghost_draft_private', growthAdvisorPath(`/${encodeURIComponent(proposalId)}`), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.proposal;
}

export async function rejectCircleGrowthProposal(
  proposalId: string,
  reason: string,
): Promise<CircleGrowthActionResponse> {
  return postCircleGrowthProposalAction(proposalId, 'reject', { reason });
}

export async function snoozeCircleGrowthProposal(
  proposalId: string,
  snoozeUntil: string,
  reason?: string | null,
): Promise<CircleGrowthActionResponse> {
  return postCircleGrowthProposalAction(proposalId, 'snooze', { snoozeUntil, reason });
}

export async function convertCircleGrowthProposal(proposalId: string): Promise<CircleGrowthActionResponse> {
  return postCircleGrowthProposalAction(proposalId, 'convert', {});
}

export function maxCircleGrowthRisk(changes: ConfigurationFieldChange[]): ConfigurationRiskLevel {
  if (changes.some((change) => change.riskLevel === 'high')) return 'high';
  if (changes.some((change) => change.riskLevel === 'medium')) return 'medium';
  return 'low';
}

async function postCircleGrowthProposalAction(
  proposalId: string,
  action: 'reject' | 'snooze' | 'convert',
  body: Record<string, unknown>,
): Promise<CircleGrowthActionResponse> {
  return fetchNodeJson<CircleGrowthActionResponse>(
    'ghost_draft_private',
    `/api/v1/ai/circle-growth-advisor/proposals/${encodeURIComponent(proposalId)}/${action}`,
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    },
  );
}
