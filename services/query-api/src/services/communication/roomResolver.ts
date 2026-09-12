import bs58 from "bs58";
import nacl from "tweetnacl";

import { normalizeVoiceSpeakerPolicy } from "../../config/voice";
import {
  externalAppRegistryModeFromEnv,
  type ExternalAppRegistryAnchorProjection,
} from "../externalApps/chainRegistryProjection";
import type { ExternalAppRegistryMode } from "../externalApps/chainRegistryAdapter";
import { assertExternalAppCanUseCircle } from "../externalApps/circleBindings";
import {
  assertExternalProgramClaimContractVersion,
  EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
} from "../externalApps/claimContract";
import {
  assertExternalProgramCapabilitiesAllowed,
  assertExternalProgramRuntimeAppAllowed,
  consumeExternalProgramClaimNonce,
  resolveExternalProgramServerPublicKey,
  type ExternalProgramRuntimeCapability,
} from "../externalApps/runtimeAuthorizationGate";
import type { AppTrustRootNonceReplayStore } from "../appTrustRoot/nonceReplayStore";
import { withRoomCapabilitiesMetadata } from "./capabilities";
import { communicationError } from "./errors";
import { buildCommunicationRoomKey, normalizeRoomType } from "./roomScope";
import { WALLET_ONLY_DEV_SANDBOX_ERROR, isWalletOnlyDevSandboxEnvironment } from "../externalApps/walletOnlyDev";

export interface AppRoomClaim {
  payload: string;
  signature: string;
}

export interface AppRoomClaimPayload {
  claimContractVersion?: string | null;
  serverKeyVersion?: string | null;
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
  externalAppRegistryMode?: ExternalAppRegistryMode;
  nonceReplayStore?: AppTrustRootNonceReplayStore | null;
}

export interface ExternalAppRecord {
  id: string;
  status: string | null;
  environment?: string | null;
  registryStatus: string | null;
  serverPublicKey?: string | null;
  claimAuthMode?: string | null;
  capabilityPolicies?: unknown;
}

interface CommunicationRoomPrisma {
  circle: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  externalApp: {
    findUnique(input: unknown): Promise<ExternalAppRecord | null>;
  };
  externalAppRegistryAnchor?: {
    findUnique(input: unknown): Promise<ExternalAppRegistryAnchorProjection | null>;
  };
  externalAppCircleBinding?: {
    findFirst(input: unknown): Promise<unknown | null>;
  };
  externalAppServerKey?: {
    findMany(input: unknown): Promise<any[]>;
  };
  communicationRoom: {
    upsert(input: unknown): Promise<any>;
  };
}

interface AppRoomClaimPrisma {
  externalAppServerKey?: {
    findMany(input: unknown): Promise<any[]>;
  };
}

