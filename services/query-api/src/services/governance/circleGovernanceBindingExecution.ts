import { createHash } from "node:crypto";

import { hashCanonicalGovernanceValue } from "./canonicalCodec";
import {
  assertGovernanceMandateProjectionMatch,
  buildCommitteePolicyRules,
  buildGovernanceCrossInstitutionDisclosureImpact,
  buildGovernanceMandateTerms,
  computeGovernanceMandateTermsDigest,
  createLocalAuxiliaryGovernanceBinding,
  createSelfGovernedExactGovernanceBinding,
  createSharedCommitteeMandateBinding,
  normalizeGovernanceMandateOperatorPolicyConstraints,
  type CircleGovernanceBindingSupersedeInput,
  type GovernanceMandateEffectPolicy,
  type GovernanceMandateFeePolicy,
  type GovernanceMandateMinimumConstraints,
  type GovernanceMandateOperatorPolicyConstraints,
  type GovernanceCrossInstitutionDisclosureImpact,
} from "./circleGovernanceBindings";
import {
  hasGovernanceCommitteeOperator,
  listCommitteeEligibleActors,
} from "./circleCommitteeActors";
import { normalizeCircleGovernanceCommitteeElectorateTemplate } from "./circleCommitteeProfiles";
import { computeGovernancePolicyRulesDigest } from "./policyEngine";
import {
  createGovernanceBootstrapBundle,
  type GovernanceBootstrapBundle,
  type GovernanceBootstrapBundleInput,
} from "./governanceBootstrapContract";
import {
  governanceMandateAuthoritySourceVersion,
  terminateGovernanceMandateEffectsInTransaction,
} from "./governanceMandateEffects";
import {
  activateGovernanceRecoveryPolicy,
  GOVERNANCE_RECOVERY_POLICY_KIND,
} from './governanceRecoveryPolicy';
import { resolveActiveGovernanceProfileForWork } from './governanceProfileLifecycle';
import { projectGovernanceAuthorityHealthReadback } from './governanceAuthorityHealthReadback';
import {
  buildGovernanceContinuitySuccessorActorSnapshot,
  governanceContinuitySuccessorActorSnapshotDigest,
  normalizeGovernanceContinuityIncidentResolution,
  type GovernanceContinuityIncidentResolution,
} from './governanceContinuityIncident';
import { getGovernanceCaseActionDefinition } from './governanceCaseActionComposition';
import {
  materializeExactActionAuthorityBinding,
  requiresExactActionAuthorityMaterialization,
  retireExactActionAuthorityBindingsForDomainBinding,
} from './exactActionAuthorityMaterialization';

export const CIRCLE_GOVERNANCE_BINDING_EXECUTOR = "circle_governance_binding";
export const CIRCLE_GOVERNANCE_BINDING_ACCEPT_MANDATE_ACTION_TYPE =
  "circle.governance_binding.accept_mandate";
export const CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE =
  "circle.governance_binding.create";
export const CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE =
  "circle.governance_binding.replace";
export const CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE =
  "circle.governance_binding.deactivate";
export const CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE =
  "circle.governance_binding.policy_version.update";
const CONFIGURATION_TRANSITION_IMPACT_DOMAIN = 'alcheme.governance.configuration-transition-impact';

