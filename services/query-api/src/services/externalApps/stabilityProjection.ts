import { computeBackingLevel, computeChallengePressure } from "./backing";
import { summarizeBondDispositionState } from "./bondDisposition";
import { buildExternalAppGovernanceRiskState } from "./captureReview";
import { computeExternalAppStabilityScores } from "./formulaEngine";
import { computeGreyRolloutExposure } from "./greyRollout";
import type {
  ExternalAppChallengeState,
  ExternalAppProjectionStatus,
  ExternalAppPublicLabel,
  ExternalAppStabilityProjectionView,
} from "./stabilityTypes";

export interface ExternalAppProjectionAppLike {
  id: string;
  name?: string | null;
  status?: string | null;
  registryStatus: string;
  discoveryStatus?: string | null;
  riskScore?: string | number | null;
  trustScore?: string | number | null;
  communityBackingLevel?: string | number | null;
  ownerBond?: string | number | null;
  updatedAt?: Date | string | null;
}

export interface ExternalAppProjectionPolicyEpochLike {
  id: string;
  epochKey: string;
  rolloutSalt?: string | null;
  exposureBasisPoints?: number | null;
  parameterBounds?: Record<string, unknown> | null;
}

export interface ExternalAppProjectionRegistryAnchorLike {
  registryStatus: string;
  finalityStatus: string;
  receiptFinalityStatus: string;
}

