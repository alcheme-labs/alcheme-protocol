export const EXTERNAL_APP_CHALLENGE_STATES = [
  "none",
  "private_watch",
  "public_watch",
  "review",
  "dispute",
  "resolved",
] as const;

export type ExternalAppChallengeState =
  (typeof EXTERNAL_APP_CHALLENGE_STATES)[number];

export const EXTERNAL_APP_PROJECTION_STATUSES = [
  "normal",
  "status_sync_pending",
  "projection_disputed",
  "manual_freeze",
] as const;

export type ExternalAppProjectionStatus =
  (typeof EXTERNAL_APP_PROJECTION_STATUSES)[number];

export const EXTERNAL_APP_PUBLIC_LABELS = [
  "Owner Bonded",
  "Risk Notice",
  "Under Review",
  "Under Challenge",
  "Limited Rollout",
  "Capture Review",
  "Projection Disputed",
  "Scoped Emergency Hold",
] as const;

export type ExternalAppPublicLabel = (typeof EXTERNAL_APP_PUBLIC_LABELS)[number];

export const EXTERNAL_APP_POLICY_EPOCH_STATUSES = [
  "draft",
  "active",
  "superseded",
  "frozen",
] as const;

export type ExternalAppPolicyEpochStatus =
  (typeof EXTERNAL_APP_POLICY_EPOCH_STATUSES)[number];

export const EXTERNAL_APP_PROVENANCE_SOURCES = [
  "external_apps",
  "registry_anchor",
  "stability_projection",
  "computed_fallback",
  "policy_epoch",
] as const;

export type ExternalAppProvenanceSource =
  (typeof EXTERNAL_APP_PROVENANCE_SOURCES)[number];

export interface ExternalAppStabilityProjectionView {
  policyEpochId: string;
  challengeState: ExternalAppChallengeState;
  projectionStatus: ExternalAppProjectionStatus;
  publicLabels: ExternalAppPublicLabel[];
  riskScore: number;
  trustScore: number;
  supportSignalLevel: number;
  supportIndependenceScore: number;
  rollout: Record<string, unknown>;
  formulaInputs: Record<string, unknown>;
  formulaOutputs: Record<string, unknown>;
  statusProvenance: Record<string, unknown>;
  updatedAt?: string;
  registryStatus?: string;
  bondState?: {
    ownerBondRaw: string;
    activeChallengeBondRaw: string;
    activeChallengeCount: number;
  };
  bondDispositionState?: {
    state: string;
    activeLockedAmountRaw: string;
    totalRoutedAmountRaw: string;
    activeCaseCount: number;
    riskDisclaimerAccepted: boolean;
    riskDisclaimerRequired: boolean;
  };
  governanceState?: {
    captureReviewStatus: string;
    projectionDisputeStatus: string;
    emergencyHoldStatus: string;
    highImpactActionsPaused: boolean;
    labels: string[];
  };
}
