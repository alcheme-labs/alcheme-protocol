import { apiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';

export interface StorageUploadPayload {
  circleId: number;
  uri: string;
}

export async function uploadFinalDraftDocument(input: {
  draftPostId: number;
  title: string;
  document: string;
}): Promise<StorageUploadPayload> {
  const route = await resolveNodeRoute('discussion_runtime');
  const response = await apiFetch(
    `${route.urlBase}/api/v1/storage/drafts/${input.draftPostId}/final-document`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: input.title,
        document: input.document,
      }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === 'string'
      ? payload.message
      : typeof payload?.error === 'string'
        ? payload.error
        : `request failed: ${response.status}`;
    const error = new Error(message) as Error & {
      code?: string;
      status?: number;
      details?: unknown;
    };
    if (typeof payload?.error === 'string') {
      error.code = payload.error;
    }
    error.status = response.status;
    if (payload && typeof payload === 'object' && 'details' in payload) {
      error.details = (payload as Record<string, unknown>).details;
    }
    throw error;
  }
  return payload as StorageUploadPayload;
}
