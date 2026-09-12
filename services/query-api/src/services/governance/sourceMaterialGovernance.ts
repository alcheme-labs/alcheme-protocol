import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { createGovernedActionRegistry } from "./actionRegistry";
import { GovernedActionGateway } from "./governedActionGateway";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "./circleGovernanceBindings";
import { createPrismaGovernanceRequestStore } from "./policyEngine";
import { normalizeSourceMaterialLifecycleStatus } from "../sourceMaterials/lifecycle";
import { publishSourceMaterialAcceptedSystemNotice } from "../../services/discussion/systemNoticeProducer";
import { markCircleTopicProfileDirty } from "../discussion/analysis/invalidation";
import { withdrawKnowledgePublicationsUsingSourceMaterial } from "../knowledgePublicationLicense";

export const SOURCE_MATERIAL_SUBMIT_ACTION_TYPE = "source_material.submit";
export const SOURCE_MATERIAL_ACCEPT_ACTION_TYPE = "source_material.accept";
export const SOURCE_MATERIAL_REJECT_ACTION_TYPE = "source_material.reject";
export const SOURCE_MATERIAL_REDACT_ACTION_TYPE = "source_material.redact";
export const SOURCE_MATERIAL_REVOKE_ACTION_TYPE = "source_material.revoke";

export function sourceMaterialActionTypeForLifecycleStatus(status: string): string {
  if (status === "accepted_to_plaza") return SOURCE_MATERIAL_ACCEPT_ACTION_TYPE;
  if (status === "rejected") return SOURCE_MATERIAL_REJECT_ACTION_TYPE;
  if (status === "redacted") return SOURCE_MATERIAL_REDACT_ACTION_TYPE;
  if (status === "revoked") return SOURCE_MATERIAL_REVOKE_ACTION_TYPE;
  return SOURCE_MATERIAL_SUBMIT_ACTION_TYPE;
}

export function shouldGovernSourceMaterialLifecycle(status: string): boolean {
  return (
    status === "accepted_to_plaza" ||
    status === "rejected" ||
    status === "redacted" ||
    status === "revoked"
  );
}

export function publicSourceMaterialGovernanceRequest(request: any) {
  return {
    id: request.id,
    policyId: request.policyId,
    policyVersionId: request.policyVersionId,
    policyVersion: request.policyVersion,
    ruleId: request.ruleId,
    scopeType: request.scopeType,
    scopeRef: request.scopeRef,
    actionType: request.actionType,
    targetType: request.targetType,
    targetRef: request.targetRef,
    payload: request.payload ?? null,
    idempotencyKey: request.idempotencyKey,
    proposerPubkey: request.proposerPubkey,
    state: request.state,
    openedAt: request.openedAt instanceof Date ? request.openedAt.toISOString() : request.openedAt ?? null,
    expiresAt: request.expiresAt instanceof Date ? request.expiresAt.toISOString() : request.expiresAt ?? null,
    resolvedAt: request.resolvedAt instanceof Date ? request.resolvedAt.toISOString() : request.resolvedAt ?? null,
    snapshot: request.snapshot ?? null,
  };
}

