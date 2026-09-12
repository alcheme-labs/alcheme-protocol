import { createHash } from "node:crypto";

import bs58 from "bs58";
import nacl from "tweetnacl";
import type { PrismaClient } from "@prisma/client";

import { assertExternalAppCanUseCircle } from "./circleBindings";
import { assertExternalProgramClaimContractVersion } from "./claimContract";
import {
  externalAppRegistryModeFromEnv,
  type ExternalAppRegistryAnchorProjection,
} from "./chainRegistryProjection";
import {
  assertExternalProgramRuntimeAppAllowed,
  consumeExternalProgramClaimNonce,
  resolveExternalProgramServerPublicKey,
} from "./runtimeAuthorizationGate";
import { assertWalletOnlyDevSandboxEnvironment } from "./walletOnlyDev";
import type { AppTrustRootNonceReplayStore } from "../appTrustRoot/nonceReplayStore";
import { isForkUpstreamReferenceAvailableToExternalApp } from "../sourceMaterials/forkContextAudience";
import { SOURCE_MATERIAL_GROUNDING_STATUSES } from "../sourceMaterials/lifecycle";

export interface KnowledgeContextClaimEnvelope {
  payload: string;
  signature: string;
}

export interface ExternalProgramKnowledgeContextClaimPayload {
  claimContractVersion?: string | null;
  serverKeyVersion?: string | null;
  externalAppId: string;
  roomKey: string;
  circleId: number;
  walletPubkey?: string | null;
  requestedCapability: "knowledge_context";
  purpose: string;
  expiresAt: string;
  nonce: string;
}

export interface ExternalProgramKnowledgeContextItem {
  kind: "source_material";
  id: string;
  title: string;
  summary: string | null;
  sourceId: number;
  updatedAt: string;
  permissions: {
    canDisplay: boolean;
    canQuote: boolean;
    canContinueDiscussion: boolean;
  };
}

interface ExternalAppKnowledgeContextRecord {
  id: string;
  status: string | null;
  environment?: string | null;
  registryStatus: string | null;
  serverPublicKey?: string | null;
  claimAuthMode?: string | null;
  capabilityPolicies?: unknown;
}

interface SourceMaterialKnowledgeContextRow {
  id: number;
  name: string;
  summaryText: string | null;
  contentDigest: string;
  lifecycleStatus: string;
  originType: string | null;
  provenance: unknown;
  updatedAt: Date;
}

type KnowledgeContextPrisma = Pick<
  PrismaClient,
  "externalApp" | "externalAppCircleBinding" | "sourceMaterial"
> & {
  externalAppRegistryAnchor?: {
    findUnique(input: unknown): Promise<ExternalAppRegistryAnchorProjection | null>;
  };
  externalAppServerKey?: {
    findMany(input: unknown): Promise<any[]>;
  };
};

