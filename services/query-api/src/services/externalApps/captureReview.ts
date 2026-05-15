import { randomUUID } from "node:crypto";
import type { GovernanceActionType } from "../policy/types";

export interface ExternalAppReviewCaptureCase {
  id: string;
  externalAppId: string;
  openedByPubkey: string;
  evidenceDigest: string;
  status: "open" | "cleared" | "confirmed" | "corrected";
  openedAt: Date;
  resolvedAt: Date | null;
}

export interface ExternalAppProjectionDispute {
  id: string;
  externalAppId: string;
  openedByPubkey: string;
  projectionReceiptId: string;
  evidenceDigest: string;
  status: "open" | "reconciled" | "rejected" | "expired";
  openedAt: Date;
  resolvedAt: Date | null;
}

const PROJECTION_DISPUTE_BLOCKED_ACTIONS = new Set<GovernanceActionType>([
  "external_app_owner_bond_slash",
  "downgrade_discovery_status",
  "external_app_registry_revoke",
]);

const HIGH_IMPACT_ACTIONS = new Set<GovernanceActionType>([
  "external_app_bond_disposition_apply",
  "external_app_bond_routing_execute",
  "external_app_owner_bond_slash",
  "external_app_settlement_execute",
  "external_app_registry_revoke",
  "external_app_governance_role_binding_update",
]);

export function buildExternalAppReviewCaptureCase(input: {
  id?: string;
  externalAppId: string;
  openedByPubkey: string;
  evidenceDigest: string;
  status?: ExternalAppReviewCaptureCase["status"];
  openedAt?: Date;
  resolvedAt?: Date | null;
}): ExternalAppReviewCaptureCase {
  return {
    id: input.id ?? randomUUID(),
    externalAppId: input.externalAppId,
    openedByPubkey: input.openedByPubkey,
    evidenceDigest: input.evidenceDigest,
    status: input.status ?? "open",
    openedAt: input.openedAt ?? new Date(),
    resolvedAt: input.resolvedAt ?? null,
  };
}

export function buildExternalAppProjectionDispute(input: {
  id?: string;
  externalAppId: string;
  openedByPubkey: string;
  projectionReceiptId: string;
  evidenceDigest: string;
  status?: ExternalAppProjectionDispute["status"];
  openedAt?: Date;
  resolvedAt?: Date | null;
}): ExternalAppProjectionDispute {
  return {
    id: input.id ?? randomUUID(),
    externalAppId: input.externalAppId,
    openedByPubkey: input.openedByPubkey,
    projectionReceiptId: input.projectionReceiptId,
    evidenceDigest: input.evidenceDigest,
    status: input.status ?? "open",
    openedAt: input.openedAt ?? new Date(),
    resolvedAt: input.resolvedAt ?? null,
  };
}

export function assertExternalAppHighImpactActionAllowed(input: {
  actionType: GovernanceActionType;
  captureReviews: ExternalAppReviewCaptureCase[];
  projectionDisputes: ExternalAppProjectionDispute[];
}): void {
  if (
    HIGH_IMPACT_ACTIONS.has(input.actionType) &&
    input.captureReviews.some((review) => review.status === "open")
  ) {
    throw new Error("external_app_capture_review_open");
  }
  if (
    PROJECTION_DISPUTE_BLOCKED_ACTIONS.has(input.actionType) &&
    input.projectionDisputes.some((dispute) => dispute.status === "open")
  ) {
    throw new Error("external_app_projection_disputed");
  }
}

export function buildExternalAppGovernanceRiskState(input: {
  captureReviews?: Array<{ status: string }>;
  projectionDisputes?: Array<{ status: string }>;
  emergencyHolds?: Array<{ status: string; expiresAt?: Date | string | null }>;
}) {
  const captureReviewOpen = (input.captureReviews ?? []).some(
    (review) => review.status === "open",
  );
  const projectionDisputeOpen = (input.projectionDisputes ?? []).some(
    (dispute) => dispute.status === "open",
  );
  const emergencyHoldActive = (input.emergencyHolds ?? []).some((hold) => {
    if (hold.status !== "active") return false;
    if (!hold.expiresAt) return true;
    return new Date(hold.expiresAt).getTime() > Date.now();
  });
  const labels: string[] = [];
  if (captureReviewOpen) labels.push("Capture review");
  if (projectionDisputeOpen) labels.push("Projection disputed");
  if (emergencyHoldActive) labels.push("Scoped emergency hold");
  return {
    captureReviewStatus: captureReviewOpen ? "open" : "none",
    projectionDisputeStatus: projectionDisputeOpen ? "open" : "none",
    emergencyHoldStatus: emergencyHoldActive ? "active" : "none",
    highImpactActionsPaused: captureReviewOpen || projectionDisputeOpen,
    labels,
  };
}
