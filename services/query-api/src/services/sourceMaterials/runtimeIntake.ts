import { createHash } from "node:crypto";

import bs58 from "bs58";
import nacl from "tweetnacl";
import type { PrismaClient } from "@prisma/client";

import { assertExternalAppCanUseCircle } from "../externalApps/circleBindings";
import { createSourceMaterial } from "./ingest";
import {
  normalizeSourceMaterialLifecycleStatus,
  normalizeSourceMaterialOriginType,
  normalizeSourceMaterialPrivacyClass,
  type SourceMaterialLifecycleStatus,
  type SourceMaterialOriginType,
  type SourceMaterialPrivacyClass,
} from "./lifecycle";
import { assertExternalProgramClaimContractVersion } from "../externalApps/claimContract";
import {
  externalAppRegistryModeFromEnv,
  type ExternalAppRegistryAnchorProjection,
} from "../externalApps/chainRegistryProjection";
import {
  assertExternalProgramRuntimeAppAllowed,
  consumeExternalProgramClaimNonce,
  resolveExternalProgramServerPublicKey,
} from "../externalApps/runtimeAuthorizationGate";
import type { AppTrustRootNonceReplayStore } from "../appTrustRoot/nonceReplayStore";
import { assertWalletOnlyDevSandboxEnvironment } from "../externalApps/walletOnlyDev";
import {
  assertAuthorizedContributionGrant,
  assertCommunicationMessageCoveredByGrant,
} from "../communication/contributionGrant";
import { computeCommunicationPayloadHash } from "../communication/payloadHash";

export interface SourceSubmissionClaimEnvelope {
  payload: string;
  signature: string;
}

export interface ExternalProgramSourceSubmissionClaimPayload {
  claimContractVersion?: string | null;
  serverKeyVersion?: string | null;
  externalAppId: string;
  roomKey: string;
  originType: "communication_message" | "voice_recap" | "external_summary";
  originRef: string;
  targetCircleId: number;
  summaryDigest: string;
  evidencePrivacyClass: SourceMaterialPrivacyClass;
  requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending";
  submittedByPubkey?: string | null;
  expiresAt: string;
  nonce: string;
}

interface ExternalAppClaimRecord {
  id: string;
  status: string | null;
  serverPublicKey?: string | null;
  claimAuthMode?: string | null;
  environment?: string | null;
  registryStatus: string | null;
  capabilityPolicies?: unknown;
}

interface SourceSubmissionClaimPrisma {
  externalApp: {
    findUnique(input: unknown): Promise<ExternalAppClaimRecord | null>;
  };
  externalAppRegistryAnchor?: {
    findUnique(input: unknown): Promise<ExternalAppRegistryAnchorProjection | null>;
  };
  externalAppServerKey?: {
    findMany(input: unknown): Promise<any[]>;
  };
}

interface RuntimeIntakePrisma
  extends Pick<
    PrismaClient,
    | "externalApp"
    | "externalAppCircleBinding"
    | "sourceMaterial"
    | "sourceMaterialChunk"
    | "communicationRoom"
    | "communicationSession"
    | "communicationRoomMember"
  > {
  communicationMessage?: {
    findUnique(input: unknown): Promise<{
      envelopeId: string;
      roomKey: string;
      senderPubkey: string;
      senderHandle?: string | null;
      messageKind: string;
      payloadText?: string | null;
      payloadHash: string;
      metadata?: unknown;
      storageUri?: string | null;
      durationMs?: number | null;
      sessionId?: string | null;
      createdAt: Date;
      expiresAt?: Date | null;
      deleted: boolean;
      hidden: boolean;
    } | null>;
  };
  $transaction: PrismaClient["$transaction"];
}

