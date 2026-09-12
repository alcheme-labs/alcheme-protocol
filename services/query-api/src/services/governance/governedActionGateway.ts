import type {
  GovernedActionDefinition,
  GovernedActionRegistry,
} from "./actionRegistry";
import { governedActionUnavailableReason } from "./actionRegistry";
import type {
  CircleGovernanceBindingResolution,
} from "./circleGovernanceBindings";
import {
  GOVERNANCE_REQUEST_DEFAULT_TTL_SECONDS,
  computeGovernanceSnapshotDigest,
  openGovernanceRequest,
  recordExecutionReceipt,
  type GovernanceEligibleActor,
  type GovernanceExecutionReceiptRecord,
  type GovernanceRequestRecord,
  type GovernanceSnapshotRecord,
  type GovernanceRequestStore,
  type GovernanceEngineStore,
} from "./policyEngine";
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  hasGovernanceCommitteeOperator,
  isGovernanceCommitteeOperator,
} from './circleCommitteeActors';
import {
  createPrismaGovernedActionInvocationStore,
  type GovernedActionInvocationStore,
} from './invocationStore';
import {
  resolveGovernedDirectOperationRuntime,
  resolveGovernedActionDecisionStageRuntime,
  resolveGovernedActionGatewayRuntime,
  resolveGovernedSharedCommitteeOperationRuntime,
  type GovernedDirectOperationRuntimeResolution,
  type GovernedActionGatewayRuntimeResolution,
} from './governedActionGatewayRuntime';
import {
  verifyExternalGovernanceHomeForWrite,
  type ExternalGovernanceHomeIdentityReadback,
} from './governanceHomeStore';
import {
  assertGovernanceProfileTransitionEnvelopePayload,
  assertGovernanceProfileTransitionPayload,
} from './governanceProfile';
import {
  assertInitialOperationEffectForReceipt,
  assertInvocationLifecycleTransition,
  createInitialOperationEffect,
} from './operationEffectLifecycle';
import { resolveGovernedActionInvocationLineage } from './governedActionInvocationLineage';
import {
  openGovernedActionAppeal,
  resolveGovernedActionAppeal,
  type GovernedActionAppealResolutionOutcome,
} from './governedActionAppeal';
import {
  assertGovernanceCaseTemplateProposer,
  selectGovernanceCaseTemplateForInvocation,
} from './governanceCaseTemplate';
import {
  buildNativeInvocationDecisionStagePlan,
  governanceCaseIdForRequest,
  type NativeGovernanceCaseTemplate,
} from './governanceCase';
import { assertGovernanceHomeAllowsNewIntake } from './governanceHomeLifecycleGate';
import {
  assertFreshGovernanceAuthorityHealthForHighRisk,
  projectGovernanceAuthorityHealthReadback,
} from './governanceAuthorityHealthReadback';
import { GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE } from './actionRegistry';
import {
  normalizeGovernanceContinuityIncidentResolution,
} from './governanceContinuityIncident';
import { assertOperatorCapabilityAvailable } from './operatorCapabilitySuspensionAdmission';

export interface GovernedDirectOperationReceiptRecord {
  id: string;
  invocationId: string;
  attemptKey: string;
  actorPubkey: string;
  subjectType: string;
  subjectRef: string;
  roleAssignmentProof: {
    bindingId: string;
    sourceType: string;
    sourceRef: string;
    sourceVersion: string | null;
    profileVersionRef: string | null;
    decisionPath: string;
    selector: Record<string, unknown>;
    selectorDigest: string;
  };
  policyVersionRef: string;
  reasonCode: string;
  limits: Record<string, unknown>;
  limitsDigest: string;
  payloadDigest: string;
  resultDigest: string;
  executionStatus: string;
  executionRef: string | null;
  capabilityExpiresAt: string | null;
  reviewAt: string | null;
  appealRef: string;
  appealWindowEndsAt: string | null;
  escalationRef: string;
  receiptDigest: string;
}

export type GovernedActionGatewayBindingResolution =
  CircleGovernanceBindingResolution;

export type GovernedActionGatewayDecision =
  | {
      status: "direct_allowed";
      actionType: string;
      reason: string;
    }
  | {
      status: "requires_governance";
      actionType: string;
      reason: string;
      bindingId: string;
      committeeCircleId: number;
      policyId: string;
      policyVersionId: string;
      ruleId: string;
    }
  | {
      status: "denied";
      actionType: string;
      reason: string;
    };

export function evaluateRegisteredGovernedActionRouting(input: {
  definition: GovernedActionDefinition;
  binding: GovernedActionGatewayBindingResolution | null;
  directAllowed: boolean;
  now: Date;
}): GovernedActionGatewayDecision {
  const { definition, binding } = input;
  const unavailableReason = governedActionUnavailableReason(definition);
  if (unavailableReason) {
    return {
      status: 'denied',
      actionType: definition.actionType,
      reason: unavailableReason,
    };
  }
  if (!binding) {
    if (definition.impact === 'high' || definition.impact === 'critical') {
      return {
        status: 'denied',
        actionType: definition.actionType,
        reason: 'governance_decision_path_required',
      };
    }
    if (definition.governanceMode === 'always_required') {
      return {
        status: 'denied',
        actionType: definition.actionType,
        reason: 'governance_binding_required',
      };
    }
    if (!input.directAllowed) {
      return {
        status: 'denied',
        actionType: definition.actionType,
        reason: 'direct_authority_denied',
      };
    }
    return {
      status: 'direct_allowed',
      actionType: definition.actionType,
      reason: 'no_active_governance_binding',
    };
  }

  if (
    definition.actionType !== GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE
    && (definition.impact === 'high' || definition.impact === 'critical')
  ) {
    try {
      assertFreshGovernanceAuthorityHealthForHighRisk(binding.binding, input.now);
    } catch (error) {
      return {
        status: 'denied',
        actionType: definition.actionType,
        reason: error instanceof Error ? error.message : 'governance_authority_health_blocked',
      };
    }
  }

  return {
    status: 'requires_governance',
    actionType: definition.actionType,
    reason: 'active_governance_binding',
    bindingId: binding.binding.id,
    committeeCircleId: binding.binding.committeeCircleId,
    policyId: binding.binding.policyId,
    policyVersionId: binding.binding.policyVersionId,
    ruleId: binding.binding.ruleId,
  };
}

interface GovernedActionGatewayDeps {
  registry: GovernedActionRegistry;
  resolveBinding(input: {
    targetCircleId: number;
    actionType: string;
    purpose?: 'collective_decision' | 'operational_execution';
    subjectType?: string;
    subjectRef?: string;
    authorityBindingId?: string | null;
    requireExactSubject?: boolean;
  }): Promise<GovernedActionGatewayBindingResolution | null>;
  listCommitteeEligibleActors(input: {
    committeeCircleId: number;
  }): Promise<GovernanceEligibleActor[]>;
  requestStore: GovernanceRequestStore;
  engineStore?: GovernanceEngineStore;
  createRequestId?: () => string;
  now?: () => Date;
  resolveExecutionAuthority?: (input: {
    actionType: string;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    expectedAdapter: string;
  }) => Promise<import('./governedActionGatewayRuntime').GovernedActionExecutionAuthorityReadback>;
  runtimePrisma?: any;
  runtimeTransactionClient?: boolean;
  invocationStore?: GovernedActionInvocationStore;
  verifyExternalHomeIdentity?: (
    readback: ExternalGovernanceHomeIdentityReadback,
    now: Date,
  ) => Promise<unknown>;
}

