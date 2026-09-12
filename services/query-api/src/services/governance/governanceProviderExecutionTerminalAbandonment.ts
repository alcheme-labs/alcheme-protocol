import {
  GOVERNANCE_PROVIDER_EXECUTION_COMPENSATION_PLAN_ACTION_TYPE,
  GOVERNANCE_PROVIDER_EXECUTION_TERMINAL_ABANDON_ACTION_TYPE,
} from "./actionRegistry";
import { hashCanonicalGovernanceValue } from "./canonicalCodec";
import {
  resolveActiveCircleGovernanceBinding,
  type FrozenGovernanceCaseAuthorityReference,
} from "./circleGovernanceBindings";
import { createGovernanceCaseIntake } from "./governanceCase";
import {
  buildGovernanceProviderExecutionTerminalAbandonmentPayload,
  projectGovernanceProviderExecutionProgressReadback,
} from "./readProjection";

export async function resolveGovernanceProviderTerminalAbandonmentExecutionBlocker(
  prisma: any,
  requestId: string,
): Promise<string | null> {
  if (
    typeof prisma?.governanceRequest?.findUnique !== "function" ||
    typeof prisma?.governanceCase?.findUnique !== "function"
  )
    return null;
  const [request, originalCase] = await Promise.all([
    prisma.governanceRequest.findUnique({
      where: { id: requestId },
      include: {
        decision: true,
        receipts: { orderBy: { executedAt: "asc" } },
        invocation: {
          include: {
            costPreflights: {
              orderBy: { checkedAt: "desc" },
              take: 1,
              include: { payerPolicy: true },
            },
          },
        },
      },
    }),
    prisma.governanceCase.findUnique({
      where: { primaryRequestId: requestId },
      select: {
        id: true,
        relatedCases: {
          where: { relationshipKind: "supersedes" },
          orderBy: { openedAt: "desc" },
          select: {
            id: true,
            caseType: true,
            subjectType: true,
            subjectRef: true,
            relationshipKind: true,
            relatedCaseId: true,
            requestedActionPayload: true,
            briefDraftPostId: true,
            briefDraftVersion: true,
            briefSnapshotDigest: true,
            primaryRequest: {
              select: { id: true, state: true, decision: true },
            },
            decisionOutputArtifacts: { orderBy: { ordinal: "asc" } },
            responsibilities: { orderBy: { kind: "asc" } },
          },
        },
      },
    }),
  ]);
  if (!request || !originalCase) return null;
  const progress = projectGovernanceProviderExecutionProgressReadback({
    ...request,
    governanceCase: { id: originalCase.id },
    providerExecutionTerminalAbandonmentCases: originalCase.relatedCases,
  }) as any;
  return progress?.compensation?.state === "compensation_required" &&
    progress?.nextGate === "separate_governed_compensation_execution"
    ? "governance_provider_execution_terminally_abandoned"
    : null;
}

