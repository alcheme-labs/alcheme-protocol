import { authenticatedApiFetch } from "@/lib/api/fetch";
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
  displayName?: string | null;
  circleAlias?: string | null;
  effectiveDisplayName?: string | null;
  displaySource?: string | null;
  displayCircleId?: number | null;
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
  moderationBoundary: VoiceSessionModerationBoundary;
}

export interface VoiceSessionModerationBoundary {
  contract: "voice-session-moderation-current";
  scope: "single_active_voice_session";
  authority: "current_circle_or_room_moderator";
  providerOperation: "configured_voice_provider_participant_mute";
  governanceIntegration: "not_cross_circle_mandate_or_generic_action_registry";
  operationsSurface: "partial_current_session_controls";
  finality: "provider_command_returned_not_authoritative_finality";
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
  const response = await authenticatedApiFetch(`${route.urlBase}/api/v1/voice/sessions`, {
    method: "POST",
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
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/voice/sessions/${encodeURIComponent(input.voiceSessionId)}/token`,
    {
      method: "POST",
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
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/voice/sessions/${encodeURIComponent(input.voiceSessionId)}/participants`,
    {
      method: "GET",
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
  if (
    payload?.ok !== true
    || payload?.sessionId !== input.voiceSessionId
    || !Array.isArray(payload?.participants)
    || typeof payload?.permissions?.canModerate !== "boolean"
    || payload?.moderationBoundary?.contract !== "voice-session-moderation-current"
    || payload.moderationBoundary.scope !== "single_active_voice_session"
    || payload.moderationBoundary.authority !== "current_circle_or_room_moderator"
    || payload.moderationBoundary.providerOperation !== "configured_voice_provider_participant_mute"
    || payload.moderationBoundary.governanceIntegration !== "not_cross_circle_mandate_or_generic_action_registry"
    || payload.moderationBoundary.operationsSurface !== "partial_current_session_controls"
    || payload.moderationBoundary.finality !== "provider_command_returned_not_authoritative_finality"
  ) throw new Error("voice_session_moderation_boundary_invalid");
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
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/voice/sessions/${encodeURIComponent(input.voiceSessionId)}/speakers/${encodeURIComponent(input.walletPubkey)}/${decision}`,
    {
      method: "POST",
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
