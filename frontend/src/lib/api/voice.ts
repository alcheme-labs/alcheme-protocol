import { apiFetch } from "@/lib/api/fetch";
import { resolveNodeRoute } from "@/lib/api/nodeRouting";

export interface VoiceSession {
  id: string;
  roomKey: string;
  provider: string;
  providerRoomId: string;
  status: string;
  reused?: boolean;
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

export interface VoiceParticipant {
  walletPubkey: string;
  role: "speaker" | "listener" | "queued" | string;
  joinedAt: string | null;
  leftAt: string | null;
  mutedBySelf: boolean;
  mutedByModerator: boolean;
  queuePosition: number | null;
}

export interface VoiceParticipantsResponse {
  ok: boolean;
  sessionId: string;
  participants: VoiceParticipant[];
  policy: {
    maxSpeakers: number;
    strategy: string;
    source: string;
  };
  permissions: {
    canModerate: boolean;
  };
}

interface VoiceSessionResponse {
  ok: boolean;
  reused?: boolean;
  session: VoiceSession;
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
  const result = payload as VoiceSessionResponse;
  return {
    ...result.session,
    reused: Boolean(result.reused),
  };
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

export async function fetchVoiceParticipants(input: {
  voiceSessionId: string;
  communicationSessionToken: string;
}): Promise<VoiceParticipantsResponse> {
  const route = await resolveNodeRoute("voice_runtime");
  const response = await apiFetch(
    `${route.urlBase}/api/v1/voice/sessions/${encodeURIComponent(input.voiceSessionId)}/participants`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        Authorization: `Bearer ${input.communicationSessionToken}`,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(
      response,
      payload,
      "voice participants request failed",
    );
  }
  return payload as VoiceParticipantsResponse;
}

export async function approveVoiceSpeaker(input: {
  voiceSessionId: string;
  walletPubkey: string;
  communicationSessionToken: string;
}): Promise<void> {
  await updateVoiceSpeakerDecision(input, "approve");
}

export async function denyVoiceSpeaker(input: {
  voiceSessionId: string;
  walletPubkey: string;
  communicationSessionToken: string;
}): Promise<void> {
  await updateVoiceSpeakerDecision(input, "deny");
}

async function updateVoiceSpeakerDecision(
  input: {
    voiceSessionId: string;
    walletPubkey: string;
    communicationSessionToken: string;
  },
  decision: "approve" | "deny",
): Promise<void> {
  const route = await resolveNodeRoute("voice_runtime");
  const response = await apiFetch(
    `${route.urlBase}/api/v1/voice/sessions/${encodeURIComponent(input.voiceSessionId)}/speakers/${encodeURIComponent(input.walletPubkey)}/${decision}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.communicationSessionToken}`,
      },
      body: JSON.stringify({}),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(response, payload, `voice ${decision} failed`);
  }
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