export async function openGovernanceProviderExecutionTerminalAbandonmentCase(
  prisma: any,
  input: {
    caseId: string;
    reason: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; governanceCase: any }> {
  const caseId = requiredText(
    input.caseId,
    "governance_provider_terminal_abandonment_case_required",
  );
  const reason = requiredText(
    input.reason,
    "governance_provider_terminal_abandonment_reason_required",
  );
  const actorPubkey = requiredText(
    input.actorPubkey,
    "governance_provider_terminal_abandonment_actor_required",
  );
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    "governance_provider_terminal_abandonment_idempotency_key_required",
  );
  if (idempotencyKey.length < 8 || reason.length > 2000) {
    throw new Error("governance_provider_terminal_abandonment_input_invalid");
  }
  const now = input.now ?? new Date();
  const run = async (tx: any) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: {
        primaryRequest: {
          include: {
            decision: true,
            receipts: { orderBy: { executedAt: "asc" } },
            invocation: {
              include: {
                costPreflights: {
                  orderBy: { checkedAt: "desc" },
                  take: 1,
                  include: { payerPolicy: true },
                },
              },
            },
          },
        },
      },
    });
    const circleId =
      governanceCase?.subjectType === "circle"
        ? Number(governanceCase.subjectRef)
        : NaN;
    const request = governanceCase?.primaryRequest;
    if (
      !governanceCase ||
      !Number.isSafeInteger(circleId) ||
      circleId <= 0 ||
      request?.state !== "accepted" ||
      request?.decision?.decision !== "accepted"
    )
      throw new Error(
        "governance_provider_terminal_abandonment_source_invalid",
      );

    const frozenAuthority = frozenMandateAuthority(governanceCase);
    const authorityResolution = await resolveActiveCircleGovernanceBinding(tx, {
      targetCircleId: circleId,
      actionType: GOVERNANCE_PROVIDER_EXECUTION_TERMINAL_ABANDON_ACTION_TYPE,
      purpose: "collective_decision",
      now,
      frozenCaseAuthority: frozenAuthority,
    });
    if (
      !authorityResolution ||
      authorityResolution.binding.id !== frozenAuthority.projectionBindingId
    )
      throw new Error(
        "governance_provider_terminal_abandonment_authority_unavailable",
      );

    const requestedActionPayload =
      buildGovernanceProviderExecutionTerminalAbandonmentPayload(
        { ...request, governanceCase: { id: governanceCase.id } },
        reason,
      );
    return createGovernanceCaseIntake(tx, {
      circleId,
      title: `Terminally abandon partial Provider execution ${request.id}`,
      requestedDecision: `Should the original Decision authority terminally abandon the remaining Provider actions and require a separately governed compensation plan? ${reason}`,
      requestedActionPayload,
      caseType: "policy",
      templateId: "basic-community",
      actionType: GOVERNANCE_PROVIDER_EXECUTION_TERMINAL_ABANDON_ACTION_TYPE,
      subjectType: "circle",
      subjectRef: String(circleId),
      authorityBindingId: authorityResolution.binding.id,
      authorityResolution,
      decisionMechanismKind: "equal_weight_threshold",
      originKind: "manual_item",
      sourceMessageIds: [],
      idempotencyKey,
      openedByPubkey: actorPubkey,
      actorRole: input.actorRole,
      relationshipKind: "supersedes",
      relatedCaseId: governanceCase.id,
      relationshipReason: reason,
      openedAt: now,
    });
  };
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction((tx: any) => run(tx))
    : run(prisma);
}

export interface GovernanceProviderExecutionCompensationPlanPayload
  extends Record<string, unknown> {
  kind: "provider_execution_compensation_plan";
  originalCaseId: string;
  originalRequestId: string;
  originalDecisionDigest: string;
  terminalAbandonmentCaseId: string;
  terminalAbandonmentDecisionDigest: string;
  compensationOwner: {
    authority: "terminal_abandonment_case_execution_responsibility";
    pubkey: string;
    responsibilityVersion: number;
    status: "assigned" | "accepted";
    deadlineAt: string | null;
  };
  completedActionReceiptDigests: string[];
  remainingActionIds: string[];
  irreversibleChanges: string[];
  actionBoundary: {
    directOperatorMutationAllowed: false;
    originalActionIntentMutationAllowed: false;
    compensationActionIntentRequired: true;
    newAssetImpactRequiresIndependentDecision: true;
    newAuthorityImpactRequiresIndependentDecision: true;
  };
  executionBoundary: {
    mode: "separate_governed_execution_required";
    providerEffectBeforeAcceptedCompensationDecisionAllowed: false;
    payerOrAuthoritySubstitutionAllowed: false;
  };
  reason: string;
}

