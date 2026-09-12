import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";

export type HostedAppCapabilityChangeType =
  | "add"
  | "add_version"
  | "enable"
  | "disable"
  | "suspend"
  | "change_data_shape"
  | "emergency_disable"
  | "risk_reclassify";

export function assertCapabilityChangeAllowed(input: {
  changeType: HostedAppCapabilityChangeType;
  previousReturnedFields: string[];
  nextReturnedFields: string[];
  governanceApproved?: boolean;
  riskLevelReduced?: boolean;
  addsSigningPaymentOrWrite?: boolean;
  reducesTimelock?: boolean;
  publishedVersionChanged?: boolean;
}): void {
  const expandsReturnedFields = input.nextReturnedFields.some(
    (field) => !input.previousReturnedFields.includes(field),
  );
  if (input.changeType === "emergency_disable" && expandsReturnedFields) {
    throw new Error("hosted_app_capability_emergency_change_must_shrink");
  }
  if (
    (expandsReturnedFields ||
      input.riskLevelReduced ||
      input.addsSigningPaymentOrWrite ||
      input.reducesTimelock) &&
    !input.governanceApproved
  ) {
    throw new Error("hosted_app_capability_governance_required");
  }
  if (input.publishedVersionChanged) {
    throw new Error("hosted_app_capability_version_immutable");
  }
}

export function buildCapabilityChangeReceipt(input: {
  capabilityId: string;
  changeType: HostedAppCapabilityChangeType | string;
  previousVersion?: string | null;
  nextVersion: string;
  before: unknown;
  after: unknown;
  changedByRef: string;
  approvalReceiptRef?: string | null;
  timelockUntil?: string | null;
  chainAnchorRef?: string | null;
  affectedApps?: string[];
  emergencyShrinkOnly: boolean;
}) {
  const beforeDigest = digestJson(input.before);
  const afterDigest = digestJson(input.after);
  const base = {
    receiptId: randomUUID(),
    capabilityId: input.capabilityId,
    changeType: input.changeType,
    previousVersion: input.previousVersion ?? null,
    nextVersion: input.nextVersion,
    beforeDigest,
    afterDigest,
    changedByRef: input.changedByRef,
    approvalReceiptRef: input.approvalReceiptRef ?? null,
    timelockUntil: input.timelockUntil ?? null,
    chainAnchorRef: input.chainAnchorRef ?? null,
    affectedApps: input.affectedApps ?? [],
    emergencyShrinkOnly: input.emergencyShrinkOnly,
  };
  return { ...base, receiptDigest: digestJson(base) };
}