export class GovernedActionGateway {
  private readonly registry: GovernedActionRegistry;
  private readonly resolveBinding: GovernedActionGatewayDeps["resolveBinding"];
  private readonly listCommitteeEligibleActors: GovernedActionGatewayDeps["listCommitteeEligibleActors"];
  private readonly requestStore: GovernanceRequestStore;
  private readonly engineStore?: GovernanceEngineStore;
  private readonly createRequestId?: () => string;
  private readonly now: () => Date;
  private readonly resolveExecutionAuthority?: GovernedActionGatewayDeps['resolveExecutionAuthority'];
  private readonly runtimePrisma?: any;
  private readonly runtimeTransactionClient: boolean;
  private readonly invocationStore?: GovernedActionInvocationStore;
  private readonly verifyExternalHomeIdentity?: GovernedActionGatewayDeps['verifyExternalHomeIdentity'];

  constructor(deps: GovernedActionGatewayDeps) {
    this.registry = deps.registry;
    this.resolveBinding = deps.resolveBinding;
    this.listCommitteeEligibleActors = deps.listCommitteeEligibleActors;
    this.requestStore = deps.requestStore;
    this.engineStore = deps.engineStore;
    this.createRequestId = deps.createRequestId;
    this.now = deps.now ?? (() => new Date());
    this.resolveExecutionAuthority = deps.resolveExecutionAuthority;
    this.runtimePrisma = deps.runtimePrisma;
    this.runtimeTransactionClient = deps.runtimeTransactionClient === true;
    this.invocationStore = deps.invocationStore
      ?? (deps.runtimePrisma ? createPrismaGovernedActionInvocationStore(
        deps.runtimePrisma,
        { transactionClient: this.runtimeTransactionClient },
      ) : undefined);
    this.verifyExternalHomeIdentity = deps.verifyExternalHomeIdentity
      ?? (deps.runtimePrisma
        ? (readback, now) => verifyExternalGovernanceHomeForWrite(
          deps.runtimePrisma, readback, now,
        )
        : undefined);
  }

  async openAppeal(input: {
    originalReceiptId: string;
    appellantPubkey: string;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  }) {
    if (!this.runtimePrisma || this.runtimeTransactionClient) {
      throw new Error('governed_action_appeal_runtime_required');
    }
    return openGovernedActionAppeal(this.runtimePrisma, input);
  }

  async resolveAppeal(input: {
    appealId: string;
    reviewerPubkey: string;
    reviewerAuthorityDigest: string;
    outcome: GovernedActionAppealResolutionOutcome;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  }) {
    if (!this.runtimePrisma || this.runtimeTransactionClient) {
      throw new Error('governed_action_appeal_runtime_required');
    }
    return resolveGovernedActionAppeal(this.runtimePrisma, input);
  }

  async evaluate(input: {
    actionType: string;
    targetCircleId: number;
    actorPubkey?: string | null;
    directAllowed: boolean;
  }): Promise<GovernedActionGatewayDecision> {
    const definition = this.registry.get(input.actionType);
    if (!definition) {
      return {
        status: "direct_allowed",
        actionType: input.actionType,
        reason: "governed_action_not_registered",
      };
    }

    const binding = await this.resolveBinding({
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
    });
    return evaluateRegisteredGovernedActionRouting({
      definition,
      binding,
      directAllowed: input.directAllowed,
      now: this.now(),
    });
  }

