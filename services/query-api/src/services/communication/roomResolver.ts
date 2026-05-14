import bs58 from "bs58";
import nacl from "tweetnacl";

import { normalizeVoiceSpeakerPolicy } from "../../config/voice";
import { withRoomCapabilitiesMetadata } from "./capabilities";
import { communicationError } from "./errors";
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
  voicePolicy?: {
    maxSpeakers?: number;
    overflowStrategy?: string;
    moderatorRoles?: string[];
  };
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
  trustedFirstPartyMetadata?: boolean;
  appRoomClaim?: AppRoomClaim | null;
  walletPubkey?: string | null;
}

export interface ResolveCommunicationRoomOptions {
  now?: Date;
}

export interface ExternalAppRecord {
  id: string;
  status: string;
  registryStatus?: string | null;
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
        ...(payload.voicePolicy
          ? {
              voicePolicy: normalizeClaimVoicePolicy(payload.voicePolicy),
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
  const metadata = buildRoomMetadata({
    inputMetadata: input.metadata,
    roomType,
    trustedFirstPartyMetadata: input.trustedFirstPartyMetadata === true,
    verifiedClaim,
    transcriptionMode,
  });
  const metadataUpdate = shouldPersistRoomMetadataUpdate({
    inputMetadata: input.metadata,
    trustedFirstPartyMetadata: input.trustedFirstPartyMetadata === true,
    verifiedClaim,
    transcriptionMode,
  })
    ? metadata
    : undefined;

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
      metadata,
    },
    update: {
      lifecycleStatus: "active",
      expiresAt,
      metadata: metadataUpdate,
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
    throw communicationError(
      400,
      "invalid_parent_circle_id",
      "parentCircleId must be a positive integer",
    );
  }

  const circle = await prisma.circle.findUnique({
    where: { id: parentCircleId },
    select: { id: true },
  });
  if (!circle) {
    throw communicationError(404, "parent_circle_not_found", "Parent circle not found");
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
        registryStatus: true,
        serverPublicKey: true,
        claimAuthMode: true,
      },
  });
  if (!externalApp) {
    throw communicationError(404, "external_app_not_found", "External app not found");
  }
  if (externalApp.status !== "active") {
    throw communicationError(403, "external_app_inactive", "External app is inactive");
  }
  if (externalApp.registryStatus && externalApp.registryStatus !== "active") {
    throw communicationError(403, "external_app_not_approved", "External app is not approved");
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
    throw communicationError(
      401,
      "app_room_claim_required",
      "External app serverPublicKey is required",
    );
  }
  if (!input.claim) {
    throw communicationError(401, "app_room_claim_required", "appRoomClaim is required");
  }

  const publicKey = decodePublicKey(input.externalApp.serverPublicKey);
  const signature = Buffer.from(input.claim.signature, "base64");
  const message = Buffer.from(input.claim.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw communicationError(403, "app_room_claim_invalid", "appRoomClaim signature invalid");
  }

  const payload = parseClaimPayload(input.claim.payload);
  if (
    payload.externalAppId !== input.expected.externalAppId ||
    normalizeRoomType(payload.roomType) !== input.expected.roomType ||
    payload.externalRoomId !== input.expected.externalRoomId
  ) {
    throw communicationError(403, "app_room_claim_mismatch", "appRoomClaim does not match room");
  }

  if (new Date(payload.expiresAt).getTime() <= input.now.getTime()) {
    throw communicationError(403, "app_room_claim_expired", "appRoomClaim expired");
  }

  if (
    input.expected.walletPubkey &&
    !payload.walletPubkeys?.includes(input.expected.walletPubkey)
  ) {
    throw communicationError(
      403,
      "app_room_claim_wallet_mismatch",
      "appRoomClaim wallet mismatch",
    );
  }

  if (!payload.nonce) {
    throw communicationError(403, "app_room_claim_invalid", "appRoomClaim nonce is required");
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
    throw communicationError(
      403,
      "app_room_claim_invalid",
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

function buildRoomMetadata(input: {
  inputMetadata?: Record<string, unknown> | null;
  roomType: string;
  trustedFirstPartyMetadata: boolean;
  verifiedClaim: AppRoomClaimPayload | null;
  transcriptionMode: string;
}): Record<string, unknown> | null {
  const metadata =
    input.inputMetadata &&
    typeof input.inputMetadata === "object" &&
    !Array.isArray(input.inputMetadata)
      ? { ...input.inputMetadata }
      : {};
  const trustedFirstPartyVoicePolicy =
    input.trustedFirstPartyMetadata &&
    input.roomType === "circle" &&
    !input.verifiedClaim &&
    metadata.voicePolicy;
  if (!trustedFirstPartyVoicePolicy) {
    delete metadata.voicePolicy;
  }

  if (input.verifiedClaim?.voicePolicy) {
    metadata.voicePolicy = normalizeClaimVoicePolicy(
      input.verifiedClaim.voicePolicy,
    );
  }

  const normalizedMetadata = withRoomCapabilitiesMetadata(
    metadata,
    input.roomType,
    { rejectUnknown: !input.trustedFirstPartyMetadata },
  );
  if (normalizeTranscriptionMode(input.transcriptionMode) !== "off") {
    normalizedMetadata.capabilities = {
      ...(normalizedMetadata.capabilities as Record<string, unknown>),
      transcriptRecap: true,
    };
  }
  return normalizedMetadata;
}

function shouldPersistRoomMetadataUpdate(input: {
  inputMetadata?: Record<string, unknown> | null;
  trustedFirstPartyMetadata: boolean;
  verifiedClaim: AppRoomClaimPayload | null;
  transcriptionMode: string;
}): boolean {
  const hasExplicitMetadata =
    input.inputMetadata &&
    typeof input.inputMetadata === "object" &&
    !Array.isArray(input.inputMetadata);
  return Boolean(
    hasExplicitMetadata ||
      input.trustedFirstPartyMetadata ||
      input.verifiedClaim?.voicePolicy ||
      normalizeTranscriptionMode(input.transcriptionMode) !== "off",
  );
}

function normalizeClaimVoicePolicy(raw: unknown) {
  return normalizeVoiceSpeakerPolicy(raw, {
    fallbackMaxSpeakers: 16,
    platformMaxSpeakers: 100,
    fallbackStrategy: "listen_only",
    source: "app_room_claim",
  });
}

function defaultRetentionPolicy(roomType: string): string {
  if (roomType === "guild" || roomType === "circle") {
    return "persistent";
  }
  return "ephemeral";
}
