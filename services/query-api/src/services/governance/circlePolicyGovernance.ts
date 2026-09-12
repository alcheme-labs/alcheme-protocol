import { createHash } from "node:crypto";

import {
  CircleType,
  JoinRequirement,
  type PrismaClient,
} from "@prisma/client";

import { createGovernedActionRegistry } from "./actionRegistry";
import { GovernedActionGateway } from "./governedActionGateway";
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type { GovernedDirectOperationReceiptRecord } from "./governedActionGateway";
import type { GovernedActionAppealResolutionOutcome } from './governedActionAppeal';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "./circleGovernanceBindings";
import { createPrismaGovernanceRequestStore } from "./policyEngine";
import {
  upsertCircleDraftLifecycleTemplate,
  upsertCircleDraftWorkflowPolicy,
} from "../policy/profile";
import { reconcileActiveDraftWorkflowStates } from "../draftLifecycle/workflowState";
import { upsertCircleGhostSettings } from "../../ai/ghost/circle-settings";
import {
  buildStoredCircleSettingsEnvelopeSection,
  persistCircleSettingsEnvelopeSection,
} from "../policy/settingsEnvelope";
import {
  archiveCirclePrimaryGeoAnchor,
  upsertCirclePrimaryGeoAnchor,
} from "../circleLocation/store";
import {
  normalizeCircleGeoAnchorSettingsPayload,
} from "../circleLocation/validation";
import { invalidateDiscussionTopicProfileCache } from "../discussion/topicProfile";

export const CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE = "circle.policy.membership.update";
export const CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE = "circle.policy.profile.update";
export const CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE =
  "circle.policy.draft_lifecycle.update";
export const CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE = "circle.policy.ghost.update";
export const CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE = "circle.policy.genesis.update";
export const CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE = "circle.policy.metadata.update";
export const CIRCLE_POLICY_COMMUNITY_PROFILE_UPDATE_ACTION_TYPE = "circle.policy.community_profile.update";
export const CIRCLE_POLICY_LOCATION_UPDATE_ACTION_TYPE = "circle.policy.location.update";

export function publicCirclePolicyGovernanceRequest(request: any) {
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

export async function evaluateCirclePolicyGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actionType: string;
    actorPubkey: string;
    directAllowed: boolean;
    payload: Record<string, unknown>;
  },
  runtime?: { transactionClient: boolean },
): Promise<
  | { status: "direct_allowed" }
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicCirclePolicyGovernanceRequest> }
> {
  if (
    !runtime?.transactionClient
    && typeof (prisma as any).governanceHomeIdentityBinding?.findMany === 'function'
    && typeof (prisma as any).$transaction === 'function'
  ) {
    const homes = await (prisma as any).governanceHomeIdentityBinding.findMany({
      where: {
        homeType: 'circle',
        homeRef: String(input.circleId),
        supersededAt: null,
      },
      include: { activationState: true },
      orderBy: { identityVersion: 'desc' },
      take: 2,
    });
    if (homes.length === 1 && homes[0]?.activationState?.state === 'active') {
      return (prisma as any).$transaction((tx: PrismaClient) =>
        evaluateCirclePolicyGovernance(tx, input, { transactionClient: true }));
    }
  }

  const gateway = createCirclePolicyGateway(prisma, runtime?.transactionClient === true);

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

  const existingRequest = await findActiveCirclePolicyRequest(prisma as any, {
    circleId: input.circleId,
    actionType: input.actionType,
    committeeCircleId: decision.committeeCircleId,
  });
  if (existingRequest) {
    const request = existingRequest as any;
    return {
      status: "requires_governance",
      actionType: request.actionType ?? input.actionType,
      request: publicCirclePolicyGovernanceRequest(request),
    };
  }

  const requestInput = {
    actionType: input.actionType,
    targetCircleId: input.circleId,
    targetType: "circle",
    targetRef: String(input.circleId),
    payload: {
      ...input.payload,
      actorPubkey: input.actorPubkey,
    },
    idempotencyKey: buildCirclePolicyIdempotencyKey({
      actionType: input.actionType,
      circleId: input.circleId,
      payload: input.payload,
    }),
    proposerPubkey: input.actorPubkey,
  } as const;
  const request = runtime?.transactionClient
    ? await gateway.openDecisionStageRequest(requestInput)
    : await gateway.openRequest(requestInput);

  return {
    status: "requires_governance",
    actionType: input.actionType,
    request: publicCirclePolicyGovernanceRequest(request),
  };
}

