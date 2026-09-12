import type { PrismaClient } from "@prisma/client";

import {
  externalAppRegistryModeFromEnv,
  isExternalAppChainTrusted,
} from "./chainRegistryProjection";
import {
  buildExternalAppStabilityProjection,
  mapStoredStabilityProjection,
} from "./stabilityProjection";
import type { ExternalAppStabilityProjectionView } from "./stabilityTypes";
import { buildExternalAppStoreProjection } from "./storeProjection";
import { listExternalAppCircleBindings } from "./circleBindings";
import {
  buildExternalProgramRuntimeCapabilities,
  type ExternalProgramRuntimeCapabilities,
} from "./runtimeCapabilities";
import {
  getLatestExternalAppProductionReview,
  type ExternalAppProductionReviewProjection,
} from "./productionReviewProjection";
import {
  projectExternalAppServerKeyLifecycle,
  type ExternalAppServerKeyLifecycleRow,
} from "./serverKeyLifecycle";
import {
  projectExternalAppServerKeyVerification,
  type ExternalAppServerKeyVerificationStatus,
} from "./serverKeyProof";

export interface ExternalProgramIntegrationStatus {
  appId: string;
  visibility: "public_safe";
  registration: {
    exists: true;
    status: string;
    environment: string;
    registryStatus: string;
    discoveryStatus: string;
    managedNodePolicy: string;
    manifestHash: string | null;
    updatedAt: string | null;
  };
  circleBinding: {
    required: true;
    primaryCircleId: number | null;
    activeCount: number;
    pendingCount: number;
  };
  runtime: {
    capabilities: ExternalProgramRuntimeCapabilities;
    appCapabilitySummary: ExternalProgramCapabilitySummary;
    serverKeyLifecycle: ExternalProgramServerKeyLifecycleStatus;
    serverKeyVerification: ExternalAppServerKeyVerificationStatus;
  };
  productionReview: ExternalProgramProductionReviewStatus;
  sourceMaterials: ExternalProgramRuntimeCapabilities["sourceMaterials"];
  trust: {
    registryMode: string;
    chainTrusted: boolean;
    registryAnchor: {
      registryStatus: string | null;
      finalityStatus: string | null;
      receiptFinalityStatus: string | null;
    } | null;
    stabilityProjection: ExternalProgramPublicStabilityProjection;
    storeProjection: ExternalProgramPublicStoreProjection;
  };
  errors: Array<{ code: string; severity: "blocking" | "warning" }>;
  nextAction: string;
}

export interface ExternalProgramCapabilitySummary {
  sourceMaterialSubmission: "enabled" | "disabled";
  knowledgeContext: "enabled" | "disabled";
  voice: "enabled" | "disabled";
  transcriptRecap: "enabled" | "disabled";
}

export interface ExternalProgramProductionReviewStatus {
  status: ExternalAppProductionReviewProjection["status"];
  request: {
    state: string;
    policyEpochId: string;
    openedAt: string | null;
    resolvedAt: string | null;
    decision: string | null;
    executionStatus: string | null;
    executionErrorCode: string | null;
  } | null;
}

export interface ExternalProgramServerKeyLifecycleStatus {
  ready: boolean;
  required: boolean;
  activeKeyVersion: string | null;
  activeKeyCount: number;
  graceKeyCount: number;
  revokedKeyCount: number;
  nextAction: string;
}

export interface ExternalProgramPublicStabilityProjection {
  registryStatus?: string;
  policyEpochId: string;
  challengeState: string;
  projectionStatus: string;
  publicLabels: string[];
  riskScore: number;
  trustScore: number;
  supportSignalLevel: number;
  supportIndependenceScore: number;
  rollout: Record<string, unknown>;
  bondState?: {
    ownerBonded: boolean;
    activeChallengeBonded: boolean;
    activeChallengeCount: number;
  };
  bondDispositionState?: {
    state: string;
    activeCaseCount: number;
    riskDisclaimerAccepted: boolean;
    riskDisclaimerRequired: boolean;
    hasActiveLockedAmount: boolean;
    hasRoutedAmount: boolean;
  };
  governanceState?: ExternalAppStabilityProjectionView["governanceState"];
  updatedAt?: string;
}