export function buildExternalAppStabilityProjection(input: {
  app: ExternalAppProjectionAppLike;
  policyEpoch?: ExternalAppProjectionPolicyEpochLike | null;
  registryAnchor?: ExternalAppProjectionRegistryAnchorLike | null;
  backings?: Array<{ amountRaw: string | number; status?: string | null }>;
  challenges?: Array<{ status: string; amountRaw?: string | number | null }>;
  ownerBondVaults?: Array<{ status: string; ownerBondRaw?: string | number | null }>;
  challengeCases?: Array<{ status: string; challengeBondRaw?: string | number | null }>;
  bondDispositionCases?: Array<{
    status: string;
    lockedAmountRaw?: string | number | null;
    routedAmountRaw?: string | number | null;
  }>;
  captureReviews?: Array<{ status: string }>;
  projectionDisputes?: Array<{ status: string }>;
  emergencyHolds?: Array<{ status: string; expiresAt?: Date | string | null }>;
  riskDisclaimerAccepted?: boolean;
  riskSignals?: Array<{ severity: number; source?: string | null }>;
  viewerCohort?: string;
  previousProjection?: { riskScore?: number | null; trustScore?: number | null } | null;
}): ExternalAppStabilityProjectionView {
  const policyEpoch = input.policyEpoch ?? defaultPolicyEpoch();
  const activeBackings = (input.backings ?? []).filter(
    (backing) => !backing.status || backing.status === "active",
  );
  const supportSignalLevel = computeBackingLevel(
    activeBackings.map((backing) => String(backing.amountRaw)),
  );
  const openChallengeAmount = (input.challenges ?? [])
    .filter((challenge) => challenge.status !== "resolved")
    .reduce((sum, challenge) => sum + Math.max(0, Number(challenge.amountRaw ?? 0)), 0);
  const challengePressure = computeChallengePressure({
    backingRaw: String(supportSignalLevel),
    challengeRaw: String(openChallengeAmount),
  });
  const challengeState = deriveChallengeState(input.challenges ?? []);
  const projectionStatus = deriveProjectionStatus({
    challengeState,
    app: input.app,
    registryAnchor: input.registryAnchor ?? null,
  });
  const formula = computeExternalAppStabilityScores({
    baselineRiskScore: numberOr(input.app.riskScore, 20),
    previousRiskScore: input.previousProjection?.riskScore ?? numberOr(input.app.riskScore, 20),
    previousTrustScore:
      input.previousProjection?.trustScore ?? numberOr(input.app.trustScore, 80),
    riskSignals: (input.riskSignals ?? []).map((signal) => ({
      severity: signal.severity,
      weight: 1,
    })),
    challengePressure,
    supportSignalLevel: Math.min(100, supportSignalLevel),
    supportIndependenceScore: activeBackings.length > 0 ? 0.8 : 0,
    elapsedPeriods: 6,
    bounds: normalizeFormulaBounds(policyEpoch.parameterBounds),
  });
  const rollout = computeGreyRolloutExposure({
    appId: input.app.id,
    viewerCohort: input.viewerCohort ?? "public",
    policyEpoch: policyEpoch.epochKey,
    rolloutSalt: policyEpoch.rolloutSalt ?? "v3a",
    exposureBasisPoints: policyEpoch.exposureBasisPoints ?? 10_000,
  });
  const publicLabels = derivePublicLabels({
    challengeState,
    projectionStatus,
    riskScore: formula.outputs.riskScore,
    ownerBond: sumActiveOwnerBond(input.ownerBondVaults ?? [], input.app.ownerBond),
    rollout,
  });
  const bondState = buildBondState({
    ownerBondVaults: input.ownerBondVaults ?? [],
    challengeCases: input.challengeCases ?? [],
    fallbackOwnerBond: input.app.ownerBond,
  });
  const shouldIncludeBondDispositionState =
    input.bondDispositionCases !== undefined || input.riskDisclaimerAccepted !== undefined;
  const bondDispositionState = shouldIncludeBondDispositionState
    ? summarizeBondDispositionState({
        cases: input.bondDispositionCases ?? [],
        riskDisclaimerAccepted: input.riskDisclaimerAccepted ?? false,
      })
    : undefined;
  const shouldIncludeGovernanceState =
    input.captureReviews !== undefined ||
    input.projectionDisputes !== undefined ||
    input.emergencyHolds !== undefined;
  const governanceState = shouldIncludeGovernanceState
    ? buildExternalAppGovernanceRiskState({
        captureReviews: input.captureReviews ?? [],
        projectionDisputes: input.projectionDisputes ?? [],
        emergencyHolds: input.emergencyHolds ?? [],
      })
    : undefined;

  return {
    registryStatus: input.app.registryStatus,
    policyEpochId: policyEpoch.id,
    challengeState,
    projectionStatus,
    publicLabels: [
      ...publicLabels,
      ...(governanceState?.labels ?? []).map(normalizeGovernanceLabel),
    ] as ExternalAppPublicLabel[],
    riskScore: formula.outputs.riskScore,
    trustScore: formula.outputs.trustScore,
    supportSignalLevel,
    supportIndependenceScore: activeBackings.length > 0 ? 0.8 : 0,
    rollout,
    formulaInputs: formula.inputs,
    formulaOutputs: formula.outputs,
    statusProvenance: {
      registryStatus: {
        source: "external_apps",
        value: input.app.registryStatus,
      },
      registryAnchor: input.registryAnchor
        ? {
            source: "registry_anchor",
            registryStatus: input.registryAnchor.registryStatus,
            finalityStatus: input.registryAnchor.finalityStatus,
            receiptFinalityStatus: input.registryAnchor.receiptFinalityStatus,
          }
        : null,
      projection: { source: "computed_fallback", parserVersion: "v3a.1" },
      bondState: { source: "external_app_v3b_projection", parserVersion: "v3b.1" },
      ...(bondDispositionState
        ? {
            bondDispositionState: {
              source: "external_app_v3c_projection",
              parserVersion: "v3c.1",
            },
          }
        : {}),
      ...(governanceState
        ? {
            governanceState: {
              source: "external_app_v3d_projection",
              parserVersion: "v3d.1",
            },
          }
        : {}),
    },
    bondState,
    bondDispositionState,
    governanceState,
    updatedAt: toIso(input.app.updatedAt),
  };
}

