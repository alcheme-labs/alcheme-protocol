import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createPrismaTemporaryEditGrantStore,
  issueTemporaryEditGrant,
} from "../draftBlocks/grants";
import {
  applyGovernedRevisionDirectionOutcome,
  createPrismaRevisionDirectionStore,
  type RevisionDirectionProposalRecord,
} from "../revisionDirection/runtime";
import { loadDraftVersionSnapshot } from "../draftLifecycle/versionSnapshots";
import { activateGovernedDraftCrystallization } from "../draftLifecycle/workflowState";
import {
  buildPublicPolicyDigestSnapshot,
  resolveCirclePolicyProfile,
} from "../policy/profile";
import { computePolicyProfileDigest } from "../policy/digest";
import {
  createGovernedActionRegistry,
  isRevisionDirectionAcceptActionType,
  REVISION_DIRECTION_ACCEPT_ACTION_TYPE,
  type RevisionDirectionAcceptActionType,
} from "./actionRegistry";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "./circleGovernanceBindings";
import { GovernedActionGateway } from "./governedActionGateway";
import { hashCanonicalGovernanceValue } from "./canonicalCodec";
import { resolveGovernedActionGatewayRuntime } from "./governedActionGatewayRuntime";
import {
  createPrismaGovernanceEngineStore,
  createPrismaGovernanceRequestStore,
  recordExecutionReceipt,
  type GovernanceExecutionReceiptRecord,
} from "./policyEngine";

export const TEMPORARY_EDIT_GRANT_APPROVE_ACTION_TYPE =
  "temporary_edit_grant.approve";

export function publicDraftGovernanceRequest(request: any) {
  return {
    id: request.id,
    homeIdentityBindingId: request.homeIdentityBindingId ?? null,
    invocationId: request.invocationId ?? null,
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
    caseRef: request.caseRef ?? null,
    openedAt: request.openedAt instanceof Date ? request.openedAt.toISOString() : request.openedAt ?? null,
    expiresAt: request.expiresAt instanceof Date ? request.expiresAt.toISOString() : request.expiresAt ?? null,
    resolvedAt: request.resolvedAt instanceof Date ? request.resolvedAt.toISOString() : request.resolvedAt ?? null,
    snapshot: request.snapshot ?? null,
  };
}

export interface RevisionDirectionCrystallizationRouteResolution {
  actionType: RevisionDirectionAcceptActionType;
  targetType: "revision_direction";
  targetRef: string;
  payloadDigest: string;
  governancePolicyId: string;
  governancePolicyVersionId: string;
  governancePolicyVersion: number;
  governanceRuleId: string;
  contractVersionId: string;
  authorityBindingId: string;
  profileBindingId: string;
  invocationId: string;
  requestId: string;
  caseId: string;
}

function revisionDirectionActionPayload(
  proposal: RevisionDirectionProposalRecord,
): Record<string, unknown> {
  return {
    revisionProposalId: proposal.revisionProposalId,
    draftPostId: proposal.draftPostId,
    draftVersion: proposal.draftVersion,
    scopeType: proposal.scopeType,
    scopeRef: proposal.scopeRef,
    summary: proposal.summary,
    proposedBy: proposal.proposedBy,
  };
}