  async openRequest(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    proposerPubkey: string;
    expiresAt?: Date | null;
    appendCircleBindingFacts?: boolean;
  }): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
    const definition = assertRegistered(this.registry, input.actionType);
    assertGovernedActionRuntimeAvailable(definition);
    if (definition.targetType !== input.targetType) {
      throw new Error('governed_action_contract_target_type_mismatch');
    }
    if (!this.runtimePrisma || !this.invocationStore) {
      throw new Error('governed_action_runtime_required');
    }
    const binding = await this.resolveBinding({
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      purpose: 'collective_decision',
      subjectType: input.targetType,
      subjectRef: input.targetRef,
      requireExactSubject: definition.bindingRequirement === 'exact_action_subject_purpose',
    });
    if (!binding) {
      throw new Error("governance_binding_required");
    }
    if (
      input.actionType !== GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE
      && (definition.impact === 'high' || definition.impact === 'critical')
    ) {
      assertFreshGovernanceAuthorityHealthForHighRisk(binding.binding, this.now());
    }

    const eligibleActors = await this.listCommitteeEligibleActors({
      committeeCircleId: binding.binding.committeeCircleId,
    });
    if (eligibleActors.length === 0) {
      throw new Error("governance_committee_eligible_members_required");
    }
    if (!hasGovernanceCommitteeOperator(eligibleActors)) {
      throw new Error('governance_committee_operator_required');
    }

    return this.openResolvedRequest({
      ...input,
      authority: binding.binding,
      eligibleActors,
      scope: {
        type: "circle_governance_committee",
        ref: String(binding.binding.committeeCircleId),
      },
      appendCircleBindingFacts: input.appendCircleBindingFacts ?? true,
    });
  }

  async openDecisionStageRequest(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    proposerPubkey: string;
    proposerRole?: string;
    expiresAt?: Date | null;
    authorityBindingId?: string | null;
    continuityRecoveryEligibleActors?: GovernanceEligibleActor[];
  }): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
    const definition = assertRegistered(this.registry, input.actionType);
    assertGovernedActionRuntimeAvailable(definition);
    if (input.actionType.startsWith('governance.profile.')) {
      assertGovernanceProfileTransitionPayload(input.actionType, input.payload);
    }
    if (definition.targetType !== input.targetType) {
      throw new Error('governed_action_contract_target_type_mismatch');
    }
    if (!this.runtimePrisma || !this.invocationStore) {
      throw new Error('governed_action_runtime_required');
    }
    if (!this.runtimeTransactionClient) {
      throw new Error('governed_action_decision_stage_transaction_required');
    }
    const binding = await this.resolveBinding({
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      purpose: 'collective_decision',
      subjectType: input.targetType,
      subjectRef: input.targetRef,
      authorityBindingId: input.authorityBindingId,
      requireExactSubject: definition.bindingRequirement === 'exact_action_subject_purpose',
    });
    if (!binding) throw new Error('governance_binding_required');
    const evidencePolicy = {
      mode: 'continue_from_frozen_package_digests' as const,
      postFreezeAccess: 'live_visibility_gate' as const,
      revocationEffect: 'deny_future_access_without_rewriting_stage' as const,
      packages: [],
    };
    const payload = normalizeGovernedActionPayload({
      ...input.payload,
      evidencePolicy,
    });
    let continuityRecovery = false;
    if (input.continuityRecoveryEligibleActors !== undefined) {
      continuityRecovery = assertCompromisedKeyBindingReplacementRecovery({
        actionType: input.actionType,
        targetType: input.targetType,
        targetRef: input.targetRef,
        authority: binding.binding,
        eligibleActors: input.continuityRecoveryEligibleActors,
        payload,
        now: this.now(),
      });
      if (!continuityRecovery) {
        throw new Error('governance_continuity_incident_recovery_authority_invalid');
      }
    }
    if (
      input.actionType !== GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE
      && (definition.impact === 'high' || definition.impact === 'critical')
      && !continuityRecovery
    ) {
      assertFreshGovernanceAuthorityHealthForHighRisk(binding.binding, this.now());
    }
    const eligibleActors = input.continuityRecoveryEligibleActors
      ?? await this.listCommitteeEligibleActors({
        committeeCircleId: binding.binding.committeeCircleId,
      });
    if (eligibleActors.length === 0) {
      throw new Error('governance_committee_eligible_members_required');
    }
    if (!hasGovernanceCommitteeOperator(eligibleActors)) {
      throw new Error('governance_committee_operator_required');
    }
    let now = this.now();
    const requestId = this.createRequestId?.()
      ?? `gov_req_${hashCanonicalGovernanceValue(
        'alcheme.governance.native-decision-stage-request-id',
        {
          targetCircleId: input.targetCircleId,
          actionType: input.actionType,
          targetType: input.targetType,
          targetRef: input.targetRef,
          idempotencyKey: input.idempotencyKey,
        },
      ).slice(0, 56)}`;
    const existingRequest = await this.runtimePrisma.governanceRequest.findUnique({
      where: { id: requestId },
      select: { openedAt: true, expiresAt: true },
    });
    if (existingRequest) {
      if (!existingRequest.openedAt || !existingRequest.expiresAt) {
        throw new Error('governance_request_frozen_time_facts_required');
      }
      now = new Date(existingRequest.openedAt);
    }
    const expiresAt = existingRequest
      ? new Date(existingRequest.expiresAt)
      : input.expiresAt
        ?? new Date(now.getTime() + GOVERNANCE_REQUEST_DEFAULT_TTL_SECONDS * 1_000);
    const caseRef = governanceCaseIdForRequest(requestId);
    const stageRef = `${caseRef}:approval`;
    const payloadDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-payload',
      payload,
    );
    const runtime = await resolveGovernedActionDecisionStageRuntime({
      prisma: this.runtimePrisma,
      transactionClient: true,
    }, {
      definition,
      targetCircleId: input.targetCircleId,
      targetType: input.targetType,
      targetRef: input.targetRef,
      binding: binding.binding,
      payload,
      caseRef,
      stageRef,
      decisionInputDigest: payloadDigest,
      now,
    });
    if (!runtime.caseTemplate) {
      throw new Error('governance_case_template_selection_required');
    }
    if (input.proposerRole !== undefined) {
      assertGovernanceCaseTemplateProposer(runtime.caseTemplate.selection, input.proposerRole);
    }
    const scope = {
      type: 'circle_governance_committee',
      ref: String(binding.binding.committeeCircleId),
    };
    const snapshotDigest = computeGovernanceSnapshotDigest({
      requestId,
      eligibleActors,
      action: {
        type: input.actionType,
        targetType: input.targetType,
        targetRef: input.targetRef,
        payload,
        idempotencyKey: input.idempotencyKey,
      },
      scope,
    });
    const frozenPlan = buildNativeInvocationDecisionStagePlan({
      requestId,
      stageRef,
      payloadDigest,
      frozenAt: now,
      expiresAt,
      evidencePolicy,
      committeeCircleId: binding.binding.committeeCircleId,
      policyId: binding.binding.policyId,
      policyVersionId: binding.binding.policyVersionId,
      policyVersion: binding.binding.policyVersion,
      ruleId: binding.binding.ruleId,
      policyConfigDigest: binding.policyVersion.configDigest,
      policyRules: binding.policyVersion.rules,
      snapshotDigest,
      templateSelection: runtime.caseTemplate.selection,
    });
    return this.openRuntimeResolvedRequest({
      ...input,
      payload,
      expiresAt,
      authority: binding.binding,
      eligibleActors,
      scope,
      runtime,
      caseRef,
      stageRef,
      executionAuthorizationReason: 'native_invocation_decision_stage',
      requestId,
      caseTemplate: {
        ...runtime.caseTemplate,
        decisionStagePlan: frozenPlan.plan,
        decisionStagePlanDigest: frozenPlan.digest,
      },
      now,
    });
  }

  async openResolvedRequest(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    proposerPubkey: string;
    expiresAt?: Date | null;
    authority: import('./governedActionGatewayRuntime').GovernedActionGatewayRuntimeBinding;
    eligibleActors: GovernanceEligibleActor[];
    scope: { type: string; ref: string };
    appendCircleBindingFacts?: boolean;
  }): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
    const definition = assertRegistered(this.registry, input.actionType);
    assertGovernedActionRuntimeAvailable(definition);
    if (definition.targetType !== input.targetType) {
      throw new Error('governed_action_contract_target_type_mismatch');
    }
    if (!this.runtimePrisma || !this.invocationStore) {
      throw new Error('governed_action_runtime_required');
    }
    const payload = normalizeGovernedActionPayload(input.payload);
    if (
      input.actionType !== GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE
      && (definition.impact === 'high' || definition.impact === 'critical')
      && !assertCompromisedKeyBindingReplacementRecovery({
        actionType: input.actionType,
        targetType: input.targetType,
        targetRef: input.targetRef,
        authority: input.authority,
        eligibleActors: input.eligibleActors,
        payload,
        now: this.now(),
      })
    ) {
      assertFreshGovernanceAuthorityHealthForHighRisk(input.authority, this.now());
    }
    if (input.eligibleActors.length === 0) {
      throw new Error('governance_eligible_actors_required');
    }
    const binding = { binding: input.authority };
    const eligibleActors = input.eligibleActors;
    if (input.actionType.startsWith('governance.profile.')) {
      assertGovernanceProfileTransitionPayload(input.actionType, payload);
    }

    const now = this.now();
    const runtime = await resolveGovernedActionGatewayRuntime({
      prisma: this.runtimePrisma,
      transactionClient: this.runtimeTransactionClient,
    }, {
      definition,
      targetCircleId: input.targetCircleId,
      targetType: input.targetType,
      targetRef: input.targetRef,
      binding: binding.binding,
      payload,
      appendCircleBindingFacts: input.appendCircleBindingFacts,
      now,
    });
    return this.openRuntimeResolvedRequest({
      ...input,
      payload: runtime.payload ?? payload,
      appendCircleBindingFacts: false,
      runtime,
      caseRef: null,
      stageRef: null,
      executionAuthorizationReason: 'verified_legacy_compatibility_bundle',
      now,
    });
  }

  async openPreResolvedRequest(input: {
    actionType: string;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    proposerPubkey: string;
    expiresAt?: Date | null;
    authority: import('./governedActionGatewayRuntime').GovernedActionGatewayRuntimeBinding;
    eligibleActors: GovernanceEligibleActor[];
    scope: { type: string; ref: string };
    runtime: GovernedActionGatewayRuntimeResolution;
    caseRef: string | null;
    stageRef: string | null;
    executionAuthorizationReason: string;
    createCaseForRequest?: boolean;
    caseTemplate?: NativeGovernanceCaseTemplate;
    requestId?: string;
  }): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
    return this.openRuntimeResolvedRequest({
      ...input,
      now: this.now(),
    });
  }

  async executeDirectOperation<T>(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    execute(): Promise<{ result: T; executionRef: string | null }>;
  }): Promise<{
    receipt: GovernedDirectOperationReceiptRecord;
    result: T | null;
    replayed: boolean;
  }> {
    return this.executeOperationalAction({ ...input, authorityMode: 'direct' });
  }

  async executeSharedCommitteeOperation<T>(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    execute(): Promise<{ result: T; executionRef: string | null }>;
  }): Promise<{
    receipt: GovernedDirectOperationReceiptRecord;
    result: T | null;
    replayed: boolean;
  }> {
    return this.executeOperationalAction({ ...input, authorityMode: 'shared_committee' });
  }

  async executeSystemRoleOperation<T>(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    runtime: GovernedDirectOperationRuntimeResolution;
    execute(): Promise<{ result: T; executionRef: string | null }>;
  }): Promise<{
    receipt: GovernedDirectOperationReceiptRecord;
    result: T | null;
    replayed: boolean;
  }> {
    return this.executeOperationalAction({ ...input, authorityMode: 'system_role' });
  }

  private async executeOperationalAction<T>(input: {
    actionType: string;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    idempotencyKey: string;
    authorityMode: 'direct' | 'shared_committee' | 'system_role';
    runtime?: GovernedDirectOperationRuntimeResolution;
    execute(): Promise<{ result: T; executionRef: string | null }>;
  }): Promise<{
    receipt: GovernedDirectOperationReceiptRecord;
    result: T | null;
    replayed: boolean;
  }> {
    const definition = assertRegistered(this.registry, input.actionType);
    assertGovernedActionRuntimeAvailable(definition);
    if (definition.targetType !== input.targetType) {
      throw new Error('governed_action_contract_target_type_mismatch');
    }
    if (!this.runtimePrisma || !this.invocationStore || !this.runtimeTransactionClient) {
      throw new Error('governed_direct_operation_transaction_required');
    }
    const payload = normalizeGovernedActionPayload(input.payload);
    const now = this.now();
    let runtime: GovernedDirectOperationRuntimeResolution;
    if (input.authorityMode === 'system_role') {
      if (
        !input.runtime
        || input.runtime.governanceHomeType !== 'platform_safety_system_role'
        || input.runtime.governanceHomeRef !== 'platform_safety:sandbox'
        || input.runtime.authority.sourceType !== 'system_governance_role_binding'
        || input.runtime.riskFloor !== 'high'
      ) {
        throw new Error('governed_system_role_operation_runtime_required');
      }
      runtime = input.runtime;
    } else if (input.authorityMode === 'direct') {
      if (typeof this.runtimePrisma.$executeRawUnsafe !== 'function') {
        throw new Error('governed_direct_operation_stage_lock_required');
      }
      await this.runtimePrisma.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `governance-home-stage:governance-home-circle-${input.targetCircleId}-v1`,
      );
      const decision = await this.evaluate({
        actionType: input.actionType,
        targetCircleId: input.targetCircleId,
        actorPubkey: input.actorPubkey,
        directAllowed: true,
      });
      if (decision.status !== 'direct_allowed' || decision.reason !== 'no_active_governance_binding') {
        throw new Error(decision.status === 'requires_governance'
          ? 'governed_direct_operation_governance_required'
          : decision.status === 'denied'
            ? decision.reason
            : 'governed_direct_operation_registered_runtime_required');
      }
      if (!this.resolveExecutionAuthority) {
        throw new Error('governed_direct_operation_execution_authority_resolver_required');
      }
      const executionAuthorityReadback = await this.resolveExecutionAuthority({
        actionType: input.actionType,
        targetType: input.targetType,
        targetRef: input.targetRef,
        actorPubkey: input.actorPubkey,
        expectedAdapter: definition.executionAdapter,
      });
      if (executionAuthorityReadback.executionAdapter !== definition.executionAdapter) {
        throw new Error('governed_direct_operation_execution_authority_adapter_mismatch');
      }
      runtime = await resolveGovernedDirectOperationRuntime({
        prisma: this.runtimePrisma,
        transactionClient: true,
      }, {
        definition,
        targetCircleId: input.targetCircleId,
        targetType: input.targetType,
        targetRef: input.targetRef,
        actorPubkey: input.actorPubkey,
        payload,
        reasonCode: input.reasonCode,
        executionAuthorityReadback,
        now,
      });
    } else {
      const resolved = await this.resolveBinding({
        targetCircleId: input.targetCircleId,
        actionType: input.actionType,
        purpose: 'operational_execution',
        subjectType: input.targetType,
        subjectRef: input.targetRef,
        requireExactSubject: definition.bindingRequirement === 'exact_action_subject_purpose',
      });
      if (!resolved || resolved.binding.bindingType !== 'shared_committee') {
        throw new Error('governed_shared_committee_binding_required');
      }
      const eligibleActors = await this.listCommitteeEligibleActors({
        committeeCircleId: resolved.binding.committeeCircleId,
      });
      const currentCommitteeOperators = eligibleActors.filter(isGovernanceCommitteeOperator);
      runtime = await resolveGovernedSharedCommitteeOperationRuntime({
        prisma: this.runtimePrisma,
        transactionClient: true,
      }, {
        definition,
        targetCircleId: input.targetCircleId,
        targetType: input.targetType,
        targetRef: input.targetRef,
        actorPubkey: input.actorPubkey,
        payload,
        reasonCode: input.reasonCode,
        binding: resolved.binding,
        currentCommitteeOperators,
        now,
      });
    }
    const lineage = resolveGovernedActionInvocationLineage({
      idempotencyScope: runtime.idempotencyScope,
      idempotencyWindowSeconds: runtime.idempotencyWindowSeconds,
      homeIdentityBindingId: runtime.homeIdentityBindingId,
      contractVersionId: runtime.contractVersionId,
      profileBindingId: runtime.profileBindingId,
      profileVersionRef: runtime.profileVersionRef,
      actionType: input.actionType,
      subjectType: input.targetType,
      subjectRef: input.targetRef,
      idempotencyKey: input.idempotencyKey,
      payloadDigest: runtime.payloadDigest,
      reasonDigest: runtime.reasonDigest,
      now,
    });
    const { invocationId, attemptKey } = lineage;
    if (typeof this.runtimePrisma.$executeRawUnsafe !== 'function') {
      throw new Error('governed_direct_operation_transaction_lock_required');
    }
    await this.runtimePrisma.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      lineage.recurrenceFamilyKey,
    );
    const existing = await this.runtimePrisma.operationReceipt.findUnique({
      where: { invocationId_attemptKey: { invocationId, attemptKey } },
      include: directOperationReceiptAuditInclude,
    });
    if (existing) {
      assertExistingDirectOperationReceipt(existing, {
        actorPubkey: input.actorPubkey,
        policyVersionRef: runtime.policyVersionRef,
        reasonCode: input.reasonCode.trim(),
        reasonDigest: runtime.reasonDigest,
        limitsDigest: runtime.limitsDigest,
        payloadDigest: runtime.payloadDigest,
      });
      await assertInitialOperationEffectForReceipt(this.runtimePrisma, {
        invocationId,
        receipt: existing,
      });
      return {
        receipt: projectGovernedDirectOperationReceipt(existing),
        result: null,
        replayed: true,
      };
    }
    if (input.authorityMode !== 'system_role') {
      await assertOperatorCapabilityAvailable(this.runtimePrisma, {
        targetCircleId: input.targetCircleId,
        actorPubkey: input.actorPubkey,
        actionType: input.actionType,
        subjectType: input.targetType,
        subjectRef: input.targetRef,
        now,
      });
    }
    if (input.authorityMode === 'shared_committee') {
      const operatorPolicy = runtime.authorityLimits.operatorPolicy as Record<string, unknown> | null;
      const frequency = operatorPolicy?.frequency as Record<string, unknown> | null;
      const windowSeconds = Number(frequency?.windowSeconds);
      const maximumInvocations = Number(frequency?.maximumInvocations);
      if (!Number.isSafeInteger(windowSeconds) || !Number.isSafeInteger(maximumInvocations)) {
        throw new Error('governed_shared_committee_operator_frequency_policy_required');
      }
      await this.runtimePrisma.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `shared-committee-frequency:${runtime.governanceHomeRef}:${input.actionType}:${input.actorPubkey}`,
      );
      const recentInvocationCount = await (this.runtimePrisma as any).governedActionInvocation.count({
        where: {
          governanceHomeType: runtime.governanceHomeType,
          governanceHomeRef: runtime.governanceHomeRef,
          actorPubkey: input.actorPubkey,
          contractVersion: { actionType: input.actionType },
          createdAt: { gte: new Date(now.getTime() - windowSeconds * 1000) },
          state: { in: ['executing', 'completed'] },
          NOT: {
            subjectType: input.targetType,
            subjectRef: input.targetRef,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (recentInvocationCount >= maximumInvocations) {
        throw new Error('governed_shared_committee_operation_frequency_exceeds_policy');
      }
    }
    const existingInvocation = await this.runtimePrisma.governedActionInvocation.findUnique({
      where: { id: invocationId },
      include: { authoritySnapshot: true },
    });
    const previousReceiptRef = existingInvocation?.previousReceiptRef ?? await previousOperationReceiptRef(
      this.runtimePrisma,
      {
        invocationId,
        recurrenceKey: lineage.recurrenceKey,
        governanceHomeType: runtime.governanceHomeType,
        governanceHomeRef: runtime.governanceHomeRef,
        actionType: input.actionType,
        subjectType: input.targetType,
        subjectRef: input.targetRef,
      },
    );
    const invocationOpenedAt = existingInvocation?.createdAt ?? now;
    await this.invocationStore.openInvocationWithAuthoritySnapshot({
      invocation: {
        id: invocationId,
        contractVersionId: runtime.contractVersionId,
        profileBindingId: runtime.profileBindingId,
        governanceHomeType: runtime.governanceHomeType,
        governanceHomeRef: runtime.governanceHomeRef,
        actorPubkey: input.actorPubkey,
        subjectType: input.targetType,
        subjectRef: input.targetRef,
        payloadSchemaVersion: 'governed-action-payload-v1',
        payloadDigest: runtime.payloadDigest,
        reasonDigest: runtime.reasonDigest,
        requestedEffect: payload,
        collectiveCommitmentRequired: false,
        idempotencyKey: input.idempotencyKey,
        idempotencyScope: runtime.idempotencyScope,
        idempotencyWindowStart: lineage.idempotencyWindowStart,
        idempotencyWindowEnd: lineage.idempotencyWindowEnd,
        attemptKey,
        recurrenceKey: lineage.recurrenceKey,
        previousReceiptRef,
        preflightStatus: 'authorized_direct',
        preflightDigest: runtime.preflightDigest,
        state: 'executing',
        createdAt: invocationOpenedAt,
        updatedAt: invocationOpenedAt,
      },
      authoritySnapshot: directAuthoritySnapshot({
        invocationId,
        runtime,
        targetType: input.targetType,
        targetRef: input.targetRef,
        validFrom: invocationOpenedAt,
      }),
    });

    if (runtime.capabilityValidUntil
      && this.now().getTime() >= runtime.capabilityValidUntil.getTime()) {
      throw new Error('governed_shared_committee_capability_expired');
    }
    const startedAt = this.now();
    const execution = await input.execute();
    const completedAt = this.now();
    const resultDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.operation-result',
      execution.result,
    );
    const receiptId = `operation-receipt:${hashCanonicalGovernanceValue(
      'alcheme.governance.operation-receipt-id',
      { invocationId, attemptKey },
    ).slice(0, 56)}`;
    const appealRef = `governed-action-appeal:${receiptId}`;
    const appealWindowEndsAt = runtime.appealPolicy
      ? new Date(completedAt.getTime() + runtime.appealPolicy.windowSeconds * 1000)
      : null;
    const escalationRef = `governance-case-escalation:${invocationId}`;
    const receiptFacts = {
      invocationId,
      attemptKey,
      actorPubkey: input.actorPubkey,
      capabilityDigest: runtime.authority.capabilityDigest,
      policyVersionRef: runtime.policyVersionRef,
      reasonCode: input.reasonCode.trim(),
      reasonDigest: runtime.reasonDigest,
      limitsDigest: runtime.limitsDigest,
      payloadDigest: runtime.payloadDigest,
      resultDigest,
      executionAdapter: definition.executionAdapter,
      executionDomain: definition.executionDomain,
      executionStatus: 'succeeded',
      executionRef: execution.executionRef,
      errorCode: null,
      appealRef,
      appealWindowEndsAt: appealWindowEndsAt?.toISOString() ?? null,
      escalationRef,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
    const receipt = await this.runtimePrisma.operationReceipt.create({
      data: {
        id: receiptId,
        ...receiptFacts,
        appealWindowEndsAt,
        startedAt,
        completedAt,
        receiptDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.operation-receipt',
          receiptFacts,
        ),
      },
    });
    await createInitialOperationEffect(this.runtimePrisma, {
      invocationId, receipt, activatedAt: completedAt,
    });
    const completedState = assertInvocationLifecycleTransition('executing', 'completed');
    const completed = await this.runtimePrisma.governedActionInvocation.updateMany({
      where: { id: invocationId, state: 'executing' },
      data: { state: completedState, updatedAt: completedAt },
    });
    if (completed.count !== 1) throw new Error('governed_action_invocation_transition_cas_failed');
    const durableReceipt = await this.runtimePrisma.operationReceipt.findUnique({
      where: { id: receipt.id },
      include: directOperationReceiptAuditInclude,
    });
    if (!durableReceipt) throw new Error('governed_direct_operation_receipt_readback_required');
    return {
      receipt: projectGovernedDirectOperationReceipt(durableReceipt),
      result: execution.result,
      replayed: false,
    };
  }

  private async openRuntimeResolvedRequest(input: {
    actionType: string;
    targetCircleId?: number;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    proposerPubkey: string;
    expiresAt?: Date | null;
    authority: import('./governedActionGatewayRuntime').GovernedActionGatewayRuntimeBinding;
    eligibleActors: GovernanceEligibleActor[];
    scope: { type: string; ref: string };
    appendCircleBindingFacts?: boolean;
    runtime: GovernedActionGatewayRuntimeResolution;
    caseRef: string | null;
    stageRef: string | null;
    executionAuthorizationReason: string;
    createCaseForRequest?: boolean;
    caseTemplate?: NativeGovernanceCaseTemplate;
    requestId?: string;
    now: Date;
  }): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
    const definition = assertRegistered(this.registry, input.actionType);
    assertGovernedActionRuntimeAvailable(definition);
    if (definition.targetType !== input.targetType) {
      throw new Error('governed_action_contract_target_type_mismatch');
    }
    if (!this.runtimePrisma || !this.invocationStore) {
      throw new Error('governed_action_runtime_required');
    }
    if (input.eligibleActors.length === 0) {
      throw new Error('governance_eligible_actors_required');
    }
    if (
      input.scope.type === 'circle_governance_committee'
      && !hasGovernanceCommitteeOperator(input.eligibleActors)
    ) {
      throw new Error('governance_committee_operator_required');
    }
    const requestExpiresAt = input.expiresAt
      ?? new Date(input.now.getTime() + GOVERNANCE_REQUEST_DEFAULT_TTL_SECONDS * 1_000);
    const payload = normalizeGovernedActionPayload(input.payload);
    const profileTransition = input.actionType.startsWith('governance.profile.')
      ? assertGovernanceProfileTransitionEnvelopePayload(input.actionType, payload)
      : null;
    if (
      profileTransition
      && (
        input.runtime.homeIdentityBindingId !== profileTransition.homeIdentityBindingId
        || (
          profileTransition.currentProfileVersionRef !== null
          && input.runtime.profileVersionRef !== profileTransition.currentProfileVersionRef
        )
      )
    ) {
      throw new Error('governance_profile_runtime_pin_mismatch');
    }
    if (hashCanonicalGovernanceValue('alcheme.governance.action-payload', payload)
      !== input.runtime.payloadDigest) {
      throw new Error('governed_action_runtime_payload_digest_mismatch');
    }
    if (input.runtime.executionMode === 'legacy_action_checkpoint') {
      if (!input.runtime.compatibilityBundleVersion || input.caseRef || input.stageRef) {
        throw new Error('governed_action_legacy_mode_facts_invalid');
      }
    } else if (
      !['stage_decision_only', 'provider_bound_action'].includes(input.runtime.executionMode)
      || input.runtime.compatibilityBundleVersion !== null
      || !input.caseRef
      || !input.stageRef
    ) {
      throw new Error('governed_action_stage_mode_facts_invalid');
    }
    if (['realm', 'grant', 'protocol', 'external_institution']
      .includes(input.runtime.governanceHomeType)) {
      if (!input.runtime.externalIdentityReadback || !this.verifyExternalHomeIdentity) {
        throw new Error('external_governance_home_identity_readback_required');
      }
      await this.verifyExternalHomeIdentity(input.runtime.externalIdentityReadback, input.now);
    }
    const binding = { binding: input.runtime.requestPolicy ?? input.authority };
    const eligibleActors = input.eligibleActors;
    const runtime = input.runtime;
    const now = input.now;
    const lineage = resolveGovernedActionInvocationLineage({
      idempotencyScope: runtime.idempotencyScope,
      idempotencyWindowSeconds: runtime.idempotencyWindowSeconds,
      homeIdentityBindingId: runtime.homeIdentityBindingId,
      contractVersionId: runtime.contractVersionId,
      profileBindingId: runtime.profileBindingId,
      profileVersionRef: runtime.profileVersionRef,
      actionType: input.actionType,
      subjectType: input.targetType,
      subjectRef: input.targetRef,
      idempotencyKey: input.idempotencyKey,
      payloadDigest: runtime.payloadDigest,
      reasonDigest: null,
      now,
    });
    const { invocationId } = lineage;
    const requestId = input.requestId ?? this.createRequestId?.()
      ?? `gov_req_${hashCanonicalGovernanceValue(
        'alcheme.governance.request-id',
        { invocationId, idempotencyKey: input.idempotencyKey },
      ).slice(0, 56)}`;
    if (input.runtime.governanceHomeType === 'circle') {
      const circleId = Number(input.runtime.governanceHomeRef);
      if (!Number.isSafeInteger(circleId) || circleId <= 0) {
        throw new Error('governance_home_circle_ref_invalid');
      }
      if (typeof this.runtimePrisma.governanceRequest?.findUnique !== 'function') {
        throw new Error('governance_request_owner_required');
      }
      const existingRequest = await this.runtimePrisma.governanceRequest.findUnique({
        where: { id: requestId },
        select: { id: true },
      });
      if (!existingRequest) {
        await assertGovernanceHomeAllowsNewIntake(this.runtimePrisma, {
          circleId,
          actionType: input.actionType,
          payload,
          authoritySourceType: input.runtime.authority.sourceType,
        });
      }
    }
    const authoritySnapshotId = `${invocationId}:authority`;
    const authoritySnapshotFacts = {
      invocationId,
      bindingId: runtime.authorityBindingId,
      authoritySourceType: runtime.authority.sourceType,
      authoritySourceRef: runtime.authority.sourceRef,
      authoritySourceVersion: runtime.authority.sourceVersion,
      profileBindingId: runtime.profileBindingId,
      profileVersionRef: runtime.profileVersionRef,
      profileDefinitionDigest: runtime.profileDefinitionDigest,
      externalIdentityReadback: runtime.externalIdentityReadback ? {
        network: runtime.externalIdentityReadback.network,
        canonicalOrganizationRef: runtime.externalIdentityReadback.canonicalOrganizationRef,
        controllingAuthorityRef: runtime.externalIdentityReadback.controllingAuthorityRef,
        verificationDigest: runtime.externalIdentityReadback.verificationDigest,
        observedAt: runtime.externalIdentityReadback.observedAt.toISOString(),
        expiresAt: runtime.externalIdentityReadback.expiresAt.toISOString(),
      } : null,
      selectorDigest: runtime.authority.selectorDigest,
      capabilityDigest: runtime.authority.capabilityDigest,
      resolvedSubjectDigest: hashCanonicalGovernanceValue('alcheme.governance.action-subject', {
        targetType: input.targetType,
        targetRef: input.targetRef,
      }),
      resolvedPayloadDigest: runtime.payloadDigest,
      liveConfigDigest: runtime.executionModeDigest,
      decisionPath: runtime.executionMode,
      riskFloor: runtime.riskFloor ?? definition.impact,
      resolverVersion: 'governed-action-gateway-runtime-v1',
      validFrom: now.toISOString(),
      validUntil: requestExpiresAt.toISOString(),
    };
    await this.invocationStore.openInvocationWithAuthoritySnapshot({
      invocation: {
        id: invocationId,
        contractVersionId: runtime.contractVersionId,
        profileBindingId: runtime.profileBindingId,
        governanceHomeType: runtime.governanceHomeType,
        governanceHomeRef: runtime.governanceHomeRef,
        actorPubkey: input.proposerPubkey,
        subjectType: input.targetType,
        subjectRef: input.targetRef,
        payloadSchemaVersion: 'governed-action-payload-v1',
        payloadDigest: runtime.payloadDigest,
        reasonDigest: null,
        requestedEffect: payload,
        collectiveCommitmentRequired: true,
        idempotencyKey: input.idempotencyKey,
        idempotencyScope: runtime.idempotencyScope,
        idempotencyWindowStart: lineage.idempotencyWindowStart,
        idempotencyWindowEnd: lineage.idempotencyWindowEnd,
        attemptKey: lineage.attemptKey,
        recurrenceKey: lineage.recurrenceKey,
        previousReceiptRef: null,
        preflightStatus: 'authorized_for_decision',
        preflightDigest: runtime.executionModeDigest,
        state: 'authorized',
        createdAt: now,
        updatedAt: now,
      },
      authoritySnapshot: {
        id: authoritySnapshotId,
        invocationId,
        bindingId: runtime.authorityBindingId,
        authoritySourceType: runtime.authority.sourceType,
        authoritySourceRef: runtime.authority.sourceRef,
        authoritySourceVersion: runtime.authority.sourceVersion,
        profileBindingId: runtime.profileBindingId,
        profileVersionRef: runtime.profileVersionRef,
        providerVersionRef: null,
        selectorDigest: runtime.authority.selectorDigest,
        capabilityDigest: runtime.authority.capabilityDigest,
        resolvedSubjectDigest: authoritySnapshotFacts.resolvedSubjectDigest,
        resolvedPayloadDigest: runtime.payloadDigest,
        liveConfigDigest: runtime.executionModeDigest,
        decisionPath: runtime.executionMode,
        riskFloor: runtime.riskFloor ?? definition.impact,
        resolverVersion: authoritySnapshotFacts.resolverVersion,
        validFrom: now,
        validUntil: requestExpiresAt,
        snapshotDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.resolved-action-authority-snapshot',
          authoritySnapshotFacts,
        ),
        createdAt: now,
      },
    });

    return openGovernanceRequest(this.requestStore, {
      id: requestId,
      homeIdentityBindingId: runtime.homeIdentityBindingId,
      invocationId,
      policyId: binding.binding.policyId,
      policyVersionId: binding.binding.policyVersionId,
      policyVersion: binding.binding.policyVersion,
      ruleId: binding.binding.ruleId,
      scope: input.scope,
      action: {
        type: definition.actionType,
        targetType: input.targetType,
        targetRef: input.targetRef,
        payload,
        idempotencyKey: input.idempotencyKey,
      },
      proposerPubkey: input.proposerPubkey,
      executionMode: runtime.executionMode,
      caseRef: input.caseRef,
      stageRef: input.stageRef,
      compatibilityBundleVersion: runtime.compatibilityBundleVersion,
      executionModeDigest: runtime.executionModeDigest,
      executionAuthorizationStatus: 'authorized',
      executionAuthorizationReason: input.executionAuthorizationReason,
      eligibleActors,
      openedAt: now,
      expiresAt: requestExpiresAt,
      attachToExistingCase: input.createCaseForRequest === false,
      caseTemplate: input.createCaseForRequest === false
        ? null
        : input.caseTemplate ?? selectGovernanceCaseTemplateForInvocation({
            definition,
            profileBindingId: runtime.profileBindingId,
            profileVersionRef: runtime.profileVersionRef,
            profileDefinitionDigest: runtime.profileDefinitionDigest,
            contractVersionId: runtime.contractVersionId,
            contractDefinitionDigest: runtime.contractDefinitionDigest,
            home: {
              type: runtime.governanceHomeType,
              ref: runtime.governanceHomeRef,
            },
            governedSubject: { type: input.targetType, ref: input.targetRef },
            authority: {
              sourceType: input.authority.authoritySourceType,
              sourceRef: input.authority.authoritySourceRef,
              sourceVersion: input.authority.authoritySourceVersion,
              selector: input.authority.authoritySelector,
              limits: input.authority.authorityLimits,
            },
            scope: input.scope,
          }),
    }) as Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }>;
  }

  verifyDecision(input: {
    request: Pick<GovernanceRequestRecord, "state" | "actionType" | "targetType" | "targetRef">;
    actionType: string;
    targetType: string;
    targetRef: string;
  }): { ok: true } | { ok: false; reason: string } {
    if (input.request.state !== "accepted") {
      return { ok: false, reason: "governance_decision_not_accepted" };
    }
    if (
      input.request.actionType !== input.actionType ||
      input.request.targetType !== input.targetType ||
      input.request.targetRef !== input.targetRef
    ) {
      return { ok: false, reason: "governance_decision_target_mismatch" };
    }
    return { ok: true };
  }

  async recordReceipt(
    input: GovernanceExecutionReceiptRecord,
  ): Promise<GovernanceExecutionReceiptRecord> {
    if (!this.engineStore) {
      throw new Error("governance_engine_store_required");
    }
    return recordExecutionReceipt(this.engineStore, input);
  }
}

