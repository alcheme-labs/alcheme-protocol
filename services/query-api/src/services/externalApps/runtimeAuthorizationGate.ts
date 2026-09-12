import { createHash } from "node:crypto";

import type { Redis } from "ioredis";

import {
  DEFAULT_APP_TRUST_ROOT_NONCE_MAX_TTL_MS,
  InMemoryAppTrustRootNonceReplayStore,
  RedisAppTrustRootNonceReplayStore,
  type AppTrustRootNonceReplayStore,
} from "../appTrustRoot/nonceReplayStore";
import {
  evaluateAppTrustRootKeyLifecycle,
  type AppTrustRootKeyLifecycleRecord,
  type AppTrustRootKeyLifecycleStatus,
} from "../appTrustRoot/keyLifecycle";
import { solanaPublicKeysEqual } from "../identity/solanaPublicKey";
import {
  externalAppRegistryModeFromEnv,
  isExternalAppChainTrusted,
  type ExternalAppRegistryAnchorProjection,
} from "./chainRegistryProjection";
import type { ExternalAppRegistryMode } from "./chainRegistryAdapter";
import { serverKeyHash } from "./chainRegistryDigest";

export type ExternalProgramRuntimeCapability =
  | "sourceMaterialSubmission"
  | "knowledgeContext"
  | "voice"
  | "transcriptRecap";

export type ExternalProgramClaimKind =
  | "app_room_claim"
  | "source_submission_claim"
  | "knowledge_context_claim"
  | "source_material_status_claim";

export interface ExternalProgramRuntimeAppRecord {
  id: string;
  status: string | null;
  environment?: string | null;
  ownerPubkey?: string | null;
  registryStatus: string | null;
  serverPublicKey?: string | null;
  claimAuthMode?: string | null;
  capabilityPolicies?: unknown;
  revokedAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

interface RuntimeAuthorizationPrisma {
  externalAppRegistryAnchor?: {
    findUnique(input: unknown): Promise<ExternalAppRegistryAnchorProjection | null>;
  };
  externalAppServerKey?: {
    findMany(input: unknown): Promise<ExternalAppServerKeyRecord[]>;
  };
}

interface ExternalAppServerKeyRecord {
  id: string;
  keyVersion: string;
  publicKey: string;
  status: string;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  graceUntil?: Date | string | null;
  revokedAt?: Date | string | null;
}

export class ExternalProgramRuntimeAuthorizationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ExternalProgramRuntimeAuthorizationError";
  }
}

export async function assertExternalProgramRuntimeAppAllowed(
  prisma: RuntimeAuthorizationPrisma,
  input: {
    app: ExternalProgramRuntimeAppRecord | null;
    registryMode?: ExternalAppRegistryMode;
    requestedCapabilities?: ExternalProgramRuntimeCapability[];
    now?: Date;
    expectedOwnerPubkey?: string | null;
  },
): Promise<ExternalProgramRuntimeAppRecord> {
  const app = input.app;
  if (!app) {
    throw externalProgramRuntimeError("external_app_not_found", 404);
  }
  if (app.status !== "active") {
    throw externalProgramRuntimeError("external_app_not_active", 403);
  }
  if (app.registryStatus !== "active") {
    throw externalProgramRuntimeError("external_app_not_approved", 403);
  }
  if (app.revokedAt != null && String(app.revokedAt).trim() !== "") {
    throw externalProgramRuntimeError("external_app_revoked", 403);
  }
  const now = input.now ?? new Date();
  if (app.expiresAt != null && String(app.expiresAt).trim() !== "") {
    const expiresAtMs = Date.parse(String(app.expiresAt));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      throw externalProgramRuntimeError("external_app_expired", 403);
    }
  }

  const anchor =
    input.registryMode === "required" && app.environment === "mainnet_production"
	      ? await prisma.externalAppRegistryAnchor?.findUnique({
	          where: { externalAppId: app.id },
	          select: {
	            registryStatus: true,
	            finalityStatus: true,
	            receiptFinalityStatus: true,
	            serverKeyHash: true,
	          },
	        })
      : null;
  if (
    !isExternalAppChainTrusted({
      app: {
        environment: app.environment,
        registryStatus: app.registryStatus,
      },
      anchor,
      mode: input.registryMode,
    })
  ) {
    throw externalProgramRuntimeError("external_app_registry_anchor_required", 403);
  }

  assertExternalProgramCapabilitiesAllowed(app.capabilityPolicies, {
    requestedCapabilities: input.requestedCapabilities ?? [],
  });
  if (
    input.expectedOwnerPubkey != null
    && String(input.expectedOwnerPubkey).trim() !== ""
    && !solanaPublicKeysEqual(app.ownerPubkey, input.expectedOwnerPubkey)
  ) {
    throw externalProgramRuntimeError("external_app_owner_required", 403);
  }
  return app;
}

/**
 * Lock order: ExternalApp FOR UPDATE, then RegistryAnchor FOR UPDATE when required.
 * Callers must re-check frozen application Owner against the locked app.ownerPubkey.
 */