export async function resolveRevisionDirectionCrystallizationRoute(
  prisma: PrismaClient,
  input: {
    circleId: number;
    draftPostId: number;
    draftVersion: number;
    actionType: RevisionDirectionAcceptActionType;
    revisionProposalId: string;
    requestId: string;
    now?: Date;
  },
): Promise<RevisionDirectionCrystallizationRouteResolution> {
  const now = input.now ?? new Date();
  const proposal = await createPrismaRevisionDirectionStore(prisma as any)
    .getProposal(input.revisionProposalId);
  if (
    !proposal
    || proposal.draftPostId !== input.draftPostId
    || proposal.draftVersion !== input.draftVersion
    || proposal.acceptanceMode !== "governance_request"
    || proposal.governanceRequestId !== input.requestId
    || proposal.status !== "open"
  ) {
    throw new Error("revision_direction_crystallization_subject_mismatch");
  }

  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeDraftGovernanceActions: true,
  });
  const definition = registry.get(input.actionType);
  if (!definition || definition.targetType !== "revision_direction") {
    throw new Error("crystallization_governed_action_unregistered");
  }
  const binding = await resolveActiveCircleGovernanceBinding(prisma as any, {
    targetCircleId: input.circleId,
    actionType: input.actionType,
    purpose: "collective_decision",
    now,
  });
  if (!binding) throw new Error("governance_binding_required");

  const sourcePayload = revisionDirectionActionPayload(proposal);
  const runtime = await resolveGovernedActionGatewayRuntime({ prisma: prisma as any }, {
    definition,
    targetCircleId: input.circleId,
    targetType: "revision_direction",
    targetRef: proposal.revisionProposalId,
    binding: binding.binding,
    payload: sourcePayload,
    appendCircleBindingFacts: true,
    now,
  });
  const request = await (prisma as any).governanceRequest.findUnique({
    where: { id: input.requestId },
    include: {
      invocation: { include: { authoritySnapshot: true } },
      governanceCase: true,
    },
  });
  const invocation = request?.invocation;
  const authoritySnapshot = invocation?.authoritySnapshot;
  const governanceCase = request?.governanceCase;
  const requestPolicy = runtime.requestPolicy ?? binding.binding;
  if (
    !request
    || request.state !== "active"
    || (request.expiresAt && new Date(request.expiresAt) <= now)
    || request.actionType !== input.actionType
    || request.targetType !== "revision_direction"
    || request.targetRef !== proposal.revisionProposalId
    || request.policyId !== requestPolicy.policyId
    || request.policyVersionId !== requestPolicy.policyVersionId
    || request.policyVersion !== requestPolicy.policyVersion
    || request.ruleId !== requestPolicy.ruleId
    || request.scopeType !== "circle_governance_committee"
    || request.scopeRef !== String(requestPolicy.committeeCircleId)
    || request.homeIdentityBindingId !== runtime.homeIdentityBindingId
    || hashCanonicalGovernanceValue("alcheme.governance.action-payload", request.payload) !== runtime.payloadDigest
    || !invocation
    || invocation.id !== request.invocationId
    || invocation.contractVersionId !== runtime.contractVersionId
    || invocation.profileBindingId !== runtime.profileBindingId
    || invocation.governanceHomeType !== runtime.governanceHomeType
    || invocation.governanceHomeRef !== runtime.governanceHomeRef
    || invocation.subjectType !== "revision_direction"
    || invocation.subjectRef !== proposal.revisionProposalId
    || invocation.payloadDigest !== runtime.payloadDigest
    || !authoritySnapshot
    || authoritySnapshot.bindingId !== runtime.authorityBindingId
    || authoritySnapshot.resolvedPayloadDigest !== runtime.payloadDigest
    || !governanceCase
    || governanceCase.originKind !== "native_invocation"
    || governanceCase.homeIdentityBindingId !== runtime.homeIdentityBindingId
    || governanceCase.primaryRequestId !== request.id
    || governanceCase.invocationId !== invocation.id
    || governanceCase.profileBindingId !== runtime.profileBindingId
    || governanceCase.actionContractVersionId !== runtime.contractVersionId
    || governanceCase.subjectType !== "revision_direction"
    || governanceCase.subjectRef !== proposal.revisionProposalId
    || hashCanonicalGovernanceValue(
      "alcheme.governance.action-payload",
      governanceCase.requestedActionPayload,
    ) !== runtime.payloadDigest
    || request.caseRef !== governanceCase.id
  ) {
    throw new Error("crystallization_governed_route_runtime_mismatch");
  }
  return {
    actionType: input.actionType,
    targetType: "revision_direction",
    targetRef: proposal.revisionProposalId,
    payloadDigest: runtime.payloadDigest,
    governancePolicyId: request.policyId,
    governancePolicyVersionId: request.policyVersionId,
    governancePolicyVersion: request.policyVersion,
    governanceRuleId: request.ruleId,
    contractVersionId: runtime.contractVersionId,
    authorityBindingId: runtime.authorityBindingId,
    profileBindingId: runtime.profileBindingId,
    invocationId: invocation.id,
    requestId: request.id,
    caseId: governanceCase.id,
  };
}

export async function evaluateTemporaryEditGrantGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    draftPostId: number;
    draftVersion: number;
    grantId: string;
    blockId: string;
    granteeUserId: number;
    requestedBy: number;
    actorPubkey: string;
    requestNote?: string | null;
  },
  options: { transactionClient?: boolean } = {},
): Promise<
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicDraftGovernanceRequest> }
> {
  return openDraftGovernanceRequest(prisma, {
    actionType: TEMPORARY_EDIT_GRANT_APPROVE_ACTION_TYPE,
    targetCircleId: input.circleId,
    targetType: "temporary_edit_grant",
    targetRef: input.grantId,
    proposerPubkey: input.actorPubkey,
    payload: {
      grantId: input.grantId,
      draftPostId: input.draftPostId,
      draftVersion: input.draftVersion,
      blockId: input.blockId,
      granteeUserId: input.granteeUserId,
      requestedBy: input.requestedBy,
      requestNote: input.requestNote ?? null,
    },
  }, options);
}

export async function evaluateRevisionDirectionGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    draftPostId: number;
    draftVersion: number;
    revisionProposalId: string;
    scopeType: string;
    scopeRef: string;
    summary: string;
    proposedBy: number;
    actorPubkey: string;
  },
  options: { transactionClient?: boolean } = {},
): Promise<
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicDraftGovernanceRequest> }
> {
  return openDraftGovernanceRequest(prisma, {
    actionType: REVISION_DIRECTION_ACCEPT_ACTION_TYPE,
    targetCircleId: input.circleId,
    targetType: "revision_direction",
    targetRef: input.revisionProposalId,
    proposerPubkey: input.actorPubkey,
    payload: {
      revisionProposalId: input.revisionProposalId,
      draftPostId: input.draftPostId,
      draftVersion: input.draftVersion,
      scopeType: input.scopeType,
      scopeRef: input.scopeRef,
      summary: input.summary,
      proposedBy: input.proposedBy,
    },
  }, options);
}

export async function resolveRevisionDirectionGovernanceAuthority(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
  },
  options: { transactionClient?: boolean } = {},
) {
  return createDraftGovernanceGateway(prisma, options).evaluate({
    actionType: REVISION_DIRECTION_ACCEPT_ACTION_TYPE,
    targetCircleId: input.circleId,
    actorPubkey: input.actorPubkey,
    directAllowed: false,
  });
}

export async function executeDraftGovernanceAction(
  prisma: PrismaClient,
  request: {
    id: string;
    homeIdentityBindingId?: string | null;
    invocationId?: string | null;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
    proposerPubkey?: string | null;
    state?: string | null;
    executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
    executionModeDigest?: string | null;
    compatibilityBundleVersion?: string | null;
  },
  options: {
    now?: Date;
    decisionDigest?: string | null;
    createReceiptId?: () => string;
  } = {},
): Promise<{
  executionStatus: "executed" | "skipped";
  executionRef: string | null;
  errorCode?: string | null;
  receipt?: GovernanceExecutionReceiptRecord | null;
} | null> {
  const payload = normalizeRecord(request.payload);

  if (request.actionType === TEMPORARY_EDIT_GRANT_APPROVE_ACTION_TYPE) {
    if (request.targetType !== "temporary_edit_grant") return null;
    const grantId = parseNonEmptyString(payload.grantId) ?? request.targetRef;
    if (!grantId || grantId !== request.targetRef) {
      throw new Error("invalid_temporary_edit_grant_governance_target");
    }
    const store = createPrismaTemporaryEditGrantStore(prisma as any);
    const issued = await issueTemporaryEditGrant(store, {
      grantId,
      grantedBy: null,
      grantedAt: new Date(),
      expiresAt: parseOptionalDate(payload.expiresAt),
    });
    return {
      executionStatus: "executed",
      executionRef: issued.grantId,
    };
  }

  if (isRevisionDirectionAcceptActionType(request.actionType)) {
    if (request.targetType !== "revision_direction") return null;
    const revisionProposalId =
      parseNonEmptyString(payload.revisionProposalId) ?? request.targetRef;
    if (!revisionProposalId || revisionProposalId !== request.targetRef) {
      throw new Error("invalid_revision_direction_governance_target");
    }
    if (!/^[a-f0-9]{64}$/.test(options.decisionDigest ?? "")) {
      throw new Error("governance_decision_digest_required");
    }
    const applied = await prisma.$transaction(async (tx) => {
      const current = await assertRevisionDirectionExecutionAuthority(tx, {
        ...request,
        revisionProposalId,
      }, options.now ?? new Date(), options.decisionDigest!);
      const proposal = await applyGovernedRevisionDirectionOutcome(
        createPrismaRevisionDirectionStore(tx),
        {
          revisionProposalId: current.proposal.revisionProposalId,
          outcome: "accepted",
          decidedAt: options.now ?? new Date(),
        },
      );
      await activateGovernedDraftCrystallization(tx, {
        draftPostId: current.proposal.draftPostId,
        draftVersion: current.proposal.draftVersion,
        actorUserId: current.proposal.proposedBy,
        policyProfileDigest: current.policyProfileDigest,
        now: options.now ?? new Date(),
      });
      const receipt = await recordExecutionReceipt(
        createPrismaGovernanceEngineStore(tx),
        {
          id: options.createReceiptId?.() ?? randomUUID(),
          requestId: request.id,
          actionType: request.actionType,
          executorModule: "draft_governance",
          executionStatus: "executed",
          executionRef: proposal.revisionProposalId,
          errorCode: null,
          decisionDigest: options.decisionDigest!,
          idempotencyKey: `${request.actionType}:${request.targetRef}`,
          executionMode: request.executionMode ?? null,
          executionModeDigest: request.executionModeDigest ?? null,
          compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
          executedAt: options.now ?? new Date(),
        },
      );
      if (
        receipt.executionStatus !== "executed"
        || receipt.executionRef !== proposal.revisionProposalId
        || receipt.decisionDigest !== options.decisionDigest
      ) {
        throw new Error("revision_direction_execution_receipt_conflict");
      }
      return { proposal, receipt };
    });
    return {
      executionStatus: "executed",
      executionRef: applied.proposal.revisionProposalId,
      receipt: applied.receipt,
    };
  }

  return null;
}

