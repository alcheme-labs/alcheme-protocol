import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type { GovernanceCaseTemplateSelection } from './governanceCaseTemplate';
import {
  communicationMemberMuteAppealPayload,
  communicationMemberMuteRatificationPayload,
} from './communicationMemberMuteLifecycle';
import { contentVisibilityDownrankAppealPayload } from './contentVisibilityDownrankAppeal';
import { GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY } from './governedActionAppeal';
import {
  parseGovernanceFundingAmendmentPayload,
  type GovernanceFundingAmendmentPayload,
} from './governanceFundingAmendment';

export interface NativePolicyDecisionOutputArtifact {
  id: string;
  caseId: string;
  decisionRequestId: string;
  decisionDigest: string;
  ordinal: number;
  kind: 'policy_document';
  schemaRef: 'alcheme.governance.output.policy_document';
  schemaVersion: 1;
  subjectType: string;
  subjectRef: string;
  sourceType: 'draft_snapshot';
  sourceRef: string;
  sourceDraftPostId: number;
  sourceDraftVersion: number;
  sourceDigest: string;
  resolverRef: 'alcheme.native.policy-draft-snapshot';
  resolverVersion: '1';
  constraints: {
    execution: {
      mode: 'no_op';
      reason: 'policy_document_record_only';
      adapterRef: null;
      providerReadiness: 'not_applicable';
      automaticExecution: false;
    };
  };
  contentDigest: string;
  finality: 'alcheme_native_decision';
  executionCapability: 'no_op';
  artifactDigest: string;
  createdAt: Date;
}

export interface NativeQfAllocationPlanArtifact extends Omit<
  NativePolicyDecisionOutputArtifact,
  'kind' | 'schemaRef' | 'sourceRef' | 'resolverRef' | 'constraints' | 'contentDigest'
> {
  kind: 'allocation_plan';
  schemaRef: 'alcheme.governance.output.allocation_plan';
  sourceRef: string;
  resolverRef: 'alcheme.native.quadratic-funding';
  constraints: {
    allocationPlan: Record<string, unknown>;
    execution: {
      mode: 'no_op';
      reason: 'unfunded_pending_settlement';
      adapterRef: null;
      providerReadiness: 'not_ready';
      automaticExecution: false;
    };
  };
  contentDigest: string;
}

export interface NativeSelectionResultArtifact extends Omit<
  NativePolicyDecisionOutputArtifact,
  'kind' | 'schemaRef' | 'sourceRef' | 'resolverRef' | 'constraints' | 'contentDigest'
> {
  kind: 'selection_result';
  schemaRef: 'alcheme.governance.output.selection_result';
  sourceRef: string;
  resolverRef: 'alcheme.native.selection-ranking';
  constraints: {
    selectionResult: Record<string, unknown>;
    execution: {
      mode: 'no_op';
      reason: 'selection_result_record_only';
      adapterRef: null;
      providerReadiness: 'not_applicable';
      automaticExecution: false;
    };
  };
  contentDigest: string;
}

export interface GovernanceGrantAgreementAmendmentArtifact extends Omit<
  NativePolicyDecisionOutputArtifact,
  'kind' | 'schemaRef' | 'resolverRef' | 'constraints' | 'contentDigest'
> {
  kind: 'grant_agreement_amendment';
  schemaRef: 'alcheme.governance.output.grant_agreement_amendment';
  resolverRef: 'alcheme.native.grant-agreement-amendment';
  constraints: {
    grantAgreementAmendment: {
      agreementId: string;
      baselineTermsDigest: string;
      proposedTerms: Record<string, unknown>;
      proposedTermsDigest: string;
      reason: string;
      governingDecisionDigest: string;
    };
    execution: {
      mode: 'no_op';
      reason: 'governed_amendment_requires_explicit_application';
      adapterRef: null;
      providerReadiness: 'not_applicable';
      automaticExecution: false;
    };
  };
  contentDigest: string;
}

export interface GovernanceProviderExecutionTerminalAbandonmentArtifact extends Omit<
  NativePolicyDecisionOutputArtifact,
  'kind' | 'schemaRef' | 'resolverRef' | 'constraints' | 'contentDigest'
> {
  kind: 'provider_execution_terminal_abandonment';
  schemaRef: 'alcheme.governance.output.provider_execution_terminal_abandonment';
  resolverRef: 'alcheme.native.provider-execution-terminal-abandonment';
  constraints: {
    providerExecutionTerminalAbandonment: {
      kind: 'provider_execution_terminal_abandonment';
      originalCaseId: string;
      originalRequestId: string;
      originalDecisionDigest: string;
      providerCheckpointDigest: string;
      completedActionReceiptDigests: string[];
      remainingActionIds: string[];
      irreversibleChanges: string[];
      compensationRequirement: 'governed_compensation_plan_required';
      directOperatorMutationAllowed: false;
      reason: string;
      governingDecisionDigest: string;
    };
    execution: {
      mode: 'no_op';
      reason: 'compensation_requires_separate_governed_execution';
      adapterRef: null;
      providerReadiness: 'not_applicable';
      automaticExecution: false;
    };
  };
  contentDigest: string;
}

export interface GovernanceProviderExecutionFundingAmendmentArtifact extends Omit<
  NativePolicyDecisionOutputArtifact,
  'kind' | 'schemaRef' | 'resolverRef' | 'constraints' | 'contentDigest'
> {
  kind: 'provider_execution_funding_amendment';
  schemaRef: 'alcheme.governance.output.provider_execution_funding_amendment';
  resolverRef: 'alcheme.native.provider-execution-funding-amendment';
  constraints: {
    providerExecutionFundingAmendment: GovernanceFundingAmendmentPayload & {
      governingDecisionDigest: string;
    };
    execution: {
      mode: 'adapter';
      reason: 'accepted_amendment_versions_policy_and_preflight';
      adapterRef: 'governance_funding_amendment';
      providerReadiness: 'pending_manual_retry';
      automaticExecution: false;
    };
  };
  contentDigest: string;
}

export interface CommunicationMuteRatificationArtifact extends Omit<
  NativePolicyDecisionOutputArtifact,
  | 'kind'
  | 'schemaRef'
  | 'sourceType'
  | 'sourceRef'
  | 'sourceDraftPostId'
  | 'sourceDraftVersion'
  | 'resolverRef'
  | 'constraints'
  | 'contentDigest'
  | 'executionCapability'
> {
  kind: 'operation_ratification';
  schemaRef: 'alcheme.governance.output.operation_ratification';
  sourceType: 'governance_execution_receipt';
  sourceRef: string;
  sourceDraftPostId: null;
  sourceDraftVersion: null;
  resolverRef: 'alcheme.native.communication-mute-ratification';
  constraints: {
    operationRatification: Record<string, unknown>;
    execution: {
      mode: 'adapter';
      reason: 'existing_operation_effect_ratified';
      adapterRef: 'operation_effect';
      providerReadiness: 'not_applicable';
      automaticExecution: true;
    };
  };
  contentDigest: string;
  executionCapability: 'current_adapter';
}

export type GovernanceAppealResolutionOutcome = 'uphold' | 'modify' | 'revoke';

export interface GovernanceAppealResolutionOutputArtifact {
  id: string;
  caseId: string;
  decisionRequestId: string;
  decisionDigest: string;
  ordinal: number;
  kind: 'appeal_resolution';
  schemaRef: 'alcheme.governance.output.appeal_resolution';
  schemaVersion: 1;
  subjectType: string;
  subjectRef: string;
  sourceType: 'governance_execution_receipt';
  sourceRef: string;
  sourceDraftPostId: null;
  sourceDraftVersion: null;
  sourceDigest: string;
  resolverRef: 'alcheme.native.appeal-resolution';
  resolverVersion: '1';
  constraints: {
    appealResolution: {
      domain?: 'external_app';
      outcome: GovernanceAppealResolutionOutcome;
      originalInvocationId: string;
      originalRequestId: string;
      originalExecutionReceiptId: string;
      originalDecisionDigest: string;
      appellantPubkey: string;
      evidenceDigest: string;
      previousDiscoveryStatus: string;
      discoveryStatus: string;
      resultingDiscoveryStatus: string;
      effectStatus: 'applied' | 'preserved';
      executionReceiptId: string | null;
      governingDecisionDigest: string;
    } | {
      domain: 'communication_member_mute';
      outcome: 'uphold' | 'revoke';
      appealId: string;
      originalInvocationId: string;
      originalExecutionReceiptId: string;
      originalReceiptDigest: string;
      originalEffectDigest: string;
      appellantPubkey: string;
      originalOperatorPubkey: string;
      evidenceDigest: string;
      resultingEffectState: 'active' | 'expired' | 'revoked' | 'superseded'
        | 'ratification_required' | 'rollback_failed';
      effectStatus: 'applied' | 'preserved';
      governingDecisionDigest: string;
      noAggravationBoundary: typeof GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY;
    } | {
      domain: 'content_visibility_downrank';
      outcome: 'uphold' | 'revoke';
      appealId: string;
      originalInvocationId: string;
      originalExecutionReceiptId: string;
      originalReceiptDigest: string;
      originalEffectDigest: string;
      appellantPubkey: string;
      originalOperatorPubkey: string;
      evidenceDigest: string;
      resultingEffectState: 'active' | 'expired' | 'revoked' | 'superseded';
      effectStatus: 'applied' | 'preserved';
      governingDecisionDigest: string;
      noAggravationBoundary: typeof GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY;
    };
    execution: {
      mode: 'adapter' | 'no_op';
      reason: 'external_app_appeal_effect_applied'
        | 'communication_mute_appeal_effect_applied'
        | 'content_visibility_downrank_appeal_effect_applied'
        | 'appeal_accepted_original_effect_already_terminal'
        | 'appeal_upheld_original_effect_preserved';
      adapterRef: 'external_app' | 'operation_effect' | null;
      providerReadiness: 'not_applicable';
      automaticExecution: boolean;
    };
  };
  contentDigest: string;
  finality: 'alcheme_native_decision';
  executionCapability: 'current_adapter' | 'no_op';
  artifactDigest: string;
  createdAt: Date;
}