export async function executeCirclePolicyDirectOperation<T>(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actionType: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    transactionClient?: boolean;
    execute(client: PrismaClient): Promise<{ result: T; executionRef: string | null }>;
    readback(client: PrismaClient): Promise<T>;
  },
): Promise<{
  receipt: GovernedDirectOperationReceiptRecord;
  result: T;
  replayed: boolean;
}> {
  const run = async (client: PrismaClient) => {
    const gateway = createCirclePolicyGateway(client, true);
    const outcome = await gateway.executeDirectOperation({
      actionType: input.actionType,
      targetCircleId: input.circleId,
      targetType: 'circle',
      targetRef: String(input.circleId),
      actorPubkey: input.actorPubkey,
      payload: input.payload,
      reasonCode: input.reasonCode,
      idempotencyKey: input.idempotencyKey,
      execute: () => input.execute(client),
    });
    return {
      ...outcome,
      result: outcome.result ?? await input.readback(client),
    };
  };
  if (input.transactionClient) return run(prisma);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await (prisma as any).$transaction((tx: PrismaClient) => run(tx));
    } catch (error) {
      if (!isRetryableDirectOperationConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error('governed_direct_operation_retry_exhausted');
}

export async function openCirclePolicyOperationAppeal(
  prisma: PrismaClient,
  input: {
    circleId: number;
    originalReceiptId: string;
    appellantPubkey: string;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  },
) {
  await assertCirclePolicyAppealSubject(prisma, input.circleId, input.originalReceiptId);
  return createCirclePolicyGateway(prisma).openAppeal(input);
}

export async function resolveCirclePolicyOperationAppeal(
  prisma: PrismaClient,
  input: {
    circleId: number;
    appealId: string;
    reviewerPubkey: string;
    outcome: GovernedActionAppealResolutionOutcome;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  },
) {
  const appeal = await (prisma as any).governedActionAppeal.findUnique({
    where: { id: input.appealId },
    select: { originalReceiptId: true },
  });
  if (!appeal) throw new Error('governed_action_appeal_missing');
  await assertCirclePolicyAppealSubject(prisma, input.circleId, appeal.originalReceiptId);
  const authority = await resolveCirclePolicyExecutionAuthority(prisma, {
    circleId: input.circleId,
    actorPubkey: input.reviewerPubkey,
    executionAdapter: 'circle_policy',
  });
  return createCirclePolicyGateway(prisma).resolveAppeal({
    ...input,
    reviewerAuthorityDigest: authority.readbackDigest,
  });
}

async function assertCirclePolicyAppealSubject(
  prisma: PrismaClient,
  circleId: number,
  originalReceiptId: string,
): Promise<void> {
  const receipt = await (prisma as any).operationReceipt.findUnique({
    where: { id: originalReceiptId },
    select: {
      invocation: {
        select: {
          governanceHomeType: true,
          governanceHomeRef: true,
          subjectType: true,
          subjectRef: true,
        },
      },
    },
  });
  if (!receipt
    || receipt.invocation?.governanceHomeType !== 'circle'
    || receipt.invocation?.governanceHomeRef !== String(circleId)
    || receipt.invocation?.subjectType !== 'circle'
    || receipt.invocation?.subjectRef !== String(circleId)) {
    throw new Error('governed_action_appeal_subject_mismatch');
  }
}

function isRetryableDirectOperationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === 'P2002' || code === 'P2034';
}