type CircleGovernanceBindingPrisma = {
  circleGovernanceBinding: {
    findUnique?(input: {
      where: { id: string };
    }): Promise<CircleGovernanceBindingControlFacts | null>;
    update(input: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany?(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
    findFirst?(input: unknown): Promise<CircleGovernanceBindingControlFacts | null>;
  };
  governanceMandate?: {
    findUnique(input: unknown): Promise<GovernanceMandateControlFacts | null>;
    findMany?(input: unknown): Promise<GovernanceMandateControlFacts[]>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governanceMandateVersion?: {
    findUnique(input: unknown): Promise<GovernanceMandateVersionControlFacts | null>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governancePolicy?: {
    findUnique(input: { where: { id: string } }): Promise<GovernancePolicyControlFacts | null>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governancePolicyVersion?: {
    findUnique(input: { where: { id: string } }): Promise<GovernancePolicyVersionControlFacts | null>;
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governanceConfigurationBundle?: {
    findUnique(input: { where: Record<string, unknown> }): Promise<any>;
  };
  governanceActivationState?: {
    findUnique(input: { where: Record<string, unknown> }): Promise<any>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governanceRecoveryPolicy?: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  actionAuthorityPolicyBinding?: {
    findMany(input: unknown): Promise<any[]>;
    findUnique(input: { where: { id: string } }): Promise<any>;
    create(input: { data: Record<string, unknown> }): Promise<any>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governedActionContractVersion?: {
    findUnique(input: unknown): Promise<any>;
    create(input: { data: Record<string, unknown> }): Promise<any>;
  };
  governanceCase?: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceRequest?: {
    findUnique(input: unknown): Promise<any>;
  };
  notification?: {
    findMany(input: unknown): Promise<any[]>;
  };
  circleMember?: {
    findMany(input: unknown): Promise<unknown[]>;
  };
  governanceHomeIdentityBinding?: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceProfileBinding?: {
    findUnique(input: unknown): Promise<any>;
  };
  $transaction?<T>(
    operation: (tx: CircleGovernanceBindingPrisma) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' | 'RepeatableRead' | 'ReadCommitted' },
  ): Promise<T>;
};

interface GovernancePolicyControlFacts {
  id: string;
  status: string;
  activeVersion: number | null;
  scopeType?: string;
  scopeRef?: string;
}

interface GovernancePolicyVersionControlFacts {
  id: string;
  policyId: string;
  version: number;
  status: string;
  rules: unknown;
  configDigest: string;
}

interface GovernanceMandateControlFacts {
  id: string;
  delegatorGovernanceHomeType: string;
  delegatorGovernanceHomeRef: string;
  delegateAuthorityType: string;
  delegateAuthorityRef: string;
  status: string;
  currentVersion: number;
  currentTermsDigest: string;
  targetAuthorizationStatus: string;
  committeeAcceptanceStatus: string;
  acceptanceExpiresAt: Date | string;
  bindingType?: string;
  createdByPubkey?: string;
  versions?: GovernanceMandateVersionControlFacts[];
}

interface GovernanceMandateVersionControlFacts {
  id: string;
  mandateId: string;
  version: number;
  termsDigest: string;
  effectiveFrom: Date | string;
  effectiveUntil: Date | string;
  terms: any;
  purpose?: string;
  environment?: string;
  network?: string;
  subjectType?: string;
  subjectRef?: string;
  actionType?: string | null;
  actionPrefix?: string | null;
  purposeBindings?: unknown;
  targetAcceptedTermsDigest: string | null;
  committeeAcceptedTermsDigest: string | null;
  sourceRequestId?: string | null;
  sourceDecisionDigest?: string | null;
}

export interface CircleGovernanceBindingControlFacts {
  id: string;
  targetCircleId: number;
  committeeCircleId?: number;
  actionType?: string | null;
  actionPrefix?: string | null;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  status: string;
  mandateId?: string | null;
  bindingType?: string;
  authorityCanonicalState?: string | null;
  targetAuthorizationStatus?: string;
  committeeMandateStatus?: string;
  sourceRequestId?: string | null;
  sourceDecisionDigest?: string | null;
  metadata?: unknown;
  authorityHealthStatus?: string | null;
  authorityHealthEvidence?: unknown;
  authorityHealthEvidenceDigest?: string | null;
  authorityHealthCheckedAt?: Date | string | null;
  authorityHealthStaleAt?: Date | string | null;
  updatedAt: Date | string;
}

export function computeCircleGovernanceBindingControlDigest(
  binding: CircleGovernanceBindingControlFacts,
): string {
  const id = normalizeRequiredText(binding.id);
  const targetCircleId = Number(binding.targetCircleId);
  const committeeCircleId = Number(binding.committeeCircleId);
  const actionType = parseCanonicalNullableText(binding.actionType ?? null);
  const actionPrefix = parseCanonicalNullableText(binding.actionPrefix ?? null);
  const policyId = normalizeRequiredText(binding.policyId);
  const policyVersionId = normalizeRequiredText(binding.policyVersionId);
  const policyVersion = Number(binding.policyVersion);
  const status = normalizeRequiredText(binding.status);
  const updatedAt = binding.updatedAt instanceof Date
    ? binding.updatedAt
    : new Date(binding.updatedAt);
  if (
    !id
    || !Number.isInteger(targetCircleId)
    || targetCircleId <= 0
    || !Number.isInteger(committeeCircleId)
    || committeeCircleId <= 0
    || actionType === undefined
    || actionPrefix === undefined
    || (actionType === null) === (actionPrefix === null)
    || !policyId
    || !policyVersionId
    || !Number.isInteger(policyVersion)
    || policyVersion <= 0
    || !status
    || Number.isNaN(updatedAt.getTime())
  ) {
    throw new Error("invalid_circle_governance_binding_control_facts");
  }
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    id,
    targetCircleId,
    committeeCircleId,
    actionType,
    actionPrefix,
    policyId,
    policyVersionId,
    policyVersion,
    status,
    updatedAt: updatedAt.toISOString(),
  })).digest("hex");
}

export async function executeCircleGovernanceBindingAction(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
    proposerPubkey?: string;
    decisionDigest?: string | null;
    now?: Date;
  },
): Promise<{
  executionStatus: "executed";
  executionRef: string;
}> {
  if (
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE &&
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_ACCEPT_MANDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
  ) {
    throw new Error("unsupported_governance_binding_execution_action");
  }
  const targetMatches = request.actionType === CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE
    ? request.targetType === "circle" && Number.isSafeInteger(Number(request.targetRef))
    : request.targetType === "circle_governance_binding" && Boolean(request.targetRef);
  if (!targetMatches) {
    throw new Error("invalid_circle_governance_binding_target");
  }
  const decisionDigest = normalizeDecisionDigest(request.decisionDigest);
  if (!decisionDigest) {
    throw new Error("governance_binding_decision_digest_required");
  }

  const executedAt = request.now ?? new Date();
  if (
    request.actionType === CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE
    || request.actionType === CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE
  ) {
    const bindingId = await executeBindingCreateOrReplace(prisma, request, {
      decisionDigest,
      executedAt,
    });
    return {
      executionStatus: "executed",
      executionRef: bindingId,
    };
  }
  if (request.actionType === CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE) {
    const transitionPlan = asRecord(asRecord(request.payload).configurationTransitionPlan);
    const recoveryPolicyProposal = asRecord(asRecord(request.payload).governanceRecoveryPolicyProposal);
    if (recoveryPolicyProposal.kind === GOVERNANCE_RECOVERY_POLICY_KIND) {
      if (!prisma.governanceRecoveryPolicy || !prisma.governancePolicy || !prisma.governancePolicyVersion) {
        throw new Error('governance_recovery_policy_runtime_required');
      }
      const recoveryPolicyId = await activateGovernanceRecoveryPolicy(prisma, {
        requestId: request.id,
        bindingId: request.targetRef,
        proposal: recoveryPolicyProposal,
        decisionDigest,
        now: executedAt,
      });
      return {
        executionStatus: 'executed',
        executionRef: recoveryPolicyId,
      };
    }
    if (transitionPlan.kind === 'governance_configuration_transition') {
      const targetBundleId = await executeConfigurationTransitionCutover(prisma, request, {
        decisionDigest,
        executedAt,
      });
      return {
        executionStatus: "executed",
        executionRef: targetBundleId,
      };
    }
    const policyVersionId = await executePolicyVersionUpdate(prisma, request, {
      decisionDigest,
      executedAt,
    });
    return {
      executionStatus: "executed",
      executionRef: policyVersionId,
    };
  }
  if (request.actionType === CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE) {
    await executeScopedBindingDeactivation(prisma, request, {
      decisionDigest,
      executedAt,
    });
    return {
      executionStatus: "executed",
      executionRef: request.targetRef,
    };
  }
  await executeGovernanceMandateAcceptance(prisma, request, {
    decisionDigest,
    executedAt,
  });

  return {
    executionStatus: "executed",
    executionRef: request.targetRef,
  };
}

async function executeConfigurationTransitionCutover(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    targetRef: string;
    payload?: unknown;
  },
  input: { decisionDigest: string; executedAt: Date },
): Promise<string> {
  if (
    !prisma.circleGovernanceBinding?.findUnique
    || !prisma.circleGovernanceBinding?.updateMany
    || !prisma.governancePolicy
    || !prisma.governancePolicyVersion
    || !prisma.governanceConfigurationBundle
    || !prisma.governanceActivationState
    || !prisma.actionAuthorityPolicyBinding
  ) {
    throw new Error('governance_configuration_transition_cutover_runtime_required');
  }
  const payload = resolvePolicyVersionUpdatePayload(request);
  const rawPayload = asRecord(request.payload);
  const proposedPolicyVersionId = normalizeRequiredText(rawPayload.proposedPolicyVersionId);
  const plan = asRecord(rawPayload.configurationTransitionPlan);
  const planDigest = normalizeControlDigest(plan.planDigest);
  const fromBundleRef = asRecord(plan.fromBundle);
  const toBundleRef = asRecord(plan.toBundle);
  const authoritySnapshot = asRecord(plan.authoritySnapshot);
  const readiness = asRecord(plan.targetReadiness);
  const changeGate = asRecord(plan.changeGate);
  const readinessBootstrap = asRecord(readiness.bootstrap);
  const readinessChecks = asRecord(readinessBootstrap.checks);
  const readinessProfile = asRecord(readiness.profile);
  const readinessActionContract = asRecord(readiness.actionContract);
  const readinessElectorate = asRecord(readiness.electorate);
  const readinessOperator = asRecord(readiness.operator);
  const readinessProvider = asRecord(readiness.provider);
  const readinessResource = asRecord(readiness.resource);
  const readinessExternalSigner = asRecord(readiness.externalSigner);
  const readinessPayer = asRecord(readiness.payer);
  const readinessVisibility = asRecord(readiness.visibility);
  const readinessRecovery = asRecord(readiness.recovery);
  const readinessRollback = asRecord(readiness.rollback);
  const cutover = asRecord(plan.cutover);
  const inFlightDisposition = asRecord(plan.inFlightDisposition);
  const acceptedArtifactDisposition = asRecord(inFlightDisposition.acceptedArtifacts);
  const existingEffectDisposition = asRecord(inFlightDisposition.existingOperationEffects);
  const newInvocationDisposition = asRecord(inFlightDisposition.newInvocations);
  const transitionSteps = Array.isArray(plan.transitionSteps) ? plan.transitionSteps : [];
  const prepareStep = asRecord(transitionSteps[0]);
  const localCutoverStep = asRecord(transitionSteps[1]);
  const externalTransferStep = asRecord(transitionSteps[2]);
  const irreversibleBoundary = asRecord(plan.irreversibleBoundary);
  const rollbackPolicy = asRecord(plan.rollbackPolicy);
  const rollbackSourceBundle = asRecord(rollbackPolicy.sourceBundle);
  const rollbackOf = plan.rollbackOf == null ? null : asRecord(plan.rollbackOf);
  const memberImpact = asRecord(plan.memberImpact);
  const signerImpact = asRecord(memberImpact.signerImpact);
  const resourceImpact = asRecord(plan.resourceImpact);
  const taskImpact = asRecord(plan.taskImpact);
  const exitWindow = asRecord(plan.exitWindow);
  const notificationPlan = asRecord(plan.notificationPlan);
  const institutionalContinuity = asRecord(plan.institutionalContinuity);
  const continuityHome = asRecord(institutionalContinuity.homeIdentity);
  const continuityProfile = asRecord(institutionalContinuity.profile);
  const compatibilityMatrix = asRecord(continuityProfile.compatibilityMatrix);
  const continuityMandates = asRecord(institutionalContinuity.mandates);
  const mandateSnapshot = Array.isArray(continuityMandates.snapshot)
    ? continuityMandates.snapshot
    : null;
  const retroactivity = asRecord(institutionalContinuity.retroactivity);
  const historicalReview = asRecord(retroactivity.historicalReview);
  const recoveryAuthorization = plan.recoveryAuthorization == null
    ? null
    : asRecord(plan.recoveryAuthorization);
  const recoveryPolicyId = normalizeRequiredText(rawPayload.recoveryPolicyId);
  const proposedPolicyVersion = Number(rawPayload.proposedPolicyVersion);
  const targetCommitteeCircleId = Number(rawPayload.targetCommitteeCircleId);
  const rollbackOfSourceBundle = rollbackOf === null ? null : asRecord(rollbackOf.sourceBundle);
  const fromBundleId = normalizeRequiredText(fromBundleRef.id);
  const fromBundleVersion = Number(fromBundleRef.version);
  const fromBundleDigest = normalizeControlDigest(fromBundleRef.digest);
  const toBundleId = normalizeRequiredText(toBundleRef.id);
  const toBundleVersion = Number(toBundleRef.version);
  const toBundleDigest = normalizeControlDigest(toBundleRef.digest);
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : null;
  const requiredChecks = Array.isArray(readiness.requiredChecks) ? readiness.requiredChecks : null;
  const readinessDigest = normalizeControlDigest(readiness.readinessDigest);
  const expectedRequiredChecks = [
    'profile',
    'action_contract',
    'electorate',
    'operator',
    'provider',
    'resource',
    'external_signer',
    'payer',
    'visibility',
    'recovery',
    'rollback',
  ];
  if (
    plan.kind !== 'governance_configuration_transition'
    || plan.currentContract !== 'governance_configuration_transition'
    || plan.changeLevel !== 'policy'
    || changeGate.currentProducerLevel !== 'policy'
    || JSON.stringify(changeGate.inheritedPreflightLevels) !== JSON.stringify(['policy'])
    || changeGate.higherLevelChanges !== 'unsupported_fail_closed'
    || !planDigest
    || !fromBundleId
    || !Number.isSafeInteger(fromBundleVersion)
    || fromBundleVersion < 1
    || !fromBundleDigest
    || !toBundleId
    || !Number.isSafeInteger(toBundleVersion)
    || toBundleVersion !== fromBundleVersion + 1
    || !toBundleDigest
    || !proposedPolicyVersionId
    || !Number.isSafeInteger(proposedPolicyVersion)
    || proposedPolicyVersion <= 0
    || readiness.status !== 'ready_for_governed_cutover'
    || !blockers
    || blockers.length !== 0
    || !requiredChecks
    || JSON.stringify(requiredChecks) !== JSON.stringify(expectedRequiredChecks)
    || !readinessDigest
    || readinessBootstrap.state !== 'ready'
    || readinessBootstrap.bundleDigest !== toBundleDigest
    || !Array.isArray(readinessBootstrap.blockers)
    || readinessBootstrap.blockers.length !== 0
    || readinessProfile.status !== 'ready'
    || !normalizeRequiredText(readinessProfile.bindingId)
    || !normalizeRequiredText(readinessProfile.versionRef)
    || !normalizeControlDigest(readinessProfile.definitionDigest)
    || readinessActionContract.status !== 'ready'
    || readinessActionContract.actionType !== CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
    || readinessElectorate.status !== 'ready'
    || !Number.isSafeInteger(Number(readinessElectorate.eligibleActorCount))
    || Number(readinessElectorate.eligibleActorCount) <= 0
    || readinessOperator.status !== 'ready'
    || readinessProvider.status !== 'not_applicable'
    || JSON.stringify(readinessProvider.refs) !== JSON.stringify([])
    || readinessResource.status !== 'not_applicable'
    || JSON.stringify(readinessResource.refs) !== JSON.stringify([])
    || readinessExternalSigner.status !== 'not_applicable'
    || readinessExternalSigner.authority !== 'none_required_for_p03_policy_pointer_cutover'
    || readinessPayer.status !== 'unchanged_active_ref'
    || readinessVisibility.status !== 'unchanged_active_ref'
    || readinessRecovery.status !== 'unchanged_active_ref'
    || readinessRollback.status !== 'available_before_cutover'
    || cutover.status !== 'not_started'
    || cutover.currentAuthorityRemainsActive !== true
    || cutover.targetMayApproveItself !== false
    || transitionSteps.length !== 3
    || prepareStep.id !== 'prepare_target_bundle'
    || prepareStep.owner !== 'P03'
    || prepareStep.reversibility !== 'compensable'
    || prepareStep.status !== 'prepared'
    || localCutoverStep.id !== 'governed_local_pointer_cutover'
    || localCutoverStep.owner !== 'P03'
    || localCutoverStep.reversibility !== 'compensable'
    || localCutoverStep.status !== 'awaiting_accepted_decision'
    || externalTransferStep.id !== 'external_authority_or_resource_transfer'
    || externalTransferStep.owner !== 'P06'
    || externalTransferStep.reversibility !== 'irreversible'
    || externalTransferStep.status !== 'not_applicable'
    || irreversibleBoundary.stepId !== 'external_authority_or_resource_transfer'
    || irreversibleBoundary.status !== 'not_crossed'
    || irreversibleBoundary.oneClickRollback !== false
    || rollbackPolicy.beforeBoundary !== 'new_governed_transition_to_verified_source_bundle'
    || rollbackPolicy.afterBoundary !== 'manual_recovery_or_new_governed_transition'
    || !normalizeRequiredText(rollbackSourceBundle.id)
    || !normalizeControlDigest(rollbackSourceBundle.digest)
    || !Number.isSafeInteger(Number(rollbackSourceBundle.version))
    || (
      rollbackOf === null
        ? rollbackSourceBundle.id !== fromBundleId
          || rollbackSourceBundle.digest !== fromBundleDigest
          || Number(rollbackSourceBundle.version) !== fromBundleVersion
        : rollbackOf.caseId !== rawPayload.rollbackFromCaseId
          || rawPayload.rollbackFromCaseId == null
          || rollbackOfSourceBundle?.id !== rollbackSourceBundle.id
          || Number(rollbackOfSourceBundle?.version) !== Number(rollbackSourceBundle.version)
          || rollbackOfSourceBundle?.digest !== rollbackSourceBundle.digest
          || !normalizeRequiredText(rollbackOf.sourcePolicyVersionId)
          || !normalizeControlDigest(rollbackOf.sourcePolicyConfigDigest)
          || !normalizeRequiredText(rollbackOf.governingRequestId)
          || !normalizeControlDigest(rollbackOf.governingDecisionDigest)
    )
    || acceptedArtifactDisposition.mode !== 'preserve_immutable_digest'
    || acceptedArtifactDisposition.authorityBlock !== 'amendment_or_superseding_case_required'
    || acceptedArtifactDisposition.transitionOperatorMayRewrite !== false
    || existingEffectDisposition.mode !== 'continue_frozen_lifecycle'
    || existingEffectDisposition.policySource !== 'initial_receipt_appeal_window_and_effect_events'
    || existingEffectDisposition.transitionOperatorMayRewrite !== false
    || newInvocationDisposition.mode !== 'target_bundle_only'
    || newInvocationDisposition.source !== 'active_binding_and_authority_projection'
    || inFlightDisposition.appealAccess !== 'survives_membership_or_role_loss'
    || !Number.isSafeInteger(Number(memberImpact.affectedActorCount))
    || Number(memberImpact.affectedActorCount) <= 0
    || !normalizeControlDigest(memberImpact.actorSnapshotDigest)
    || !Array.isArray(memberImpact.gainedProposalActors)
    || !Array.isArray(memberImpact.lostProposalActors)
    || !Array.isArray(memberImpact.gainedVoteActors)
    || !Array.isArray(memberImpact.lostVoteActors)
    || !Array.isArray(memberImpact.gainedOperatorActors)
    || !Array.isArray(memberImpact.lostOperatorActors)
    || !Array.isArray(memberImpact.changedRights)
    || memberImpact.changedRights.length === 0
    || memberImpact.lostProposalActors.length !== 0
    || memberImpact.lostVoteActors.length !== 0
    || memberImpact.lostOperatorActors.length !== 0
    || memberImpact.payerChange !== 'none'
    || memberImpact.visibilityChange !== 'none'
    || signerImpact.status !== 'not_applicable'
    || signerImpact.affectedSignerCount !== 0
    || signerImpact.owner !== 'P06'
    || resourceImpact.status !== 'not_applicable'
    || resourceImpact.affectedResourceCount !== 0
    || JSON.stringify(resourceImpact.refs) !== JSON.stringify([])
    || !Number.isSafeInteger(Number(taskImpact.pendingTaskCount))
    || Number(taskImpact.pendingTaskCount) < 0
    || !normalizeControlDigest(taskImpact.taskSnapshotDigest)
    || taskImpact.disposition !== 'freeze_current_case_snapshot'
    || exitWindow.status !== 'not_required_no_rights_loss'
    || exitWindow.deadline !== null
    || exitWindow.affectedActorCount !== 0
    || notificationPlan.type !== 'governance_transition'
    || notificationPlan.sourceType !== 'governance_case'
    || Number(notificationPlan.recipientCount) !== Number(memberImpact.affectedActorCount)
    || notificationPlan.recipientSnapshotDigest !== memberImpact.actorSnapshotDigest
    || !normalizeControlDigest(notificationPlan.impactDigest)
    || notificationPlan.delivery !== 'same_transaction_as_case_intake'
    || !normalizeRequiredText(continuityHome.id)
    || continuityHome.homeType !== 'circle'
    || String(continuityHome.homeRef) !== String(rawPayload.targetCircleId)
    || !Number.isSafeInteger(Number(continuityHome.identityVersion))
    || !normalizeControlDigest(continuityHome.bindingDigest)
    || continuityHome.status !== 'active'
    || continuityHome.disposition !== 'preserve_same_binding'
    || continuityProfile.bindingId !== readinessProfile.bindingId
    || continuityProfile.state !== 'active'
    || continuityProfile.versionRef !== readinessProfile.versionRef
    || continuityProfile.definitionDigest !== readinessProfile.definitionDigest
    || continuityProfile.compatibilityStatus !== 'ready'
    || !normalizeControlDigest(continuityProfile.compatibilityDigest)
    || !normalizeControlDigest(continuityProfile.migrationPreviewDigest)
    || continuityProfile.disposition !== 'preserve_same_binding_and_version'
    || asRecord(compatibilityMatrix.capability).status !== 'compatible_unchanged'
    || asRecord(compatibilityMatrix.schema).status !== 'compatible_unchanged'
    || asRecord(compatibilityMatrix.provider).status !== 'compatible_unchanged'
    || asRecord(compatibilityMatrix.uiMetadata).status !== 'compatible_unchanged'
    || !Array.isArray(compatibilityMatrix.incompatibilities)
    || compatibilityMatrix.incompatibilities.length !== 0
    || asRecord(continuityProfile.inFlight).existingInvocations
      !== 'retain_frozen_profile_binding_and_version'
    || asRecord(continuityProfile.inFlight).newInvocations
      !== 'resolve_active_profile_at_creation'
    || !mandateSnapshot
    || mandateSnapshot.length === 0
    || !normalizeControlDigest(continuityMandates.snapshotDigest)
    || continuityMandates.activeEffects !== 'follow_each_frozen_mandate_disposition'
    || continuityMandates.appealAccess !== 'bound_to_original_receipt'
    || continuityMandates.silentCopyOrLoss !== 'forbidden'
    || retroactivity.mode !== 'prospective_only'
    || retroactivity.existingContent !== 'unchanged'
    || retroactivity.memberSanctions !== 'not_retroactive'
    || retroactivity.governanceEligibility !== 'not_retroactive'
    || historicalReview.status !== 'not_requested'
    || historicalReview.requiredProducer !== 'governed_action_gateway'
    || historicalReview.recording !== 'new_invocation_and_receipt'
    || historicalReview.originalRecord !== 'preserve_immutable'
    || historicalReview.appealPolicy !== 'target_policy_for_new_review'
    || !normalizeControlDigest(institutionalContinuity.continuityDigest)
    || authoritySnapshot.bindingId !== request.targetRef
    || authoritySnapshot.bindingControlDigest !== payload.bindingControlDigest
    || authoritySnapshot.policyVersionId !== payload.currentPolicyVersionId
    || authoritySnapshot.policyVersion !== payload.currentPolicyVersion
    || authoritySnapshot.policyConfigDigest !== payload.currentPolicyConfigDigest
    || authoritySnapshot.riskFloor !== 'critical'
    || !Number.isSafeInteger(targetCommitteeCircleId)
    || targetCommitteeCircleId <= 0
    || (
      recoveryPolicyId
        ? recoveryAuthorization?.policyId !== recoveryPolicyId
          || recoveryAuthorization.trigger !== 'zero_eligible_electorate'
          || recoveryAuthorization.actionType !== CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
          || recoveryAuthorization.subjectType !== 'circle_governance_binding'
          || recoveryAuthorization.subjectRef !== request.targetRef
          || recoveryAuthorization.maxCostMinor !== '0'
          || recoveryAuthorization.assetAuthority !== 'none'
          || recoveryAuthorization.singleUse !== true
          || authoritySnapshot.sourceType !== 'governance_recovery_policy'
        : recoveryAuthorization !== null
          || authoritySnapshot.sourceType !== 'governance_mandate'
    )
  ) {
    throw new Error('governance_configuration_transition_plan_invalid');
  }
  if (
    hashCanonicalGovernanceValue(
      'alcheme.governance.configuration-transition-readiness',
      {
        bundleDigest: readinessBootstrap.bundleDigest,
        checks: readinessChecks,
        blockers,
      },
    ) !== readinessDigest
  ) {
    throw new Error('governance_configuration_transition_readiness_digest_mismatch');
  }
  const impactBody = {
    actorSnapshotDigest: memberImpact.actorSnapshotDigest,
    affectedActorCount: Number(memberImpact.affectedActorCount),
    gainedProposalActors: memberImpact.gainedProposalActors,
    lostProposalActors: memberImpact.lostProposalActors,
    gainedVoteActors: memberImpact.gainedVoteActors,
    lostVoteActors: memberImpact.lostVoteActors,
    gainedOperatorActors: memberImpact.gainedOperatorActors,
    lostOperatorActors: memberImpact.lostOperatorActors,
    changedRights: memberImpact.changedRights,
    signerImpact,
    payerChange: memberImpact.payerChange,
    visibilityChange: memberImpact.visibilityChange,
    resourceImpact,
    taskImpact,
    exitWindow,
  };
  if (
    hashCanonicalGovernanceValue(CONFIGURATION_TRANSITION_IMPACT_DOMAIN, impactBody)
      !== notificationPlan.impactDigest
  ) {
    throw new Error('governance_configuration_transition_impact_digest_mismatch');
  }
  if (
    hashCanonicalGovernanceValue(
      'alcheme.governance.configuration-transition-mandates',
      mandateSnapshot,
    ) !== continuityMandates.snapshotDigest
  ) {
    throw new Error('governance_configuration_transition_mandate_digest_mismatch');
  }
  const { continuityDigest: _continuityDigest, ...continuityBody } = institutionalContinuity;
  if (
    hashCanonicalGovernanceValue(
      'alcheme.governance.configuration-transition-continuity',
      continuityBody,
    ) !== institutionalContinuity.continuityDigest
  ) {
    throw new Error('governance_configuration_transition_continuity_digest_mismatch');
  }
  const { planDigest: _planDigest, ...planBody } = plan;
  if (
    hashCanonicalGovernanceValue(
      'alcheme.governance.configuration-transition-plan',
      planBody,
    ) !== planDigest
  ) {
    throw new Error('governance_configuration_transition_plan_digest_mismatch');
  }
  const nextPolicyVersion = proposedPolicyVersion;
  const policyVersionSuffix = `:v${proposedPolicyVersion}`;
  if (
    recoveryPolicyId
      ? proposedPolicyVersion !== 1
      : proposedPolicyVersion !== payload.currentPolicyVersion + 1
  ) throw new Error('governance_configuration_transition_target_policy_invalid');
  if (!proposedPolicyVersionId.endsWith(policyVersionSuffix)) {
    throw new Error('governance_configuration_transition_target_policy_invalid');
  }
  const proposedPolicyId = proposedPolicyVersionId.slice(0, -policyVersionSuffix.length);
  if (!proposedPolicyId) {
    throw new Error('governance_configuration_transition_target_policy_invalid');
  }

  const run = async (tx: CircleGovernanceBindingPrisma): Promise<string> => {
    const bindingDelegate = tx.circleGovernanceBinding;
    const policyDelegate = tx.governancePolicy!;
    const versionDelegate = tx.governancePolicyVersion!;
    const bundleDelegate = tx.governanceConfigurationBundle!;
    const activationDelegate = tx.governanceActivationState!;
    const authorityDelegate = tx.actionAuthorityPolicyBinding!;
    if (!tx.governanceRequest || !tx.governanceCase || !tx.notification) {
      throw new Error('governance_configuration_transition_audit_runtime_required');
    }
    const persistedRequest = await tx.governanceRequest.findUnique({
      where: { id: request.id },
      select: { id: true, state: true, caseRef: true, payload: true },
    });
    const caseRef = normalizeRequiredText(persistedRequest?.caseRef);
    const persistedCase = caseRef
      ? await tx.governanceCase.findUnique({ where: { id: caseRef } })
      : null;
    const persistedRequestPlan = asRecord(asRecord(persistedRequest?.payload).configurationTransitionPlan);
    const persistedCasePlan = asRecord(asRecord(persistedCase?.requestedActionPayload).configurationTransitionPlan);
    if (
      !persistedRequest
      || persistedRequest.state !== 'accepted'
      || !caseRef
      || !persistedCase
      || persistedCase.primaryRequestId !== request.id
      || persistedRequestPlan.planDigest !== planDigest
      || persistedCasePlan.planDigest !== planDigest
    ) {
      throw new Error('governance_configuration_transition_frozen_case_mismatch');
    }
    const notifications = await tx.notification.findMany({
      where: {
        type: 'governance_transition',
        sourceType: 'governance_case',
        sourceId: caseRef,
      },
      orderBy: [{ userId: 'asc' }, { id: 'asc' }],
    });
    if (
      notifications.length !== Number(notificationPlan.recipientCount)
      || notifications.some((notification) => {
        const metadata = asRecord(notification.metadata);
        return notification.circleId !== Number(rawPayload.targetCircleId)
          || metadata.caseId !== caseRef
          || metadata.planDigest !== planDigest
          || metadata.impactDigest !== notificationPlan.impactDigest
          || metadata.actorSnapshotDigest !== memberImpact.actorSnapshotDigest;
      })
    ) {
      throw new Error('governance_configuration_transition_notification_evidence_mismatch');
    }
    const [binding, policy, currentVersion, targetVersion, fromBundle, toBundle, recoveryPolicy] = await Promise.all([
      bindingDelegate.findUnique!({ where: { id: request.targetRef } }),
      policyDelegate.findUnique({ where: { id: proposedPolicyId } }),
      versionDelegate.findUnique({ where: { id: payload.currentPolicyVersionId } }),
      versionDelegate.findUnique({ where: { id: proposedPolicyVersionId } }),
      bundleDelegate.findUnique({ where: { id: fromBundleId } }),
      bundleDelegate.findUnique({ where: { id: toBundleId } }),
      recoveryPolicyId && tx.governanceRecoveryPolicy
        ? tx.governanceRecoveryPolicy.findUnique({ where: { id: recoveryPolicyId } })
        : Promise.resolve(null),
    ]);
    if (!binding || !policy || !currentVersion || !targetVersion || !fromBundle || !toBundle) {
      throw new Error('governance_configuration_transition_cutover_fact_missing');
    }
    await assertPolicyTransitionTargetReadiness(tx, {
      binding,
      fromBundle,
      toBundle,
      toBundleDigest,
      targetVersion,
      targetCommitteeCircleId,
      readiness,
    });
    if (rollbackOf) {
      if (!tx.governanceCase?.findUnique) {
        throw new Error('governance_configuration_transition_cutover_runtime_required');
      }
      const [rollbackSource, rollbackPolicyVersion, rollbackSourceCase] = await Promise.all([
        bundleDelegate.findUnique({ where: { id: String(rollbackSourceBundle.id) } }),
        versionDelegate.findUnique({ where: { id: String(rollbackOf.sourcePolicyVersionId ?? '') } }),
        tx.governanceCase.findUnique({
          where: { id: String(rollbackOf.caseId) },
          include: { primaryRequest: { include: { decision: true } } },
        }),
      ]);
      const rollbackSourcePayload = asRecord(rollbackSourceCase?.requestedActionPayload);
      const rollbackSourcePlan = asRecord(rollbackSourcePayload.configurationTransitionPlan);
      const rollbackSourceToBundle = asRecord(rollbackSourcePlan.toBundle);
      const rollbackGoverningRequest = rollbackSourceCase?.primaryRequest;
      const authorityStillAtRollbackSource = binding.sourceRequestId === rollbackOf.governingRequestId
        && binding.sourceDecisionDigest === rollbackOf.governingDecisionDigest;
      const exactReplayAuthority = binding.sourceRequestId === request.id
        && binding.sourceDecisionDigest === input.decisionDigest;
      if (
        !rollbackSource
        || rollbackSource.homeIdentityBindingId !== fromBundle.homeIdentityBindingId
        || rollbackSource.bundleDigest !== rollbackSourceBundle.digest
        || rollbackSource.version !== Number(rollbackSourceBundle.version)
        || !rollbackPolicyVersion
        || rollbackPolicyVersion.policyId !== binding.policyId
        || rollbackPolicyVersion.status !== 'superseded'
        || rollbackPolicyVersion.configDigest !== rollbackOf.sourcePolicyConfigDigest
        || computeGovernancePolicyRulesDigest(rollbackPolicyVersion.rules)
          !== rollbackPolicyVersion.configDigest
        || !rollbackSourceCase
        || rollbackSourceCase.homeIdentityBindingId !== fromBundle.homeIdentityBindingId
        || rollbackSourceCase.subjectType !== 'circle_governance_binding'
        || rollbackSourceCase.subjectRef !== binding.id
        || rollbackSourcePayload.proposedPolicyVersionId !== currentVersion.id
        || rollbackSourcePlan.kind !== 'governance_configuration_transition'
        || rollbackSourceToBundle.id !== fromBundle.id
        || rollbackSourceToBundle.digest !== fromBundle.bundleDigest
        || rollbackGoverningRequest?.id !== rollbackOf.governingRequestId
        || rollbackGoverningRequest?.state !== 'accepted'
        || rollbackGoverningRequest?.decision?.decision !== 'accepted'
        || rollbackGoverningRequest?.decision?.decisionDigest !== rollbackOf.governingDecisionDigest
        || (!authorityStillAtRollbackSource && !exactReplayAuthority)
      ) {
        throw new Error('governance_configuration_rollback_source_drift');
      }
    }
    if (
      (!recoveryPolicyId && policy.id !== binding.policyId)
      || (recoveryPolicyId && policy.id === binding.policyId)
      || fromBundle.homeIdentityBindingId !== toBundle.homeIdentityBindingId
    ) {
      throw new Error('governance_configuration_transition_owner_mismatch');
    }
    const activation = await activationDelegate.findUnique({
      where: { homeIdentityBindingId: fromBundle.homeIdentityBindingId },
    });
    const replayBinding = recoveryPolicyId
      && recoveryPolicy?.status === 'consumed'
      && recoveryPolicy.targetBindingId
      ? await bindingDelegate.findUnique!({ where: { id: recoveryPolicy.targetBindingId } })
      : binding;
    const exactReplay = Boolean(
      replayBinding?.policyVersionId === proposedPolicyVersionId
      && replayBinding?.policyVersion === nextPolicyVersion
      && replayBinding?.sourceRequestId === request.id
      && replayBinding?.sourceDecisionDigest === input.decisionDigest
      && replayBinding?.status === 'active'
      && policy.status === 'active'
      && policy.activeVersion === nextPolicyVersion
      && currentVersion.status === (recoveryPolicyId ? 'active' : 'superseded')
      && targetVersion.status === 'active'
      && activation?.state === 'active'
      && activation.bootstrapConfigurationBundleId === toBundleId
      && activation.bootstrapBundleDigest === toBundleDigest
    );
    await assertConfigurationInstitutionalContinuity(tx, {
      continuity: institutionalContinuity,
      phase: exactReplay ? 'after_cutover' : 'before_cutover',
    });
    if (exactReplay) {
      if (
        recoveryPolicyId
        && (
          !recoveryPolicy
          || recoveryPolicy.id !== recoveryPolicyId
          || recoveryPolicy.bindingId !== request.targetRef
          || recoveryPolicy.status !== 'consumed'
          || recoveryPolicy.recoveryCaseId !== rawPayload.caseId
          || recoveryPolicy.actorSnapshotDigest !== recoveryAuthorization?.actorSnapshotDigest
          || !recoveryPolicy.targetBindingId
          || recoveryPolicy.targetCommitteeCircleId !== targetCommitteeCircleId
        )
      ) throw new Error('governance_recovery_policy_replay_unavailable');
      await transitionConfigurationAuthorityBindings(authorityDelegate, {
        targetCircleId: payload.targetCircleId,
        domainBindingId: binding.id,
        currentPolicyId: binding.policyId,
        policyId: recoveryPolicyId ? proposedPolicyId : binding.policyId,
        currentPolicyVersionId: payload.currentPolicyVersionId,
        currentPolicyVersion: payload.currentPolicyVersion,
        targetPolicyVersionId: proposedPolicyVersionId,
        targetPolicyVersion: nextPolicyVersion,
        targetCommitteeCircleId,
        targetDomainBindingId: recoveryPolicy?.targetBindingId ?? undefined,
        targetMandateId: recoveryPolicy?.targetMandateId ?? undefined,
        targetMandateSourceVersion: recoveryPolicy?.targetMandateVersion
          && recoveryPolicy?.targetMandateTermsDigest
          ? governanceMandateAuthoritySourceVersion(
              recoveryPolicy.targetMandateVersion,
              recoveryPolicy.targetMandateTermsDigest,
            )
          : undefined,
        executedAt: input.executedAt,
        replayOnly: true,
      });
      return toBundleId;
    }
    if (recoveryPolicyId) {
      if (
        !recoveryPolicy
        || recoveryPolicy.id !== recoveryPolicyId
        || recoveryPolicy.bindingId !== binding.id
        || recoveryPolicy.status !== 'activated'
        || recoveryPolicy.recoveryCaseId !== rawPayload.caseId
        || recoveryPolicy.actorSnapshotDigest !== recoveryAuthorization?.actorSnapshotDigest
        || !recoveryPolicy.activationExpiresAt
        || input.executedAt >= new Date(recoveryPolicy.activationExpiresAt)
        || recoveryPolicy.maxCostMinor !== BigInt(0)
      ) throw new Error('governance_recovery_policy_cutover_unavailable');
    } else if (targetCommitteeCircleId !== binding.committeeCircleId) {
      throw new Error('governance_configuration_transition_committee_change_requires_recovery');
    }
    if (
      binding.targetCircleId !== payload.targetCircleId
      || binding.policyVersionId !== payload.currentPolicyVersionId
      || binding.policyVersion !== payload.currentPolicyVersion
      || binding.status !== 'active'
      || computeCircleGovernanceBindingControlDigest(binding) !== payload.bindingControlDigest
      || policy.id !== proposedPolicyId
      || (recoveryPolicyId ? policy.status !== 'draft' : policy.status !== 'active')
      || (recoveryPolicyId ? policy.activeVersion !== null : policy.activeVersion !== payload.currentPolicyVersion)
      || currentVersion.policyId !== binding.policyId
      || currentVersion.version !== payload.currentPolicyVersion
      || currentVersion.status !== 'active'
      || currentVersion.configDigest !== payload.currentPolicyConfigDigest
      || computeGovernancePolicyRulesDigest(currentVersion.rules) !== currentVersion.configDigest
      || targetVersion.id !== proposedPolicyVersionId
      || targetVersion.policyId !== proposedPolicyId
      || targetVersion.version !== nextPolicyVersion
      || targetVersion.status !== 'draft'
      || targetVersion.configDigest !== payload.proposedConfigDigest
      || computeGovernancePolicyRulesDigest(targetVersion.rules) !== targetVersion.configDigest
    ) {
      throw new Error('governance_configuration_transition_policy_drift');
    }
    assertConfigurationTransitionBundle(fromBundle, {
      id: fromBundleId,
      version: fromBundleVersion,
      digest: fromBundleDigest,
      policyVersionId: payload.currentPolicyVersionId,
      policyVersion: payload.currentPolicyVersion,
      policyDigest: payload.currentPolicyConfigDigest,
    });
    assertConfigurationTransitionBundle(toBundle, {
      id: toBundleId,
      version: toBundleVersion,
      digest: toBundleDigest,
      policyVersionId: proposedPolicyVersionId,
      policyVersion: nextPolicyVersion,
      policyDigest: payload.proposedConfigDigest,
    });
    if (
      !activation
      || activation.state !== 'active'
      || activation.bootstrapConfigurationBundleId !== fromBundleId
      || activation.bootstrapBundleDigest !== fromBundleDigest
      || activation.homeIdentityBindingId !== fromBundle.homeIdentityBindingId
    ) {
      throw new Error('governance_configuration_transition_active_bundle_drift');
    }
    const ratificationDeadline = recoveryPolicyId
      ? new Date(
          input.executedAt.getTime() + Number(recoveryPolicy.ratificationTtlSeconds) * 1000,
        )
      : null;
    const successor = recoveryPolicyId && ratificationDeadline
      ? await createRecoverySuccessorMandateBinding(tx, {
          binding,
          targetCommitteeCircleId,
          targetPolicyId: proposedPolicyId,
          targetPolicyVersionId: proposedPolicyVersionId,
          targetPolicyVersion: nextPolicyVersion,
          recoveryPolicyId,
          recoveryActors: recoveryPolicy.actorSnapshot,
          requestId: request.id,
          decisionDigest: input.decisionDigest,
          executedAt: input.executedAt,
          ratificationDeadline,
        })
      : null;
    await transitionConfigurationAuthorityBindings(authorityDelegate, {
      targetCircleId: payload.targetCircleId,
      domainBindingId: binding.id,
      currentPolicyId: binding.policyId,
      policyId: recoveryPolicyId ? proposedPolicyId : binding.policyId,
      currentPolicyVersionId: payload.currentPolicyVersionId,
      currentPolicyVersion: payload.currentPolicyVersion,
      targetPolicyVersionId: proposedPolicyVersionId,
      targetPolicyVersion: nextPolicyVersion,
      targetCommitteeCircleId,
      targetDomainBindingId: successor?.bindingId,
      targetMandateId: successor?.mandateId,
      targetMandateSourceVersion: successor?.mandateSourceVersion,
      executedAt: input.executedAt,
      replayOnly: false,
    });
    const superseded = recoveryPolicyId
      ? { count: 1 }
      : await versionDelegate.updateMany({
          where: {
            id: currentVersion.id,
            policyId: binding.policyId,
            version: payload.currentPolicyVersion,
            status: 'active',
            configDigest: payload.currentPolicyConfigDigest,
          },
          data: { status: 'superseded' },
        });
    const activated = await versionDelegate.updateMany({
      where: {
        id: targetVersion.id,
        policyId: proposedPolicyId,
        version: nextPolicyVersion,
        status: 'draft',
        configDigest: payload.proposedConfigDigest,
      },
      data: { status: 'active', activatedAt: input.executedAt },
    });
    const policyUpdated = await policyDelegate.updateMany({
      where: {
        ...(recoveryPolicyId
          ? { id: proposedPolicyId, status: 'draft', activeVersion: null }
          : {
              id: binding.policyId,
              status: 'active',
              activeVersion: payload.currentPolicyVersion,
            }),
      },
      data: {
        status: 'active',
        activeVersion: nextPolicyVersion,
      },
    });
    const bindingUpdated = await bindingDelegate.updateMany!({
      where: buildBindingControlWhere(binding),
      data: {
        sourceRequestId: request.id,
        sourceDecisionDigest: input.decisionDigest,
        ...(successor
          ? {
              status: 'deactivated',
              supersededAt: input.executedAt,
            }
          : {
              policyVersionId: proposedPolicyVersionId,
              policyVersion: nextPolicyVersion,
              committeeCircleId: targetCommitteeCircleId,
            }),
      },
    });
    const activationUpdated = await activationDelegate.updateMany({
      where: {
        id: activation.id,
        homeIdentityBindingId: fromBundle.homeIdentityBindingId,
        state: 'active',
        bootstrapConfigurationBundleId: fromBundleId,
        bootstrapBundleDigest: fromBundleDigest,
      },
      data: {
        bootstrapConfigurationBundleId: toBundleId,
        bootstrapBundleVersion: String(toBundleVersion),
        bootstrapBundleDigest: toBundleDigest,
        updatedAt: input.executedAt,
      },
    });
    if (
      superseded.count !== 1
      || activated.count !== 1
      || policyUpdated.count !== 1
      || bindingUpdated.count !== 1
      || activationUpdated.count !== 1
    ) {
      throw new Error('governance_configuration_transition_cutover_stale_write');
    }
    if (recoveryPolicyId) {
      if (!successor || !ratificationDeadline) {
        throw new Error('governance_recovery_successor_mandate_required');
      }
      const oldMandateUpdated = await tx.governanceMandate!.updateMany({
        where: {
          id: binding.mandateId,
          status: 'active',
          committeeAcceptanceStatus: 'accepted',
        },
        data: { status: 'deactivated' },
      });
      if (oldMandateUpdated.count !== 1) {
        throw new Error('governance_recovery_source_mandate_stale_write');
      }
      const consumed = await tx.governanceRecoveryPolicy!.updateMany({
        where: {
          id: recoveryPolicyId,
          status: 'activated',
          stateVersion: recoveryPolicy.stateVersion,
          recoveryCaseId: rawPayload.caseId,
        },
        data: {
          status: 'consumed',
          stateVersion: recoveryPolicy.stateVersion + 1,
          consumedAt: input.executedAt,
          activationExpiresAt: input.executedAt,
          targetBindingId: successor.bindingId,
          targetCommitteeCircleId,
          targetMandateId: successor.mandateId,
          targetMandateVersion: successor.mandateVersion,
          targetMandateTermsDigest: successor.mandateTermsDigest,
          ratificationStatus: 'pending',
          ratificationDeadline,
        },
      });
      if (consumed.count !== 1) {
        throw new Error('governance_recovery_policy_consume_stale_write');
      }
      await supersedeConsumedRecoveryAuthority(authorityDelegate, {
        recoveryPolicyId,
        consumedAt: input.executedAt,
      });
    }
    await assertConfigurationInstitutionalContinuity(tx, {
      continuity: institutionalContinuity,
      phase: 'after_cutover',
    });
    return toBundleId;
  };
  return prisma.$transaction ? prisma.$transaction(run) : run(prisma);
}

async function createRecoverySuccessorMandateBinding(
  tx: CircleGovernanceBindingPrisma,
  input: {
    binding: CircleGovernanceBindingControlFacts;
    targetCommitteeCircleId: number;
    targetPolicyId: string;
    targetPolicyVersionId: string;
    targetPolicyVersion: number;
    recoveryPolicyId: string;
    recoveryActors: unknown;
    requestId: string;
    decisionDigest: string;
    executedAt: Date;
    ratificationDeadline: Date;
  },
): Promise<{
  bindingId: string;
  mandateId: string;
  mandateVersion: number;
  mandateTermsDigest: string;
  mandateSourceVersion: string;
}> {
  if (
    !tx.governanceMandate?.findUnique
    || !tx.governanceMandate.create
    || !tx.governanceMandateVersion?.create
    || !tx.circleGovernanceBinding.create
  ) throw new Error('governance_recovery_successor_mandate_runtime_required');
  const mandateId = normalizeRequiredText(input.binding.mandateId);
  const currentMandate = mandateId
    ? await tx.governanceMandate.findUnique({
      where: { id: mandateId },
        include: { versions: { orderBy: { version: 'desc' } } },
      })
    : null;
  const currentVersion = Array.isArray(currentMandate?.versions)
    ? currentMandate.versions.find((version) => version.version === currentMandate.currentVersion)
    : null;
  const currentTerms = currentVersion?.terms;
  const purposes = Array.isArray(currentTerms?.purposeBindings)
    ? currentTerms.purposeBindings
    : [];
  const effectiveUntil = new Date(String(currentVersion?.effectiveUntil ?? 'invalid'));
  const recoveryActors = Array.isArray(input.recoveryActors) ? input.recoveryActors : [];
  const provenanceActor = recoveryActors
    .map((actor) => normalizeRequiredText(asRecord(actor).pubkey))
    .find(Boolean);
  if (
    !currentMandate
    || !currentVersion
    || currentMandate.status !== 'active'
    || currentMandate.targetAuthorizationStatus !== 'accepted'
    || currentMandate.committeeAcceptanceStatus !== 'accepted'
    || currentMandate.currentTermsDigest !== currentVersion.termsDigest
    || currentVersion.targetAcceptedTermsDigest !== currentVersion.termsDigest
    || currentVersion.committeeAcceptedTermsDigest !== currentVersion.termsDigest
    || purposes.length === 0
    || purposes.some((purpose: any) => purpose.purpose !== 'collective_decision')
    || currentTerms?.feePolicy?.mode !== 'no_fee'
    || currentTerms?.effectPolicy !== null
    || Number.isNaN(effectiveUntil.getTime())
    || input.ratificationDeadline >= effectiveUntil
    || !provenanceActor
  ) throw new Error('governance_recovery_successor_mandate_invalid');
  const currentDisclosureImpact = currentTerms.crossInstitutionDisclosureImpact ?? null;
  const recoveryDisclosureImpact = buildGovernanceCrossInstitutionDisclosureImpact({
    homeCircleType: currentDisclosureImpact ? 'Secret' : 'Open',
    committeeCircleId: input.targetCommitteeCircleId,
    eligibleActors: recoveryActors.flatMap((actor) => {
      const pubkey = normalizeRequiredText(asRecord(actor).pubkey);
      return pubkey
        ? [{ pubkey, role: normalizeRequiredText(asRecord(actor).role) }]
        : [];
    }),
    purposeBindings: purposes.map((purpose: any) => ({
      purpose: purpose.purpose,
      actionType: purpose.actionSelector?.actionType ?? null,
      actionPrefix: purpose.actionSelector?.actionPrefix ?? null,
    })),
    declaration: currentDisclosureImpact
      ? {
          dataCategories: currentDisclosureImpact.dataCategories,
          recipientRegions: currentDisclosureImpact.recipientRegions,
          retentionDays: currentDisclosureImpact.retention.maximumDays,
        }
      : null,
  });
  const mandateTerms = buildGovernanceMandateTerms({
    delegatorGovernanceHome: {
      type: currentMandate.delegatorGovernanceHomeType,
      ref: currentMandate.delegatorGovernanceHomeRef,
    },
    delegateAuthority: {
      type: 'circle_governance_committee',
      ref: String(input.targetCommitteeCircleId),
    },
    subject: { ...currentTerms.subject },
    purposeBindings: purposes.map((purpose: any) => ({
      purpose: purpose.purpose,
      actionType: purpose.actionSelector?.actionType ?? null,
      actionPrefix: purpose.actionSelector?.actionPrefix ?? null,
    })),
    actionType: currentTerms.actionSelector?.actionType ?? null,
    actionPrefix: currentTerms.actionSelector?.actionPrefix ?? null,
    effectiveFrom: input.executedAt,
    effectiveUntil,
    network: currentTerms.network,
    minimumConstraints: currentTerms.minimumConstraints,
    feePolicy: currentTerms.feePolicy,
    effectPolicy: null,
    crossInstitutionDisclosureImpact: recoveryDisclosureImpact,
  });
  const termsDigest = computeGovernanceMandateTermsDigest(mandateTerms);
  const successorSeed = hashCanonicalGovernanceValue(
    'alcheme.governance.recovery-successor-binding',
    {
      recoveryPolicyId: input.recoveryPolicyId,
      sourceBindingId: input.binding.id,
      targetCommitteeCircleId: input.targetCommitteeCircleId,
      termsDigest,
    },
  );
  const successorBindingId = `circle-gov-binding:${successorSeed.slice(0, 56)}`;
  const successorMandateId = `governance-mandate:${successorSeed.slice(0, 56)}`;
  const successorMandateVersion = 1;
  await tx.governanceMandate.create({ data: {
    id: successorMandateId,
    delegatorGovernanceHomeType: mandateTerms.delegatorGovernanceHome.type,
    delegatorGovernanceHomeRef: mandateTerms.delegatorGovernanceHome.ref,
    delegateAuthorityType: mandateTerms.delegateAuthority.type,
    delegateAuthorityRef: mandateTerms.delegateAuthority.ref,
    bindingType: 'shared_committee',
    status: 'active',
    currentVersion: successorMandateVersion,
    currentTermsDigest: termsDigest,
    targetAuthorizationStatus: 'accepted',
    committeeAcceptanceStatus: 'pending',
    acceptanceExpiresAt: input.ratificationDeadline,
    activatedAt: input.executedAt,
    createdByPubkey: provenanceActor,
  } });
  await tx.governanceMandateVersion.create({ data: {
    id: `${successorMandateId}:v1`,
    mandateId: successorMandateId,
    version: successorMandateVersion,
    terms: mandateTerms,
    termsDigest,
    purposeBindings: mandateTerms.purposeBindings,
    environment: mandateTerms.environment,
    network: mandateTerms.network,
    subjectType: mandateTerms.subject.type,
    subjectRef: mandateTerms.subject.ref,
    actionType: mandateTerms.actionSelector.actionType,
    actionPrefix: mandateTerms.actionSelector.actionPrefix,
    effectiveFrom: input.executedAt,
    effectiveUntil,
    targetAcceptedAt: input.executedAt,
    targetAcceptedByPubkey: provenanceActor,
    targetAcceptedTermsDigest: termsDigest,
    sourceRequestId: input.requestId,
    sourceDecisionDigest: input.decisionDigest,
    createdByPubkey: provenanceActor,
  } });
  await tx.circleGovernanceBinding.create({ data: {
    id: successorBindingId,
    bindingType: 'shared_committee',
    targetCircleId: input.binding.targetCircleId,
    actionType: input.binding.actionType ?? null,
    actionPrefix: input.binding.actionPrefix ?? null,
    committeeCircleId: input.targetCommitteeCircleId,
    policyId: input.targetPolicyId,
    policyVersionId: input.targetPolicyVersionId,
    policyVersion: input.targetPolicyVersion,
    ruleId: `committee:${input.binding.actionType ?? input.binding.actionPrefix}`,
    executionMode: 'off_chain',
    status: 'active',
    activatedAt: input.executedAt,
    createdByPubkey: provenanceActor,
    sourceRequestId: input.requestId,
    sourceDecisionDigest: input.decisionDigest,
    targetAuthorizationStatus: 'accepted',
    committeeMandateStatus: 'pending',
    mandateId: successorMandateId,
    authorityCanonicalState: 'mandate_canonical',
    shadowComparedAt: input.executedAt,
    mandateCanonicalAt: input.executedAt,
    metadata: {
      projectionSource: 'governance_mandate',
      recoveryPolicyId: input.recoveryPolicyId,
      supersedesBindingId: input.binding.id,
      mandateVersion: successorMandateVersion,
      mandateTermsDigest: termsDigest,
    },
  } });
  return {
    bindingId: successorBindingId,
    mandateId: successorMandateId,
    mandateVersion: successorMandateVersion,
    mandateTermsDigest: termsDigest,
    mandateSourceVersion: governanceMandateAuthoritySourceVersion(
      successorMandateVersion,
      termsDigest,
    ),
  };
}

async function transitionConfigurationAuthorityBindings(
  delegate: NonNullable<CircleGovernanceBindingPrisma['actionAuthorityPolicyBinding']>,
  input: {
    targetCircleId: number;
    domainBindingId: string;
    currentPolicyId: string;
    policyId: string;
    currentPolicyVersionId: string;
    currentPolicyVersion: number;
    targetPolicyVersionId: string;
    targetPolicyVersion: number;
    targetCommitteeCircleId: number;
    targetDomainBindingId?: string;
    targetMandateId?: string;
    targetMandateSourceVersion?: string;
    executedAt: Date;
    replayOnly: boolean;
  },
): Promise<void> {
  const candidates = await delegate.findMany({
    where: {
      governanceHomeType: 'circle',
      governanceHomeRef: String(input.targetCircleId),
      status: { in: ['active', 'superseded'] },
    },
  });
  const owned = candidates.filter((candidate) => (
    candidate.sourceType === 'governance_mandate'
    && (
      asRecord(candidate.limits).domainBindingId === input.domainBindingId
      || (
        input.targetDomainBindingId
        && asRecord(candidate.limits).domainBindingId === input.targetDomainBindingId
      )
    )
  ));
  if (owned.length === 0) {
    throw new Error('governance_configuration_transition_authority_projection_required');
  }
  const active = owned.filter((candidate) => (
    candidate.status === 'active' && candidate.supersededAt == null
  ));
  const targetActive = active.filter((candidate) => {
    const limits = asRecord(candidate.limits);
    return limits.policyId === input.policyId
      && limits.policyVersionId === input.targetPolicyVersionId
      && limits.policyVersion === input.targetPolicyVersion
      && limits.domainBindingId === (input.targetDomainBindingId ?? input.domainBindingId)
      && (!input.targetMandateId || candidate.sourceRef === input.targetMandateId)
      && (!input.targetMandateSourceVersion
        || candidate.sourceVersion === input.targetMandateSourceVersion);
  });
  const oldActive = active.filter((candidate) => {
    const limits = asRecord(candidate.limits);
    return limits.policyId === input.currentPolicyId
      && limits.policyVersionId === input.currentPolicyVersionId
      && limits.policyVersion === input.currentPolicyVersion;
  });
  if (targetActive.length > 0) {
    if (oldActive.length !== 0 || targetActive.length !== active.length) {
      throw new Error('governance_configuration_transition_authority_projection_ambiguous');
    }
    return;
  }
  if (input.replayOnly || oldActive.length === 0 || oldActive.length !== active.length) {
    throw new Error('governance_configuration_transition_authority_projection_drift');
  }
  for (const current of oldActive) {
    const limits = {
      ...asRecord(current.limits),
      domainBindingId: input.targetDomainBindingId ?? input.domainBindingId,
      policyId: input.policyId,
      policyVersionId: input.targetPolicyVersionId,
      policyVersion: input.targetPolicyVersion,
      committeeCircleId: input.targetCommitteeCircleId,
    };
    const facts = {
      governanceHomeType: current.governanceHomeType,
      governanceHomeRef: current.governanceHomeRef,
      contractVersionId: current.contractVersionId,
      sourceType: current.sourceType,
      sourceRef: input.targetMandateId ?? current.sourceRef,
      sourceVersion: input.targetMandateSourceVersion ?? current.sourceVersion ?? null,
      purpose: current.purpose,
      selector: current.selector,
      limits,
    };
    const bindingDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-authority-binding-seed',
      facts,
    );
    const successorId = `action-authority:${bindingDigest.slice(0, 56)}`;
    const existing = await delegate.findUnique({ where: { id: successorId } });
    if (existing) {
      throw new Error('governance_configuration_transition_authority_projection_conflict');
    }
    const superseded = await delegate.updateMany({
      where: {
        id: current.id,
        status: 'active',
        supersededAt: null,
        bindingDigest: current.bindingDigest,
      },
      data: { status: 'superseded', supersededAt: input.executedAt },
    });
    if (superseded.count !== 1) {
      throw new Error('governance_configuration_transition_authority_projection_stale_write');
    }
    await delegate.create({
      data: {
        id: successorId,
        ...facts,
        effectiveFrom: input.executedAt,
        effectiveUntil: current.effectiveUntil ?? null,
        status: 'active',
        bindingDigest,
        supersededAt: null,
      },
    });
  }
}

function assertConfigurationTransitionBundle(
  record: any,
  expected: {
    id: string;
    version: number;
    digest: string;
    policyVersionId: string;
    policyVersion: number;
    policyDigest: string;
  },
): void {
  const bundle = record?.bundle as GovernanceBootstrapBundle | undefined;
  if (
    !bundle
    || record.id !== expected.id
    || record.version !== expected.version
    || record.bundleDigest !== expected.digest
  ) {
    throw new Error('governance_configuration_transition_bundle_mismatch');
  }
  const canonical = createGovernanceBootstrapBundle(stripConfigurationBundleMetadata(bundle));
  if (canonical.digest !== record.bundleDigest) {
    throw new Error('governance_configuration_transition_bundle_digest_mismatch');
  }
  for (const dimension of ['voterEligibility', 'votingPower'] as const) {
    const policy = bundle.policyDimensions[dimension].policy;
    if (
      bundle.policyDimensions[dimension].applicability !== 'applicable'
      || policy?.ref !== expected.policyVersionId
      || policy.version !== String(expected.policyVersion)
      || policy.digest !== expected.policyDigest
    ) {
      throw new Error('governance_configuration_transition_bundle_policy_mismatch');
    }
  }
}

function stripConfigurationBundleMetadata(
  bundle: GovernanceBootstrapBundle,
): GovernanceBootstrapBundleInput {
  const {
    schemaVersion: _schemaVersion,
    canonicalCodecVersion: _canonicalCodecVersion,
    ...input
  } = bundle;
  return input;
}

async function executeBindingCreateOrReplace(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
    proposerPubkey?: string;
  },
  input: { decisionDigest: string; executedAt: Date },
): Promise<string> {
  const payload = resolveBindingChangePayload(request);
  const replay = typeof prisma.circleGovernanceBinding.findFirst === "function"
    ? await prisma.circleGovernanceBinding.findFirst({
        where: {
          ...(payload.replacesBindingId ? { id: { not: payload.replacesBindingId } } : {}),
          targetCircleId: payload.targetCircleId,
          sourceRequestId: request.id,
          sourceDecisionDigest: input.decisionDigest,
          status: { in: ["active", "pending_mandate"] },
        },
      })
    : null;
  if (replay) return replay.id;

  let supersede: CircleGovernanceBindingSupersedeInput | null = null;
  if (request.actionType === CIRCLE_GOVERNANCE_BINDING_REPLACE_ACTION_TYPE) {
    if (request.targetRef !== payload.replacesBindingId) {
      throw new Error("circle_governance_binding_replace_target_mismatch");
    }
    const findUnique = prisma.circleGovernanceBinding.findUnique;
    if (typeof findUnique !== "function") {
      throw new Error("circle_governance_binding_scoped_writer_required");
    }
    const current = await findUnique.call(prisma.circleGovernanceBinding, {
      where: { id: payload.replacesBindingId! },
    });
    if (!current || current.targetCircleId !== payload.targetCircleId) {
      throw new Error("circle_governance_binding_target_mismatch");
    }
    if (current.status !== "active") {
      throw new Error("circle_governance_binding_not_active");
    }
    if (computeCircleGovernanceBindingControlDigest(current) !== payload.replacesControlDigest) {
      throw new Error("circle_governance_binding_version_mismatch");
    }
    if (payload.continuityIncidentResolution) {
      const health = projectGovernanceAuthorityHealthReadback(current, input.executedAt);
      const incident = payload.continuityIncidentResolution;
      if (
        health.evidenceIntegrity !== 'verified'
        || health.faultAssessment?.faultClass !== 'compromised_key'
        || health.evidenceDigest !== incident.previousEvidenceDigest
        || health.faultAssessment.evidenceRef !== incident.faultEvidenceRef
        || health.faultAssessment.affectedActorPubkey !== incident.affectedActorPubkey
        || current.id !== incident.previousBindingId
      ) throw new Error('governance_continuity_incident_execution_evidence_drift');
      const successorActors = await listCommitteeEligibleActors(prisma as any, {
        committeeCircleId: payload.committeeCircleId,
      });
      const successorActorSnapshot = buildGovernanceContinuitySuccessorActorSnapshot(
        successorActors,
      );
      if (
        governanceContinuitySuccessorActorSnapshotDigest(successorActorSnapshot)
          !== incident.successorActorSnapshotDigest
        || incident.successorActorSnapshot.length !== successorActorSnapshot.length
        || incident.successorActorSnapshot.some((actor, index) => (
          JSON.stringify(actor) !== JSON.stringify(successorActorSnapshot[index])
        ))
        || !hasGovernanceCommitteeOperator(successorActors)
      ) throw new Error('governance_continuity_incident_successor_actor_drift');
    }
    supersede = {
      bindingId: current.id,
      targetCircleId: current.targetCircleId,
      actionType: normalizeOptionalText(current.actionType),
      actionPrefix: normalizeOptionalText(current.actionPrefix),
      policyVersionId: current.policyVersionId,
      policyVersion: current.policyVersion,
      updatedAt: current.updatedAt instanceof Date
        ? current.updatedAt
        : new Date(current.updatedAt),
      mandateId: normalizeOptionalText(current.mandateId),
      sourceRequestId: request.id,
      sourceDecisionDigest: input.decisionDigest,
    };
  } else if (payload.replacesBindingId || payload.replacesControlDigest) {
    throw new Error("circle_governance_binding_create_payload_has_replacement");
  }

  const common = {
    targetCircleId: payload.targetCircleId,
    committeeCircleId: payload.committeeCircleId,
    actionType: payload.actionType,
    actionPrefix: payload.actionPrefix,
    actorPubkey: payload.actorPubkey,
    subject: payload.subject!,
    now: input.executedAt,
    sourceRequestId: request.id,
    sourceDecisionDigest: input.decisionDigest,
    supersede,
    continuityIncidentResolution: payload.continuityIncidentResolution,
  };
  if (payload.bindingType === "local_auxiliary") {
    const created = await createLocalAuxiliaryGovernanceBinding(prisma as any, common);
    return created.id;
  }
  if (payload.bindingType === 'self_governed') {
    const definition = getGovernanceCaseActionDefinition(payload.actionType!);
    if (!definition || !requiresExactActionAuthorityMaterialization(definition)) {
      throw new Error('governed_action_exact_binding_required');
    }
    const created = await createSelfGovernedExactGovernanceBinding(prisma as any, {
      targetCircleId: payload.targetCircleId,
      actionType: payload.actionType!,
      actorPubkey: payload.actorPubkey,
      subject: payload.subject!,
      network: payload.network!,
      effectiveFrom: payload.effectiveFrom!,
      effectiveUntil: payload.effectiveUntil!,
      minimumConstraints: payload.minimumConstraints!,
      definition,
      now: input.executedAt,
      sourceRequestId: request.id,
      sourceDecisionDigest: input.decisionDigest,
      supersede,
    });
    return created.id;
  }
  const created = await createSharedCommitteeMandateBinding(prisma as any, {
    ...common,
    purposeBindings: payload.purposeBindings,
    operatorPolicyConstraints: payload.operatorPolicyConstraints ?? undefined,
    effectiveFrom: payload.effectiveFrom!,
    effectiveUntil: payload.effectiveUntil!,
    acceptanceExpiresAt: payload.acceptanceExpiresAt!,
    network: payload.network!,
    minimumConstraints: payload.minimumConstraints!,
    feePolicy: payload.feePolicy!,
    effectPolicy: payload.effectPolicy,
    crossInstitutionDisclosureImpact: payload.crossInstitutionDisclosureImpact,
  });
  return created.binding.id;
}

function resolveBindingChangePayload(request: {
  actionType: string;
  targetRef: string;
  payload?: unknown;
  proposerPubkey?: string;
}): {
  bindingType: "local_auxiliary" | "shared_committee" | 'self_governed';
  purposeBindings: Array<{
    purpose: "collective_decision" | "operational_execution";
    actionType: string | null;
    actionPrefix: string | null;
  }>;
  targetCircleId: number;
  committeeCircleId: number;
  actionType: string | null;
  actionPrefix: string | null;
  actorPubkey: string;
  subject: { type: string; ref: string } | null;
  replacesBindingId: string | null;
  replacesControlDigest: string | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  acceptanceExpiresAt: Date | null;
  network: "solana:localnet" | "solana:devnet" | null;
  minimumConstraints: GovernanceMandateMinimumConstraints | null;
  feePolicy: GovernanceMandateFeePolicy | null;
  effectPolicy: GovernanceMandateEffectPolicy | null;
  operatorPolicyConstraints: GovernanceMandateOperatorPolicyConstraints | null;
  crossInstitutionDisclosureImpact: GovernanceCrossInstitutionDisclosureImpact | null;
  continuityIncidentResolution: GovernanceContinuityIncidentResolution | null;
} {
  const payload = asRecord(request.payload);
  const bindingType = String(payload.bindingType ?? "");
  const purposeBindings = parsePurposeBindings(payload.purposeBindings);
  const targetCircleId = Number(payload.targetCircleId);
  const committeeCircleId = Number(payload.committeeCircleId);
  const actionType = parseCanonicalNullableText(payload.actionType);
  const actionPrefix = parseCanonicalNullableText(payload.actionPrefix);
  const actorPubkey = normalizeRequiredText(payload.actorPubkey);
  const subjectRecord = asRecord(payload.subject);
  const subject = typeof subjectRecord.type === "string" && typeof subjectRecord.ref === "string"
    ? { type: subjectRecord.type, ref: subjectRecord.ref }
    : null;
  const proposerPubkey = normalizeRequiredText(request.proposerPubkey);
  const replacesBindingId = normalizeOptionalText(payload.replacesBindingId);
  const replacesControlDigest = payload.replacesControlDigest == null
    ? null
    : normalizeControlDigest(payload.replacesControlDigest);
  const continuityIncidentResolution = normalizeGovernanceContinuityIncidentResolution(
    payload.continuityIncidentResolution,
  );
  if (
    !["local_auxiliary", "shared_committee", 'self_governed'].includes(bindingType)
    || !Number.isSafeInteger(targetCircleId)
    || targetCircleId <= 0
    || !Number.isSafeInteger(committeeCircleId)
    || committeeCircleId <= 0
    || actionType === undefined
    || actionPrefix === undefined
    || (actionType === null) === (actionPrefix === null)
    || !actorPubkey
    || !proposerPubkey
    || actorPubkey !== proposerPubkey
    || ((bindingType === "shared_committee" || bindingType === 'self_governed') && !subject)
    || (replacesBindingId === null) !== (replacesControlDigest === null)
    || (request.actionType === CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE
      && String(targetCircleId) !== request.targetRef)
    || (request.actionType === CIRCLE_GOVERNANCE_BINDING_CREATE_ACTION_TYPE
      && continuityIncidentResolution !== null)
    || (continuityIncidentResolution !== null
      && continuityIncidentResolution.previousBindingId !== replacesBindingId)
  ) {
    throw new Error("invalid_circle_governance_binding_change_payload");
  }
  const normalizedBindingType = bindingType as "local_auxiliary" | "shared_committee" | 'self_governed';
  if (bindingType === "local_auxiliary") {
    if (purposeBindings.length !== 0 || payload.crossInstitutionDisclosureImpact != null) {
      throw new Error("invalid_circle_governance_binding_change_payload");
    }
    return {
      bindingType: normalizedBindingType,
      purposeBindings: [],
      targetCircleId,
      committeeCircleId,
      actionType,
      actionPrefix,
      actorPubkey,
      subject: null,
      replacesBindingId,
      replacesControlDigest,
      effectiveFrom: null,
      effectiveUntil: null,
      acceptanceExpiresAt: null,
      network: null,
      minimumConstraints: null,
      feePolicy: null,
      effectPolicy: null,
      operatorPolicyConstraints: null,
      crossInstitutionDisclosureImpact: null,
      continuityIncidentResolution,
    };
  }
  const effectiveFrom = new Date(String(payload.effectiveFrom ?? "invalid"));
  const effectiveUntil = new Date(String(payload.effectiveUntil ?? "invalid"));
  const acceptanceExpiresAt = new Date(String(payload.acceptanceExpiresAt ?? "invalid"));
  const network = payload.network === "solana:localnet" || payload.network === "solana:devnet"
    ? payload.network
    : null;
  const constraints = asRecord(payload.minimumConstraints);
  const minimumConstraints = {
    riskFloor: String(constraints.riskFloor ?? "") as GovernanceMandateMinimumConstraints["riskFloor"],
    minimumApprovalThreshold: Number(constraints.minimumApprovalThreshold),
    minimumTimelockSeconds: Number(constraints.minimumTimelockSeconds),
  };
  const feePolicy = payload.feePolicy as GovernanceMandateFeePolicy | null;
  const effectPolicy = payload.effectPolicy as GovernanceMandateEffectPolicy | null;
  const crossInstitutionDisclosureImpact = payload.crossInstitutionDisclosureImpact == null
    ? null
    : payload.crossInstitutionDisclosureImpact as GovernanceCrossInstitutionDisclosureImpact;
  const hasOperationalPurpose = purposeBindings.some(
    (binding) => binding.purpose === 'operational_execution',
  );
  const operatorPolicyConstraints = hasOperationalPurpose
    ? normalizeGovernanceMandateOperatorPolicyConstraints(payload.operatorPolicyConstraints)
    : null;
  if (bindingType === 'self_governed') {
    const exactPurpose = purposeBindings.length === 1
      && purposeBindings[0]?.purpose === 'collective_decision'
      && purposeBindings[0]?.actionType === actionType
      && purposeBindings[0]?.actionPrefix === null;
    if (
      targetCircleId !== committeeCircleId
      || !actionType
      || actionPrefix !== null
      || !subject
      || !network
      || !exactPurpose
      || Number.isNaN(effectiveFrom.getTime())
      || Number.isNaN(effectiveUntil.getTime())
      || effectiveFrom >= effectiveUntil
      || payload.feePolicy != null
      || payload.effectPolicy != null
      || payload.operatorPolicyConstraints != null
      || payload.crossInstitutionDisclosureImpact != null
      || !["low", "medium", "high", "critical"].includes(minimumConstraints.riskFloor)
      || !Number.isSafeInteger(minimumConstraints.minimumApprovalThreshold)
      || minimumConstraints.minimumApprovalThreshold <= 0
      || !Number.isSafeInteger(minimumConstraints.minimumTimelockSeconds)
      || minimumConstraints.minimumTimelockSeconds < 0
    ) {
      throw new Error('invalid_self_governed_exact_binding_payload');
    }
    return {
      bindingType: normalizedBindingType,
      purposeBindings,
      targetCircleId,
      committeeCircleId,
      actionType,
      actionPrefix,
      actorPubkey,
      subject,
      replacesBindingId,
      replacesControlDigest,
      effectiveFrom,
      effectiveUntil,
      acceptanceExpiresAt: null,
      network,
      minimumConstraints,
      feePolicy: null,
      effectPolicy: null,
      operatorPolicyConstraints: null,
      crossInstitutionDisclosureImpact: null,
      continuityIncidentResolution,
    };
  }
  if (
    Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || Number.isNaN(acceptanceExpiresAt.getTime())
    || !network
    || purposeBindings.length === 0
    || !feePolicy
    || (!hasOperationalPurpose && payload.operatorPolicyConstraints != null)
    || !["low", "medium", "high", "critical"].includes(minimumConstraints.riskFloor)
    || !Number.isSafeInteger(minimumConstraints.minimumApprovalThreshold)
    || minimumConstraints.minimumApprovalThreshold <= 0
    || !Number.isSafeInteger(minimumConstraints.minimumTimelockSeconds)
    || minimumConstraints.minimumTimelockSeconds < 0
  ) {
    throw new Error("invalid_shared_governance_binding_change_payload");
  }
  return {
    bindingType: normalizedBindingType,
    purposeBindings,
    targetCircleId,
    committeeCircleId,
    actionType,
    actionPrefix,
    actorPubkey,
    subject,
    replacesBindingId,
    replacesControlDigest,
    effectiveFrom,
    effectiveUntil,
    acceptanceExpiresAt,
    network,
    minimumConstraints,
    feePolicy,
    effectPolicy,
    operatorPolicyConstraints,
    crossInstitutionDisclosureImpact,
    continuityIncidentResolution,
  };
}

function parsePurposeBindings(value: unknown): Array<{
  purpose: "collective_decision" | "operational_execution";
  actionType: string | null;
  actionPrefix: string | null;
}> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item);
    const purpose = record.purpose === "collective_decision"
      || record.purpose === "operational_execution"
      ? record.purpose
      : null;
    const actionType = parseCanonicalNullableText(record.actionType);
    const actionPrefix = parseCanonicalNullableText(record.actionPrefix);
    if (!purpose || actionType === undefined || actionPrefix === undefined
      || (actionType === null) === (actionPrefix === null)) {
      throw new Error("invalid_shared_governance_binding_change_payload");
    }
    return { purpose, actionType, actionPrefix };
  });
}

