import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

export type ExternalAppCircleBindingKind = "primary" | "attached";
export type ExternalAppCircleBindingStatus =
  | "pending"
  | "active"
  | "superseded"
  | "revoked";

type CircleBindingPrisma = Pick<PrismaClient, "externalAppCircleBinding">;

export function normalizeExternalAppCircleBindingKind(
  raw: unknown,
): ExternalAppCircleBindingKind {
  const normalized = String(raw || "").trim().toLowerCase();
  if (normalized === "primary" || normalized === "attached") {
    return normalized;
  }
  throw new Error("invalid_external_app_circle_binding_kind");
}

export function normalizeExternalAppCircleBindingStatus(
  raw: unknown,
): ExternalAppCircleBindingStatus {
  const normalized = String(raw || "").trim().toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "active" ||
    normalized === "superseded" ||
    normalized === "revoked"
  ) {
    return normalized;
  }
  throw new Error("invalid_external_app_circle_binding_status");
}

/**
 * Immutable binding identity digest. Decision digests are effect facts and must
 * not rewrite this value or the binding id after create; use
 * `buildExternalAppCircleBindingEffectDigest` for post-decision effects.
 */
export function buildExternalAppCircleBindingDigest(input: {
  externalAppId: string;
  circleId: number;
  bindingKind: ExternalAppCircleBindingKind;
  environment: string;
  /** @deprecated Ignored. Identity digest never includes decision facts. */
  governanceDecisionDigest?: string | null;
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        bindingKind: input.bindingKind,
        circleId: input.circleId,
        environment: String(input.environment || "").trim().toLowerCase(),
        externalAppId: normalizeExternalAppIdForBinding(input.externalAppId),
        // Frozen null: historical creates used null; never bake decision into identity.
        governanceDecisionDigest: null,
      }),
    )
    .digest("hex");
}

export function buildExternalAppCircleBindingEffectDigest(input: {
  bindingDigest: string;
  governanceRequestId: string;
  governanceDecisionDigest: string;
  operation: "activate" | "revoke";
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        scope: "external_app_circle_binding_effect_v1",
        bindingDigest: String(input.bindingDigest || "").trim().toLowerCase(),
        governanceRequestId: String(input.governanceRequestId || "").trim(),
        governanceDecisionDigest: String(input.governanceDecisionDigest || "")
          .trim()
          .toLowerCase(),
        operation: input.operation,
      }),
    )
    .digest("hex");
}

export async function listExternalAppCircleBindings(
  prisma: CircleBindingPrisma,
  externalAppId: string,
) {
  return prisma.externalAppCircleBinding.findMany({
    where: {
      externalAppId: normalizeExternalAppIdForBinding(externalAppId),
    },
    orderBy: [{ bindingKind: "asc" }, { createdAt: "desc" }],
  });
}

export async function getActivePrimaryCircleBinding(
  prisma: CircleBindingPrisma,
  externalAppId: string,
) {
  return prisma.externalAppCircleBinding.findFirst({
    where: {
      externalAppId: normalizeExternalAppIdForBinding(externalAppId),
      bindingKind: "primary",
      status: "active",
    },
    orderBy: { effectiveAt: "desc" },
  });
}

export async function assertExternalAppCanUseCircle(
  prisma: CircleBindingPrisma,
  input: {
    externalAppId: string;
    circleId: number;
    requiredKind?: "primary_or_attached" | "primary";
  },
) {
  const requiredKind = input.requiredKind ?? "primary_or_attached";
  const binding = await prisma.externalAppCircleBinding.findFirst({
    where: {
      externalAppId: normalizeExternalAppIdForBinding(input.externalAppId),
      circleId: normalizePositiveCircleId(input.circleId),
      status: "active",
      bindingKind: requiredKind === "primary" ? "primary" : { in: ["primary", "attached"] },
    },
    orderBy: { effectiveAt: "desc" },
  });
  if (!binding) {
    throw new Error("external_app_circle_binding_required");
  }
  return binding;
}

