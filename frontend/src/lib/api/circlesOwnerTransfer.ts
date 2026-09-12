import { authenticatedApiFetchJson } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import type { CircleGovernanceRequest } from '@/lib/api/governance';

export interface CircleOwnerTransferRequest {
  id: string;
  circleId: number;
  fromOwnerUserId: number;
  targetUserId: number;
  requestedByUserId: number;
  governanceRequestId: string | null;
  status: 'pending_target_acceptance' | 'pending_governance' | 'executed' | string;
  reason: string | null;
  executionMode: 'off_chain';
  chainStatus: 'not_supported';
  targetAcceptedAt: string | null;
  executedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export async function fetchCircleOwnerTransferRequests(
  circleId: number,
  signal?: AbortSignal,
): Promise<CircleOwnerTransferRequest[]> {
  const route = await resolveNodeRoute('governance');
  const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/circles/${circleId}/authority/owner-transfer-requests`, {
    init: {
      method: 'GET',
      cache: 'no-store',
      signal,
    },
  });
  return Array.isArray(data?.requests)
    ? data.requests.map(normalizeOwnerTransferRequest)
    : [];
}

export async function createCircleOwnerTransferRequest(input: {
  circleId: number;
  targetUserId: number;
  reason?: string | null;
}): Promise<{
  status: 'pending_target_acceptance' | 'pending_governance' | 'executed' | string;
  transfer: CircleOwnerTransferRequest;
}> {
  const route = await resolveNodeRoute('governance');
  const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/circles/${input.circleId}/authority/owner-transfer`, {
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: input.targetUserId,
        reason: input.reason ?? null,
      }),
    },
  });
  return {
    status: String(data?.status || 'pending_target_acceptance'),
    transfer: normalizeOwnerTransferRequest(data?.transfer),
  };
}

export async function acceptCircleOwnerTransferRequest(input: {
  circleId: number;
  transferId: string;
}): Promise<{
  status: 'executed' | 'requires_governance';
  transfer: CircleOwnerTransferRequest;
  request?: CircleGovernanceRequest;
}> {
  const route = await resolveNodeRoute('governance');
  const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/circles/${input.circleId}/authority/owner-transfer-requests/${encodeURIComponent(input.transferId)}/accept`, {
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  });
  return {
    status: data?.status === 'requires_governance' ? 'requires_governance' : 'executed',
    transfer: normalizeOwnerTransferRequest(data?.transfer),
    request: data?.request ?? undefined,
  };
}

function normalizeOwnerTransferRequest(value: any): CircleOwnerTransferRequest {
  return {
    id: String(value?.id || ''),
    circleId: Number(value?.circleId || 0),
    fromOwnerUserId: Number(value?.fromOwnerUserId || 0),
    targetUserId: Number(value?.targetUserId || 0),
    requestedByUserId: Number(value?.requestedByUserId || 0),
    governanceRequestId: value?.governanceRequestId ? String(value.governanceRequestId) : null,
    status: String(value?.status || 'pending_target_acceptance'),
    reason: value?.reason ? String(value.reason) : null,
    executionMode: 'off_chain',
    chainStatus: 'not_supported',
    targetAcceptedAt: value?.targetAcceptedAt ? String(value.targetAcceptedAt) : null,
    executedAt: value?.executedAt ? String(value.executedAt) : null,
    createdAt: value?.createdAt ? String(value.createdAt) : null,
    updatedAt: value?.updatedAt ? String(value.updatedAt) : null,
  };
}