export interface GovernanceExecutionResourceMappingArtifact {
  id: string;
  caseId: string;
  decisionRequestId: string;
  decisionDigest: string;
  ordinal: 0;
  kind: 'execution_resource_mapping';
  schemaRef: 'alcheme.governance.output.execution_resource_mapping';
  schemaVersion: 1;
  subjectType: string;
  subjectRef: string;
  sourceType: 'governance_request';
  sourceRef: string;
  sourceDraftPostId: null;
  sourceDraftVersion: null;
  sourceDigest: string;
  resolverRef: 'alcheme.native.execution-resource-mapping';
  resolverVersion: '1';
  constraints: {
    resourceMapping: {
      actionType: string;
      caseSubject: { type: string; ref: string };
      actionTarget: { type: string; ref: string };
      executableResource: { bindingId: string };
      source: 'exact_accepted_request_payload';
      titleInferenceAllowed: false;
      governingDecisionDigest: string;
    };
    enforcementBinding: {
      resourceBindingId: string;
      authorityScope: {
        source: 'exact_request_authority_bindings_or_action_scope';
        bindingIds: string[];
        scopeDigest: string;
      };
      providerModule: 'realms_provider_binding' | 'squads_provider_binding';
      mode: 'provider_onchain' | 'multisig_threshold';
      decisionLinkage: { requestId: string; decisionDigest: string };
      allowedAdapter: 'realms_provider_binding' | 'squads_provider_binding';
      allowedOperations: string[];
      residualBypassRisk:
        | 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
        | 'threshold_signers_can_create_or_execute_transactions_outside_alcheme';
      bypassPrevented: false;
      verificationState: 'frozen_pending_live_preflight';
      contractVersion: number;
      profileVersion: number;
    };
    execution: {
      mode: 'adapter';
      reason: 'exact_governed_resource_mapping_required';
      adapterRef: 'realms_provider_binding' | 'squads_provider_binding';
      providerReadiness: 'canonical_resource_binding_required';
      automaticExecution: false;
    };
  };
  contentDigest: string;
  finality: 'alcheme_native_decision';
  executionCapability: 'provider_adapter';
  artifactDigest: string;
  createdAt: Date;
}

export interface GovernanceInternalExecutionPlanArtifact {
  id: string;
  caseId: string;
  decisionRequestId: string;
  decisionDigest: string;
  ordinal: 0;
  kind: 'internal_execution_plan';
  schemaRef: 'alcheme.governance.output.internal_execution_plan';
  schemaVersion: 1;
  subjectType: string;
  subjectRef: string;
  sourceType: 'governance_request';
  sourceRef: string;
  sourceDraftPostId: null;
  sourceDraftVersion: null;
  sourceDigest: string;
  resolverRef: 'alcheme.native.internal-execution';
  resolverVersion: '1';
  constraints: {
    executionPlan: Record<string, unknown>;
    execution: {
      mode: 'adapter';
      reason: 'canonical_internal_action_executed';
      adapterRef: string;
      providerReadiness: 'not_applicable';
      automaticExecution: true;
    };
  };
  contentDigest: string;
  finality: 'alcheme_native_decision';
  executionCapability: 'current_adapter';
  artifactDigest: string;
  createdAt: Date;
}

export interface GovernanceManualExecutionPlanArtifact extends Omit<
  GovernanceInternalExecutionPlanArtifact,
  'kind' | 'schemaRef' | 'resolverRef' | 'constraints' | 'executionCapability'
> {
  kind: 'manual_execution_plan';
  schemaRef: 'alcheme.governance.output.manual_execution_plan';
  resolverRef: 'alcheme.native.manual-execution';
  constraints: {
    executionPlan: Record<string, unknown>;
    execution: {
      mode: 'manual';
      reason: 'controlled_manual_execution_required';
      adapterRef: 'manual_case_execution';
      providerReadiness: 'not_applicable';
      automaticExecution: false;
      assignmentGrantsSignerAuthority: false;
    };
  };
  executionCapability: 'manual';
}

export type NativeDecisionOutputArtifact =
  | NativePolicyDecisionOutputArtifact
  | NativeQfAllocationPlanArtifact
  | NativeSelectionResultArtifact
  | GovernanceGrantAgreementAmendmentArtifact
  | GovernanceProviderExecutionTerminalAbandonmentArtifact
  | GovernanceProviderExecutionFundingAmendmentArtifact
  | CommunicationMuteRatificationArtifact
  | GovernanceAppealResolutionOutputArtifact
  | GovernanceExecutionResourceMappingArtifact
  | GovernanceInternalExecutionPlanArtifact
  | GovernanceManualExecutionPlanArtifact;

export function buildGovernanceManualExecutionPlanArtifact(input: {
  caseId: string;
  subjectType: string;
  subjectRef: string;
  decisionRequestId: string;
  decisionDigest: string;
  actionType: string;
  targetType: string;
  targetRef: string;
  actionPayload: unknown;
  assignee: { pubkey: string; responsibilityVersion: number; deadlineAt: Date };
  reviewer: { pubkey: string; responsibilityVersion: number };
  createdAt: Date;
}): GovernanceManualExecutionPlanArtifact {
  const decisionRequestId = requiredText(input.decisionRequestId, 'manual_execution_artifact_request_required');
  const decisionDigest = requiredDigest(input.decisionDigest, 'manual_execution_artifact_decision_digest_invalid');
  if (
    input.assignee.pubkey === input.reviewer.pubkey
    || !Number.isSafeInteger(input.assignee.responsibilityVersion)
    || input.assignee.responsibilityVersion < 1
    || !Number.isSafeInteger(input.reviewer.responsibilityVersion)
    || input.reviewer.responsibilityVersion < 1
    || !(input.assignee.deadlineAt instanceof Date)
    || input.assignee.deadlineAt.getTime() <= input.createdAt.getTime()
  ) throw new Error('manual_execution_artifact_responsibility_invalid');
  const action = {
    ordinal: 0,
    actionType: requiredText(input.actionType, 'manual_execution_artifact_action_required'),
    subject: {
      type: requiredText(input.subjectType, 'manual_execution_artifact_subject_required'),
      ref: requiredText(input.subjectRef, 'manual_execution_artifact_subject_required'),
    },
    target: {
      type: requiredText(input.targetType, 'manual_execution_artifact_target_required'),
      ref: requiredText(input.targetRef, 'manual_execution_artifact_target_required'),
    },
    payload: input.actionPayload,
    network: 'manual:external_or_off_chain' as const,
    program: null,
    accountMetas: [] as unknown[],
    instruction: {
      kind: 'manual_completion' as const,
      semantic: 'exact_accepted_request_action' as const,
    },
    assetChanges: { status: 'not_inferred_requires_completion_evidence' as const },
    dependencies: [] as string[],
    atomicity: 'manual_single_action_not_assumed_atomic' as const,
    executor: 'manual' as const,
    adapterRef: 'manual_case_execution' as const,
    assignee: {
      pubkey: requiredText(input.assignee.pubkey, 'manual_execution_artifact_assignee_required'),
      responsibilityVersion: input.assignee.responsibilityVersion,
      deadlineAt: input.assignee.deadlineAt.toISOString(),
    },
    reviewer: {
      pubkey: requiredText(input.reviewer.pubkey, 'manual_execution_artifact_reviewer_required'),
      responsibilityVersion: input.reviewer.responsibilityVersion,
    },
    assignmentGrantsSignerAuthority: false as const,
  };
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.manual-execution-action-intent-v1', action,
  );
  const executionPlan = {
    version: 1,
    requestId: decisionRequestId,
    governingDecisionDigest: decisionDigest,
    aggregateStatus: 'awaiting_manual_submission',
    actions: [{ ...action, actionIntentDigest, attempt: { state: 'pending_completion_evidence' } }],
  };
  const constraints = {
    executionPlan,
    execution: {
      mode: 'manual' as const,
      reason: 'controlled_manual_execution_required' as const,
      adapterRef: 'manual_case_execution' as const,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: false as const,
      assignmentGrantsSignerAuthority: false as const,
    },
  };
  const facts = {
    caseId: requiredText(input.caseId, 'manual_execution_artifact_case_required'),
    decisionRequestId,
    decisionDigest,
    ordinal: 0 as const,
    kind: 'manual_execution_plan' as const,
    schemaRef: 'alcheme.governance.output.manual_execution_plan' as const,
    schemaVersion: 1 as const,
    subjectType: requiredText(input.subjectType, 'manual_execution_artifact_subject_required'),
    subjectRef: requiredText(input.subjectRef, 'manual_execution_artifact_subject_required'),
    sourceType: 'governance_request' as const,
    sourceRef: `request:${decisionRequestId}`,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest: actionIntentDigest,
    resolverRef: 'alcheme.native.manual-execution' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.manual-execution-plan-content-v1', executionPlan,
    ),
    finality: 'alcheme_native_decision' as const,
    executionCapability: 'manual' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue('alcheme.governance.decision-output-artifact', facts),
    createdAt: input.createdAt,
  };
}

