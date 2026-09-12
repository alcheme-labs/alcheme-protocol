import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { createGovernedActionRegistry } from "./actionRegistry";
import { GovernedActionGateway } from "./governedActionGateway";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "./circleGovernanceBindings";
import { createPrismaGovernanceRequestStore } from "./policyEngine";
import {
  bindAgentToUser,
  createCircleAgent,
} from "../agents/runtime";
import { upsertCircleAgentPolicy } from "../agents/policy";

export const CIRCLE_AGENT_POLICY_UPDATE_ACTION_TYPE = "circle.agent.policy.update";
export const CIRCLE_AGENT_CREATE_ACTION_TYPE = "circle.agent.create";
export const CIRCLE_AGENT_OWNER_BINDING_UPDATE_ACTION_TYPE = "circle.agent.owner_binding.update";

export function publicCircleAgentGovernanceRequest(request: any) {
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

export async function evaluateCircleAgentGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actionType: string;
    actorPubkey: string;
    directAllowed: boolean;
    payload: Record<string, unknown>;
    targetType?: string;
    targetRef?: string;
  },
): Promise<
  | { status: "direct_allowed" }
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicCircleAgentGovernanceRequest> }
> {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeCircleAgentActions: true,
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

  const targetType = input.targetType ?? "circle";
  const targetRef = input.targetRef ?? String(input.circleId);
  const existingRequest = await findActiveCircleAgentRequest(prisma as any, {
    actionType: input.actionType,
    targetType,
    targetRef,
    committeeCircleId: decision.committeeCircleId,
  });
  if (existingRequest) {
    const request = existingRequest as any;
    return {
      status: "requires_governance",
      actionType: request.actionType ?? input.actionType,
      request: publicCircleAgentGovernanceRequest(request),
    };
  }

  const request = await gateway.openRequest({
    actionType: input.actionType,
    targetCircleId: input.circleId,
    targetType,
    targetRef,
    payload: {
      ...input.payload,
      actorPubkey: input.actorPubkey,
    },
    idempotencyKey: buildCircleAgentIdempotencyKey({
      actionType: input.actionType,
      targetRef,
      payload: input.payload,
    }),
    proposerPubkey: input.actorPubkey,
  });

  return {
    status: "requires_governance",
    actionType: input.actionType,
    request: publicCircleAgentGovernanceRequest(request),
  };
}

export async function executeCircleAgentGovernanceAction(
  prisma: PrismaClient,
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
    request.actionType !== CIRCLE_AGENT_POLICY_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_AGENT_CREATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_AGENT_OWNER_BINDING_UPDATE_ACTION_TYPE
  ) {
    return null;
  }
  const payload = normalizeRecord(request.payload);
  const circleId = resolveCircleAgentTargetCircleId(request, payload);
  if (!circleId) {
    throw new Error("invalid_circle_agent_target");
  }

  if (request.actionType === CIRCLE_AGENT_POLICY_UPDATE_ACTION_TYPE) {
    const patch = parseAgentPolicyPatch(payload);
    if (Object.keys(patch).length === 0) {
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "empty_agent_policy_patch",
      };
    }
    await upsertCircleAgentPolicy(prisma as any, {
      circleId,
      actorUserId: parsePositiveInt(payload.actorUserId) ?? 0,
      patch,
    });
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_AGENT_CREATE_ACTION_TYPE) {
    const agent = await createCircleAgent(prisma as any, {
      circleId,
      agentPubkey: parseRequiredString(payload.pubkey, "agent_pubkey_required"),
      handle: parseRequiredString(payload.handle, "agent_handle_required"),
      displayName: parseOptionalString(payload.displayName),
      description: parseOptionalString(payload.description),
      ownerUserId: parsePositiveInt(payload.ownerUserId),
      createdByUserId: parsePositiveInt(payload.createdByUserId) ?? 0,
    });
    return {
      executionStatus: "executed",
      executionRef: String((agent as any)?.id ?? circleId),
    };
  }

  if (request.actionType === CIRCLE_AGENT_OWNER_BINDING_UPDATE_ACTION_TYPE) {
    const agentId = resolveCircleAgentOwnerBindingTargetAgentId(request, payload);
    if (!agentId) {
      throw new Error("invalid_agent_id");
    }
    const agent = await bindAgentToUser(prisma as any, {
      circleId,
      agentId,
      ownerUserId: payload.ownerUserId === null ? null : parsePositiveInt(payload.ownerUserId),
    });
    return {
      executionStatus: "executed",
      executionRef: String((agent as any)?.id ?? agentId),
    };
  }

  return null;
}