function createCirclePolicyGateway(
  prisma: PrismaClient,
  transactionClient = false,
): GovernedActionGateway {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeCirclePolicyActions: true,
  });
  return new GovernedActionGateway({
    registry,
    resolveBinding: (bindingInput) =>
      resolveActiveCircleGovernanceBinding(prisma as any, bindingInput),
    listCommitteeEligibleActors: (eligibleInput) =>
      listCommitteeEligibleActors(prisma as any, eligibleInput),
    requestStore: createPrismaGovernanceRequestStore(prisma as any),
    runtimePrisma: prisma as any,
    runtimeTransactionClient: transactionClient,
    resolveExecutionAuthority: async (input) => {
      if (input.targetType !== 'circle' || input.targetRef !== String(Number(input.targetRef))) {
        throw new Error('circle_policy_execution_authority_subject_mismatch');
      }
      return resolveCirclePolicyExecutionAuthority(prisma, {
        circleId: Number(input.targetRef),
        actorPubkey: input.actorPubkey,
        executionAdapter: input.expectedAdapter,
      });
    },
  });
}

export async function resolveCirclePolicyExecutionAuthority(
  prisma: PrismaClient,
  input: { circleId: number; actorPubkey: string; executionAdapter: string },
) {
  const [circle, actor] = await Promise.all([
    prisma.circle.findUnique({
      where: { id: input.circleId },
      select: { id: true, creatorId: true, onChainAddress: true },
    }),
    prisma.user.findUnique({
      where: { pubkey: input.actorPubkey },
      select: { id: true, pubkey: true },
    }),
  ]);
  if (!circle || !actor || actor.pubkey !== input.actorPubkey || !circle.onChainAddress) {
    throw new Error('circle_policy_execution_authority_readback_missing');
  }
  const membership = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId: circle.id, userId: actor.id } },
    select: { role: true, status: true, onChainAddress: true },
  });
  const isCreator = circle.creatorId === actor.id;
  const role = isCreator ? 'Owner' : String(membership?.role ?? '');
  if (!isCreator && (membership?.status !== 'Active' || !['Owner', 'Admin'].includes(role))) {
    throw new Error('circle_policy_execution_authority_not_live');
  }
  const providerRef = 'circle_authority_projection_with_route_chain_presence:v1';
  const facts = {
    subjectType: 'circle',
    subjectRef: String(circle.id),
    subjectAuthorityRef: circle.onChainAddress,
    actorPubkey: actor.pubkey,
    actorUserId: actor.id,
    source: isCreator ? 'circle_creator' : 'active_circle_member',
    role,
    membershipAccountRef: membership?.onChainAddress ?? null,
    executionAdapter: input.executionAdapter,
    providerRef,
  };
  return {
    authorityType: 'verified_actor_capability' as const,
    authorityRef: actor.pubkey,
    executionAdapter: input.executionAdapter,
    providerRef,
    subjectAuthorityRef: circle.onChainAddress,
    readbackDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.execution-authority-readback', facts,
    ),
  };
}

