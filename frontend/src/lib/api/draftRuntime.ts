import { apiFetch, authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export const CURRENT_REVISION_DIRECTION_ACCEPT_ACTION_TYPE =
  'circle.draft.revision_direction.accept' as const;
export const LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE =
  'revision_direction.accept' as const;
export type RevisionDirectionAcceptActionType =
  | typeof CURRENT_REVISION_DIRECTION_ACCEPT_ACTION_TYPE
  | typeof LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE;

export interface TemporaryEditGrantView {
  grantId: string;
  draftPostId: number;
  blockId: string;
  granteeUserId: number;
  requestedBy: number;
  grantedBy: number | null;
  revokedBy: number | null;
  approvalMode: 'manager_confirm' | 'governance_request';
  status: 'requested' | 'active' | 'revoked' | 'expired' | 'rejected';
  governanceRequestId: string | null;
  requestNote: string | null;
  expiresAt: string | null;
  requestedAt: string;
  grantedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}

export interface RevisionDirectionProposalView {
  revisionProposalId: string;
  draftPostId: number;
  draftVersion: number;
  scopeType: string;
  scopeRef: string;
  proposedBy: number | null;
  summary: string;
  acceptanceMode: 'manager_confirm' | 'role_confirm' | 'governance_request';
  status: 'open' | 'accepted' | 'rejected' | 'expired';
  governanceRequestId: string | null;
  governanceActionType?: RevisionDirectionAcceptActionType | null;
  governanceCaseRef?: string | null;
  createdAt: string;
}

export interface DiscussionDraftWriteResponse {
  text: string;
  heatScore: number | null;
  updatedAt: string | null;
  workingCopyHash: string | null;
  scopedPermissions: DraftScopedPermissionState | null;
}

export interface DiscussionDraftContentResponse extends DiscussionDraftWriteResponse {
  draftTitle: string | null;
  title: string;
  paragraphStructure: {
    canDelete: boolean;
    deleteBlockedBy: string[];
    canEditDocument: boolean;
    documentEditBlockedBy: string[];
  };
}

export type DraftScopedPermissionSource =
  | 'manager_override'
  | 'block_discussion_participant'
  | 'source_participant'
  | 'temporary_grant';

export interface DraftScopedPermissionState {
  isSourceParticipant: boolean;
  editableBlockIds: string[];
  permissionSourcesByBlockId: Record<string, DraftScopedPermissionSource[]>;
}

export interface SaveDraftContentOptions {
  discussionAccessToken?: string | null;
  workingCopyHash?: string | null;
  preserveStructure?: boolean;
  appendParagraph?: boolean;
  editScope?: {
    type: 'paragraph';
    blockId: string;
    baseWorkingCopyHash?: string | null;
  };
  paragraphDelete?: {
    index: number;
  };
}

export interface FetchDraftContentOptions {
  discussionAccessToken?: string | null;
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
  const error = new Error(message) as Error & {
    status?: number;
    code?: string;
    workingCopyHash?: string | null;
  };
  error.status = response.status;
  error.code = typeof payload?.error === 'string' ? payload.error : undefined;
  error.workingCopyHash = typeof payload?.workingCopyHash === 'string'
    ? payload.workingCopyHash
    : null;
  return error;
}

function parsePermissionSources(raw: unknown): DraftScopedPermissionSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is DraftScopedPermissionSource =>
    item === 'manager_override'
    || item === 'block_discussion_participant'
    || item === 'source_participant'
    || item === 'temporary_grant',
  );
}

function parseScopedPermissions(payload: any): DraftScopedPermissionState | null {
  const raw = payload?.scopedPermissions;
  if (!raw || typeof raw !== 'object') return null;
  const permissionSourcesByBlockId: Record<string, DraftScopedPermissionSource[]> = {};
  const rawSources = raw.permissionSourcesByBlockId && typeof raw.permissionSourcesByBlockId === 'object'
    ? raw.permissionSourcesByBlockId
    : {};
  for (const [blockId, sources] of Object.entries(rawSources)) {
    permissionSourcesByBlockId[String(blockId)] = parsePermissionSources(sources);
  }
  const editableBlockIds = Array.isArray(raw.editableBlockIds)
    ? raw.editableBlockIds.map((value: unknown) => String(value || '').trim()).filter(Boolean)
    : [];
  return {
    isSourceParticipant: Boolean(raw.isSourceParticipant),
    editableBlockIds,
    permissionSourcesByBlockId,
  };
}

