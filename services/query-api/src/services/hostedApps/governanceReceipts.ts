import { randomUUID } from "node:crypto";

import { buildCredentialEnvelope } from "../appTrustRoot/credentialEnvelope";
import type { HostedAppProductionCredentialContext } from "./credentialRegistry";
import {
  signProductionCredentialEnvelope,
  type ProductionSignedCredential,
} from "./credentialLayer";
import { digestJson } from "./digest";

export function buildGovernanceDecisionReceipt(input: {
  receiptIssuer: string;
  issuerProof: string;
  operationId: string;
  operationVersion: string;
  payloadDigest: string;
  replayDomain: string;
  executionNonce: string;
  verifierPolicyVersion: string;
  decision: "approved" | "denied";
  committeePolicyRef: string;
  approverPolicyRef: string;
  quorumResult: { required: number; actual: number };
  thresholdResult: { required: number; actual: number };
  timelockStatus: { satisfied: boolean };
  executionMode: string;
  executionTargetRef: string;
  validFrom: string;
  expiresAt: string;
  statePreconditionDigest: string;
  vetoStatus?: { satisfied: boolean } | null;
  revocationRef?: string | null;
}) {
  const statePreconditionDigest = String(input.statePreconditionDigest || "").trim();
  if (!statePreconditionDigest) {
    throw new Error("hosted_app_governance_state_precondition_required");
  }
  const base = {
    receiptId: randomUUID(),
    receiptType: "hosted_app_governance_decision",
    ...input,
    statePreconditionDigest,
    vetoStatus: input.vetoStatus ?? null,
    revocationRef: input.revocationRef ?? null,
  };
  const governanceReceiptDigest = digestJson(base);
  const credentialEnvelope = buildCredentialEnvelope({
    credentialType: "GovernanceDecisionReceipt",
    issuerRef: input.receiptIssuer,
    subjectRef: `${input.operationId}:${input.executionNonce}`,
    audienceRef: input.executionTargetRef,
    scopeRef: input.committeePolicyRef,
    replayDomain: input.replayDomain,
    nonce: input.executionNonce,
    payloadDigest: governanceReceiptDigest,
    schemaRef: `governance_decision.${input.operationVersion}`,
    verifierPolicyRef: input.verifierPolicyVersion,
    validFrom: input.validFrom,
    expiresAt: input.expiresAt,
    revocationRef: input.revocationRef ?? null,
  });
  return {
    ...base,
    governanceReceiptDigest,
    credentialEnvelope,
    receiptSignature: digestJson({
      receiptIssuer: input.receiptIssuer,
      issuerProof: input.issuerProof,
      governanceReceiptDigest,
      credentialEnvelopeDigest: credentialEnvelope.envelopeDigest,
    }),
  };
}

export async function issueProductionGovernanceDecisionReceipt(
  context: HostedAppProductionCredentialContext,
  input: Omit<
    Parameters<typeof buildGovernanceDecisionReceipt>[0],
    "receiptIssuer" | "issuerProof" | "verifierPolicyVersion" | "revocationRef"
  > & {
    issuerProof?: string;
    verifierPolicyVersion?: string;
  },
): Promise<ReturnType<typeof buildGovernanceDecisionReceipt> & {
  credential: ProductionSignedCredential;
  credentialJws: string;
}> {
  if (context.schemaRef !== `governance_decision.${input.operationVersion}`) {
    throw new Error("hosted_app_credential_schema_context_mismatch");
  }
  if (context.verifierPolicyRef !== (input.verifierPolicyVersion ?? context.verifierPolicyRef)) {
    throw new Error("hosted_app_verifier_policy_context_mismatch");
  }
  const receipt = buildGovernanceDecisionReceipt({
    ...input,
    receiptIssuer: context.issuerRef,
    issuerProof: input.issuerProof ?? context.issuerKeySetDigest,
    verifierPolicyVersion: context.verifierPolicyRef,
    revocationRef: context.revocationRef,
  });
  const credential = await signProductionCredentialEnvelope(context, receipt.credentialEnvelope);
  return {
    ...receipt,
    credentialEnvelope: credential.envelope,
    receiptSignature: credential.jws,
    credential,
    credentialJws: credential.jws,
  };
}

export function assertGovernanceDecisionCanExecute(input: {
  receipt: {
    decision: string;
    validFrom: string;
    expiresAt: string;
    executionNonce: string;
    payloadDigest: string;
    executionTargetRef: string;
  };
  request: {
    payloadDigest: string;
    executionTargetRef: string;
  };
  consumedNonces: string[];
  now: string;
}): void {
  if (input.receipt.decision !== "approved") {
    throw new Error("hosted_app_governance_receipt_not_approved");
  }
  if (Date.parse(input.receipt.validFrom) > Date.parse(input.now)) {
    throw new Error("hosted_app_governance_receipt_not_yet_valid");
  }
  if (Date.parse(input.receipt.expiresAt) <= Date.parse(input.now)) {
    throw new Error("hosted_app_governance_receipt_expired");
  }
  if (input.consumedNonces.includes(input.receipt.executionNonce)) {
    throw new Error("hosted_app_governance_receipt_replayed");
  }
  if (input.receipt.payloadDigest !== input.request.payloadDigest) {
    throw new Error("hosted_app_governance_receipt_payload_mismatch");
  }
  if (input.receipt.executionTargetRef !== input.request.executionTargetRef) {
    throw new Error("hosted_app_governance_receipt_target_mismatch");
  }
}