export async function evaluateSourceMaterialGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    sourceMaterialId: number;
    actionType: string;
    actorPubkey: string;
    directAllowed: boolean;
    payload: Record<string, unknown>;
  },
): Promise<
  | { status: "direct_allowed" }
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicSourceMaterialGovernanceRequest> }
> {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeSourceMaterialActions: true,
  });
  const gateway = new GovernedActionGateway({
    registry,
    resolveBinding: (bindingInput) =>
      resolveActiveCircleGovernanceBinding(prisma as any, bindingInput),
    listCommitteeEligibleActors: (eligibleInput) =>
      listCommitteeEligibleActors(prisma as any, eligibleInput),
    requestStore: createPrismaGovernanceRequestStore(prisma as any),
    runtimePrisma: prisma as any,
  });

  const decision = await gateway.evaluate({
    actionType: input.actionType,
    targetCircleId: input.circleId,
    actorPubkey: input.actorPubkey,
    directAllowed: input.directAllowed,
  });
  if (decision.status === "direct_allowed") {
    return { status: "direct_allowed" };
  }
  if (decision.status === "denied") {
    return {
      status: "denied",
      error: decision.reason,
    };
  }

  const idempotencyKey = buildSourceMaterialIdempotencyKey(input);
  const existingRequest = await findActiveSourceMaterialRequest(prisma as any, {
    sourceMaterialId: input.sourceMaterialId,
    actionType: input.actionType,
    committeeCircleId: decision.committeeCircleId,
    idempotencyKey,
  });
  if (existingRequest) {
    const request = existingRequest as any;
    return {
      status: "requires_governance",
      actionType: request.actionType ?? input.actionType,
      request: publicSourceMaterialGovernanceRequest(request),
    };
  }

  const request = await gateway.openRequest({
    actionType: input.actionType,
    targetCircleId: input.circleId,
    targetType: "source_material",
    targetRef: String(input.sourceMaterialId),
    payload: {
      ...input.payload,
      actorPubkey: input.actorPubkey,
      targetCircleId: input.circleId,
    },
    idempotencyKey,
    proposerPubkey: input.actorPubkey,
  });

  return {
    status: "requires_governance",
    actionType: input.actionType,
    request: publicSourceMaterialGovernanceRequest(request),
  };
}

export async function executeSourceMaterialGovernanceAction(
  prisma: PrismaClient,
  redis: Redis | null,
  request: {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
  },
): Promise<{
  executionStatus: "executed" | "skipped";
  executionRef: string | null;
  errorCode?: string | null;
} | null> {
  if (
    request.actionType !== SOURCE_MATERIAL_ACCEPT_ACTION_TYPE &&
    request.actionType !== SOURCE_MATERIAL_REJECT_ACTION_TYPE &&
    request.actionType !== SOURCE_MATERIAL_REDACT_ACTION_TYPE &&
    request.actionType !== SOURCE_MATERIAL_REVOKE_ACTION_TYPE
  ) {
    return null;
  }
  if (request.targetType !== "source_material") return null;
  const sourceMaterialId = parsePositiveInt(request.targetRef);
  if (!sourceMaterialId) {
    throw new Error("invalid_source_material_target");
  }
  const payload = normalizeRecord(request.payload);
  const circleId = parsePositiveInt(payload.circleId);
  if (!circleId) {
    throw new Error("source_material_circle_required");
  }
  const nextStatus = lifecycleStatusForSourceMaterialAction(request.actionType);

  const material = await (prisma as any).sourceMaterial.findFirst({
    where: {
      id: sourceMaterialId,
      circleId,
    },
    select: {
      id: true,
      circleId: true,
      lifecycleStatus: true,
      originType: true,
      originRef: true,
      externalAppId: true,
      roomKey: true,
      contentDigest: true,
      evidencePrivacyClass: true,
      visibilityScope: true,
      summaryText: true,
      provenance: true,
    },
  });
  if (!material) {
    throw new Error("source_material_not_found");
  }

  const currentStatus = normalizeSourceMaterialLifecycleStatus(
    material.lifecycleStatus ?? "accepted_to_plaza",
  );
  if (currentStatus === nextStatus) {
    if (nextStatus === "redacted" || nextStatus === "revoked") {
      await withdrawKnowledgePublicationsUsingSourceMaterial({
        prisma,
        sourceMaterialId,
      });
    }
    return {
      executionStatus: "skipped",
      executionRef: String(sourceMaterialId),
      errorCode: "source_material_lifecycle_already_applied",
    };
  }

  const reviewDecisionDigest = typeof payload.reviewDecisionDigest === "string"
    ? payload.reviewDecisionDigest
    : null;
  const updated = await (prisma as any).sourceMaterial.update({
    where: { id: sourceMaterialId },
    data: {
      lifecycleStatus: nextStatus,
      reviewRequestId: request.id,
      ...(reviewDecisionDigest ? { reviewDecisionDigest } : {}),
      ...(nextStatus === "redacted"
        ? {
            evidencePrivacyClass: "redacted",
            visibilityScope: "sealed",
            rawText: null,
            rawTextLocator: null,
          }
        : {}),
      provenance: buildLifecycleProvenance({
        existing: material.provenance,
        fromStatus: currentStatus,
        toStatus: nextStatus,
        actorPubkey: typeof payload.actorPubkey === "string" ? payload.actorPubkey : null,
        reason: typeof payload.reason === "string" ? payload.reason : null,
        governanceRequestId: request.id,
        reviewDecisionDigest,
      }),
    },
    select: {
      id: true,
      circleId: true,
      lifecycleStatus: true,
      originType: true,
      originRef: true,
      externalAppId: true,
      roomKey: true,
      contentDigest: true,
      evidencePrivacyClass: true,
      visibilityScope: true,
      summaryText: true,
    },
  });

  if (nextStatus === "redacted" || nextStatus === "revoked") {
    await withdrawKnowledgePublicationsUsingSourceMaterial({
      prisma,
      sourceMaterialId: updated.id,
    });
  }

  if (nextStatus === "accepted_to_plaza") {
    await publishSourceMaterialAcceptedSystemNotice(
      prisma,
      {
        circleId,
        sourceMaterialId: updated.id,
        originType: updated.originType ?? "manual_upload",
        originRef: updated.originRef ?? null,
        externalAppId: updated.externalAppId ?? null,
        roomKey: updated.roomKey ?? null,
        contentDigest: updated.contentDigest,
        lifecycleStatus: updated.lifecycleStatus,
        evidencePrivacyClass: updated.evidencePrivacyClass ?? "public",
        summaryText: material.summaryText ?? null,
      },
      redis as Redis,
    );
    try {
      await markCircleTopicProfileDirty({
        prisma,
        redis: redis as Redis,
        circleId,
        reason: "source_material_accepted",
      });
    } catch {
      // best effort only
    }
  }

  return {
    executionStatus: "executed",
    executionRef: String(sourceMaterialId),
  };
}