export async function lockAndAssertExternalProgramRuntimeApp(
  tx: any,
  input: {
    externalAppId: string;
    registryMode?: ExternalAppRegistryMode;
    requestedCapabilities?: ExternalProgramRuntimeCapability[];
    now?: Date;
    expectedOwnerPubkey?: string | null;
  },
): Promise<ExternalProgramRuntimeAppRecord> {
  const externalAppId = String(input.externalAppId || "").trim();
  if (!externalAppId) {
    throw externalProgramRuntimeError("external_app_not_found", 404);
  }

  let app: ExternalProgramRuntimeAppRecord | null = null;
  if (typeof tx.$queryRawUnsafe === "function") {
    const rows = await tx.$queryRawUnsafe(
      `SELECT id,
              environment,
              owner_pubkey AS "ownerPubkey",
              status,
              registry_status AS "registryStatus",
              revoked_at AS "revokedAt",
              expires_at AS "expiresAt",
              capability_policies AS "capabilityPolicies",
              server_public_key AS "serverPublicKey",
              claim_auth_mode AS "claimAuthMode"
       FROM external_apps
       WHERE id = $1
       FOR UPDATE`,
      externalAppId,
    ) as ExternalProgramRuntimeAppRecord[];
    app = Array.isArray(rows) && rows[0] ? rows[0] : null;
    if (
      app
      && input.registryMode === "required"
      && app.environment === "mainnet_production"
      && typeof tx.$queryRawUnsafe === "function"
    ) {
      await tx.$queryRawUnsafe(
        `SELECT external_app_id
         FROM external_app_registry_anchors
         WHERE external_app_id = $1
         FOR UPDATE`,
        externalAppId,
      );
    }
  } else if (typeof tx.externalApp?.findUnique === "function") {
    app = await tx.externalApp.findUnique({
      where: { id: externalAppId },
      select: {
        id: true,
        environment: true,
        ownerPubkey: true,
        status: true,
        registryStatus: true,
        revokedAt: true,
        expiresAt: true,
        capabilityPolicies: true,
        serverPublicKey: true,
        claimAuthMode: true,
      },
    });
  }

  return assertExternalProgramRuntimeAppAllowed(tx, {
    app,
    registryMode: input.registryMode,
    requestedCapabilities: input.requestedCapabilities,
    now: input.now,
    expectedOwnerPubkey: input.expectedOwnerPubkey,
  });
}

/**
 * Canonical App lock + post-lock wall clock for External Program authority.
 * Callers must use returned authorityNow for effectiveAt/executedAt and not
 * capture Date.now() before locks.
 */
export async function lockAssertClockExternalProgramRuntimeApp(
  tx: any,
  input: {
    externalAppId: string;
    registryMode?: ExternalAppRegistryMode;
    requestedCapabilities?: ExternalProgramRuntimeCapability[];
    now?: Date;
    expectedOwnerPubkey?: string | null;
  },
): Promise<{ app: ExternalProgramRuntimeAppRecord; authorityNow: Date }> {
  const provisionalNow = input.now ?? new Date();
  const locked = await lockAndAssertExternalProgramRuntimeApp(tx, {
    ...input,
    now: provisionalNow,
  });
  let authorityNow = provisionalNow;
  if (typeof tx.$queryRawUnsafe === "function") {
    const rows = await tx.$queryRawUnsafe(
      `SELECT clock_timestamp() AS "now"`,
    ) as Array<{ now: Date | string }>;
    const dbNow = rows?.[0]?.now;
    if (dbNow) {
      authorityNow = dbNow instanceof Date ? dbNow : new Date(dbNow);
    } else {
      authorityNow = new Date();
    }
  } else {
    authorityNow = new Date();
  }
  const app = await assertExternalProgramRuntimeAppAllowed(tx, {
    app: locked,
    registryMode: input.registryMode,
    requestedCapabilities: input.requestedCapabilities,
    now: authorityNow,
    expectedOwnerPubkey: input.expectedOwnerPubkey,
  });
  return { app, authorityNow };
}

export function assertExternalProgramCapabilitiesAllowed(
  capabilityPolicies: unknown,
  input: {
    requestedCapabilities: ExternalProgramRuntimeCapability[];
  },
): void {
  for (const capability of input.requestedCapabilities) {
    if (!isCapabilityAllowed(capabilityPolicies, capability)) {
      throw externalProgramRuntimeError("external_app_capability_disabled", 403, {
        capability,
      });
    }
  }
}