export async function openGovernanceProviderExecutionCompensationPlanCase(
  prisma: any,
  input: {
    caseId: string;
    reason: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; governanceCase: any }> {
  const caseId = requiredText(
    input.caseId,
    "governance_provider_compensation_plan_case_required",
  );
  const reason = requiredText(
    input.reason,
    "governance_provider_compensation_plan_reason_required",
  );
  const actorPubkey = requiredText(
    input.actorPubkey,
    "governance_provider_compensation_plan_actor_required",
  );
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    "governance_provider_compensation_plan_idempotency_key_required",
  );
  if (idempotencyKey.length < 8 || reason.length > 2000) {
    throw new Error("governance_provider_compensation_plan_input_invalid");
  }
  const now = input.now ?? new Date();
  const run = async (tx: any) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: {
        primaryRequest: {
          include: {
            decision: true,
            receipts: { orderBy: { executedAt: "asc" } },
            invocation: {
              include: {
                costPreflights: {
                  orderBy: { checkedAt: "desc" },
                  take: 1,
                  include: { payerPolicy: true },
                },
              },
            },
          },
        },
        relatedCases: {
          where: { relationshipKind: "supersedes" },
          orderBy: { openedAt: "desc" },
          select: {
            id: true,
            caseType: true,
            subjectType: true,
            subjectRef: true,
            relationshipKind: true,
            relatedCaseId: true,
            requestedActionPayload: true,
            briefDraftPostId: true,
            briefDraftVersion: true,
            briefSnapshotDigest: true,
            primaryRequest: {
              select: { id: true, state: true, decision: true },
            },
            decisionOutputArtifacts: { orderBy: { ordinal: "asc" } },
            responsibilities: { orderBy: { kind: "asc" } },
          },
        },
      },
    });
    const circleId =
      governanceCase?.subjectType === "circle"
        ? Number(governanceCase.subjectRef)
        : NaN;
    const request = governanceCase?.primaryRequest;
    if (
      !governanceCase ||
      !Number.isSafeInteger(circleId) ||
      circleId <= 0 ||
      request?.state !== "accepted" ||
      request?.decision?.decision !== "accepted"
    )
      throw new Error("governance_provider_compensation_plan_source_invalid");

    const frozenAuthority = frozenMandateAuthority(governanceCase);
    const authorityResolution = await resolveActiveCircleGovernanceBinding(tx, {
      targetCircleId: circleId,
      actionType: GOVERNANCE_PROVIDER_EXECUTION_COMPENSATION_PLAN_ACTION_TYPE,
      purpose: "collective_decision",
      now,
      frozenCaseAuthority: frozenAuthority,
    });
    if (
      !authorityResolution ||
      authorityResolution.binding.id !== frozenAuthority.projectionBindingId
    )
      throw new Error("governance_provider_compensation_plan_authority_unavailable");

    const requestedActionPayload =
      buildGovernanceProviderExecutionCompensationPlanPayload(
        {
          ...request,
          governanceCase: { id: governanceCase.id },
          providerExecutionTerminalAbandonmentCases: governanceCase.relatedCases,
        },
        reason,
      );
    return createGovernanceCaseIntake(tx, {
      circleId,
      title: `Govern Provider execution compensation plan ${request.id}`,
      requestedDecision: `Should the original Decision authority open a separate frozen compensation or rollback plan for the terminally abandoned Provider execution without mutating the original ActionIntent? ${reason}`,
      requestedActionPayload,
      caseType: "policy",
      templateId: "basic-community",
      actionType: GOVERNANCE_PROVIDER_EXECUTION_COMPENSATION_PLAN_ACTION_TYPE,
      subjectType: "circle",
      subjectRef: String(circleId),
      authorityBindingId: authorityResolution.binding.id,
      authorityResolution,
      decisionMechanismKind: "equal_weight_threshold",
      originKind: "manual_item",
      sourceMessageIds: [],
      idempotencyKey,
      openedByPubkey: actorPubkey,
      actorRole: input.actorRole,
      relationshipKind: "related",
      relatedCaseId: requestedActionPayload.terminalAbandonmentCaseId,
      relationshipReason: reason,
      openedAt: now,
    });
  };
  return typeof prisma.$transaction === "function"
    ? prisma.$transaction((tx: any) => run(tx))
    : run(prisma);
}