export function mapStoredStabilityProjection(record: {
  policyEpochId: string;
  challengeState: string;
  projectionStatus: string;
  publicLabels?: unknown;
  riskScore: number;
  trustScore: number;
  supportSignalLevel: number;
  supportIndependenceScore: number;
  rollout?: unknown;
  formulaInputs?: unknown;
  formulaOutputs?: unknown;
  statusProvenance?: unknown;
  bondState?: unknown;
  bondDispositionState?: unknown;
  governanceState?: unknown;
  updatedAt?: Date | string | null;
}): ExternalAppStabilityProjectionView {
  return {
    policyEpochId: record.policyEpochId,
    challengeState: record.challengeState as ExternalAppChallengeState,
    projectionStatus: record.projectionStatus as ExternalAppProjectionStatus,
    publicLabels: asStringArray(record.publicLabels) as ExternalAppPublicLabel[],
    riskScore: record.riskScore,
    trustScore: record.trustScore,
    supportSignalLevel: record.supportSignalLevel,
    supportIndependenceScore: record.supportIndependenceScore,
    rollout: asRecord(record.rollout),
    formulaInputs: asRecord(record.formulaInputs),
    formulaOutputs: asRecord(record.formulaOutputs),
    statusProvenance: asRecord(record.statusProvenance),
    bondState: asBondState(record.bondState),
    bondDispositionState: asBondDispositionState(record.bondDispositionState),
    governanceState: asGovernanceState(record.governanceState),
    updatedAt: toIso(record.updatedAt),
  };
}

function deriveChallengeState(
  challenges: Array<{ status: string }>,
): ExternalAppChallengeState {
  if (challenges.some((challenge) => ["disputed", "dispute"].includes(challenge.status))) {
    return "dispute";
  }
  if (challenges.some((challenge) => ["open", "review"].includes(challenge.status))) {
    return "review";
  }
  if (challenges.some((challenge) => challenge.status === "public_watch")) {
    return "public_watch";
  }
  if (challenges.some((challenge) => challenge.status === "private_watch")) {
    return "private_watch";
  }
  if (challenges.some((challenge) => challenge.status === "resolved")) {
    return "resolved";
  }
  return "none";
}

function deriveProjectionStatus(input: {
  challengeState: ExternalAppChallengeState;
  app: ExternalAppProjectionAppLike;
  registryAnchor: ExternalAppProjectionRegistryAnchorLike | null;
}): ExternalAppProjectionStatus {
  if (input.challengeState === "dispute") return "projection_disputed";
  if (input.app.status === "manual_freeze") return "manual_freeze";
  if (
    input.registryAnchor &&
    (input.registryAnchor.registryStatus !== input.app.registryStatus ||
      input.registryAnchor.finalityStatus !== "confirmed" ||
      input.registryAnchor.receiptFinalityStatus !== "confirmed")
  ) {
    return "status_sync_pending";
  }
  return "normal";
}

function derivePublicLabels(input: {
  challengeState: ExternalAppChallengeState;
  projectionStatus: ExternalAppProjectionStatus;
  riskScore: number;
  ownerBond?: string | number | null;
  rollout: { exposed: boolean; exposureBasisPoints: number };
}): ExternalAppPublicLabel[] {
  const labels: ExternalAppPublicLabel[] = [];
  if (Number(input.ownerBond ?? 0) > 0) labels.push("Owner Bonded");
  if (input.riskScore >= 60) labels.push("Risk Notice");
  if (input.challengeState === "review") labels.push("Under Review");
  if (input.challengeState === "dispute") labels.push("Under Challenge");
  if (!input.rollout.exposed || input.rollout.exposureBasisPoints < 10_000) {
    labels.push("Limited Rollout");
  }
  return labels;
}

function normalizeGovernanceLabel(value: string): ExternalAppPublicLabel {
  switch (value) {
    case "Capture review":
      return "Capture Review";
    case "Projection disputed":
      return "Projection Disputed";
    case "Scoped emergency hold":
      return "Scoped Emergency Hold";
    default:
      return value as ExternalAppPublicLabel;
  }
}

function defaultPolicyEpoch(): ExternalAppProjectionPolicyEpochLike {
  return {
    id: "v3a-fallback",
    epochKey: "v3a-fallback",
    rolloutSalt: "fallback",
    exposureBasisPoints: 10_000,
  };
}