export function buildGovernanceInternalExecutionPlanArtifact(input: {
  caseId: string;
  subjectType: string;
  subjectRef: string;
  decisionRequestId: string;
  decisionDigest: string;
  actionType: string;
  targetType: string;
  targetRef: string;
  actionPayload: unknown;
  executorModule: string;
  receipt: { id: string; executionStatus: string; executionRef?: string | null; idempotencyKey: string };
  createdAt: Date;
}): GovernanceInternalExecutionPlanArtifact {
  const caseId = requiredText(input.caseId, 'internal_execution_artifact_case_required');
  const decisionRequestId = requiredText(input.decisionRequestId, 'internal_execution_artifact_request_required');
  const decisionDigest = requiredDigest(input.decisionDigest, 'internal_execution_artifact_decision_digest_invalid');
  const executorModule = requiredText(input.executorModule, 'internal_execution_artifact_adapter_required');
  if (input.receipt.executionStatus !== 'executed') {
    throw new Error('internal_execution_artifact_terminal_receipt_required');
  }
  const action = {
    ordinal: 0,
    actionType: requiredText(input.actionType, 'internal_execution_artifact_action_required'),
    subject: {
      type: requiredText(input.subjectType, 'internal_execution_artifact_subject_required'),
      ref: requiredText(input.subjectRef, 'internal_execution_artifact_subject_required'),
    },
    target: {
      type: requiredText(input.targetType, 'internal_execution_artifact_target_required'),
      ref: requiredText(input.targetRef, 'internal_execution_artifact_target_required'),
    },
    payload: input.actionPayload,
    network: 'alcheme:off_chain' as const,
    program: null,
    accountMetas: [] as unknown[],
    instruction: {
      kind: 'registered_internal_action' as const,
      semantic: input.actionType,
    },
    assetChanges: [] as unknown[],
    dependencies: [] as string[],
    atomicity: 'single_database_transaction' as const,
    constraints: { registeredAdapter: executorModule },
    executorModule,
    idempotencyKey: requiredText(input.receipt.idempotencyKey, 'internal_execution_artifact_idempotency_required'),
  };
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.internal-execution-action-intent-v1', action,
  );
  const executionPlan = {
    version: 1,
    requestId: decisionRequestId,
    governingDecisionDigest: decisionDigest,
    aggregateStatus: 'executed',
    actions: [{
      ...action,
      actionIntentDigest,
      receipt: {
        id: requiredText(input.receipt.id, 'internal_execution_artifact_receipt_required'),
        executionRef: input.receipt.executionRef ?? null,
        status: 'executed',
      },
    }],
  };
  const constraints = {
    executionPlan,
    execution: {
      mode: 'adapter' as const,
      reason: 'canonical_internal_action_executed' as const,
      adapterRef: executorModule,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: true as const,
    },
  };
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0 as const,
    kind: 'internal_execution_plan' as const,
    schemaRef: 'alcheme.governance.output.internal_execution_plan' as const,
    schemaVersion: 1 as const,
    subjectType: requiredText(input.subjectType, 'internal_execution_artifact_subject_required'),
    subjectRef: requiredText(input.subjectRef, 'internal_execution_artifact_subject_required'),
    sourceType: 'governance_request' as const,
    sourceRef: `request:${decisionRequestId}`,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest: actionIntentDigest,
    resolverRef: 'alcheme.native.internal-execution' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.internal-execution-plan-content-v1', executionPlan,
    ),
    finality: 'alcheme_native_decision' as const,
    executionCapability: 'current_adapter' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue('alcheme.governance.decision-output-artifact', facts),
    createdAt: input.createdAt,
  };
}

export function buildGovernanceExecutionResourceMappingArtifact(input: {
  caseId: string;
  subjectType: string;
  subjectRef: string;
  decisionRequestId: string;
  decision: string;
  decisionDigest: string;
  actionType: string;
  targetType: string;
  targetRef: string;
  actionPayload: unknown;
  createdAt: Date;
}): GovernanceExecutionResourceMappingArtifact | null {
  if (input.decision !== 'accepted') return null;
  const adapterRef: 'realms_provider_binding' | 'squads_provider_binding' | null =
    input.actionType.startsWith('circle.provider_binding.realms.')
    ? 'realms_provider_binding'
    : input.actionType.startsWith('circle.provider_binding.squads.')
        || input.actionType === 'circle.grant.payout.execute'
      ? 'squads_provider_binding'
      : null;
  if (!adapterRef) return null;
  const payload = record(input.actionPayload);
  const resourceBinding = record(payload.resourceBinding);
  const bindingId = requiredText(
    resourceBinding.id,
    'decision_output_artifact_execution_resource_binding_required',
  );
  const caseId = requiredText(input.caseId, 'decision_output_artifact_case_required');
  const decisionRequestId = requiredText(
    input.decisionRequestId,
    'decision_output_artifact_request_required',
  );
  const decisionDigest = requiredDigest(
    input.decisionDigest,
    'decision_output_artifact_decision_digest_invalid',
  );
  const subjectType = requiredText(
    input.subjectType,
    'decision_output_artifact_subject_required',
  );
  const subjectRef = requiredText(
    input.subjectRef,
    'decision_output_artifact_subject_required',
  );
  const targetType = requiredText(
    input.targetType,
    'decision_output_artifact_action_target_required',
  );
  const targetRef = requiredText(
    input.targetRef,
    'decision_output_artifact_action_target_required',
  );
  if (targetType !== subjectType || targetRef !== subjectRef) {
    throw new Error('decision_output_artifact_case_subject_action_target_mismatch');
  }
  const actionFacts = {
    actionType: input.actionType,
    targetType,
    targetRef,
    payload: input.actionPayload,
  };
  const sourceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-resource-mapping-source-v1',
    actionFacts,
  );
  const resourceMapping = {
    actionType: input.actionType,
    caseSubject: { type: subjectType, ref: subjectRef },
    actionTarget: { type: targetType, ref: targetRef },
    executableResource: { bindingId },
    source: 'exact_accepted_request_payload' as const,
    titleInferenceAllowed: false as const,
    governingDecisionDigest: decisionDigest,
  };
  const authorityTransition = record(payload.authorityTransition);
  const authorityBindings = Array.isArray(payload.authorityBindings)
    ? payload.authorityBindings.map(record)
    : [];
  const bindingIds = [
    optionalText(authorityTransition.bindingId),
    ...authorityBindings.map((binding) => (
      optionalText(binding.bindingId) ?? optionalText(binding.id)
    )),
  ].filter((value): value is string => Boolean(value)).sort();
  const allowedOperations = [...new Set([
    ...stringArray(authorityTransition.targetAllowedOperations),
    ...stringArray(authorityTransition.currentAllowedOperations),
    ...authorityBindings.flatMap((binding) => stringArray(binding.allowedOperations)),
    input.actionType,
  ])].sort();
  const contractVersion = positiveInteger(payload.contractVersion) ?? 1;
  const profileVersion = positiveInteger(payload.profileVersion) ?? 1;
  const authorityScope = {
    source: 'exact_request_authority_bindings_or_action_scope' as const,
    bindingIds,
    scopeDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.execution-enforcement-authority-scope-v1',
      {
        resourceBindingId: bindingId,
        bindingIds,
        allowedOperations,
        authorityTransition,
        authorityBindings,
      },
    ),
  };
  const enforcementBinding = {
    resourceBindingId: bindingId,
    authorityScope,
    providerModule: adapterRef,
    mode: adapterRef === 'squads_provider_binding'
      ? 'multisig_threshold' as const
      : 'provider_onchain' as const,
    decisionLinkage: { requestId: decisionRequestId, decisionDigest },
    allowedAdapter: adapterRef,
    allowedOperations,
    residualBypassRisk: adapterRef === 'squads_provider_binding'
      ? 'threshold_signers_can_create_or_execute_transactions_outside_alcheme' as const
      : 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path' as const,
    bypassPrevented: false as const,
    verificationState: 'frozen_pending_live_preflight' as const,
    contractVersion,
    profileVersion,
  };
  const constraints = {
    resourceMapping,
    enforcementBinding,
    execution: {
      mode: 'adapter' as const,
      reason: 'exact_governed_resource_mapping_required' as const,
      adapterRef,
      providerReadiness: 'canonical_resource_binding_required' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0 as const,
    kind: 'execution_resource_mapping' as const,
    schemaRef: 'alcheme.governance.output.execution_resource_mapping' as const,
    schemaVersion: 1 as const,
    subjectType,
    subjectRef,
    sourceType: 'governance_request' as const,
    sourceRef: `request:${decisionRequestId}`,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest,
    resolverRef: 'alcheme.native.execution-resource-mapping' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.execution-resource-mapping-content-v1',
      resourceMapping,
    ),
    finality: 'alcheme_native_decision' as const,
    executionCapability: 'provider_adapter' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
    createdAt: input.createdAt,
  };
}

type NativeDecisionOutputArtifactInput = Parameters<typeof buildNativePolicyDecisionOutputArtifact>[0] & {
  mechanismKind?: string | null;
  decisionTally?: unknown;
  selectionRanking?: GovernanceCaseTemplateSelection['selectionRanking'];
  requestedActionPayload?: unknown;
  communicationAppealEffectResult?: {
    artifactId: string;
    resultingEffectState: string;
    effectApplied: boolean;
  };
  contentDownrankAppealEffectResult?: {
    artifactId: string;
    resultingEffectState: string;
    effectApplied: boolean;
  };
};

