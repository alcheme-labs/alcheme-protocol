import {
  GovernedActionRegistry,
  governedActionUnavailableReason,
  type GovernedActionDefinition,
} from './actionRegistry';
import {
  getGovernanceCaseActionRegistry,
  resolveGovernanceCaseActionDefinitionForDecision,
} from './governanceCaseActionComposition';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  listCommitteeEligibleActors,
  hasGovernanceCommitteeOperator,
  resolveActiveCircleGovernanceBinding,
  type FrozenGovernanceCaseAuthorityReference,
} from './circleGovernanceBindings';
import { GovernedActionGateway } from './governedActionGateway';
import { resolveGovernedActionDecisionStageRuntime } from './governedActionGatewayRuntime';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { createPrismaGovernanceEngineStore, recordExecutionReceipt } from './policyEngine';
import {
  assertGovernanceCaseReviewRelationshipSignoffGate,
  GovernanceCaseWorkflowError,
} from './governanceCaseWorkflow';
import {
  governanceCaseActionAuthorityMatchesResolution,
  governanceCaseTemplateSelectionDigest,
  NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY,
  type GovernanceCaseConflictOfInterestPolicy,
} from './governanceCaseTemplate';
import {
  evaluateCommitteeMemberThreshold,
  resolveCommitteeMemberThresholdConfig,
} from './strategies/committeeMemberThreshold';
import {
  buildNativeGovernanceMechanismContract,
  notApplicableReviewMechanism,
  type NativeGovernanceMechanismContract,
  type NotApplicableGovernanceMechanism,
} from './nativeGovernanceMechanism';
import {
  buildGovernanceExecutionResourceMappingArtifact,
  buildGovernanceInternalExecutionPlanArtifact,
  buildGovernanceManualExecutionPlanArtifact,
  buildNativeDecisionOutputArtifact,
  decisionOutputArtifactMatches,
  persistExternalAppAppealResolutionOutputArtifact,
} from './decisionOutputArtifact';
import {
  isCurrentGovernanceCaseFrozenEvidencePolicy,
  type GovernanceCaseFrozenEvidencePolicy,
} from './governanceEvidenceShare';
import {
  CIRCLE_GOVERNANCE_BINDING_ACCEPT_MANDATE_ACTION_TYPE,
  CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE,
  CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE,
  CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
  CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE,
  executeCircleGovernanceBindingAction,
  recordCircleGovernanceBindingRejectedDecision,
} from './circleGovernanceBindingExecution';
import {
  EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR,
  executeExternalAppCircleBindingGovernanceAction,
} from '../externalApps/circleBindingExecution';
import {
  EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION,
  EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION,
  EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION,
} from '../externalApps/circleBindingOwnerApplication';
import {
  GOVERNANCE_RECOVERY_POLICY_KIND,
  GOVERNANCE_RECOVERY_RATIFICATION_KIND,
  openGovernanceRecoveryRatificationCase,
  resolveGovernanceRecoveryRatification,
  resolveGovernanceRecoveryCaseAuthority,
} from './governanceRecoveryPolicy';
import { persistGovernanceCaseActionRequiredNotifications } from './governanceCaseActionNotifications';
import {
  communicationMemberMuteAppealPayload,
  communicationMemberMuteRatificationPayload,
  resolveCommunicationMemberMuteAppealInTransaction,
  resolveCommunicationMemberMuteRatificationInTransaction,
  type CommunicationMemberMuteAppealEffectResult,
} from './communicationMemberMuteLifecycle';
import {
  contentVisibilityDownrankAppealPayload,
  resolveContentVisibilityDownrankAppealInTransaction,
  type ContentVisibilityDownrankAppealEffectResult,
} from './contentVisibilityDownrankAppeal';
import { communicationOperationRecurrenceReviewPayload } from './communicationOperationEscalation';
import { setCircleGovernanceCommitteeAvailability } from './circleCommitteeProfiles';
import {
  parseGovernanceFundingAmendmentPayload,
  resolveGovernanceFundingAmendmentInTransaction,
} from './governanceFundingAmendment';
import {
  evaluateGovernanceQuadraticVoiceActivationReadiness,
  evaluateGovernanceQuadraticFundingActivationReadiness,
  type GovernanceQuadraticVoiceActivationReadiness,
  type GovernanceQuadraticFundingActivationReadiness,
} from './governanceResourceReadiness';
import { executeGovernanceProfileTransition } from './governanceProfileTransitionExecution';

const APPROVAL_WINDOW_SECONDS = 72 * 60 * 60;
const EXTERNAL_APP_OWNER_CIRCLE_BINDING_ACTIONS = new Set<string>([
  'external_app_primary_circle_bind',
  EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION,
  EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION,
  EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION,
]);

function isExternalAppOwnerCircleBindingAction(actionType: string): boolean {
  return EXTERNAL_APP_OWNER_CIRCLE_BINDING_ACTIONS.has(actionType);
}

export type GovernanceCaseConflictReason =
  | 'material_relationship'
  | 'financial_interest'
  | 'subject_or_recipient'
  | 'provider_or_operator_role'
  | 'other_public_conflict';

export interface GovernanceCaseConflictDisclosure {
  actorPubkey: string;
  publicReason: GovernanceCaseConflictReason;
}

export interface GovernanceCaseDecisionStagePlan {
  schemaVersion: 1;
  resolutionRule: 'all_required';
  frozenAt: string;
  brief: { draftPostId: number; draftVersion: number; snapshotDigest: string } | null;
  decisionInput:
    | { kind: 'reviewed_brief'; snapshotDigest: string }
    | { kind: 'native_invocation_action'; payloadDigest: string };
  evidencePolicy: GovernanceCaseFrozenEvidencePolicy;
  conflictOfInterest: {
    policy: GovernanceCaseConflictOfInterestPolicy;
    disclosures: GovernanceCaseConflictDisclosure[];
  };
  stages: Array<{
    stageRef: string;
    order: number;
    purpose: 'review_gate' | 'approval';
    institutionalAuthority: { type: string; ref: string; version: string };
    provider: { type: 'alcheme_internal'; version: string };
    mechanism: NativeGovernanceMechanismContract | NotApplicableGovernanceMechanism;
    requiredForApproval: true;
    vetoOnReject: true;
    startCondition: string;
    expiresAt: string | null;
    onExpire: 'block_case' | 'reject_case';
    onUnavailable: 'block_case';
    shortCircuitRule: 'required_rejection_terminates';
    decisionRef: { type: 'case_timeline_event' | 'governance_request'; ref: string };
  }>;
}

export type GovernanceCasePolicySimulationReason =
  | 'ready'
  | 'action_contract_unavailable'
  | 'decision_mechanism_unavailable'
  | 'active_governance_home_required'
  | 'approval_authority_required'
  | 'approval_authority_unavailable'
  | 'approval_policy_rule_unavailable'
  | 'approval_conflict_policy_unavailable'
  | 'approval_conflict_disclosure_invalid'
  | 'approval_electorate_required'
  | 'approval_operator_required'
  | 'approval_voice_credit_budget_required'
  | 'approval_mandate_quorum_unreachable'
  | 'approval_mandate_timelock_pending'
  | 'approval_quorum_unreachable'
  | 'approval_recusal_quorum_unreachable';

export interface GovernanceCasePolicySimulation {
  schemaVersion: 1;
  status: 'ready' | 'blocked';
  reason: GovernanceCasePolicySimulationReason;
  actionType: string | null;
  institutionalAuthority: {
    type: 'circle_governance_committee';
    ref: string;
    version: string;
  } | null;
  provider: {
    type: 'alcheme_internal';
    version: string;
    status: 'ready' | 'unavailable';
  };
  electorate: {
    baseEligibleActorCount: number;
    eligibleActorCount: number;
    recusalCount: number;
    approvalThreshold: number | null;
    quorumReachable: boolean;
  };
  conflictOfInterest: {
    policy: GovernanceCaseConflictOfInterestPolicy;
    disclosures: GovernanceCaseConflictDisclosure[];
    viewerStatus: 'eligible' | 'recused' | 'ineligible';
    canSelfDisclose: boolean;
  };
  quadraticFunding: GovernanceQuadraticFundingActivationReadiness | null;
  quadraticVoice: GovernanceQuadraticVoiceActivationReadiness | null;
}

interface GovernanceCaseApprovalStageResolution {
  simulation: GovernanceCasePolicySimulation;
  definition: GovernedActionDefinition | null;
  binding: Awaited<ReturnType<typeof resolveActiveCircleGovernanceBinding>>;
  baseEligibleActors: Awaited<ReturnType<typeof listCommitteeEligibleActors>>;
  eligibleActors: Awaited<ReturnType<typeof listCommitteeEligibleActors>>;
  disclosures: GovernanceCaseConflictDisclosure[];
  quadraticFunding: GovernanceQuadraticFundingActivationReadiness | null;
  quadraticVoice: GovernanceQuadraticVoiceActivationReadiness | null;
}

export async function simulateGovernanceCaseApprovalStage(
  prisma: any,
  governanceCase: any,
  viewerPubkey?: string | null,
): Promise<GovernanceCasePolicySimulation> {
  return (await resolveGovernanceCaseApprovalStage(
    prisma,
    governanceCase,
    viewerPubkey,
    new Date(),
  )).simulation;
}

