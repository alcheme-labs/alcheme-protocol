import { Prisma, type PrismaClient } from "@prisma/client";

import {
  computeManifestHash,
  type ExternalAppManifest,
} from "./manifest";
import {
  buildExternalAppOwnerAssertionPayload,
  extractSolanaOwnerPubkey,
  verifyExternalAppOwnerAssertion,
  type ExternalAppOwnerAssertion,
} from "./ownerAssertion";
import { createExternalApp } from "./registry";
import {
  normalizeAllowedOrigins,
  normalizeExternalAppId,
} from "./validation";
import {
  assertSandboxRegistrationAllowed,
  loadSandboxRegistrationAbusePolicy,
  type SandboxRegistrationAbusePolicy,
} from "./abuseControlPolicy";
import {
  buildStoredServerKeyVerification,
  normalizeExternalAppServerKeyProof,
  verifyExternalAppServerKeyProof,
  type ExternalAppServerKeyProofPayload,
} from "./serverKeyProof";

export const SANDBOX_REGISTRATION_OWNER_ASSERTION_AUDIENCE =
  "alcheme:external-app-sandbox-registration";

const RESERVED_EXTERNAL_APP_IDS = new Set([
  "admin",
  "api",
  "apps",
  "circle-bindings",
  "developer",
  "discovery",
  "error-contract",
  "external-apps",
  "knowledge-context",
  "mine",
  "operator",
  "production-registration-requests",
  "provisioning",
  "provisioning-status",
  "review",
  "review-policy",
  "reviews",
  "risk-disclaimers",
  "runtime-capabilities",
  "source-materials",
]);

export interface SandboxExternalAppRegistrationResult {
  app: {
    id: string;
    name: string;
    status: string;
    environment: string;
    registryStatus: string;
    discoveryStatus: string;
    managedNodePolicy: string;
    ownerPubkey: string;
    manifestHash: string;
    allowedOrigins: string[];
  };
  nextAction: "bind_primary_circle";
  audit: {
    source: "self_service_sandbox";
    manifestHash: string;
    ownerAssertionNonce: string;
    serverKeyProofNonce: string;
    registeredAt: string;
  };
}

type SelfServicePrisma = Pick<PrismaClient, "externalApp">;

export async function registerSandboxExternalAppSelfService(
  prisma: SelfServicePrisma,
  body: Record<string, unknown>,
  deps: {
    now?: Date;
    env?: NodeJS.ProcessEnv;
    policy?: SandboxRegistrationAbusePolicy;
  } = {},
): Promise<SandboxExternalAppRegistrationResult> {
  const now = deps.now ?? new Date();
  const manifest = normalizeSandboxExternalAppManifest(body.manifest);
  const externalAppId = manifest.appId;
  assertExternalAppIdNotReserved(externalAppId);

  const ownerAssertion = normalizeOwnerAssertion(body.ownerAssertion);
  const manifestHash = computeManifestHash(manifest);
  const assertionPayload = verifyExternalAppOwnerAssertion({
    assertion: ownerAssertion,
    expected: {
      appId: externalAppId,
      ownerWallet: manifest.ownerWallet,
      manifestHash,
      audience: SANDBOX_REGISTRATION_OWNER_ASSERTION_AUDIENCE,
    },
    now,
  });
  buildExternalAppOwnerAssertionPayload(assertionPayload);
  const serverKeyProofPayload = verifyExternalAppServerKeyProof({
    proof: normalizeExternalAppServerKeyProof(body.serverKeyProof),
    expected: {
      appId: externalAppId,
      serverPublicKey: manifest.serverPublicKey,
      manifestHash,
    },
    now,
  });
  const ownerPubkey = extractSolanaOwnerPubkey(manifest.ownerWallet);

  const audit = {
    source: "self_service_sandbox" as const,
    manifestHash,
    ownerAssertionNonce: assertionPayload.nonce,
    serverKeyProofNonce: serverKeyProofPayload.nonce,
    registeredAt: now.toISOString(),
  };
  const created = await createSandboxExternalAppWithPolicy(prisma, {
    externalAppId,
    manifest,
    ownerPubkey,
    audit,
    serverKeyProofPayload,
    now,
    policy: deps.policy ?? loadSandboxRegistrationAbusePolicy(deps.env),
  });

  return {
    app: {
      id: created.id,
      name: created.name,
      status: created.status,
      environment: created.environment,
      registryStatus: created.registryStatus,
      discoveryStatus: created.discoveryStatus,
      managedNodePolicy: created.managedNodePolicy,
      ownerPubkey: created.ownerPubkey,
      manifestHash,
      allowedOrigins: manifest.allowedOrigins,
    },
    nextAction: "bind_primary_circle",
    audit,
  };
}

async function createSandboxExternalAppWithPolicy(
  prisma: SelfServicePrisma,
  input: {
    externalAppId: string;
    manifest: ExternalAppManifest;
    ownerPubkey: string;
    audit: SandboxExternalAppRegistrationResult["audit"];
    serverKeyProofPayload: ExternalAppServerKeyProofPayload;
    now: Date;
    policy: SandboxRegistrationAbusePolicy;
  },
) {
  const transactional = prisma as SelfServicePrisma & {
    $transaction?: <T>(
      fn: (tx: SelfServicePrisma) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
    ) => Promise<T>;
  };
  try {
    if (typeof transactional.$transaction === "function") {
      return await transactional.$transaction(
        (tx) => createSandboxExternalAppAfterPolicy(tx, input),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }
    return await createSandboxExternalAppAfterPolicy(prisma, input);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("external_app_id_unavailable");
    }
    if (isTransactionConflictError(error)) {
      throw new Error("external_app_registration_conflict_retry");
    }
    throw error;
  }
}