export function buildNativeDecisionOutputArtifact(
  input: NativeDecisionOutputArtifactInput,
): NativeDecisionOutputArtifact {
  const contentDownrankAppeal = contentVisibilityDownrankAppealPayload(
    input.requestedActionPayload,
  );
  if (contentDownrankAppeal) {
    if (!input.contentDownrankAppealEffectResult) {
      throw new Error('content_visibility_downrank_appeal_effect_result_required');
    }
    return buildContentVisibilityDownrankAppealArtifact({
      ...input,
      appeal: contentDownrankAppeal,
    });
  }
  const communicationAppeal = communicationMemberMuteAppealPayload(
    input.requestedActionPayload,
  );
  if (communicationAppeal) {
    if (!input.communicationAppealEffectResult) {
      throw new Error('communication_mute_appeal_effect_result_required');
    }
    return buildCommunicationMuteAppealArtifact({
      ...input,
      appeal: communicationAppeal,
    });
  }
  const communicationRatification = communicationMemberMuteRatificationPayload(
    input.requestedActionPayload,
  );
  if (communicationRatification) {
    return buildCommunicationMuteRatificationArtifact({
      ...input,
      ratification: communicationRatification,
    });
  }
  const amendment = grantAgreementAmendmentPayload(input.requestedActionPayload);
  if (amendment) {
    return buildGovernanceGrantAgreementAmendmentArtifact({ ...input, amendment });
  }
  const terminalAbandonment = providerExecutionTerminalAbandonmentPayload(
    input.requestedActionPayload,
  );
  if (terminalAbandonment) {
    return buildGovernanceProviderExecutionTerminalAbandonmentArtifact({
      ...input,
      terminalAbandonment,
    });
  }
  const fundingAmendment = parseGovernanceFundingAmendmentPayload(
    input.requestedActionPayload,
  );
  if (fundingAmendment) {
    return buildGovernanceProviderExecutionFundingAmendmentArtifact({
      ...input,
      fundingAmendment,
    });
  }
  if (input.selectionRanking) {
    return buildNativeSelectionResultArtifact({
      ...input,
      selectionRanking: input.selectionRanking,
    });
  }
  if (input.mechanismKind !== 'quadratic_funding') {
    return buildNativePolicyDecisionOutputArtifact(input);
  }
  const tally = input.decisionTally && typeof input.decisionTally === 'object'
    && !Array.isArray(input.decisionTally)
    ? input.decisionTally as Record<string, unknown>
    : {};
  const settlement = tally.settlement && typeof tally.settlement === 'object'
    && !Array.isArray(tally.settlement)
    ? tally.settlement as Record<string, unknown>
    : {};
  if (
    input.decision !== 'accepted'
    || input.caseType !== 'policy'
    || tally.resultType !== 'allocation_plan'
    || settlement.funding !== 'unfunded'
    || settlement.state !== 'pending_settlement'
    || settlement.resourceRef !== null
    || settlement.escrowRef !== null
    || settlement.payoutRef !== null
    || settlement.providerFinality !== null
  ) throw new Error('decision_output_artifact_qf_result_invalid');
  const base = buildNativePolicyDecisionOutputArtifact(input);
  const allocationPlan = {
    roundRef: tally.roundRef,
    budgetUnit: tally.budgetUnit,
    matchingBudget: tally.matchingBudget,
    formula: tally.formula,
    rounding: tally.rounding,
    candidateSnapshot: tally.candidateSnapshot,
    contributionSnapshotDigest: tally.contributionSnapshotDigest,
    projects: tally.projects,
    allocatedMatchingUnits: tally.allocatedMatchingUnits,
    unallocatedMatchingUnits: tally.unallocatedMatchingUnits,
    settlement,
    governingDecisionDigest: base.decisionDigest,
  };
  const contentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.output.allocation-plan-content-v1', allocationPlan,
  );
  const constraints = {
    allocationPlan,
    execution: {
      mode: 'no_op' as const,
      reason: 'unfunded_pending_settlement' as const,
      adapterRef: null,
      providerReadiness: 'not_ready' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    ...artifactDigestFacts(base),
    kind: 'allocation_plan' as const,
    schemaRef: 'alcheme.governance.output.allocation_plan' as const,
    sourceRef: `decision:${base.decisionDigest}`,
    resolverRef: 'alcheme.native.quadratic-funding' as const,
    constraints,
    contentDigest,
  };
  return {
    ...base,
    id: `decision-output:${base.decisionDigest}`,
    kind: facts.kind,
    schemaRef: facts.schemaRef,
    sourceRef: facts.sourceRef,
    resolverRef: facts.resolverRef,
    constraints,
    contentDigest,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact', facts,
    ),
  };
}

function buildContentVisibilityDownrankAppealArtifact(
  input: NativeDecisionOutputArtifactInput & {
    appeal: NonNullable<ReturnType<typeof contentVisibilityDownrankAppealPayload>>;
  },
): GovernanceAppealResolutionOutputArtifact {
  if (
    !['accepted', 'rejected', 'expired', 'cancelled'].includes(input.decision)
    || input.caseType !== 'policy'
    || input.subjectType !== 'feed_post'
    || input.subjectRef !== input.appeal.subjectRef
  ) throw new Error('content_visibility_downrank_appeal_artifact_contract_invalid');
  const caseId = requiredText(input.caseId, 'appeal_resolution_artifact_case_required');
  const decisionRequestId = requiredText(
    input.decisionRequestId,
    'appeal_resolution_artifact_request_required',
  );
  const decisionDigest = requiredDigest(
    input.decisionDigest,
    'appeal_resolution_artifact_decision_digest_invalid',
  );
  const accepted = input.decision === 'accepted';
  const effectResult = input.contentDownrankAppealEffectResult;
  if (
    !effectResult
    || effectResult.artifactId !== `decision-output:${decisionDigest}`
    || !['active', 'expired', 'revoked', 'superseded'].includes(
      effectResult.resultingEffectState,
    )
    || (!accepted && effectResult.effectApplied)
    || (effectResult.effectApplied && effectResult.resultingEffectState !== 'revoked')
    || (accepted
      && !effectResult.effectApplied
      && !['expired', 'revoked', 'superseded'].includes(effectResult.resultingEffectState))
  ) throw new Error('content_visibility_downrank_appeal_effect_result_invalid');
  const appealResolution = {
    domain: 'content_visibility_downrank' as const,
    outcome: accepted ? 'revoke' as const : 'uphold' as const,
    appealId: input.appeal.appealId,
    originalInvocationId: input.appeal.originalInvocationId,
    originalExecutionReceiptId: input.appeal.originalReceiptId,
    originalReceiptDigest: input.appeal.originalReceiptDigest,
    originalEffectDigest: input.appeal.originalEffectDigest,
    appellantPubkey: input.appeal.appellantPubkey,
    originalOperatorPubkey: input.appeal.originalOperatorPubkey,
    evidenceDigest: input.appeal.evidenceDigest,
    resultingEffectState: effectResult.resultingEffectState as
      | 'active' | 'expired' | 'revoked' | 'superseded',
    effectStatus: effectResult.effectApplied ? 'applied' as const : 'preserved' as const,
    governingDecisionDigest: decisionDigest,
    noAggravationBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
  };
  const execution = accepted && effectResult.effectApplied
    ? {
        mode: 'adapter' as const,
        reason: 'content_visibility_downrank_appeal_effect_applied' as const,
        adapterRef: 'operation_effect' as const,
        providerReadiness: 'not_applicable' as const,
        automaticExecution: true,
      }
    : accepted
      ? {
          mode: 'no_op' as const,
          reason: 'appeal_accepted_original_effect_already_terminal' as const,
          adapterRef: null,
          providerReadiness: 'not_applicable' as const,
          automaticExecution: false,
        }
      : {
          mode: 'no_op' as const,
          reason: 'appeal_upheld_original_effect_preserved' as const,
          adapterRef: null,
          providerReadiness: 'not_applicable' as const,
          automaticExecution: false,
        };
  const constraints = { appealResolution, execution };
  const contentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.output.appeal-resolution-content-v1',
    appealResolution,
  );
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0,
    kind: 'appeal_resolution' as const,
    schemaRef: 'alcheme.governance.output.appeal_resolution' as const,
    schemaVersion: 1 as const,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    sourceType: 'governance_execution_receipt' as const,
    sourceRef: input.appeal.originalReceiptId,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest: input.appeal.originalEffectDigest,
    resolverRef: 'alcheme.native.appeal-resolution' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest,
    finality: 'alcheme_native_decision' as const,
    executionCapability: accepted && effectResult.effectApplied
      ? 'current_adapter' as const
      : 'no_op' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
    createdAt: input.createdAt,
  };
}