export function createAppRoomClaim(payload: AppRoomClaimPayload): {
  payload: string;
} {
  return {
    payload: Buffer.from(
      JSON.stringify({
        externalAppId: payload.externalAppId,
        claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
        ...(payload.serverKeyVersion
          ? { serverKeyVersion: payload.serverKeyVersion }
          : {}),
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

  const knowledgeMode = input.knowledgeMode ?? defaultKnowledgeMode(roomType);
  const rawCapabilityRequest = readRawCapabilityRequest(input.metadata);

  const externalApp = input.externalAppId
    ? await loadActiveExternalApp(prisma, input.externalAppId, {
        mode: options.externalAppRegistryMode ?? externalAppRegistryModeFromEnv(),
        requestedCapabilities: collectRequestedCapabilities({
          knowledgeMode,
          transcriptionMode: input.transcriptionMode,
          rawCapabilityRequest,
        }),
      })
    : null;

  const verifiedClaim = externalApp
    ? await verifyAppRoomClaim({
        prisma,
        externalApp,
        claim: input.appRoomClaim,
        expected: {
          externalAppId: externalApp.id,
          roomType,
          externalRoomId: input.externalRoomId ?? "",
          walletPubkey: input.walletPubkey ?? null,
        },
        now,
        nonceReplayStore: options.nonceReplayStore,
      })
    : null;

  if (externalApp && verifiedClaim?.voicePolicy) {
    try {
      assertExternalProgramCapabilitiesAllowed(externalApp.capabilityPolicies, {
        requestedCapabilities: ["voice"],
      });
    } catch (error) {
      throw mapRuntimeAuthorizationError(error);
    }
  }

  const roomKey = buildRoomKeyForInput(input, roomType);
  const expiresAt =
    input.ttlSec && input.ttlSec > 0
      ? new Date(now.getTime() + input.ttlSec * 1000)
      : null;
  const requiresCircleBinding = Boolean(
    externalApp &&
      roomType !== "circle" &&
      (
        knowledgeMode !== "off" ||
        rawCapabilityRequest.sourceMaterialSubmission ||
        rawCapabilityRequest.knowledgeContext
      ),
  );
  if (requiresCircleBinding) {
    if (!input.parentCircleId) {
      throw communicationError(
        400,
        "external_room_parent_circle_required",
        "parentCircleId is required when external rooms use knowledge continuity capabilities",
      );
    }
    try {
      await assertExternalAppCanUseCircle(prisma as any, {
        externalAppId: externalApp!.id,
        circleId: input.parentCircleId,
      });
    } catch (error) {
      const code = error instanceof Error
        ? error.message
        : "external_app_circle_binding_required";
      throw communicationError(403, code, code);
    }
  }
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
    knowledgeMode,
    circleBindingVerified: requiresCircleBinding,
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
  options: {
    mode: ExternalAppRegistryMode;
    requestedCapabilities?: ExternalProgramRuntimeCapability[];
  },
): Promise<ExternalAppRecord> {
  const externalApp = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: {
      id: true,
      status: true,
      environment: true,
      registryStatus: true,
      serverPublicKey: true,
      claimAuthMode: true,
      capabilityPolicies: true,
    },
  });
  try {
    return (await assertExternalProgramRuntimeAppAllowed(prisma, {
      app: externalApp,
      registryMode: options.mode,
      requestedCapabilities: options.requestedCapabilities,
    })) as ExternalAppRecord;
  } catch (error) {
    throw mapRuntimeAuthorizationError(error);
  }
}

export async function verifyAppRoomClaim(input: {
  prisma: AppRoomClaimPrisma;
  externalApp: ExternalAppRecord;
  claim?: AppRoomClaim | null;
  expected: {
    externalAppId: string;
    roomType: string;
    externalRoomId: string;
    walletPubkey: string | null;
  };
  now: Date;
  nonceReplayStore?: AppTrustRootNonceReplayStore | null;
}): Promise<AppRoomClaimPayload> {
  if (input.externalApp.claimAuthMode === "wallet_only_dev") {
    if (!isWalletOnlyDevSandboxEnvironment(input.externalApp.environment)) {
      throw communicationError(
        403,
        WALLET_ONLY_DEV_SANDBOX_ERROR,
        "wallet_only_dev claims are allowed only for sandbox external apps",
      );
    }
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

  if (!input.claim) {
    throw communicationError(401, "app_room_claim_required", "appRoomClaim is required");
  }

  const payload = parseClaimPayload(input.claim.payload);
  try {
    assertExternalProgramClaimContractVersion(
      payload,
      "app_room_claim_invalid",
      { allowMissingVersion: input.externalApp.environment === "sandbox" },
    );
  } catch {
    throw communicationError(
      403,
      "app_room_claim_invalid",
      "appRoomClaim contract version invalid",
    );
  }
  const serverPublicKey = await resolveExternalProgramServerPublicKey(input.prisma, {
    app: input.externalApp,
    serverKeyVersion: payload.serverKeyVersion,
    now: input.now,
  }).catch((error) => {
    throw mapRuntimeAuthorizationError(error);
  });
  const publicKey = decodePublicKey(serverPublicKey);
  const signature = Buffer.from(input.claim.signature, "base64");
  const message = Buffer.from(input.claim.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw communicationError(403, "app_room_claim_invalid", "appRoomClaim signature invalid");
  }
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

  await consumeExternalProgramClaimNonce({
    nonceReplayStore: input.nonceReplayStore,
    claimKind: "app_room_claim",
    externalAppId: payload.externalAppId,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
    encodedPayload: input.claim.payload,
    now: input.now,
  }).catch((error) => {
    throw mapRuntimeAuthorizationError(error);
  });

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
  } catch {
    throw communicationError(
      403,
      "app_room_claim_invalid",
      "appRoomClaim payload invalid",
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
  knowledgeMode: string;
  circleBindingVerified: boolean;
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
  if (input.roomType !== "circle") {
    const capabilityRequest = readRawCapabilityRequest(input.inputMetadata);
    normalizedMetadata.capabilities = {
      ...(normalizedMetadata.capabilities as Record<string, unknown>),
      plazaDiscussion: false,
      aiSummary: false,
      draftGeneration: false,
      crystallization: false,
      governance: false,
      knowledgeContext: input.circleBindingVerified && input.knowledgeMode !== "off",
      sourceMaterialSubmission:
        input.circleBindingVerified && capabilityRequest.sourceMaterialSubmission,
    };
  }
  return normalizedMetadata;
}

function readRawCapabilityRequest(metadata: unknown): {
  sourceMaterialSubmission: boolean;
  knowledgeContext: boolean;
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {
      sourceMaterialSubmission: false,
      knowledgeContext: false,
    };
  }
  const capabilities = (metadata as Record<string, unknown>).capabilities;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return {
      sourceMaterialSubmission: false,
      knowledgeContext: false,
    };
  }
  return {
    sourceMaterialSubmission:
      (capabilities as Record<string, unknown>).sourceMaterialSubmission === true,
    knowledgeContext:
      (capabilities as Record<string, unknown>).knowledgeContext === true,
  };
}

function collectRequestedCapabilities(input: {
  knowledgeMode: string;
  transcriptionMode?: string | null;
  rawCapabilityRequest: {
    sourceMaterialSubmission: boolean;
    knowledgeContext: boolean;
  };
}): ExternalProgramRuntimeCapability[] {
  const capabilities: ExternalProgramRuntimeCapability[] = [];
  if (normalizeTranscriptionMode(input.transcriptionMode) !== "off") {
    capabilities.push("transcriptRecap");
  }
  if (input.knowledgeMode !== "off" || input.rawCapabilityRequest.knowledgeContext) {
    capabilities.push("knowledgeContext");
  }
  if (input.rawCapabilityRequest.sourceMaterialSubmission) {
    capabilities.push("sourceMaterialSubmission");
  }
  return Array.from(new Set(capabilities));
}

function mapRuntimeAuthorizationError(error: unknown): Error {
  const typed = error as { code?: string; statusCode?: number; message?: string };
  const code = typed?.code || typed?.message || "external_app_runtime_authorization_failed";
  const statusCode = typed?.statusCode && typed.statusCode >= 400 && typed.statusCode < 600
    ? typed.statusCode
    : 403;
  const message = runtimeAuthorizationMessage(code);
  return communicationError(statusCode, code, message);
}

function runtimeAuthorizationMessage(code: string): string {
  switch (code) {
    case "external_app_not_found":
      return "External app not found";
    case "external_app_not_active":
    case "external_app_inactive":
      return "External app is inactive";
    case "external_app_not_approved":
      return "External app is not approved";
    case "external_app_registry_anchor_required":
      return "External app registry anchor is not confirmed";
    case "external_app_capability_disabled":
      return "External app capability is disabled";
    case "external_app_server_key_lifecycle_required":
      return "External app server key lifecycle is required";
    case "nonce_replayed":
      return "External app claim nonce was already used";
    case "nonce_expired":
      return "External app claim nonce is expired";
    case "nonce_ttl_exceeded":
      return "External app claim expiry exceeds maximum TTL";
    case "key_revoked":
    case "key_expired":
    case "key_unknown":
      return "External app server key is not allowed";
    default:
      return code;
  }
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