export async function buildExternalProgramKnowledgeContextPackage(
  prisma: KnowledgeContextPrisma,
  input: {
    externalAppId: string;
    roomKey: string;
    walletPubkey?: string | null;
    primaryCircleId?: number | null;
    parentCircleId?: number | null;
    requestedCapability: string;
    purpose: string;
    knowledgeContextClaim?: KnowledgeContextClaimEnvelope | null;
    now?: Date;
    nonceReplayStore?: AppTrustRootNonceReplayStore | null;
  },
) {
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  const roomKey = normalizeRequiredString(input.roomKey, "knowledge_context_room_key_required", 96);
  const circleId = normalizePositiveCircleId(input.primaryCircleId ?? input.parentCircleId);
  const walletPubkey = normalizeOptionalString(input.walletPubkey, 44);
  const requestedCapability = normalizeRequestedCapability(input.requestedCapability);
  const purpose = normalizeRequiredString(input.purpose, "knowledge_context_purpose_required", 64);

  const app = await prisma.externalApp.findUnique({
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
  }) as ExternalAppKnowledgeContextRecord | null;
  await assertExternalProgramRuntimeAppAllowed(prisma, {
    app,
    registryMode: externalAppRegistryModeFromEnv(),
    requestedCapabilities: ["knowledgeContext"],
  });
  if (!app) throw new Error("external_app_not_found");

  const verifiedClaim = await verifyKnowledgeContextClaim({
    app,
    externalAppId,
    roomKey,
    circleId,
    walletPubkey,
    requestedCapability,
    purpose,
    knowledgeContextClaim: input.knowledgeContextClaim ?? null,
    now: input.now ?? new Date(),
    prisma,
    nonceReplayStore: input.nonceReplayStore,
  });

  await assertExternalAppCanUseCircle(prisma, {
    externalAppId,
    circleId,
  });

  const rows = await prisma.sourceMaterial.findMany({
    where: {
      circleId,
      lifecycleStatus: { in: SOURCE_MATERIAL_GROUNDING_STATUSES },
      evidencePrivacyClass: { notIn: ["reviewer_only", "sealed", "redacted"] },
      OR: [
        { draftPostId: null },
        {
          draftPostId: { not: null },
          externalAppId,
          roomKey,
          lifecycleStatus: { in: ["used_in_draft", "crystallized"] },
        },
      ],
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 20,
    select: {
      id: true,
      name: true,
      summaryText: true,
      contentDigest: true,
      lifecycleStatus: true,
      originType: true,
      provenance: true,
      updatedAt: true,
    },
  }) as SourceMaterialKnowledgeContextRow[];
  const visibleRows = rows.filter(canExposeSourceMaterialToExternalApp);
  const items = visibleRows.map(mapSourceMaterialContextItem);

  const cacheKey = buildKnowledgeContextCacheKey({
    externalAppId,
    circleId,
    roomKey,
    walletPubkey,
    requestedCapability,
    purpose,
  });

  return {
    ok: true,
    appId: externalAppId,
    roomKey,
    circleId,
    scope: {
      appId: externalAppId,
      circleId,
      roomKey,
      user: walletPubkey,
      appScoped: !walletPubkey,
      userScoped: Boolean(walletPubkey),
      capability: requestedCapability,
      purpose,
    },
    items,
    ...(items.length === 0
      ? { emptyReason: rows.length === 0
          ? "no_accepted_source_material"
          : "no_external_app_visible_source_material" }
      : {}),
    cache: {
      keyScope: "appId+circleId+roomKey+wallet+capability+purpose",
      keyDigest: cacheKey,
      ttlSec: 60,
    },
    disclaimer: {
      notEndorsement: true,
      operatorResponsible: true,
    },
    claim: {
      mode: verifiedClaim.mode,
      nonce: verifiedClaim.payload.nonce,
      expiresAt: verifiedClaim.payload.expiresAt,
    },
  };
}

async function verifyKnowledgeContextClaim(input: {
  prisma: KnowledgeContextPrisma;
  app: ExternalAppKnowledgeContextRecord;
  externalAppId: string;
  roomKey: string;
  circleId: number;
  walletPubkey: string | null;
  requestedCapability: "knowledge_context";
  purpose: string;
  knowledgeContextClaim: KnowledgeContextClaimEnvelope | null;
  now: Date;
  nonceReplayStore?: AppTrustRootNonceReplayStore | null;
}): Promise<{
  mode: "server_ed25519" | "wallet_only_dev";
  payload: ExternalProgramKnowledgeContextClaimPayload;
}> {
  if (input.app.claimAuthMode === "wallet_only_dev") {
    assertWalletOnlyDevSandboxEnvironment(input.app.environment);
    return {
      mode: "wallet_only_dev",
      payload: {
        externalAppId: input.externalAppId,
        roomKey: input.roomKey,
        circleId: input.circleId,
        walletPubkey: input.walletPubkey,
        requestedCapability: input.requestedCapability,
        purpose: input.purpose,
        expiresAt: new Date(input.now.getTime() + 60_000).toISOString(),
        nonce: "wallet_only_dev",
      },
    };
  }

  const claim = input.knowledgeContextClaim;
  if (!claim?.payload || !claim.signature) {
    throw new Error("knowledge_context_claim_required");
  }

  const payload = parseKnowledgeContextClaimPayload(claim.payload);
  const serverPublicKey = await resolveExternalProgramServerPublicKey(input.prisma, {
    app: input.app,
    serverKeyVersion: payload.serverKeyVersion,
    now: input.now,
  });
  const publicKey = bs58.decode(serverPublicKey);
  const signature = Buffer.from(claim.signature, "base64");
  const message = Buffer.from(claim.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("knowledge_context_claim_invalid");
  }
  assertKnowledgeContextClaimMatches(payload, {
    externalAppId: input.externalAppId,
    roomKey: input.roomKey,
    circleId: input.circleId,
    walletPubkey: input.walletPubkey,
    requestedCapability: input.requestedCapability,
    purpose: input.purpose,
    now: input.now,
    allowMissingClaimContractVersion: input.app.environment === "sandbox",
  });
  await consumeExternalProgramClaimNonce({
    nonceReplayStore: input.nonceReplayStore,
    claimKind: "knowledge_context_claim",
    externalAppId: payload.externalAppId,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
    encodedPayload: claim.payload,
    now: input.now,
  });

  return {
    mode: "server_ed25519",
    payload,
  };
}

function parseKnowledgeContextClaimPayload(
  encodedPayload: string,
): ExternalProgramKnowledgeContextClaimPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as ExternalProgramKnowledgeContextClaimPayload;
    if (
      !parsed.externalAppId ||
      !parsed.roomKey ||
      !parsed.circleId ||
      parsed.requestedCapability !== "knowledge_context" ||
      !parsed.purpose ||
      !parsed.expiresAt ||
      !parsed.nonce
    ) {
      throw new Error("missing required claim fields");
    }
    return parsed;
  } catch {
    throw new Error("knowledge_context_claim_invalid");
  }
}