async function assertRevisionDirectionExecutionAuthority(
  prisma: Prisma.TransactionClient,
  request: {
    id: string;
    homeIdentityBindingId?: string | null;
    invocationId?: string | null;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
    proposerPubkey?: string | null;
    state?: string | null;
    executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
    executionModeDigest?: string | null;
    compatibilityBundleVersion?: string | null;
    revisionProposalId: string;
  },
  now: Date,
  decisionDigest: string,
): Promise<{
  proposal: RevisionDirectionProposalRecord;
  policyProfileDigest: string;
}> {
  const proposal = await createPrismaRevisionDirectionStore(prisma).getProposal(
    request.revisionProposalId,
  );
  if (
    !proposal
    || proposal.revisionProposalId !== request.targetRef
    || proposal.acceptanceMode !== "governance_request"
    || proposal.governanceRequestId !== request.id
    || proposal.status !== "open"
  ) {
    throw new Error("revision_direction_execution_subject_not_current");
  }
  const proposalPayload = revisionDirectionActionPayload(proposal);
  const proposalPayloadDigest = hashCanonicalGovernanceValue(
    "alcheme.governance.action-payload",
    proposalPayload,
  );
  const requestPayload = normalizeRecord(request.payload);
  if (
    hashCanonicalGovernanceValue(
      "alcheme.governance.action-payload",
      {
        revisionProposalId: requestPayload.revisionProposalId,
        draftPostId: requestPayload.draftPostId,
        draftVersion: requestPayload.draftVersion,
        scopeType: requestPayload.scopeType,
        scopeRef: requestPayload.scopeRef,
        summary: requestPayload.summary,
        proposedBy: requestPayload.proposedBy,
      },
    ) !== proposalPayloadDigest
  ) {
    throw new Error("revision_direction_execution_payload_mismatch");
  }

  const workflow = await prisma.draftWorkflowState.findUnique({
    where: { draftPostId: proposal.draftPostId },
  });
  if (
    !workflow
    || !workflow.circleId
    || workflow.documentStatus !== "review"
    || workflow.currentSnapshotVersion !== proposal.draftVersion
  ) {
    throw new Error("revision_direction_execution_draft_not_current");
  }
  const snapshot = await loadDraftVersionSnapshot(prisma, {
    draftPostId: proposal.draftPostId,
    draftVersion: proposal.draftVersion,
  });
  const receipt = snapshot?.crystallizationRoutingReceipt;
  const currentPublicationPolicyDigest = computePolicyProfileDigest(
    buildPublicPolicyDigestSnapshot(
      await resolveCirclePolicyProfile(prisma as any, workflow.circleId),
    ),
  );
  if (
    !snapshot
    || !receipt
    || receipt.path !== "governed_case"
    || receipt.actionType !== request.actionType
    || receipt.targetRef !== proposal.revisionProposalId
    || receipt.requestId !== request.id
    || receipt.policyProfileDigest !== currentPublicationPolicyDigest
  ) {
    throw new Error("revision_direction_execution_case_route_missing");
  }

  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeDraftGovernanceActions: true,
  });
  const definition = registry.get(request.actionType);
  if (!definition || definition.targetType !== "revision_direction") {
    throw new Error("revision_direction_execution_action_unregistered");
  }
  const binding = await resolveActiveCircleGovernanceBinding(prisma as any, {
    targetCircleId: workflow.circleId,
    actionType: request.actionType,
    purpose: "collective_decision",
    now,
  });
  if (!binding) throw new Error("revision_direction_execution_binding_not_live");
  const runtime = await resolveGovernedActionGatewayRuntime({
    prisma: prisma as any,
    transactionClient: true,
  }, {
    definition,
    targetCircleId: workflow.circleId,
    targetType: "revision_direction",
    targetRef: proposal.revisionProposalId,
    binding: binding.binding,
    payload: proposalPayload,
    appendCircleBindingFacts: true,
    now,
  });
  const canonicalRequest = await prisma.governanceRequest.findUnique({
    where: { id: request.id },
    include: {
      invocation: { include: { authoritySnapshot: true } },
      governanceCase: true,
      decision: true,
    },
  });
  const invocation = canonicalRequest?.invocation;
  const authoritySnapshot = invocation?.authoritySnapshot;
  const governanceCase = canonicalRequest?.governanceCase;
  const decision = canonicalRequest?.decision;
  const requestPolicy = runtime.requestPolicy ?? binding.binding;
  const payloadDigest = runtime.payloadDigest;
  if (
    !canonicalRequest
    || canonicalRequest.state !== "accepted"
    || canonicalRequest.actionType !== request.actionType
    || canonicalRequest.targetType !== "revision_direction"
    || canonicalRequest.targetRef !== proposal.revisionProposalId
    || canonicalRequest.proposerPubkey !== request.proposerPubkey
    || canonicalRequest.homeIdentityBindingId !== request.homeIdentityBindingId
    || canonicalRequest.invocationId !== request.invocationId
    || canonicalRequest.executionModeDigest !== request.executionModeDigest
    || canonicalRequest.policyId !== requestPolicy.policyId
    || canonicalRequest.policyVersionId !== requestPolicy.policyVersionId
    || canonicalRequest.policyVersion !== requestPolicy.policyVersion
    || canonicalRequest.ruleId !== requestPolicy.ruleId
    || canonicalRequest.scopeType !== "circle_governance_committee"
    || canonicalRequest.scopeRef !== String(requestPolicy.committeeCircleId)
    || canonicalRequest.homeIdentityBindingId !== runtime.homeIdentityBindingId
    || canonicalRequest.executionModeDigest !== runtime.executionModeDigest
    || !decision
    || decision.decision !== "accepted"
    || decision.decisionDigest !== decisionDigest
    || hashCanonicalGovernanceValue(
      "alcheme.governance.action-payload",
      request.payload ?? {},
    ) !== payloadDigest
    || hashCanonicalGovernanceValue(
      "alcheme.governance.action-payload",
      canonicalRequest.payload,
    ) !== payloadDigest
    || !invocation
    || invocation.contractVersionId !== runtime.contractVersionId
    || invocation.profileBindingId !== runtime.profileBindingId
    || invocation.preflightDigest !== runtime.executionModeDigest
    || invocation.subjectType !== "revision_direction"
    || invocation.subjectRef !== proposal.revisionProposalId
    || invocation.payloadDigest !== payloadDigest
    || !authoritySnapshot
    || authoritySnapshot.bindingId !== runtime.authorityBindingId
    || authoritySnapshot.resolvedSubjectDigest !== hashCanonicalGovernanceValue(
      "alcheme.governance.action-subject",
      { targetType: "revision_direction", targetRef: proposal.revisionProposalId },
    )
    || authoritySnapshot.resolvedPayloadDigest !== payloadDigest
    || authoritySnapshot.liveConfigDigest !== runtime.executionModeDigest
    || !governanceCase
    || receipt.payloadDigest !== payloadDigest
    || canonicalRequest.caseRef !== governanceCase.id
    || governanceCase.id !== receipt.caseId
    || governanceCase.primaryRequestId !== canonicalRequest.id
    || governanceCase.invocationId !== invocation.id
    || governanceCase.subjectType !== "revision_direction"
    || governanceCase.subjectRef !== proposal.revisionProposalId
    || governanceCase.briefDraftPostId !== proposal.draftPostId
    || governanceCase.briefDraftVersion !== proposal.draftVersion
    || governanceCase.briefSnapshotDigest !== snapshot.contentHash
  ) {
    throw new Error("revision_direction_execution_authority_mismatch");
  }
  return {
    proposal,
    policyProfileDigest: receipt.policyProfileDigest,
  };
}