async function createSandboxExternalAppAfterPolicy(
  prisma: SelfServicePrisma,
  input: {
    externalAppId: string;
    manifest: ExternalAppManifest;
    ownerPubkey: string;
    audit: SandboxExternalAppRegistrationResult["audit"];
    serverKeyProofPayload: ExternalAppServerKeyProofPayload;
    now: Date;
    policy: SandboxRegistrationAbusePolicy;
  },
) {
  const existingAppCount = await countExternalApps(prisma, {
    ownerPubkey: input.ownerPubkey,
  });
  const recentRegistrationCount = await countExternalApps(prisma, {
    ownerPubkey: input.ownerPubkey,
    createdAfter: new Date(input.now.getTime() - 60 * 60 * 1000),
  });
  assertSandboxRegistrationAllowed({
    ownerPubkey: input.ownerPubkey,
    existingAppCount,
    recentRegistrationCount,
    policy: input.policy,
  });
  return createSandboxExternalApp(prisma, input);
}

async function createSandboxExternalApp(
  prisma: SelfServicePrisma,
  input: {
    externalAppId: string;
    manifest: ExternalAppManifest;
    ownerPubkey: string;
    audit: SandboxExternalAppRegistrationResult["audit"];
    serverKeyProofPayload: ExternalAppServerKeyProofPayload;
    now: Date;
  },
) {
  try {
    return await createExternalApp(prisma as any, {
      id: input.externalAppId,
      name: input.manifest.name,
      ownerPubkey: input.ownerPubkey,
      allowedOrigins: input.manifest.allowedOrigins,
      serverPublicKey: input.manifest.serverPublicKey,
      claimAuthMode: "server_ed25519",
      status: "active",
      config: {
        manifest: input.manifest,
        audit: input.audit,
        environment: "sandbox",
        reviewLevel: "sandbox",
        registrationSource: "self_service_sandbox",
        serverKeyVerification: buildStoredServerKeyVerification({
          payload: input.serverKeyProofPayload,
          now: input.now,
        }),
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error("external_app_id_unavailable");
    }
    throw error;
  }
}

function normalizeSandboxExternalAppManifest(raw: unknown): ExternalAppManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("invalid_external_app_manifest");
  }
  const record = raw as Record<string, unknown>;
  const appId = normalizeExternalAppId(record.appId);
  const allowedOrigins = normalizeSandboxAllowedOrigins(record.allowedOrigins);
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((capability) => String(capability).trim()).filter(Boolean)
    : [];
  const name = String(record.name || "").trim();
  const ownerWallet = String(record.ownerWallet || "").trim();
  const serverPublicKey = String(record.serverPublicKey || "").trim();
  if (
    record.version !== "1" ||
    !name ||
    !record.homeUrl ||
    !ownerWallet ||
    !serverPublicKey
  ) {
    throw new Error("invalid_external_app_manifest");
  }
  const platforms = asRecord(record.platforms);
  const callbacks = asRecord(record.callbacks);
  const policy = asRecord(record.policy);
  return {
    version: "1",
    appId,
    name,
    homeUrl: normalizeSandboxManifestUrl(record.homeUrl),
    ownerWallet,
    serverPublicKey,
    allowedOrigins,
    capabilities,
    ...(platforms ? { platforms } : {}),
    ...(callbacks ? { callbacks } : {}),
    ...(policy ? { policy } : {}),
  };
}

function normalizeSandboxAllowedOrigins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("invalid_external_app_origin");
  }
  if (value.some((origin) => String(origin || "").includes("*"))) {
    throw new Error("invalid_external_app_origin");
  }
  const origins = normalizeAllowedOrigins(value);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (parsed.protocol === "http:" && !isLocalDevelopmentHost(parsed.hostname)) {
      throw new Error("invalid_external_app_origin");
    }
  }
  return origins;
}

function normalizeSandboxManifestUrl(value: unknown): string {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:") return parsed.toString();
    if (parsed.protocol === "http:" && isLocalDevelopmentHost(parsed.hostname)) {
      return parsed.toString();
    }
  } catch {
    // handled below
  }
  throw new Error("invalid_external_app_manifest");
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function normalizeOwnerAssertion(value: unknown): ExternalAppOwnerAssertion {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("external_app_owner_assertion_required");
  }
  const record = value as Record<string, unknown>;
  if (!record.payload || !record.signature) {
    throw new Error("external_app_owner_assertion_required");
  }
  return {
    payload: String(record.payload),
    signature: String(record.signature),
  };
}

function assertExternalAppIdNotReserved(externalAppId: string): void {
  if (RESERVED_EXTERNAL_APP_IDS.has(externalAppId)) {
    throw new Error("external_app_id_reserved");
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

async function countExternalApps(
  prisma: SelfServicePrisma,
  input: { ownerPubkey: string; createdAfter?: Date },
): Promise<number> {
  const client = (prisma as any).externalApp;
  if (typeof client.count !== "function") return 0;
  return client.count({
    where: {
      ownerPubkey: input.ownerPubkey,
      environment: "sandbox",
      ...(input.createdAfter ? { createdAt: { gte: input.createdAfter } } : {}),
    },
  });
}

function isTransactionConflictError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034",
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
