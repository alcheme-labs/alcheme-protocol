import bs58 from "bs58";
import nacl from "tweetnacl";

import { buildCommunicationRoomKey, normalizeRoomType } from "./roomScope";

export interface AppRoomClaim {
  payload: string;
  signature: string;
}

export interface AppRoomClaimPayload {
  externalAppId: string;
  roomType: string;
  externalRoomId: string;
  transcriptionMode?: string;
  walletPubkeys?: string[];
  roles?: Record<string, string>;
  expiresAt: string;
  nonce: string;
}

export interface ResolveCommunicationRoomInput {
  externalAppId?: string | null;
  roomType: string;
  externalRoomId?: string | null;
  parentCircleId?: number | null;
  participantPubkeys?: string[];
  ttlSec?: number;
  knowledgeMode?: string;
  transcriptionMode?: string;
  retentionPolicy?: string;
  createdByPubkey?: string | null;
  metadata?: Record<string, unknown> | null;
  appRoomClaim?: AppRoomClaim | null;
  walletPubkey?: string | null;
}

export interface ResolveCommunicationRoomOptions {
  now?: Date;
}

export interface ExternalAppRecord {
  id: string;
  status: string;
  serverPublicKey?: string | null;
  claimAuthMode?: string | null;
}

interface CommunicationRoomPrisma {
  circle: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  externalApp: {
    findUnique(input: unknown): Promise<ExternalAppRecord | null>;
  };
  communicationRoom: {
    upsert(input: unknown): Promise<any>;
  };
}

export function createAppRoomClaim(payload: AppRoomClaimPayload): {
  payload: string;
} {
  return {
    payload: Buffer.from(
      JSON.stringify({
        externalAppId: payload.externalAppId,
        roomType: normalizeRoomType(payload.roomType),
        externalRoomId: payload.externalRoomId,
        ...(payload.transcriptionMode
          ? {
              transcriptionMode: normalizeTranscriptionMode(
                payload.transcriptionMode,
              ),
            }
          : {}),
        walletPubkeys: payload.walletPubkeys ?? [],
        ...(payload.roles ? { roles: payload.roles } : {}),
        expiresAt: payload.expiresAt,
        nonce: payload.nonce,
      }),
    ).toString("base64url"),
  };
}

export async function resolveCommunicationRoom(
  prisma: CommunicationRoomPrisma,
  input: ResolveCommunicationRoomInput,
  options: ResolveCommunicationRoomOptions = {},
) {
  const now = options.now ?? new Date();
  const roomType = normalizeRoomType(input.roomType);

  if (input.parentCircleId !== undefined && input.parentCircleId !== null) {
    await assertParentCircleExists(prisma, input.parentCircleId);
  }

  const externalApp = input.externalAppId
    ? await loadActiveExternalApp(prisma, input.externalAppId)
    : null;

  const verifiedClaim = externalApp
    ? verifyAppRoomClaim({
        externalApp,
        claim: input.appRoomClaim,
        expected: {
          externalAppId: externalApp.id,
          roomType,
          externalRoomId: input.externalRoomId ?? "",
          walletPubkey: input.walletPubkey ?? null,
        },
        now,
      })
    : null;

  const roomKey = buildRoomKeyForInput(input, roomType);
  const expiresAt =
    input.ttlSec && input.ttlSec > 0
      ? new Date(now.getTime() + input.ttlSec * 1000)
      : null;
  const knowledgeMode = input.knowledgeMode ?? defaultKnowledgeMode(roomType);
  const transcriptionMode = resolveTranscriptionMode({
    requested: input.transcriptionMode,
    verifiedClaim,
  });
  const retentionPolicy =
    input.retentionPolicy ?? defaultRetentionPolicy(roomType);

  return prisma.communicationRoom.upsert({
    where: { roomKey },
    create: {
      id: roomKey,
      roomKey,
      externalAppId: externalApp?.id ?? null,
      parentCircleId: input.parentCircleId ?? null,
      roomType,
      externalRoomId: input.externalRoomId ?? null,
      lifecycleStatus: "active",
      knowledgeMode,
      transcriptionMode,
      retentionPolicy,
      createdByPubkey: input.createdByPubkey ?? input.walletPubkey ?? null,
      expiresAt,
      metadata: input.metadata ?? null,
    },
    update: {
      lifecycleStatus: "active",
      expiresAt,
      metadata: input.metadata ?? undefined,
    },
  });
}

