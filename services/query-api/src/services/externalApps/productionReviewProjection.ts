import type { PrismaClient } from "@prisma/client";

import { isExternalProgramErrorContractCode } from "./errorContract";

export interface ExternalAppProductionReviewProjection {
  status:
    | "not_requested"
    | "in_review"
    | "accepted_pending_execution"
    | "execution_failed"
    | "rejected"
    | "activated"
    | "disabled";
  request: {
    id: string;
    state: string;
    policyEpochId: string;
    policyId: string;
    policyVersion: number;
    openedAt: string | null;
    resolvedAt: string | null;
    decision: string | null;
    decisionDigest: string | null;
    executionStatus: string | null;
    executionErrorCode: string | null;
    executionReceiptId: string | null;
  } | null;
}

export async function getLatestExternalAppProductionReview(
  prisma: PrismaClient,
  externalAppId: string,
): Promise<ExternalAppProductionReviewProjection> {
  const client = (prisma as any).governanceRequest;
  if (typeof client?.findFirst !== "function") {
    return { status: "not_requested", request: null };
  }

  const request = await client.findFirst({
    where: {
      actionType: "external_app_register",
      targetType: "external_app",
      targetRef: externalAppId,
    },
    include: {
      decision: true,
      receipts: {
        orderBy: { executedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { openedAt: "desc" },
  });
  if (!request) return { status: "not_requested", request: null };

  const latestReceipt = Array.isArray(request.receipts)
    ? (request.receipts[0] ?? null)
    : null;
  const decision = request.decision ?? null;
  const status = deriveProductionReviewStatus({
    requestState: String(request.state || ""),
    decision: decision?.decision == null ? null : String(decision.decision),
    executionStatus:
      latestReceipt?.executionStatus == null
        ? null
        : String(latestReceipt.executionStatus),
  });

  return {
    status,
    request: {
      id: String(request.id),
      state: String(request.state || "active"),
      policyEpochId: String(request.policyVersionId || ""),
      policyId: String(request.policyId || ""),
      policyVersion: Number(request.policyVersion || 0),
      openedAt: toIsoOrNull(request.openedAt),
      resolvedAt: toIsoOrNull(request.resolvedAt),
      decision: decision?.decision == null ? null : String(decision.decision),
      decisionDigest:
        decision?.decisionDigest == null
          ? null
          : String(decision.decisionDigest),
      executionStatus:
        latestReceipt?.executionStatus == null
          ? null
          : String(latestReceipt.executionStatus),
      executionErrorCode:
        latestReceipt?.errorCode == null
          ? null
          : toPublicExecutionErrorCode(latestReceipt.errorCode),
      executionReceiptId:
        latestReceipt?.id == null ? null : String(latestReceipt.id),
    },
  };
}

function deriveProductionReviewStatus(input: {
  requestState: string;
  decision: string | null;
  executionStatus: string | null;
}): ExternalAppProductionReviewProjection["status"] {
  if (input.executionStatus === "executed") return "activated";
  if (input.executionStatus === "failed") return "execution_failed";
  if (input.executionStatus === "disabled") return "disabled";
  if (input.decision === "reject" || input.decision === "rejected")
    return "rejected";
  if (
    input.decision === "accept" ||
    input.decision === "accepted" ||
    input.requestState === "accepted"
  ) {
    return "accepted_pending_execution";
  }
  if (input.requestState === "rejected") return "rejected";
  if (input.requestState === "disabled") return "disabled";
  return "in_review";
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toPublicExecutionErrorCode(value: unknown): string {
  const raw = String(value || "").trim();
  const normalized = /^external_app_registry_signer_failed(?::\d+)?$/.test(raw)
    ? "external_app_registry_signer_failed"
    : raw;
  return isExternalProgramErrorContractCode(normalized)
    ? normalized
    : "external_app_execution_failed";
}