async function executeGovernanceMandateAcceptance(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    targetRef: string;
    payload?: unknown;
  },
  input: { decisionDigest: string; executedAt: Date },
): Promise<void> {
  const mandateDelegate = prisma.governanceMandate;
  const versionDelegate = prisma.governanceMandateVersion;
  const bindingFindUnique = prisma.circleGovernanceBinding.findUnique;
  const bindingUpdateMany = prisma.circleGovernanceBinding.updateMany;
  if (
    !mandateDelegate
    || !versionDelegate
    || typeof bindingFindUnique !== "function"
    || typeof bindingUpdateMany !== "function"
    || typeof prisma.$transaction !== "function"
  ) {
    throw new Error("governance_mandate_scoped_writer_required");
  }
  const payload = asRecord(request.payload);
  const mandateId = normalizeRequiredText(payload.mandateId);
  const mandateVersion = Number(payload.mandateVersion);
  const mandateTermsDigest = normalizeControlDigest(payload.mandateTermsDigest);
  const supersedesMandateVersion = payload.supersedesMandateVersion == null
    ? null
    : Number(payload.supersedesMandateVersion);
  const supersedesMandateTermsDigest = payload.supersedesMandateTermsDigest == null
    ? null
    : normalizeControlDigest(payload.supersedesMandateTermsDigest);
  const bindingId = normalizeRequiredText(payload.bindingId);
  if (
    !mandateId
    || !Number.isInteger(mandateVersion)
    || mandateVersion <= 0
    || !mandateTermsDigest
    || (supersedesMandateVersion == null) !== (supersedesMandateTermsDigest == null)
    || (supersedesMandateVersion != null && (
      !Number.isInteger(supersedesMandateVersion)
      || supersedesMandateVersion <= 0
      || supersedesMandateVersion >= mandateVersion
    ))
    || bindingId !== request.targetRef
  ) {
    throw new Error("invalid_governance_mandate_acceptance_payload");
  }
  const [binding, mandate, version] = await Promise.all([
    bindingFindUnique.call(prisma.circleGovernanceBinding, { where: { id: bindingId } }),
    mandateDelegate.findUnique({ where: { id: mandateId } }),
    versionDelegate.findUnique({ where: { id: `${mandateId}:v${mandateVersion}` } }),
  ]);
  if (supersedesMandateVersion != null && supersedesMandateTermsDigest) {
    if (
      binding
      && mandate
      && version
      && binding.mandateId === mandateId
      && binding.status === 'active'
      && mandate.status === 'active'
      && mandate.currentVersion === mandateVersion
      && mandate.currentTermsDigest === mandateTermsDigest
      && version.committeeAcceptedTermsDigest === mandateTermsDigest
      && version.sourceRequestId === request.id
      && version.sourceDecisionDigest === input.decisionDigest
      && (binding as any).sourceRequestId === request.id
      && (binding as any).sourceDecisionDigest === input.decisionDigest
    ) {
      return;
    }
    await executeGovernanceMandateSupersedeAcceptance(prisma, request, {
      binding,
      mandate,
      version,
      mandateId,
      mandateVersion,
      mandateTermsDigest,
      supersedesMandateVersion,
      supersedesMandateTermsDigest,
      decisionDigest: input.decisionDigest,
      executedAt: input.executedAt,
    });
    return;
  }
  if (!binding || binding.mandateId !== mandateId || binding.status !== "pending_mandate") {
    throw new Error("governance_mandate_binding_projection_mismatch");
  }
  const effectiveFrom = new Date(String(version?.effectiveFrom ?? "invalid"));
  const effectiveUntil = new Date(String(version?.effectiveUntil ?? "invalid"));
  const acceptanceExpiresAt = new Date(String(mandate?.acceptanceExpiresAt ?? "invalid"));
  const counterDecisionPendingTarget = Boolean(
    mandate
    && mandate.status === 'countered'
    && mandate.currentVersion === mandateVersion
    && mandate.currentTermsDigest === mandateTermsDigest
    && mandate.targetAuthorizationStatus === 'pending'
    && mandate.committeeAcceptanceStatus === 'pending'
    && binding.targetAuthorizationStatus === 'pending'
    && binding.committeeMandateStatus === 'pending'
    && version
    && version.mandateId === mandateId
    && version.version === mandateVersion
    && version.termsDigest === mandateTermsDigest
    && version.targetAcceptedTermsDigest === null
    && version.committeeAcceptedTermsDigest === null
    && !Number.isNaN(effectiveFrom.getTime())
    && !Number.isNaN(effectiveUntil.getTime())
    && !Number.isNaN(acceptanceExpiresAt.getTime())
    && input.executedAt < acceptanceExpiresAt
    && input.executedAt < effectiveUntil
  );
  if (counterDecisionPendingTarget && mandate && version) {
    assertGovernanceMandateProjectionMatch(
      binding as any,
      { ...mandate, versions: [version] } as any,
      version as any,
    );
    if (
      binding.authorityCanonicalState != null
      && binding.authorityCanonicalState !== 'legacy_canonical'
    ) {
      throw new Error('governance_mandate_authority_cutover_state_mismatch');
    }
    await prisma.$transaction(async (tx) => {
      const updatedVersion = await tx.governanceMandateVersion!.updateMany({
        where: {
          id: version.id,
          mandateId,
          version: mandateVersion,
          termsDigest: mandateTermsDigest,
          targetAcceptedTermsDigest: null,
          committeeAcceptedTermsDigest: null,
        },
        data: {
          committeeAcceptedAt: input.executedAt,
          committeeAcceptedTermsDigest: mandateTermsDigest,
          sourceRequestId: request.id,
          sourceDecisionDigest: input.decisionDigest,
        },
      });
      if (updatedVersion.count !== 1) throw new Error('governance_mandate_version_stale_write');
      const updatedMandate = await tx.governanceMandate!.updateMany({
        where: {
          id: mandateId,
          status: 'countered',
          currentVersion: mandateVersion,
          currentTermsDigest: mandateTermsDigest,
          targetAuthorizationStatus: 'pending',
          committeeAcceptanceStatus: 'pending',
        },
        data: { committeeAcceptanceStatus: 'accepted' },
      });
      if (updatedMandate.count !== 1) throw new Error('governance_mandate_stale_write');
      const updatedBinding = await tx.circleGovernanceBinding.updateMany!({
        where: {
          id: bindingId,
          mandateId,
          status: 'pending_mandate',
          targetAuthorizationStatus: 'pending',
          committeeMandateStatus: 'pending',
        },
        data: {
          committeeMandateStatus: 'accepted',
          sourceRequestId: request.id,
          sourceDecisionDigest: input.decisionDigest,
        },
      });
      if (updatedBinding.count !== 1) throw new Error('governance_mandate_binding_projection_stale_write');
    });
    return;
  }
  if (
    !mandate
    || !["offered", "countered"].includes(mandate.status)
    || mandate.currentVersion !== mandateVersion
    || mandate.currentTermsDigest !== mandateTermsDigest
    || mandate.targetAuthorizationStatus !== "accepted"
    || mandate.committeeAcceptanceStatus !== "pending"
  ) {
    throw new Error("governance_mandate_current_terms_mismatch");
  }
  if (
    !version
    || version.mandateId !== mandateId
    || version.version !== mandateVersion
    || version.termsDigest !== mandateTermsDigest
    || version.targetAcceptedTermsDigest !== mandateTermsDigest
    || version.committeeAcceptedTermsDigest !== null
    || Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || Number.isNaN(acceptanceExpiresAt.getTime())
    || input.executedAt >= acceptanceExpiresAt
    || input.executedAt >= effectiveUntil
  ) {
    throw new Error("governance_mandate_acceptance_window_or_digest_mismatch");
  }
  assertGovernanceMandateProjectionMatch(
    binding as any,
    { ...mandate, versions: [version] } as any,
    version as any,
  );
  if (
    binding.authorityCanonicalState != null
    && binding.authorityCanonicalState !== "legacy_canonical"
  ) {
    throw new Error("governance_mandate_authority_cutover_state_mismatch");
  }
  await prisma.$transaction(async (tx) => {
    const updatedVersion = await tx.governanceMandateVersion!.updateMany({
      where: {
        id: version.id,
        mandateId,
        version: mandateVersion,
        termsDigest: mandateTermsDigest,
        targetAcceptedTermsDigest: mandateTermsDigest,
        committeeAcceptedTermsDigest: null,
      },
      data: {
        committeeAcceptedAt: input.executedAt,
        committeeAcceptedTermsDigest: mandateTermsDigest,
        sourceRequestId: request.id,
        sourceDecisionDigest: input.decisionDigest,
      },
    });
    if (updatedVersion.count !== 1) throw new Error("governance_mandate_version_stale_write");
    const updatedMandate = await tx.governanceMandate!.updateMany({
      where: {
        id: mandateId,
        status: mandate.status,
        currentVersion: mandateVersion,
        currentTermsDigest: mandateTermsDigest,
        targetAuthorizationStatus: "accepted",
        committeeAcceptanceStatus: "pending",
      },
      data: {
        status: "active",
        committeeAcceptanceStatus: "accepted",
        activatedAt: input.executedAt,
      },
    });
    if (updatedMandate.count !== 1) throw new Error("governance_mandate_stale_write");
    const updatedBinding = await tx.circleGovernanceBinding.updateMany!({
      where: {
        id: bindingId,
        mandateId,
        status: "pending_mandate",
        targetAuthorizationStatus: "accepted",
        committeeMandateStatus: "pending",
        authorityCanonicalState: binding.authorityCanonicalState ?? "legacy_canonical",
      },
      data: {
        status: "active",
        activatedAt: input.executedAt,
        committeeMandateStatus: "accepted",
        sourceRequestId: request.id,
        sourceDecisionDigest: input.decisionDigest,
        authorityCanonicalState: "mandate_canonical",
        shadowComparedAt: input.executedAt,
        mandateCanonicalAt: input.executedAt,
        authorityRetiredAt: null,
      },
    });
    if (updatedBinding.count !== 1) throw new Error("governance_mandate_binding_projection_stale_write");
    await materializeExactAuthorityForAcceptedMandate(tx, {
      binding,
      mandate,
      version,
      now: input.executedAt,
      governedSupersede: null,
    });
  }, { isolationLevel: 'Serializable' });
}