async function openDraftGovernanceRequest(
  prisma: PrismaClient,
  input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    proposerPubkey: string;
    payload: Record<string, unknown>;
  },
  options: { transactionClient?: boolean } = {},
) {
  const gateway = createDraftGovernanceGateway(prisma, options);
  const decision = await gateway.evaluate({
    actionType: input.actionType,
    targetCircleId: input.targetCircleId,
    actorPubkey: input.proposerPubkey,
    directAllowed: false,
  });
  if (decision.status !== "requires_governance") {
    return {
      status: "denied" as const,
      error: decision.reason,
    };
  }

  const idempotencyKey = buildDraftGovernanceIdempotencyKey({
    actionType: input.actionType,
    targetRef: input.targetRef,
    payload: input.payload,
  });
  const existingRequest = await findActiveDraftGovernanceRequest(prisma as any, {
    actionType: input.actionType,
    targetType: input.targetType,
    targetRef: input.targetRef,
    committeeCircleId: decision.committeeCircleId,
    idempotencyKey,
  });
  if (existingRequest) {
    const request = existingRequest as any;
    return {
      status: "requires_governance" as const,
      actionType: request.actionType ?? input.actionType,
      request: publicDraftGovernanceRequest(request),
    };
  }

  const request = await gateway.openRequest({
    actionType: input.actionType,
    targetCircleId: input.targetCircleId,
    targetType: input.targetType,
    targetRef: input.targetRef,
    payload: input.payload,
    idempotencyKey,
    proposerPubkey: input.proposerPubkey,
  });
  return {
    status: "requires_governance" as const,
    actionType: input.actionType,
    request: publicDraftGovernanceRequest(request),
  };
}