function assertKnowledgeContextClaimMatches(
  payload: ExternalProgramKnowledgeContextClaimPayload,
  expected: {
    externalAppId: string;
    roomKey: string;
    circleId: number;
    walletPubkey: string | null;
    requestedCapability: "knowledge_context";
    purpose: string;
    now: Date;
    allowMissingClaimContractVersion?: boolean;
  },
): void {
  assertExternalProgramClaimContractVersion(
    payload,
    "knowledge_context_claim_invalid",
    { allowMissingVersion: expected.allowMissingClaimContractVersion === true },
  );
  if (
    payload.externalAppId !== expected.externalAppId ||
    payload.roomKey !== expected.roomKey ||
    Number(payload.circleId) !== expected.circleId ||
    payload.requestedCapability !== expected.requestedCapability ||
    payload.purpose !== expected.purpose
  ) {
    throw new Error("knowledge_context_claim_mismatch");
  }
  if (
    expected.walletPubkey &&
    payload.walletPubkey &&
    payload.walletPubkey !== expected.walletPubkey
  ) {
    throw new Error("knowledge_context_claim_wallet_mismatch");
  }
  if (new Date(payload.expiresAt).getTime() <= expected.now.getTime()) {
    throw new Error("knowledge_context_claim_expired");
  }
}

function mapSourceMaterialContextItem(row: SourceMaterialKnowledgeContextRow): ExternalProgramKnowledgeContextItem {
  return {
    kind: "source_material",
    id: `source-material:${row.id}`,
    title: row.name,
    summary: row.summaryText || `Source material ${row.contentDigest.slice(0, 12)}`,
    sourceId: row.id,
    updatedAt: row.updatedAt.toISOString(),
    permissions: {
      canDisplay: true,
      canQuote: row.lifecycleStatus === "accepted_to_plaza" || row.lifecycleStatus === "crystallized",
      canContinueDiscussion: true,
    },
  };
}

function canExposeSourceMaterialToExternalApp(row: SourceMaterialKnowledgeContextRow): boolean {
  return isForkUpstreamReferenceAvailableToExternalApp(row);
}

function isKnowledgeContextCapabilityAllowed(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const policy = value as Record<string, unknown>;
  if (policy.knowledgeContext === false) return false;
  if (policy.knowledge_context === false) return false;
  const nested = policy.knowledgeContext || policy.knowledge_context;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const mode = String((nested as Record<string, unknown>).mode || "").trim().toLowerCase();
    if (mode === "off" || mode === "disabled") return false;
  }
  return true;
}

function buildKnowledgeContextCacheKey(input: {
  externalAppId: string;
  circleId: number;
  roomKey: string;
  walletPubkey: string | null;
  requestedCapability: string;
  purpose: string;
}): string {
  return createHash("sha256")
    .update(stableJson(input))
    .digest("hex");
}

function normalizeRequestedCapability(value: unknown): "knowledge_context" {
  if (String(value || "").trim().toLowerCase() !== "knowledge_context") {
    throw new Error("invalid_knowledge_context_capability");
  }
  return "knowledge_context";
}

function normalizeExternalAppId(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(normalized)) {
    throw new Error("invalid_external_app_id");
  }
  return normalized;
}

function normalizePositiveCircleId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("knowledge_context_circle_id_required");
  }
  return parsed;
}

function normalizeRequiredString(value: unknown, errorCode: string, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized.slice(0, maxLength);
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
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