export async function resolveExternalProgramServerPublicKey(
  prisma: RuntimeAuthorizationPrisma,
  input: {
    app: ExternalProgramRuntimeAppRecord;
    serverKeyVersion?: string | null;
    now?: Date;
  },
): Promise<string> {
  const serverKeyVersion = String(input.serverKeyVersion || "").trim();
  if (!serverKeyVersion) {
    if (input.app.environment && input.app.environment !== "sandbox") {
      throw externalProgramRuntimeError("external_app_server_key_lifecycle_required", 403);
    }
    if (!input.app.serverPublicKey) {
      throw externalProgramRuntimeError("external_app_server_public_key_required", 401);
    }
    return input.app.serverPublicKey;
  }

  if (!prisma.externalAppServerKey) {
    throw externalProgramRuntimeError("external_app_server_key_lifecycle_required", 403);
  }
  const rows = await prisma.externalAppServerKey.findMany({
    where: {
      externalAppId: input.app.id,
      keyVersion: serverKeyVersion,
    },
    select: {
      id: true,
      keyVersion: true,
      publicKey: true,
      status: true,
      validFrom: true,
      validUntil: true,
      graceUntil: true,
      revokedAt: true,
    },
  });
  const decision = evaluateAppTrustRootKeyLifecycle({
    keyId: serverKeyVersion,
    keys: rows.map(mapServerKeyLifecycleRecord),
    now: input.now,
  });
  if (!decision.allowed) {
    throw externalProgramRuntimeError(decision.reasonCode, 403);
  }
  const key = rows.find((row) => row.keyVersion === decision.key?.keyId);
  if (!key?.publicKey) {
    throw externalProgramRuntimeError("key_unknown", 403);
  }
  await assertServerKeyMatchesTrustedAnchor(prisma, input.app, key.publicKey);
  return key.publicKey;
}

async function assertServerKeyMatchesTrustedAnchor(
  prisma: RuntimeAuthorizationPrisma,
  app: ExternalProgramRuntimeAppRecord,
  publicKey: string,
): Promise<void> {
  if (
    app.environment !== "mainnet_production" ||
    externalAppRegistryModeFromEnv() !== "required" ||
    typeof prisma.externalAppRegistryAnchor?.findUnique !== "function"
  ) {
    return;
  }
  const anchor = await prisma.externalAppRegistryAnchor.findUnique({
    where: { externalAppId: app.id },
    select: { serverKeyHash: true },
  });
  if (
    anchor?.serverKeyHash &&
    serverKeyHash(publicKey) !== String(anchor.serverKeyHash)
  ) {
    throw externalProgramRuntimeError(
      "external_app_server_key_anchor_mismatch",
      403,
    );
  }
}

export async function consumeExternalProgramClaimNonce(input: {
  nonceReplayStore?: AppTrustRootNonceReplayStore | null;
  claimKind: ExternalProgramClaimKind;
  externalAppId: string;
  nonce: string;
  expiresAt: string;
  encodedPayload: string;
  now?: Date;
}): Promise<void> {
  if (!input.nonceReplayStore) return;
  const result = await input.nonceReplayStore.consume({
    replayDomain: `external_program:${input.claimKind}:${input.externalAppId}`,
    nonce: input.nonce,
    expiresAt: input.expiresAt,
    now: input.now,
    maxTtlMs: DEFAULT_APP_TRUST_ROOT_NONCE_MAX_TTL_MS,
    payloadDigest: createHash("sha256").update(input.encodedPayload).digest("hex"),
  });
  if (!result.consumed) {
    throw externalProgramRuntimeError(
      result.reasonCode ?? "nonce_replayed",
      nonceReplayStatusCode(result.reasonCode),
    );
  }
}

export function createExternalProgramNonceReplayStore(
  redis: Pick<Redis, "set"> | null | undefined,
): AppTrustRootNonceReplayStore {
  return redis && typeof redis.set === "function"
    ? new RedisAppTrustRootNonceReplayStore(redis as Pick<Redis, "set">)
    : new InMemoryAppTrustRootNonceReplayStore();
}

function mapServerKeyLifecycleRecord(
  row: ExternalAppServerKeyRecord,
): AppTrustRootKeyLifecycleRecord {
  return {
    keyId: row.keyVersion,
    publicKeyRef: row.publicKey,
    status: row.status as AppTrustRootKeyLifecycleStatus,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    graceUntil: row.graceUntil,
    revokedAt: row.revokedAt,
  };
}

function isCapabilityAllowed(
  capabilityPolicies: unknown,
  capability: ExternalProgramRuntimeCapability,
): boolean {
  if (!capabilityPolicies || typeof capabilityPolicies !== "object" || Array.isArray(capabilityPolicies)) {
    return true;
  }
  const record = capabilityPolicies as Record<string, unknown>;
  const values = [
    record[capability],
    record[toSnakeCase(capability)],
  ];
  for (const value of values) {
    if (value === false) return false;
    if (typeof value === "string" && isDisabledCapabilityValue(value)) return false;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      if (nested.enabled === false) return false;
      if (typeof nested.mode === "string" && isDisabledCapabilityValue(nested.mode)) {
        return false;
      }
      if (typeof nested.status === "string" && isDisabledCapabilityValue(nested.status)) {
        return false;
      }
    }
  }
  return true;
}

function isDisabledCapabilityValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "disabled_on_managed_node" ||
    normalized === "disabled" ||
    normalized === "off" ||
    normalized === "deny" ||
    normalized === "denied"
  );
}

function nonceReplayStatusCode(reasonCode: string | null | undefined): number {
  return reasonCode === "nonce_replayed" ? 409 : 400;
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function externalProgramRuntimeError(
  code: string,
  statusCode: number,
  details?: Record<string, unknown>,
): ExternalProgramRuntimeAuthorizationError {
  return new ExternalProgramRuntimeAuthorizationError(code, statusCode, details);
}