function createDraftGovernanceGateway(
  prisma: PrismaClient,
  options: { transactionClient?: boolean },
): GovernedActionGateway {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeDraftGovernanceActions: true,
  });
  return new GovernedActionGateway({
    registry,
    resolveBinding: (bindingInput) =>
      resolveActiveCircleGovernanceBinding(prisma as any, bindingInput),
    listCommitteeEligibleActors: (eligibleInput) =>
      listCommitteeEligibleActors(prisma as any, eligibleInput),
    requestStore: createPrismaGovernanceRequestStore(prisma as any),
    runtimePrisma: prisma as any,
    runtimeTransactionClient: options.transactionClient === true,
  });
}

async function findActiveDraftGovernanceRequest(
  prisma: {
    governanceRequest?: {
      findFirst(input: unknown): Promise<unknown | null>;
    };
  },
  input: {
    actionType: string;
    targetType: string;
    targetRef: string;
    committeeCircleId: number;
    idempotencyKey: string;
  },
): Promise<unknown | null> {
  if (typeof prisma.governanceRequest?.findFirst !== "function") return null;
  return prisma.governanceRequest.findFirst({
    where: {
      actionType: input.actionType,
      targetType: input.targetType,
      targetRef: input.targetRef,
      scopeType: "circle_governance_committee",
      scopeRef: String(input.committeeCircleId),
      state: "active",
      idempotencyKey: input.idempotencyKey,
    },
    include: { snapshot: true },
  });
}

function buildDraftGovernanceIdempotencyKey(input: {
  actionType: string;
  targetRef: string;
  payload: Record<string, unknown>;
}): string {
  const digest = createHash("sha256")
    .update(stableJsonStringify(input.payload))
    .digest("hex")
    .slice(0, 24);
  return `draft:${input.actionType}:${input.targetRef}:${digest}`;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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