function normalizeFormulaBounds(value: Record<string, unknown> | null | undefined) {
  return value && typeof value === "object" ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function buildBondState(input: {
  ownerBondVaults: Array<{ status: string; ownerBondRaw?: string | number | null }>;
  challengeCases: Array<{ status: string; challengeBondRaw?: string | number | null }>;
  fallbackOwnerBond?: string | number | null;
}) {
  const ownerBondRaw = sumActiveOwnerBond(input.ownerBondVaults, input.fallbackOwnerBond);
  const activeChallengeCases = input.challengeCases.filter((challenge) =>
    ["open", "responded", "appeal_window", "ruled"].includes(challenge.status),
  );
  return {
    ownerBondRaw,
    activeChallengeBondRaw: sumRaw(
      activeChallengeCases.map((challenge) => challenge.challengeBondRaw ?? "0"),
    ),
    activeChallengeCount: activeChallengeCases.length,
  };
}

function sumActiveOwnerBond(
  ownerBondVaults: Array<{ status: string; ownerBondRaw?: string | number | null }>,
  fallbackOwnerBond?: string | number | null,
): string {
  if (ownerBondVaults.length === 0) return normalizeRaw(fallbackOwnerBond ?? "0");
  return sumRaw(
    ownerBondVaults
      .filter((vault) => ["open", "withdrawal_requested"].includes(vault.status))
      .map((vault) => vault.ownerBondRaw ?? "0"),
  );
}

function sumRaw(values: Array<string | number | null | undefined>): string {
  return values.reduce((sum, value) => sum + BigInt(normalizeRaw(value ?? "0")), 0n).toString();
}

function normalizeRaw(value: string | number | null | undefined): string {
  const normalized = String(value ?? "0").trim();
  return /^[0-9]+$/.test(normalized) ? normalized : "0";
}

function asBondState(value: unknown): ExternalAppStabilityProjectionView["bondState"] {
  const record = asRecord(value);
  if (!record.ownerBondRaw && !record.activeChallengeBondRaw && !record.activeChallengeCount) {
    return undefined;
  }
  return {
    ownerBondRaw: normalizeRaw(record.ownerBondRaw as string | number | null | undefined),
    activeChallengeBondRaw: normalizeRaw(
      record.activeChallengeBondRaw as string | number | null | undefined,
    ),
    activeChallengeCount: Math.max(0, Number(record.activeChallengeCount ?? 0)),
  };
}

function asBondDispositionState(
  value: unknown,
): ExternalAppStabilityProjectionView["bondDispositionState"] {
  const record = asRecord(value);
  if (
    !record.state &&
    !record.activeLockedAmountRaw &&
    !record.totalRoutedAmountRaw &&
    !record.activeCaseCount
  ) {
    return undefined;
  }
  return {
    state: typeof record.state === "string" ? record.state : "none",
    activeLockedAmountRaw: normalizeRaw(
      record.activeLockedAmountRaw as string | number | null | undefined,
    ),
    totalRoutedAmountRaw: normalizeRaw(
      record.totalRoutedAmountRaw as string | number | null | undefined,
    ),
    activeCaseCount: Math.max(0, Number(record.activeCaseCount ?? 0)),
    riskDisclaimerAccepted: Boolean(record.riskDisclaimerAccepted),
    riskDisclaimerRequired: record.riskDisclaimerRequired !== false,
  };
}

function asGovernanceState(
  value: unknown,
): ExternalAppStabilityProjectionView["governanceState"] {
  const record = asRecord(value);
  if (
    !record.captureReviewStatus &&
    !record.projectionDisputeStatus &&
    !record.emergencyHoldStatus &&
    !record.highImpactActionsPaused &&
    !record.labels
  ) {
    return undefined;
  }
  return {
    captureReviewStatus:
      typeof record.captureReviewStatus === "string"
        ? record.captureReviewStatus
        : "none",
    projectionDisputeStatus:
      typeof record.projectionDisputeStatus === "string"
        ? record.projectionDisputeStatus
        : "none",
    emergencyHoldStatus:
      typeof record.emergencyHoldStatus === "string" ? record.emergencyHoldStatus : "none",
    highImpactActionsPaused: Boolean(record.highImpactActionsPaused),
    labels: asStringArray(record.labels),
  };
}