export async function verifyExternalProgramSourceSubmissionClaim(
  prisma: SourceSubmissionClaimPrisma,
  input: {
    externalAppId: string;
    roomKey: string;
    originType: SourceMaterialOriginType;
    originRef: string;
    targetCircleId: number;
    summaryText: string;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    requestedLifecycleStatus?: SourceMaterialLifecycleStatus | null;
    submittedByPubkey?: string | null;
    sourceSubmissionClaim?: SourceSubmissionClaimEnvelope | null;
    now?: Date;
    nonceReplayStore?: AppTrustRootNonceReplayStore | null;
  },
): Promise<{
  payload: ExternalProgramSourceSubmissionClaimPayload;
  claimDigest: string;
  mode: "server_ed25519" | "wallet_only_dev";
}> {
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  const now = input.now ?? new Date();
  const app = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: {
      id: true,
      status: true,
      serverPublicKey: true,
      claimAuthMode: true,
      environment: true,
      registryStatus: true,
      capabilityPolicies: true,
    },
  }) as ExternalAppClaimRecord | null;
  await assertExternalProgramRuntimeAppAllowed(prisma, {
    app,
    registryMode: externalAppRegistryModeFromEnv(),
    requestedCapabilities: ["sourceMaterialSubmission"],
  });
  if (!app) throw new Error("external_app_not_found");

  if (app.claimAuthMode === "wallet_only_dev") {
    assertWalletOnlyDevSandboxEnvironment(app.environment);
    const payload = buildWalletOnlyDevPayload(input, externalAppId);
    return {
      payload,
      claimDigest: sha256Hex(stableJson(payload)),
      mode: "wallet_only_dev",
    };
  }

  const claim = input.sourceSubmissionClaim;
  if (!claim?.payload || !claim.signature) {
    throw new Error("source_submission_claim_required");
  }
  const payload = parseSourceSubmissionClaimPayload(claim.payload);
  const serverPublicKey = await resolveExternalProgramServerPublicKey(prisma, {
    app,
    serverKeyVersion: payload.serverKeyVersion,
    now,
  });
  const publicKey = bs58.decode(serverPublicKey);
  const signature = Buffer.from(claim.signature, "base64");
  const message = Buffer.from(claim.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("source_submission_claim_invalid");
  }
  assertSourceSubmissionClaimMatches(payload, {
    externalAppId,
    roomKey: input.roomKey,
    originType: input.originType,
    originRef: input.originRef,
    targetCircleId: input.targetCircleId,
    summaryText: input.summaryText,
    evidencePrivacyClass: input.evidencePrivacyClass,
    requestedLifecycleStatus: input.requestedLifecycleStatus ?? null,
    submittedByPubkey: input.submittedByPubkey ?? null,
    now,
    allowMissingClaimContractVersion: app.environment === "sandbox",
  });
  await consumeExternalProgramClaimNonce({
    nonceReplayStore: input.nonceReplayStore,
    claimKind: "source_submission_claim",
    externalAppId,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
    encodedPayload: claim.payload,
    now,
  });

  return {
    payload,
    claimDigest: sha256Hex(claim.payload),
    mode: "server_ed25519",
  };
}

export async function submitCommunicationMessageAsSourceMaterial(
  prisma: RuntimeIntakePrisma,
  input: {
    externalAppId: string;
    roomKey: string;
    envelopeId: string;
    targetCircleId: number;
    submittedByUserId?: number | null;
    submittedByPubkey?: string | null;
    summaryText: string;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending";
    claimDigest?: string | null;
  },
) {
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  const message = await prisma.communicationMessage?.findUnique({
    where: { envelopeId: input.envelopeId },
    select: {
      envelopeId: true,
      roomKey: true,
      senderPubkey: true,
      senderHandle: true,
      messageKind: true,
      payloadText: true,
      payloadHash: true,
      metadata: true,
      storageUri: true,
      durationMs: true,
      sessionId: true,
      createdAt: true,
      expiresAt: true,
      deleted: true,
      hidden: true,
    },
  });
  if (!message) throw new Error("communication_message_not_found");
  if (message.roomKey !== input.roomKey) {
    throw new Error("source_material_origin_room_mismatch");
  }
  if (
    message.messageKind !== "plain"
    || !message.payloadText?.trim()
    || message.deleted
    || message.hidden
    || (message.expiresAt && message.expiresAt.getTime() <= Date.now())
  ) {
    throw new Error("communication_message_unavailable");
  }
  const canonicalPayloadHash = computeCommunicationPayloadHash({
    roomKey: message.roomKey,
    senderPubkey: message.senderPubkey,
    messageKind: message.messageKind,
    text: message.payloadText,
    metadata: message.metadata,
    storageUri: message.storageUri,
    durationMs: message.durationMs,
  });
  if (canonicalPayloadHash !== message.payloadHash) {
    throw new Error("communication_message_payload_hash_mismatch");
  }
  if (!message.sessionId) {
    throw new Error("communication_message_contribution_not_authorized");
  }
  const session = await prisma.communicationSession.findUnique({
    where: { sessionId: message.sessionId },
  });
  if (!session) {
    throw new Error("communication_message_session_not_found");
  }
  const grant = assertCommunicationMessageCoveredByGrant({
    session,
    message,
    externalAppId,
    circleId: input.targetCircleId,
  });
  await assertAuthorizedContributionGrant(prisma, grant.payload);

  const submittedByPubkey = String(input.submittedByPubkey || "").trim();
  if (!submittedByPubkey) {
    throw new Error("source_material_submitter_required");
  }
  const nominator = await prisma.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: input.roomKey,
        walletPubkey: submittedByPubkey,
      },
    },
  });
  if (
    !nominator
    || nominator.banned
    || nominator.joinedAt.getTime() > message.createdAt.getTime()
    || (nominator.leftAt && nominator.leftAt.getTime() < message.createdAt.getTime())
  ) {
    throw new Error("source_material_submitter_not_room_member");
  }

  const canonicalText = message.payloadText.trim();
  const canonicalSummary = deterministicExcerpt(canonicalText);
  try {
    return await createSourceMaterial(prisma as PrismaClient, {
    circleId: input.targetCircleId,
    uploadedByUserId: input.submittedByUserId ?? null,
    name: `runtime-message-${input.envelopeId}.txt`,
    mimeType: "text/plain",
    content: canonicalText,
    originType: "communication_message",
    originRef: input.envelopeId,
    externalAppId,
    roomKey: input.roomKey,
    lifecycleStatus: input.requestedLifecycleStatus ?? "submitted",
    summaryText: canonicalSummary,
    evidencePrivacyClass: input.evidencePrivacyClass,
    submittedByPubkey,
    actor: {
      kind: "external_app_server",
      externalAppId,
      submittedByPubkey,
      claimDigest: input.claimDigest ?? sha256Hex(input.summaryText),
    },
    provenance: {
      originMessageSenderPubkey: message.senderPubkey,
      originMessageSenderHandle: message.senderHandle ?? null,
      originMessagePayloadHash: message.payloadHash,
      originMessageSessionId: message.sessionId,
      contributionGrantDigest: grant.digest,
      nominatedByPubkey: submittedByPubkey,
      nominatedSummaryDigest: sha256Hex(input.summaryText),
    },
    });
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "P2002") throw error;
    const existing = await prisma.sourceMaterial.findFirst({
      where: {
        externalAppId,
        circleId: input.targetCircleId,
        originType: "communication_message",
        originRef: input.envelopeId,
      },
    });
    if (!existing) throw error;
    return existing as any;
  }
}

