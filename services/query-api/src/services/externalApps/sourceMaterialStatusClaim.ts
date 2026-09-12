import bs58 from "bs58";
import nacl from "tweetnacl";
import type { PrismaClient } from "@prisma/client";

import { normalizeSourceMaterialOriginType } from "../sourceMaterials/lifecycle";
import type { AppTrustRootNonceReplayStore } from "../appTrustRoot/nonceReplayStore";
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

export interface SourceMaterialStatusClaimEnvelope {
  payload: string;
  signature: string;
}

export interface ExternalProgramSourceMaterialStatusClaimPayload {
  claimContractVersion?: string | null;
  serverKeyVersion?: string | null;
  externalAppId: string;
  sourceMaterialId?: number | null;
  originType?: string | null;
  originRef?: string | null;
  purpose: "source_material_status";
  expiresAt: string;
  nonce: string;
}

interface SourceMaterialStatusClaimAppRecord {
  id: string;
  status: string | null;
  environment?: string | null;
  registryStatus: string | null;
  serverPublicKey?: string | null;
  claimAuthMode?: string | null;
  capabilityPolicies?: unknown;
}

type SourceMaterialStatusClaimPrisma = Pick<PrismaClient, "externalApp"> & {
  externalAppRegistryAnchor?: {
    findUnique(input: unknown): Promise<ExternalAppRegistryAnchorProjection | null>;
  };
  externalAppServerKey?: {
    findMany(input: unknown): Promise<any[]>;
  };
};

export async function verifyExternalProgramSourceMaterialStatusClaim(
  prisma: SourceMaterialStatusClaimPrisma,
  input: {
    externalAppId: string;
    sourceMaterialId?: number | null;
    originType?: string | null;
    originRef?: string | null;
    sourceMaterialStatusClaim?: SourceMaterialStatusClaimEnvelope | null;
    now?: Date;
    nonceReplayStore?: AppTrustRootNonceReplayStore | null;
  },
): Promise<ExternalProgramSourceMaterialStatusClaimPayload> {
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  const now = input.now ?? new Date();
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
  }) as SourceMaterialStatusClaimAppRecord | null;
  await assertExternalProgramRuntimeAppAllowed(prisma, {
    app,
    registryMode: externalAppRegistryModeFromEnv(),
    requestedCapabilities: ["sourceMaterialSubmission"],
  });
  if (!app) throw new Error("external_app_not_found");

  if (app.claimAuthMode === "wallet_only_dev") {
    assertWalletOnlyDevSandboxEnvironment(app.environment);
    return buildWalletOnlyDevStatusPayload({
      externalAppId,
      sourceMaterialId: input.sourceMaterialId ?? null,
      originType: input.originType ?? null,
      originRef: input.originRef ?? null,
      now,
    });
  }

  const claim = input.sourceMaterialStatusClaim;
  if (!claim?.payload || !claim.signature) {
    throw new Error("source_material_status_claim_required");
  }

  const payload = parseSourceMaterialStatusClaimPayload(claim.payload);
  const serverPublicKey = await resolveExternalProgramServerPublicKey(prisma, {
    app,
    serverKeyVersion: payload.serverKeyVersion,
    now,
  });
  if (
    !nacl.sign.detached.verify(
      Buffer.from(claim.payload),
      Buffer.from(claim.signature, "base64"),
      bs58.decode(serverPublicKey),
    )
  ) {
    throw new Error("source_material_status_claim_invalid");
  }
  assertSourceMaterialStatusClaimMatches(payload, {
    externalAppId,
    sourceMaterialId: input.sourceMaterialId ?? null,
    originType: input.originType ?? null,
    originRef: input.originRef ?? null,
    now,
  });
  await consumeExternalProgramClaimNonce({
    nonceReplayStore: input.nonceReplayStore,
    claimKind: "source_material_status_claim",
    externalAppId,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
    encodedPayload: claim.payload,
    now,
  });
  return payload;
}

function buildWalletOnlyDevStatusPayload(input: {
  externalAppId: string;
  sourceMaterialId: number | null;
  originType: string | null;
  originRef: string | null;
  now: Date;
}): ExternalProgramSourceMaterialStatusClaimPayload {
  if (input.sourceMaterialId !== null) {
    return {
      claimContractVersion: "wallet_only_dev",
      externalAppId: input.externalAppId,
      sourceMaterialId: input.sourceMaterialId,
      purpose: "source_material_status",
      expiresAt: new Date(input.now.getTime() + 60_000).toISOString(),
      nonce: "wallet_only_dev",
    };
  }
  let originType: string;
  try {
    originType = normalizeSourceMaterialOriginType(input.originType);
  } catch {
    throw new Error("source_material_status_claim_mismatch");
  }
  const originRef = String(input.originRef || "").trim();
  if (!originRef) {
    throw new Error("source_material_status_claim_mismatch");
  }
  return {
    claimContractVersion: "wallet_only_dev",
    externalAppId: input.externalAppId,
    originType,
    originRef,
    purpose: "source_material_status",
    expiresAt: new Date(input.now.getTime() + 60_000).toISOString(),
    nonce: "wallet_only_dev",
  };
}

function parseSourceMaterialStatusClaimPayload(
  encodedPayload: string,
): ExternalProgramSourceMaterialStatusClaimPayload {
  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as ExternalProgramSourceMaterialStatusClaimPayload;
    if (
      !parsed.externalAppId ||
      parsed.purpose !== "source_material_status" ||
      !parsed.expiresAt ||
      !parsed.nonce
    ) {
      throw new Error("source_material_status_claim_invalid");
    }
    return parsed;
  } catch {
    throw new Error("source_material_status_claim_invalid");
  }
}

function assertSourceMaterialStatusClaimMatches(
  payload: ExternalProgramSourceMaterialStatusClaimPayload,
  expected: {
    externalAppId: string;
    sourceMaterialId: number | null;
    originType: string | null;
    originRef: string | null;
    now: Date;
  },
): void {
  assertExternalProgramClaimContractVersion(
    payload,
    "source_material_status_claim_invalid",
  );
  if (payload.externalAppId !== expected.externalAppId) {
    throw new Error("source_material_status_claim_mismatch");
  }
  if (expected.sourceMaterialId !== null) {
    if (Number(payload.sourceMaterialId) !== expected.sourceMaterialId) {
      throw new Error("source_material_status_claim_mismatch");
    }
  } else {
    let payloadOriginType: string;
    try {
      payloadOriginType = normalizeSourceMaterialOriginType(payload.originType);
    } catch {
      throw new Error("source_material_status_claim_mismatch");
    }
    if (
      payloadOriginType !== expected.originType ||
      String(payload.originRef || "").trim() !== expected.originRef
    ) {
      throw new Error("source_material_status_claim_mismatch");
    }
  }
  if (new Date(payload.expiresAt).getTime() <= expected.now.getTime()) {
    throw new Error("source_material_status_claim_expired");
  }
}

function normalizeExternalAppId(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(normalized)) {
    throw new Error("invalid_external_app_id");
  }
  return normalized;
}