export async function recordGovernanceCaseApprovalConflictDisclosure(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    publicReason: GovernanceCaseConflictReason;
    idempotencyKey: string;
    expectedCaseVersion: number;
    now?: Date;
  },
): Promise<{ governanceCase: any; event: any; replayed: boolean }> {
  const actorPubkey = required(input.actorPubkey, 'governance_case_conflict_actor_required');
  const idempotencyKey = required(input.idempotencyKey, 'governance_case_idempotency_key_required');
  if (idempotencyKey.length > 128 || !isConflictReason(input.publicReason)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_conflict_disclosure_invalid');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        homeIdentityBinding: { include: { activationState: true } },
        responsibilities: true,
        timelineEvents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        primaryRequest: { include: { snapshot: true, decision: true } },
        actionContractVersion: true,
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    const replayEvent = governanceCase.timelineEvents.find(
      (event: any) => event.idempotencyKey === idempotencyKey,
    );
    if (replayEvent) {
      if (
        replayEvent.eventType !== 'approval_conflict_disclosed'
        || replayEvent.actorPubkey !== actorPubkey
        || replayEvent.subjectPubkey !== actorPubkey
        || replayEvent.reason !== input.publicReason
      ) throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      return { governanceCase, event: replayEvent, replayed: true };
    }
    if (
      governanceCase.caseVersion !== input.expectedCaseVersion
      || governanceCase.caseType !== 'policy'
      || governanceCase.casePhase !== 'evidence_review'
      || governanceCase.primaryRequestId
      || governanceCase.decisionStagePlanDigest
      || !isCurrentConflictPolicy(governanceCase.templateSelection?.conflictOfInterestPolicy)
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_conflict_disclosure_unavailable');
    }
    if (governanceCase.timelineEvents.some((event: any) => (
      event.eventType === 'approval_conflict_disclosed'
      && event.actorPubkey === actorPubkey
    ))) throw new GovernanceCaseWorkflowError(409, 'governance_case_conflict_already_disclosed');

    const approval = await resolveGovernanceCaseApprovalStage(tx, governanceCase, actorPubkey, now);
    if (!approval.baseEligibleActors.some((actor: any) => actor.pubkey === actorPubkey)) {
      throw new GovernanceCaseWorkflowError(403, 'governance_case_conflict_actor_not_eligible');
    }
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: {
        id: governanceCase.id,
        caseVersion: input.expectedCaseVersion,
        casePhase: 'evidence_review',
        primaryRequestId: null,
        decisionStagePlanDigest: null,
      },
      data: { caseVersion: nextCaseVersion },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    const event = await tx.governanceCaseTimelineEvent.create({ data: {
      id: timelineEventId(governanceCase.id, idempotencyKey),
      caseId: governanceCase.id,
      eventType: 'approval_conflict_disclosed',
      responsibilityKind: null,
      actorPubkey,
      subjectPubkey: actorPubkey,
      fromState: 'evidence_review',
      toState: 'evidence_review',
      reason: input.publicReason,
      idempotencyKey,
      caseVersion: nextCaseVersion,
      responsibilityVersion: null,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      createdAt: now,
    } });
    return {
      governanceCase: { ...governanceCase, caseVersion: nextCaseVersion },
      event,
      replayed: false,
    };
  });
}

export async function openGovernanceCaseApprovalStage(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    idempotencyKey: string;
    expectedCaseVersion: number;
    now?: Date;
  },
): Promise<{ governanceCase: any; request: any; replayed: boolean }> {
  const actorPubkey = required(input.actorPubkey, 'governance_case_decision_actor_required');
  const idempotencyKey = required(input.idempotencyKey, 'governance_case_idempotency_key_required');
  if (idempotencyKey.length > 128) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_idempotency_key_invalid');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: input.caseId },
      include: {
        homeIdentityBinding: { include: { activationState: true } },
        responsibilities: true,
        timelineEvents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        primaryRequest: { include: { snapshot: true, decision: true } },
        actionContractVersion: true,
      },
    });
    if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    const replayEvent = governanceCase.timelineEvents.find(
      (event: any) => event.idempotencyKey === idempotencyKey,
    );
    if (replayEvent) {
      if (
        replayEvent.eventType !== 'decision_stage_plan_frozen'
        || !governanceCase.primaryRequest
        || !governanceCase.decisionStagePlan
      ) {
        throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
      }
      assertFrozenEvidencePolicyMatches(
        governanceCase.decisionStagePlan,
        governanceCase.primaryRequest.payload,
      );
      return { governanceCase, request: governanceCase.primaryRequest, replayed: true };
    }
    assertCaseReady(governanceCase, input.expectedCaseVersion, actorPubkey);
    const circleId = Number(governanceCase.homeIdentityBinding.homeRef);
    const actionType = String(governanceCase.templateSelection.actionContract.actionType);
    const approval = await resolveGovernanceCaseApprovalStage(tx, governanceCase, undefined, now);
    if (
      approval.simulation.status !== 'ready'
      || !approval.definition
      || !approval.binding
      || approval.eligibleActors.length === 0
    ) {
      throw new GovernanceCaseWorkflowError(
        409,
        policySimulationErrorCode(approval.simulation.reason),
      );
    }
    const { definition, binding, disclosures } = approval;
    const mechanism = governanceCase.templateSelection.decisionMechanism;
    const policyConfig = resolveCommitteeMemberThresholdConfig(
      binding.policyVersion.rules,
      binding.binding.ruleId,
    );
    const eligibleActors = mechanism.kind === 'quadratic_voice_credits'
      ? approval.eligibleActors.map((actor: any) => ({
        ...actor,
        creditBudget: policyConfig.quadraticVoiceCredits?.budgetPerActor ?? null,
      }))
      : approval.eligibleActors;
    const review = currentReviewSignoff(governanceCase);
    const stageRef = `${governanceCase.id}:approval`;
    const evidencePolicy = await freezeGovernanceCaseEvidencePolicy(
      tx,
      governanceCase.id,
      now,
    );
    const requestedActionPayload = governanceCase.requestedActionPayload;
    if (
      requestedActionPayload != null
      && (typeof requestedActionPayload !== 'object' || Array.isArray(requestedActionPayload))
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_action_payload_invalid');
    }
    const payload = {
      ...(requestedActionPayload ?? {}),
      caseId: governanceCase.id,
      requestedDecision: governanceCase.requestedDecision,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      conflictOfInterest: {
        policy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
        disclosures,
      },
      evidencePolicy,
    };
    const recoveryRatification = (payload as any).governanceRecoveryRatification;
    const recoveryRatificationDeadline = recoveryRatification?.kind === GOVERNANCE_RECOVERY_RATIFICATION_KIND
      ? new Date(String(recoveryRatification.ratificationDeadline ?? 'invalid'))
      : null;
    const communicationRatification = communicationMemberMuteRatificationPayload(payload);
    if ((payload as any).communicationMemberMuteRatification && !communicationRatification) {
      throw new GovernanceCaseWorkflowError(
        409,
        'governance_case_operation_ratification_invalid',
      );
    }
    const communicationRatificationDeadline = communicationRatification
      ? new Date(communicationRatification.ratificationDeadline)
      : null;
    const communicationAppeal = communicationMemberMuteAppealPayload(payload);
    if ((payload as any).communicationMemberMuteAppeal && !communicationAppeal) {
      throw new GovernanceCaseWorkflowError(
        409,
        'governance_case_appeal_resolution_invalid',
      );
    }
    const communicationAppealDeadline = communicationAppeal
      ? new Date(communicationAppeal.appealWindowEndsAt)
      : null;
    const contentDownrankAppeal = contentVisibilityDownrankAppealPayload(payload);
    if ((payload as any).contentVisibilityDownrankAppeal && !contentDownrankAppeal) {
      throw new GovernanceCaseWorkflowError(
        409,
        'governance_case_appeal_resolution_invalid',
      );
    }
    if (contentDownrankAppeal && (communicationAppeal || communicationRatification)) {
      throw new GovernanceCaseWorkflowError(
        409,
        'governance_case_appeal_resolution_invalid',
      );
    }
    const contentDownrankAppealDeadline = contentDownrankAppeal
      ? new Date(contentDownrankAppeal.appealWindowEndsAt)
      : null;
    const frozenDeadline = contentDownrankAppealDeadline
      ?? communicationAppealDeadline
      ?? communicationRatificationDeadline
      ?? recoveryRatificationDeadline;
    const requestExpiresAt = frozenDeadline
      && !Number.isNaN(frozenDeadline.getTime())
      && frozenDeadline > now
      ? frozenDeadline
      : frozenDeadline
        ? (() => {
            throw new GovernanceCaseWorkflowError(
              409,
              contentDownrankAppealDeadline || communicationAppealDeadline
                ? 'governance_case_appeal_deadline_elapsed'
                : 'governance_case_ratification_deadline_elapsed',
            );
          })()
        : new Date(now.getTime() + APPROVAL_WINDOW_SECONDS * 1000);
    const runtime = await resolveGovernedActionDecisionStageRuntime({
      prisma: tx,
      transactionClient: true,
    }, {
      definition,
      targetCircleId: circleId,
      targetType: governanceCase.subjectType,
      targetRef: governanceCase.subjectRef,
      binding: binding.binding,
      payload,
      caseRef: governanceCase.id,
      stageRef,
      decisionInputDigest: governanceCase.briefSnapshotDigest,
      caseTemplate: {
        selection: governanceCase.templateSelection,
        digest: governanceCase.templateSelectionDigest,
      },
      now,
    });
    if (
      runtime.contractVersionId !== governanceCase.actionContractVersionId
      || runtime.contractDefinitionDigest
        !== governanceCase.templateSelection.actionContract.definitionDigest
      || runtime.profileBindingId !== governanceCase.profileBindingId
      || runtime.profileVersionRef !== governanceCase.templateSelection.profile.versionRef
      || runtime.profileDefinitionDigest
        !== governanceCase.templateSelection.actionAuthority.profile.definitionDigest
      || runtime.authorityBindingId
        !== governanceCase.templateSelection.actionAuthority.authorityPolicyBinding.id
      || runtime.authority.selectorDigest
        !== governanceCase.templateSelection.actionAuthority.authorityPolicyBinding.bindingDigest
      || runtime.authority.capabilityDigest
        !== governanceCase.templateSelection.actionAuthority.authorityPolicyBinding.limitsDigest
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_runtime_drift');
    }
    const registry = new GovernedActionRegistry();
    for (const item of getGovernanceCaseActionRegistry().list()) {
      registry.register(item);
    }
    registry.register(definition);
    const gateway = new GovernedActionGateway({
      registry,
      resolveBinding: async () => binding,
      listCommitteeEligibleActors: async () => eligibleActors,
      requestStore: createPrismaGovernanceRequestStore(tx),
      runtimePrisma: tx,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const request = await gateway.openPreResolvedRequest({
      actionType,
      targetType: governanceCase.subjectType,
      targetRef: governanceCase.subjectRef,
      payload,
      idempotencyKey: `case-approval:${governanceCase.id}`,
      proposerPubkey: actorPubkey,
      authority: binding.binding,
      eligibleActors,
      scope: {
        type: 'circle_governance_committee',
        ref: String(binding.binding.committeeCircleId),
      },
      runtime,
      caseRef: governanceCase.id,
      stageRef,
      executionAuthorizationReason: 'governance_case_approval_stage',
      expiresAt: requestExpiresAt,
      createCaseForRequest: false,
    });
    const plan = buildPlan({
      governanceCase,
      review,
      request,
      binding,
      stageRef,
      disclosures,
      evidencePolicy,
      quadraticFunding: approval.quadraticFunding ?? null,
      quadraticVoice: approval.quadraticVoice ?? null,
      now,
    });
    const planDigest = decisionStagePlanDigest(plan);
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: {
        id: governanceCase.id,
        caseVersion: input.expectedCaseVersion,
        casePhase: 'evidence_review',
        primaryRequestId: null,
        decisionStagePlanDigest: null,
      },
      data: {
        primaryRequestId: request.id,
        invocationId: request.invocationId,
        decisionStagePlan: plan,
        decisionStagePlanDigest: planDigest,
        decisionOutcome: 'pending',
        casePhase: 'decision_in_progress',
        caseVersion: nextCaseVersion,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    await tx.governanceCaseTimelineEvent.create({ data: {
      id: timelineEventId(governanceCase.id, idempotencyKey),
      caseId: governanceCase.id,
      eventType: 'decision_stage_plan_frozen',
      responsibilityKind: null,
      actorPubkey,
      subjectPubkey: null,
      fromState: 'evidence_review',
      toState: 'decision_in_progress',
      reason: 'all_required',
      idempotencyKey,
      caseVersion: nextCaseVersion,
      responsibilityVersion: null,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      createdAt: now,
    } });
    await persistGovernanceCaseActionRequiredNotifications(tx, {
      caseId: governanceCase.id,
      circleId,
      action: 'vote',
      recipientPubkeys: eligibleActors.map((actor: any) => String(actor.pubkey)),
      sourceVersion: request.id,
      createdAt: now,
    });
    return {
      governanceCase: {
        ...governanceCase,
        primaryRequestId: request.id,
        invocationId: request.invocationId,
        primaryRequest: request,
        decisionStagePlan: plan,
        decisionStagePlanDigest: planDigest,
        decisionOutcome: 'pending',
        casePhase: 'decision_in_progress',
        caseVersion: nextCaseVersion,
      },
      request,
      replayed: false,
    };
  });
}

