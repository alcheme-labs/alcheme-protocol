import { fetchNodeJson } from './nodeRouting';

export type GuardianFindingLevel = 'observe' | 'notify' | 'propose';
export type GuardianFindingStatus = 'open' | 'acknowledged' | 'dismissed' | 'snoozed' | 'converted';
export type GuardianFindingRiskLevel = 'low' | 'medium' | 'high';
export type GuardianFindingSeverity = 'info' | 'low' | 'medium' | 'high';

export interface GuardianEvidenceRefView {
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

export interface GuardianSuggestedActionView {
  kind?: string;
  labelKey?: string;
  target?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface GuardianFindingView {
  id: string;
  ownerUserId?: number | null;
  circleId: number;
  findingKind: string;
  level: GuardianFindingLevel;
  riskLevel: GuardianFindingRiskLevel;
  severity: GuardianFindingSeverity;
  status: GuardianFindingStatus;
  title: string;
  summary: string;
  explanation: string;
  evidenceRefs: GuardianEvidenceRefView[];
  suggestedAction: GuardianSuggestedActionView;
  sourceDigest: string;
  ruleVersion: string;
  modelProfile?: string | null;
  cooldownUntil?: string | null;
  notificationStatus?: 'skipped' | 'sent' | 'failed' | string;
  notificationError?: string | null;
  convertedProposalId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GuardianFindingListResponse {
  ok: boolean;
  findings: GuardianFindingView[];
}

export interface GuardianFindingReadResponse {
  ok: boolean;
  finding: GuardianFindingView;
}

export interface GuardianFindingDiagnoseResponse {
  ok: boolean;
  status: 'queued' | 'disabled';
  reasonCode?: string;
  jobId?: number;
  contextCapsuleId?: string;
}

export interface GuardianFindingActionResponse {
  ok: boolean;
  finding?: GuardianFindingView;
  proposal?: {
    id: string;
    subjectType: string;
    proposedAction: string;
  };
}

function guardianFindingsPath(path = ''): string {
  return `/api/v1/ai/guardian-findings${path}`;
}

export async function listGuardianFindings(input: {
  circleId: number;
  status?: GuardianFindingStatus | 'all';
  level?: GuardianFindingLevel | 'all';
  limit?: number;
}): Promise<GuardianFindingView[]> {
  const params = new URLSearchParams({
    circleId: String(input.circleId),
    limit: String(input.limit ?? 25),
  });
  if (input.status && input.status !== 'all') params.set('status', input.status);
  if (input.level && input.level !== 'all') params.set('level', input.level);
  const payload = await fetchNodeJson<GuardianFindingListResponse>('ghost_draft_private', guardianFindingsPath(`?${params.toString()}`), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.findings ?? [];
}

export async function getGuardianFinding(findingId: string): Promise<GuardianFindingView> {
  const payload = await fetchNodeJson<GuardianFindingReadResponse>('ghost_draft_private', guardianFindingsPath(`/${encodeURIComponent(findingId)}`), {
    init: {
      method: 'GET',
      cache: 'no-store',
    },
  });
  return payload.finding;
}

export async function requestGuardianFindingDiagnose(input: {
  circleId: number;
  reason?: string;
}): Promise<GuardianFindingDiagnoseResponse> {
  return fetchNodeJson<GuardianFindingDiagnoseResponse>(
    'ghost_draft_private',
    '/api/v1/ai/guardian-findings/diagnose',
    {
      init: {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          circleId: input.circleId,
          reason: input.reason ?? 'manual_check',
        }),
      },
    },
  );
}

export async function ackGuardianFinding(findingId: string): Promise<GuardianFindingActionResponse> {
  return postGuardianFindingAction(findingId, 'ack', {});
}

export async function dismissGuardianFinding(
  findingId: string,
  reason: string,
): Promise<GuardianFindingActionResponse> {
  return postGuardianFindingAction(findingId, 'dismiss', { reason });
}

export async function snoozeGuardianFinding(
  findingId: string,
  snoozeUntil: string,
): Promise<GuardianFindingActionResponse> {
  return postGuardianFindingAction(findingId, 'snooze', { snoozeUntil });
}

export async function convertGuardianFinding(findingId: string): Promise<GuardianFindingActionResponse> {
  return postGuardianFindingAction(findingId, 'convert', {});
}

async function postGuardianFindingAction(
  findingId: string,
  action: 'ack' | 'dismiss' | 'snooze' | 'convert',
  body: Record<string, unknown>,
): Promise<GuardianFindingActionResponse> {
  return fetchNodeJson<GuardianFindingActionResponse>(
    'ghost_draft_private',
    `/api/v1/ai/guardian-findings/${encodeURIComponent(findingId)}/${action}`,
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