async function executeGovernanceMandateSupersedeAcceptance(
  prisma: CircleGovernanceBindingPrisma,
  request: { id: string; targetRef: string },
  input: {
    binding: CircleGovernanceBindingControlFacts | null;
    mandate: GovernanceMandateControlFacts | null;
    version: GovernanceMandateVersionControlFacts | null;
    mandateId: string;
    mandateVersion: number;
    mandateTermsDigest: string;
    supersedesMandateVersion: number;
    supersedesMandateTermsDigest: string;
    decisionDigest: string;
    executedAt: Date;
  },
): Promise<void> {
  const { binding, mandate, version } = input;
  const effectiveFrom = new Date(String(version?.effectiveFrom ?? 'invalid'));
  const effectiveUntil = new Date(String(version?.effectiveUntil ?? 'invalid'));
  const acceptanceExpiresAt = new Date(String(mandate?.acceptanceExpiresAt ?? 'invalid'));
  if (
    !binding
    || binding.id !== request.targetRef
    || binding.mandateId !== input.mandateId
    || binding.status !== 'active'
    || binding.targetAuthorizationStatus !== 'accepted'
    || binding.committeeMandateStatus !== 'accepted'
    || !mandate
    || mandate.status !== 'active'
    || mandate.currentVersion !== input.supersedesMandateVersion
    || mandate.currentTermsDigest !== input.supersedesMandateTermsDigest
    || mandate.targetAuthorizationStatus !== 'accepted'
    || mandate.committeeAcceptanceStatus !== 'accepted'
    || !version
    || version.mandateId !== input.mandateId
    || version.version !== input.mandateVersion
    || version.termsDigest !== input.mandateTermsDigest
    || version.targetAcceptedTermsDigest !== input.mandateTermsDigest
    || version.committeeAcceptedTermsDigest !== null
    || version.sourceDecisionDigest != null
    || Number.isNaN(effectiveFrom.getTime())
    || Number.isNaN(effectiveUntil.getTime())
    || Number.isNaN(acceptanceExpiresAt.getTime())
    || input.executedAt < effectiveFrom
    || input.executedAt >= effectiveUntil
    || input.executedAt >= acceptanceExpiresAt
  ) {
    throw new Error('governance_mandate_supersede_acceptance_mismatch');
  }
  assertGovernanceMandateProjectionMatch(
    binding as any,
    {
      ...mandate,
      currentVersion: input.mandateVersion,
      currentTermsDigest: input.mandateTermsDigest,
      versions: [version],
    } as any,
    version as any,
  );
  if (typeof prisma.$transaction !== 'function') {
    throw new Error('governance_mandate_scoped_writer_required');
  }
  await prisma.$transaction(async (tx) => {
    const supersededVersion = await tx.governanceMandateVersion!.findUnique({
      where: { id: `${input.mandateId}:v${input.supersedesMandateVersion}` },
    });
    if (
      !supersededVersion
      || supersededVersion.termsDigest !== input.supersedesMandateTermsDigest
    ) {
      throw new Error('governance_mandate_superseded_terms_mismatch');
    }
    await terminateGovernanceMandateEffectsInTransaction(tx as any, {
      mandateId: input.mandateId,
      mandateSourceVersion: governanceMandateAuthoritySourceVersion(
        supersededVersion.version,
        supersededVersion.termsDigest,
      ),
      terms: supersededVersion.terms,
      terminationKind: 'transfer',
      actorPubkey: null,
      occurredAt: input.executedAt,
    });
    const versionUpdated = await tx.governanceMandateVersion!.updateMany({
      where: {
        id: version.id,
        mandateId: input.mandateId,
        version: input.mandateVersion,
        termsDigest: input.mandateTermsDigest,
        targetAcceptedTermsDigest: input.mandateTermsDigest,
        committeeAcceptedTermsDigest: null,
        sourceDecisionDigest: null,
      },
      data: {
        committeeAcceptedAt: input.executedAt,
        committeeAcceptedTermsDigest: input.mandateTermsDigest,
        sourceRequestId: request.id,
        sourceDecisionDigest: input.decisionDigest,
      },
    });
    if (versionUpdated.count !== 1) {
      throw new Error('governance_mandate_version_stale_write');
    }
    const mandateUpdated = await tx.governanceMandate!.updateMany({
      where: {
        id: input.mandateId,
        status: 'active',
        currentVersion: input.supersedesMandateVersion,
        currentTermsDigest: input.supersedesMandateTermsDigest,
        targetAuthorizationStatus: 'accepted',
        committeeAcceptanceStatus: 'accepted',
      },
      data: {
        currentVersion: input.mandateVersion,
        currentTermsDigest: input.mandateTermsDigest,
      },
    });
    if (mandateUpdated.count !== 1) throw new Error('governance_mandate_stale_write');
    const metadata = (binding as any).metadata;
    const bindingUpdated = await tx.circleGovernanceBinding.updateMany!({
      where: {
        id: binding.id,
        mandateId: input.mandateId,
        status: 'active',
        targetAuthorizationStatus: 'accepted',
        committeeMandateStatus: 'accepted',
        sourceRequestId: (binding as any).sourceRequestId ?? null,
        sourceDecisionDigest: (binding as any).sourceDecisionDigest ?? null,
      },
      data: {
        sourceRequestId: request.id,
        sourceDecisionDigest: input.decisionDigest,
        mandateCanonicalAt: input.executedAt,
        metadata: {
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
          projectionSource: 'governance_mandate',
          mandateVersion: input.mandateVersion,
          mandateTermsDigest: input.mandateTermsDigest,
        },
      },
    });
    if (bindingUpdated.count !== 1) {
      throw new Error('governance_mandate_binding_projection_stale_write');
    }
    const actionType = normalizeOptionalText(binding.actionType)
      ?? normalizeOptionalText(version.actionType);
    const definition = actionType ? getGovernanceCaseActionDefinition(actionType) : null;
    if (requiresExactActionAuthorityMaterialization(definition)) {
      const previousAuthorityId = await findActiveExactAuthorityBindingIdForDomain(
        tx,
        {
          homeRef: String(binding.targetCircleId),
          domainBindingId: binding.id,
        },
      );
      await materializeExactAuthorityForAcceptedMandate(tx, {
        binding,
        mandate: {
          ...mandate!,
          currentVersion: input.mandateVersion,
          currentTermsDigest: input.mandateTermsDigest,
        },
        version,
        now: input.executedAt,
        governedSupersede: previousAuthorityId
          ? { previousAuthorityBindingId: previousAuthorityId }
          : null,
      });
    }
  }, { isolationLevel: 'Serializable' });
}