function resolveCircleAgentTargetCircleId(
  request: { targetType: string; targetRef: string },
  payload: Record<string, unknown>,
): number | null {
  const payloadCircleId = parsePositiveInt(payload.targetCircleId);
  const requestCircleId = request.targetType === "circle"
    ? parsePositiveInt(request.targetRef)
    : null;
  if (requestCircleId && payloadCircleId && payloadCircleId !== requestCircleId) {
    throw new Error("invalid_circle_agent_target");
  }
  return requestCircleId ?? payloadCircleId;
}

function resolveCircleAgentOwnerBindingTargetAgentId(
  request: { targetType: string; targetRef: string },
  payload: Record<string, unknown>,
): number | null {
  const requestAgentId = request.targetType === "agent"
    ? parsePositiveInt(request.targetRef)
    : null;
  const payloadAgentId = parsePositiveInt(payload.agentId);
  if (requestAgentId && payloadAgentId && payloadAgentId !== requestAgentId) {
    throw new Error("invalid_agent_owner_binding_target");
  }
  return requestAgentId ?? payloadAgentId;
}

async function findActiveCircleAgentRequest(
  prisma: {
    governanceRequest?: {
      findFirst(input: unknown): Promise<unknown | null>;
    };
  },
  input: {
    actionType: string;
    targetType: string;
    targetRef: string;
    committeeCircleId?: number | null;
  },
) {
  if (
    !input.committeeCircleId ||
    typeof prisma?.governanceRequest?.findFirst !== "function"
  ) {
    return null;
  }
  return prisma.governanceRequest.findFirst({
    where: {
      scopeType: "circle_governance_committee",
      scopeRef: String(input.committeeCircleId),
      actionType: input.actionType,
      targetType: input.targetType,
      targetRef: input.targetRef,
      state: "active",
    },
    include: { snapshot: true },
    orderBy: { openedAt: "desc" },
  });
}

function buildCircleAgentIdempotencyKey(input: {
  actionType: string;
  targetRef: string;
  payload: Record<string, unknown>;
}): string {
  const digest = createHash("sha256")
    .update(stableJsonStringify(input.payload))
    .digest("hex")
    .slice(0, 24);
  return `circle-agent:${input.actionType}:${input.targetRef}:${digest}`;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseRequiredString(value: unknown, errorCode: string): string {
  const parsed = parseOptionalString(value);
  if (!parsed) throw new Error(errorCode);
  return parsed;
}

function parseAgentPolicyPatch(payload: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(payload, "triggerScope")) {
    const triggerScope = String(payload.triggerScope || "").trim().toLowerCase();
    if (
      triggerScope !== "disabled" &&
      triggerScope !== "draft_only" &&
      triggerScope !== "circle_wide"
    ) {
      throw new Error("invalid_agent_trigger_scope");
    }
    patch.triggerScope = triggerScope;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "costDiscountBps")) {
    const parsed = Number(payload.costDiscountBps);
    if (!Number.isFinite(parsed)) {
      throw new Error("invalid_agent_cost_discount_bps");
    }
    patch.costDiscountBps = Math.max(0, Math.min(10_000, Math.floor(parsed)));
  }
  if (Object.prototype.hasOwnProperty.call(payload, "reviewMode")) {
    const reviewMode = String(payload.reviewMode || "").trim().toLowerCase();
    if (
      reviewMode !== "owner_review" &&
      reviewMode !== "admin_review" &&
      reviewMode !== "self_serve"
    ) {
      throw new Error("invalid_agent_review_mode");
    }
    patch.reviewMode = reviewMode;
  }
  return patch;
}