export function assertCompromisedKeyBindingReplacementRecovery(input: {
  actionType: string;
  targetType: string;
  targetRef: string;
  authority: import('./governedActionGatewayRuntime').GovernedActionGatewayRuntimeBinding;
  eligibleActors: GovernanceEligibleActor[];
  payload: Record<string, unknown>;
  now: Date;
}): boolean {
  if (input.payload.continuityIncidentResolution == null) return false;
  const incident = normalizeGovernanceContinuityIncidentResolution(
    input.payload.continuityIncidentResolution,
  );
  const health = projectGovernanceAuthorityHealthReadback(input.authority, input.now);
  if (
    input.actionType !== 'circle.governance_binding.replace'
    || input.targetType !== 'circle_governance_binding'
    || input.targetRef !== input.authority.id
    || !incident
    || health.evidenceIntegrity !== 'verified'
    || health.faultAssessment?.faultClass !== 'compromised_key'
    || health.evidenceDigest !== incident.previousEvidenceDigest
    || health.faultAssessment.evidenceRef !== incident.faultEvidenceRef
    || health.faultAssessment.affectedActorPubkey !== incident.affectedActorPubkey
    || incident.previousBindingId !== input.authority.id
    || input.payload.replacesBindingId !== input.authority.id
    || input.eligibleActors.some((actor) => actor.pubkey === incident.affectedActorPubkey)
    || !hasGovernanceCommitteeOperator(input.eligibleActors)
  ) throw new Error('governance_continuity_incident_recovery_authority_invalid');
  return true;
}