async function supersedeConsumedRecoveryAuthority(
  delegate: NonNullable<CircleGovernanceBindingPrisma['actionAuthorityPolicyBinding']>,
  input: { recoveryPolicyId: string; consumedAt: Date },
): Promise<void> {
  const candidates = await delegate.findMany({
    where: {
      sourceType: 'governance_recovery_policy',
      sourceRef: input.recoveryPolicyId,
      status: 'active',
      supersededAt: null,
    },
  });
  if (candidates.length !== 1) {
    throw new Error('governance_recovery_temporary_authority_required');
  }
  const superseded = await delegate.updateMany({
    where: {
      id: candidates[0].id,
      sourceType: 'governance_recovery_policy',
      sourceRef: input.recoveryPolicyId,
      status: 'active',
      supersededAt: null,
    },
    data: {
      status: 'superseded',
      supersededAt: input.consumedAt,
      effectiveUntil: input.consumedAt,
    },
  });
  if (superseded.count !== 1) {
    throw new Error('governance_recovery_temporary_authority_stale_write');
  }
}

async function executePolicyVersionUpdate(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    targetRef: string;
    payload?: unknown;
  },
  input: {
    decisionDigest: string;
    executedAt: Date;
  },
): Promise<string> {
  if (typeof prisma.$transaction !== "function") {
    throw new Error("governance_policy_version_transaction_required");
  }
  return prisma.$transaction(async (tx) => {
    const bindingDelegate = tx.circleGovernanceBinding;
    const policyDelegate = tx.governancePolicy;
    const versionDelegate = tx.governancePolicyVersion;
    if (
      typeof bindingDelegate.findUnique !== "function"
      || typeof bindingDelegate.updateMany !== "function"
      || !policyDelegate
      || !versionDelegate
      || !tx.circleMember
    ) {
      throw new Error("governance_policy_version_scoped_writer_required");
    }
    const payload = resolvePolicyVersionUpdatePayload(request);
    const binding = await bindingDelegate.findUnique({ where: { id: request.targetRef } });
    if (!binding || binding.targetCircleId !== payload.targetCircleId) {
      throw new Error("circle_governance_binding_target_mismatch");
    }
    if (binding.status !== "active") {
      throw new Error("circle_governance_binding_not_active");
    }
    if (
      binding.policyVersionId !== payload.currentPolicyVersionId
      || binding.policyVersion !== payload.currentPolicyVersion
    ) {
      const replayVersion = payload.currentPolicyVersion + 1;
      if (
        (binding as any).sourceRequestId === request.id
        && (binding as any).sourceDecisionDigest === input.decisionDigest
        && binding.policyVersion === replayVersion
      ) {
        const [replayedPolicy, replayedVersion] = await Promise.all([
          policyDelegate.findUnique({ where: { id: binding.policyId } }),
          versionDelegate.findUnique({ where: { id: binding.policyVersionId } }),
        ]);
        if (
          replayedPolicy?.status === "active"
          && replayedPolicy.activeVersion === replayVersion
          && replayedVersion?.policyId === binding.policyId
          && replayedVersion.version === replayVersion
          && replayedVersion.status === "active"
          && replayedVersion.configDigest === payload.proposedConfigDigest
          && computeGovernancePolicyRulesDigest(replayedVersion.rules)
            === replayedVersion.configDigest
        ) {
          return binding.policyVersionId;
        }
        throw new Error("governance_policy_version_replay_mismatch");
      }
      throw new Error("circle_governance_binding_policy_version_mismatch");
    }
    if (computeCircleGovernanceBindingControlDigest(binding) !== payload.bindingControlDigest) {
      throw new Error("circle_governance_binding_version_mismatch");
    }

    const policy = await policyDelegate.findUnique({ where: { id: binding.policyId } });
    if (
      !policy
      || policy.status !== "active"
      || policy.activeVersion !== payload.currentPolicyVersion
    ) {
      throw new Error("governance_policy_active_version_mismatch");
    }
    const currentVersion = await versionDelegate.findUnique({
      where: { id: payload.currentPolicyVersionId },
    });
    if (
      !currentVersion
      || currentVersion.policyId !== binding.policyId
      || currentVersion.version !== payload.currentPolicyVersion
      || currentVersion.status !== "active"
      || currentVersion.configDigest !== payload.currentPolicyConfigDigest
      || computeGovernancePolicyRulesDigest(currentVersion.rules) !== currentVersion.configDigest
    ) {
      throw new Error("governance_policy_frozen_version_mismatch");
    }

    const committeeCircleId = Number(binding.committeeCircleId);
    if (!Number.isInteger(committeeCircleId) || committeeCircleId <= 0) {
      throw new Error("circle_governance_binding_committee_mismatch");
    }
    const eligibleActors = await listCommitteeEligibleActors(tx as any, {
      committeeCircleId,
    });
    if (eligibleActors.length === 0) {
      throw new Error("governance_policy_activation_zero_electorate");
    }
    const electorateTemplate = normalizeCircleGovernanceCommitteeElectorateTemplate(
      payload.electorateTemplate,
      eligibleActors.length,
    );
    const actionScope = normalizeBindingActionScope(binding);
    const proposedRules = buildCommitteePolicyRules(actionScope, electorateTemplate);
    const proposedConfigDigest = computeGovernancePolicyRulesDigest(proposedRules);
    if (proposedConfigDigest !== payload.proposedConfigDigest) {
      throw new Error("governance_policy_proposed_config_digest_mismatch");
    }
    if (proposedConfigDigest === currentVersion.configDigest) {
      throw new Error("governance_policy_version_no_change");
    }

    const nextVersion = payload.currentPolicyVersion + 1;
    const nextPolicyVersionId = `${binding.policyId}:v${nextVersion}`;
    const existingNext = await versionDelegate.findUnique({
      where: { id: nextPolicyVersionId },
    });
    if (existingNext) {
      throw new Error("governance_policy_next_version_conflict");
    }

    const superseded = await versionDelegate.updateMany({
      where: {
        id: currentVersion.id,
        policyId: binding.policyId,
        version: payload.currentPolicyVersion,
        status: "active",
        configDigest: payload.currentPolicyConfigDigest,
      },
      data: { status: "superseded" },
    });
    if (superseded.count !== 1) {
      throw new Error("governance_policy_version_stale_write");
    }
    await versionDelegate.create({
      data: {
        id: nextPolicyVersionId,
        policyId: binding.policyId,
        version: nextVersion,
        status: "active",
        rules: proposedRules,
        configDigest: proposedConfigDigest,
        activatedAt: input.executedAt,
        createdByPubkey: payload.proposedByPubkey,
      },
    });
    const policyUpdated = await policyDelegate.updateMany({
      where: {
        id: binding.policyId,
        status: "active",
        activeVersion: payload.currentPolicyVersion,
      },
      data: { activeVersion: nextVersion },
    });
    if (policyUpdated.count !== 1) {
      throw new Error("governance_policy_active_version_stale_write");
    }
    const bindingUpdated = await bindingDelegate.updateMany({
      where: buildBindingControlWhere(binding),
      data: {
        policyVersionId: nextPolicyVersionId,
        policyVersion: nextVersion,
        sourceRequestId: request.id,
        sourceDecisionDigest: input.decisionDigest,
      },
    });
    if (bindingUpdated.count !== 1) {
      throw new Error("circle_governance_binding_stale_write");
    }
    return nextPolicyVersionId;
  });
}