export async function fetchTemporaryEditGrantsForDraft(
  draftPostId: number,
  fallbackMessage = 'load temporary edit grants failed',
): Promise<TemporaryEditGrantView[]> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/drafts/${draftPostId}/temporary-edit-grants`,
    {
      method: 'GET',
      cache: 'no-store',
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
  return Array.isArray(payload?.grants) ? payload.grants : [];
}

export async function fetchRevisionDirectionsForDraft(
  draftPostId: number,
  draftVersion?: number | null,
  fallbackMessage = 'load revision directions failed',
): Promise<RevisionDirectionProposalView[]> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const query = draftVersion ? `?draftVersion=${draftVersion}` : '';
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/revision-directions/drafts/${draftPostId}/revision-directions${query}`,
    { method: 'GET', cache: 'no-store' },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw buildRequestError(response, payload, fallbackMessage);
  return Array.isArray(payload?.proposals) ? payload.proposals : [];
}

export async function fetchDiscussionDraftContent(
  draftPostId: number,
  options: FetchDraftContentOptions = {},
): Promise<DiscussionDraftContentResponse | null> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/discussion/drafts/${draftPostId}/content`,
    {
      cache: 'no-store',
      headers: options.discussionAccessToken
        ? { Authorization: `Bearer ${options.discussionAccessToken}` }
        : undefined,
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
    draftTitle: typeof payload?.draftTitle === 'string' ? payload.draftTitle : null,
    title: typeof payload?.title === 'string' ? payload.title : '',
    heatScore: typeof payload?.heatScore === 'number' ? payload.heatScore : null,
    updatedAt: payload?.updatedAt ? String(payload.updatedAt) : null,
    workingCopyHash: typeof payload?.workingCopyHash === 'string' ? payload.workingCopyHash : null,
    paragraphStructure: {
      canDelete: payload?.paragraphStructure?.canDelete !== false,
      deleteBlockedBy: Array.isArray(payload?.paragraphStructure?.deleteBlockedBy)
        ? payload.paragraphStructure.deleteBlockedBy.map((value: unknown) => String(value))
        : [],
      // Older runtimes do not enforce the whole-document structure contract.
      // Keep this UI fail-closed until the new backend explicitly opts in.
      canEditDocument: payload?.paragraphStructure?.canEditDocument === true,
      documentEditBlockedBy: Array.isArray(payload?.paragraphStructure?.documentEditBlockedBy)
        ? payload.paragraphStructure.documentEditBlockedBy.map((value: unknown) => String(value))
        : [],
    },
    scopedPermissions: parseScopedPermissions(payload),
  };
}

export async function saveDiscussionDraftContent(
  draftPostId: number,
  text: string,
  fallbackMessage = 'save draft failed',
  options: SaveDraftContentOptions = {},
): Promise<DiscussionDraftWriteResponse> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await authenticatedApiFetch(`${baseUrl}/api/v1/discussion/drafts/${draftPostId}/content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(options.discussionAccessToken ? { Authorization: `Bearer ${options.discussionAccessToken}` } : {}),
    },
    body: JSON.stringify({
      text,
      workingCopyHash: options.workingCopyHash,
      ...(options.preserveStructure ? { preserveStructure: true } : {}),
      ...(options.appendParagraph ? { appendParagraph: true } : {}),
      ...(options.editScope ? { editScope: options.editScope } : {}),
      ...(options.paragraphDelete ? { paragraphDelete: options.paragraphDelete } : {}),
    }),
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    throw buildRequestError(response, payload, fallbackMessage);
  }
  return {
    text,
    heatScore: typeof payload?.heatScore === 'number' ? payload.heatScore : null,
    updatedAt: payload?.updatedAt ? String(payload.updatedAt) : null,
    workingCopyHash: typeof payload?.workingCopyHash === 'string' ? payload.workingCopyHash : null,
    scopedPermissions: parseScopedPermissions(payload),
  };
}

export async function updateDiscussionDraftTitle(
  draftPostId: number,
  input: { title: string; expectedTitle: string },
  fallbackMessage = 'update draft title failed',
): Promise<{ draftTitle: string; title: string; updatedAt: string }> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/discussion/drafts/${draftPostId}/title`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const payload = await readPayload(response);
  if (!response.ok) throw buildRequestError(response, payload, fallbackMessage);
  return {
    draftTitle: String(payload?.draftTitle || ''),
    title: String(payload?.title || ''),
    updatedAt: String(payload?.updatedAt || ''),
  };
}

export async function requestTemporaryEditGrantForDraft(
  draftPostId: number,
  input: { blockId: string; workingCopyHash: string },
  fallbackMessage = 'request temporary edit grant failed',
): Promise<void> {
  const baseUrl = await getDiscussionRuntimeBaseUrl();
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/drafts/${draftPostId}/temporary-edit-grants`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blockId: input.blockId,
        workingCopyHash: input.workingCopyHash,
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
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/grants/${grantId}/issue`,
    {
      method: 'POST',
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
  const response = await authenticatedApiFetch(
    `${baseUrl}/api/v1/temporary-edit-grants/grants/${grantId}/revoke`,
    {
      method: 'POST',
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