export function buildGovernanceProviderExecutionCompensationPlanPayload(
  request: any,
  reason: string,
): GovernanceProviderExecutionCompensationPlanPayload {
  const originalCaseId = requiredPayloadText(
    request?.governanceCase?.id,
    "governance_provider_compensation_plan_original_case_required",
  );
  const originalRequestId = requiredPayloadText(
    request?.id,
    "governance_provider_compensation_plan_request_required",
  );
  const originalDecisionDigest = requiredSha256(
    request?.decision?.decisionDigest,
    "governance_provider_compensation_plan_decision_digest_required",
  );
  const normalizedReason = requiredPayloadText(
    reason,
    "governance_provider_compensation_plan_reason_required",
  );
  const progress = projectGovernanceProviderExecutionProgressReadback(request) as any;
  const owner = progress?.compensation?.owner;
  const completed = Array.isArray(progress?.completed) ? progress.completed : [];
  const remaining = Array.isArray(progress?.remaining)
    ? progress.remaining.map((item: unknown) => String(item))
    : [];
  if (
    progress?.state !== "partially_executed" ||
    progress?.compensation?.state !== "compensation_required" ||
    progress?.nextGate !== "separate_governed_compensation_execution" ||
    owner?.authority !== "terminal_abandonment_case_execution_responsibility" ||
    !completed.length ||
    !remaining.length
  ) throw new Error("governance_provider_compensation_plan_required");
  const terminalAbandonmentCaseId = requiredPayloadText(
    owner.caseId,
    "governance_provider_compensation_plan_terminal_case_required",
  );
  const terminalAbandonmentDecisionDigest = requiredSha256(
    progress.compensation.governingDecisionDigest,
    "governance_provider_compensation_plan_terminal_decision_required",
  );
  const responsibilityVersion = Number(owner.responsibilityVersion);
  const status = String(owner.status ?? "");
  if (
    !requiredPayloadText(owner.pubkey, "governance_provider_compensation_plan_owner_required") ||
    !Number.isSafeInteger(responsibilityVersion) ||
    responsibilityVersion <= 0 ||
    !["assigned", "accepted"].includes(status)
  ) throw new Error("governance_provider_compensation_plan_owner_invalid");
  return {
    kind: "provider_execution_compensation_plan",
    originalCaseId,
    originalRequestId,
    originalDecisionDigest,
    terminalAbandonmentCaseId,
    terminalAbandonmentDecisionDigest,
    compensationOwner: {
      authority: "terminal_abandonment_case_execution_responsibility",
      pubkey: String(owner.pubkey),
      responsibilityVersion,
      status: status as "assigned" | "accepted",
      deadlineAt: owner.deadlineAt ? String(owner.deadlineAt) : null,
    },
    completedActionReceiptDigests: completed.map((item: any) => (
      hashCanonicalGovernanceValue(
        "alcheme.governance.provider-action-receipt-v1",
        { stepId: item.stepId, actionReceipt: item.actionReceipt },
      )
    )),
    remainingActionIds: remaining,
    irreversibleChanges: completed.map((item: any) => (
      `${String(item.stepId)} finalized at provider slot ${Number(item.actionReceipt?.observedSlot)}`
    )),
    actionBoundary: {
      directOperatorMutationAllowed: false,
      originalActionIntentMutationAllowed: false,
      compensationActionIntentRequired: true,
      newAssetImpactRequiresIndependentDecision: true,
      newAuthorityImpactRequiresIndependentDecision: true,
    },
    executionBoundary: {
      mode: "separate_governed_execution_required",
      providerEffectBeforeAcceptedCompensationDecisionAllowed: false,
      payerOrAuthoritySubstitutionAllowed: false,
    },
    reason: normalizedReason,
  };
}

function frozenMandateAuthority(
  governanceCase: any,
): FrozenGovernanceCaseAuthorityReference {
  const authority = governanceCase?.templateSelection?.actionAuthority;
  const openedAt =
    governanceCase?.openedAt instanceof Date
      ? governanceCase.openedAt
      : new Date(String(governanceCase?.openedAt ?? ""));
  const frozen = {
    openedAt,
    projectionBindingId: String(authority?.projectionBindingId ?? ""),
    mandateId: String(authority?.mandateId ?? ""),
    mandateVersion: Number(authority?.mandateVersion),
    mandateTermsDigest: String(authority?.mandateTermsDigest ?? ""),
    subjectType: String(authority?.subject?.type ?? ""),
    subjectRef: String(authority?.subject?.ref ?? ""),
    policy: {
      id: String(authority?.policy?.id ?? ""),
      versionId: String(authority?.policy?.versionId ?? ""),
      version: Number(authority?.policy?.version),
      ruleId: String(authority?.policy?.ruleId ?? ""),
    },
  };
  if (
    authority?.sourceType !== "governance_mandate" ||
    !Number.isFinite(openedAt.getTime()) ||
    !frozen.projectionBindingId ||
    !frozen.mandateId ||
    !Number.isSafeInteger(frozen.mandateVersion) ||
    frozen.mandateVersion <= 0 ||
    !/^[a-f0-9]{64}$/.test(frozen.mandateTermsDigest) ||
    !frozen.policy.id ||
    !frozen.policy.versionId ||
    !Number.isSafeInteger(frozen.policy.version) ||
    frozen.policy.version <= 0 ||
    !frozen.policy.ruleId
  )
    throw new Error(
      "governance_provider_terminal_abandonment_frozen_authority_invalid",
    );
  return frozen;
}

function requiredText(value: unknown, errorCode: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function requiredPayloadText(value: unknown, errorCode: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function requiredSha256(value: unknown, errorCode: string): string {
  const normalized = requiredPayloadText(value, errorCode);
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(errorCode);
  return normalized;
}