export async function submitVoiceRecapAsSourceMaterial(
  prisma: RuntimeIntakePrisma,
  input: {
    externalAppId?: string | null;
    voiceSessionId: string;
    roomKey: string;
    targetCircleId: number;
    submittedByUserId?: number | null;
    submittedByPubkey?: string | null;
    summaryText: string;
    transcriptText?: string | null;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    claimDigest?: string | null;
  },
) {
  if (input.externalAppId) {
    await assertExternalAppCanUseCircle(prisma, {
      externalAppId: normalizeExternalAppId(input.externalAppId),
      circleId: input.targetCircleId,
    });
  }
  return createSourceMaterial(prisma as PrismaClient, {
    circleId: input.targetCircleId,
    uploadedByUserId: input.submittedByUserId ?? null,
    name: `voice-recap-${input.voiceSessionId}.txt`,
    mimeType: "text/plain",
    content: input.summaryText,
    originType: "voice_recap",
    originRef: input.voiceSessionId,
    externalAppId: input.externalAppId ?? null,
    roomKey: input.roomKey,
    lifecycleStatus: "review_pending",
    summaryText: input.summaryText,
    evidencePrivacyClass: input.evidencePrivacyClass,
    submittedByPubkey: input.submittedByPubkey ?? null,
    actor: input.externalAppId
      ? {
          kind: "external_app_server",
          externalAppId: normalizeExternalAppId(input.externalAppId),
          submittedByPubkey: input.submittedByPubkey ?? null,
          claimDigest: input.claimDigest ?? sha256Hex(input.summaryText),
        }
      : undefined,
    provenance: {
      transcriptDigest: input.transcriptText ? sha256Hex(input.transcriptText) : null,
    },
  });
}

export async function submitExternalSummaryAsSourceMaterial(
  prisma: RuntimeIntakePrisma,
  input: {
    externalAppId: string;
    roomKey: string;
    originRef: string;
    targetCircleId: number;
    submittedByUserId?: number | null;
    submittedByPubkey?: string | null;
    summaryText: string;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending";
    claimDigest?: string | null;
  },
) {
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  await assertExternalAppCanUseCircle(prisma, {
    externalAppId,
    circleId: input.targetCircleId,
  });
  return createSourceMaterial(prisma as PrismaClient, {
    circleId: input.targetCircleId,
    uploadedByUserId: input.submittedByUserId ?? null,
    name: `external-summary-${input.originRef}.txt`,
    mimeType: "text/plain",
    content: input.summaryText,
    originType: "external_summary",
    originRef: input.originRef,
    externalAppId,
    roomKey: input.roomKey,
    lifecycleStatus: input.requestedLifecycleStatus ?? "submitted",
    summaryText: input.summaryText,
    evidencePrivacyClass: input.evidencePrivacyClass,
    submittedByPubkey: input.submittedByPubkey ?? null,
    actor: {
      kind: "external_app_server",
      externalAppId,
      submittedByPubkey: input.submittedByPubkey ?? null,
      claimDigest: input.claimDigest ?? sha256Hex(input.summaryText),
    },
  });
}