export interface ExternalProgramPublicStoreProjection {
  listingState: string;
  categoryTags: string[];
  rankingScore: number;
  rankingFallbackMode: boolean;
  featuredState: string;
  continuityLabels: string[];
  updatedAt: string;
}

export interface ExternalProgramPublicStatusSummary {
  registrationStatus: string;
  registryStatus: string;
  discoveryStatus: string;
  productionReviewStatus: ExternalAppProductionReviewProjection["status"];
  primaryCircleId: number | null;
  sourceMaterialMode: ExternalProgramRuntimeCapabilities["sourceMaterials"]["mode"];
  trustProjectionStatus: string;
  nextAction: string;
}

export async function buildExternalProgramIntegrationStatus(
  prisma: PrismaClient,
  externalAppId: string,
): Promise<ExternalProgramIntegrationStatus | null> {
  const app = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: externalProgramStatusAppSelect(),
  });
  if (!app) return null;

  const bindings = await listExternalAppCircleBindings(prisma, externalAppId);
  const activeBindings = bindings.filter(
    (binding: any) => binding.status === "active",
  );
  const primaryBinding =
    activeBindings.find((binding: any) => binding.bindingKind === "primary") ??
    null;
  const pendingCount = bindings.filter(
    (binding: any) => binding.status === "pending",
  ).length;
  const runtimeCapabilities = buildExternalProgramRuntimeCapabilities();
  const productionReview = await getLatestExternalAppProductionReview(
    prisma,
    externalAppId,
  );
  const registryMode = externalAppRegistryModeFromEnv();
  const registryAnchor = await loadRegistryAnchor(prisma, externalAppId);
  const chainTrusted = isExternalAppChainTrusted({
    app,
    anchor: registryAnchor,
    mode: registryMode,
  });
  const serverKeyRows = await loadExternalAppServerKeys(prisma, externalAppId);
  const serverKeyLifecycle = projectExternalAppServerKeyLifecycle({
    environment: app.environment,
    keys: serverKeyRows,
    chainTrusted,
    trustedServerKeyHash: registryAnchor?.serverKeyHash ?? null,
  });
  const serverKeyVerification = projectExternalAppServerKeyVerification({
    environment: app.environment,
    claimAuthMode: app.claimAuthMode,
    serverPublicKey: app.serverPublicKey,
    config: app.config,
  });
  const storedStabilityProjection = await loadLatestStabilityProjection(
    prisma,
    externalAppId,
  );
  const stabilityProjection =
    storedStabilityProjection ??
    buildExternalAppStabilityProjection({
      app,
      registryAnchor,
    });
  const storeProjection = buildExternalAppStoreProjection({
    app,
    stabilityProjection,
  });
  const errors = deriveIntegrationErrors({
    app,
    primaryBinding,
    sourceMaterials: runtimeCapabilities.sourceMaterials,
    serverKeyVerification,
  });

  return {
    appId: app.id,
    visibility: "public_safe",
    registration: {
      exists: true,
      status: app.status,
      environment: app.environment,
      registryStatus: app.registryStatus,
      discoveryStatus: app.discoveryStatus,
      managedNodePolicy: app.managedNodePolicy,
      manifestHash: app.manifestHash ?? null,
      updatedAt: toIsoOrNull(app.updatedAt),
    },
    circleBinding: {
      required: true,
      primaryCircleId: primaryBinding?.circleId ?? null,
      activeCount: activeBindings.length,
      pendingCount,
    },
    runtime: {
      capabilities: runtimeCapabilities,
      appCapabilitySummary: summarizeCapabilityPolicies(app.capabilityPolicies),
      serverKeyLifecycle,
      serverKeyVerification,
    },
    productionReview: toPublicProductionReview(productionReview),
    sourceMaterials: runtimeCapabilities.sourceMaterials,
    trust: {
      registryMode,
      chainTrusted,
      registryAnchor: registryAnchor
        ? {
            registryStatus: registryAnchor.registryStatus ?? null,
            finalityStatus: registryAnchor.finalityStatus ?? null,
            receiptFinalityStatus: registryAnchor.receiptFinalityStatus ?? null,
          }
        : null,
      stabilityProjection: toPublicStabilityProjection(stabilityProjection),
      storeProjection: toPublicStoreProjection(storeProjection),
    },
    errors,
    nextAction: deriveNextAction({
      app,
      primaryBinding,
      productionReview,
      errors,
      runtimeCapabilities,
      chainTrusted,
      serverKeyLifecycle,
      serverKeyVerification,
    }),
  };
}