function buildRoomKeyForInput(
  input: ResolveCommunicationRoomInput,
  roomType: string,
): string {
  if (roomType === "circle") {
    return buildCommunicationRoomKey({
      roomType,
      parentCircleId: input.parentCircleId ?? 0,
    });
  }

  if (roomType === "direct") {
    return buildCommunicationRoomKey({
      roomType,
      participantPubkeys: input.participantPubkeys ?? [],
    });
  }

  return buildCommunicationRoomKey({
    externalAppId: input.externalAppId ?? "",
    roomType,
    externalRoomId: input.externalRoomId ?? "",
  });
}

async function assertParentCircleExists(
  prisma: CommunicationRoomPrisma,
  parentCircleId: number,
): Promise<void> {
  if (!Number.isSafeInteger(parentCircleId) || parentCircleId <= 0) {
    throw new Error("parentCircleId must be a positive integer");
  }

  const circle = await prisma.circle.findUnique({
    where: { id: parentCircleId },
    select: { id: true },
  });
  if (!circle) {
    throw new Error("Parent circle not found");
  }
}

async function loadActiveExternalApp(
  prisma: CommunicationRoomPrisma,
  externalAppId: string,
): Promise<ExternalAppRecord> {
  const externalApp = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: {
      id: true,
      status: true,
      serverPublicKey: true,
      claimAuthMode: true,
    },
  });
  if (!externalApp || externalApp.status !== "active") {
    throw new Error("External app not found or inactive");
  }
  return externalApp;
}

export function verifyAppRoomClaim(input: {
  externalApp: ExternalAppRecord;
  claim?: AppRoomClaim | null;
  expected: {
    externalAppId: string;
    roomType: string;
    externalRoomId: string;
    walletPubkey: string | null;
  };
  now: Date;
}): AppRoomClaimPayload {
  if (input.externalApp.claimAuthMode === "wallet_only_dev") {
    return {
      externalAppId: input.expected.externalAppId,
      roomType: input.expected.roomType,
      externalRoomId: input.expected.externalRoomId,
      walletPubkeys: input.expected.walletPubkey
        ? [input.expected.walletPubkey]
        : [],
      expiresAt: input.now.toISOString(),
      nonce: "wallet_only_dev",
    };
  }

  if (!input.externalApp.serverPublicKey) {
    throw new Error("External app serverPublicKey is required");
  }
  if (!input.claim) {
    throw new Error("appRoomClaim is required");
  }

  const publicKey = decodePublicKey(input.externalApp.serverPublicKey);
  const signature = Buffer.from(input.claim.signature, "base64");
  const message = Buffer.from(input.claim.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("appRoomClaim signature invalid");
  }

  const payload = parseClaimPayload(input.claim.payload);
  if (
    payload.externalAppId !== input.expected.externalAppId ||
    normalizeRoomType(payload.roomType) !== input.expected.roomType ||
    payload.externalRoomId !== input.expected.externalRoomId
  ) {
    throw new Error("appRoomClaim does not match room");
  }

  if (new Date(payload.expiresAt).getTime() <= input.now.getTime()) {
    throw new Error("appRoomClaim expired");
  }

  if (
    input.expected.walletPubkey &&
    !payload.walletPubkeys?.includes(input.expected.walletPubkey)
  ) {
    throw new Error("appRoomClaim wallet mismatch");
  }

  if (!payload.nonce) {
    throw new Error("appRoomClaim nonce is required");
  }

  return payload;
}

function parseClaimPayload(encodedPayload: string): AppRoomClaimPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as AppRoomClaimPayload;
    if (
      !parsed.externalAppId ||
      !parsed.roomType ||
      !parsed.externalRoomId ||
      !parsed.expiresAt
    ) {
      throw new Error("missing required claim fields");
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Invalid appRoomClaim payload: ${(error as Error).message}`,
    );
  }
}

function decodePublicKey(value: string): Uint8Array {
  return Uint8Array.from(bs58.decode(value.trim()));
}

function defaultKnowledgeMode(roomType: string): string {
  if (roomType === "circle") {
    return "full";
  }
  if (roomType === "guild") {
    return "recap";
  }
  return "off";
}

function normalizeTranscriptionMode(raw: unknown): string {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase();
  if (normalized === "live_caption") return "live_caption";
  if (normalized === "transcript") return "transcript";
  if (normalized === "recap") return "recap";
  if (normalized === "full") return "full";
  return "off";
}

function resolveTranscriptionMode(input: {
  requested?: string | null;
  verifiedClaim: AppRoomClaimPayload | null;
}): string {
  const requested = normalizeTranscriptionMode(input.requested);
  if (requested === "off") return "off";
  const claimed = normalizeTranscriptionMode(
    input.verifiedClaim?.transcriptionMode,
  );
  return claimed === requested ? requested : "off";
}

function defaultRetentionPolicy(roomType: string): string {
  if (roomType === "guild" || roomType === "circle") {
    return "persistent";
  }
  return "ephemeral";
}