export async function createExternalAppCircleBinding(
  prisma: CircleBindingPrisma,
  input: {
    externalAppId: string;
    circleId: number;
    bindingKind: ExternalAppCircleBindingKind;
    environment: string;
    status: ExternalAppCircleBindingStatus;
    createdByPubkey?: string | null;
    governanceRequestId?: string | null;
    governanceDecisionDigest?: string | null;
    executionReceiptId?: string | null;
    source: string;
    metadata?: Record<string, unknown> | null;
  },
) {
  const externalAppId = normalizeExternalAppIdForBinding(input.externalAppId);
  const circleId = normalizePositiveCircleId(input.circleId);
  const bindingKind = normalizeExternalAppCircleBindingKind(input.bindingKind);
  const status = normalizeExternalAppCircleBindingStatus(input.status);
  const environment = normalizeEnvironmentForBinding(input.environment);
  const bindingDigest = buildExternalAppCircleBindingDigest({
    externalAppId,
    circleId,
    bindingKind,
    environment,
    governanceDecisionDigest: input.governanceDecisionDigest ?? null,
  });
  if (status === "active" && bindingKind === "primary") {
    const existing = await getActivePrimaryCircleBinding(prisma, externalAppId);
    if (existing) {
      throw new Error("external_app_active_primary_circle_binding_exists");
    }
  }

  return prisma.externalAppCircleBinding.create({
    data: {
      id: buildExternalAppCircleBindingId({
        externalAppId,
        circleId,
        bindingKind,
        bindingDigest,
      }),
      externalAppId,
      circleId,
      bindingKind,
      status,
      environment,
      bindingDigest,
      governanceRequestId: normalizeOptionalString(input.governanceRequestId, 96),
      governanceDecisionDigest: normalizeOptionalString(
        input.governanceDecisionDigest,
        64,
      ),
      executionReceiptId: normalizeOptionalString(input.executionReceiptId, 96),
      effectiveAt: status === "active" ? new Date() : null,
      createdByPubkey: normalizeOptionalString(input.createdByPubkey, 44),
      source: normalizeOptionalString(input.source, 32) ?? "manual",
      metadata: input.metadata ? (input.metadata as Prisma.InputJsonObject) : undefined,
    },
  });
}

export async function activateExternalAppPrimaryCircleBinding(
  prisma: CircleBindingPrisma & Pick<PrismaClient, "$transaction">,
  input: {
    externalAppId: string;
    bindingId: string;
    effectiveAt?: Date;
  },
) {
  const externalAppId = normalizeExternalAppIdForBinding(input.externalAppId);
  const bindingId = normalizeRequiredString(input.bindingId, "missing_binding_id");
  const effectiveAt = input.effectiveAt ?? new Date();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.externalAppCircleBinding.findUnique({
      where: { id: bindingId },
    });
    if (!existing || existing.externalAppId !== externalAppId) {
      throw new Error("external_app_circle_binding_not_found");
    }
    if (existing.bindingKind !== "primary") {
      throw new Error("external_app_primary_circle_binding_required");
    }
    await tx.externalAppCircleBinding.updateMany({
      where: {
        externalAppId,
        bindingKind: "primary",
        status: "active",
        id: { not: bindingId },
      },
      data: {
        status: "superseded",
        supersededAt: effectiveAt,
      },
    });
    return tx.externalAppCircleBinding.update({
      where: { id: bindingId },
      data: {
        status: "active",
        effectiveAt,
        supersededAt: null,
        revokedAt: null,
      },
    });
  });
}

function buildExternalAppCircleBindingId(input: {
  externalAppId: string;
  circleId: number;
  bindingKind: ExternalAppCircleBindingKind;
  bindingDigest: string;
}): string {
  return [
    "app-circle",
    input.externalAppId,
    input.bindingKind,
    String(input.circleId),
    input.bindingDigest.slice(0, 16),
  ].join(":");
}

function normalizeExternalAppIdForBinding(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(normalized)) {
    throw new Error("invalid_external_app_id");
  }
  return normalized;
}

function normalizePositiveCircleId(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("invalid_circle_id");
  }
  return value;
}

function normalizeEnvironmentForBinding(value: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized.length > 32) {
    throw new Error("invalid_external_app_circle_binding_environment");
  }
  return normalized;
}

function normalizeRequiredString(value: unknown, errorCode: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
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