function buildCommunicationMuteAppealArtifact(
  input: NativeDecisionOutputArtifactInput & {
    appeal: NonNullable<ReturnType<typeof communicationMemberMuteAppealPayload>>;
  },
): GovernanceAppealResolutionOutputArtifact {
  if (
    !['accepted', 'rejected', 'expired', 'cancelled'].includes(input.decision)
    || input.caseType !== 'policy'
    || input.subjectType !== 'communication_room_member'
    || input.subjectRef !== input.appeal.subjectRef
  ) throw new Error('communication_mute_appeal_artifact_contract_invalid');
  const caseId = requiredText(input.caseId, 'appeal_resolution_artifact_case_required');
  const decisionRequestId = requiredText(
    input.decisionRequestId,
    'appeal_resolution_artifact_request_required',
  );
  const decisionDigest = requiredDigest(
    input.decisionDigest,
    'appeal_resolution_artifact_decision_digest_invalid',
  );
  const accepted = input.decision === 'accepted';
  const effectResult = input.communicationAppealEffectResult;
  if (
    !effectResult
    || effectResult.artifactId !== `decision-output:${decisionDigest}`
    || !['active', 'expired', 'revoked', 'superseded', 'ratification_required', 'rollback_failed'].includes(
      effectResult.resultingEffectState,
    )
    || (!accepted && effectResult.effectApplied)
    || (effectResult.effectApplied && effectResult.resultingEffectState !== 'revoked')
    || (accepted
      && !effectResult.effectApplied
      && !['expired', 'revoked', 'superseded'].includes(effectResult.resultingEffectState))
  ) throw new Error('communication_mute_appeal_effect_result_invalid');
  const appealResolution = {
    domain: 'communication_member_mute' as const,
    outcome: accepted ? 'revoke' as const : 'uphold' as const,
    appealId: input.appeal.appealId,
    originalInvocationId: input.appeal.originalInvocationId,
    originalExecutionReceiptId: input.appeal.originalReceiptId,
    originalReceiptDigest: input.appeal.originalReceiptDigest,
    originalEffectDigest: input.appeal.originalEffectDigest,
    appellantPubkey: input.appeal.appellantPubkey,
    originalOperatorPubkey: input.appeal.originalOperatorPubkey,
    evidenceDigest: input.appeal.evidenceDigest,
    resultingEffectState: effectResult.resultingEffectState as
      | 'active' | 'expired' | 'revoked' | 'superseded'
      | 'ratification_required' | 'rollback_failed',
    effectStatus: effectResult.effectApplied ? 'applied' as const : 'preserved' as const,
    governingDecisionDigest: decisionDigest,
    noAggravationBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
  };
  const execution = accepted && effectResult.effectApplied
    ? {
        mode: 'adapter' as const,
        reason: 'communication_mute_appeal_effect_applied' as const,
        adapterRef: 'operation_effect' as const,
        providerReadiness: 'not_applicable' as const,
        automaticExecution: true,
      }
    : accepted
      ? {
          mode: 'no_op' as const,
          reason: 'appeal_accepted_original_effect_already_terminal' as const,
          adapterRef: null,
          providerReadiness: 'not_applicable' as const,
          automaticExecution: false,
        }
      : {
        mode: 'no_op' as const,
        reason: 'appeal_upheld_original_effect_preserved' as const,
        adapterRef: null,
        providerReadiness: 'not_applicable' as const,
        automaticExecution: false,
      };
  const constraints = { appealResolution, execution };
  const contentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.output.appeal-resolution-content-v1',
    appealResolution,
  );
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0,
    kind: 'appeal_resolution' as const,
    schemaRef: 'alcheme.governance.output.appeal_resolution' as const,
    schemaVersion: 1 as const,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    sourceType: 'governance_execution_receipt' as const,
    sourceRef: input.appeal.originalReceiptId,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest: input.appeal.originalEffectDigest,
    resolverRef: 'alcheme.native.appeal-resolution' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest,
    finality: 'alcheme_native_decision' as const,
    executionCapability: accepted && effectResult.effectApplied
      ? 'current_adapter' as const
      : 'no_op' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
    createdAt: input.createdAt,
  };
}

function buildCommunicationMuteRatificationArtifact(
  input: NativeDecisionOutputArtifactInput & {
    ratification: NonNullable<ReturnType<typeof communicationMemberMuteRatificationPayload>>;
  },
): CommunicationMuteRatificationArtifact {
  if (
    input.decision !== 'accepted'
    || input.caseType !== 'policy'
    || input.subjectType !== 'communication_room_member'
    || input.subjectRef !== input.ratification.subjectRef
  ) throw new Error('communication_mute_ratification_artifact_contract_invalid');
  const caseId = requiredText(input.caseId, 'decision_output_artifact_case_required');
  const decisionRequestId = requiredText(
    input.decisionRequestId,
    'decision_output_artifact_request_required',
  );
  const decisionDigest = requiredDigest(
    input.decisionDigest,
    'decision_output_artifact_decision_digest_invalid',
  );
  const sourceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.communication-mute-ratification-source-v1',
    input.ratification,
  );
  const operationRatification = {
    originalInvocationId: input.ratification.originalInvocationId,
    originalReceiptId: input.ratification.originalReceiptId,
    operationEffectId: input.ratification.operationEffectId,
    originalOperatorPubkey: input.ratification.originalOperatorPubkey,
    ratificationDeadline: input.ratification.ratificationDeadline,
    resultingEffectState: 'active',
    governingDecisionDigest: decisionDigest,
  };
  const constraints = {
    operationRatification,
    execution: {
      mode: 'adapter' as const,
      reason: 'existing_operation_effect_ratified' as const,
      adapterRef: 'operation_effect' as const,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: true as const,
    },
  };
  const contentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.output.operation-ratification-content-v1',
    operationRatification,
  );
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0,
    kind: 'operation_ratification' as const,
    schemaRef: 'alcheme.governance.output.operation_ratification' as const,
    schemaVersion: 1 as const,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    sourceType: 'governance_execution_receipt' as const,
    sourceRef: input.ratification.originalReceiptId,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest,
    resolverRef: 'alcheme.native.communication-mute-ratification' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest,
    finality: 'alcheme_native_decision' as const,
    executionCapability: 'current_adapter' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
    createdAt: input.createdAt,
  };
}

function buildGovernanceGrantAgreementAmendmentArtifact(input: NativeDecisionOutputArtifactInput & {
  amendment: {
    agreementId: string;
    baselineTermsDigest: string;
    proposedTerms: Record<string, unknown>;
    proposedTermsDigest: string;
    reason: string;
  };
}): GovernanceGrantAgreementAmendmentArtifact {
  const base = buildNativePolicyDecisionOutputArtifact(input);
  const expectedProposedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.grant-agreement-terms-v1', input.amendment.proposedTerms,
  );
  if (
    !/^[a-f0-9]{64}$/.test(input.amendment.baselineTermsDigest)
    || input.amendment.proposedTermsDigest !== expectedProposedDigest
    || input.amendment.proposedTermsDigest === input.amendment.baselineTermsDigest
  ) throw new Error('grant_agreement_amendment_artifact_contract_invalid');
  const grantAgreementAmendment = {
    ...input.amendment,
    governingDecisionDigest: base.decisionDigest,
  };
  const constraints = {
    grantAgreementAmendment,
    execution: {
      mode: 'no_op' as const,
      reason: 'governed_amendment_requires_explicit_application' as const,
      adapterRef: null,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    ...artifactDigestFacts(base),
    kind: 'grant_agreement_amendment' as const,
    schemaRef: 'alcheme.governance.output.grant_agreement_amendment' as const,
    resolverRef: 'alcheme.native.grant-agreement-amendment' as const,
    constraints,
    contentDigest: input.amendment.proposedTermsDigest,
  };
  return {
    ...base,
    kind: facts.kind,
    schemaRef: facts.schemaRef,
    resolverRef: facts.resolverRef,
    constraints,
    contentDigest: facts.contentDigest,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact', facts,
    ),
  };
}

function grantAgreementAmendmentPayload(value: unknown): {
  agreementId: string;
  baselineTermsDigest: string;
  proposedTerms: Record<string, unknown>;
  proposedTermsDigest: string;
  reason: string;
} | null {
  const payload = record(value);
  if (payload.kind !== 'grant_agreement_amendment') return null;
  const proposedTerms = record(payload.proposedTerms);
  const agreementId = String(payload.agreementId ?? '').trim();
  const baselineTermsDigest = String(payload.baselineTermsDigest ?? '').trim();
  const proposedTermsDigest = String(payload.proposedTermsDigest ?? '').trim();
  const reason = String(payload.reason ?? '').trim();
  if (!agreementId || !reason || Object.keys(proposedTerms).length === 0) {
    throw new Error('grant_agreement_amendment_artifact_contract_invalid');
  }
  return { agreementId, baselineTermsDigest, proposedTerms, proposedTermsDigest, reason };
}

type ProviderExecutionTerminalAbandonmentPayload = {
  kind: 'provider_execution_terminal_abandonment';
  originalCaseId: string;
  originalRequestId: string;
  originalDecisionDigest: string;
  providerCheckpointDigest: string;
  completedActionReceiptDigests: string[];
  remainingActionIds: string[];
  irreversibleChanges: string[];
  compensationRequirement: 'governed_compensation_plan_required';
  directOperatorMutationAllowed: false;
  reason: string;
};

function providerExecutionTerminalAbandonmentPayload(
  value: unknown,
): ProviderExecutionTerminalAbandonmentPayload | null {
  const payload = record(value);
  if (payload.kind !== 'provider_execution_terminal_abandonment') return null;
  const completedActionReceiptDigests = stringArray(payload.completedActionReceiptDigests);
  const remainingActionIds = stringArray(payload.remainingActionIds);
  const irreversibleChanges = stringArray(payload.irreversibleChanges);
  const invalid = (
    payload.compensationRequirement !== 'governed_compensation_plan_required'
    || payload.directOperatorMutationAllowed !== false
    || completedActionReceiptDigests.length === 0
    || completedActionReceiptDigests.length > 12
    || new Set(completedActionReceiptDigests).size !== completedActionReceiptDigests.length
    || completedActionReceiptDigests.some((digest) => !/^[a-f0-9]{64}$/.test(digest))
    || remainingActionIds.length === 0
    || remainingActionIds.length > 12
    || new Set(remainingActionIds).size !== remainingActionIds.length
    || irreversibleChanges.length === 0
    || irreversibleChanges.length > 12
  );
  if (invalid) {
    throw new Error('provider_execution_terminal_abandonment_artifact_contract_invalid');
  }
  return {
    kind: 'provider_execution_terminal_abandonment',
    originalCaseId: requiredText(
      payload.originalCaseId,
      'provider_execution_terminal_abandonment_artifact_contract_invalid',
    ),
    originalRequestId: requiredText(
      payload.originalRequestId,
      'provider_execution_terminal_abandonment_artifact_contract_invalid',
    ),
    originalDecisionDigest: requiredDigest(
      payload.originalDecisionDigest,
      'provider_execution_terminal_abandonment_artifact_contract_invalid',
    ),
    providerCheckpointDigest: requiredDigest(
      payload.providerCheckpointDigest,
      'provider_execution_terminal_abandonment_artifact_contract_invalid',
    ),
    completedActionReceiptDigests,
    remainingActionIds,
    irreversibleChanges,
    compensationRequirement: 'governed_compensation_plan_required',
    directOperatorMutationAllowed: false,
    reason: requiredText(
      payload.reason,
      'provider_execution_terminal_abandonment_artifact_contract_invalid',
    ),
  };
}