export async function executeCirclePolicyGovernanceAction(
  prisma: PrismaClient,
  redis: { del?: (key: string) => Promise<unknown> } | null,
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
    request.actionType !== CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_COMMUNITY_PROFILE_UPDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_POLICY_LOCATION_UPDATE_ACTION_TYPE
  ) {
    return null;
  }
  if (request.targetType !== "circle") return null;
  const circleId = Number(request.targetRef);
  if (!Number.isInteger(circleId) || circleId <= 0) {
    throw new Error("invalid_circle_policy_target");
  }
  const payload = normalizeRecord(request.payload);

  if (request.actionType === CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE) {
    const actorUserId = await resolvePolicyActorUserId(prisma, circleId, payload);
    const lifecyclePatch = parseDraftLifecycleTemplatePatch(payload.draftLifecycleTemplate);
    if (!lifecyclePatch) {
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "empty_draft_lifecycle_patch",
      };
    }
    const profile = await upsertCircleDraftLifecycleTemplate(prisma, {
      circleId,
      actorUserId,
      patch: lifecyclePatch,
    });
    await reconcileActiveDraftWorkflowStates(prisma, {
      circleId,
      template: profile.draftLifecycleTemplate,
    });
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE) {
    const actorUserId = await resolvePolicyActorUserId(prisma, circleId, payload);
    const lifecyclePatch = parseDraftLifecycleTemplatePatch(payload.draftLifecycleTemplate);
    const workflowPatch = parseDraftWorkflowPolicyPatch(payload.draftWorkflowPolicy);
    if (!lifecyclePatch && !workflowPatch) {
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "empty_policy_profile_patch",
      };
    }
    if (lifecyclePatch) {
      const profile = await upsertCircleDraftLifecycleTemplate(prisma, {
        circleId,
        actorUserId,
        patch: lifecyclePatch,
      });
      await reconcileActiveDraftWorkflowStates(prisma, {
        circleId,
        template: profile.draftLifecycleTemplate,
      });
    }
    if (workflowPatch) {
      await upsertCircleDraftWorkflowPolicy(prisma, {
        circleId,
        actorUserId,
        patch: workflowPatch,
      });
    }
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE) {
    const patch = parseGhostSettingsPatch(payload);
    if (Object.keys(patch).length === 0) {
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "empty_ghost_settings_patch",
      };
    }
    await upsertCircleGhostSettings(prisma, circleId, patch);
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE) {
    const genesisMode = String(payload.genesisMode || "").trim().toUpperCase();
    if (genesisMode !== "BLANK" && genesisMode !== "SEEDED") {
      throw new Error("invalid_circle_genesis_mode");
    }
    await prisma.circle.update({
      where: { id: circleId },
      data: { genesisMode },
    });
    if (typeof redis?.del === "function") {
      await redis.del(`circle:${circleId}`);
    }
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE) {
    const chainStatus = String(payload.chainStatus || "").trim();
    if (chainStatus === "requires_wallet_finalization") {
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "wallet_finalization_required",
      };
    }
    const joinRequirement = parseJoinRequirement(payload.joinRequirement);
    const circleType = parseCircleType(payload.circleType);
    const minCrystals = parseMinCrystals(payload.minCrystals);
    if (!joinRequirement || !circleType || minCrystals === null) {
      throw new Error("invalid_membership_policy_payload");
    }
    await prisma.circle.update({
      where: { id: circleId },
      data: {
        joinRequirement,
        circleType,
        minCrystals,
      },
    });
    if (typeof redis?.del === "function") {
      await redis.del(`circle:${circleId}`);
    }
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE) {
    const description = typeof payload.description === "string"
      ? payload.description.trim().slice(0, 280)
      : null;
    await prisma.circle.update({
      where: { id: circleId },
      data: { description },
    });
    await persistSignedSettingsSection(prisma, circleId, payload, {
      settingKind: "circle_metadata",
      payload: { description },
    });
    if (typeof redis?.del === "function") {
      await redis.del(`circle:${circleId}`);
    }
    invalidateDiscussionTopicProfileCache(circleId);
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_COMMUNITY_PROFILE_UPDATE_ACTION_TYPE) {
    const communityType = String(payload.communityType || "").trim().toLowerCase();
    const displayRole = String(payload.displayRole || "").trim().toLowerCase();
    await persistSignedSettingsSection(prisma, circleId, payload, {
      settingKind: "community_profile",
      payload: {
        communityType,
        displayRole,
      },
    });
    if (typeof redis?.del === "function") {
      await redis.del(`circle:${circleId}`);
    }
    return {
      executionStatus: "executed",
      executionRef: String(circleId),
    };
  }

  if (request.actionType === CIRCLE_POLICY_LOCATION_UPDATE_ACTION_TYPE) {
    const locationPayload = normalizeCircleGeoAnchorSettingsPayload(payload);
    const actorPubkey = typeof payload.actorPubkey === "string"
      ? payload.actorPubkey.trim()
      : "";
    const anchor = locationPayload.operation === "archive"
      ? await archiveCirclePrimaryGeoAnchor(prisma, {
        circleId,
        actorPubkey,
        governanceRequestId: request.id,
      }, locationPayload)
      : await upsertCirclePrimaryGeoAnchor(prisma, {
        circleId,
        actorPubkey,
        governanceRequestId: request.id,
      }, locationPayload);
    if (!anchor) {
      return {
        executionStatus: "skipped",
        executionRef: String(circleId),
        errorCode: "circle_geo_anchor_not_found",
      };
    }
    await persistSignedSettingsSection(prisma, circleId, payload, {
      settingKind: "circle_geo_anchor",
      payload: { ...locationPayload },
    });
    if (typeof redis?.del === "function") {
      await redis.del(`circle:${circleId}`);
    }
    return {
      executionStatus: "executed",
      executionRef: anchor.anchorId,
    };
  }

  return null;
}

