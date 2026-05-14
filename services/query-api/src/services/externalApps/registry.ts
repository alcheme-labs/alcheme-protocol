import { Prisma, type ExternalApp, type PrismaClient } from "@prisma/client";

import {
  normalizeAllowedOrigins,
  normalizeExternalAppEnvironment,
  normalizeExternalAppId,
} from "./validation";

export interface RegisterExternalAppInput {
  id: string;
  name: string;
  ownerPubkey: string;
  allowedOrigins: string[];
  serverPublicKey?: string | null;
  claimAuthMode: "server_ed25519" | "wallet_only_dev";
  status?: "active" | "inactive";
  config?: Record<string, unknown>;
}

export async function registerExternalApp(
  prisma: Pick<PrismaClient, "externalApp">,
  input: RegisterExternalAppInput,
): Promise<ExternalApp> {
  const id = normalizeExternalAppId(input.id);
  const name = String(input.name || "").trim();
  const ownerPubkey = String(input.ownerPubkey || "").trim();
  const claimAuthMode = normalizeClaimAuthMode(input.claimAuthMode);
  const status = normalizeRuntimeStatus(input.status ?? "active");
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);
  const config = input.config ?? {};
  const environment = normalizeExternalAppEnvironment(
    config.environment ?? "sandbox",
  );
  const reviewLevel = String(config.reviewLevel ?? "sandbox")
    .trim()
    .toLowerCase();

  if (!name) {
    throw new Error("missing_external_app_name");
  }
  if (!ownerPubkey) {
    throw new Error("missing_external_app_owner_pubkey");
  }
  if (claimAuthMode === "server_ed25519" && !input.serverPublicKey?.trim()) {
    throw new Error("external_app_server_public_key_required");
  }
  if (claimAuthMode === "wallet_only_dev" && environment !== "sandbox") {
    throw new Error("wallet_only_dev_requires_sandbox_environment");
  }
  if (environment !== "sandbox") {
    throw new Error("production_review_requires_governance_decision");
  }
  if (reviewLevel !== "sandbox") {
    throw new Error("production_review_requires_governance_decision");
  }

  return prisma.externalApp.upsert({
    where: { id },
    create: {
      id,
      name,
      ownerPubkey,
      status,
      serverPublicKey: input.serverPublicKey?.trim() || null,
      claimAuthMode,
      allowedOrigins,
      config: config as Prisma.InputJsonValue,
      environment,
      registryStatus: "active",
      discoveryStatus: "unlisted",
      managedNodePolicy: "restricted",
    },
    update: {
      name,
      ownerPubkey,
      status,
      serverPublicKey: input.serverPublicKey?.trim() || null,
      claimAuthMode,
      allowedOrigins,
      config: config as Prisma.InputJsonValue,
      environment,
      registryStatus: "active",
    },
  });
}

function normalizeClaimAuthMode(value: unknown): "server_ed25519" | "wallet_only_dev" {
  const normalized = String(value || "").trim();
  if (normalized === "server_ed25519" || normalized === "wallet_only_dev") {
    return normalized;
  }
  throw new Error("invalid_external_app_claim_auth_mode");
}

function normalizeRuntimeStatus(value: unknown): "active" | "inactive" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "active" || normalized === "inactive") {
    return normalized;
  }
  throw new Error("invalid_external_app_status");
}