function buildGovernanceProviderExecutionTerminalAbandonmentArtifact(
  input: NativeDecisionOutputArtifactInput & {
    terminalAbandonment: ProviderExecutionTerminalAbandonmentPayload;
  },
): GovernanceProviderExecutionTerminalAbandonmentArtifact {
  if (input.decision !== 'accepted') {
    throw new Error('provider_execution_terminal_abandonment_artifact_requires_acceptance');
  }
  const base = buildNativePolicyDecisionOutputArtifact(input);
  const constraints = {
    providerExecutionTerminalAbandonment: {
      ...input.terminalAbandonment,
      governingDecisionDigest: base.decisionDigest,
    },
    execution: {
      mode: 'no_op' as const,
      reason: 'compensation_requires_separate_governed_execution' as const,
      adapterRef: null,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    ...artifactDigestFacts(base),
    kind: 'provider_execution_terminal_abandonment' as const,
    schemaRef: 'alcheme.governance.output.provider_execution_terminal_abandonment' as const,
    resolverRef: 'alcheme.native.provider-execution-terminal-abandonment' as const,
    constraints,
    contentDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-execution-terminal-abandonment-v1',
      input.terminalAbandonment,
    ),
  };
  return {
    ...base,
    kind: facts.kind,
    schemaRef: facts.schemaRef,
    resolverRef: facts.resolverRef,
    constraints,
    contentDigest: facts.contentDigest,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact', facts,
    ),
  };
}

function buildGovernanceProviderExecutionFundingAmendmentArtifact(
  input: NativeDecisionOutputArtifactInput & {
    fundingAmendment: GovernanceFundingAmendmentPayload;
  },
): GovernanceProviderExecutionFundingAmendmentArtifact {
  if (input.decision !== 'accepted') {
    throw new Error('provider_execution_funding_amendment_artifact_requires_acceptance');
  }
  const base = buildNativePolicyDecisionOutputArtifact(input);
  const constraints = {
    providerExecutionFundingAmendment: {
      ...input.fundingAmendment,
      governingDecisionDigest: base.decisionDigest,
    },
    execution: {
      mode: 'adapter' as const,
      reason: 'accepted_amendment_versions_policy_and_preflight' as const,
      adapterRef: 'governance_funding_amendment' as const,
      providerReadiness: 'pending_manual_retry' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    ...artifactDigestFacts(base),
    kind: 'provider_execution_funding_amendment' as const,
    schemaRef: 'alcheme.governance.output.provider_execution_funding_amendment' as const,
    resolverRef: 'alcheme.native.provider-execution-funding-amendment' as const,
    constraints,
    contentDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-execution-funding-amendment-v1',
      input.fundingAmendment,
    ),
  };
  return {
    ...base,
    kind: facts.kind,
    schemaRef: facts.schemaRef,
    resolverRef: facts.resolverRef,
    constraints,
    contentDigest: facts.contentDigest,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
  };
}

export function buildGovernanceAppealResolutionOutputArtifact(input: {
  caseId: string;
  subjectType: string;
  subjectRef: string;
  decisionRequestId: string;
  decision: string;
  decisionDigest: string;
  requestedOutcome: 'modify' | 'revoke';
  originalInvocationId: string;
  originalRequestId: string;
  originalExecutionReceiptId: string;
  originalDecisionDigest: string;
  originalEffectDigest: string;
  appellantPubkey: string;
  evidenceDigest: string;
  previousDiscoveryStatus: string;
  discoveryStatus: string;
  modifiedDiscoveryStatus: string | null;
  executionReceiptId: string | null;
  createdAt: Date;
}): GovernanceAppealResolutionOutputArtifact {
  const caseId = requiredText(input.caseId, 'appeal_resolution_artifact_case_required');
  const decisionRequestId = requiredText(
    input.decisionRequestId,
    'appeal_resolution_artifact_request_required',
  );
  const decisionDigest = requiredDigest(
    input.decisionDigest,
    'appeal_resolution_artifact_decision_digest_invalid',
  );
  const originalDecisionDigest = requiredDigest(
    input.originalDecisionDigest,
    'appeal_resolution_artifact_original_decision_digest_invalid',
  );
  const originalEffectDigest = requiredDigest(
    input.originalEffectDigest,
    'appeal_resolution_artifact_original_effect_digest_invalid',
  );
  const evidenceDigest = requiredDigest(
    input.evidenceDigest,
    'appeal_resolution_artifact_evidence_digest_invalid',
  );
  if (input.decision !== 'accepted' && input.decision !== 'rejected') {
    throw new Error('appeal_resolution_artifact_terminal_decision_required');
  }
  const accepted = input.decision === 'accepted';
  if (accepted !== Boolean(input.executionReceiptId)) {
    throw new Error('appeal_resolution_artifact_execution_receipt_mismatch');
  }
  if (input.requestedOutcome === 'modify') {
    requiredText(
      input.modifiedDiscoveryStatus,
      'appeal_resolution_artifact_modified_status_required',
    );
  }
  const outcome: GovernanceAppealResolutionOutcome = accepted
    ? input.requestedOutcome
    : 'uphold';
  const resultingDiscoveryStatus = outcome === 'revoke'
    ? input.previousDiscoveryStatus
    : outcome === 'modify'
      ? String(input.modifiedDiscoveryStatus)
      : input.discoveryStatus;
  const appealResolution = {
    outcome,
    originalInvocationId: requiredText(
      input.originalInvocationId,
      'appeal_resolution_artifact_original_invocation_required',
    ),
    originalRequestId: requiredText(
      input.originalRequestId,
      'appeal_resolution_artifact_original_request_required',
    ),
    originalExecutionReceiptId: requiredText(
      input.originalExecutionReceiptId,
      'appeal_resolution_artifact_original_receipt_required',
    ),
    originalDecisionDigest,
    appellantPubkey: requiredText(
      input.appellantPubkey,
      'appeal_resolution_artifact_appellant_required',
    ),
    evidenceDigest,
    previousDiscoveryStatus: requiredText(
      input.previousDiscoveryStatus,
      'appeal_resolution_artifact_previous_status_required',
    ),
    discoveryStatus: requiredText(
      input.discoveryStatus,
      'appeal_resolution_artifact_discovery_status_required',
    ),
    resultingDiscoveryStatus,
    effectStatus: accepted ? 'applied' as const : 'preserved' as const,
    executionReceiptId: input.executionReceiptId,
    governingDecisionDigest: decisionDigest,
  };
  const execution = accepted
    ? {
        mode: 'adapter' as const,
        reason: 'external_app_appeal_effect_applied' as const,
        adapterRef: 'external_app' as const,
        providerReadiness: 'not_applicable' as const,
        automaticExecution: true,
      }
    : {
        mode: 'no_op' as const,
        reason: 'appeal_upheld_original_effect_preserved' as const,
        adapterRef: null,
        providerReadiness: 'not_applicable' as const,
        automaticExecution: false,
      };
  const constraints = { appealResolution, execution };
  const contentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.output.appeal-resolution-content-v1',
    appealResolution,
  );
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0,
    kind: 'appeal_resolution' as const,
    schemaRef: 'alcheme.governance.output.appeal_resolution' as const,
    schemaVersion: 1 as const,
    subjectType: requiredText(input.subjectType, 'appeal_resolution_artifact_subject_required'),
    subjectRef: requiredText(input.subjectRef, 'appeal_resolution_artifact_subject_required'),
    sourceType: 'governance_execution_receipt' as const,
    sourceRef: input.originalExecutionReceiptId,
    sourceDraftPostId: null,
    sourceDraftVersion: null,
    sourceDigest: originalEffectDigest,
    resolverRef: 'alcheme.native.appeal-resolution' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest,
    finality: 'alcheme_native_decision' as const,
    executionCapability: accepted ? 'current_adapter' as const : 'no_op' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
    createdAt: input.createdAt,
  };
}

