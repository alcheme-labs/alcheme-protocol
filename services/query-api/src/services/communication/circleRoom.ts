import { MemberStatus, type Prisma, type PrismaClient } from "@prisma/client";

import {
  loadVoiceRuntimeConfig,
  normalizeVoiceSpeakerPolicy,
  type VoiceRuntimeConfig,
  type VoiceSpeakerLimitStrategy,
  type VoiceSpeakerPolicy,
} from "../../config/voice";
import { withRoomCapabilitiesMetadata } from "./capabilities";
import { canModerateRoom } from "./permissions";
import { resolveCommunicationRoom } from "./roomResolver";

export interface EnsureCircleCommunicationRoomInput {
  circleId: number;
  walletPubkey: string;
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
  | "user"
  | "circleMember"
>;

export async function ensureCircleCommunicationRoom(
  prisma: CircleRoomPrisma,
  input: EnsureCircleCommunicationRoomInput,
  options: EnsureCircleCommunicationRoomOptions = {},
): Promise<{ room: any; member: any }> {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw Object.assign(new Error("invalid_circle_id"), { statusCode: 400 });
  }
  const roomKey = `circle:${input.circleId}`;
  await assertActiveCircleRoomMember(prisma, input);
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
      walletPubkey: input.walletPubkey,
      createdByPubkey: input.walletPubkey,
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
        walletPubkey: input.walletPubkey,
      },
    },
    create: {
      roomKey,
      walletPubkey: input.walletPubkey,
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

async function assertActiveCircleRoomMember(
  prisma: CircleRoomPrisma,
  input: EnsureCircleCommunicationRoomInput,
): Promise<void> {
  const circle = await prisma.circle.findUnique({
    where: { id: input.circleId },
    select: { id: true },
  });
  if (!circle) {
    throw Object.assign(new Error("circle_not_found"), { statusCode: 404 });
  }

  const user = await prisma.user.findUnique({
    where: { pubkey: input.walletPubkey },
    select: { id: true },
  });
  if (!user) {
    throw Object.assign(new Error("room_membership_required"), {
      statusCode: 403,
    });
  }

  const circleMember = await prisma.circleMember.findUnique({
    where: {
      circleId_userId: {
        circleId: input.circleId,
        userId: user.id,
      },
    },
    select: {
      status: true,
      role: true,
    },
  });
  if (!circleMember) {
    throw Object.assign(new Error("room_membership_required"), {
      statusCode: 403,
    });
  }
  if (circleMember.status === MemberStatus.Banned) {
    throw Object.assign(new Error("circle_member_banned"), {
      statusCode: 403,
    });
  }
  if (circleMember.status !== MemberStatus.Active) {
    throw Object.assign(new Error("room_membership_required"), {
      statusCode: 403,
    });
  }
}

export async function updateCircleRoomVoicePolicy(
  prisma: CircleRoomPrisma,
  input: {
    circleId: number;
    walletPubkey: string;
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
  const room = await prisma.communicationRoom.findUnique({
    where: { roomKey },
  });
  if (!room) {
    throw Object.assign(new Error("room_not_found"), { statusCode: 404 });
  }

  const decision = await canModerateRoom(prisma, {
    roomKey,
    walletPubkey: input.walletPubkey,
  });
  if (!decision.allowed) {
    throw Object.assign(new Error(decision.reason), {
      statusCode: decision.statusCode,
    });
  }

  const policy = normalizeRequestedVoicePolicy(
    input,
    options.voiceConfig ?? loadVoiceRuntimeConfig(),
  );
  const metadata = plainObjectOrNull(room.metadata) ?? {};
  const nextMetadata = {
    ...metadata,
    voicePolicy: policy,
  } as unknown as Prisma.InputJsonValue;
  const updated = await prisma.communicationRoom.update({
    where: { roomKey },
    data: {
      metadata: nextMetadata,
    },
  });

  return { room: updated };
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