export function buildExternalProgramPublicStatusSummary(
  status: ExternalProgramIntegrationStatus,
): ExternalProgramPublicStatusSummary {
  return {
    registrationStatus: status.registration.status,
    registryStatus: status.registration.registryStatus,
    discoveryStatus: status.registration.discoveryStatus,
    productionReviewStatus: status.productionReview.status,
    primaryCircleId: status.circleBinding.primaryCircleId,
    sourceMaterialMode: status.sourceMaterials.mode,
    trustProjectionStatus: status.trust.stabilityProjection.projectionStatus,
    nextAction: status.nextAction,
  };
}

function externalProgramStatusAppSelect() {
  return {
    id: true,
    name: true,
    status: true,
    environment: true,
    registryStatus: true,
    discoveryStatus: true,
    managedNodePolicy: true,
    capabilityPolicies: true,
    manifestHash: true,
    trustScore: true,
    riskScore: true,
    ownerBond: true,
    communityBackingLevel: true,
    config: true,
    serverPublicKey: true,
    claimAuthMode: true,
    updatedAt: true,
  };
}

async function loadLatestStabilityProjection(
  prisma: PrismaClient,
  externalAppId: string,
): Promise<ExternalAppStabilityProjectionView | null> {
  const client = (prisma as any).externalAppStabilityProjection;
  if (typeof client?.findFirst !== "function") return null;
  const record = await client.findFirst({
    where: { externalAppId },
    orderBy: { updatedAt: "desc" },
    select: {
      policyEpochId: true,
      challengeState: true,
      projectionStatus: true,
      publicLabels: true,
      riskScore: true,
      trustScore: true,
      supportSignalLevel: true,
      supportIndependenceScore: true,
      rollout: true,
      formulaInputs: true,
      formulaOutputs: true,
      bondDispositionState: true,
      governanceState: true,
      statusProvenance: true,
      updatedAt: true,
    },
  });
  return record ? mapStoredStabilityProjection(record) : null;
}

async function loadRegistryAnchor(
  prisma: PrismaClient,
  externalAppId: string,
): Promise<{
  registryStatus: string;
  finalityStatus: string;
  receiptFinalityStatus: string;
  serverKeyHash: string | null;
} | null> {
  const client = (prisma as any).externalAppRegistryAnchor;
  if (typeof client?.findUnique !== "function") return null;
  const anchor = await client.findUnique({
    where: { externalAppId },
    select: {
      registryStatus: true,
      finalityStatus: true,
      receiptFinalityStatus: true,
      serverKeyHash: true,
    },
  });
  if (!anchor) return null;
  return {
    registryStatus: String(anchor.registryStatus || ""),
    finalityStatus: String(anchor.finalityStatus || ""),
    receiptFinalityStatus: String(anchor.receiptFinalityStatus || ""),
    serverKeyHash: anchor.serverKeyHash ? String(anchor.serverKeyHash) : null,
  };
}

function deriveIntegrationErrors(input: {
  app: { status: string; registryStatus: string };
  primaryBinding: any | null;
  sourceMaterials: ExternalProgramRuntimeCapabilities["sourceMaterials"];
  serverKeyVerification: ExternalAppServerKeyVerificationStatus;
}): Array<{ code: string; severity: "blocking" | "warning" }> {
  const errors: Array<{ code: string; severity: "blocking" | "warning" }> = [];
  if (input.app.status !== "active") {
    errors.push({ code: "external_app_inactive", severity: "blocking" });
  }
  if (input.app.registryStatus !== "active") {
    errors.push({
      code: "external_app_registry_not_active",
      severity: "blocking",
    });
  }
  if (!input.primaryBinding) {
    errors.push({
      code: "external_app_primary_circle_binding_required",
      severity: "blocking",
    });
  }
  if (
    input.serverKeyVerification.required &&
    !input.serverKeyVerification.verified
  ) {
    errors.push({
      code: "external_app_server_key_unverified",
      severity: "blocking",
    });
  }
  if (!input.sourceMaterials.availableOnThisNode) {
    errors.push({ code: "private_sidecar_required", severity: "warning" });
  }
  return errors;
}

