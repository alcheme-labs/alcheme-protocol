import { type Prisma, type PrismaClient } from "@prisma/client";

import {
  loadVoiceRuntimeConfig,
  normalizeVoiceSpeakerPolicy,
  type VoiceRuntimeConfig,
  type VoiceSpeakerLimitStrategy,
  type VoiceSpeakerPolicy,
} from "../../config/voice";
import type { CircleActor } from "../auth/actor";
import { withRoomCapabilitiesMetadata } from "./capabilities";
import { canModerateRoom } from "./permissions";
import { resolveCommunicationRoom } from "./roomResolver";

export interface EnsureCircleCommunicationRoomInput {
  circleId: number;
  actor: CircleActor;
}

export interface EnsureCircleCommunicationRoomOptions {
  now?: Date;
  voiceConfig?: VoiceRuntimeConfig;
}

type CircleRoomPrisma = Pick<
  PrismaClient,
  | "circle"
  | "externalApp"
  | "communicationRoom"
  | "communicationRoomMember"
>;

export async function ensureCircleCommunicationRoom(
  prisma: CircleRoomPrisma,
  input: EnsureCircleCommunicationRoomInput,
  options: EnsureCircleCommunicationRoomOptions = {},
): Promise<{ room: any; member: any }> {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw Object.assign(new Error("invalid_circle_id"), { statusCode: 400 });
  }
  if (input.actor.circle.id !== input.circleId) {
    throw Object.assign(new Error("circle_actor_mismatch"), { statusCode: 403 });
  }
  const roomKey = `circle:${input.circleId}`;
  const existingRoom = await prisma.communicationRoom.findUnique({
    where: { roomKey },
  });
  const metadata = mergeCircleRoomVoiceMetadata(
    existingRoom?.metadata,
    options.voiceConfig ?? loadVoiceRuntimeConfig(),
  );
  const room = await resolveCommunicationRoom(
    prisma,
    {
      roomType: "circle",
      parentCircleId: input.circleId,
      walletPubkey: input.actor.pubkey,
      createdByPubkey: input.actor.pubkey,
      knowledgeMode: "full",
      retentionPolicy: "persistent",
      metadata,
      trustedFirstPartyMetadata: true,
    },
    { now: options.now },
  );

  const member = await prisma.communicationRoomMember.upsert({
    where: {
      roomKey_walletPubkey: {
        roomKey,
        walletPubkey: input.actor.pubkey,
      },
    },
    create: {
      roomKey,
      walletPubkey: input.actor.pubkey,
      role: "member",
      canSpeak: true,
      muted: false,
      banned: false,
    },
    update: {
      leftAt: null,
    },
  });

  return { room, member };
}

export async function updateCircleRoomVoicePolicy(
  prisma: CircleRoomPrisma,
  input: {
    circleId: number;
    actor: CircleActor;
    maxSpeakers?: unknown;
    overflowStrategy?: unknown;
  },
  options: {
    voiceConfig?: VoiceRuntimeConfig;
  } = {},
): Promise<{ room: any }> {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw Object.assign(new Error("invalid_circle_id"), { statusCode: 400 });
  }
  const roomKey = `circle:${input.circleId}`;
  if (input.actor.circle.id !== input.circleId) {
    throw Object.assign(new Error("circle_actor_mismatch"), { statusCode: 403 });
  }
  const room = await prisma.communicationRoom.findUnique({
    where: { roomKey },
  });
  if (!room) {
    throw Object.assign(new Error("room_not_found"), { statusCode: 404 });
  }

  const decision = await canModerateRoom(prisma, {
    roomKey,
    walletPubkey: input.actor.pubkey,
    actor: input.actor,
  });
  if (!decision.allowed) {
    throw Object.assign(new Error(decision.reason), {
      statusCode: decision.statusCode,
    });
  }

  const policy = normalizeCircleRoomVoicePolicyPatch(
    input,
    options,
  );
  return applyCircleRoomVoicePolicy(prisma, {
    circleId: input.circleId,
    policy,
  });
}

export async function applyCircleRoomVoicePolicy(
  prisma: Pick<PrismaClient, "communicationRoom">,
  input: {
    circleId: number;
    policy: VoiceSpeakerPolicy;
  },
): Promise<{ room: any }> {
  const roomKey = `circle:${input.circleId}`;
  const room = await prisma.communicationRoom.findUnique({
    where: { roomKey },
  });
  if (!room) {
    throw Object.assign(new Error("room_not_found"), { statusCode: 404 });
  }
  const metadata = plainObjectOrNull(room.metadata) ?? {};
  const nextMetadata = {
    ...metadata,
    voicePolicy: input.policy,
  } as unknown as Prisma.InputJsonValue;
  const updated = await prisma.communicationRoom.update({
    where: { roomKey },
    data: {
      metadata: nextMetadata,
    },
  });

  return { room: updated };
}

export function normalizeCircleRoomVoicePolicyPatch(
  input: {
    maxSpeakers?: unknown;
    overflowStrategy?: unknown;
  },
  options: {
    voiceConfig?: VoiceRuntimeConfig;
  } = {},
): VoiceSpeakerPolicy {
  return normalizeRequestedVoicePolicy(
    input,
    options.voiceConfig ?? loadVoiceRuntimeConfig(),
  );
}

function mergeCircleRoomVoiceMetadata(
  existingMetadata: unknown,
  config: VoiceRuntimeConfig,
): Record<string, unknown> {
  const metadata =
    existingMetadata && typeof existingMetadata === "object" && !Array.isArray(existingMetadata)
      ? { ...(existingMetadata as Record<string, unknown>) }
      : {};
  if (!metadata.voicePolicy) {
    metadata.voicePolicy = normalizeVoiceSpeakerPolicy(null, {
      fallbackMaxSpeakers: config.defaultMaxSpeakersPerSession,
      platformMaxSpeakers: config.platformMaxSpeakersPerSession,
      fallbackStrategy: config.speakerLimitStrategy,
      source: "room_metadata",
    });
  }
  return withRoomCapabilitiesMetadata(metadata, "circle");
}

function normalizeRequestedVoicePolicy(
  input: {
    maxSpeakers?: unknown;
    overflowStrategy?: unknown;
  },
  config: VoiceRuntimeConfig,
): VoiceSpeakerPolicy {
  const overflowStrategy = normalizeVoiceOverflowStrategy(input.overflowStrategy);
  if (!overflowStrategy) {
    throw Object.assign(new Error("invalid_voice_overflow_strategy"), {
      statusCode: 400,
    });
  }
  const requestedMaxSpeakers =
    optionalPositiveInt(input.maxSpeakers) ??
    config.defaultMaxSpeakersPerSession;
  return {
    maxSpeakers: Math.min(
      Math.max(requestedMaxSpeakers, 1),
      config.platformMaxSpeakersPerSession,
    ),
    overflowStrategy,
    moderatorRoles: ["owner", "moderator"],
    source: "room_metadata",
  };
}

function normalizeVoiceOverflowStrategy(
  value: unknown,
): VoiceSpeakerLimitStrategy | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "listen_only") return "listen_only";
  if (normalized === "deny") return "deny";
  if (normalized === "queue") return "queue";
  if (normalized === "moderated_queue") return "moderated_queue";
  return null;
}

function plainObjectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function optionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : null;
  return Number.isSafeInteger(parsed) && parsed && parsed > 0 ? parsed : null;
}