async function resolveFrozenActionContractVersion(
  prisma: any,
  governanceCase: any,
): Promise<any | null> {
  const selected = governanceCase?.templateSelection?.actionContract;
  const contractVersionId = typeof governanceCase?.actionContractVersionId === 'string'
    ? governanceCase.actionContractVersionId.trim()
    : typeof selected?.contractVersionId === 'string'
      ? selected.contractVersionId.trim()
      : '';
  let frozen = governanceCase?.actionContractVersion ?? null;
  if (
    (!frozen || typeof frozen !== 'object')
    && contractVersionId
    && typeof prisma?.governedActionContractVersion?.findUnique === 'function'
  ) {
    frozen = await prisma.governedActionContractVersion.findUnique({
      where: { id: contractVersionId },
    });
  }
  if (!frozen || typeof frozen !== 'object') return null;
  if (
    contractVersionId
    && String(frozen.id || '') !== contractVersionId
  ) return null;
  if (
    selected
    && (
      (typeof selected.contractVersionId === 'string'
        && selected.contractVersionId !== String(frozen.id || ''))
      || (typeof selected.definitionDigest === 'string'
        && selected.definitionDigest !== String(frozen.definitionDigest || ''))
      || (typeof selected.actionType === 'string'
        && selected.actionType !== String(frozen.actionType || ''))
      || (typeof selected.executionAdapter === 'string'
        && selected.executionAdapter !== String(frozen.executionAdapter || ''))
      || (typeof selected.executionDomain === 'string'
        && selected.executionDomain !== String(frozen.executionDomain || ''))
      || (typeof selected.riskFloor === 'string'
        && selected.riskFloor !== String(frozen.riskFloor || ''))
    )
  ) return null;
  return frozen;
}