function deriveNextAction(input: {
  app: { environment: string; status: string; registryStatus: string };
  primaryBinding: any | null;
  productionReview: ExternalAppProductionReviewProjection;
  errors: Array<{ code: string }>;
  runtimeCapabilities: ExternalProgramRuntimeCapabilities;
  chainTrusted: boolean;
  serverKeyLifecycle: ExternalProgramServerKeyLifecycleStatus;
  serverKeyVerification: ExternalAppServerKeyVerificationStatus;
}): string {
  if (input.app.environment === "sandbox") {
    if (input.app.status !== "active") return "activate_sandbox_app";
    if (input.app.registryStatus !== "active")
      return "wait_for_registry_activation";
    if (
      input.serverKeyVerification.required &&
      !input.serverKeyVerification.verified
    ) {
      return "verify_server_key_possession";
    }
    if (!input.primaryBinding) return "bind_primary_circle";
    return input.errors.some(
      (error) => error.code === "private_sidecar_required",
    )
      ? "use_private_sidecar_for_source_materials"
      : "ready_for_sandbox";
  }
  if (!input.primaryBinding) return "bind_primary_circle";
  if (input.productionReview.status === "not_requested")
    return "request_production_review";
  if (input.productionReview.status === "in_review") return "wait_for_review";
  if (input.productionReview.status === "accepted_pending_execution") {
    return "wait_for_governance_execution";
  }
  if (input.productionReview.status === "execution_failed") {
    return "retry_governance_execution";
  }
  if (input.productionReview.status === "rejected") return "review_rejected";
  if (input.productionReview.status === "disabled")
    return "production_disabled";
  if (input.app.status !== "active") return "activate_external_app";
  if (input.app.registryStatus !== "active")
    return "wait_for_registry_activation";
  if (!input.runtimeCapabilities.claimContract.serverKeyLifecycle.productionStable)
    return "wait_for_key_lifecycle_activation";
  if (!input.chainTrusted) return "wait_for_registry_finality";
  if (!input.serverKeyLifecycle.ready)
    return "wait_for_key_lifecycle_activation";
  return "ready";
}