export async function persistExternalAppAppealResolutionOutputArtifact(
  tx: any,
  input: {
    governanceCase: { id: string; subjectType: string; subjectRef: string };
    request: { id: string; actionType: string; targetType: string; targetRef: string; payload: unknown };
    decision: { decision: string; decisionDigest: string };
    executionReceiptId: string | null;
    now: Date;
  },
): Promise<GovernanceAppealResolutionOutputArtifact | null> {
  if (input.request.actionType !== 'external_app_appeal_resolution') return null;
  if (
    input.request.targetType !== 'external_app'
    || input.request.targetRef !== input.governanceCase.subjectRef
    || input.governanceCase.subjectType !== 'external_app'
  ) {
    throw new Error('appeal_resolution_artifact_case_subject_mismatch');
  }
  const payload = record(input.request.payload);
  if (
    payload.environment !== 'sandbox'
    || payload.kind !== 'external_app_appeal_resolution'
    || (payload.requestedOutcome !== 'modify' && payload.requestedOutcome !== 'revoke')
  ) {
    throw new Error('appeal_resolution_artifact_contract_mismatch');
  }
  const expected = buildGovernanceAppealResolutionOutputArtifact({
    caseId: input.governanceCase.id,
    subjectType: input.governanceCase.subjectType,
    subjectRef: input.governanceCase.subjectRef,
    decisionRequestId: input.request.id,
    decision: input.decision.decision,
    decisionDigest: input.decision.decisionDigest,
    requestedOutcome: payload.requestedOutcome,
    originalInvocationId: String(payload.originalInvocationId ?? ''),
    originalRequestId: String(payload.originalRequestId ?? ''),
    originalExecutionReceiptId: String(payload.originalExecutionReceiptId ?? ''),
    originalDecisionDigest: String(payload.originalDecisionDigest ?? ''),
    originalEffectDigest: String(payload.originalEffectDigest ?? ''),
    appellantPubkey: String(payload.appellantPubkey ?? ''),
    evidenceDigest: String(payload.evidenceDigest ?? ''),
    previousDiscoveryStatus: String(payload.previousDiscoveryStatus ?? ''),
    discoveryStatus: String(payload.discoveryStatus ?? ''),
    modifiedDiscoveryStatus: payload.modifiedDiscoveryStatus == null
      ? null
      : String(payload.modifiedDiscoveryStatus),
    executionReceiptId: input.executionReceiptId,
    createdAt: input.now,
  });
  const existing = await tx.decisionOutputArtifact.findUnique({
    where: {
      decisionRequestId_decisionDigest_ordinal: {
        decisionRequestId: expected.decisionRequestId,
        decisionDigest: expected.decisionDigest,
        ordinal: expected.ordinal,
      },
    },
  });
  if (existing) {
    if (!decisionOutputArtifactMatches(existing, expected)) {
      throw new Error('appeal_resolution_artifact_conflict');
    }
    return expected;
  }
  await tx.decisionOutputArtifact.create({ data: expected });
  return expected;
}

function buildNativeSelectionResultArtifact(
  input: NativeDecisionOutputArtifactInput & {
    selectionRanking: NonNullable<GovernanceCaseTemplateSelection['selectionRanking']>;
  },
): NativeSelectionResultArtifact {
  if (input.mechanismKind !== 'equal_weight_threshold') {
    throw new Error('decision_output_artifact_selection_mechanism_invalid');
  }
  const selection = input.selectionRanking;
  const candidates = selection.candidateSnapshot.eligibleCandidates;
  const excludedCandidates = selection.candidateSnapshot.excludedCandidates;
  if (
    input.decision !== 'accepted'
    || selection.candidateSnapshot.source !== 'human_case_intake'
    || selection.candidateSnapshot.aiAuthority !== 'none'
    || selection.scoreDirection !== 'higher_integer_first'
    || selection.tieResolver !== 'candidate_ref_lexicographic'
    || !Number.isSafeInteger(selection.seatCount)
    || selection.seatCount < 1
    || selection.seatCount > candidates.length
    || candidates.length < 2
    || candidates.some((candidate) => (
      !candidate.id || !candidate.label || !candidate.candidateRef
      || !Number.isSafeInteger(candidate.score) || candidate.score < 0
    ))
    || new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length
    || excludedCandidates.some((candidate) => (
      !candidate.candidateRef || !candidate.reason
    ))
    || new Set([
      ...candidates.map((candidate) => candidate.candidateRef),
      ...excludedCandidates.map((candidate) => candidate.candidateRef),
    ]).size !== candidates.length + excludedCandidates.length
  ) {
    throw new Error('decision_output_artifact_selection_result_invalid');
  }
  const base = buildNativePolicyDecisionOutputArtifact(input);
  const rankedCandidates = candidates
    .map((candidate) => ({ ...candidate }))
    .sort((left, right) => (
      right.score - left.score
      || compareCanonicalRefs(left.candidateRef, right.candidateRef)
    ))
    .map((candidate, index) => ({
      rank: index + 1,
      selected: index < selection.seatCount,
      ...candidate,
    }));
  const selectionResult = {
    candidateSnapshot: selection.candidateSnapshot,
    seatCount: selection.seatCount,
    scoreDirection: selection.scoreDirection,
    tieResolver: selection.tieResolver,
    seatResolver: 'top_n_after_score_and_candidate_ref' as const,
    rankedCandidates,
    selectedCandidateRefs: rankedCandidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => candidate.candidateRef),
    governingDecisionDigest: base.decisionDigest,
  };
  const contentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.output.selection-result-content-v1', selectionResult,
  );
  const constraints = {
    selectionResult,
    execution: {
      mode: 'no_op' as const,
      reason: 'selection_result_record_only' as const,
      adapterRef: null,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    ...artifactDigestFacts(base),
    kind: 'selection_result' as const,
    schemaRef: 'alcheme.governance.output.selection_result' as const,
    sourceRef: `decision:${base.decisionDigest}`,
    resolverRef: 'alcheme.native.selection-ranking' as const,
    constraints,
    contentDigest,
  };
  return {
    ...base,
    id: `decision-output:${base.decisionDigest}`,
    kind: facts.kind,
    schemaRef: facts.schemaRef,
    sourceRef: facts.sourceRef,
    resolverRef: facts.resolverRef,
    constraints,
    contentDigest,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact', facts,
    ),
  };
}

export function buildNativePolicyDecisionOutputArtifact(input: {
  caseId: string;
  caseType: string;
  subjectType: string;
  subjectRef: string;
  decisionRequestId: string;
  decision: string;
  decisionDigest: string;
  briefDraftPostId: number;
  briefDraftVersion: number;
  briefSnapshotDigest: string;
  createdAt: Date;
}): NativePolicyDecisionOutputArtifact {
  if (input.decision !== 'accepted') {
    throw new Error('decision_output_artifact_accepted_decision_required');
  }
  if (input.caseType !== 'policy') {
    throw new Error('decision_output_artifact_policy_case_required');
  }
  const caseId = requiredText(input.caseId, 'decision_output_artifact_case_required');
  const decisionRequestId = requiredText(
    input.decisionRequestId,
    'decision_output_artifact_request_required',
  );
  const decisionDigest = requiredDigest(
    input.decisionDigest,
    'decision_output_artifact_decision_digest_invalid',
  );
  const sourceDigest = requiredDigest(
    input.briefSnapshotDigest,
    'decision_output_artifact_source_digest_invalid',
  );
  const sourceDraftPostId = requiredPositiveInteger(
    input.briefDraftPostId,
    'decision_output_artifact_source_draft_invalid',
  );
  const sourceDraftVersion = requiredPositiveInteger(
    input.briefDraftVersion,
    'decision_output_artifact_source_version_invalid',
  );
  const subjectType = requiredText(
    input.subjectType,
    'decision_output_artifact_subject_required',
  );
  const subjectRef = requiredText(
    input.subjectRef,
    'decision_output_artifact_subject_required',
  );
  const constraints = {
    execution: {
      mode: 'no_op' as const,
      reason: 'policy_document_record_only' as const,
      adapterRef: null,
      providerReadiness: 'not_applicable' as const,
      automaticExecution: false as const,
    },
  };
  const facts = {
    caseId,
    decisionRequestId,
    decisionDigest,
    ordinal: 0,
    kind: 'policy_document' as const,
    schemaRef: 'alcheme.governance.output.policy_document' as const,
    schemaVersion: 1 as const,
    subjectType,
    subjectRef,
    sourceType: 'draft_snapshot' as const,
    sourceRef: `draft:${sourceDraftPostId}:v${sourceDraftVersion}`,
    sourceDraftPostId,
    sourceDraftVersion,
    sourceDigest,
    resolverRef: 'alcheme.native.policy-draft-snapshot' as const,
    resolverVersion: '1' as const,
    constraints,
    contentDigest: sourceDigest,
    finality: 'alcheme_native_decision' as const,
    executionCapability: 'no_op' as const,
  };
  return {
    id: `decision-output:${decisionDigest}`,
    ...facts,
    artifactDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.decision-output-artifact',
      facts,
    ),
    createdAt: input.createdAt,
  };
}

export function decisionOutputArtifactMatches(
  stored: Record<string, unknown>,
  expected: NativeDecisionOutputArtifact,
): boolean {
  const storedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.decision-output-artifact',
    artifactDigestFacts(stored),
  );
  return storedDigest === expected.artifactDigest
    && stored.id === expected.id
    && stored.caseId === expected.caseId
    && stored.decisionRequestId === expected.decisionRequestId
    && stored.decisionDigest === expected.decisionDigest
    && stored.artifactDigest === expected.artifactDigest;
}

export function projectDecisionOutputArtifact(
  value: any,
  input: { includeSourceRef: boolean },
): Record<string, unknown> {
  const expectedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.decision-output-artifact',
    artifactDigestFacts(value),
  );
  return {
    id: String(value?.id ?? ''),
    integrity: expectedDigest === value?.artifactDigest ? 'verified' : 'invalid',
    ordinal: Number(value?.ordinal ?? 0),
    kind: String(value?.kind ?? ''),
    schemaRef: String(value?.schemaRef ?? ''),
    schemaVersion: Number(value?.schemaVersion ?? 0),
    subject: {
      type: String(value?.subjectType ?? ''),
      ref: String(value?.subjectRef ?? ''),
    },
    source: {
      type: String(value?.sourceType ?? ''),
      ref: input.includeSourceRef ? String(value?.sourceRef ?? '') : null,
      digest: String(value?.sourceDigest ?? ''),
    },
    resolver: {
      ref: String(value?.resolverRef ?? ''),
      version: String(value?.resolverVersion ?? ''),
    },
    constraints: value?.constraints ?? {},
    executionContract: projectDecisionOutputExecutionContract(value),
    contentDigest: String(value?.contentDigest ?? ''),
    decisionDigest: String(value?.decisionDigest ?? ''),
    finality: String(value?.finality ?? ''),
    executionCapability: String(value?.executionCapability ?? ''),
    artifactDigest: String(value?.artifactDigest ?? ''),
    createdAt: value?.createdAt instanceof Date
      ? value.createdAt.toISOString()
      : String(value?.createdAt ?? ''),
  };
}