function assertExistingDirectOperationReceipt(
  receipt: any,
  expected: {
    actorPubkey: string;
    policyVersionRef: string;
    reasonCode: string;
    reasonDigest: string;
    limitsDigest: string;
    payloadDigest: string;
  },
): void {
  for (const [key, value] of Object.entries(expected)) {
    if (receipt[key] !== value) {
      throw new Error('governed_direct_operation_idempotency_mismatch');
    }
  }
}

async function previousOperationReceiptRef(
  prisma: any,
  input: {
    invocationId: string;
    recurrenceKey: string;
    governanceHomeType: string;
    governanceHomeRef: string;
    actionType: string;
    subjectType: string;
    subjectRef: string;
  },
): Promise<string | null> {
  if (typeof prisma.operationReceipt?.findFirst !== 'function') {
    throw new Error('governed_action_recurrence_receipt_lookup_required');
  }
  const previous = await prisma.operationReceipt.findFirst({
    where: {
      invocationId: { not: input.invocationId },
      invocation: {
        governanceHomeType: input.governanceHomeType,
        governanceHomeRef: input.governanceHomeRef,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        contractVersion: { actionType: input.actionType },
      },
    },
    include: { invocation: { select: { recurrenceKey: true } } },
    orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
  });
  if (!previous) return null;
  if (previous.invocation?.recurrenceKey === input.recurrenceKey) {
    throw new Error('governed_action_recurrence_identity_conflict');
  }
  return String(previous.id);
}