async function loadExternalAppServerKeys(
  prisma: PrismaClient,
  externalAppId: string,
): Promise<ExternalAppServerKeyLifecycleRow[]> {
  const client = (prisma as any).externalAppServerKey;
  if (typeof client?.findMany !== "function") return [];
  const rows = await client.findMany({
    where: { externalAppId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      keyVersion: true,
      publicKey: true,
      status: true,
      validFrom: true,
      validUntil: true,
      graceUntil: true,
      revokedAt: true,
      rotationReceiptId: true,
    },
  });
  return Array.isArray(rows)
    ? rows.map((row) => ({
        keyVersion: String(row.keyVersion || ""),
        publicKey: String(row.publicKey || ""),
        status: String(row.status || ""),
        validFrom: row.validFrom ?? null,
        validUntil: row.validUntil ?? null,
        graceUntil: row.graceUntil ?? null,
        revokedAt: row.revokedAt ?? null,
        rotationReceiptId: row.rotationReceiptId ?? null,
      }))
    : [];
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function summarizeCapabilityPolicies(
  value: unknown,
): ExternalProgramCapabilitySummary {
  return {
    sourceMaterialSubmission: summarizeCapability(
      value,
      "sourceMaterialSubmission",
    ),
    knowledgeContext: summarizeCapability(value, "knowledgeContext"),
    voice: summarizeCapability(value, "voice"),
    transcriptRecap: summarizeCapability(value, "transcriptRecap"),
  };
}

function summarizeCapability(
  value: unknown,
  capability: string,
): "enabled" | "disabled" {
  const record = plainObject(value);
  const candidates = [record[capability], record[toSnakeCase(capability)]];
  for (const candidate of candidates) {
    if (candidate === false) return "disabled";
    if (typeof candidate === "string" && isDisabledCapabilityValue(candidate)) {
      return "disabled";
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const nested = candidate as Record<string, unknown>;
      if (nested.enabled === false) return "disabled";
      if (
        typeof nested.mode === "string" &&
        isDisabledCapabilityValue(nested.mode)
      ) {
        return "disabled";
      }
    }
  }
  return "enabled";
}

function toPublicProductionReview(
  review: ExternalAppProductionReviewProjection,
): ExternalProgramProductionReviewStatus {
  return {
    status: review.status,
    request: review.request
      ? {
          state: review.request.state,
          policyEpochId: review.request.policyEpochId,
          openedAt: review.request.openedAt,
          resolvedAt: review.request.resolvedAt,
          decision: review.request.decision,
          executionStatus: review.request.executionStatus,
          executionErrorCode: review.request.executionErrorCode,
        }
      : null,
  };
}

export function toPublicStabilityProjection(
  projection: ExternalAppStabilityProjectionView,
): ExternalProgramPublicStabilityProjection {
  return {
    registryStatus: projection.registryStatus,
    policyEpochId: projection.policyEpochId,
    challengeState: projection.challengeState,
    projectionStatus: projection.projectionStatus,
    publicLabels: projection.publicLabels,
    riskScore: projection.riskScore,
    trustScore: projection.trustScore,
    supportSignalLevel: projection.supportSignalLevel,
    supportIndependenceScore: projection.supportIndependenceScore,
    rollout: toPublicRollout(projection.rollout),
    ...(projection.bondState
      ? { bondState: toPublicBondState(projection.bondState) }
      : {}),
    ...(projection.bondDispositionState
      ? {
          bondDispositionState: toPublicBondDispositionState(
            projection.bondDispositionState,
          ),
        }
      : {}),
    ...(projection.governanceState
      ? { governanceState: projection.governanceState }
      : {}),
    ...(projection.updatedAt ? { updatedAt: projection.updatedAt } : {}),
  };
}

function toPublicRollout(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const { policyEpoch: _policyEpoch, ...publicRollout } = value;
  return publicRollout;
}

function toPublicBondState(
  state: NonNullable<ExternalAppStabilityProjectionView["bondState"]>,
): NonNullable<ExternalProgramPublicStabilityProjection["bondState"]> {
  return {
    ownerBonded: BigInt(String(state.ownerBondRaw || "0")) > 0n,
    activeChallengeBonded:
      BigInt(String(state.activeChallengeBondRaw || "0")) > 0n,
    activeChallengeCount: Number(state.activeChallengeCount || 0),
  };
}

function toPublicBondDispositionState(
  state: NonNullable<
    ExternalAppStabilityProjectionView["bondDispositionState"]
  >,
): NonNullable<
  ExternalProgramPublicStabilityProjection["bondDispositionState"]
> {
  return {
    state: String(state.state || "none"),
    activeCaseCount: Number(state.activeCaseCount || 0),
    riskDisclaimerAccepted: Boolean(state.riskDisclaimerAccepted),
    riskDisclaimerRequired: Boolean(state.riskDisclaimerRequired),
    hasActiveLockedAmount:
      BigInt(String(state.activeLockedAmountRaw || "0")) > 0n,
    hasRoutedAmount: BigInt(String(state.totalRoutedAmountRaw || "0")) > 0n,
  };
}

export function toPublicStoreProjection(
  projection: ReturnType<typeof buildExternalAppStoreProjection>,
): ExternalProgramPublicStoreProjection {
  return {
    listingState: projection.listingState,
    categoryTags: projection.categoryTags,
    rankingScore: projection.rankingOutput.score,
    rankingFallbackMode: projection.rankingOutput.fallbackMode,
    featuredState: projection.featuredState,
    continuityLabels: projection.continuityLabels,
    updatedAt: projection.updatedAt,
  };
}

function isDisabledCapabilityValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "disabled" || normalized === "off" || normalized === "false"
  );
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