export function projectDecisionOutputExecutionContract(
  value: any,
): Record<string, unknown> {
  const expectedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.decision-output-artifact',
    artifactDigestFacts(value),
  );
  if (expectedDigest !== value?.artifactDigest) {
    return { disposition: 'invalid_artifact_digest', plan: null };
  }
  const execution = value?.constraints?.execution && typeof value.constraints.execution === 'object'
    ? value.constraints.execution as Record<string, unknown>
    : {};
  const mode = String(execution.mode ?? '');
  const reason = String(execution.reason ?? '');
  const automaticExecution = execution.automaticExecution === true;
  const capability = String(value?.executionCapability ?? '');
  if (mode === 'no_op' && capability === 'no_op') {
    return {
      disposition: 'no_op',
      reason,
      automaticExecution: false,
      plan: null,
    };
  }
  const executionPlan = value?.constraints?.executionPlan
    && typeof value.constraints.executionPlan === 'object'
    && !Array.isArray(value.constraints.executionPlan)
    ? value.constraints.executionPlan as Record<string, unknown>
    : null;
  const rawActions = Array.isArray(executionPlan?.actions)
    ? executionPlan.actions as any[]
    : [];
  if (value?.kind === 'internal_execution_plan' && mode === 'adapter' && rawActions.length > 0) {
    return {
      disposition: 'execution_plan',
      source: 'decision_output_artifact.constraints.executionPlan',
      aggregateStatus: String(executionPlan?.aggregateStatus ?? ''),
      actions: rawActions.map((action) => ({
        ordinal: Number(action?.ordinal ?? -1),
        kind: 'internal',
        actionType: String(action?.actionType ?? ''),
        target: action?.target ?? null,
        actionIntentDigest: String(action?.actionIntentDigest ?? ''),
        attempts: [{
          kind: 'internal',
          source: 'canonical_governance_execution_receipt',
          state: String(action?.receipt?.status ?? ''),
          receiptId: String(action?.receipt?.id ?? ''),
        }],
      })),
    };
  }
  if (value?.kind === 'manual_execution_plan' && mode === 'manual' && rawActions.length > 0) {
    return {
      disposition: 'execution_plan',
      source: 'decision_output_artifact.constraints.executionPlan',
      aggregateStatus: String(executionPlan?.aggregateStatus ?? ''),
      actions: rawActions.map((action) => ({
        ordinal: Number(action?.ordinal ?? -1),
        kind: 'manual',
        actionType: String(action?.actionType ?? ''),
        target: action?.target ?? null,
        actionIntentDigest: String(action?.actionIntentDigest ?? ''),
        attempts: [{
          kind: 'manual',
          source: 'manual_execution_completion_and_review_owner',
          state: String(action?.attempt?.state ?? ''),
        }],
      })),
    };
  }
  const adapterRef = String(execution.adapterRef ?? '');
  if (value?.kind === 'execution_resource_mapping' && mode === 'adapter') {
    const resourceMapping = value?.constraints?.resourceMapping
      && typeof value.constraints.resourceMapping === 'object'
      ? value.constraints.resourceMapping as Record<string, unknown>
      : {};
    const providerKind = adapterRef === 'realms_provider_binding'
      ? 'Realms'
      : adapterRef === 'squads_provider_binding'
        ? 'Squads'
        : 'provider_adapter';
    return {
      disposition: 'execution_plan',
      source: 'decision_output_artifact.resource_mapping_plus_provider_runtime_readback',
      aggregateStatus: 'pending_or_terminal_provider_readback_required',
      actions: [{
        ordinal: 0,
        kind: providerKind,
        actionType: String(resourceMapping.actionType ?? ''),
        target: resourceMapping.actionTarget ?? null,
        actionIntentDigest: String(value?.sourceDigest ?? ''),
        attempts: [{
          kind: providerKind,
          source: 'cost_preflight_checkpoint_and_governance_execution_receipt',
          state: 'provider_attempt_required_or_terminal_readback',
        }],
      }],
    };
  }
  if (mode === 'adapter' && adapterRef) {
    return {
      disposition: 'execution_plan',
      source: 'decision_output_artifact.adapter_execution_contract',
      aggregateStatus: automaticExecution ? 'adapter_effect_applied_or_receipt_bound' : 'manual_retry_or_explicit_application_required',
      actions: [{
        ordinal: 0,
        kind: 'internal',
        actionType: String(value?.kind ?? ''),
        target: {
          type: String(value?.subjectType ?? ''),
          ref: String(value?.subjectRef ?? ''),
        },
        actionIntentDigest: String(value?.contentDigest ?? ''),
        attempts: [{
          kind: 'internal',
          source: 'canonical_adapter_receipt_or_effect_owner',
          state: automaticExecution ? 'applied' : 'pending_explicit_application',
        }],
      }],
    };
  }
  return {
    disposition: 'invalid_execution_contract',
    reason: 'artifact_must_be_no_op_or_execution_plan',
    plan: null,
  };
}

export type AcceptedDecisionExecutionContract =
  | 'manual'
  | 'internal'
  | 'provider'
  | 'no_op'
  | 'unavailable';

export function classifyAcceptedDecisionExecutionContract(input: {
  decision: unknown;
  decisionRequestId: unknown;
  decisionDigest: unknown;
  artifacts: unknown;
}): AcceptedDecisionExecutionContract {
  const requestId = optionalText(input.decisionRequestId);
  const decisionDigest = optionalText(input.decisionDigest);
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  if (
    input.decision !== 'accepted'
    || !requestId
    || !decisionDigest
    || !/^[a-f0-9]{64}$/.test(decisionDigest)
    || artifacts.length !== 1
  ) return 'unavailable';
  const artifact = artifacts[0];
  if (
    artifact?.decisionRequestId !== requestId
    || artifact?.decisionDigest !== decisionDigest
  ) return 'unavailable';
  const projected = projectDecisionOutputArtifact(
    artifact,
    { includeSourceRef: false },
  ) as any;
  if (
    projected?.integrity !== 'verified'
    || projected?.decisionDigest !== decisionDigest
  ) return 'unavailable';
  const executionContract = projected?.executionContract;
  if (executionContract?.disposition === 'no_op') return 'no_op';
  if (executionContract?.disposition !== 'execution_plan') return 'unavailable';
  const actions = Array.isArray(executionContract?.actions)
    ? executionContract.actions
    : [];
  if (actions.length === 0) return 'unavailable';
  const actionKinds = new Set<string>(
    actions.map((action: any) => String(action?.kind || '')),
  );
  if (actionKinds.size !== 1) return 'unavailable';
  const [actionKind] = [...actionKinds];
  if (
    actionKind === 'manual'
    && projected?.kind === 'manual_execution_plan'
    && projected?.executionCapability === 'manual'
  ) return 'manual';
  if (actionKind === 'internal') return 'internal';
  if (['Realms', 'Squads', 'provider_adapter'].includes(actionKind)) return 'provider';
  return 'unavailable';
}

function artifactDigestFacts(value: any): Record<string, unknown> {
  return {
    caseId: String(value?.caseId ?? ''),
    decisionRequestId: String(value?.decisionRequestId ?? ''),
    decisionDigest: String(value?.decisionDigest ?? ''),
    ordinal: Number(value?.ordinal ?? 0),
    kind: String(value?.kind ?? ''),
    schemaRef: String(value?.schemaRef ?? ''),
    schemaVersion: Number(value?.schemaVersion ?? 0),
    subjectType: String(value?.subjectType ?? ''),
    subjectRef: String(value?.subjectRef ?? ''),
    sourceType: String(value?.sourceType ?? ''),
    sourceRef: String(value?.sourceRef ?? ''),
    sourceDraftPostId: value?.sourceDraftPostId == null
      ? null
      : Number(value.sourceDraftPostId),
    sourceDraftVersion: value?.sourceDraftVersion == null
      ? null
      : Number(value.sourceDraftVersion),
    sourceDigest: String(value?.sourceDigest ?? ''),
    resolverRef: String(value?.resolverRef ?? ''),
    resolverVersion: String(value?.resolverVersion ?? ''),
    constraints: value?.constraints ?? {},
    contentDigest: String(value?.contentDigest ?? ''),
    finality: String(value?.finality ?? ''),
    executionCapability: String(value?.executionCapability ?? ''),
  };
}

export function computeDecisionOutputArtifactDigest(value: unknown): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.decision-output-artifact',
    artifactDigestFacts(value),
  );
}

function requiredText(value: unknown, errorCode: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const normalized = optionalText(candidate);
    return normalized ? [normalized] : [];
  });
}

function positiveInteger(value: unknown): number | null {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function compareCanonicalRefs(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function requiredDigest(value: unknown, errorCode: string): string {
  const normalized = String(value ?? '').trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(errorCode);
  return normalized;
}

function requiredPositiveInteger(value: unknown, errorCode: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(errorCode);
  return normalized;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