async function findActiveSourceMaterialRequest(
  prisma: {
    governanceRequest?: {
      findFirst(input: unknown): Promise<unknown | null>;
    };
  },
  input: {
    sourceMaterialId: number;
    actionType: string;
    committeeCircleId: number;
    idempotencyKey: string;
  },
): Promise<unknown | null> {
  if (typeof prisma.governanceRequest?.findFirst !== "function") return null;
  return prisma.governanceRequest.findFirst({
    where: {
      actionType: input.actionType,
      targetType: "source_material",
      targetRef: String(input.sourceMaterialId),
      scopeType: "circle_governance_committee",
      scopeRef: String(input.committeeCircleId),
      state: "active",
      idempotencyKey: input.idempotencyKey,
    },
    include: {
      snapshot: true,
    },
  });
}

function buildSourceMaterialIdempotencyKey(input: {
  sourceMaterialId: number;
  actionType: string;
  payload: Record<string, unknown>;
}): string {
  return `${input.actionType}:${input.sourceMaterialId}:${createHash("sha256")
    .update(JSON.stringify(input.payload))
    .digest("hex")}`;
}

function lifecycleStatusForSourceMaterialAction(actionType: string): string {
  if (actionType === SOURCE_MATERIAL_ACCEPT_ACTION_TYPE) return "accepted_to_plaza";
  if (actionType === SOURCE_MATERIAL_REJECT_ACTION_TYPE) return "rejected";
  if (actionType === SOURCE_MATERIAL_REDACT_ACTION_TYPE) return "redacted";
  if (actionType === SOURCE_MATERIAL_REVOKE_ACTION_TYPE) return "revoked";
  return "submitted";
}

function buildLifecycleProvenance(input: {
  existing: unknown;
  fromStatus: string;
  toStatus: string;
  actorPubkey: string | null;
  reason: string | null;
  governanceRequestId: string;
  reviewDecisionDigest: string | null;
}): Record<string, unknown> {
  const base = input.existing && typeof input.existing === "object" && !Array.isArray(input.existing)
    ? { ...(input.existing as Record<string, unknown>) }
    : {};
  const existingEvents = Array.isArray(base.lifecycleEvents)
    ? base.lifecycleEvents.filter((event) => event && typeof event === "object").slice(-19)
    : [];
  return {
    ...base,
    lifecycleEvents: [
      ...existingEvents,
      {
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorPubkey: input.actorPubkey,
        reason: input.reason,
        governanceRequestId: input.governanceRequestId,
        reviewDecisionDigest: input.reviewDecisionDigest,
        at: new Date().toISOString(),
      },
    ],
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
