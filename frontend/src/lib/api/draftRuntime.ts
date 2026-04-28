import { apiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export interface TemporaryEditGrantView {
  grantId: string;
  draftPostId: number;
  blockId: string;
  granteeUserId: number;
  requestedBy: number;
  grantedBy: number | null;
  revokedBy: number | null;
  approvalMode: 'manager_confirm' | 'governance_vote';
  status: 'requested' | 'active' | 'revoked' | 'expired' | 'rejected';
  governanceProposalId: string | null;
  requestNote: string | null;
  expiresAt: string | null;
  requestedAt: string;
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}

export interface DiscussionDraftContentResponse {
  text: string;
  heatScore: number | null;
  updatedAt: string | null;
}

async function getDiscussionRuntimeBaseUrl(): Promise<string> {
  const route = await resolveNodeRoute('discussion_runtime');
  return route.urlBase;
}

async function readPayload(response: Response): Promise<any> {
  return response.json().catch(() => null);
}

function buildRequestError(response: Response, payload: any, fallback: string): Error {
  const message = typeof payload?.message === 'string'
    ? payload.message
    : typeof payload?.error === 'string'
      ? payload.error
      : fallback || `request failed: ${response.status}`;
  return new Error(message);
}

export async function fetchTemporaryEditGrantsForDraft(
  draftPostId: number,
  fallbackMessage = 'load temporary edit grants failed',
): Promise<TemporaryEditGrantView[]> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/drafts/${draftPostId}/temporary-edit-grants`,
    {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
  return Array.isArray(payload?.grants) ? payload.grants : [];
}

export async function fetchDiscussionDraftContent(
  draftPostId: number,
): Promise<DiscussionDraftContentResponse | null> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/discussion/drafts/${draftPostId}/content`,
    {
      cache: 'no-store',
      credentials: 'include',
    },
  );

  if (response.status === 404 || response.status === 409) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`draft content fetch failed: ${response.status}`);
  }

  const payload = await readPayload(response);
  return {
    text: typeof payload?.text === 'string' ? payload.text : '',
    heatScore: typeof payload?.heatScore === 'number' ? payload.heatScore : null,
    updatedAt: payload?.updatedAt ? String(payload.updatedAt) : null,
  };
}

export async function saveDiscussionDraftContent(
  draftPostId: number,
  text: string,
  fallbackMessage = 'save draft failed',
): Promise<DiscussionDraftContentResponse> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await apiFetch(`${baseUrl}/api/v1/discussion/drafts/${draftPostId}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text }),
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
  return {
    text,
    heatScore: typeof payload?.heatScore === 'number' ? payload.heatScore : null,
    updatedAt: payload?.updatedAt ? String(payload.updatedAt) : null,
  };
}

export async function requestTemporaryEditGrantForDraft(
  draftPostId: number,
  input: { blockId: string },
  fallbackMessage = 'request temporary edit grant failed',
): Promise<void> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/drafts/${draftPostId}/temporary-edit-grants`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blockId: input.blockId,
      }),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
}

export async function issueTemporaryEditGrant(
  grantId: string,
  input: { expiresInMinutes?: number } = {},
  fallbackMessage = 'issue temporary edit grant failed',
): Promise<void> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/grants/${grantId}/issue`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expiresInMinutes: input.expiresInMinutes ?? 60,
      }),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
}

export async function revokeTemporaryEditGrant(
  grantId: string,
  fallbackMessage = 'revoke temporary edit grant failed',
): Promise<void> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await apiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/grants/${grantId}/revoke`,
    {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
}

export async function requestRevisionDirection<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await apiFetch(path, init);
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, `request failed: ${response.status}`);
  }
  return payload as T;
}