async function findActiveCirclePolicyRequest(
  prisma: {
    governanceRequest?: {
      findFirst(input: unknown): Promise<unknown | null>;
    };
  },
  input: {
    circleId: number;
    actionType: string;
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
      targetType: "circle",
      targetRef: String(input.circleId),
      state: "active",
    },
    include: { snapshot: true },
    orderBy: { openedAt: "desc" },
  });
}

function buildCirclePolicyIdempotencyKey(input: {
  actionType: string;
  circleId: number;
  payload: Record<string, unknown>;
}): string {
  const digest = createHash("sha256")
    .update(stableJsonStringify(input.payload))
    .digest("hex")
    .slice(0, 24);
  return `circle-policy:${input.actionType}:${input.circleId}:${digest}`;
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

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function parseReviewEntryMode(value: unknown): "auto_only" | "manual_only" | "auto_or_manual" | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "auto_only") return "auto_only";
  if (normalized === "manual_only") return "manual_only";
  if (normalized === "auto_or_manual") return "auto_or_manual";
  return null;
}

function parseGovernanceRole(value: unknown) {
  const normalized = String(value || "").trim();
  if (
    normalized === "Owner" ||
    normalized === "Admin" ||
    normalized === "Moderator" ||
    normalized === "Member" ||
    normalized === "Elder" ||
    normalized === "Initiate"
  ) {
    return normalized;
  }
  return null;
}

function parseDraftLifecycleTemplatePatch(value: unknown) {
  const record = normalizeRecord(value);
  const reviewEntryMode = parseReviewEntryMode(record.reviewEntryMode);
  const draftingWindowMinutes = parsePositiveInteger(record.draftingWindowMinutes);
  const reviewWindowMinutes = parsePositiveInteger(record.reviewWindowMinutes);
  const maxRevisionRounds = parsePositiveInteger(record.maxRevisionRounds);
  if (!reviewEntryMode || !draftingWindowMinutes || !reviewWindowMinutes || !maxRevisionRounds) {
    return null;
  }
  return {
    reviewEntryMode,
    draftingWindowMinutes,
    reviewWindowMinutes,
    maxRevisionRounds,
  };
}