function directAuthoritySnapshot(input: {
  invocationId: string;
  runtime: GovernedDirectOperationRuntimeResolution;
  targetType: string;
  targetRef: string;
  validFrom: Date;
}) {
  const facts = {
    invocationId: input.invocationId,
    bindingId: input.runtime.authorityBindingId,
    authoritySourceType: input.runtime.authority.sourceType,
    authoritySourceRef: input.runtime.authority.sourceRef,
    authoritySourceVersion: input.runtime.authority.sourceVersion,
    profileBindingId: input.runtime.profileBindingId,
    profileVersionRef: input.runtime.profileVersionRef,
    selectorDigest: input.runtime.authority.selectorDigest,
    capabilityDigest: input.runtime.authority.capabilityDigest,
    resolvedSubjectDigest: hashCanonicalGovernanceValue('alcheme.governance.action-subject', {
      targetType: input.targetType,
      targetRef: input.targetRef,
    }),
    resolvedPayloadDigest: input.runtime.payloadDigest,
    liveConfigDigest: input.runtime.preflightDigest,
    decisionPath: 'operational_execution',
    riskFloor: input.runtime.riskFloor,
    resolverVersion: 'governed-action-gateway-runtime-v1',
    validFrom: input.validFrom.toISOString(),
    validUntil: input.runtime.capabilityValidUntil?.toISOString() ?? null,
  };
  return {
    id: `${input.invocationId}:authority`,
    ...facts,
    profileVersionRef: input.runtime.profileVersionRef,
    providerVersionRef: null,
    validFrom: input.validFrom,
    validUntil: input.runtime.capabilityValidUntil,
    snapshotDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.resolved-action-authority-snapshot',
      facts,
    ),
    createdAt: input.validFrom,
  };
}

