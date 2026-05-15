import { randomUUID } from "node:crypto";

export interface ExternalAppArbitrationReference {
  id: string;
  externalAppId: string;
  caseId: string;
  provider: string;
  externalReferenceId: string;
  status: "opened" | "decision_recorded" | "failed" | "superseded";
  receiptDigest: string;
  governanceExecutionReceiptId: string | null;
  createdAt: Date;
}

export function buildExternalAppArbitrationReference(input: {
  id?: string;
  externalAppId: string;
  caseId: string;
  provider: string;
  externalReferenceId: string;
  status?: ExternalAppArbitrationReference["status"];
  receiptDigest: string;
  governanceExecutionReceiptId?: string | null;
  createdAt?: Date;
}): ExternalAppArbitrationReference {
  const fallbackId =
    input.externalReferenceId.length > 0
      ? `${input.externalAppId}:${input.caseId}:${input.externalReferenceId}`
      : randomUUID();

  return {
    id: input.id ?? fallbackId,
    externalAppId: input.externalAppId,
    caseId: input.caseId,
    provider: input.provider,
    externalReferenceId: input.externalReferenceId,
    status: input.status ?? "opened",
    receiptDigest: input.receiptDigest,
    governanceExecutionReceiptId: input.governanceExecutionReceiptId ?? null,
    createdAt: input.createdAt ?? new Date(),
  };
}

export function assertArbitrationReferenceBoundToGovernance(input: {
  arbitrationReceiptDigest: string | null;
  governanceExecutionReceiptId: string | null;
}): void {
  if (!input.arbitrationReceiptDigest) {
    throw new Error("external_app_arbitration_receipt_required");
  }
  if (!input.governanceExecutionReceiptId) {
    throw new Error("external_app_arbitration_requires_governance_execution_receipt");
  }
}
