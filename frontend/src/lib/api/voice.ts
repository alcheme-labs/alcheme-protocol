import { apiFetch } from "@/lib/api/fetch";
import { resolveNodeRoute } from "@/lib/api/nodeRouting";

export interface VoiceSession {
  id: string;
  roomKey: string;
  provider: string;
  providerRoomId: string;
  status: string;
  createdByPubkey?: string;
  startedAt?: string;
  endedAt?: string | null;
  expiresAt?: string | null;
}

export interface VoiceJoinToken {
  provider: string;
  url: string;
  token: string;
  providerRoomId: string;
  canPublishAudio: boolean;
  canSubscribe: boolean;
  expiresAt?: string | Date;
}

export async function createVoiceSession(input: {
  roomKey: string;
  communicationSessionToken: string;
  ttlSec?: number;
  metadata?: Record<string, unknown>;
}): Promise<VoiceSession> {
  const { communicationSessionToken } = input;
  const route = await resolveNodeRoute("voice_runtime");
  const response = await apiFetch(`${route.urlBase}/api/v1/voice/sessions`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${communicationSessionToken}`,
    },
    body: JSON.stringify({
      roomKey: input.roomKey,
      ttlSec: input.ttlSec,
      metadata: input.metadata,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(response, payload, "voice session request failed");
  }
  return payload.session as VoiceSession;
}

export async function createVoiceToken(input: {
  voiceSessionId: string;
  communicationSessionToken: string;
}): Promise<VoiceJoinToken> {
  const { communicationSessionToken } = input;
  const route = await resolveNodeRoute("voice_runtime");
  const response = await apiFetch(
    `${route.urlBase}/api/v1/voice/sessions/${encodeURIComponent(input.voiceSessionId)}/token`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${communicationSessionToken}`,
      },
      body: JSON.stringify({}),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(response, payload, "voice token request failed");
  }
  return payload.token as VoiceJoinToken;
}

function buildRequestError(
  response: Response,
  payload: unknown,
  fallback: string,
): Error {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const message =
    typeof record?.message === "string"
      ? record.message
      : typeof record?.error === "string"
        ? record.error
        : `${fallback}: ${response.status}`;
  const error = new Error(message) as Error & {
    code?: string;
    status?: number;
    details?: unknown;
  };
  if (typeof record?.error === "string") {
    error.code = record.error;
  }
  error.status = response.status;
  if (record && "details" in record) {
    error.details = record.details;
  }
  return error;
}
