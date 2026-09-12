import crypto from "crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

type VoicePrisma = PrismaClient;

export interface ActiveVoiceSessionRow {
  id: string;
  roomKey: string;
  provider: string;
  providerRoomId: string;
  status: string;
  createdByPubkey: string;
  startedAt: Date;
  endedAt?: Date | null;
  expiresAt?: Date | null;
  metadata?: unknown;
  room?: {
    metadata?: unknown;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrReuseActiveVoiceSessionInput {
  roomKey: string;
  provider: string;
  createdByPubkey: string;
  ttlSec: number;
  metadata?: Prisma.InputJsonValue;
}

export async function createOrReuseActiveVoiceSession(
  prisma: VoicePrisma,
  input: CreateOrReuseActiveVoiceSessionInput,
  options: { now: Date },
): Promise<{ session: ActiveVoiceSessionRow; reused: boolean }> {
  await endExpiredActiveVoiceSessions(prisma, input.roomKey, options.now);

  const existing = await findActiveVoiceSessionByRoomKey(prisma, input.roomKey);
  if (existing) return { session: existing, reused: true };

  const voiceSessionId = `voice_${randomId()}`;
  const providerRoomId = `alcheme_${voiceSessionId}`;
  const expiresAt = new Date(options.now.getTime() + input.ttlSec * 1000);

  try {
    const created = await prisma.voiceSession.create({
      data: {
        id: voiceSessionId,
        roomKey: input.roomKey,
        provider: input.provider,
        providerRoomId,
        status: "active",
        createdByPubkey: input.createdByPubkey,
        expiresAt,
        metadata: input.metadata,
      },
    });
    return { session: created as ActiveVoiceSessionRow, reused: false };
  } catch (error) {
    if (!isUniqueActiveRoomRace(error)) throw error;
    const winner = await findActiveVoiceSessionByRoomKey(
      prisma,
      input.roomKey,
    );
    if (!winner) throw error;
    return { session: winner, reused: true };
  }
}

export async function loadActiveVoiceSessionByRoomKey(
  prisma: VoicePrisma,
  roomKey: string,
  options: { now: Date },
): Promise<ActiveVoiceSessionRow | null> {
  await endExpiredActiveVoiceSessions(prisma, roomKey, options.now);
  return findActiveVoiceSessionByRoomKey(prisma, roomKey);
}

async function endExpiredActiveVoiceSessions(
  prisma: VoicePrisma,
  roomKey: string,
  now: Date,
): Promise<void> {
  await prisma.voiceSession.updateMany({
    where: {
      roomKey,
      status: "active",
      endedAt: null,
      expiresAt: { lte: now },
    },
    data: {
      status: "ended",
      endedAt: now,
    },
  });
}

async function findActiveVoiceSessionByRoomKey(
  prisma: VoicePrisma,
  roomKey: string,
): Promise<ActiveVoiceSessionRow | null> {
  return (await prisma.voiceSession.findFirst({
    where: {
      roomKey,
      status: "active",
      endedAt: null,
    },
    orderBy: {
      startedAt: "desc",
    },
    include: {
      room: {
        select: {
          metadata: true,
        },
      },
    },
  })) as ActiveVoiceSessionRow | null;
}

function isUniqueActiveRoomRace(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "P2002") return true;
  return (
    typeof record.message === "string" &&
    record.message.includes("voice_sessions_one_active_room_idx")
  );
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return crypto.randomBytes(16).toString("hex");
}