const directOperationReceiptAuditInclude = {
  invocation: {
    include: {
      authoritySnapshot: { include: { binding: true } },
    },
  },
} as const;

function directOperationAuditRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('governed_direct_operation_receipt_audit_readback_mismatch');
  }
  return value as Record<string, unknown>;
}

export function projectGovernedDirectOperationReceipt(value: any): GovernedDirectOperationReceiptRecord {
  const invocation = value.invocation;
  const snapshot = invocation?.authoritySnapshot;
  const binding = snapshot?.binding;
  if (!invocation || !snapshot || !binding
    || invocation.id !== value.invocationId
    || invocation.actorPubkey !== value.actorPubkey
    || snapshot.invocationId !== value.invocationId
    || snapshot.bindingId !== binding.id
    || snapshot.authoritySourceType !== binding.sourceType
    || snapshot.authoritySourceRef !== binding.sourceRef
    || (snapshot.authoritySourceVersion ?? null) !== (binding.sourceVersion ?? null)
    || snapshot.resolvedPayloadDigest !== value.payloadDigest
    || snapshot.capabilityDigest !== value.capabilityDigest
    || hashCanonicalGovernanceValue(
      'alcheme.governance.action-authority-limits',
      directOperationAuditRecord(binding.limits),
    ) !== value.limitsDigest) {
    throw new Error('governed_direct_operation_receipt_audit_readback_mismatch');
  }
  const appealWindowEndsAt = value.appealWindowEndsAt == null
    ? null
    : new Date(value.appealWindowEndsAt).toISOString();
  return {
    id: String(value.id),
    invocationId: String(value.invocationId),
    attemptKey: String(value.attemptKey),
    actorPubkey: String(value.actorPubkey),
    subjectType: String(invocation.subjectType),
    subjectRef: String(invocation.subjectRef),
    roleAssignmentProof: {
      bindingId: String(binding.id),
      sourceType: String(snapshot.authoritySourceType),
      sourceRef: String(snapshot.authoritySourceRef),
      sourceVersion: snapshot.authoritySourceVersion == null
        ? null
        : String(snapshot.authoritySourceVersion),
      profileVersionRef: snapshot.profileVersionRef == null
        ? null
        : String(snapshot.profileVersionRef),
      decisionPath: String(snapshot.decisionPath),
      selector: directOperationAuditRecord(binding.selector),
      selectorDigest: String(snapshot.selectorDigest),
    },
    policyVersionRef: String(value.policyVersionRef),
    reasonCode: String(value.reasonCode),
    limits: directOperationAuditRecord(binding.limits),
    limitsDigest: String(value.limitsDigest),
    payloadDigest: String(value.payloadDigest),
    resultDigest: String(value.resultDigest),
    executionStatus: String(value.executionStatus),
    executionRef: value.executionRef == null ? null : String(value.executionRef),
    capabilityExpiresAt: snapshot.validUntil == null
      ? null
      : new Date(snapshot.validUntil).toISOString(),
    reviewAt: appealWindowEndsAt,
    appealRef: String(value.appealRef),
    appealWindowEndsAt,
    escalationRef: String(value.escalationRef),
    receiptDigest: String(value.receiptDigest),
  };
}

export function normalizeGovernedActionPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('invalid_governed_action_payload');
  const normalized = JSON.parse(serialized) as unknown;
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new Error('invalid_governed_action_payload');
  }
  return normalized as Record<string, unknown>;
}

function assertRegistered(
  registry: GovernedActionRegistry,
  actionType: string,
): GovernedActionDefinition {
  const definition = registry.get(actionType);
  if (!definition) {
    throw new Error("governed_action_not_registered");
  }
  return definition;
}

function assertGovernedActionRuntimeAvailable(
  definition: GovernedActionDefinition,
): void {
  const reason = governedActionUnavailableReason(definition);
  if (reason) throw new Error(reason);
}