async function resolveGovernanceCaseApprovalStage(
  prisma: any,
  governanceCase: any,
  viewerPubkey?: string | null,
  now: Date = new Date(),
): Promise<GovernanceCaseApprovalStageResolution> {
  const actionType = typeof governanceCase?.templateSelection?.actionContract?.actionType === 'string'
    ? governanceCase.templateSelection.actionContract.actionType.trim()
    : '';
  const unavailable = blockedPolicySimulation(
    actionType || null,
    'action_contract_unavailable',
  );
  if (!isNativeDecisionMechanism(governanceCase?.templateSelection?.decisionMechanism)) {
    return {
      simulation: blockedPolicySimulation(actionType || null, 'decision_mechanism_unavailable'),
      definition: null,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }
  if (!isCurrentConflictPolicy(governanceCase?.templateSelection?.conflictOfInterestPolicy)) {
    return {
      simulation: blockedPolicySimulation(actionType || null, 'approval_conflict_policy_unavailable'),
      definition: null,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }
  const frozenContract = await resolveFrozenActionContractVersion(
    prisma,
    governanceCase,
  );
  const definition = resolveGovernanceCaseActionDefinitionForDecision(
    frozenContract,
    governanceCase?.templateSelection?.actionContract,
    governanceCase?.templateSelection?.actionAuthority,
  );
  if (
    !definition
    || definition.targetType !== governanceCase?.subjectType
    || governedActionUnavailableReason(definition)
  ) {
    return {
      simulation: unavailable,
      definition: null,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }
  const circleId = Number(governanceCase?.homeIdentityBinding?.homeRef);
  if (
    governanceCase?.homeIdentityBinding?.homeType !== 'circle'
    || governanceCase?.homeIdentityBinding?.activationState?.state !== 'active'
    || !Number.isSafeInteger(circleId)
    || circleId <= 0
  ) {
    return {
      simulation: blockedPolicySimulation(actionType, 'active_governance_home_required'),
      definition,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }

  const frozenSnapshot = governanceCase?.templateSelection?.actionAuthority;
  if (!frozenSnapshot?.policy || ![
    'governance_mandate',
    'governance_recovery_policy',
    'circle_governance_binding',
  ].includes(frozenSnapshot.sourceType)) {
    return {
      simulation: blockedPolicySimulation(actionType, 'approval_authority_unavailable'),
      definition,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }
  const frozenCaseAuthority: FrozenGovernanceCaseAuthorityReference | null = [
    'governance_mandate',
    'circle_governance_binding',
  ].includes(frozenSnapshot.sourceType) ? {
    sourceType: frozenSnapshot.sourceType,
    openedAt: new Date(governanceCase.openedAt),
    projectionBindingId: String(frozenSnapshot.projectionBindingId ?? ''),
    mandateId: String(frozenSnapshot.mandateId ?? ''),
    mandateVersion: Number(frozenSnapshot.mandateVersion),
    mandateTermsDigest: String(frozenSnapshot.mandateTermsDigest ?? ''),
    subjectType: String(frozenSnapshot.subject?.type ?? ''),
    subjectRef: String(frozenSnapshot.subject?.ref ?? ''),
    sourceVersion: String(frozenSnapshot.sourceVersion ?? ''),
    policy: {
      id: String(frozenSnapshot.policy.id ?? ''),
      versionId: String(frozenSnapshot.policy.versionId ?? ''),
      version: Number(frozenSnapshot.policy.version),
      ruleId: String(frozenSnapshot.policy.ruleId ?? ''),
    },
    ...(frozenSnapshot.sourceType === 'circle_governance_binding' ? {
      authorityPolicyBinding: {
        id: String(frozenSnapshot.authorityPolicyBinding?.id ?? ''),
        bindingDigest: String(frozenSnapshot.authorityPolicyBinding?.bindingDigest ?? ''),
        sourceRef: String(frozenSnapshot.authorityPolicyBinding?.sourceRef ?? ''),
        sourceVersion: frozenSnapshot.authorityPolicyBinding?.sourceVersion == null
          ? null
          : String(frozenSnapshot.authorityPolicyBinding.sourceVersion),
        purpose: 'collective_decision' as const,
      },
    } : {}),
  } : null;

  let binding: Awaited<ReturnType<typeof resolveActiveCircleGovernanceBinding>> | any;
  let recoveryEligibleActors: any[] | null = null;
  try {
    if (frozenSnapshot.sourceType === 'governance_recovery_policy') {
      const recovered = await resolveGovernanceRecoveryCaseAuthority(prisma, {
        recoveryPolicyId: String(frozenSnapshot.recoveryPolicy?.id ?? ''),
        bindingId: String(frozenSnapshot.projectionBindingId ?? ''),
        targetCircleId: circleId,
        subjectType: governanceCase.subjectType,
        subjectRef: governanceCase.subjectRef,
        openedAt: new Date(governanceCase.openedAt),
        now,
      });
      binding = recovered.authorityResolution;
      recoveryEligibleActors = recovered.eligibleActors;
    } else {
      binding = await resolveActiveCircleGovernanceBinding(prisma, {
        targetCircleId: circleId,
        actionType,
        purpose: 'collective_decision',
        now,
        frozenCaseAuthority: frozenCaseAuthority!,
      });
    }
  } catch (error) {
    if (!isUnavailableBindingError(error)) throw error;
    return {
      simulation: blockedPolicySimulation(actionType, 'approval_authority_unavailable'),
      definition,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }
  if (!binding) {
    return {
      simulation: blockedPolicySimulation(actionType, 'approval_authority_unavailable'),
      definition,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }
  if (!governanceCaseActionAuthorityMatchesResolution({
    snapshot: governanceCase.templateSelection.actionAuthority,
    homeIdentityBindingId: governanceCase.homeIdentityBindingId,
    targetCircleId: circleId,
    subjectType: governanceCase.subjectType,
    subjectRef: governanceCase.subjectRef,
    actionContract: governanceCase.templateSelection.actionContract,
    authorityResolution: binding,
    now: new Date(governanceCase.openedAt),
  })) {
    return {
      simulation: blockedPolicySimulation(actionType, 'approval_authority_unavailable'),
      definition,
      binding: null,
      baseEligibleActors: [],
      eligibleActors: [],
      disclosures: [],
      quadraticFunding: null,
      quadraticVoice: null,
    };
  }

  const quadraticFunding = governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_funding'
    ? await evaluateGovernanceQuadraticFundingActivationReadiness(prisma, {
      homeIdentityBindingId: governanceCase.homeIdentityBindingId,
      round: governanceCase.templateSelection.decisionMechanism.round,
      now,
    })
    : null;

  const authority = {
    type: 'circle_governance_committee' as const,
    ref: String(binding.binding.committeeCircleId),
    version: `${binding.binding.policyVersionId}:${binding.binding.ruleId}`,
  };
  const provider = {
    type: 'alcheme_internal' as const,
    version: governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_voice_credits'
      ? `quadratic-voice-credits:${binding.binding.policyVersionId}`
      : governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_funding'
        ? `quadratic-funding:${binding.binding.policyVersionId}`
        : `committee-member-threshold:${binding.binding.policyVersionId}`,
    status: 'ready' as const,
  };
  const baseEligibleActors = [...new Map((recoveryEligibleActors ?? await listCommitteeEligibleActors(prisma, {
    committeeCircleId: binding.binding.committeeCircleId,
  })).map((actor: any) => [actor.pubkey, actor])).values()];
  if (baseEligibleActors.length === 0) {
    return {
      simulation: {
        ...blockedPolicySimulation(actionType, 'approval_electorate_required'),
        institutionalAuthority: authority,
        provider,
        quadraticFunding,
      },
      definition,
      binding,
      baseEligibleActors,
      eligibleActors: [],
      disclosures: [],
      quadraticFunding,
      quadraticVoice: null,
    };
  }
  if (!recoveryEligibleActors && !hasGovernanceCommitteeOperator(baseEligibleActors)) {
    return {
      simulation: {
        ...blockedPolicySimulation(actionType, 'approval_operator_required'),
        institutionalAuthority: authority,
        provider,
        quadraticFunding,
      },
      definition,
      binding,
      baseEligibleActors,
      eligibleActors: [],
      disclosures: [],
      quadraticFunding,
      quadraticVoice: null,
    };
  }

  const disclosureResolution = resolveConflictDisclosures(governanceCase, baseEligibleActors);
  if (!disclosureResolution.valid) {
    return {
      simulation: {
        ...blockedPolicySimulation(actionType, 'approval_conflict_disclosure_invalid'),
        institutionalAuthority: authority,
        provider,
        quadraticFunding,
      },
      definition,
      binding,
      baseEligibleActors,
      eligibleActors: [],
      disclosures: [],
      quadraticFunding,
      quadraticVoice: null,
    };
  }
  const disclosures = disclosureResolution.disclosures;
  const recusedActors = new Set(disclosures.map((item) => item.actorPubkey));
  const eligibleActors = baseEligibleActors.filter((actor: any) => !recusedActors.has(actor.pubkey));
  const viewerStatus = viewerPubkey && recusedActors.has(viewerPubkey)
    ? 'recused'
    : viewerPubkey && baseEligibleActors.some((actor: any) => actor.pubkey === viewerPubkey)
      ? 'eligible'
      : 'ineligible';
  const conflictOfInterest = {
    policy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
    disclosures,
    viewerStatus,
    canSelfDisclose: viewerStatus === 'eligible',
  } as const;
  if (eligibleActors.length === 0) {
    return {
      simulation: {
        schemaVersion: 1,
        status: 'blocked',
        reason: 'approval_recusal_quorum_unreachable',
        actionType,
        institutionalAuthority: authority,
        provider,
        electorate: {
          baseEligibleActorCount: baseEligibleActors.length,
          eligibleActorCount: 0,
          recusalCount: disclosures.length,
          approvalThreshold: null,
          quorumReachable: false,
        },
        conflictOfInterest,
        quadraticFunding,
        quadraticVoice: null,
      },
      definition,
      binding,
      baseEligibleActors,
      eligibleActors,
      disclosures,
      quadraticFunding,
      quadraticVoice: null,
    };
  }

  let approvalThreshold: number | null;
  let eligibleActorCount: number;
  let quadraticVoice: GovernanceQuadraticVoiceActivationReadiness | null = null;
  try {
    const config = resolveCommitteeMemberThresholdConfig(
      binding.policyVersion.rules,
      binding.binding.ruleId,
    );
    if (governanceCase.templateSelection.decisionMechanism.kind !== 'equal_weight_threshold') {
      if (governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_voice_credits'
        && !Number.isSafeInteger(config.quadraticVoiceCredits?.budgetPerActor)) {
        throw new Error('governance_qv_credit_budget_required');
      }
      if (governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_voice_credits') {
        quadraticVoice = await evaluateGovernanceQuadraticVoiceActivationReadiness(prisma, {
          homeIdentityBindingId: governanceCase.homeIdentityBindingId,
          creditBudgetPerActor: Number(config.quadraticVoiceCredits?.budgetPerActor),
          now,
        });
      }
      approvalThreshold = null;
      eligibleActorCount = eligibleActors.length;
    } else {
      const result = evaluateCommitteeMemberThreshold({
        config,
        eligibleActors,
        signals: [],
      });
      approvalThreshold = Number(result.tally?.approvalThreshold);
      eligibleActorCount = Number(result.tally?.eligible);
    }
    if (
      (approvalThreshold !== null && (!Number.isSafeInteger(approvalThreshold) || approvalThreshold <= 0))
      || !Number.isSafeInteger(eligibleActorCount)
      || eligibleActorCount <= 0
    ) {
      throw new Error('governance_approval_threshold_invalid');
    }
  } catch (error) {
    const missingQvBudget = error instanceof Error
      && error.message === 'governance_qv_credit_budget_required';
    return {
      simulation: {
        ...blockedPolicySimulation(
          actionType,
          missingQvBudget
            ? 'approval_voice_credit_budget_required'
            : 'approval_policy_rule_unavailable',
        ),
        institutionalAuthority: authority,
        provider: { ...provider, status: 'unavailable' },
        electorate: {
          baseEligibleActorCount: baseEligibleActors.length,
          eligibleActorCount: eligibleActors.length,
          recusalCount: disclosures.length,
          approvalThreshold: null,
          quorumReachable: false,
        },
        conflictOfInterest,
        quadraticFunding,
        quadraticVoice,
      },
      definition,
      binding,
      baseEligibleActors,
      eligibleActors,
      disclosures,
      quadraticFunding,
      quadraticVoice,
    };
  }

  const minimum = governanceCase.templateSelection.actionAuthority.minimumConstraints;
  const configuredApprovalThreshold = approvalThreshold ?? eligibleActorCount;
  const mandateQuorumReachable = eligibleActorCount >= minimum.minimumApprovalThreshold
    && configuredApprovalThreshold >= minimum.minimumApprovalThreshold;
  const quorumReachable = mandateQuorumReachable
    && (approvalThreshold === null || approvalThreshold <= eligibleActorCount);
  const openedAt = new Date(governanceCase.openedAt);
  const timelockUntil = new Date(
    openedAt.getTime() + minimum.minimumTimelockSeconds * 1000,
  );
  const timelockSatisfied = !Number.isNaN(timelockUntil.getTime()) && now >= timelockUntil;
  let reason: GovernanceCasePolicySimulationReason;
  if (!mandateQuorumReachable) {
    reason = 'approval_mandate_quorum_unreachable';
  } else if (!quorumReachable) {
    reason = disclosures.length > 0
      ? 'approval_recusal_quorum_unreachable'
      : 'approval_quorum_unreachable';
  } else if (!timelockSatisfied) {
    reason = 'approval_mandate_timelock_pending';
  } else {
    reason = 'ready';
  }
  return {
    simulation: {
      schemaVersion: 1,
      status: reason === 'ready' ? 'ready' : 'blocked',
      reason,
      actionType,
      institutionalAuthority: authority,
      provider,
      electorate: {
        baseEligibleActorCount: baseEligibleActors.length,
        eligibleActorCount,
        recusalCount: disclosures.length,
        approvalThreshold,
        quorumReachable,
      },
      conflictOfInterest,
      quadraticFunding,
      quadraticVoice,
    },
    definition,
    binding,
    baseEligibleActors,
    eligibleActors,
    disclosures,
    quadraticFunding,
    quadraticVoice,
  };
}

function isUnavailableBindingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return new Set([
    'circle_governance_committee_not_found',
    'circle_governance_committee_not_active',
    'circle_governance_self_governance_must_be_explicit',
    'local_auxiliary_committee_must_be_target_child',
    'circle_governance_policy_not_found',
    'circle_governance_policy_version_not_found',
    'governance_case_frozen_authority_unavailable',
  ]).has(error.message);
}

function blockedPolicySimulation(
  actionType: string | null,
  reason: Exclude<GovernanceCasePolicySimulationReason, 'ready'>,
): GovernanceCasePolicySimulation {
  return {
    schemaVersion: 1,
    status: 'blocked',
    reason,
    actionType,
    institutionalAuthority: null,
    provider: {
      type: 'alcheme_internal',
      version: 'committee-member-threshold:unresolved',
      status: 'unavailable',
    },
    electorate: {
      baseEligibleActorCount: 0,
      eligibleActorCount: 0,
      recusalCount: 0,
      approvalThreshold: null,
      quorumReachable: false,
    },
    conflictOfInterest: {
      policy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
      disclosures: [],
      viewerStatus: 'ineligible',
      canSelfDisclose: false,
    },
    quadraticFunding: null,
    quadraticVoice: null,
  };
}

function policySimulationErrorCode(reason: GovernanceCasePolicySimulationReason): string {
  const codes: Record<GovernanceCasePolicySimulationReason, string> = {
    ready: 'governance_case_approval_stage_unavailable',
    action_contract_unavailable: 'governance_case_action_contract_unavailable',
    decision_mechanism_unavailable: 'governance_case_decision_mechanism_unavailable',
    active_governance_home_required: 'governance_case_active_circle_home_required',
    approval_authority_required: 'governance_case_approval_authority_required',
    approval_authority_unavailable: 'governance_case_approval_authority_unavailable',
    approval_policy_rule_unavailable: 'governance_case_approval_policy_rule_unavailable',
    approval_conflict_policy_unavailable: 'governance_case_approval_conflict_policy_unavailable',
    approval_conflict_disclosure_invalid: 'governance_case_approval_conflict_disclosure_invalid',
    approval_electorate_required: 'governance_case_approval_electorate_required',
    approval_operator_required: 'governance_case_approval_operator_required',
    approval_voice_credit_budget_required: 'governance_case_approval_voice_credit_budget_required',
    approval_mandate_quorum_unreachable: 'governance_case_approval_mandate_quorum_unreachable',
    approval_mandate_timelock_pending: 'governance_case_approval_mandate_timelock_pending',
    approval_quorum_unreachable: 'governance_case_approval_quorum_unreachable',
    approval_recusal_quorum_unreachable: 'governance_case_approval_recusal_quorum_unreachable',
  };
  return codes[reason];
}

export async function applyGovernanceCaseDecisionResolution(
  tx: any,
  input: { request: any; decision: any; now: Date },
): Promise<boolean> {
  if (input.request.actionType === 'external_app_appeal_resolution') {
    if (input.decision.decision === 'rejected') {
      const governanceCase = await tx.governanceCase.findUnique({
        where: { primaryRequestId: input.request.id },
        select: { id: true, subjectType: true, subjectRef: true },
      });
      if (!governanceCase) {
        throw new GovernanceCaseWorkflowError(409, 'appeal_resolution_artifact_case_required');
      }
      await persistExternalAppAppealResolutionOutputArtifact(tx, {
        governanceCase,
        request: input.request,
        decision: input.decision,
        executionReceiptId: null,
        now: input.now,
      });
    }
    return true;
  }
  if (
    !['stage_decision_only', 'provider_bound_action'].includes(input.request.executionMode)
    || !input.request.caseRef
  ) return false;
  const governanceCase = await tx.governanceCase.findUnique({
    where: { id: input.request.caseRef },
    include: { timelineEvents: true, responsibilities: true },
  });
  if (!governanceCase?.decisionStagePlan || !governanceCase.decisionStagePlanDigest) return false;
  if (decisionStagePlanDigest(governanceCase.decisionStagePlan) !== governanceCase.decisionStagePlanDigest) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_stage_plan_digest_mismatch');
  }
  assertFrozenEvidencePolicyMatches(
    governanceCase.decisionStagePlan,
    input.request.payload,
  );
  const approval = governanceCase.decisionStagePlan.stages?.find(
    (stage: any) => stage.purpose === 'approval',
  );
  if (
    governanceCase.primaryRequestId !== input.request.id
    || approval?.stageRef !== input.request.stageRef
    || approval?.decisionRef?.type !== 'governance_request'
    || approval?.decisionRef?.ref !== input.request.id
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_stage_request_mismatch');
  }
  const requestOutcome = String(input.decision.decision);
  if (!['accepted', 'rejected', 'expired', 'cancelled'].includes(requestOutcome)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_outcome_invalid');
  }
  const outcome = requestOutcome === 'expired' && approval.onExpire === 'reject_case'
    ? 'rejected'
    : requestOutcome;
  const configurationTransitionPlan = input.request.payload
    && typeof input.request.payload === 'object'
    && !Array.isArray(input.request.payload)
    && (input.request.payload as any).configurationTransitionPlan;
  const isConfigurationTransition =
    input.request.actionType === CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
    && configurationTransitionPlan
    && typeof configurationTransitionPlan === 'object'
    && !Array.isArray(configurationTransitionPlan)
    && configurationTransitionPlan.kind === 'governance_configuration_transition';
  const recoveryPolicyProposal = input.request.payload
    && typeof input.request.payload === 'object'
    && !Array.isArray(input.request.payload)
    && (input.request.payload as any).governanceRecoveryPolicyProposal;
  const isRecoveryPolicyProposal =
    input.request.actionType === CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
    && recoveryPolicyProposal
    && typeof recoveryPolicyProposal === 'object'
    && !Array.isArray(recoveryPolicyProposal)
    && recoveryPolicyProposal.kind === GOVERNANCE_RECOVERY_POLICY_KIND;
  const recoveryRatification = input.request.payload
    && typeof input.request.payload === 'object'
    && !Array.isArray(input.request.payload)
    && (input.request.payload as any).governanceRecoveryRatification;
  const isRecoveryRatification =
    input.request.actionType === CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
    && recoveryRatification
    && typeof recoveryRatification === 'object'
    && !Array.isArray(recoveryRatification)
    && recoveryRatification.kind === GOVERNANCE_RECOVERY_RATIFICATION_KIND;
  const communicationRatification = communicationMemberMuteRatificationPayload(input.request.payload);
  const communicationAppeal = communicationMemberMuteAppealPayload(input.request.payload);
  const contentDownrankAppeal = contentVisibilityDownrankAppealPayload(input.request.payload);
  const fundingAmendment = parseGovernanceFundingAmendmentPayload(input.request.payload);
  const isCommitteeProfileUpdate = input.request.actionType
    === 'circle.governance_binding.committee_profile.update';
  const isExternalAppOwnerCircleBinding = isExternalAppOwnerCircleBindingAction(
    input.request.actionType,
  );
  const isGovernanceProfileTransition = [
    'governance.profile.upgrade',
    'governance.profile.rollback',
  ].includes(input.request.actionType);
  const hasCommunicationRatificationPayload = Boolean(
    input.request.payload
    && typeof input.request.payload === 'object'
    && !Array.isArray(input.request.payload)
    && (input.request.payload as any).communicationMemberMuteRatification,
  );
  if (hasCommunicationRatificationPayload && !communicationRatification) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_operation_ratification_invalid');
  }
  const hasCommunicationAppealPayload = Boolean(
    input.request.payload
    && typeof input.request.payload === 'object'
    && !Array.isArray(input.request.payload)
    && (input.request.payload as any).communicationMemberMuteAppeal,
  );
  const hasContentDownrankAppealPayload = Boolean(
    input.request.payload
    && typeof input.request.payload === 'object'
    && !Array.isArray(input.request.payload)
    && (input.request.payload as any).contentVisibilityDownrankAppeal,
  );
  if (
    (hasCommunicationAppealPayload && !communicationAppeal)
    || (hasContentDownrankAppealPayload && !contentDownrankAppeal)
    || (communicationAppeal && communicationRatification)
    || (contentDownrankAppeal && (communicationAppeal || communicationRatification))
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_appeal_resolution_invalid');
  }
  let internalExecution: {
    executorModule: string;
    receipt: Awaited<ReturnType<typeof recordExecutionReceipt>>;
  } | null = null;
  if (governanceCase.decisionOutcome === 'pending' && fundingAmendment) {
    await resolveGovernanceFundingAmendmentInTransaction(tx, {
      amendmentRequestId: input.request.id,
      amendmentDecision: outcome,
      amendmentDecisionDigest: input.decision.decisionDigest,
      requestedActionPayload: input.request.payload,
      now: input.now,
    });
  }
  if (
    governanceCase.decisionOutcome === 'pending'
    && communicationRatification
  ) {
    if (
      input.request.actionType !== 'communication.member.mute'
      || input.request.targetType !== 'communication_room_member'
      || input.request.targetRef !== governanceCase.subjectRef
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_stage_request_mismatch');
    }
    await resolveCommunicationMemberMuteRatificationInTransaction(tx, {
      governanceCase,
      request: input.request,
      decision: {
        decision: outcome,
        decisionDigest: input.decision.decisionDigest,
      },
      now: input.now,
    });
  }
  let communicationAppealEffectResult: CommunicationMemberMuteAppealEffectResult | undefined;
  if (communicationAppeal) {
    if (
      input.request.actionType !== 'communication.member.mute'
      || input.request.targetType !== 'communication_room_member'
      || input.request.targetRef !== governanceCase.subjectRef
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_stage_request_mismatch');
    }
    communicationAppealEffectResult = await resolveCommunicationMemberMuteAppealInTransaction(tx, {
      governanceCase,
      request: input.request,
      decision: {
        decision: outcome,
        decisionDigest: input.decision.decisionDigest,
      },
      now: input.now,
    });
  }
  let contentDownrankAppealEffectResult: ContentVisibilityDownrankAppealEffectResult | undefined;
  if (contentDownrankAppeal) {
    if (
      input.request.actionType !== 'content.visibility.downrank'
      || input.request.targetType !== 'feed_post'
      || input.request.targetRef !== governanceCase.subjectRef
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_stage_request_mismatch');
    }
    contentDownrankAppealEffectResult = await resolveContentVisibilityDownrankAppealInTransaction(tx, {
      governanceCase,
      request: input.request,
      decision: {
        decision: outcome,
        decisionDigest: input.decision.decisionDigest,
      },
      now: input.now,
    });
  }
  if (
    governanceCase.decisionOutcome === 'pending'
    && (
      [
        CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE,
        CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE,
        CIRCLE_GOVERNANCE_BINDING_ACCEPT_MANDATE_ACTION_TYPE,
        CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE,
      ].includes(input.request.actionType)
      || isConfigurationTransition
      || isRecoveryPolicyProposal
      || isRecoveryRatification
      || isCommitteeProfileUpdate
      || isGovernanceProfileTransition
      || isExternalAppOwnerCircleBinding
    )
  ) {
    const bindingTargetMatches = isGovernanceProfileTransition
      ? input.request.targetType === 'governance_home_identity_binding'
        && input.request.targetRef === governanceCase.subjectRef
      : isExternalAppOwnerCircleBinding
        ? input.request.targetType === 'external_app_circle_binding'
          && input.request.targetRef === governanceCase.subjectRef
      : input.request.actionType === CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE
        || isCommitteeProfileUpdate
        ? input.request.targetType === 'circle'
          && input.request.targetRef === governanceCase.subjectRef
        : input.request.targetType === 'circle_governance_binding'
          && input.request.targetRef === governanceCase.subjectRef;
    if (!bindingTargetMatches) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_stage_request_mismatch');
    }
    let transactionScopedPrisma: any;
    transactionScopedPrisma = new Proxy(tx as any, {
      get(target, property) {
        if (property === '$transaction') {
          return async (operation: (client: any) => Promise<unknown>) => (
            operation(transactionScopedPrisma)
          );
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    if (outcome === 'accepted') {
      if (isRecoveryRatification) {
        await resolveGovernanceRecoveryRatification(tx, {
          requestId: input.request.id,
          proposal: recoveryRatification,
          decision: outcome as 'accepted' | 'rejected' | 'expired' | 'cancelled',
          decisionDigest: input.decision.decisionDigest,
          now: input.now,
        });
      } else if (isExternalAppOwnerCircleBinding) {
        const actionOutcome = await executeExternalAppCircleBindingGovernanceAction(
          transactionScopedPrisma,
          {
            id: input.request.id,
            actionType: input.request.actionType,
            targetType: input.request.targetType,
            targetRef: input.request.targetRef,
            payload: input.request.payload,
            proposerPubkey: input.request.proposerPubkey,
            state: 'accepted',
            executionMode: input.request.executionMode,
            executionModeDigest: input.request.executionModeDigest ?? null,
            compatibilityBundleVersion: input.request.compatibilityBundleVersion ?? null,
          },
          {
            decisionDigest: input.decision.decisionDigest,
            now: input.now,
          },
        );
        if (!actionOutcome || actionOutcome.executionStatus !== 'executed' || !actionOutcome.receipt) {
          throw new GovernanceCaseWorkflowError(
            409,
            actionOutcome?.errorCode || 'governance_case_internal_execution_adapter_unavailable',
          );
        }
        internalExecution = {
          executorModule: EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR,
          receipt: actionOutcome.receipt,
        };
      } else {
        const executorModule = isGovernanceProfileTransition
          ? 'governance_profile'
          : isCommitteeProfileUpdate
            ? 'circle_committee_profile'
            : 'circle_governance_binding';
        const actionOutcome = isGovernanceProfileTransition
          ? await executeGovernanceProfileTransition(transactionScopedPrisma, {
              id: input.request.id,
              actionType: input.request.actionType,
              targetType: input.request.targetType,
              targetRef: input.request.targetRef,
              payload: input.request.payload,
              proposerPubkey: input.request.proposerPubkey,
              state: 'accepted',
            }, input.now)
          : await (isCommitteeProfileUpdate
            ? (async () => {
              const payload = input.request.payload && typeof input.request.payload === 'object'
                && !Array.isArray(input.request.payload)
                ? input.request.payload as Record<string, unknown>
                : {};
              const availabilityStatus = payload.availabilityStatus === 'enabled'
                || payload.availabilityStatus === 'disabled'
                ? payload.availabilityStatus
                : null;
              if (!availabilityStatus) {
                throw new GovernanceCaseWorkflowError(409, 'governance_committee_profile_payload_invalid');
              }
              await setCircleGovernanceCommitteeAvailability(tx, {
                circleId: Number(input.request.targetRef),
                availabilityStatus,
                actorPubkey: typeof payload.actorPubkey === 'string'
                  ? payload.actorPubkey
                  : input.request.proposerPubkey,
                windowMinutes: typeof payload.windowMinutes === 'number' ? payload.windowMinutes : null,
                allowedActionPrefixes: Array.isArray(payload.allowedActionPrefixes)
                  ? payload.allowedActionPrefixes.map(String)
                  : null,
                electorateTemplate: payload.electorateTemplate ?? null,
                now: input.now,
              });
              return { executionStatus: 'executed' as const, executionRef: input.request.targetRef };
            })()
            : executeCircleGovernanceBindingAction(transactionScopedPrisma, {
              id: input.request.id,
              actionType: input.request.actionType,
              targetType: input.request.targetType,
              targetRef: input.request.targetRef,
              payload: input.request.payload,
              proposerPubkey: input.request.proposerPubkey,
              decisionDigest: input.decision.decisionDigest,
              now: input.now,
            }));
        if (!actionOutcome) {
          throw new GovernanceCaseWorkflowError(409, 'governance_case_internal_execution_adapter_unavailable');
        }
        const receipt = await recordExecutionReceipt(
          createPrismaGovernanceEngineStore(transactionScopedPrisma),
          {
            id: `execution:${input.decision.decisionDigest}`,
            requestId: input.request.id,
            actionType: input.request.actionType,
            executorModule,
            executionStatus: actionOutcome.executionStatus,
            executionRef: actionOutcome.executionRef,
            errorCode: null,
            decisionDigest: input.decision.decisionDigest,
            idempotencyKey: `stage-decision:${input.decision.decisionDigest}`,
            executionMode: input.request.executionMode,
            executionModeDigest: input.request.executionModeDigest ?? null,
            compatibilityBundleVersion: input.request.compatibilityBundleVersion ?? null,
            executionEvidence: {
              kind: 'canonical_internal_action',
              actionType: input.request.actionType,
              targetType: input.request.targetType,
              targetRef: input.request.targetRef,
            },
            executedAt: input.now,
          },
        );
        internalExecution = { executorModule, receipt };
        if (isConfigurationTransition && (input.request.payload as any).recoveryPolicyId) {
          await openGovernanceRecoveryRatificationCase(tx, {
            recoveryPolicyId: String((input.request.payload as any).recoveryPolicyId),
            recoveryCaseId: governanceCase.id,
            now: input.now,
          });
        }
      }
    } else {
      if (isRecoveryRatification) {
        await resolveGovernanceRecoveryRatification(tx, {
          requestId: input.request.id,
          proposal: recoveryRatification,
          decision: outcome as 'accepted' | 'rejected' | 'expired' | 'cancelled',
          decisionDigest: input.decision.decisionDigest,
          now: input.now,
        });
      } else if (
        !isCommitteeProfileUpdate
        && !isGovernanceProfileTransition
        && !isExternalAppOwnerCircleBinding
      ) {
        await recordCircleGovernanceBindingRejectedDecision(transactionScopedPrisma, {
          id: input.request.id,
          actionType: input.request.actionType,
          targetType: input.request.targetType,
          targetRef: input.request.targetRef,
          payload: input.request.payload,
        }, {
          decisionDigest: input.decision.decisionDigest,
        });
      }
    }
  }
  const hasBoundBrief = Number.isSafeInteger(governanceCase.briefDraftPostId)
    && Number(governanceCase.briefDraftPostId) > 0
    && Number.isSafeInteger(governanceCase.briefDraftVersion)
    && Number(governanceCase.briefDraftVersion) > 0
    && typeof governanceCase.briefSnapshotDigest === 'string'
    && /^[a-f0-9]{64}$/.test(governanceCase.briefSnapshotDigest);
  const executionResourceArtifact = buildGovernanceExecutionResourceMappingArtifact({
    caseId: governanceCase.id,
    subjectType: governanceCase.subjectType,
    subjectRef: governanceCase.subjectRef,
    decisionRequestId: input.request.id,
    decision: input.decision.decision,
    decisionDigest: input.decision.decisionDigest,
    actionType: input.request.actionType,
    targetType: input.request.targetType,
    targetRef: input.request.targetRef,
    actionPayload: input.request.payload,
    createdAt: input.now,
  });
  const internalExecutionArtifact = internalExecution?.receipt
    ? buildGovernanceInternalExecutionPlanArtifact({
        caseId: governanceCase.id,
        subjectType: governanceCase.subjectType,
        subjectRef: governanceCase.subjectRef,
        decisionRequestId: input.request.id,
        decisionDigest: input.decision.decisionDigest,
        actionType: input.request.actionType,
        targetType: input.request.targetType,
        targetRef: input.request.targetRef,
        actionPayload: input.request.payload,
        executorModule: internalExecution.executorModule,
        receipt: internalExecution.receipt,
        createdAt: input.now,
      })
    : null;
  if (
    outcome === 'accepted'
    && input.request.executionMode === 'provider_bound_action'
    && !executionResourceArtifact
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_case_provider_execution_resource_mapping_required',
    );
  }
  const executionResponsibility = Array.isArray(governanceCase.responsibilities)
    ? governanceCase.responsibilities.find((item: any) => item.kind === 'execution')
    : null;
  const outcomeResponsibility = Array.isArray(governanceCase.responsibilities)
    ? governanceCase.responsibilities.find((item: any) => item.kind === 'outcome')
    : null;
  const manualExecutionArtifact = outcome === 'accepted'
    && input.request.executionMode === 'stage_decision_only'
    && !internalExecutionArtifact
    && executionResponsibility?.status === 'accepted'
    && outcomeResponsibility?.status === 'accepted'
    && executionResponsibility.assigneePubkey !== outcomeResponsibility.assigneePubkey
    && executionResponsibility.deadlineAt instanceof Date
    ? buildGovernanceManualExecutionPlanArtifact({
        caseId: governanceCase.id,
        subjectType: governanceCase.subjectType,
        subjectRef: governanceCase.subjectRef,
        decisionRequestId: input.request.id,
        decisionDigest: input.decision.decisionDigest,
        actionType: input.request.actionType,
        targetType: input.request.targetType,
        targetRef: input.request.targetRef,
        actionPayload: input.request.payload,
        assignee: {
          pubkey: executionResponsibility.assigneePubkey,
          responsibilityVersion: executionResponsibility.version,
          deadlineAt: executionResponsibility.deadlineAt,
        },
        reviewer: {
          pubkey: outcomeResponsibility.assigneePubkey,
          responsibilityVersion: outcomeResponsibility.version,
        },
        createdAt: input.now,
      })
    : null;
  if (executionResourceArtifact || internalExecutionArtifact || manualExecutionArtifact
    || ((outcome === 'accepted' || communicationAppeal || contentDownrankAppeal) && hasBoundBrief)) {
    const expectedArtifact = executionResourceArtifact ?? internalExecutionArtifact
      ?? manualExecutionArtifact
      ?? buildNativeDecisionOutputArtifact({
      caseId: governanceCase.id,
      caseType: governanceCase.caseType,
      subjectType: governanceCase.subjectType,
      subjectRef: governanceCase.subjectRef,
      decisionRequestId: input.request.id,
      decision: input.decision.decision,
      decisionDigest: input.decision.decisionDigest,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      mechanismKind: governanceCase.templateSelection?.decisionMechanism?.kind,
      decisionTally: input.decision.tally,
      selectionRanking: governanceCase.templateSelection?.selectionRanking,
      requestedActionPayload: governanceCase.requestedActionPayload,
      communicationAppealEffectResult,
      contentDownrankAppealEffectResult,
      createdAt: input.now,
    });
    const existingArtifact = await tx.decisionOutputArtifact.findUnique({
      where: {
        decisionRequestId_decisionDigest_ordinal: {
          decisionRequestId: expectedArtifact.decisionRequestId,
          decisionDigest: expectedArtifact.decisionDigest,
          ordinal: expectedArtifact.ordinal,
        },
      },
    });
    if (existingArtifact) {
      if (!decisionOutputArtifactMatches(existingArtifact, expectedArtifact)) {
        throw new GovernanceCaseWorkflowError(409, 'decision_output_artifact_conflict');
      }
    } else {
      await tx.decisionOutputArtifact.create({ data: expectedArtifact });
    }
  } else {
    const unexpectedArtifact = await tx.decisionOutputArtifact.findFirst({
      where: { decisionRequestId: input.request.id },
      select: { id: true },
    });
    if (unexpectedArtifact) {
      throw new GovernanceCaseWorkflowError(409, 'decision_output_artifact_terminal_state_conflict');
    }
  }
  if (governanceCase.decisionOutcome !== 'pending') {
    if (governanceCase.decisionOutcome !== outcome || governanceCase.casePhase !== 'outcome_review') {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_outcome_conflict');
    }
    return true;
  }
  const nextCaseVersion = governanceCase.caseVersion + 1;
  const updated = await tx.governanceCase.updateMany({
    where: {
      id: governanceCase.id,
      caseVersion: governanceCase.caseVersion,
      casePhase: 'decision_in_progress',
      decisionOutcome: 'pending',
    },
    data: {
      decisionOutcome: outcome,
      casePhase: 'outcome_review',
      caseVersion: nextCaseVersion,
    },
  });
  if (updated.count !== 1) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_resolution_conflict');
  }
  const idempotencyKey = `case-resolution:${hashCanonicalGovernanceValue(
    'alcheme.governance.case-resolution-event-key',
    { caseId: governanceCase.id, decisionDigest: input.decision.decisionDigest },
  ).slice(0, 48)}`;
  await tx.governanceCaseTimelineEvent.create({ data: {
    id: timelineEventId(governanceCase.id, idempotencyKey),
    caseId: governanceCase.id,
    eventType: 'case_decision_resolved',
    responsibilityKind: null,
    actorPubkey: null,
    subjectPubkey: null,
    fromState: 'decision_in_progress',
    toState: 'outcome_review',
    reason: outcome,
    idempotencyKey,
    caseVersion: nextCaseVersion,
    responsibilityVersion: null,
    briefDraftPostId: governanceCase.briefDraftPostId,
    briefDraftVersion: governanceCase.briefDraftVersion,
    briefSnapshotDigest: governanceCase.briefSnapshotDigest,
    createdAt: input.now,
  } });
  return true;
}

function assertCaseReady(governanceCase: any, expectedVersion: number, actorPubkey: string): void {
  if (governanceCase.caseVersion !== expectedVersion) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
  }
  if (
    governanceCase.caseType !== 'policy'
    || governanceCase.casePhase !== 'evidence_review'
    || governanceCase.primaryRequestId
    || governanceCase.decisionStagePlanDigest
    || governanceCase.decisionOutcome
  ) throw new GovernanceCaseWorkflowError(409, 'governance_case_approval_stage_unavailable');
  if (
    governanceCase.homeIdentityBinding?.homeType !== 'circle'
    || governanceCase.homeIdentityBinding?.activationState?.state !== 'active'
    || !Number.isSafeInteger(Number(governanceCase.homeIdentityBinding.homeRef))
  ) throw new GovernanceCaseWorkflowError(409, 'governance_case_active_circle_home_required');
  const template = governanceCase.templateSelection;
  if (
    template?.schemaVersion !== 2
    || template?.templateId !== 'basic-community'
    || template?.readinessState !== 'ready'
    || template?.decisionProvider !== 'alcheme_internal'
    || !isNativeDecisionMechanism(template?.decisionMechanism)
    || template?.executionPreparation !== 'decision_only'
    || !template?.actionContract
    || !governanceCase.actionContractVersionId
    || !governanceCase.profileBindingId
    || !isDigest(governanceCase.templateSelectionDigest)
    || governanceCaseTemplateSelectionDigest(template) !== governanceCase.templateSelectionDigest
    || template.actionContract.contractVersionId !== governanceCase.actionContractVersionId
    || template.profile.bindingId !== governanceCase.profileBindingId
  ) throw new GovernanceCaseWorkflowError(409, 'governance_case_decision_template_required');
  if (
    !Number.isSafeInteger(governanceCase.briefDraftPostId)
    || !Number.isSafeInteger(governanceCase.briefDraftVersion)
    || !isDigest(governanceCase.briefSnapshotDigest)
  ) throw new GovernanceCaseWorkflowError(409, 'governance_case_brief_snapshot_required');
  const coordinator = governanceCase.responsibilities.find((item: any) => item.kind === 'coordinator');
  if (coordinator?.status !== 'accepted' || coordinator.assigneePubkey !== actorPubkey) {
    throw new GovernanceCaseWorkflowError(403, 'governance_case_coordinator_required');
  }
  currentReviewSignoff(governanceCase);
}

function currentReviewSignoff(governanceCase: any): any {
  const reviewer = governanceCase.responsibilities.find((item: any) => item.kind === 'review');
  const event = governanceCase.timelineEvents.find((item: any) => (
    item.eventType === 'review_conclusion_recorded'
    && item.actorPubkey === reviewer?.assigneePubkey
    && Number(item.responsibilityVersion) === Number(reviewer?.version)
    && Number(item.briefDraftPostId) === Number(governanceCase.briefDraftPostId)
    && Number(item.briefDraftVersion) === Number(governanceCase.briefDraftVersion)
    && item.briefSnapshotDigest === governanceCase.briefSnapshotDigest
  ));
  if (reviewer?.status !== 'accepted' || event?.toState !== 'signoff_granted') {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_current_review_signoff_required');
  }
  assertGovernanceCaseReviewRelationshipSignoffGate(
    governanceCase,
    reviewer.assigneePubkey,
    'signoff_granted',
  );
  return event;
}

function buildPlan(input: {
  governanceCase: any;
  review: any;
  request: any;
  binding: any;
  stageRef: string;
  disclosures: GovernanceCaseConflictDisclosure[];
  evidencePolicy: GovernanceCaseFrozenEvidencePolicy;
  quadraticFunding: GovernanceQuadraticFundingActivationReadiness | null;
  quadraticVoice: GovernanceQuadraticVoiceActivationReadiness | null;
  now: Date;
}): GovernanceCaseDecisionStagePlan {
  return {
    schemaVersion: 1,
    resolutionRule: 'all_required',
    frozenAt: input.now.toISOString(),
    brief: {
      draftPostId: input.governanceCase.briefDraftPostId,
      draftVersion: input.governanceCase.briefDraftVersion,
      snapshotDigest: input.governanceCase.briefSnapshotDigest,
    },
    decisionInput: {
      kind: 'reviewed_brief',
      snapshotDigest: input.governanceCase.briefSnapshotDigest,
    },
    evidencePolicy: input.evidencePolicy,
    conflictOfInterest: {
      policy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
      disclosures: input.disclosures.map((item) => ({ ...item })),
    },
    stages: [{
      stageRef: `${input.governanceCase.id}:review`,
      order: 1,
      purpose: 'review_gate',
      institutionalAuthority: {
        type: 'case_review_assignee',
        ref: input.review.actorPubkey,
        version: String(input.review.responsibilityVersion),
      },
      provider: { type: 'alcheme_internal', version: 'case-review-v1' },
      mechanism: notApplicableReviewMechanism(),
      requiredForApproval: true,
      vetoOnReject: true,
      startCondition: 'brief_snapshot_current',
      expiresAt: null,
      onExpire: 'block_case',
      onUnavailable: 'block_case',
      shortCircuitRule: 'required_rejection_terminates',
      decisionRef: { type: 'case_timeline_event', ref: input.review.id },
    }, {
      stageRef: input.stageRef,
      order: 2,
      purpose: 'approval',
      institutionalAuthority: {
        type: 'circle_governance_committee',
        ref: String(input.binding.binding.committeeCircleId),
        version: `${input.binding.binding.policyVersionId}:${input.binding.binding.ruleId}`,
      },
      provider: {
        type: 'alcheme_internal',
        version: input.governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_voice_credits'
          ? `quadratic-voice-credits:${input.binding.binding.policyVersionId}`
          : input.governanceCase.templateSelection.decisionMechanism.kind === 'quadratic_funding'
            ? `quadratic-funding:${input.binding.binding.policyVersionId}`
            : `committee-member-threshold:${input.binding.binding.policyVersionId}`,
      },
      mechanism: buildNativeGovernanceMechanismContract({
        requestId: input.request.id,
        policyId: input.request.policyId,
        policyVersionId: input.request.policyVersionId,
        policyVersion: input.request.policyVersion,
        ruleId: input.request.ruleId,
        policyConfigDigest: input.binding.policyVersion.configDigest,
        policyRules: input.binding.policyVersion.rules,
        snapshotDigest: input.request.snapshot.sourceDigest,
        expiresAt: input.request.expiresAt,
        mechanism: input.governanceCase.templateSelection.decisionMechanism,
        quadraticFundingReadiness: input.quadraticFunding,
        quadraticVoiceReadiness: input.quadraticVoice,
      }),
      requiredForApproval: true,
      vetoOnReject: true,
      startCondition: 'review_gate_accepted',
      expiresAt: new Date(input.request.expiresAt).toISOString(),
      onExpire: 'reject_case',
      onUnavailable: 'block_case',
      shortCircuitRule: 'required_rejection_terminates',
      decisionRef: { type: 'governance_request', ref: input.request.id },
    }],
  };
}

async function freezeGovernanceCaseEvidencePolicy(
  prisma: any,
  caseId: string,
  now: Date,
): Promise<GovernanceCaseFrozenEvidencePolicy> {
  const packages = await prisma.governanceEvidenceSharePackage.findMany({
    where: {
      caseId,
      status: 'authorized',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      version: true,
      digest: true,
      decidedAt: true,
      expiresAt: true,
    },
    orderBy: [{ id: 'asc' }],
  });
  return {
    mode: 'continue_from_frozen_package_digests',
    postFreezeAccess: 'live_visibility_gate',
    revocationEffect: 'deny_future_access_without_rewriting_stage',
    packages: packages.map((item: any) => {
      if (
        !item.decidedAt
        || !Number.isInteger(item.version)
        || item.version < 1
        || !isDigest(item.digest)
      ) {
        throw new GovernanceCaseWorkflowError(
          409,
          'governance_case_evidence_package_integrity_invalid',
        );
      }
      return {
        id: String(item.id),
        version: Number(item.version),
        digest: String(item.digest),
        authorizedAt: new Date(item.decidedAt).toISOString(),
        expiresAt: item.expiresAt ? new Date(item.expiresAt).toISOString() : null,
      };
    }),
  };
}

function resolveConflictDisclosures(
  governanceCase: any,
  baseEligibleActors: Array<{ pubkey: string }>,
): { valid: true; disclosures: GovernanceCaseConflictDisclosure[] } | { valid: false } {
  const eligible = new Set(baseEligibleActors.map((actor) => actor.pubkey));
  const disclosures = new Map<string, GovernanceCaseConflictDisclosure>();
  for (const event of Array.isArray(governanceCase?.timelineEvents)
    ? governanceCase.timelineEvents
    : []) {
    if (event?.eventType !== 'approval_conflict_disclosed') continue;
    if (
      typeof event.actorPubkey !== 'string'
      || event.actorPubkey !== event.subjectPubkey
      || !isConflictReason(event.reason)
      || disclosures.has(event.actorPubkey)
    ) return { valid: false };
    if (!eligible.has(event.actorPubkey)) continue;
    disclosures.set(event.actorPubkey, {
      actorPubkey: event.actorPubkey,
      publicReason: event.reason,
    });
  }
  const ratification = communicationMemberMuteRatificationPayload(
    governanceCase?.requestedActionPayload,
  );
  const appeal = communicationMemberMuteAppealPayload(
    governanceCase?.requestedActionPayload,
  );
  const recurrenceReview = communicationOperationRecurrenceReviewPayload(
    governanceCase?.requestedActionPayload,
  );
  const hasRatificationPayload = Boolean(
    governanceCase?.requestedActionPayload
    && typeof governanceCase.requestedActionPayload === 'object'
    && !Array.isArray(governanceCase.requestedActionPayload)
    && governanceCase.requestedActionPayload.communicationMemberMuteRatification,
  );
  if (hasRatificationPayload && !ratification) return { valid: false };
  const hasAppealPayload = Boolean(
    governanceCase?.requestedActionPayload
    && typeof governanceCase.requestedActionPayload === 'object'
    && !Array.isArray(governanceCase.requestedActionPayload)
    && governanceCase.requestedActionPayload.communicationMemberMuteAppeal,
  );
  if ((hasAppealPayload && !appeal) || (appeal && ratification)) return { valid: false };
  const hasRecurrenceReviewPayload = Boolean(
    governanceCase?.requestedActionPayload
    && typeof governanceCase.requestedActionPayload === 'object'
    && !Array.isArray(governanceCase.requestedActionPayload)
    && governanceCase.requestedActionPayload.communicationOperationRecurrenceReview,
  );
  if (
    (hasRecurrenceReviewPayload && !recurrenceReview)
    || (recurrenceReview && (appeal || ratification))
  ) return { valid: false };
  if (ratification && (
    governanceCase?.templateSelection?.actionContract?.actionType !== 'communication.member.mute'
    || governanceCase?.subjectType !== 'communication_room_member'
    || governanceCase?.subjectRef !== ratification.subjectRef
  )) return { valid: false };
  if (appeal && (
    governanceCase?.templateSelection?.actionContract?.actionType !== 'communication.member.mute'
    || governanceCase?.subjectType !== 'communication_room_member'
    || governanceCase?.subjectRef !== appeal.subjectRef
  )) return { valid: false };
  if (recurrenceReview && (
    governanceCase?.templateSelection?.actionContract?.actionType !== recurrenceReview.actionType
    || governanceCase?.subjectType !== recurrenceReview.subjectType
    || governanceCase?.subjectRef !== recurrenceReview.subjectRef
  )) return { valid: false };
  if (ratification && eligible.has(ratification.originalOperatorPubkey)) {
    const existing = disclosures.get(ratification.originalOperatorPubkey);
    if (existing && existing.publicReason !== 'provider_or_operator_role') {
      return { valid: false };
    }
    disclosures.set(ratification.originalOperatorPubkey, {
      actorPubkey: ratification.originalOperatorPubkey,
      publicReason: 'provider_or_operator_role',
    });
  }
  for (const actorPubkey of appeal
    ? [appeal.originalOperatorPubkey, appeal.appellantPubkey]
    : []) {
    if (!eligible.has(actorPubkey)) continue;
    const existing = disclosures.get(actorPubkey);
    const publicReason = actorPubkey === appeal?.appellantPubkey
      ? 'subject_or_recipient'
      : 'provider_or_operator_role';
    if (existing && existing.publicReason !== publicReason) return { valid: false };
    disclosures.set(actorPubkey, { actorPubkey, publicReason });
  }
  for (const actorPubkey of recurrenceReview
    ? [recurrenceReview.currentOperatorPubkey, recurrenceReview.previousOperatorPubkey]
    : []) {
    if (!eligible.has(actorPubkey)) continue;
    const existing = disclosures.get(actorPubkey);
    if (existing && existing.publicReason !== 'provider_or_operator_role') return { valid: false };
    disclosures.set(actorPubkey, {
      actorPubkey,
      publicReason: 'provider_or_operator_role',
    });
  }
  return {
    valid: true,
    disclosures: [...disclosures.values()].sort((left, right) => (
      left.actorPubkey.localeCompare(right.actorPubkey)
    )),
  };
}

function isConflictReason(value: unknown): value is GovernanceCaseConflictReason {
  return value === 'material_relationship'
    || value === 'financial_interest'
    || value === 'subject_or_recipient'
    || value === 'provider_or_operator_role'
    || value === 'other_public_conflict';
}

function isCurrentConflictPolicy(value: any): value is GovernanceCaseConflictOfInterestPolicy {
  return value?.disclosure === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.disclosure
    && value.recusal === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.recusal
    && value.electorateEffect === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.electorateEffect
    && value.thresholdEffect === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.thresholdEffect
    && value.alternate === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.alternate
    && value.unreachable === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.unreachable
    && value.publicReason === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.publicReason
    && value.selfExemption === NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY.selfExemption;
}

function decisionStagePlanDigest(plan: unknown): string {
  return hashCanonicalGovernanceValue('alcheme.governance.case-decision-stage-plan', plan);
}

function assertFrozenEvidencePolicyMatches(plan: any, payload: any): void {
  const planPolicy = plan?.evidencePolicy;
  const payloadPolicy = payload?.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(planPolicy)
    || !isCurrentGovernanceCaseFrozenEvidencePolicy(payloadPolicy)
    || hashCanonicalGovernanceValue(
      'alcheme.governance.case-frozen-evidence-policy',
      planPolicy,
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.case-frozen-evidence-policy',
      payloadPolicy,
    )
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_evidence_policy_invalid');
  }
}

function timelineEventId(caseId: string, idempotencyKey: string): string {
  return `governance_case_event:${hashCanonicalGovernanceValue(
    'alcheme.governance.case-timeline-event-id',
    { caseId, idempotencyKey },
  ).slice(0, 56)}`;
}

function required(value: unknown, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new GovernanceCaseWorkflowError(400, code);
  return normalized;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isNativeDecisionMechanism(value: any): boolean {
  const common = value?.schemaVersion === 1
    && value.resolverVersion === '1'
    && value.provider === 'alcheme_internal'
    && value.availability === 'available';
  return common && (
    (value.kind === 'equal_weight_threshold'
      && value.schemaId === 'alcheme.native.equal-weight-threshold'
      && value.resolverId === 'committee.member_threshold')
    || (value.kind === 'quadratic_voice_credits'
      && value.schemaId === 'alcheme.native.quadratic-voice-credits'
      && value.resolverId === 'native.quadratic_voice_credits'
      && Array.isArray(value.choiceSet)
      && value.choiceSet.length >= 2)
    || (value.kind === 'quadratic_funding'
      && value.schemaId === 'alcheme.native.quadratic-funding'
      && value.resolverId === 'native.quadratic_funding'
      && value.round?.formula === 'integer_sqrt_quadratic_matching'
      && Array.isArray(value.round?.projects)
      && value.round.projects.length >= 2)
  );
}