function resolvePolicyVersionUpdatePayload(request: {
  targetRef: string;
  payload?: unknown;
}): {
  targetCircleId: number;
  currentPolicyVersionId: string;
  currentPolicyVersion: number;
  currentPolicyConfigDigest: string;
  bindingControlDigest: string;
  electorateTemplate: unknown;
  proposedConfigDigest: string;
  proposedByPubkey: string | null;
} {
  const payload = asRecord(request.payload);
  const bindingId = normalizeRequiredText(payload.bindingId);
  const targetCircleId = Number(payload.targetCircleId);
  const currentPolicyVersionId = normalizeRequiredText(payload.currentPolicyVersionId);
  const currentPolicyVersion = Number(payload.currentPolicyVersion);
  const currentPolicyConfigDigest = normalizeControlDigest(payload.currentPolicyConfigDigest);
  const bindingControlDigest = normalizeControlDigest(payload.bindingControlDigest);
  const proposedConfigDigest = normalizeControlDigest(payload.proposedConfigDigest);
  const proposedByPubkey = normalizeOptionalText(payload.proposedByPubkey);
  if (
    bindingId !== request.targetRef
    || !Number.isInteger(targetCircleId)
    || targetCircleId <= 0
    || !currentPolicyVersionId
    || !Number.isInteger(currentPolicyVersion)
    || currentPolicyVersion <= 0
    || !currentPolicyConfigDigest
    || !bindingControlDigest
    || !proposedConfigDigest
    || !payload.electorateTemplate
  ) {
    throw new Error("invalid_governance_policy_version_update_payload");
  }
  return {
    targetCircleId,
    currentPolicyVersionId,
    currentPolicyVersion,
    currentPolicyConfigDigest,
    bindingControlDigest,
    electorateTemplate: payload.electorateTemplate,
    proposedConfigDigest,
    proposedByPubkey,
  };
}

