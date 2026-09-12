export type ExternalAppEmergencyActionType =
  | "capability_limit"
  | "managed_node_throttle"
  | "managed_node_hold"
  | "store_limited"
  | "economic_exposure_pause"
  | "external_route_warning"
  | "registry_suspended"
  | "registry_revoked";

export type ExternalAppEmergencyActionScope =
  | "capability"
  | "official_managed_node"
  | "app_store"
  | "economic_exposure"
  | "external_route"
  | "registry";

export interface ExternalAppEmergencyActionInput {
  externalAppId: string;
  actionType: ExternalAppEmergencyActionType;
  actionScope: ExternalAppEmergencyActionScope;
  affectedCapabilities: string[];
  operatorIdentity: string;
  evidenceDigest: string;
  startsAt: Date;
  expiresAt: Date;
  existingSessionEffect: string;
  ownerNoticeStatus: "sent" | "delayed_with_reason" | "not_required";
  appealRoute: string;
  sourceReceiptId: string;
  finalAdjudication?: boolean;
  machineVerifiableSevereViolation?: boolean;
}

const MAX_DURATION_MS: Record<ExternalAppEmergencyActionType, number> = {
  capability_limit: 24 * 60 * 60 * 1000,
  managed_node_throttle: 24 * 60 * 60 * 1000,
  managed_node_hold: 48 * 60 * 60 * 1000,
  store_limited: 72 * 60 * 60 * 1000,
  economic_exposure_pause: 72 * 60 * 60 * 1000,
  external_route_warning: 72 * 60 * 60 * 1000,
  registry_suspended: 7 * 24 * 60 * 60 * 1000,
  registry_revoked: Number.MAX_SAFE_INTEGER,
};

const ACTION_PRIORITY: ExternalAppEmergencyActionType[] = [
  "capability_limit",
  "managed_node_throttle",
  "managed_node_hold",
  "store_limited",
  "economic_exposure_pause",
  "external_route_warning",
  "registry_suspended",
  "registry_revoked",
];

export function emergencyActionPriority(actionType: ExternalAppEmergencyActionType): number {
  return ACTION_PRIORITY.indexOf(actionType);
}

export function buildExternalAppEmergencyActionReceipt(
  input: ExternalAppEmergencyActionInput,
) {
  assertExternalAppEmergencyActionAllowed(input);
  return {
    id: `${input.externalAppId}:${input.actionType}:${input.startsAt.toISOString()}`,
    ...input,
  };
}

export function assertExternalAppEmergencyActionAllowed(
  input: ExternalAppEmergencyActionInput,
): void {
  requireNonEmpty(input.externalAppId, "external_app_emergency_app_id_required");
  requireNonEmpty(input.operatorIdentity, "external_app_emergency_operator_required");
  requireNonEmpty(input.evidenceDigest, "external_app_emergency_evidence_required");
  requireNonEmpty(input.existingSessionEffect, "external_app_emergency_session_effect_required");
  requireNonEmpty(input.sourceReceiptId, "external_app_emergency_source_receipt_required");
  if (input.affectedCapabilities.length === 0 && input.actionScope === "capability") {
    throw new Error("external_app_emergency_capability_required");
  }
  if (!input.appealRoute) {
    throw new Error("external_app_emergency_appeal_route_required");
  }
  if (input.ownerNoticeStatus === "not_required") {
    throw new Error("external_app_emergency_owner_notice_required");
  }
  const duration = input.expiresAt.getTime() - input.startsAt.getTime();
  if (duration <= 0) {
    throw new Error("external_app_emergency_expiry_required");
  }
  if (duration > MAX_DURATION_MS[input.actionType]) {
    throw new Error("external_app_emergency_duration_exceeds_limit");
  }
  if (
    input.actionType === "registry_revoked" &&
    !input.finalAdjudication &&
    !input.machineVerifiableSevereViolation
  ) {
    throw new Error("external_app_registry_revoke_requires_final_or_machine_verifiable");
  }
}

function requireNonEmpty(value: unknown, errorCode: string): void {
  if (String(value || "").trim().length === 0) {
    throw new Error(errorCode);
  }
}