function parseDraftWorkflowPolicyPatch(value: unknown) {
  const record = normalizeRecord(value);
  const patch: Record<string, unknown> = {};
  const roleFields = [
    "createIssueMinRole",
    "followupIssueMinRole",
    "reviewIssueMinRole",
    "retagIssueMinRole",
    "applyIssueMinRole",
    "manualEndDraftingMinRole",
    "advanceFromReviewMinRole",
    "enterCrystallizationMinRole",
  ];
  for (const field of roleFields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const parsed = parseGovernanceRole(record[field]);
    if (!parsed) return null;
    patch[field] = parsed;
  }
  if (Object.prototype.hasOwnProperty.call(record, "allowAuthorWithdrawBeforeReview")) {
    if (typeof record.allowAuthorWithdrawBeforeReview !== "boolean") return null;
    patch.allowAuthorWithdrawBeforeReview = record.allowAuthorWithdrawBeforeReview;
  }
  if (Object.prototype.hasOwnProperty.call(record, "allowModeratorRetagIssue")) {
    if (typeof record.allowModeratorRetagIssue !== "boolean") return null;
    patch.allowModeratorRetagIssue = record.allowModeratorRetagIssue;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function parseGhostSettingsPatch(payload: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(payload, "summaryUseLLM")) {
    patch.summaryUseLLM = Boolean(payload.summaryUseLLM);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "draftTriggerMode")) {
    patch.draftTriggerMode = String(payload.draftTriggerMode || "").trim().toLowerCase() === "auto_draft"
      ? "auto_draft"
      : "notify_only";
  }
  if (Object.prototype.hasOwnProperty.call(payload, "triggerSummaryUseLLM")) {
    patch.triggerSummaryUseLLM = Boolean(payload.triggerSummaryUseLLM);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "triggerGenerateComment")) {
    patch.triggerGenerateComment = Boolean(payload.triggerGenerateComment);
  }
  return patch;
}

function parseJoinRequirement(value: unknown): JoinRequirement | null {
  const normalized = String(value || "").trim();
  if (Object.values(JoinRequirement).includes(normalized as JoinRequirement)) {
    return normalized as JoinRequirement;
  }
  return null;
}

function parseCircleType(value: unknown): CircleType | null {
  const normalized = String(value || "").trim();
  if (Object.values(CircleType).includes(normalized as CircleType)) {
    return normalized as CircleType;
  }
  return null;
}

function parseMinCrystals(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.max(0, Math.min(0xffff, Math.floor(parsed)));
}

async function resolvePolicyActorUserId(
  prisma: PrismaClient,
  circleId: number,
  payload: Record<string, unknown>,
): Promise<number> {
  const actorPubkey = typeof payload.actorPubkey === "string" ? payload.actorPubkey.trim() : "";
  if (!actorPubkey) return 0;
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: {
      creatorId: true,
      creator: {
        select: {
          pubkey: true,
        },
      },
    },
  });
  if (circle?.creator?.pubkey === actorPubkey) {
    return circle.creatorId;
  }
  const actor = await prisma.user.findUnique({
    where: { pubkey: actorPubkey },
    select: { id: true },
  });
  return actor?.id ?? 0;
}

async function persistSignedSettingsSection(
  prisma: PrismaClient,
  circleId: number,
  signedPayload: Record<string, unknown>,
  section: {
    settingKind: "circle_metadata" | "community_profile" | "circle_geo_anchor";
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const actorPubkey = typeof signedPayload.actorPubkey === "string" ? signedPayload.actorPubkey : "";
  const signedMessage = typeof signedPayload.signedMessage === "string" ? signedPayload.signedMessage : "";
  const signature = typeof signedPayload.signature === "string" ? signedPayload.signature : "";
  const clientTimestamp = typeof signedPayload.clientTimestamp === "string" ? signedPayload.clientTimestamp : "";
  const nonce = typeof signedPayload.nonce === "string" ? signedPayload.nonce : "";
  if (!actorPubkey || !signedMessage || !signature || !clientTimestamp || !nonce) {
    return;
  }
  await persistCircleSettingsEnvelopeSection(prisma, {
    circleId,
    actorUserId: await resolvePolicyActorUserId(prisma, circleId, signedPayload),
    section: buildStoredCircleSettingsEnvelopeSection({
      settingKind: section.settingKind,
      payload: section.payload,
      actorPubkey,
      signedMessage,
      signature,
      clientTimestamp,
      nonce,
      anchor: normalizeRecord(signedPayload.anchor),
    }),
  });
}
