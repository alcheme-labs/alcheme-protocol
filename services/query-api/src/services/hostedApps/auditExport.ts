import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";

export const LEGACY_UNBOUND_AUDIT_EXPORT_RELEASE_ID = "legacy-unbound";

export interface HostedAppAuditExportInput {
  appId: string;
  releaseId: string;
  proposalReceipts?: string[];
  voteReceiptDigests?: string[];
  governanceReceiptDigests?: string[];
  runtimeAttestationDigests?: string[];
  accessReceiptDigests?: string[];
  actionReceiptDigests?: string[];
  grantCredentialDigests?: string[];
  paymentCredentialDigests?: string[];
  publishCredentialDigests?: string[];
  revocationRefs?: string[];
  issuerChangeDigests?: string[];
  schemaChangeDigests?: string[];
  externalExecutionReceiptDigests?: string[];
  chainAnchorRefs?: string[];
  requireChainAnchorRefs?: boolean;
  redactionPolicyRef: string;
}

export function buildHostedAppAuditExportBundle(
  input: HostedAppAuditExportInput,
) {
  assertHostedAppAuditExportReleaseBound(input.releaseId);
  const chainAnchorRefs = normalizeRefs(input.chainAnchorRefs);
  if (input.requireChainAnchorRefs === true && chainAnchorRefs.length === 0) {
    throw new Error("hosted_app_audit_export_chain_anchor_required");
  }
  const bundle = {
    bundleId: randomUUID(),
    bundleType: "hosted_app_audit_export",
    appId: input.appId,
    releaseId: input.releaseId,
    proposalReceipts: normalizeRefs(input.proposalReceipts),
    voteReceiptDigests: normalizeRefs(input.voteReceiptDigests),
    governanceReceiptDigests: normalizeRefs(input.governanceReceiptDigests),
    runtimeAttestationDigests: normalizeRefs(input.runtimeAttestationDigests),
    accessReceiptDigests: normalizeRefs(input.accessReceiptDigests),
    actionReceiptDigests: normalizeRefs(input.actionReceiptDigests),
    grantCredentialDigests: normalizeRefs(input.grantCredentialDigests),
    paymentCredentialDigests: normalizeRefs(input.paymentCredentialDigests),
    publishCredentialDigests: normalizeRefs(input.publishCredentialDigests),
    revocationRefs: normalizeRefs(input.revocationRefs),
    issuerChangeDigests: normalizeRefs(input.issuerChangeDigests),
    schemaChangeDigests: normalizeRefs(input.schemaChangeDigests),
    externalExecutionReceiptDigests: normalizeRefs(
      input.externalExecutionReceiptDigests,
    ),
    chainAnchorRefs,
    redactionPolicyRef: input.redactionPolicyRef,
    exportProfile: "digest_refs_only",
    exportedAt: new Date().toISOString(),
  };
  return { ...bundle, bundleDigest: digestJson(bundle) };
}

export function assertHostedAppAuditExportReleaseBound(
  releaseId: string,
): void {
  if (
    !releaseId.trim() ||
    releaseId === LEGACY_UNBOUND_AUDIT_EXPORT_RELEASE_ID
  ) {
    throw new Error("hosted_app_audit_export_release_unbound");
  }
}

function normalizeRefs(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}