function normalizeBindingActionScope(binding: CircleGovernanceBindingControlFacts): string {
  const actionType = normalizeOptionalText(binding.actionType);
  const actionPrefix = normalizeOptionalText(binding.actionPrefix);
  if ((actionType === null) === (actionPrefix === null)) {
    throw new Error("circle_governance_binding_scope_ambiguous");
  }
  return actionType ?? actionPrefix!;
}

async function executeScopedBindingDeactivation(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    targetRef: string;
    payload?: unknown;
  },
  input: {
    decisionDigest: string;
    executedAt: Date;
  },
): Promise<void> {
  const findUnique = prisma.circleGovernanceBinding.findUnique;
  const updateMany = prisma.circleGovernanceBinding.updateMany;
  if (typeof findUnique !== "function" || typeof updateMany !== "function") {
    throw new Error("circle_governance_binding_scoped_writer_required");
  }
  const resolved = await resolveScopedBindingDeactivationTarget(prisma, request);
  const updateBinding = async (client: CircleGovernanceBindingPrisma) => {
    const updated = await client.circleGovernanceBinding.updateMany!.call(
      client.circleGovernanceBinding,
      {
        where: resolved.where,
        data: {
          status: "deactivated",
          supersededAt: input.executedAt,
          committeeMandateStatus: "accepted",
          sourceRequestId: request.id,
          sourceDecisionDigest: input.decisionDigest,
        },
      },
    );
    if (updated.count !== 1) {
      throw new Error("circle_governance_binding_stale_write");
    }
  };
  if (!resolved.binding.mandateId) {
    await updateBinding(prisma);
    return;
  }
  if (
    !prisma.governanceMandate
    || !prisma.governanceMandateVersion
    || typeof prisma.$transaction !== 'function'
  ) {
    throw new Error('governance_mandate_scoped_writer_required');
  }
  await prisma.$transaction(async (tx) => {
    const mandate = await tx.governanceMandate!.findUnique({
      where: { id: resolved.binding.mandateId! },
    });
    const version = mandate
      ? await tx.governanceMandateVersion!.findUnique({
        where: { id: `${mandate.id}:v${mandate.currentVersion}` },
      })
      : null;
    if (
      !mandate
      || !version
      || mandate.status !== 'active'
      || mandate.currentTermsDigest !== version.termsDigest
    ) {
      throw new Error('governance_mandate_current_terms_mismatch');
    }
    await terminateGovernanceMandateEffectsInTransaction(tx as any, {
      mandateId: mandate.id,
      mandateSourceVersion: governanceMandateAuthoritySourceVersion(
        version.version,
        version.termsDigest,
      ),
      terms: version.terms,
      terminationKind: 'revoke',
      actorPubkey: null,
      occurredAt: input.executedAt,
    });
    const mandateUpdated = await tx.governanceMandate!.updateMany({
      where: {
        id: resolved.binding.mandateId,
        status: 'active',
        targetAuthorizationStatus: 'accepted',
        committeeAcceptanceStatus: 'accepted',
      },
      data: { status: 'deactivated' },
    });
    if (mandateUpdated.count !== 1) {
      throw new Error('governance_mandate_stale_write');
    }
    await updateBinding(tx);
    if (typeof tx.actionAuthorityPolicyBinding?.findMany === 'function') {
      await retireExactActionAuthorityBindingsForDomainBinding({
        actionAuthorityPolicyBinding: tx.actionAuthorityPolicyBinding,
      }, {
        home: {
          homeType: 'circle',
          homeRef: String(resolved.binding.targetCircleId),
        },
        domainBindingId: resolved.binding.id,
        retiredAt: input.executedAt,
      });
    }
  });
}

async function resolveScopedBindingDeactivationTarget(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    targetRef: string;
    payload?: unknown;
  },
): Promise<{
  binding: CircleGovernanceBindingControlFacts;
  where: Record<string, unknown>;
}> {
  const findUnique = prisma.circleGovernanceBinding.findUnique;
  if (typeof findUnique !== "function") {
    throw new Error("circle_governance_binding_scoped_writer_required");
  }
  const payload = asRecord(request.payload);
  const bindingId = normalizeRequiredText(payload.bindingId);
  const targetCircleId = Number(payload.targetCircleId);
  const scope = asRecord(payload.bindingScope);
  const actionType = parseCanonicalNullableText(scope.actionType);
  const actionPrefix = parseCanonicalNullableText(scope.actionPrefix);
  const policyVersionId = normalizeRequiredText(payload.policyVersionId);
  const policyVersion = Number(payload.policyVersion);
  const bindingControlDigest = normalizeControlDigest(payload.bindingControlDigest);
  if (
    bindingId !== request.targetRef
    || !Number.isInteger(targetCircleId)
    || targetCircleId <= 0
    || actionType === undefined
    || actionPrefix === undefined
    || (actionType === null) === (actionPrefix === null)
    || !policyVersionId
    || !Number.isInteger(policyVersion)
    || policyVersion <= 0
    || !bindingControlDigest
  ) {
    throw new Error("invalid_circle_governance_binding_deactivate_payload");
  }

  const binding = await findUnique.call(prisma.circleGovernanceBinding, {
    where: { id: request.targetRef },
  });
  if (!binding || binding.targetCircleId !== targetCircleId) {
    throw new Error("circle_governance_binding_target_mismatch");
  }
  if (binding.status !== "active") {
    throw new Error("circle_governance_binding_not_active");
  }
  if (
    normalizeOptionalText(binding.actionType) !== actionType
    || normalizeOptionalText(binding.actionPrefix) !== actionPrefix
  ) {
    throw new Error("circle_governance_binding_scope_mismatch");
  }
  if (
    binding.policyVersionId !== policyVersionId
    || binding.policyVersion !== policyVersion
  ) {
    throw new Error("circle_governance_binding_policy_version_mismatch");
  }
  if (computeCircleGovernanceBindingControlDigest(binding) !== bindingControlDigest) {
    throw new Error("circle_governance_binding_version_mismatch");
  }
  return { binding, where: buildBindingControlWhere(binding) };
}

function buildBindingControlWhere(
  binding: CircleGovernanceBindingControlFacts,
): Record<string, unknown> {
  return {
    id: binding.id,
    targetCircleId: binding.targetCircleId,
    committeeCircleId: binding.committeeCircleId,
    actionType: normalizeOptionalText(binding.actionType),
    actionPrefix: normalizeOptionalText(binding.actionPrefix),
    policyVersionId: binding.policyVersionId,
    policyVersion: binding.policyVersion,
    status: binding.status,
    updatedAt: binding.updatedAt,
  };
}

export async function recordCircleGovernanceBindingRejectedDecision(
  prisma: CircleGovernanceBindingPrisma,
  request: {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
  },
  decision: {
    decisionDigest: string;
  },
): Promise<void> {
  if (
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_ACCEPT_MANDATE_ACTION_TYPE &&
    request.actionType !== CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE
  ) {
    return;
  }
  if (request.targetType !== "circle_governance_binding" || !request.targetRef) {
    throw new Error("invalid_circle_governance_binding_target");
  }
  const decisionDigest = normalizeDecisionDigest(decision.decisionDigest);
  if (!decisionDigest) {
    throw new Error("governance_binding_decision_digest_required");
  }

  if (request.actionType === CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE) {
    const updateMany = prisma.circleGovernanceBinding.updateMany;
    if (typeof updateMany !== "function") {
      throw new Error("circle_governance_binding_scoped_writer_required");
    }
    const resolved = await resolveScopedBindingDeactivationTarget(prisma, request);
    const updated = await updateMany.call(prisma.circleGovernanceBinding, {
      where: resolved.where,
      data: {
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
    });
    if (updated.count !== 1) {
      throw new Error("circle_governance_binding_stale_write");
    }
    return;
  }

  const payload = asRecord(request.payload);
  const mandateId = normalizeRequiredText(payload.mandateId);
  const mandateVersion = Number(payload.mandateVersion);
  const mandateTermsDigest = normalizeControlDigest(payload.mandateTermsDigest);
  const supersedesMandateVersion = payload.supersedesMandateVersion == null
    ? null
    : Number(payload.supersedesMandateVersion);
  const supersedesMandateTermsDigest = payload.supersedesMandateTermsDigest == null
    ? null
    : normalizeControlDigest(payload.supersedesMandateTermsDigest);
  if (
    !mandateId
    || !Number.isInteger(mandateVersion)
    || mandateVersion <= 0
    || !mandateTermsDigest
    || (supersedesMandateVersion == null) !== (supersedesMandateTermsDigest == null)
    || typeof prisma.$transaction !== "function"
    || !prisma.governanceMandate
    || !prisma.governanceMandateVersion
    || typeof prisma.circleGovernanceBinding.updateMany !== "function"
  ) {
    throw new Error("governance_mandate_scoped_writer_required");
  }
  if (supersedesMandateVersion != null && supersedesMandateTermsDigest) {
    const [binding, mandate, version] = await Promise.all([
      prisma.circleGovernanceBinding.findUnique?.({ where: { id: request.targetRef } }),
      prisma.governanceMandate.findUnique({ where: { id: mandateId } }),
      prisma.governanceMandateVersion.findUnique({
        where: { id: `${mandateId}:v${mandateVersion}` },
      }),
    ]);
    if (
      !binding
      || binding.mandateId !== mandateId
      || binding.status !== 'active'
      || !mandate
      || mandate.status !== 'active'
      || mandate.currentVersion !== supersedesMandateVersion
      || mandate.currentTermsDigest !== supersedesMandateTermsDigest
      || !version
      || version.mandateId !== mandateId
      || version.version !== mandateVersion
      || version.termsDigest !== mandateTermsDigest
      || version.targetAcceptedTermsDigest !== mandateTermsDigest
      || version.committeeAcceptedTermsDigest !== null
      || version.sourceDecisionDigest != null
    ) {
      throw new Error('governance_mandate_supersede_rejection_mismatch');
    }
    const versionUpdated = await prisma.governanceMandateVersion.updateMany({
      where: {
        id: version.id,
        mandateId,
        version: mandateVersion,
        termsDigest: mandateTermsDigest,
        committeeAcceptedTermsDigest: null,
        sourceDecisionDigest: null,
      },
      data: {
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
    });
    if (versionUpdated.count !== 1) {
      throw new Error('governance_mandate_version_stale_write');
    }
    return;
  }
  await prisma.$transaction(async (tx) => {
    const versionUpdated = await tx.governanceMandateVersion!.updateMany({
      where: {
        id: `${mandateId}:v${mandateVersion}`,
        mandateId,
        version: mandateVersion,
        termsDigest: mandateTermsDigest,
        sourceRequestId: null,
        sourceDecisionDigest: null,
      },
      data: {
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
    });
    let terminalVersion = versionUpdated.count === 1
      ? null
      : await tx.governanceMandateVersion!.findUnique({
        where: { id: `${mandateId}:v${mandateVersion}` },
      });
    if (
      versionUpdated.count !== 1
      && (
        !terminalVersion
        || terminalVersion.mandateId !== mandateId
        || terminalVersion.version !== mandateVersion
        || terminalVersion.termsDigest !== mandateTermsDigest
        || terminalVersion.sourceRequestId !== request.id
        || terminalVersion.sourceDecisionDigest !== decisionDigest
      )
    ) {
      throw new Error("governance_mandate_version_stale_write");
    }
    const mandateUpdated = await tx.governanceMandate!.updateMany({
      where: {
        id: mandateId,
        status: { in: ["offered", "countered"] },
        currentVersion: mandateVersion,
        currentTermsDigest: mandateTermsDigest,
        committeeAcceptanceStatus: "pending",
      },
      data: {
        status: "rejected",
        committeeAcceptanceStatus: "rejected",
      },
    });
    if (mandateUpdated.count !== 1) {
      const [currentMandate, currentBinding] = await Promise.all([
        tx.governanceMandate!.findUnique({ where: { id: mandateId } }),
        tx.circleGovernanceBinding.findUnique?.({ where: { id: request.targetRef } }),
      ]);
      terminalVersion ??= await tx.governanceMandateVersion!.findUnique({
        where: { id: `${mandateId}:v${mandateVersion}` },
      });
      const exactVersionDecision = Boolean(
        terminalVersion
        && terminalVersion.mandateId === mandateId
        && terminalVersion.version === mandateVersion
        && terminalVersion.termsDigest === mandateTermsDigest
        && terminalVersion.sourceRequestId === request.id
        && terminalVersion.sourceDecisionDigest === decisionDigest
      );
      const alreadyRejected = Boolean(
        exactVersionDecision
        && currentMandate
        && currentMandate.currentVersion === mandateVersion
        && currentMandate.currentTermsDigest === mandateTermsDigest
        && currentMandate.status === "rejected"
        && currentMandate.committeeAcceptanceStatus === "rejected"
        && currentBinding
        && currentBinding.mandateId === mandateId
        && currentBinding.status === "rejected"
        && currentBinding.committeeMandateStatus === "rejected"
        && currentBinding.sourceRequestId === request.id
        && currentBinding.sourceDecisionDigest === decisionDigest
      );
      const supersededByLaterVersion = Boolean(
        exactVersionDecision
        && currentMandate
        && currentMandate.id === mandateId
        && currentMandate.currentVersion > mandateVersion
        && currentMandate.currentTermsDigest !== mandateTermsDigest
        && currentBinding
        && currentBinding.mandateId === mandateId
      );
      if (alreadyRejected || supersededByLaterVersion) return;
      throw new Error("governance_mandate_stale_write");
    }
    const bindingUpdated = await tx.circleGovernanceBinding.updateMany!({
      where: {
        id: request.targetRef,
        mandateId,
        status: "pending_mandate",
        committeeMandateStatus: "pending",
      },
      data: {
        status: "rejected",
        committeeMandateStatus: "rejected",
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
    });
    if (bindingUpdated.count !== 1) {
      throw new Error("governance_mandate_binding_projection_stale_write");
    }
  });
}

async function materializeExactAuthorityForAcceptedMandate(
  tx: CircleGovernanceBindingPrisma,
  input: {
    binding: CircleGovernanceBindingControlFacts;
    mandate: GovernanceMandateControlFacts;
    version: GovernanceMandateVersionControlFacts;
    now: Date;
    governedSupersede: { previousAuthorityBindingId: string } | null;
  },
): Promise<void> {
  const actionType = normalizeOptionalText(input.binding.actionType)
    ?? normalizeOptionalText(input.version.actionType);
  if (!actionType) return;
  const definition = getGovernanceCaseActionDefinition(actionType);
  if (!requiresExactActionAuthorityMaterialization(definition)) return;
  if (!tx.actionAuthorityPolicyBinding || !tx.governedActionContractVersion) {
    throw new Error('governed_action_exact_authority_runtime_required');
  }
  const authorityDelegate = tx.actionAuthorityPolicyBinding;
  const contractDelegate = tx.governedActionContractVersion;
  const committeeCircleId = Number(input.binding.committeeCircleId);
  if (!Number.isSafeInteger(committeeCircleId) || committeeCircleId <= 0) {
    throw new Error('governed_action_exact_binding_required');
  }
  const terms = asRecord(input.version.terms);
  const purposeBindings = Array.isArray(input.version.purposeBindings)
    ? input.version.purposeBindings
    : Array.isArray(terms.purposeBindings)
      ? terms.purposeBindings
      : [];
  const minimumConstraints = asRecord(terms.minimumConstraints);
  await materializeExactActionAuthorityBinding({
    actionAuthorityPolicyBinding: authorityDelegate,
    governedActionContractVersion: contractDelegate,
  }, {
    definition: definition!,
    home: {
      homeType: 'circle',
      homeRef: String(input.binding.targetCircleId),
    },
    binding: {
      id: input.binding.id,
      targetCircleId: input.binding.targetCircleId,
      committeeCircleId,
      actionType: normalizeOptionalText(input.binding.actionType),
      actionPrefix: normalizeOptionalText(input.binding.actionPrefix),
      policyId: input.binding.policyId,
      policyVersionId: input.binding.policyVersionId,
      policyVersion: input.binding.policyVersion,
      ruleId: `committee:${actionType}`,
      status: 'active',
      targetAuthorizationStatus: 'accepted',
      committeeMandateStatus: 'accepted',
    },
    mandate: {
      id: input.mandate.id,
      version: input.version.version,
      termsDigest: input.version.termsDigest,
      terms: input.version.terms,
      subjectType: String(input.version.subjectType ?? ''),
      subjectRef: String(input.version.subjectRef ?? ''),
      actionType: normalizeOptionalText(input.version.actionType),
      actionPrefix: normalizeOptionalText(input.version.actionPrefix),
      environment: String(input.version.environment ?? 'local_development'),
      network: String(input.version.network ?? ''),
      effectiveFrom: new Date(String(input.version.effectiveFrom)),
      effectiveUntil: input.version.effectiveUntil == null
        ? null
        : new Date(String(input.version.effectiveUntil)),
      purposeBindings: purposeBindings as any,
      minimumConstraints: {
        riskFloor: typeof minimumConstraints.riskFloor === 'string'
          ? minimumConstraints.riskFloor
          : undefined,
        minimumApprovalThreshold: Number(minimumConstraints.minimumApprovalThreshold ?? 1),
        minimumTimelockSeconds: Number(minimumConstraints.minimumTimelockSeconds ?? 0),
      },
    },
    governedSupersede: input.governedSupersede,
    now: input.now,
  }, { dryRun: false });
}

async function findActiveExactAuthorityBindingIdForDomain(
  tx: CircleGovernanceBindingPrisma,
  input: { homeRef: string; domainBindingId: string },
): Promise<string | null> {
  if (!tx.actionAuthorityPolicyBinding) return null;
  const candidates = await tx.actionAuthorityPolicyBinding.findMany({
    where: {
      governanceHomeType: 'circle',
      governanceHomeRef: input.homeRef,
      status: 'active',
      supersededAt: null,
    },
  });
  const owned = candidates.filter((candidate) => (
    asRecord(candidate.limits).domainBindingId === input.domainBindingId
  ));
  return owned.length === 1 ? String(owned[0].id) : null;
}

function normalizeDecisionDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[a-f0-9]{64}$/i.test(normalized) ? normalized : null;
}

function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim() || value.length === 0) {
    return null;
  }
  return value;
}

function normalizeOptionalText(value: unknown): string | null {
  if (value == null) return null;
  return normalizeRequiredText(value);
}

function parseCanonicalNullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return normalizeRequiredText(value) ?? undefined;
}