function parseSourceSubmissionClaimPayload(
  encodedPayload: string,
): ExternalProgramSourceSubmissionClaimPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as ExternalProgramSourceSubmissionClaimPayload;
    if (
      !parsed.externalAppId ||
      !parsed.roomKey ||
      !parsed.originType ||
      !parsed.originRef ||
      !parsed.targetCircleId ||
      !parsed.summaryDigest ||
      !parsed.evidencePrivacyClass ||
      !parsed.expiresAt ||
      !parsed.nonce
    ) {
      throw new Error("missing required claim fields");
    }
    return parsed;
  } catch {
    throw new Error("source_submission_claim_invalid");
  }
}

function assertSourceSubmissionClaimMatches(
  payload: ExternalProgramSourceSubmissionClaimPayload,
  expected: {
    externalAppId: string;
    roomKey: string;
    originType: SourceMaterialOriginType;
    originRef: string;
    targetCircleId: number;
    summaryText: string;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    requestedLifecycleStatus?: SourceMaterialLifecycleStatus | null;
    submittedByPubkey?: string | null;
    now: Date;
    allowMissingClaimContractVersion?: boolean;
  },
): void {
  assertExternalProgramClaimContractVersion(
    payload,
    "source_submission_claim_invalid",
    { allowMissingVersion: expected.allowMissingClaimContractVersion === true },
  );
  if (
    payload.externalAppId !== expected.externalAppId ||
    payload.roomKey !== expected.roomKey ||
    normalizeSourceMaterialOriginType(payload.originType) !== expected.originType ||
    payload.originRef !== expected.originRef ||
    Number(payload.targetCircleId) !== expected.targetCircleId
  ) {
    throw new Error("source_submission_claim_mismatch");
  }
  const summaryDigest = normalizeDigest(payload.summaryDigest);
  if (summaryDigest !== sha256Hex(expected.summaryText)) {
    throw new Error("source_submission_claim_summary_mismatch");
  }
  if (
    normalizeSourceMaterialPrivacyClass(payload.evidencePrivacyClass) !==
    expected.evidencePrivacyClass
  ) {
    throw new Error("source_submission_claim_privacy_mismatch");
  }
  if (
    payload.requestedLifecycleStatus &&
    normalizeSourceMaterialLifecycleStatus(payload.requestedLifecycleStatus) !==
      expected.requestedLifecycleStatus
  ) {
    throw new Error("source_submission_claim_lifecycle_mismatch");
  }
  if (
    expected.submittedByPubkey &&
    payload.submittedByPubkey !== expected.submittedByPubkey
  ) {
    throw new Error("source_submission_claim_submitter_mismatch");
  }
  if (new Date(payload.expiresAt).getTime() <= expected.now.getTime()) {
    throw new Error("source_submission_claim_expired");
  }
}

function buildWalletOnlyDevPayload(
  input: {
    roomKey: string;
    originType: SourceMaterialOriginType;
    originRef: string;
    targetCircleId: number;
    summaryText: string;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    requestedLifecycleStatus?: SourceMaterialLifecycleStatus | null;
    submittedByPubkey?: string | null;
    now?: Date;
  },
  externalAppId: string,
): ExternalProgramSourceSubmissionClaimPayload {
  const now = input.now ?? new Date();
  return {
    externalAppId,
    roomKey: input.roomKey,
    originType: input.originType as "communication_message" | "voice_recap" | "external_summary",
    originRef: input.originRef,
    targetCircleId: input.targetCircleId,
    summaryDigest: sha256Hex(input.summaryText),
    evidencePrivacyClass: input.evidencePrivacyClass,
    requestedLifecycleStatus: (input.requestedLifecycleStatus ?? undefined) as
      | "nominated"
      | "submitted"
      | "review_pending"
      | undefined,
    submittedByPubkey: input.submittedByPubkey ?? null,
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    nonce: "wallet_only_dev",
  };
}

function normalizeExternalAppId(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(normalized)) {
    throw new Error("invalid_external_app_id");
  }
  return normalized;
}

function normalizeDigest(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error("source_submission_claim_summary_mismatch");
  }
  return normalized;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 499)}…`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