function normalizeControlDigest(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

async function assertPolicyTransitionTargetReadiness(
  prisma: CircleGovernanceBindingPrisma,
  input: {
    binding: CircleGovernanceBindingControlFacts;
    fromBundle: any;
    toBundle: any;
    toBundleDigest: string;
    targetVersion: GovernancePolicyVersionControlFacts;
    targetCommitteeCircleId: number;
    readiness: Record<string, unknown>;
  },
): Promise<void> {
  const from = input.fromBundle.bundle as GovernanceBootstrapBundle;
  const to = input.toBundle.bundle as GovernanceBootstrapBundle;
  const canonicalFrom = createGovernanceBootstrapBundle(stripGovernanceBundleMetadata(from));
  const canonicalTo = createGovernanceBootstrapBundle(stripGovernanceBundleMetadata(to));
  const expectedPolicyOnlyTarget = stripGovernanceBundleMetadata(from);
  expectedPolicyOnlyTarget.policyDimensions.voterEligibility = to.policyDimensions.voterEligibility;
  expectedPolicyOnlyTarget.policyDimensions.votingPower = to.policyDimensions.votingPower;
  const expectedPolicyOnlyDigest = createGovernanceBootstrapBundle(expectedPolicyOnlyTarget).digest;
  const voterEligibility = to.policyDimensions.voterEligibility.policy;
  const votingPower = to.policyDimensions.votingPower.policy;
  const profile = asRecord(input.readiness.profile);
  const electorate = asRecord(input.readiness.electorate);
  const payer = asRecord(input.readiness.payer);
  const visibility = asRecord(input.readiness.visibility);
  const recovery = asRecord(input.readiness.recovery);
  const bootstrap = asRecord(input.readiness.bootstrap);
  const checks = asRecord(bootstrap.checks);
  const eligibleCheck = asRecord(checks.eligibleActors);
  const thresholdCheck = asRecord(checks.threshold);
  const authorityCheck = asRecord(checks.authority);
  const fundingCheck = asRecord(checks.funding);
  const visibilityCheck = asRecord(checks.publicSafeBoundary);
  const recoveryCheck = asRecord(checks.recoveryContact);
  const mandatesCheck = asRecord(checks.mandates);
  const providersCheck = asRecord(checks.providers);
  const resourcesCheck = asRecord(checks.resources);
  const [actors, liveProfile] = await Promise.all([
    listCommitteeEligibleActors(prisma as any, {
      committeeCircleId: input.targetCommitteeCircleId,
    }),
    resolveActiveGovernanceProfileForWork(prisma as any, {
      homeIdentityBindingId: input.fromBundle.homeIdentityBindingId,
      homeType: 'circle',
      actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      executionAdapter: 'circle_governance_binding',
    }),
  ]);
  const actorDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.configuration-transition-target-electorate',
    actors,
  );
  if (
    canonicalFrom.digest !== input.fromBundle.bundleDigest
    || canonicalTo.digest !== input.toBundleDigest
    || input.toBundle.bundleDigest !== input.toBundleDigest
    || expectedPolicyOnlyDigest !== input.toBundleDigest
    || to.providerRefs.length !== 0
    || to.resourceRefs.length !== 0
    || to.mandateRefs.length !== 0
    || to.policyDimensions.voterEligibility.applicability !== 'applicable'
    || to.policyDimensions.votingPower.applicability !== 'applicable'
    || !voterEligibility
    || !votingPower
    || voterEligibility.ref !== input.targetVersion.id
    || votingPower.ref !== input.targetVersion.id
    || voterEligibility.version !== String(input.targetVersion.version)
    || votingPower.version !== String(input.targetVersion.version)
    || voterEligibility.digest !== input.targetVersion.configDigest
    || votingPower.digest !== input.targetVersion.configDigest
    || computeGovernancePolicyRulesDigest(input.targetVersion.rules) !== input.targetVersion.configDigest
    || profile.bindingId !== liveProfile.profileBindingId
    || profile.versionRef !== liveProfile.profileVersionRef
    || profile.definitionDigest !== liveProfile.profileDefinitionDigest
    || actors.length === 0
    || !hasGovernanceCommitteeOperator(actors)
    || Number(electorate.eligibleActorCount) !== actors.length
    || eligibleCheck.status !== 'ready'
    || eligibleCheck.evidenceDigest !== actorDigest
    || eligibleCheck.bundleDigest !== input.toBundleDigest
    || thresholdCheck.status !== 'ready'
    || thresholdCheck.evidenceRef !== input.targetVersion.id
    || thresholdCheck.evidenceDigest !== input.targetVersion.configDigest
    || authorityCheck.status !== 'ready'
    || authorityCheck.evidenceRef !== input.binding.id
    || fundingCheck.status !== 'ready'
    || fundingCheck.evidenceRef !== to.payerPolicy.ref
    || fundingCheck.evidenceDigest !== to.payerPolicy.digest
    || visibilityCheck.status !== 'ready'
    || visibilityCheck.evidenceRef !== to.visibilityPolicy.ref
    || visibilityCheck.evidenceDigest !== to.visibilityPolicy.digest
    || recoveryCheck.status !== 'ready'
    || recoveryCheck.evidenceRef !== to.emergencyPolicy.ref
    || recoveryCheck.evidenceDigest !== to.emergencyPolicy.digest
    || mandatesCheck.status !== 'not_applicable'
    || providersCheck.status !== 'not_applicable'
    || resourcesCheck.status !== 'not_applicable'
    || JSON.stringify(payer.ref) !== JSON.stringify(to.payerPolicy)
    || JSON.stringify(visibility.ref) !== JSON.stringify(to.visibilityPolicy)
    || JSON.stringify(recovery.ref) !== JSON.stringify(to.emergencyPolicy)
  ) {
    throw new Error('governance_configuration_transition_target_readiness_drift');
  }
}

async function assertConfigurationInstitutionalContinuity(
  prisma: CircleGovernanceBindingPrisma,
  input: {
    continuity: Record<string, unknown>;
    phase: 'before_cutover' | 'after_cutover';
  },
): Promise<void> {
  if (
    !prisma.governanceHomeIdentityBinding?.findUnique
    || !prisma.governanceProfileBinding?.findUnique
    || !prisma.governanceMandate?.findMany
  ) {
    throw new Error('governance_configuration_transition_continuity_runtime_required');
  }
  const homeSnapshot = asRecord(input.continuity.homeIdentity);
  const profileSnapshot = asRecord(input.continuity.profile);
  const mandatesOwner = asRecord(input.continuity.mandates);
  const mandateSnapshot = Array.isArray(mandatesOwner.snapshot)
    ? mandatesOwner.snapshot.map(asRecord)
    : [];
  const homeId = normalizeRequiredText(homeSnapshot.id);
  const profileBindingId = normalizeRequiredText(profileSnapshot.bindingId);
  const mandateIds = mandateSnapshot.map((mandate) => normalizeRequiredText(mandate.id));
  if (
    !homeId
    || !profileBindingId
    || mandateIds.some((id) => !id)
    || new Set(mandateIds).size !== mandateIds.length
  ) {
    throw new Error('governance_configuration_transition_continuity_snapshot_invalid');
  }
  const [home, profileBinding, mandates] = await Promise.all([
    prisma.governanceHomeIdentityBinding.findUnique({ where: { id: homeId } }),
    prisma.governanceProfileBinding.findUnique({
      where: { id: profileBindingId },
      include: { definitionVersion: true },
    }),
    prisma.governanceMandate.findMany({
      where: input.phase === 'before_cutover'
        ? {
            delegatorGovernanceHomeType: homeSnapshot.homeType,
            delegatorGovernanceHomeRef: homeSnapshot.homeRef,
            status: { in: ['active', 'offered', 'countered'] },
          }
        : { id: { in: mandateIds } },
      include: {
        binding: true,
        versions: { orderBy: { version: 'asc' } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  if (
    !home
    || home.id !== homeSnapshot.id
    || home.homeType !== homeSnapshot.homeType
    || home.homeRef !== homeSnapshot.homeRef
    || home.identityVersion !== Number(homeSnapshot.identityVersion)
    || home.bindingDigest !== homeSnapshot.bindingDigest
    || home.status !== homeSnapshot.status
    || homeSnapshot.disposition !== 'preserve_same_binding'
    || !profileBinding
    || profileBinding.id !== profileSnapshot.bindingId
    || profileBinding.homeIdentityBindingId !== home.id
    || profileBinding.state !== profileSnapshot.state
    || profileBinding.compatibilityStatus !== profileSnapshot.compatibilityStatus
    || profileBinding.compatibilityDigest !== profileSnapshot.compatibilityDigest
    || profileBinding.migrationPreviewDigest !== profileSnapshot.migrationPreviewDigest
    || profileBinding.definitionVersion?.versionRef !== profileSnapshot.versionRef
    || profileBinding.definitionVersion?.definitionDigest !== profileSnapshot.definitionDigest
    || profileSnapshot.disposition !== 'preserve_same_binding_and_version'
  ) {
    throw new Error('governance_configuration_transition_home_profile_drift');
  }
  const definition = profileBinding.definitionVersion.definition;
  const liveCompatibilityMatrix = {
    capability: {
      status: 'compatible_unchanged',
      actionCatalog: definition.actionCatalog,
      authorityCapabilities: definition.authorityCapabilities,
      adapterCapabilities: definition.adapterCapabilities,
    },
    schema: {
      status: 'compatible_unchanged',
      profileDefinitionDigest: profileBinding.definitionVersion.definitionDigest,
    },
    provider: {
      status: 'compatible_unchanged',
      capabilities: definition.providerCapabilities,
      runtimeOwner: 'P06',
    },
    uiMetadata: {
      status: 'compatible_unchanged',
      schemaId: definition.uiSchemaMetadata?.schemaId,
      labelKey: definition.uiSchemaMetadata?.labelKey,
    },
    incompatibilities: [],
  };
  if (
    hashCanonicalGovernanceValue(
      'alcheme.governance.configuration-transition-profile-compatibility',
      liveCompatibilityMatrix,
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.configuration-transition-profile-compatibility',
      profileSnapshot.compatibilityMatrix,
    )
  ) {
    throw new Error('governance_configuration_transition_profile_compatibility_drift');
  }
  if (mandates.length !== mandateSnapshot.length) {
    throw new Error('governance_configuration_transition_mandate_set_drift');
  }
  const liveById = new Map(mandates.map((mandate: any) => [String(mandate.id), mandate]));
  for (const snapshot of mandateSnapshot) {
    const mandate: any = liveById.get(String(snapshot.id));
    const disposition = snapshot.disposition;
    const expectedStatus = input.phase === 'after_cutover' && disposition === 'deactivate'
      ? 'deactivated'
      : snapshot.status;
    const expectedBindingStatus = input.phase === 'after_cutover' && disposition === 'deactivate'
      ? 'deactivated'
      : snapshot.bindingStatus;
    const versions = Array.isArray(mandate?.versions) ? mandate.versions : [];
    const currentVersion = versions.find((version: any) => version.version === mandate?.currentVersion);
    const pendingOffers = versions.filter((version: any) => (
      version.targetAcceptedTermsDigest === version.termsDigest
      && version.committeeAcceptedTermsDigest == null
    )).map((version: any) => ({
      version: Number(version.version),
      termsDigest: String(version.termsDigest),
      disposition: 'keep',
    }));
    const activeEffectDisposition = currentVersion?.terms?.effectPolicy == null
      ? 'not_applicable_collective_decision_only'
      : 'continue_frozen_lifecycle';
    if (
      !mandate
      || !['keep', 'deactivate'].includes(String(disposition))
      || mandate.status !== expectedStatus
      || mandate.currentVersion !== Number(snapshot.currentVersion)
      || mandate.currentTermsDigest !== snapshot.currentTermsDigest
      || mandate.targetAuthorizationStatus !== snapshot.targetAuthorizationStatus
      || mandate.committeeAcceptanceStatus !== snapshot.committeeAcceptanceStatus
      || (mandate.binding?.id ?? null) !== (snapshot.bindingId ?? null)
      || (mandate.binding?.status ?? null) !== (expectedBindingStatus ?? null)
      || currentVersion?.termsDigest !== snapshot.currentTermsDigest
      || snapshot.activeEffectDisposition !== activeEffectDisposition
      || snapshot.appealAccess !== 'bound_to_original_receipt'
      || hashCanonicalGovernanceValue(
        'alcheme.governance.configuration-transition-pending-mandate-offers',
        pendingOffers,
      ) !== hashCanonicalGovernanceValue(
        'alcheme.governance.configuration-transition-pending-mandate-offers',
        snapshot.pendingOffers,
      )
    ) {
      throw new Error('governance_configuration_transition_mandate_disposition_drift');
    }
  }
}

function stripGovernanceBundleMetadata(
  bundle: GovernanceBootstrapBundle,
): GovernanceBootstrapBundleInput {
  const {
    schemaVersion: _schemaVersion,
    canonicalCodecVersion: _canonicalCodecVersion,
    ...value
  } = bundle;
  return JSON.parse(JSON.stringify(value)) as GovernanceBootstrapBundleInput;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
