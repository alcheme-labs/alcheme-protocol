import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  classifyAcceptedDecisionExecutionContract,
  type AcceptedDecisionExecutionContract,
} from './decisionOutputArtifact';
import { governanceCaseReviewRelationshipSignoffGateError } from './governanceCaseWorkflow';

export type GovernanceCaseInboxCategory =
  | 'drafting'
  | 'review'
  | 'decision'
  | 'execution'
  | 'outcome'
  | 'record';

export type GovernanceCaseInboxRole =
  | 'proposer'
  | 'coordinator'
  | 'reviewer'
  | 'voter'
  | 'appellant'
  | 'executor'
  | 'outcome_reviewer';

export type GovernanceCaseInboxPrimaryAction =
  | 'accept_responsibility'
  | 'continue_brief'
  | 'review_brief'
  | 'open_approval_stage'
  | 'cast_vote'
  | 'open_execution'
  | 'submit_execution_evidence'
  | 'review_execution_evidence'
  | 'record_outcome'
  | 'view_case'
  | 'view_record';

export interface GovernanceCaseInboxTask {
  category: GovernanceCaseInboxCategory;
  role: GovernanceCaseInboxRole;
  primaryAction: GovernanceCaseInboxPrimaryAction;
  status: 'available' | 'waiting' | 'completed' | 'blocked';
  deadline: string | null;
  disabledReason: string | null;
  providerHealth: GovernanceCaseInboxProviderHealth | null;
  providerRecovery: GovernanceCaseInboxProviderRecovery | null;
  executionProgress?: Record<string, unknown> | null;
  automaticExecutionAvailability?: Record<string, unknown> | null;
  executionPreview?: Record<string, unknown> | null;
  executionAuthorityPreflight?: Record<string, unknown> | null;
  resourceExecutionAdmission?: Record<string, unknown> | null;
  manualExecutionControl?: GovernanceManualExecutionControlReadback | null;
  executionParticipantBoundary?: GovernanceExecutionParticipantBoundary | null;
  decisionExecutionStatus?: {
    decisionStatus: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'unavailable';
    executionStatus: 'not_ready' | 'not_required' | 'pending' | 'executed' | 'expired' | 'failed' | 'skipped' | 'unavailable';
  } | null;
}

export interface GovernanceCaseDetailExperience {
  realtimePolicy: {
    mode: 'foreground_refetch' | 'stopped';
    refreshAfterMs: 4000 | null;
    terminal: boolean;
  };
  nextRequiredAction: {
    category: GovernanceCaseInboxCategory | null;
    role: GovernanceCaseInboxRole | null;
    primaryAction: GovernanceCaseInboxPrimaryAction | null;
    status: GovernanceCaseInboxTask['status'];
    disabledReason: string | null;
    targetAnchor: string | null;
  };
}

export interface GovernanceExecutionParticipantBoundary {
  schemaVersion: 1;
  authority: 'canonical_case_responsibility_and_resource_authority_binding';
  taskProducer: 'my_governance_case_inbox';
  actorPubkey: string;
  actorTaskSource: 'case_execution_responsibility' | 'provider_execution_authority';
  participantRole: 'execution_coordinator' | 'external_authority_participant';
  responsibilityStatus: 'assigned' | 'accepted' | null;
  provider: string;
  resourceRef: string;
  requestId: string;
  decisionDigest: string;
  authorityRoles: string[];
  actorAuthorityRoles: string[];
  allowedOperations: string[];
  pendingWork: 'provider_execution_task' | 'provider_signature_or_execution_task';
  signerAuthoritySource: 'none_assignment_only' | 'resource_authority_binding';
  assignmentGrantsSignerAuthority: false;
  assignmentGrantsPayerAuthority: false;
  payerPolicyId: string;
  feePayerRole: 'fee_payer_only';
  payerSeparatedFromSigner: true;
  signerRefExposed: false;
  privateKeyExposure: 'none_public_readback_only';
}

export interface GovernanceManualExecutionControlReadback {
  schemaVersion: 1;
  authority: 'canonical_case_responsibility_and_provider_receipt';
  state:
    | 'blocked'
    | 'awaiting_provider_receipt'
    | 'receipt_recorded_awaiting_review'
    | 'submission_required'
    | 'submitted_awaiting_review'
    | 'rejected_resubmission_required'
    | 'approved_receipt_recorded';
  stageAssignee: {
    pubkey: string;
    responsibilityStatus: 'assigned' | 'accepted';
    deadlineAt: string;
  } | null;
  reviewer: {
    pubkey: string;
    responsibilityStatus: 'assigned' | 'accepted';
    kind: 'outcome';
  } | null;
  completionEvidence: {
    receiptId: string;
    evidenceDigest: string;
    providerFinality: 'finalized';
    observedSlot: number;
    executedAt: string;
  } | null;
  manualSubmission: {
    status: 'submitted' | 'rejected' | 'approved';
    version: number;
    evidenceDigest: string;
    evidenceCount: number;
    submittedAt: string;
    reviewedAt: string | null;
    reviewReason: string | null;
    receiptId: string | null;
  } | null;
  completionSource: 'canonical_provider_receipt_only' | 'controlled_manual_submission_and_review';
  assignmentGrantsSignerAuthority: false;
  directMarkExecutedAllowed: false;
  reviewerActionRequiredAfterReceipt: boolean;
  blockers: string[];
}

export interface GovernanceCaseInboxProviderRecovery {
  category: 'provider_backoff' | 'funding_blocked' | 'simulation_failed' | 'submission_rejected' | 'finality_ambiguous' | 'blockhash_expired' | 'provider_state_conflict' | 'provider_outage' | 'manual_review';
  action: 'wait_for_persisted_retry_window' | 'open_funding_amendment_or_restore_existing_payer' | 'repair_preflight_or_open_superseding_case' | 'inspect_rejection_then_repair_or_open_superseding_case' | 'authoritative_readback_before_any_resend' | 'prepare_same_request_rebuild_after_authoritative_expiry' | 'independent_reconciliation_required' | 'restore_readback_then_reconcile_same_receipt' | 'inspect_existing_attempt_without_resend';
  automaticMutation: false;
  authorityChangeAllowed: false;
  payerChangeAllowed: false;
  acceptedDecisionPreserved: true;
  decisionMutationAllowed: false;
  retryMode: 'same_request_only' | 'blocked_until_recovery_fact';
  nextEligibleAt: string | null;
}

export interface GovernanceCaseInboxProviderHealth {
  status: 'healthy' | 'held' | 'degraded';
  readiness: {
    readinessState: 'ready' | 'setup_required' | 'degraded' | 'unavailable';
    riskMaturity: 'stable' | 'experimental';
    stageOpenAllowed: boolean;
    executionOpenAllowed: boolean;
    riskConfirmationRequired: boolean;
    authority: 'provider_trust_profile_resource_reconciliation_readback';
    blockers: string[];
  };
  provider: string;
  profileRef: string | null;
  profileVersion: string | null;
  profileDigest: string | null;
  decoderConformance: string | null;
  resourceRef: string | null;
  observedSlot: number | null;
  observedAt: string | null;
  blocker: string | null;
  incident: {
    id: string;
    state: 'suspected' | 'confirmed' | 'contained' | 'reconciled';
    occurredAt: string;
    evidenceDigest: string;
    pendingExecution: 'blocked' | 'eligible_after_reconciliation';
    originalDecisionAndReceipt: 'preserved';
  } | null;
  revalidation: {
    triggers: string[];
    currentProfileRef: string;
    currentProfileVersion: string;
    targetProfileRef: string;
    targetProfileVersion: string;
    targetProfileDigest: string;
    transitionPolicy: 'governed_transition_plan_pin_suspend_reopen';
  } | null;
  sync: {
    state: 'synced' | 'failed' | 'conflict' | 'revalidation_required';
    source: 'solana_rpc_finalized_account_graph';
    lastSyncedAt: string | null;
    lastAttemptAt: string | null;
    failure: string | null;
  };
  trust: {
    readinessState: 'ready';
    riskMaturity: 'stable' | 'experimental';
    genesisHash: string;
    programId: string;
    loaderProgramId: string;
    programDataAddress: string;
    upgradeAuthority: string;
    deployedProgramBytesSha256: string;
    decoderPackage: string;
    decoderVersion: string;
    decoderArtifactSha256: string;
    decoderConformance: string;
    commitment: 'finalized';
    rpcAccess: 'public_no_credentials';
    deploymentObservedSlot: number;
    deploymentObservedAt: string;
    observationSlot: number;
    observationBlockhash: string;
    rpcIndexerCrossCheck:
      | 'rpc_finalized_and_indexer_program_checkpoint_converged'
      | 'rpc_finalized_indexer_program_checkpoint_behind'
      | 'rpc_finalized_indexer_program_checkpoint_failed'
      | 'rpc_finalized_only_indexer_not_configured'
      | 'rpc_finalized_indexer_observation_unavailable';
  } | null;
  authorities: Array<{
    role: string;
    publicAuthority: string | null;
    custodyProvider: string;
    custodyStatus: string;
    allowedOperations: string[];
    verifiedSlot: number;
    status: string;
    sourceRequestId: string | null;
    sourceDecisionDigest: string | null;
  }> | null;
  providerResourceLifecycle: {
    state: 'available';
    resourceBindingId: string;
    sourceRequestId: string;
    sourceDecisionDigest: string;
    phases: Array<{
      phase:
        | 'created'
        | 'bootstrap_verified'
        | 'authority_transferred'
        | 'old_authority_revoked'
        | 'readback_verified'
        | 'available';
      authority: string;
      evidenceRef: string;
    }>;
    permissionResidue: {
      fallbackAuthority: 'none';
      temporaryWalletAuthority: 'revoked_or_not_retained';
      serviceKeyAuthority: 'not_retained';
      signerKeyExposure: 'none_public_authority_only';
    };
  } | null;
  reconciliationFallback: {
    sourceState: 'provider_incident' | 'profile_revalidation';
    authority: 'frozen_trust_profile_and_independent_provider_readback';
    policyDigest: string;
    reconciliationAuthorityRef: 'independent_provider_readback';
    decisionAuthorityRef: string;
    conflictRule: 'questioned_provider_program_decoder_cannot_adjudicate_itself';
    originalEvidence: {
      requestId: string;
      receiptId: string;
      receiptEvidenceDigest: string;
      originalDecisionDigest: string;
      preserved: true;
    };
    affectedObjects: {
      resourceRef: string;
      ownerProgramRef: string;
      providerProfileRef: string | null;
      providerProfileVersion: number | null;
      incidentId: string | null;
      profileRevalidationBlocker: string | null;
    };
    correctedState: {
      source: 'frozen_provider_trust_profile_target' | 'manual_recovery_pending';
      targetProfileRef: string | null;
      targetProfileVersion: number | null;
      targetProfileDigest: string | null;
      targetOwnerProgramRef: string | null;
      decoderConformance: string | null;
    };
    fallbackMechanism: {
      mode: 'manual_recovery_only';
      independentFallbackProviderRef: null;
      activation: 'fail_closed_when_independent_fallback_absent';
      operatorMaySelectProvider: false;
      questionedProviderMayAdjudicate: false;
    };
    superseding: {
      artifactOwner: 'DecisionOutputArtifact';
      receiptOwner: 'GovernanceExecutionReceipt';
      materialChangeGate: 'new_decision_stage_or_superseding_case';
      required: true;
    };
  } | null;
  authorityPaymentBoundary: {
    payerPolicyId: string;
    economicBearer: string;
    feePayerRole: 'fee_payer_only';
    sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
    feePayerCustodyProvider: string;
    executionAuthorityRoles: string[];
    executionCustodyProviders: string[];
    separation: 'verified_distinct_public_keys_and_key_refs';
    sponsorAuthorityGain: 'none';
    privateKeyExposure: 'none_public_readback_only';
  } | null;
  mandateCostPolicy: {
    mandateId: string;
    mandateVersion: number;
    mandateTermsDigest: string;
    policySource: 'GovernanceMandateVersion.terms.feePolicy';
    costClasses: Array<{
      costClass: 'decision' | 'review' | 'operational' | 'appeal' | 'execution';
      mode: 'no_fee' | 'capped_external_quote';
      economicBearer: 'delegator' | 'delegate' | 'shared';
      maximumAmountMinor: string | null;
      unit: string | null;
    }>;
    specialBudget: {
      mode: 'not_managed_by_mandate';
      maximumAmountMinor: string | null;
      unit: string | null;
    };
    payerAuthority: 'separate_from_governance_authority';
    payerAuthoritySeparatedFromDecisionAuthority: true;
    silentTransferToVoterOperatorExecutorAllowed: false;
    executionCostBearer: 'same_as_mandate_fee_policy';
  } | null;
  fundingSourceFeePayerBoundary: {
    payerPolicyId: string;
    fundingSourceRole: 'governed_resource_account' | 'squads_vault';
    fundingSourceRef: string;
    feePayerRole: 'separated_fee_payer_policy';
    actualFeePayer: 'canonical_payer_policy_fee_payer_signer';
    feePayerSignerRefExposed: false;
    fundingSourceMaySignFees: false;
    approvedPaymentPath: 'explicit_relayer_sponsor'
      | 'governed_reimbursement_policy'
      | 'governance_approved_payer_policy';
    sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
    reimbursementPolicy: 'governed_reimbursement_policy_configured' | 'not_configured';
    reimbursementPolicyRef: string | null;
    executorCashFlowResponsibility: 'forbidden';
    silentExecutorCostTransferAllowed: false;
    economicBearer: string;
  } | null;
  enforcement: {
    schemaVersion: 1;
    mode: 'provider_onchain' | 'multisig_threshold';
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    resourceRef: string;
    ownerProgramRef: string;
    decisionLinkage: { requestId: string; decisionDigest: string };
    allowedOperations: string[];
    verificationState: 'verified';
    version: number;
    proofScope: 'spl_governance_owner_program_and_transit_signatures_match_accepted_decision'
      | 'alcheme_constructed_transaction_matches_accepted_decision';
    residualBypassRisk: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
      | 'threshold_signers_can_create_or_execute_transactions_outside_alcheme';
    bypassPrevented: false;
  } | null;
  costReconciliation: {
    payerPolicyId: string;
    payerRole: 'separated_fee_payer_policy';
    economicBearer: string;
    sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
    unit: 'lamports';
    transactions: Array<{
      stepId: string;
      quotedFeeLamports: number;
      directRentLamports: number | null;
      actualSpendLamports: number;
    }>;
    totalDirectRentLamports: number | null;
    totalSpendLamports: number;
    finalBalanceLamports: number;
    fundingSource: 'solana_devnet_faucet' | 'existing_finalized_balance';
    fundingSignature: string | null;
    reconciliation: 'transaction_sum_matches_provider_receipt';
    rent: 'not_applicable_delegation_no_account_creation'
      | 'provider_receipt_direct_rent_itemized'
      | 'included_in_actual_spend_not_itemized';
    refund: 'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition';
  } | null;
  transactionAttempts: Array<{
    stepId: string;
    transactionAttemptDigest: string;
    attemptOrdinal: number;
    persistenceAuthority: 'canonical_provider_checkpoint_and_payer_policy';
    recentBlockhash: string;
    quotedFeeLamports: number;
    feePayerRole: 'separated_fee_payer_policy';
    feePayerPolicyId: string;
    feePayerBinding: 'canonical_payer_policy_and_solana_message_header';
    providerReference: string;
    messageDigest: string;
    manifestDigest: string;
    digestCoverage: 'message_digest_covers_fee_payer_and_compute_budget_instructions';
    quoteSlot: number;
    quotedAt: string;
    quoteSlotState: 'verified_finalized_provider_quote';
    resimulationTrigger: 'blockhash_or_quote_expiry_before_any_resign';
    priorityFeeLamports: 0;
    priorityFeeState: 'verified_zero_current_pinned_provider_constructor';
  }> | null;
  proposalTransactionReadback: {
    authority: 'provider_receipt_and_independent_finalized_readback';
    proposalRef: string;
    proposalTransactionRef: string;
    commitment: 'finalized';
    executionStatus: 'executed';
    instructions: Array<{
      stepId: string;
      manifestDigest: string;
      summary: string;
      programScope: string[];
      signature: string;
      slot: number;
      commitment: 'finalized';
      executionStatus: 'finalized';
      opaqueInstruction: false;
    }>;
  } | null;
  executionPlanReadback: {
    authority: 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt';
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    executionMode: 'realms' | 'squads';
    requestId: string;
    decisionDigest: string;
    actionIntentDigest: string;
    planDigest: string;
    terminalTransactionAttemptDigest: string;
    actionSetDigest: string;
    aggregateStatus: 'executed';
    duplicatePrevention: {
      authority: 'canonical_action_intent_attempt_and_authoritative_provider_readback';
      state: 'protected_no_duplicate_action_observed';
      actionIntentDigest: string;
      terminalTransactionAttemptDigest: string;
      actionSetDigest: string;
      actionIdempotencyKeys: string[];
      providerReferences: string[];
      checks: {
        uniqueActionIdempotencyKeys: true;
        uniqueProviderReferences: true;
        everyAttemptFinalized: true;
        everyAttemptManifestBound: true;
        authoritativeProviderReadback: true;
      };
      duplicateActionObserved: false;
      duplicatePaymentObserved: 'not_applicable_no_real_asset_current_vertical';
      retryBoundary: 'same_intent_retry_requires_authoritative_expiry';
    };
    actions: Array<{
      actionId: string;
      order: number;
      executor: 'realms' | 'squads';
      operation: string;
      instructionSemantics: string;
      humanSummary: string;
      programScope: string[];
      accountScope: Array<{ role: string; ref: string }>;
      assetChange: string;
      dependsOnActionIds: string[];
      atomicity: 'single_provider_transaction';
      attempts: Array<{
        status: 'finalized';
        providerReference: string;
        slot: number;
        recentBlockhash: string;
        messageDigest: string;
        manifestDigest: string;
      }>;
    }>;
  } | null;
  providerActionSafetyBoundary: {
    authority: 'reviewed_provider_adapter_instruction_safety';
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    executionMode: 'realms' | 'squads';
    chainId: string;
    resourceRef: string;
    ownerProgramRef: string;
    decisionLinkage: { requestId: string; decisionDigest: string; actionIntentDigest: string };
    actionCount: number;
    reviewedAdapter: 'realms_provider_binding' | 'squads_provider_binding';
    programAllowlist: string[];
    operationAllowlist: string[];
    checks: {
      reviewedAdapterOnly: true;
      programAllowlistVerified: true;
      accountPrivilegeChecked: true;
      assetConservation: 'zero_outflow_current_vertical';
      maxOutflowLamports: 0;
      simulationRequired: true;
      opaqueInstructionsAllowed: false;
      rawInstructionAutoExecutionAllowed: false;
      materialChangeRequiresNewDecision: true;
    };
    retryMaterialChangeGate: 'new_decision_stage_or_superseding_case';
  } | null;
  servicePayerAuthorityBoundary: {
    authority: 'canonical_payer_fee_rent_only_asset_authority_separation';
    payerPolicyId: string;
    economicBearer: string;
    feeScope: 'approved_fee_and_rent_only';
    payerRole: 'separated_fee_payer_policy';
    actualFeePayer: 'canonical_payer_policy_fee_payer_signer';
    sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
    sponsorAuthorityGain: 'none';
    servicePayerMayControlToken: false;
    servicePayerMayControlMetadata: false;
    servicePayerMayControlProgram: false;
    servicePayerMayControlGovernanceAuthority: false;
    mintFreezeUpdateAuthoritySource: 'asset_authority_policy_required';
    restrictedMintOperation: 'governance_weight_no_real_asset_requires_separate_resource_authority'
      | 'not_present_current_provider_action';
    currentActionAssetOutflow: 'zero_outflow_current_vertical';
    rawInstructionAutoExecutionAllowed: false;
    longLivedUniversalKeyAllowed: false;
    materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case';
    costReadback: {
      unit: 'lamports';
      totalSpendLamports: number;
      totalDirectRentLamports: number | null;
      refund: 'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition';
    };
  } | null;
  providerCostControlBoundary: {
    authority: 'canonical_payer_policy_cost_control_and_provider_receipt';
    payerPolicyId: string;
    payerPolicyDigest: string;
    preflightId: string;
    attemptKey: string;
    scope: {
      homeIdentityBindingId: string | null;
      circleRef: string | null;
      actorPubkey: string | null;
      actionType: string;
      network: string;
      resourceBindingId: string | null;
      actionScopeDigest: string;
    };
    timeWindow: {
      scope: string;
      effectiveFrom: string | null;
      expiresAt: string | null;
      checkedAt: string | null;
    };
    limits: {
      unit: 'lamports';
      singleTransactionLamports: string;
      periodLamports: string;
      maximumWalletBalanceLamports: string | null;
    };
    balance: {
      authority: 'provider_receipt_final_balance';
      finalBalanceLamports: number;
      state: 'within_configured_balance_limit' | 'no_maximum_wallet_balance_configured';
    };
    rateLimit: {
      authority: 'invocation_attempt_key_and_payer_policy_period';
      duplicateAttemptKeyScopedToInvocation: true;
      actionWindowScope: string;
    };
    alerts: {
      spendWithinSingleLimit: true;
      spendWithinPeriodLimit: true;
      finalBalanceWithinConfiguredMaximum: true | 'not_configured';
    };
    sponsorReceipt: {
      authority: 'provider_cost_control_sponsor_receipt';
      receiptDigest: string;
      sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
      sponsorRef: string | null;
      economicBearer: string;
      feePayerSignerRefExposed: false;
      refund: 'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition';
      generatedFrom: 'payer_policy_cost_preflight_and_provider_receipt';
    };
  } | null;
  assetAuthoritySponsorBoundary: {
    authority: 'canonical_asset_authority_policy_sponsor_separation';
    payerPolicyId: string;
    payerPolicyDigest: string;
    economicBearer: string;
    sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
    sponsorReceiptDigest: string;
    assetAuthority: {
      ownerIssuerMintFreezeUpdateSource: 'asset_authority_policy_required';
      currentActionAssetOutflow: 'zero_outflow_current_vertical';
      restrictedMintOperation: 'governance_weight_no_real_asset_requires_separate_resource_authority'
        | 'not_present_current_provider_action';
      materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case';
    };
    sponsorSeparation: {
      sponsorMayPayFees: true;
      sponsorAuthorityGain: 'none';
      feePayerSignerRefExposed: false;
      sponsorMayControlToken: false;
      sponsorMayControlMetadata: false;
      sponsorMayControlProgram: false;
      sponsorMayControlGovernanceAuthority: false;
      longLivedUniversalKeyAllowed: false;
    };
    actionSafety: {
      providerModule: 'realms_provider_binding' | 'squads_provider_binding';
      reviewedAdapter: 'realms_provider_binding' | 'squads_provider_binding';
      actionCount: number;
      assetConservation: 'zero_outflow_current_vertical';
      maxOutflowLamports: 0;
      opaqueInstructionsAllowed: false;
      rawInstructionAutoExecutionAllowed: false;
    };
    linkage: {
      actionScopeDigest: string;
      resourceBindingId: string | null;
      decisionDigest: string;
      actionIntentDigest: string;
    };
  } | null;
  attemptOwner: {
    preflightId: string;
    payerPolicyId: string;
    actionIntentDigest: string;
    transactionAttemptDigest: string;
    status: 'consumed';
    requestId: string;
    decisionDigest: string;
  } | null;
  retryBoundary: {
    actionIntentDigest: string;
    terminalTransactionAttemptDigest: string;
    actionSetDigest: string;
    sameIntentRetry: {
      allowedChanges: ['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'];
      requiresSameActionIntentDigest: true;
      requiresSameActionSetDigest: true;
      authoritativeExpiryRequired: true;
    };
    materialChangesRequire: 'new_decision_stage_or_superseding_case';
    materialChanges: string[];
    automaticMaterialMutationAllowed: false;
  } | null;
  humanReadableActions: Array<{
    operation: string;
    summary: string;
    programScope: string[];
    accountScope: Array<{ role: string; ref: string }>;
    assetChange: 'governance_weight_supply_created_no_real_asset'
      | 'governance_weight_deposited_no_real_asset'
      | 'zero_lamport_self_transfer_no_real_asset'
      | 'none_no_real_assets';
    simulation: 'required_passed_before_provider_signature' | 'passed';
    enforcement: 'provider_onchain' | 'multisig_threshold';
    opaqueInstructions: false;
    manifestDigest: string;
  }> | null;
  actionContexts: Array<{
    stepId: string;
    order: number;
    dependsOnStepIds: string[];
    atomicGroupId: string;
    atomicity: 'single_provider_transaction';
    expectedStateChange: string;
    idempotencyKey: string;
    deadline: { kind: 'last_valid_block_height'; value: number };
    aggregateRule: 'all_ordered_steps_finalized';
  }> | null;
  expiredAttempts: Array<{
    stepId: string;
    manifestDigest: string;
    messageDigest: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
    expiredAtBlockHeight: number;
    disposition: 'authoritative_expiry_same_intent_manual_retry';
  }> | null;
  preSignStatePreconditions: Array<{
    stepId: 'set_governance_delegate' | 'revoke_governance_delegate';
    actionIntentDigest: string;
    planDigest: string;
    manifestDigest: string;
    messageDigest: string;
    expectedDelegate: string | null;
    observedSlot: number;
    providerStateDigest: string;
    feePayerBalanceLamports: number;
    canonicalOwnerState: {
      resourceBindingId: string;
      authorityBindingId: string;
      payerPolicyId: string;
      emergencyFreeze: 'not_configured_p05_gate' | 'clear_fresh_p05_authority_health';
      stateDigest: string;
    };
    instructionSafety: {
      programIds: string[];
      instructionCount: 1;
      transactionSignerCount: 2;
      writableAccountRefs: string[];
      accountPrivilegeCheck: 'exact_spl_governance_set_delegate_accounts';
      assetOutflowLamports: 0;
      opaqueInstructions: false;
      simulation: 'passed';
      digest: string;
    };
    digest: string;
  }> | null;
  sources: {
    rpc: {
      state: 'synced' | 'failed' | 'conflict' | 'revalidation_required';
      observedSlot: number | null;
      lastSyncedAt: string | null;
      lastAttemptAt: string | null;
      failure: string | null;
    };
    indexer: {
      state: 'synced' | 'behind' | 'failed' | 'not_configured' | 'unavailable';
      programId: string;
      indexedSlot: number | null;
      providerObservedSlot: number | null;
      lagSlots: number | null;
      lastSyncedAt: string | null;
      lastProgressAt: string | null;
      failure: string | null;
    };
    webhook: {
      state: 'not_applicable';
      reason: 'provider_uses_rpc_account_graph_readback';
    };
  } | null;
}

export interface GovernanceProviderIndexerObservation {
  loadState: 'loaded' | 'unavailable';
  programId: string;
  checkpoint: {
    lastProcessedSlot: number;
    lastSuccessfulSync: Date | string;
    syncErrorsCount: number;
  } | null;
  runtime: {
    phase: string;
    currentSlot: number | null;
    lastProgressAt: Date | string;
    lastError: string | null;
  } | null;
  unresolvedFailure: {
    slot: number;
    lastFailedAt: Date | string;
    lastError: string | null;
  } | null;
}

type Responsibility = {
  kind?: unknown;
  assigneePubkey?: unknown;
  status?: unknown;
  deadlineAt?: unknown;
};

function sameActor(value: unknown, actorPubkey: string): boolean {
  return typeof value === 'string' && value.trim() === actorPubkey;
}

function dateTime(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function acceptedDecisionExecutionContract(
  governanceCase: any,
): AcceptedDecisionExecutionContract {
  const request = governanceCase?.primaryRequest;
  return classifyAcceptedDecisionExecutionContract({
    decision: request?.decision?.decision,
    decisionRequestId: request?.id,
    decisionDigest: request?.decision?.decisionDigest,
    artifacts: governanceCase?.decisionOutputArtifacts,
  });
}

export function projectGovernanceManualExecutionControlReadback(
  governanceCase: any,
  providerExecution: any,
): GovernanceManualExecutionControlReadback | null {
  if (governanceCase?.primaryRequest?.decision?.decision !== 'accepted') return null;
  const executionContract = acceptedDecisionExecutionContract(governanceCase);
  if (executionContract === 'internal' || executionContract === 'no_op') return null;
  if (
    governanceCase?.primaryRequest?.executionMode === 'stage_decision_only'
    && executionContract === 'unavailable'
  ) return null;
  const responsibilities = Array.isArray(governanceCase?.responsibilities)
    ? governanceCase.responsibilities
    : [];
  const executionResponsibility = responsibilities.find((item: any) => (
    item?.kind === 'execution'
  )) ?? null;
  const outcomeResponsibility = responsibilities.find((item: any) => (
    item?.kind === 'outcome'
  )) ?? null;
  if (!executionResponsibility && !providerExecution) return null;
  const executionStatus = ['assigned', 'accepted'].includes(executionResponsibility?.status)
    ? executionResponsibility.status as 'assigned' | 'accepted'
    : null;
  const outcomeStatus = ['assigned', 'accepted'].includes(outcomeResponsibility?.status)
    ? outcomeResponsibility.status as 'assigned' | 'accepted'
    : null;
  const deadlineAt = dateTime(executionResponsibility?.deadlineAt);
  const assigneePubkey = optionalText(executionResponsibility?.assigneePubkey);
  const reviewerPubkey = optionalText(outcomeResponsibility?.assigneePubkey);
  const stageAssignee = assigneePubkey && executionStatus && deadlineAt
    ? {
        pubkey: assigneePubkey,
        responsibilityStatus: executionStatus,
        deadlineAt,
      }
    : null;
  const reviewer = reviewerPubkey && outcomeStatus
    ? {
        pubkey: reviewerPubkey,
        responsibilityStatus: outcomeStatus,
        kind: 'outcome' as const,
      }
    : null;
  const manual = governanceCase?.manualExecutionCompletion;
  const manualMode = executionContract === 'manual';
  const manualEvidence = Array.isArray(manual?.evidence) ? manual.evidence : [];
  const manualStatus = ['submitted', 'rejected', 'approved'].includes(manual?.status)
    ? manual.status as 'submitted' | 'rejected' | 'approved'
    : null;
  const manualSubmittedAt = dateTime(manual?.submittedAt);
  const manualReviewedAt = dateTime(manual?.reviewedAt);
  const manualEvidenceDigest = optionalText(manual?.evidenceDigest);
  const manualEvidenceIntegrity = manualEvidence.length > 0
    && manualEvidenceDigest === hashCanonicalGovernanceValue(
      'alcheme.governance.manual-execution-completion-evidence',
      manualEvidence,
    );
  const manualSubmission = manualStatus
    && Number.isInteger(manual?.version)
    && manual.version > 0
    && /^[a-f0-9]{64}$/.test(String(manualEvidenceDigest ?? ''))
    && manualEvidenceIntegrity
    && manualSubmittedAt
    && (
      (manualStatus === 'submitted'
        && manualReviewedAt === null
        && manual?.receiptId == null)
      || (manualStatus === 'rejected'
        && manualReviewedAt !== null
        && optionalText(manual?.reviewReason) !== null
        && manual?.receiptId == null)
      || (manualStatus === 'approved'
        && manualReviewedAt !== null
        && optionalText(manual?.receiptId) !== null)
    )
    ? {
        status: manualStatus,
        version: manual.version,
        evidenceDigest: String(manualEvidenceDigest),
        evidenceCount: manualEvidence.length,
        submittedAt: manualSubmittedAt,
        reviewedAt: manualReviewedAt,
        reviewReason: optionalText(manual?.reviewReason),
        receiptId: optionalText(manual?.receiptId),
      }
    : null;
  const receiptId = optionalText(providerExecution?.receiptId);
  const evidenceDigest = optionalText(providerExecution?.evidenceDigest);
  const observedSlot = Number(
    providerExecution?.reconciliation?.observedSlot ?? providerExecution?.provider?.observedSlot,
  );
  const executedAt = dateTime(providerExecution?.executedAt);
  const completionEvidence = providerExecution?.status === 'executed'
    && providerExecution?.integrity === 'verified'
    && providerExecution?.provider?.finality === 'finalized'
    && providerExecution?.reconciliation?.state === 'verified'
    && receiptId
    && /^[a-f0-9]{64}$/.test(String(evidenceDigest ?? ''))
    && Number.isSafeInteger(observedSlot)
    && observedSlot > 0
    && executedAt
    ? {
        receiptId,
        evidenceDigest: String(evidenceDigest),
        providerFinality: 'finalized' as const,
        observedSlot,
        executedAt,
      }
    : null;
  const blockers: string[] = [];
  if (!stageAssignee) blockers.push('execution_stage_assignee_and_deadline_required');
  else if (stageAssignee.responsibilityStatus !== 'accepted') {
    blockers.push('execution_stage_assignee_acceptance_required');
  }
  if (!reviewer) blockers.push('outcome_reviewer_required');
  else if (reviewer.responsibilityStatus !== 'accepted') {
    blockers.push('outcome_reviewer_acceptance_required');
  }
  if (manualMode && manual) {
    if (!manualSubmission) blockers.push('manual_execution_submission_integrity_invalid');
    if (
      manual.assigneePubkey !== stageAssignee?.pubkey
      || manual.assigneeResponsibilityVersion !== executionResponsibility?.version
      || manual.reviewerPubkey !== reviewer?.pubkey
      || manual.reviewerResponsibilityVersion !== outcomeResponsibility?.version
    ) {
      blockers.push('manual_execution_responsibility_drift');
    }
    if (
      manualStatus === 'approved'
      && (
        manual?.receipt?.id !== manual?.receiptId
        || manual?.receipt?.executionStatus !== 'executed'
        || manual?.receipt?.executorModule !== 'manual_case_execution'
        || manual?.receipt?.executionRef !== manualEvidenceDigest
        || manual?.receipt?.decisionDigest !== governanceCase?.primaryRequest?.decision?.decisionDigest
      )
    ) {
      blockers.push('manual_execution_terminal_receipt_invalid');
    }
  }
  const state = blockers.length > 0
    ? 'blocked' as const
    : manualMode
      ? manualStatus === 'approved'
        ? 'approved_receipt_recorded' as const
        : manualStatus === 'submitted'
          ? 'submitted_awaiting_review' as const
          : manualStatus === 'rejected'
            ? 'rejected_resubmission_required' as const
            : 'submission_required' as const
      : completionEvidence
        ? 'receipt_recorded_awaiting_review' as const
        : 'awaiting_provider_receipt' as const;
  return {
    schemaVersion: 1,
    authority: 'canonical_case_responsibility_and_provider_receipt',
    state,
    stageAssignee,
    reviewer,
    completionEvidence,
    manualSubmission,
    completionSource: manualMode
      ? 'controlled_manual_submission_and_review'
      : 'canonical_provider_receipt_only',
    assignmentGrantsSignerAuthority: false,
    directMarkExecutedAllowed: false,
    reviewerActionRequiredAfterReceipt: !manualMode,
    blockers,
  };
}

function projectGovernanceCaseInboxProviderRecovery(
  providerExecution: any,
): GovernanceCaseInboxProviderRecovery | null {
  const recovery = providerExecution?.recovery;
  const pairs = new Map<GovernanceCaseInboxProviderRecovery['category'], GovernanceCaseInboxProviderRecovery['action']>([
    ['provider_backoff', 'wait_for_persisted_retry_window'],
    ['funding_blocked', 'open_funding_amendment_or_restore_existing_payer'],
    ['simulation_failed', 'repair_preflight_or_open_superseding_case'],
    ['submission_rejected', 'inspect_rejection_then_repair_or_open_superseding_case'],
    ['finality_ambiguous', 'authoritative_readback_before_any_resend'],
    ['blockhash_expired', 'prepare_same_request_rebuild_after_authoritative_expiry'],
    ['provider_state_conflict', 'independent_reconciliation_required'],
    ['provider_outage', 'restore_readback_then_reconcile_same_receipt'],
    ['manual_review', 'inspect_existing_attempt_without_resend'],
  ]);
  const category = String(recovery?.category ?? '') as GovernanceCaseInboxProviderRecovery['category'];
  const nextEligibleAt = dateTime(recovery?.nextEligibleAt);
  if (
    !pairs.has(category)
    || recovery?.action !== pairs.get(category)
    || recovery?.automaticMutation !== false
    || recovery?.authorityChangeAllowed !== false
    || recovery?.payerChangeAllowed !== false
    || recovery?.acceptedDecisionPreserved !== true
    || recovery?.decisionMutationAllowed !== false
    || !['same_request_only', 'blocked_until_recovery_fact'].includes(String(recovery?.retryMode))
    || (recovery?.nextEligibleAt !== null && nextEligibleAt === null)
  ) return null;
  return {
    category,
    action: recovery.action,
    automaticMutation: false,
    authorityChangeAllowed: false,
    payerChangeAllowed: false,
    acceptedDecisionPreserved: true,
    decisionMutationAllowed: false,
    retryMode: recovery.retryMode,
    nextEligibleAt,
  };
}

export function projectGovernanceCaseInboxProviderHealth(
  providerExecution: any,
  indexerObservation: GovernanceProviderIndexerObservation | null = null,
): GovernanceCaseInboxProviderHealth | null {
  if (!providerExecution || providerExecution.integrity !== 'verified') return null;
  const provider = providerExecution.provider;
  const reconciliation = providerExecution.reconciliation;
  const canonicalProfileRevalidation = reconciliation?.profileRevalidation;
  const authoritativeRevalidation = reconciliation?.authority === 'frozen_provider_trust_profile'
    && reconciliation?.state === 'hold'
    && reconciliation?.blocker === 'provider_profile_revalidation_required'
    && canonicalProfileRevalidation?.integrity === 'verified'
    && canonicalProfileRevalidation?.state === 'revalidation_required'
    && canonicalProfileRevalidation?.executionDisposition === 'blocked';
  if (
    !provider
    || !reconciliation
    || (
      reconciliation.authority !== 'independent_provider_readback'
      && !authoritativeRevalidation
    )
  ) {
    return null;
  }
  const reconciliationState = String(reconciliation.state ?? '');
  const executionStatus = String(providerExecution.status ?? '');
  const status = reconciliationState === 'verified' && executionStatus === 'executed'
    ? 'healthy'
    : reconciliationState === 'hold' || executionStatus === 'held'
      ? 'held'
      : 'degraded';
  const observedSlot = Number(reconciliation.observedSlot ?? provider.observedSlot);
  const currentProfileReadback = provider.profileRevalidation;
  const profileDigest = currentProfileReadback?.state === 'verified_current'
    && /^[a-f0-9]{64}$/.test(String(currentProfileReadback.profileDigest ?? ''))
    ? String(currentProfileReadback.profileDigest)
    : null;
  const providerIncident = reconciliation.providerIncident;
  const incidentOccurredAt = dateTime(providerIncident?.occurredAt);
  const incident = providerIncident
    && providerIncident.authority === 'independent_provider_readback'
    && ['suspected', 'confirmed', 'contained', 'reconciled']
      .includes(String(providerIncident.lifecycleState))
    && /^[a-f0-9]{64}$/.test(String(providerIncident.incidentId ?? ''))
    && /^[a-f0-9]{64}$/.test(String(providerIncident.eventDigest ?? ''))
    && incidentOccurredAt
    ? {
        id: String(providerIncident.incidentId),
        state: providerIncident.lifecycleState as 'suspected' | 'confirmed' | 'contained' | 'reconciled',
        occurredAt: incidentOccurredAt,
        evidenceDigest: String(providerIncident.eventDigest),
        pendingExecution: providerIncident.lifecycleState === 'reconciled'
          ? 'eligible_after_reconciliation' as const
          : 'blocked' as const,
        originalDecisionAndReceipt: 'preserved' as const,
      }
    : null;
  const revalidationTarget = canonicalProfileRevalidation?.target;
  const revalidationCurrent = canonicalProfileRevalidation?.current;
  const revalidation = authoritativeRevalidation
    && Array.isArray(canonicalProfileRevalidation?.triggers)
    && canonicalProfileRevalidation.triggers.length > 0
    && typeof revalidationCurrent?.profileRef === 'string'
    && Number.isSafeInteger(revalidationCurrent?.profileVersion)
    && typeof revalidationTarget?.profileRef === 'string'
    && Number.isSafeInteger(revalidationTarget?.profileVersion)
    && /^[a-f0-9]{64}$/.test(String(revalidationTarget?.profileDigest ?? ''))
    && canonicalProfileRevalidation.transitionPolicy === 'governed_transition_plan_pin_suspend_reopen'
    ? {
        triggers: canonicalProfileRevalidation.triggers.map(String),
        currentProfileRef: revalidationCurrent.profileRef,
        currentProfileVersion: String(revalidationCurrent.profileVersion),
        targetProfileRef: revalidationTarget.profileRef,
        targetProfileVersion: String(revalidationTarget.profileVersion),
        targetProfileDigest: revalidationTarget.profileDigest,
        transitionPolicy: 'governed_transition_plan_pin_suspend_reopen' as const,
      }
    : null;
  const blocker = optionalText(reconciliation.blocker ?? providerExecution.blocker);
  const lastAttemptAt = dateTime(reconciliation.observedAt ?? providerExecution.executedAt);
  const syncState = authoritativeRevalidation
    ? 'revalidation_required'
    : reconciliationState === 'verified'
      ? 'synced'
      : blocker === 'provider_readback_conflict'
        ? 'conflict'
        : 'failed';
  const lastSyncedAt = syncState === 'synced'
    ? lastAttemptAt
    : dateTime(providerIncident?.lastReconciledAt);
  const trustProfile = provider.trustProfile;
  const deploymentObservedSlot = Number(trustProfile?.deploymentObservedSlot);
  const deploymentObservedAt = dateTime(trustProfile?.deploymentObservedAt);
  const projectedAuthorities = Array.isArray(provider.executionAuthorities)
    ? provider.executionAuthorities.map((authority: any) => {
        const verifiedSlot = Number(authority?.verifiedSlot);
        const allowedOperations = Array.isArray(authority?.allowedOperations)
          ? authority.allowedOperations.map(String).filter(Boolean)
          : [];
        if (
          !optionalText(authority?.role)
          || (authority?.publicAuthority !== null && !optionalText(authority?.publicAuthority))
          || !optionalText(authority?.custodyProvider)
          || !optionalText(authority?.custodyStatus)
          || allowedOperations.length === 0
          || !Number.isSafeInteger(verifiedSlot)
          || verifiedSlot <= 0
          || !optionalText(authority?.status)
          || (authority?.sourceRequestId !== null && !optionalText(authority?.sourceRequestId))
          || (authority?.sourceDecisionDigest !== null
            && !/^[a-f0-9]{64}$/.test(String(authority.sourceDecisionDigest)))
        ) return null;
        return {
          role: String(authority.role),
          publicAuthority: optionalText(authority.publicAuthority),
          custodyProvider: String(authority.custodyProvider),
          custodyStatus: String(authority.custodyStatus),
          allowedOperations,
          verifiedSlot,
          status: String(authority.status),
          sourceRequestId: optionalText(authority.sourceRequestId),
          sourceDecisionDigest: authority.sourceDecisionDigest === null
            ? null
            : String(authority.sourceDecisionDigest),
        };
      })
    : [];
  const authorities = projectedAuthorities.length > 0
    && projectedAuthorities.every((authority: unknown) => authority !== null)
    ? projectedAuthorities as NonNullable<GovernanceCaseInboxProviderHealth['authorities']>
    : null;
  const rawResourceLifecycle = provider?.providerResourceLifecycle;
  const resourceLifecyclePhases = Array.isArray(rawResourceLifecycle?.phases)
    ? rawResourceLifecycle.phases
    : [];
  const expectedResourceLifecyclePhases = [
    'created',
    'bootstrap_verified',
    'authority_transferred',
    'old_authority_revoked',
    'readback_verified',
    'available',
  ];
  const providerResourceLifecycle = rawResourceLifecycle?.schemaVersion === 1
    && rawResourceLifecycle.authority
      === 'provider_receipt_resource_binding_authority_binding_and_independent_readback'
    && rawResourceLifecycle.state === 'available'
    && rawResourceLifecycle.providerModule === provider.module
    && optionalText(rawResourceLifecycle.resourceBindingId)
    && rawResourceLifecycle.resourceRef === provider.resourceRef
    && rawResourceLifecycle.ownerProgramRef === provider.ownerProgramRef
    && optionalText(rawResourceLifecycle.sourceRequestId)
    && /^[a-f0-9]{64}$/.test(String(rawResourceLifecycle.sourceDecisionDigest ?? ''))
    && Number(rawResourceLifecycle.observedSlot) === Number(provider.observedSlot)
    && rawResourceLifecycle.lastTransactionSlot === provider.lastTransactionSlot
    && rawResourceLifecycle.stateDigest === provider.stateDigest
    && resourceLifecyclePhases.length === expectedResourceLifecyclePhases.length
    && resourceLifecyclePhases.every((phase: any, index: number) => (
      phase?.phase === expectedResourceLifecyclePhases[index]
      && optionalText(phase?.authority)
      && optionalText(phase?.evidenceRef)
    ))
    && rawResourceLifecycle.permissionResidue?.fallbackAuthority === 'none'
    && rawResourceLifecycle.permissionResidue?.temporaryWalletAuthority === 'revoked_or_not_retained'
    && rawResourceLifecycle.permissionResidue?.serviceKeyAuthority === 'not_retained'
    && rawResourceLifecycle.permissionResidue?.signerKeyExposure === 'none_public_authority_only'
    ? {
        state: 'available' as const,
        resourceBindingId: String(rawResourceLifecycle.resourceBindingId),
        sourceRequestId: String(rawResourceLifecycle.sourceRequestId),
        sourceDecisionDigest: String(rawResourceLifecycle.sourceDecisionDigest),
        phases: resourceLifecyclePhases.map((phase: any, index: number) => ({
          phase: expectedResourceLifecyclePhases[index] as
            NonNullable<GovernanceCaseInboxProviderHealth['providerResourceLifecycle']>['phases'][number]['phase'],
          authority: String(phase.authority),
          evidenceRef: String(phase.evidenceRef),
        })),
        permissionResidue: {
          fallbackAuthority: 'none' as const,
          temporaryWalletAuthority: 'revoked_or_not_retained' as const,
          serviceKeyAuthority: 'not_retained' as const,
          signerKeyExposure: 'none_public_authority_only' as const,
        },
      }
    : null;
  const rawAuthorityPaymentBoundary = provider?.authorityPaymentBoundary;
  const executionAuthorityRoles = Array.isArray(rawAuthorityPaymentBoundary?.executionAuthorityRoles)
    ? rawAuthorityPaymentBoundary.executionAuthorityRoles.map(String)
    : [];
  const executionCustodyProviders = Array.isArray(
    rawAuthorityPaymentBoundary?.executionCustodyProviders,
  ) ? rawAuthorityPaymentBoundary.executionCustodyProviders.map(String) : [];
  const authorityPaymentBoundary = rawAuthorityPaymentBoundary?.schemaVersion === 1
    && rawAuthorityPaymentBoundary.authority === 'canonical_resource_authority_and_payer_policy'
    && optionalText(rawAuthorityPaymentBoundary.payerPolicyId)
    && optionalText(rawAuthorityPaymentBoundary.economicBearer)
    && rawAuthorityPaymentBoundary.feePayerRole === 'fee_payer_only'
    && ['explicit_relayer_from_payer_policy', 'not_configured']
      .includes(String(rawAuthorityPaymentBoundary.sponsorRole))
    && optionalText(rawAuthorityPaymentBoundary.feePayerCustodyProvider)
    && executionAuthorityRoles.length > 0
    && executionAuthorityRoles.every((role: string) => optionalText(role))
    && executionCustodyProviders.length > 0
    && executionCustodyProviders.every((providerName: string) => optionalText(providerName))
    && rawAuthorityPaymentBoundary.separation
      === 'verified_distinct_public_keys_and_key_refs'
    && rawAuthorityPaymentBoundary.sponsorAuthorityGain === 'none'
    && rawAuthorityPaymentBoundary.privateKeyExposure === 'none_public_readback_only'
    ? {
        payerPolicyId: String(rawAuthorityPaymentBoundary.payerPolicyId),
        economicBearer: String(rawAuthorityPaymentBoundary.economicBearer),
        feePayerRole: 'fee_payer_only' as const,
        sponsorRole: rawAuthorityPaymentBoundary.sponsorRole as
          'explicit_relayer_from_payer_policy' | 'not_configured',
        feePayerCustodyProvider: String(rawAuthorityPaymentBoundary.feePayerCustodyProvider),
        executionAuthorityRoles,
        executionCustodyProviders,
        separation: 'verified_distinct_public_keys_and_key_refs' as const,
        sponsorAuthorityGain: 'none' as const,
        privateKeyExposure: 'none_public_readback_only' as const,
      }
    : null;
  const rawMandateCost = provider?.mandateCostPolicy;
  const mandateCostClasses = Array.isArray(rawMandateCost?.costClasses)
    ? rawMandateCost.costClasses.flatMap((item: any) => {
        if (
          !['decision', 'review', 'operational', 'appeal', 'execution']
            .includes(String(item?.costClass))
          || !['no_fee', 'capped_external_quote'].includes(String(item?.mode))
          || !['delegator', 'delegate', 'shared'].includes(String(item?.economicBearer))
          || (item?.maximumAmountMinor !== null && !optionalText(item?.maximumAmountMinor))
          || (item?.unit !== null && !optionalText(item?.unit))
        ) return [];
        return [{
          costClass: item.costClass as 'decision' | 'review' | 'operational' | 'appeal' | 'execution',
          mode: item.mode as 'no_fee' | 'capped_external_quote',
          economicBearer: item.economicBearer as 'delegator' | 'delegate' | 'shared',
          maximumAmountMinor: item.maximumAmountMinor === null
            ? null
            : String(item.maximumAmountMinor),
          unit: item.unit === null ? null : String(item.unit),
        }];
      })
    : [];
  const rawMandateSpecialBudget = rawMandateCost?.specialBudget;
  const expectedMandateCostClasses = ['decision', 'review', 'operational', 'appeal', 'execution'];
  const mandateCostPolicy = rawMandateCost?.schemaVersion === 1
    && rawMandateCost?.authority === 'frozen_governance_mandate_version_fee_policy'
    && optionalText(rawMandateCost?.mandateId)
    && Number.isSafeInteger(Number(rawMandateCost?.mandateVersion))
    && Number(rawMandateCost.mandateVersion) > 0
    && /^[a-f0-9]{64}$/.test(String(rawMandateCost?.mandateTermsDigest ?? ''))
    && rawMandateCost?.policySource === 'GovernanceMandateVersion.terms.feePolicy'
    && mandateCostClasses.length === expectedMandateCostClasses.length
    && expectedMandateCostClasses.every((costClass) => (
      mandateCostClasses.filter((item: { costClass: string }) => (
        item.costClass === costClass
      )).length === 1
    ))
    && rawMandateSpecialBudget?.mode === 'not_managed_by_mandate'
    && (rawMandateSpecialBudget.maximumAmountMinor === null
      || optionalText(rawMandateSpecialBudget.maximumAmountMinor))
    && (rawMandateSpecialBudget.unit === null || optionalText(rawMandateSpecialBudget.unit))
    && rawMandateCost?.payerAuthority === 'separate_from_governance_authority'
    && rawMandateCost?.payerAuthoritySeparatedFromDecisionAuthority === true
    && rawMandateCost?.silentTransferToVoterOperatorExecutorAllowed === false
    && rawMandateCost?.executionCostBearer === 'same_as_mandate_fee_policy'
    ? {
        mandateId: String(rawMandateCost.mandateId),
        mandateVersion: Number(rawMandateCost.mandateVersion),
        mandateTermsDigest: String(rawMandateCost.mandateTermsDigest),
        policySource: 'GovernanceMandateVersion.terms.feePolicy' as const,
        costClasses: mandateCostClasses,
        specialBudget: {
          mode: 'not_managed_by_mandate' as const,
          maximumAmountMinor: rawMandateSpecialBudget.maximumAmountMinor === null
            ? null
            : String(rawMandateSpecialBudget.maximumAmountMinor),
          unit: rawMandateSpecialBudget.unit === null
            ? null
            : String(rawMandateSpecialBudget.unit),
        },
        payerAuthority: 'separate_from_governance_authority' as const,
        payerAuthoritySeparatedFromDecisionAuthority: true as const,
        silentTransferToVoterOperatorExecutorAllowed: false as const,
        executionCostBearer: 'same_as_mandate_fee_policy' as const,
      }
    : null;
  const rawFundingFeePayer = provider?.fundingSourceFeePayerBoundary;
  const fundingSourceFeePayerBoundary = rawFundingFeePayer?.schemaVersion === 1
    && rawFundingFeePayer?.authority === 'canonical_payer_policy_resource_or_vault_separation'
    && optionalText(rawFundingFeePayer?.payerPolicyId)
    && ['governed_resource_account', 'squads_vault']
      .includes(String(rawFundingFeePayer?.fundingSourceRole))
    && optionalText(rawFundingFeePayer?.fundingSourceRef)
    && rawFundingFeePayer?.feePayerRole === 'separated_fee_payer_policy'
    && rawFundingFeePayer?.actualFeePayer === 'canonical_payer_policy_fee_payer_signer'
    && rawFundingFeePayer?.feePayerSignerRefExposed === false
    && rawFundingFeePayer?.fundingSourceMaySignFees === false
    && ['explicit_relayer_sponsor', 'governed_reimbursement_policy', 'governance_approved_payer_policy']
      .includes(String(rawFundingFeePayer?.approvedPaymentPath))
    && ['explicit_relayer_from_payer_policy', 'not_configured']
      .includes(String(rawFundingFeePayer?.sponsorRole))
    && ['governed_reimbursement_policy_configured', 'not_configured']
      .includes(String(rawFundingFeePayer?.reimbursementPolicy))
    && (rawFundingFeePayer?.reimbursementPolicyRef === null
      || optionalText(rawFundingFeePayer?.reimbursementPolicyRef))
    && rawFundingFeePayer?.executorCashFlowResponsibility === 'forbidden'
    && rawFundingFeePayer?.silentExecutorCostTransferAllowed === false
    && optionalText(rawFundingFeePayer?.economicBearer)
    ? {
        payerPolicyId: String(rawFundingFeePayer.payerPolicyId),
        fundingSourceRole: rawFundingFeePayer.fundingSourceRole as
          'governed_resource_account' | 'squads_vault',
        fundingSourceRef: String(rawFundingFeePayer.fundingSourceRef),
        feePayerRole: 'separated_fee_payer_policy' as const,
        actualFeePayer: 'canonical_payer_policy_fee_payer_signer' as const,
        feePayerSignerRefExposed: false as const,
        fundingSourceMaySignFees: false as const,
        approvedPaymentPath: rawFundingFeePayer.approvedPaymentPath as
          | 'explicit_relayer_sponsor'
          | 'governed_reimbursement_policy'
          | 'governance_approved_payer_policy',
        sponsorRole: rawFundingFeePayer.sponsorRole as
          'explicit_relayer_from_payer_policy' | 'not_configured',
        reimbursementPolicy: rawFundingFeePayer.reimbursementPolicy as
          'governed_reimbursement_policy_configured' | 'not_configured',
        reimbursementPolicyRef: rawFundingFeePayer.reimbursementPolicyRef === null
          ? null
          : String(rawFundingFeePayer.reimbursementPolicyRef),
        executorCashFlowResponsibility: 'forbidden' as const,
        silentExecutorCostTransferAllowed: false as const,
        economicBearer: String(rawFundingFeePayer.economicBearer),
      }
    : null;
  const rawEnforcement = provider?.enforcementDisclosure;
  const enforcementMode = rawEnforcement?.mode;
  const enforcementProvider = rawEnforcement?.providerModule;
  const enforcementOperations = Array.isArray(rawEnforcement?.allowedOperations)
    ? rawEnforcement.allowedOperations.map(String).filter(Boolean)
    : [];
  const expectedEnforcementPair = enforcementMode === 'multisig_threshold'
    && enforcementProvider === 'squads_provider_binding'
    && rawEnforcement?.proofScope === 'alcheme_constructed_transaction_matches_accepted_decision'
    && rawEnforcement?.residualBypassRisk
      === 'threshold_signers_can_create_or_execute_transactions_outside_alcheme'
    || enforcementMode === 'provider_onchain'
      && enforcementProvider === 'realms_provider_binding'
      && rawEnforcement?.proofScope
        === 'spl_governance_owner_program_and_transit_signatures_match_accepted_decision'
      && rawEnforcement?.residualBypassRisk
        === 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path';
  const enforcement = rawEnforcement?.schemaVersion === 1
    && expectedEnforcementPair
    && optionalText(rawEnforcement?.resourceRef) === optionalText(provider?.resourceRef)
    && optionalText(rawEnforcement?.ownerProgramRef) === optionalText(provider?.ownerProgramRef)
    && optionalText(rawEnforcement?.decisionLinkage?.requestId)
    && /^[a-f0-9]{64}$/.test(String(rawEnforcement?.decisionLinkage?.decisionDigest ?? ''))
    && enforcementOperations.length > 0
    && new Set(enforcementOperations).size === enforcementOperations.length
    && rawEnforcement?.verificationState === 'verified'
    && Number.isSafeInteger(Number(rawEnforcement?.version))
    && Number(rawEnforcement.version) > 0
    && rawEnforcement?.bypassPrevented === false
    ? {
        schemaVersion: 1 as const,
        mode: enforcementMode as 'provider_onchain' | 'multisig_threshold',
        providerModule: enforcementProvider as 'realms_provider_binding' | 'squads_provider_binding',
        resourceRef: String(rawEnforcement.resourceRef),
        ownerProgramRef: String(rawEnforcement.ownerProgramRef),
        decisionLinkage: {
          requestId: String(rawEnforcement.decisionLinkage.requestId),
          decisionDigest: String(rawEnforcement.decisionLinkage.decisionDigest),
        },
        allowedOperations: enforcementOperations,
        verificationState: 'verified' as const,
        version: Number(rawEnforcement.version),
        proofScope: rawEnforcement.proofScope as GovernanceCaseInboxProviderHealth['enforcement'] extends infer E
          ? E extends { proofScope: infer P } ? P : never
          : never,
        residualBypassRisk: rawEnforcement.residualBypassRisk as GovernanceCaseInboxProviderHealth['enforcement'] extends infer E
          ? E extends { residualBypassRisk: infer R } ? R : never
          : never,
        bypassPrevented: false as const,
      }
    : null;
  const rawCost = provider?.costReconciliation;
  const rawCostTransactions = Array.isArray(rawCost?.transactions)
    ? rawCost.transactions
    : [];
  const costTransactions = rawCostTransactions.flatMap((transaction: any) => {
    const quotedFeeLamports = Number(transaction?.quotedFeeLamports);
    const directRentLamports = transaction?.directRentLamports === null
      ? null
      : Number(transaction?.directRentLamports);
    const actualSpendLamports = Number(transaction?.actualSpendLamports);
    if (
      !optionalText(transaction?.stepId)
      || !Number.isSafeInteger(quotedFeeLamports)
      || quotedFeeLamports < 0
      || (directRentLamports !== null && (
        !Number.isSafeInteger(directRentLamports) || directRentLamports < 0
      ))
      || !Number.isSafeInteger(actualSpendLamports)
      || actualSpendLamports < quotedFeeLamports + (directRentLamports ?? 0)
    ) return [];
    return [{
      stepId: String(transaction.stepId),
      quotedFeeLamports,
      directRentLamports,
      actualSpendLamports,
    }];
  });
  const totalSpendLamports = Number(rawCost?.totalSpendLamports);
  const totalDirectRentLamports = rawCost?.totalDirectRentLamports === null
    ? null
    : Number(rawCost?.totalDirectRentLamports);
  const finalBalanceLamports = Number(rawCost?.finalBalanceLamports);
  const costRent = rawCost?.rent === 'not_applicable_delegation_no_account_creation'
    || rawCost?.rent === 'provider_receipt_direct_rent_itemized'
    || rawCost?.rent === 'included_in_actual_spend_not_itemized'
    ? rawCost.rent
    : null;
  const costRefund = rawCost?.refund === 'not_applicable_no_refund'
    || rawCost?.refund === 'unknown_no_provider_refund_disposition'
    ? rawCost.refund
    : null;
  const costSponsorRole = rawCost?.sponsorRole === 'explicit_relayer_from_payer_policy'
    || rawCost?.sponsorRole === 'not_configured'
    ? rawCost.sponsorRole
    : null;
  const costReconciliation = rawCost?.schemaVersion === 1
    && rawCost?.authority === 'canonical_cost_preflight_and_provider_receipt'
    && optionalText(rawCost?.payerPolicyId)
    && rawCost?.payerRole === 'separated_fee_payer_policy'
    && optionalText(rawCost?.economicBearer)
    && costSponsorRole
    && rawCost?.unit === 'lamports'
    && rawCostTransactions.length > 0
    && costTransactions.length === rawCostTransactions.length
    && Number.isSafeInteger(totalSpendLamports)
    && totalSpendLamports === costTransactions.reduce((sum: number, item: {
      actualSpendLamports: number;
    }) => (
      sum + item.actualSpendLamports
    ), 0)
    && (costRent === 'included_in_actual_spend_not_itemized'
      ? totalDirectRentLamports === null
        && costTransactions.every((item: { directRentLamports: number | null }) => (
          item.directRentLamports === null
        ))
      : Number.isSafeInteger(totalDirectRentLamports)
        && costTransactions.every((item: { directRentLamports: number | null }) => (
          item.directRentLamports !== null
        ))
        && totalDirectRentLamports === costTransactions.reduce((sum: number, item: {
          directRentLamports: number | null;
        }) => (
          sum + (item.directRentLamports ?? 0)
        ), 0))
    && Number.isSafeInteger(finalBalanceLamports)
    && finalBalanceLamports >= 0
    && (rawCost?.fundingSource === 'solana_devnet_faucet'
      || rawCost?.fundingSource === 'existing_finalized_balance')
    && (rawCost?.fundingSignature === null || optionalText(rawCost?.fundingSignature))
    && (rawCost?.fundingSource !== 'solana_devnet_faucet'
      || optionalText(rawCost?.fundingSignature))
    && (rawCost?.fundingSource !== 'existing_finalized_balance'
      || rawCost?.fundingSignature === null)
    && rawCost?.reconciliation === 'transaction_sum_matches_provider_receipt'
    && costRent !== null
    && costRefund !== null
    ? {
        payerPolicyId: String(rawCost.payerPolicyId),
        payerRole: 'separated_fee_payer_policy' as const,
        economicBearer: String(rawCost.economicBearer),
        sponsorRole: costSponsorRole,
        unit: 'lamports' as const,
        transactions: costTransactions,
        totalDirectRentLamports,
        totalSpendLamports,
        finalBalanceLamports,
        fundingSource: rawCost.fundingSource as 'solana_devnet_faucet' | 'existing_finalized_balance',
        fundingSignature: rawCost.fundingSignature === null
          ? null
          : String(rawCost.fundingSignature),
        reconciliation: 'transaction_sum_matches_provider_receipt' as const,
        rent: costRent,
        refund: costRefund,
      }
    : null;
  const rawProviderTransactions = Array.isArray(provider?.transactions)
    ? provider.transactions
    : [];
  const projectedTransactionAttempts = rawProviderTransactions.flatMap((transaction: any) => {
    const attempt = transaction?.attemptContext;
    const quotedFeeLamports = Number(attempt?.quotedFeeLamports);
    if (
      attempt?.schemaVersion !== 1
      || attempt?.authority !== 'canonical_provider_attempt_inventory_and_terminal_receipt'
      || attempt?.persistenceAuthority !== 'canonical_provider_checkpoint_and_payer_policy'
      || !/^[a-f0-9]{64}$/.test(String(attempt?.transactionAttemptDigest ?? ''))
      || !Number.isSafeInteger(Number(attempt?.attemptOrdinal))
      || Number(attempt.attemptOrdinal) <= 0
      || !optionalText(transaction?.stepId)
      || !optionalText(attempt?.recentBlockhash)
      || !Number.isSafeInteger(quotedFeeLamports)
      || quotedFeeLamports < 0
      || attempt?.feePayerRole !== 'separated_fee_payer_policy'
      || !optionalText(attempt?.feePayerPolicyId)
      || attempt?.feePayerBinding !== 'canonical_payer_policy_and_solana_message_header'
      || attempt?.providerReference !== transaction?.signature
      || attempt?.messageDigest !== transaction?.messageDigest
      || attempt?.manifestDigest !== transaction?.manifestDigest
      || attempt?.digestCoverage !== 'message_digest_covers_fee_payer_and_compute_budget_instructions'
      || !Number.isSafeInteger(Number(attempt?.quoteSlot))
      || Number(attempt.quoteSlot) <= 0
      || !dateTime(attempt?.quotedAt)
      || attempt?.quoteSlotState !== 'verified_finalized_provider_quote'
      || attempt?.resimulationTrigger !== 'blockhash_or_quote_expiry_before_any_resign'
      || attempt?.priorityFeeLamports !== 0
      || attempt?.priorityFeeState !== 'verified_zero_current_pinned_provider_constructor'
    ) return [];
    return [{
      stepId: String(transaction.stepId),
      transactionAttemptDigest: String(attempt.transactionAttemptDigest),
      attemptOrdinal: Number(attempt.attemptOrdinal),
      persistenceAuthority: 'canonical_provider_checkpoint_and_payer_policy' as const,
      recentBlockhash: String(attempt.recentBlockhash),
      quotedFeeLamports,
      feePayerRole: 'separated_fee_payer_policy' as const,
      feePayerPolicyId: String(attempt.feePayerPolicyId),
      feePayerBinding: 'canonical_payer_policy_and_solana_message_header' as const,
      providerReference: String(attempt.providerReference),
      messageDigest: String(attempt.messageDigest),
      manifestDigest: String(attempt.manifestDigest),
      digestCoverage: 'message_digest_covers_fee_payer_and_compute_budget_instructions' as const,
      quoteSlot: Number(attempt.quoteSlot),
      quotedAt: String(attempt.quotedAt),
      quoteSlotState: 'verified_finalized_provider_quote' as const,
      resimulationTrigger: 'blockhash_or_quote_expiry_before_any_resign' as const,
      priorityFeeLamports: 0 as const,
      priorityFeeState: 'verified_zero_current_pinned_provider_constructor' as const,
    }];
  });
  const transactionAttempts = rawProviderTransactions.length > 0
    && projectedTransactionAttempts.length === rawProviderTransactions.length
    ? projectedTransactionAttempts
    : null;
  const rawProposalTransactionReadback = provider?.proposalTransactionReadback;
  const rawProposalInstructions = Array.isArray(rawProposalTransactionReadback?.instructions)
    ? rawProposalTransactionReadback.instructions
    : [];
  const proposalTransactionReadback = rawProposalTransactionReadback?.schemaVersion === 1
    && rawProposalTransactionReadback.authority
      === 'provider_receipt_and_independent_finalized_readback'
    && optionalText(rawProposalTransactionReadback.proposalRef)
    && optionalText(rawProposalTransactionReadback.proposalTransactionRef)
    && rawProposalTransactionReadback.commitment === 'finalized'
    && rawProposalTransactionReadback.executionStatus === 'executed'
    && rawProviderTransactions.length > 0
    && rawProposalInstructions.length === rawProviderTransactions.length
    && rawProposalInstructions.every((instruction: any, index: number) => (
      optionalText(instruction?.stepId) === optionalText(rawProviderTransactions[index]?.stepId)
      && /^[a-f0-9]{64}$/.test(String(instruction?.manifestDigest ?? ''))
      && instruction.manifestDigest === rawProviderTransactions[index]?.manifestDigest
      && optionalText(instruction?.summary)
      && Array.isArray(instruction?.programScope)
      && instruction.programScope.length > 0
      && instruction.programScope.every((program: unknown) => optionalText(program))
      && optionalText(instruction?.signature) === optionalText(rawProviderTransactions[index]?.signature)
      && Number.isSafeInteger(Number(instruction?.slot))
      && Number(instruction.slot) > 0
      && Number(instruction.slot) === Number(rawProviderTransactions[index]?.slot)
      && instruction?.commitment === 'finalized'
      && instruction?.executionStatus === 'finalized'
      && instruction?.opaqueInstruction === false
    ))
    ? {
        authority: 'provider_receipt_and_independent_finalized_readback' as const,
        proposalRef: String(rawProposalTransactionReadback.proposalRef),
        proposalTransactionRef: String(rawProposalTransactionReadback.proposalTransactionRef),
        commitment: 'finalized' as const,
        executionStatus: 'executed' as const,
        instructions: rawProposalInstructions.map((instruction: any) => ({
          stepId: String(instruction.stepId),
          manifestDigest: String(instruction.manifestDigest),
          summary: String(instruction.summary),
          programScope: instruction.programScope.map(String),
          signature: String(instruction.signature),
          slot: Number(instruction.slot),
          commitment: 'finalized' as const,
          executionStatus: 'finalized' as const,
          opaqueInstruction: false as const,
        })),
      }
    : null;
  const rawAttemptOwner = provider?.attemptOwner;
  const attemptOwner = rawAttemptOwner?.schemaVersion === 1
    && rawAttemptOwner?.authority === 'canonical_cost_preflight'
    && optionalText(rawAttemptOwner?.preflightId)
    && optionalText(rawAttemptOwner?.payerPolicyId)
    && /^[a-f0-9]{64}$/.test(String(rawAttemptOwner?.actionIntentDigest ?? ''))
    && /^[a-f0-9]{64}$/.test(String(rawAttemptOwner?.transactionAttemptDigest ?? ''))
    && rawAttemptOwner?.status === 'consumed'
    && optionalText(rawAttemptOwner?.requestId)
    && /^[a-f0-9]{64}$/.test(String(rawAttemptOwner?.decisionDigest ?? ''))
    ? {
        preflightId: String(rawAttemptOwner.preflightId),
        payerPolicyId: String(rawAttemptOwner.payerPolicyId),
        actionIntentDigest: String(rawAttemptOwner.actionIntentDigest),
        transactionAttemptDigest: String(rawAttemptOwner.transactionAttemptDigest),
        status: 'consumed' as const,
        requestId: String(rawAttemptOwner.requestId),
        decisionDigest: String(rawAttemptOwner.decisionDigest),
      }
    : null;
  const rawRetryBoundary = provider?.retryBoundary;
  const retryBoundary = rawRetryBoundary?.schemaVersion === 1
    && rawRetryBoundary?.authority === 'canonical_action_intent_and_transaction_attempt'
    && /^[a-f0-9]{64}$/.test(String(rawRetryBoundary?.actionIntentDigest ?? ''))
    && /^[a-f0-9]{64}$/.test(String(rawRetryBoundary?.terminalTransactionAttemptDigest ?? ''))
    && /^[a-f0-9]{64}$/.test(String(rawRetryBoundary?.actionSetDigest ?? ''))
    && JSON.stringify(rawRetryBoundary?.sameIntentRetry?.allowedChanges)
      === JSON.stringify(['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'])
    && rawRetryBoundary?.sameIntentRetry?.requiresSameActionIntentDigest === true
    && rawRetryBoundary?.sameIntentRetry?.requiresSameActionSetDigest === true
    && rawRetryBoundary?.sameIntentRetry?.authoritativeExpiryRequired === true
    && rawRetryBoundary?.materialChangesRequire === 'new_decision_stage_or_superseding_case'
    && Array.isArray(rawRetryBoundary?.materialChanges)
    && rawRetryBoundary.materialChanges.length > 0
    && rawRetryBoundary.materialChanges.every((change: unknown) => optionalText(change))
    && rawRetryBoundary?.automaticMaterialMutationAllowed === false
    ? {
        actionIntentDigest: String(rawRetryBoundary.actionIntentDigest),
        terminalTransactionAttemptDigest: String(rawRetryBoundary.terminalTransactionAttemptDigest),
        actionSetDigest: String(rawRetryBoundary.actionSetDigest),
        sameIntentRetry: {
          allowedChanges: [
            'fresh_blockhash',
            'fee_quote',
            'provider_attempt_reference',
          ] as ['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'],
          requiresSameActionIntentDigest: true as const,
          requiresSameActionSetDigest: true as const,
          authoritativeExpiryRequired: true as const,
        },
        materialChangesRequire: 'new_decision_stage_or_superseding_case' as const,
        materialChanges: rawRetryBoundary.materialChanges.map(String),
        automaticMaterialMutationAllowed: false as const,
      }
    : null;
  const rawExecutionPlan = provider?.executionPlanReadback;
  const rawExecutionActions = Array.isArray(rawExecutionPlan?.actions)
    ? rawExecutionPlan.actions
    : [];
  const rawDuplicatePrevention = rawExecutionPlan?.duplicatePrevention;
  const duplicateActionIdempotencyKeys = Array.isArray(
    rawDuplicatePrevention?.actionIdempotencyKeys,
  ) ? rawDuplicatePrevention.actionIdempotencyKeys : [];
  const duplicateProviderReferences = Array.isArray(rawDuplicatePrevention?.providerReferences)
    ? rawDuplicatePrevention.providerReferences
    : [];
  const executionMode = provider?.module === 'realms_provider_binding' ? 'realms' : 'squads';
  const executionPlanReadback = rawExecutionPlan?.schemaVersion === 1
    && rawExecutionPlan.authority
      === 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt'
    && rawExecutionPlan.outcome === 'provider_execution_plan'
    && rawExecutionPlan.providerModule === provider?.module
    && rawExecutionPlan.executionMode === executionMode
    && optionalText(rawExecutionPlan.requestId)
    && /^[a-f0-9]{64}$/.test(String(rawExecutionPlan.decisionDigest ?? ''))
    && rawExecutionPlan.artifactLinkage?.status
      === 'not_applicable_provider_binding_activation'
    && rawExecutionPlan.artifactLinkage?.artifactRef === null
    && attemptOwner !== null
    && retryBoundary !== null
    && rawExecutionPlan.actionIntentDigest === attemptOwner.actionIntentDigest
    && /^[a-f0-9]{64}$/.test(String(rawExecutionPlan.planDigest ?? ''))
    && rawExecutionPlan.terminalTransactionAttemptDigest
      === attemptOwner.transactionAttemptDigest
    && rawExecutionPlan.actionSetDigest === retryBoundary.actionSetDigest
    && rawExecutionPlan.intentBoundary?.governanceInput === 'canonical_request_payload'
    && rawExecutionPlan.intentBoundary?.providerActions
      === 'verified_provider_plan_and_manifest'
    && JSON.stringify(rawExecutionPlan.intentBoundary?.retryVariantFieldsExcluded)
      === JSON.stringify(['recent_blockhash', 'fee_quote', 'provider_attempt_reference'])
    && rawExecutionPlan.aggregateStatus === 'executed'
    && rawExecutionPlan.aggregateRule === 'all_ordered_steps_finalized'
    && rawDuplicatePrevention?.authority
      === 'canonical_action_intent_attempt_and_authoritative_provider_readback'
    && rawDuplicatePrevention?.state === 'protected_no_duplicate_action_observed'
    && rawDuplicatePrevention?.actionIntentDigest === rawExecutionPlan.actionIntentDigest
    && rawDuplicatePrevention?.terminalTransactionAttemptDigest
      === rawExecutionPlan.terminalTransactionAttemptDigest
    && rawDuplicatePrevention?.actionSetDigest === rawExecutionPlan.actionSetDigest
    && duplicateActionIdempotencyKeys.length === rawExecutionActions.length
    && new Set(duplicateActionIdempotencyKeys).size === rawExecutionActions.length
    && duplicateActionIdempotencyKeys.every((key: unknown) => (
      /^[a-f0-9]{64}$/.test(String(key ?? ''))
    ))
    && duplicateProviderReferences.length === rawExecutionActions.length
    && new Set(duplicateProviderReferences).size === rawExecutionActions.length
    && duplicateProviderReferences.every((reference: unknown) => optionalText(reference))
    && rawDuplicatePrevention?.checks?.uniqueActionIdempotencyKeys === true
    && rawDuplicatePrevention?.checks?.uniqueProviderReferences === true
    && rawDuplicatePrevention?.checks?.everyAttemptFinalized === true
    && rawDuplicatePrevention?.checks?.everyAttemptManifestBound === true
    && rawDuplicatePrevention?.checks?.authoritativeProviderReadback === true
    && rawDuplicatePrevention?.duplicateActionObserved === false
    && rawDuplicatePrevention?.duplicatePaymentObserved
      === 'not_applicable_no_real_asset_current_vertical'
    && rawDuplicatePrevention?.retryBoundary
      === 'same_intent_retry_requires_authoritative_expiry'
    && rawExecutionActions.length > 0
    && rawExecutionActions.length === rawProviderTransactions.length
    && rawExecutionActions.every((action: any, index: number) => {
      const transaction = rawProviderTransactions[index];
      const previousIds = rawExecutionActions.slice(0, index).map((item: any) => item?.actionId);
      const dependencies = Array.isArray(action?.dependsOnActionIds)
        ? action.dependsOnActionIds
        : [];
      const attempts = Array.isArray(action?.attempts) ? action.attempts : [];
      const attempt = attempts[0];
      return action?.actionId === transaction?.stepId
        && action?.order === index + 1
        && action?.executor === executionMode
        && action?.subject?.type === 'governed_resource'
        && action?.subject?.ref === provider?.resourceRef
        && action?.network === provider?.chainId
        && action?.operation === transaction?.stepId
        && optionalText(action?.instructionSemantics)
        && optionalText(action?.humanSummary)
        && Array.isArray(action?.programScope)
        && action.programScope.length > 0
        && action.programScope.every((program: unknown) => optionalText(program))
        && Array.isArray(action?.accountScope)
        && action.accountScope.every((account: any) => (
          optionalText(account?.role) && optionalText(account?.ref)
        ))
        && optionalText(action?.assetChange)
        && dependencies.every((dependency: unknown) => previousIds.includes(dependency))
        && action?.atomicity === 'single_provider_transaction'
        && action?.constraints?.opaqueInstructions === false
        && /^[a-f0-9]{64}$/.test(String(action?.constraints?.idempotencyKey ?? ''))
        && action?.constraints?.deadline?.kind === 'last_valid_block_height'
        && Number.isSafeInteger(Number(action?.constraints?.deadline?.value))
        && Number(action.constraints.deadline.value) > 0
        && attempts.length === 1
        && attempt?.ordinal === 1
        && attempt?.status === 'finalized'
        && attempt?.providerReference === transaction?.signature
        && duplicateActionIdempotencyKeys[index] === action?.constraints?.idempotencyKey
        && duplicateProviderReferences[index] === attempt?.providerReference
        && Number(attempt?.slot) === Number(transaction?.slot)
        && attempt?.recentBlockhash === transaction?.attemptContext?.recentBlockhash
        && attempt?.messageDigest === transaction?.messageDigest
        && attempt?.manifestDigest === transaction?.manifestDigest;
    })
    ? {
        authority: 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt' as const,
        providerModule: rawExecutionPlan.providerModule as
          'realms_provider_binding' | 'squads_provider_binding',
        executionMode: executionMode as 'realms' | 'squads',
        requestId: String(rawExecutionPlan.requestId),
        decisionDigest: String(rawExecutionPlan.decisionDigest),
        actionIntentDigest: String(rawExecutionPlan.actionIntentDigest),
        planDigest: String(rawExecutionPlan.planDigest),
        terminalTransactionAttemptDigest: String(
          rawExecutionPlan.terminalTransactionAttemptDigest,
        ),
        actionSetDigest: String(rawExecutionPlan.actionSetDigest),
        aggregateStatus: 'executed' as const,
        duplicatePrevention: {
          authority: 'canonical_action_intent_attempt_and_authoritative_provider_readback' as const,
          state: 'protected_no_duplicate_action_observed' as const,
          actionIntentDigest: String(rawDuplicatePrevention.actionIntentDigest),
          terminalTransactionAttemptDigest: String(
            rawDuplicatePrevention.terminalTransactionAttemptDigest,
          ),
          actionSetDigest: String(rawDuplicatePrevention.actionSetDigest),
          actionIdempotencyKeys: duplicateActionIdempotencyKeys.map(String),
          providerReferences: duplicateProviderReferences.map(String),
          checks: {
            uniqueActionIdempotencyKeys: true as const,
            uniqueProviderReferences: true as const,
            everyAttemptFinalized: true as const,
            everyAttemptManifestBound: true as const,
            authoritativeProviderReadback: true as const,
          },
          duplicateActionObserved: false as const,
          duplicatePaymentObserved: 'not_applicable_no_real_asset_current_vertical' as const,
          retryBoundary: 'same_intent_retry_requires_authoritative_expiry' as const,
        },
        actions: rawExecutionActions.map((action: any) => ({
          actionId: String(action.actionId),
          order: Number(action.order),
          executor: action.executor as 'realms' | 'squads',
          operation: String(action.operation),
          instructionSemantics: String(action.instructionSemantics),
          humanSummary: String(action.humanSummary),
          programScope: action.programScope.map(String),
          accountScope: action.accountScope.map((account: any) => ({
            role: String(account.role),
            ref: String(account.ref),
          })),
          assetChange: String(action.assetChange),
          dependsOnActionIds: action.dependsOnActionIds.map(String),
          atomicity: 'single_provider_transaction' as const,
          attempts: action.attempts.map((attempt: any) => ({
            status: 'finalized' as const,
            providerReference: String(attempt.providerReference),
            slot: Number(attempt.slot),
            recentBlockhash: String(attempt.recentBlockhash),
            messageDigest: String(attempt.messageDigest),
            manifestDigest: String(attempt.manifestDigest),
          })),
        })),
      }
    : null;
  const projectedHumanReadableActions = rawProviderTransactions.flatMap((transaction: any) => {
    const action = transaction?.humanReadableAction;
    const assetChanges = new Set([
      'governance_weight_supply_created_no_real_asset',
      'governance_weight_deposited_no_real_asset',
      'zero_lamport_self_transfer_no_real_asset',
      'none_no_real_assets',
    ]);
    if (
      action?.schemaVersion !== 1
      || action?.authority !== 'verified_provider_plan_and_receipt'
      || action?.operation !== transaction?.stepId
      || !optionalText(action?.summary)
      || !Array.isArray(action?.programScope)
      || action.programScope.length === 0
      || action.programScope.some((program: unknown) => !optionalText(program))
      || !Array.isArray(action?.accountScope)
      || action.accountScope.length === 0
      || action.accountScope.some((account: any) => (
        !optionalText(account?.role) || !optionalText(account?.ref)
      ))
      || !assetChanges.has(action?.assetChange)
      || !['required_passed_before_provider_signature', 'passed'].includes(action?.simulation)
      || !['provider_onchain', 'multisig_threshold'].includes(action?.enforcement)
      || action?.opaqueInstructions !== false
      || action?.manifestDigest !== transaction?.manifestDigest
    ) return [];
    return [{
      operation: String(action.operation),
      summary: String(action.summary),
      programScope: action.programScope.map(String),
      accountScope: action.accountScope.map((account: any) => ({
        role: String(account.role),
        ref: String(account.ref),
      })),
      assetChange: action.assetChange as 'governance_weight_supply_created_no_real_asset'
        | 'governance_weight_deposited_no_real_asset'
        | 'zero_lamport_self_transfer_no_real_asset'
        | 'none_no_real_assets',
      simulation: action.simulation as 'required_passed_before_provider_signature' | 'passed',
      enforcement: action.enforcement as 'provider_onchain' | 'multisig_threshold',
      opaqueInstructions: false as const,
      manifestDigest: String(action.manifestDigest),
    }];
  });
  const humanReadableActions = rawProviderTransactions.length > 0
    && projectedHumanReadableActions.length === rawProviderTransactions.length
    ? projectedHumanReadableActions
    : null;
  const projectedActionContexts = rawProviderTransactions.flatMap((transaction: any, index: number) => {
    const context = transaction?.actionContext;
    const expectedDependency = index === 0
      ? []
      : [String(rawProviderTransactions[index - 1]?.stepId ?? '')];
    if (
      context?.schemaVersion !== 1
      || context?.authority !== 'provider_plan_and_attempt_checkpoint'
      || context?.order !== index + 1
      || JSON.stringify(context?.dependsOnStepIds) !== JSON.stringify(expectedDependency)
      || !/^[a-f0-9]{64}$/.test(String(context?.atomicGroupId ?? ''))
      || context?.atomicity !== 'single_provider_transaction'
      || !optionalText(context?.expectedStateChange)
      || !/^[a-f0-9]{64}$/.test(String(context?.idempotencyKey ?? ''))
      || context?.deadline?.kind !== 'last_valid_block_height'
      || !Number.isSafeInteger(Number(context?.deadline?.value))
      || Number(context.deadline.value) <= 0
      || context?.aggregateRule !== 'all_ordered_steps_finalized'
    ) return [];
    return [{
      stepId: String(transaction.stepId),
      order: Number(context.order),
      dependsOnStepIds: context.dependsOnStepIds.map(String),
      atomicGroupId: String(context.atomicGroupId),
      atomicity: 'single_provider_transaction' as const,
      expectedStateChange: String(context.expectedStateChange),
      idempotencyKey: String(context.idempotencyKey),
      deadline: {
        kind: 'last_valid_block_height' as const,
        value: Number(context.deadline.value),
      },
      aggregateRule: 'all_ordered_steps_finalized' as const,
    }];
  });
  const actionContexts = rawProviderTransactions.length > 0
    && projectedActionContexts.length === rawProviderTransactions.length
    && new Set(projectedActionContexts.map((context: { atomicGroupId: string }) => (
      context.atomicGroupId
    ))).size
      === projectedActionContexts.length
    && new Set(projectedActionContexts.map((context: { idempotencyKey: string }) => (
      context.idempotencyKey
    ))).size
      === projectedActionContexts.length
    ? projectedActionContexts
    : null;
  const rawExpiredAttempts = provider?.expiredAttemptHistory;
  const expiredAttempts = rawExpiredAttempts?.schemaVersion === 1
    && rawExpiredAttempts.authority === 'canonical_cost_preflight_checkpoint'
    && Array.isArray(rawExpiredAttempts.attempts)
    && rawExpiredAttempts.attempts.length <= 24
    && rawExpiredAttempts.attempts.every((attempt: any) => (
      optionalText(attempt?.stepId)
      && /^[a-f0-9]{64}$/.test(String(attempt?.manifestDigest ?? ''))
      && /^[a-f0-9]{64}$/.test(String(attempt?.messageDigest ?? ''))
      && optionalText(attempt?.recentBlockhash)
      && Number.isSafeInteger(Number(attempt?.lastValidBlockHeight))
      && Number(attempt.lastValidBlockHeight) >= 0
      && Number.isSafeInteger(Number(attempt?.expiredAtBlockHeight))
      && Number(attempt.expiredAtBlockHeight) > Number(attempt.lastValidBlockHeight)
      && attempt?.disposition === 'authoritative_expiry_same_intent_manual_retry'
    ))
    ? rawExpiredAttempts.attempts.map((attempt: any) => ({
        stepId: String(attempt.stepId),
        manifestDigest: String(attempt.manifestDigest),
        messageDigest: String(attempt.messageDigest),
        recentBlockhash: String(attempt.recentBlockhash),
        lastValidBlockHeight: Number(attempt.lastValidBlockHeight),
        expiredAtBlockHeight: Number(attempt.expiredAtBlockHeight),
        disposition: 'authoritative_expiry_same_intent_manual_retry' as const,
      }))
    : null;
  const rawPreSignStatePreconditions = Array.isArray(provider?.transactions)
    ? provider.transactions.flatMap((transaction: any) => (
        transaction?.statePrecondition == null ? [] : [transaction.statePrecondition]
      ))
    : [];
  const preSignStatePreconditions = rawPreSignStatePreconditions.length > 0
    && rawPreSignStatePreconditions.length <= 2
    && new Set(rawPreSignStatePreconditions.map((item: any) => item?.stepId)).size
      === rawPreSignStatePreconditions.length
    && rawPreSignStatePreconditions.every((item: any) => (
      item?.schemaVersion === 1
      && item?.authority === 'independent_provider_readback_before_transit_sign'
      && ['set_governance_delegate', 'revoke_governance_delegate'].includes(item?.stepId)
      && /^[a-f0-9]{64}$/.test(String(item?.actionIntentDigest ?? ''))
      && /^[a-f0-9]{64}$/.test(String(item?.planDigest ?? ''))
      && /^[a-f0-9]{64}$/.test(String(item?.manifestDigest ?? ''))
      && /^[a-f0-9]{64}$/.test(String(item?.messageDigest ?? ''))
      && (item?.expectedDelegate === null || optionalText(item?.expectedDelegate))
      && Number.isSafeInteger(Number(item?.observedSlot))
      && Number(item.observedSlot) > 0
      && /^[a-f0-9]{64}$/.test(String(item?.providerStateDigest ?? ''))
      && Number.isSafeInteger(Number(item?.feePayerBalanceLamports))
      && Number(item.feePayerBalanceLamports) >= 0
      && item?.canonicalOwnerState?.schemaVersion === 1
      && item.canonicalOwnerState.authority === 'canonical_resource_authority_payer_readback'
      && optionalText(item.canonicalOwnerState.resourceBindingId)
      && optionalText(item.canonicalOwnerState.authorityBindingId)
      && optionalText(item.canonicalOwnerState.payerPolicyId)
      && ['not_configured_p05_gate', 'clear_fresh_p05_authority_health']
        .includes(item.canonicalOwnerState.emergencyFreeze)
      && /^[a-f0-9]{64}$/.test(String(item.canonicalOwnerState.stateDigest ?? ''))
      && item?.instructionSafety?.schemaVersion === 1
      && item.instructionSafety.authority === 'provider_instruction_manifest_and_simulation'
      && Array.isArray(item.instructionSafety.programIds)
      && item.instructionSafety.programIds.length === 1
      && optionalText(item.instructionSafety.programIds[0])
      && item.instructionSafety.instructionCount === 1
      && item.instructionSafety.transactionSignerCount === 2
      && Array.isArray(item.instructionSafety.writableAccountRefs)
      && item.instructionSafety.writableAccountRefs.length === 1
      && optionalText(item.instructionSafety.writableAccountRefs[0])
      && item.instructionSafety.accountPrivilegeCheck
        === 'exact_spl_governance_set_delegate_accounts'
      && item.instructionSafety.assetOutflowLamports === 0
      && item.instructionSafety.opaqueInstructions === false
      && item.instructionSafety.simulation === 'passed'
      && /^[a-f0-9]{64}$/.test(String(item.instructionSafety.digest ?? ''))
      && /^[a-f0-9]{64}$/.test(String(item?.digest ?? ''))
    ))
    ? rawPreSignStatePreconditions.map((item: any) => ({
        stepId: item.stepId as 'set_governance_delegate' | 'revoke_governance_delegate',
        actionIntentDigest: String(item.actionIntentDigest),
        planDigest: String(item.planDigest),
        manifestDigest: String(item.manifestDigest),
        messageDigest: String(item.messageDigest),
        expectedDelegate: item.expectedDelegate === null ? null : String(item.expectedDelegate),
        observedSlot: Number(item.observedSlot),
        providerStateDigest: String(item.providerStateDigest),
        feePayerBalanceLamports: Number(item.feePayerBalanceLamports),
        canonicalOwnerState: {
          resourceBindingId: String(item.canonicalOwnerState.resourceBindingId),
          authorityBindingId: String(item.canonicalOwnerState.authorityBindingId),
          payerPolicyId: String(item.canonicalOwnerState.payerPolicyId),
          emergencyFreeze: item.canonicalOwnerState.emergencyFreeze,
          stateDigest: String(item.canonicalOwnerState.stateDigest),
        },
        instructionSafety: {
          programIds: item.instructionSafety.programIds.map(String),
          instructionCount: 1 as const,
          transactionSignerCount: 2 as const,
          writableAccountRefs: item.instructionSafety.writableAccountRefs.map(String),
          accountPrivilegeCheck: 'exact_spl_governance_set_delegate_accounts' as const,
          assetOutflowLamports: 0 as const,
          opaqueInstructions: false as const,
          simulation: 'passed' as const,
          digest: String(item.instructionSafety.digest),
        },
        digest: String(item.digest),
      }))
    : null;
  const rawActionSafety = provider?.providerActionSafetyBoundary;
  const safetyProgramAllowlist = Array.isArray(rawActionSafety?.programAllowlist)
    ? rawActionSafety.programAllowlist.map(String)
    : [];
  const safetyOperationAllowlist = Array.isArray(rawActionSafety?.operationAllowlist)
    ? rawActionSafety.operationAllowlist.map(String)
    : [];
  const providerActionSafetyBoundary = rawActionSafety?.schemaVersion === 1
    && rawActionSafety.authority === 'reviewed_provider_adapter_instruction_safety'
    && rawActionSafety.providerModule === provider?.module
    && rawActionSafety.executionMode === executionMode
    && optionalText(rawActionSafety.chainId)
    && rawActionSafety.chainId === provider?.chainId
    && optionalText(rawActionSafety.resourceRef)
    && rawActionSafety.resourceRef === provider?.resourceRef
    && optionalText(rawActionSafety.ownerProgramRef)
    && rawActionSafety.ownerProgramRef === provider?.ownerProgramRef
    && rawActionSafety.decisionLinkage?.requestId === executionPlanReadback?.requestId
    && rawActionSafety.decisionLinkage?.decisionDigest === executionPlanReadback?.decisionDigest
    && rawActionSafety.decisionLinkage?.actionIntentDigest
      === executionPlanReadback?.actionIntentDigest
    && rawActionSafety.actionCount === rawProviderTransactions.length
    && rawActionSafety.reviewedAdapter === provider?.module
    && safetyProgramAllowlist.length > 0
    && safetyProgramAllowlist.every((program: string) => optionalText(program))
    && safetyOperationAllowlist.length === rawProviderTransactions.length
    && safetyOperationAllowlist.every((operation: string) => (
      rawProviderTransactions.some((transaction: any) => transaction?.stepId === operation)
    ))
    && rawActionSafety.checks?.reviewedAdapterOnly === true
    && rawActionSafety.checks?.programAllowlistVerified === true
    && rawActionSafety.checks?.accountPrivilegeChecked === true
    && rawActionSafety.checks?.assetConservation === 'zero_outflow_current_vertical'
    && rawActionSafety.checks?.maxOutflowLamports === 0
    && rawActionSafety.checks?.simulationRequired === true
    && rawActionSafety.checks?.opaqueInstructionsAllowed === false
    && rawActionSafety.checks?.rawInstructionAutoExecutionAllowed === false
    && rawActionSafety.checks?.materialChangeRequiresNewDecision === true
    && rawActionSafety.retryMaterialChangeGate === retryBoundary?.materialChangesRequire
    && executionPlanReadback !== null
    && humanReadableActions !== null
    ? {
        authority: 'reviewed_provider_adapter_instruction_safety' as const,
        providerModule: rawActionSafety.providerModule as
          'realms_provider_binding' | 'squads_provider_binding',
        executionMode: executionMode as 'realms' | 'squads',
        chainId: String(rawActionSafety.chainId),
        resourceRef: String(rawActionSafety.resourceRef),
        ownerProgramRef: String(rawActionSafety.ownerProgramRef),
        decisionLinkage: {
          requestId: String(rawActionSafety.decisionLinkage.requestId),
          decisionDigest: String(rawActionSafety.decisionLinkage.decisionDigest),
          actionIntentDigest: String(rawActionSafety.decisionLinkage.actionIntentDigest),
        },
        actionCount: Number(rawActionSafety.actionCount),
        reviewedAdapter: rawActionSafety.reviewedAdapter as
          'realms_provider_binding' | 'squads_provider_binding',
        programAllowlist: safetyProgramAllowlist,
        operationAllowlist: safetyOperationAllowlist,
        checks: {
          reviewedAdapterOnly: true as const,
          programAllowlistVerified: true as const,
          accountPrivilegeChecked: true as const,
          assetConservation: 'zero_outflow_current_vertical' as const,
          maxOutflowLamports: 0 as const,
          simulationRequired: true as const,
          opaqueInstructionsAllowed: false as const,
          rawInstructionAutoExecutionAllowed: false as const,
          materialChangeRequiresNewDecision: true as const,
        },
        retryMaterialChangeGate: 'new_decision_stage_or_superseding_case' as const,
      }
    : null;
  const rawServicePayer = provider?.servicePayerAuthorityBoundary;
  const rawServiceCostReadback = rawServicePayer?.costReadback;
  const servicePayerRestrictedMintOperation = rawServicePayer?.restrictedMintOperation
    === 'governance_weight_no_real_asset_requires_separate_resource_authority'
    || rawServicePayer?.restrictedMintOperation === 'not_present_current_provider_action'
    ? rawServicePayer.restrictedMintOperation
    : null;
  const servicePayerDirectRent = rawServiceCostReadback?.totalDirectRentLamports === null
    ? null
    : Number(rawServiceCostReadback?.totalDirectRentLamports);
  const servicePayerTotalSpend = Number(rawServiceCostReadback?.totalSpendLamports);
  const servicePayerRefund = rawServiceCostReadback?.refund === 'not_applicable_no_refund'
    || rawServiceCostReadback?.refund === 'unknown_no_provider_refund_disposition'
    ? rawServiceCostReadback.refund
    : null;
  const servicePayerAuthorityBoundary = rawServicePayer?.schemaVersion === 1
    && rawServicePayer.authority
      === 'canonical_payer_fee_rent_only_asset_authority_separation'
    && authorityPaymentBoundary !== null
    && fundingSourceFeePayerBoundary !== null
    && costReconciliation !== null
    && providerActionSafetyBoundary !== null
    && optionalText(rawServicePayer?.payerPolicyId)
    && rawServicePayer.payerPolicyId === authorityPaymentBoundary.payerPolicyId
    && rawServicePayer.payerPolicyId === fundingSourceFeePayerBoundary.payerPolicyId
    && rawServicePayer.payerPolicyId === costReconciliation.payerPolicyId
    && rawServicePayer.economicBearer === authorityPaymentBoundary.economicBearer
    && rawServicePayer.economicBearer === fundingSourceFeePayerBoundary.economicBearer
    && rawServicePayer.economicBearer === costReconciliation.economicBearer
    && rawServicePayer.feeScope === 'approved_fee_and_rent_only'
    && rawServicePayer.payerRole === 'separated_fee_payer_policy'
    && rawServicePayer.actualFeePayer === 'canonical_payer_policy_fee_payer_signer'
    && rawServicePayer.sponsorRole === authorityPaymentBoundary.sponsorRole
    && rawServicePayer.sponsorRole === fundingSourceFeePayerBoundary.sponsorRole
    && rawServicePayer.sponsorRole === costReconciliation.sponsorRole
    && rawServicePayer.sponsorAuthorityGain === 'none'
    && rawServicePayer.servicePayerMayControlToken === false
    && rawServicePayer.servicePayerMayControlMetadata === false
    && rawServicePayer.servicePayerMayControlProgram === false
    && rawServicePayer.servicePayerMayControlGovernanceAuthority === false
    && rawServicePayer.mintFreezeUpdateAuthoritySource === 'asset_authority_policy_required'
    && servicePayerRestrictedMintOperation !== null
    && rawServicePayer.currentActionAssetOutflow === 'zero_outflow_current_vertical'
    && rawServicePayer.rawInstructionAutoExecutionAllowed === false
    && rawServicePayer.longLivedUniversalKeyAllowed === false
    && rawServicePayer.materialAuthorityChangeRequires === retryBoundary?.materialChangesRequire
    && rawServiceCostReadback?.unit === 'lamports'
    && Number.isSafeInteger(servicePayerTotalSpend)
    && servicePayerTotalSpend === costReconciliation.totalSpendLamports
    && (servicePayerDirectRent === null
      ? costReconciliation.totalDirectRentLamports === null
      : Number.isSafeInteger(servicePayerDirectRent)
        && servicePayerDirectRent === costReconciliation.totalDirectRentLamports)
    && servicePayerRefund === costReconciliation.refund
    ? {
        authority: 'canonical_payer_fee_rent_only_asset_authority_separation' as const,
        payerPolicyId: String(rawServicePayer.payerPolicyId),
        economicBearer: String(rawServicePayer.economicBearer),
        feeScope: 'approved_fee_and_rent_only' as const,
        payerRole: 'separated_fee_payer_policy' as const,
        actualFeePayer: 'canonical_payer_policy_fee_payer_signer' as const,
        sponsorRole: rawServicePayer.sponsorRole as
          'explicit_relayer_from_payer_policy' | 'not_configured',
        sponsorAuthorityGain: 'none' as const,
        servicePayerMayControlToken: false as const,
        servicePayerMayControlMetadata: false as const,
        servicePayerMayControlProgram: false as const,
        servicePayerMayControlGovernanceAuthority: false as const,
        mintFreezeUpdateAuthoritySource: 'asset_authority_policy_required' as const,
        restrictedMintOperation: servicePayerRestrictedMintOperation,
        currentActionAssetOutflow: 'zero_outflow_current_vertical' as const,
        rawInstructionAutoExecutionAllowed: false as const,
        longLivedUniversalKeyAllowed: false as const,
        materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case' as const,
        costReadback: {
          unit: 'lamports' as const,
          totalSpendLamports: servicePayerTotalSpend,
          totalDirectRentLamports: servicePayerDirectRent,
          refund: servicePayerRefund,
        },
      }
    : null;
  const rawCostControl = provider?.providerCostControlBoundary;
  const costControlFinalBalance = Number(rawCostControl?.balance?.finalBalanceLamports);
  const costControlMaxBalance = rawCostControl?.limits?.maximumWalletBalanceLamports === null
    ? null
    : String(rawCostControl?.limits?.maximumWalletBalanceLamports ?? '');
  const providerCostControlBoundary = rawCostControl?.schemaVersion === 1
    && rawCostControl.authority === 'canonical_payer_policy_cost_control_and_provider_receipt'
    && costReconciliation !== null
    && optionalText(rawCostControl?.payerPolicyId)
    && rawCostControl.payerPolicyId === costReconciliation.payerPolicyId
    && /^[a-f0-9]{64}$/.test(String(rawCostControl?.payerPolicyDigest ?? ''))
    && optionalText(rawCostControl?.preflightId)
    && optionalText(rawCostControl?.attemptKey)
    && (rawCostControl.scope?.homeIdentityBindingId === null
      || optionalText(rawCostControl.scope?.homeIdentityBindingId))
    && (rawCostControl.scope?.circleRef === null || optionalText(rawCostControl.scope?.circleRef))
    && (rawCostControl.scope?.actorPubkey === null
      || optionalText(rawCostControl.scope?.actorPubkey))
    && optionalText(rawCostControl.scope?.actionType)
    && optionalText(rawCostControl.scope?.network)
    && (rawCostControl.scope?.resourceBindingId === null
      || optionalText(rawCostControl.scope?.resourceBindingId))
    && rawCostControl.scope?.resourceBindingId === (provider?.resourceRef ?? null)
    && /^[a-f0-9]{64}$/.test(String(rawCostControl.scope?.actionScopeDigest ?? ''))
    && optionalText(rawCostControl.timeWindow?.scope)
    && (rawCostControl.timeWindow?.effectiveFrom === null
      || dateTime(rawCostControl.timeWindow?.effectiveFrom))
    && (rawCostControl.timeWindow?.expiresAt === null
      || dateTime(rawCostControl.timeWindow?.expiresAt))
    && (rawCostControl.timeWindow?.checkedAt === null
      || dateTime(rawCostControl.timeWindow?.checkedAt))
    && rawCostControl.limits?.unit === 'lamports'
    && /^\d+$/.test(String(rawCostControl.limits?.singleTransactionLamports ?? ''))
    && /^\d+$/.test(String(rawCostControl.limits?.periodLamports ?? ''))
    && (costControlMaxBalance === null || /^\d+$/.test(costControlMaxBalance))
    && rawCostControl.balance?.authority === 'provider_receipt_final_balance'
    && Number.isSafeInteger(costControlFinalBalance)
    && costControlFinalBalance === costReconciliation.finalBalanceLamports
    && ['within_configured_balance_limit', 'no_maximum_wallet_balance_configured']
      .includes(String(rawCostControl.balance?.state))
    && rawCostControl.rateLimit?.authority === 'invocation_attempt_key_and_payer_policy_period'
    && rawCostControl.rateLimit?.duplicateAttemptKeyScopedToInvocation === true
    && rawCostControl.rateLimit?.actionWindowScope === rawCostControl.timeWindow?.scope
    && rawCostControl.alerts?.spendWithinSingleLimit === true
    && rawCostControl.alerts?.spendWithinPeriodLimit === true
    && (rawCostControl.alerts?.finalBalanceWithinConfiguredMaximum === true
      || rawCostControl.alerts?.finalBalanceWithinConfiguredMaximum === 'not_configured')
    && rawCostControl.sponsorReceipt?.authority === 'provider_cost_control_sponsor_receipt'
    && /^[a-f0-9]{64}$/.test(String(rawCostControl.sponsorReceipt?.receiptDigest ?? ''))
    && rawCostControl.sponsorReceipt?.sponsorRole === costReconciliation.sponsorRole
    && (rawCostControl.sponsorReceipt?.sponsorRef === null
      || optionalText(rawCostControl.sponsorReceipt?.sponsorRef))
    && rawCostControl.sponsorReceipt?.economicBearer === costReconciliation.economicBearer
    && rawCostControl.sponsorReceipt?.feePayerSignerRefExposed === false
    && rawCostControl.sponsorReceipt?.refund === costReconciliation.refund
    && rawCostControl.sponsorReceipt?.generatedFrom
      === 'payer_policy_cost_preflight_and_provider_receipt'
    ? {
        authority: 'canonical_payer_policy_cost_control_and_provider_receipt' as const,
        payerPolicyId: String(rawCostControl.payerPolicyId),
        payerPolicyDigest: String(rawCostControl.payerPolicyDigest),
        preflightId: String(rawCostControl.preflightId),
        attemptKey: String(rawCostControl.attemptKey),
        scope: {
          homeIdentityBindingId: rawCostControl.scope.homeIdentityBindingId === null
            ? null
            : String(rawCostControl.scope.homeIdentityBindingId),
          circleRef: rawCostControl.scope.circleRef === null
            ? null
            : String(rawCostControl.scope.circleRef),
          actorPubkey: rawCostControl.scope.actorPubkey === null
            ? null
            : String(rawCostControl.scope.actorPubkey),
          actionType: String(rawCostControl.scope.actionType),
          network: String(rawCostControl.scope.network),
          resourceBindingId: rawCostControl.scope.resourceBindingId === null
            ? null
            : String(rawCostControl.scope.resourceBindingId),
          actionScopeDigest: String(rawCostControl.scope.actionScopeDigest),
        },
        timeWindow: {
          scope: String(rawCostControl.timeWindow.scope),
          effectiveFrom: rawCostControl.timeWindow.effectiveFrom === null
            ? null
            : String(rawCostControl.timeWindow.effectiveFrom),
          expiresAt: rawCostControl.timeWindow.expiresAt === null
            ? null
            : String(rawCostControl.timeWindow.expiresAt),
          checkedAt: rawCostControl.timeWindow.checkedAt === null
            ? null
            : String(rawCostControl.timeWindow.checkedAt),
        },
        limits: {
          unit: 'lamports' as const,
          singleTransactionLamports: String(rawCostControl.limits.singleTransactionLamports),
          periodLamports: String(rawCostControl.limits.periodLamports),
          maximumWalletBalanceLamports: costControlMaxBalance,
        },
        balance: {
          authority: 'provider_receipt_final_balance' as const,
          finalBalanceLamports: costControlFinalBalance,
          state: rawCostControl.balance.state as
            | 'within_configured_balance_limit'
            | 'no_maximum_wallet_balance_configured',
        },
        rateLimit: {
          authority: 'invocation_attempt_key_and_payer_policy_period' as const,
          duplicateAttemptKeyScopedToInvocation: true as const,
          actionWindowScope: String(rawCostControl.rateLimit.actionWindowScope),
        },
        alerts: {
          spendWithinSingleLimit: true as const,
          spendWithinPeriodLimit: true as const,
          finalBalanceWithinConfiguredMaximum:
            rawCostControl.alerts.finalBalanceWithinConfiguredMaximum as true | 'not_configured',
        },
        sponsorReceipt: {
          authority: 'provider_cost_control_sponsor_receipt' as const,
          receiptDigest: String(rawCostControl.sponsorReceipt.receiptDigest),
          sponsorRole: rawCostControl.sponsorReceipt.sponsorRole as
            'explicit_relayer_from_payer_policy' | 'not_configured',
          sponsorRef: rawCostControl.sponsorReceipt.sponsorRef === null
            ? null
            : String(rawCostControl.sponsorReceipt.sponsorRef),
          economicBearer: String(rawCostControl.sponsorReceipt.economicBearer),
          feePayerSignerRefExposed: false as const,
          refund: rawCostControl.sponsorReceipt.refund as
            'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition',
          generatedFrom: 'payer_policy_cost_preflight_and_provider_receipt' as const,
        },
        feeAbstractionPlan: rawCostControl.feeAbstractionPlan?.state === 'ready'
          && rawCostControl.feeAbstractionPlan.liveFeeTransactionAllowed === false
          && rawCostControl.feeAbstractionPlan.plan?.economicBearer
            === rawCostControl.sponsorReceipt.economicBearer
          ? rawCostControl.feeAbstractionPlan
          : null,
      }
    : null;
  const rawAssetSponsor = provider?.assetAuthoritySponsorBoundary;
  const assetSponsorActionCount = Number(rawAssetSponsor?.actionSafety?.actionCount);
  const assetAuthoritySponsorBoundary = rawAssetSponsor?.schemaVersion === 1
    && rawAssetSponsor.authority === 'canonical_asset_authority_policy_sponsor_separation'
    && servicePayerAuthorityBoundary !== null
    && providerCostControlBoundary !== null
    && providerActionSafetyBoundary !== null
    && rawAssetSponsor.payerPolicyId === servicePayerAuthorityBoundary.payerPolicyId
    && rawAssetSponsor.payerPolicyId === providerCostControlBoundary.payerPolicyId
    && rawAssetSponsor.payerPolicyDigest === providerCostControlBoundary.payerPolicyDigest
    && rawAssetSponsor.economicBearer === servicePayerAuthorityBoundary.economicBearer
    && rawAssetSponsor.economicBearer === providerCostControlBoundary.sponsorReceipt.economicBearer
    && rawAssetSponsor.sponsorRole === servicePayerAuthorityBoundary.sponsorRole
    && rawAssetSponsor.sponsorRole === providerCostControlBoundary.sponsorReceipt.sponsorRole
    && rawAssetSponsor.sponsorReceiptDigest
      === providerCostControlBoundary.sponsorReceipt.receiptDigest
    && rawAssetSponsor.assetAuthority?.ownerIssuerMintFreezeUpdateSource
      === 'asset_authority_policy_required'
    && rawAssetSponsor.assetAuthority?.currentActionAssetOutflow
      === servicePayerAuthorityBoundary.currentActionAssetOutflow
    && rawAssetSponsor.assetAuthority?.restrictedMintOperation
      === servicePayerAuthorityBoundary.restrictedMintOperation
    && rawAssetSponsor.assetAuthority?.materialAuthorityChangeRequires
      === servicePayerAuthorityBoundary.materialAuthorityChangeRequires
    && rawAssetSponsor.sponsorSeparation?.sponsorMayPayFees === true
    && rawAssetSponsor.sponsorSeparation?.sponsorAuthorityGain
      === servicePayerAuthorityBoundary.sponsorAuthorityGain
    && rawAssetSponsor.sponsorSeparation?.feePayerSignerRefExposed === false
    && rawAssetSponsor.sponsorSeparation?.sponsorMayControlToken === false
    && rawAssetSponsor.sponsorSeparation?.sponsorMayControlMetadata === false
    && rawAssetSponsor.sponsorSeparation?.sponsorMayControlProgram === false
    && rawAssetSponsor.sponsorSeparation?.sponsorMayControlGovernanceAuthority === false
    && rawAssetSponsor.sponsorSeparation?.longLivedUniversalKeyAllowed === false
    && rawAssetSponsor.actionSafety?.providerModule === providerActionSafetyBoundary.providerModule
    && rawAssetSponsor.actionSafety?.reviewedAdapter === providerActionSafetyBoundary.reviewedAdapter
    && Number.isSafeInteger(assetSponsorActionCount)
    && assetSponsorActionCount === providerActionSafetyBoundary.actionCount
    && rawAssetSponsor.actionSafety?.assetConservation === 'zero_outflow_current_vertical'
    && rawAssetSponsor.actionSafety?.maxOutflowLamports === 0
    && rawAssetSponsor.actionSafety?.opaqueInstructionsAllowed === false
    && rawAssetSponsor.actionSafety?.rawInstructionAutoExecutionAllowed === false
    && rawAssetSponsor.linkage?.actionScopeDigest === providerCostControlBoundary.scope.actionScopeDigest
    && rawAssetSponsor.linkage?.resourceBindingId
      === providerCostControlBoundary.scope.resourceBindingId
    && rawAssetSponsor.linkage?.decisionDigest
      === providerActionSafetyBoundary.decisionLinkage.decisionDigest
    && rawAssetSponsor.linkage?.actionIntentDigest
      === providerActionSafetyBoundary.decisionLinkage.actionIntentDigest
    ? {
        authority: 'canonical_asset_authority_policy_sponsor_separation' as const,
        payerPolicyId: String(rawAssetSponsor.payerPolicyId),
        payerPolicyDigest: String(rawAssetSponsor.payerPolicyDigest),
        economicBearer: String(rawAssetSponsor.economicBearer),
        sponsorRole: rawAssetSponsor.sponsorRole as
          'explicit_relayer_from_payer_policy' | 'not_configured',
        sponsorReceiptDigest: String(rawAssetSponsor.sponsorReceiptDigest),
        assetAuthority: {
          ownerIssuerMintFreezeUpdateSource: 'asset_authority_policy_required' as const,
          currentActionAssetOutflow: 'zero_outflow_current_vertical' as const,
          restrictedMintOperation: rawAssetSponsor.assetAuthority.restrictedMintOperation as
            | 'governance_weight_no_real_asset_requires_separate_resource_authority'
            | 'not_present_current_provider_action',
          materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case' as const,
        },
        sponsorSeparation: {
          sponsorMayPayFees: true as const,
          sponsorAuthorityGain: 'none' as const,
          feePayerSignerRefExposed: false as const,
          sponsorMayControlToken: false as const,
          sponsorMayControlMetadata: false as const,
          sponsorMayControlProgram: false as const,
          sponsorMayControlGovernanceAuthority: false as const,
          longLivedUniversalKeyAllowed: false as const,
        },
        actionSafety: {
          providerModule: rawAssetSponsor.actionSafety.providerModule as
            'realms_provider_binding' | 'squads_provider_binding',
          reviewedAdapter: rawAssetSponsor.actionSafety.reviewedAdapter as
            'realms_provider_binding' | 'squads_provider_binding',
          actionCount: assetSponsorActionCount,
          assetConservation: 'zero_outflow_current_vertical' as const,
          maxOutflowLamports: 0 as const,
          opaqueInstructionsAllowed: false as const,
          rawInstructionAutoExecutionAllowed: false as const,
        },
        linkage: {
          actionScopeDigest: String(rawAssetSponsor.linkage.actionScopeDigest),
          resourceBindingId: rawAssetSponsor.linkage.resourceBindingId === null
            ? null
            : String(rawAssetSponsor.linkage.resourceBindingId),
          decisionDigest: String(rawAssetSponsor.linkage.decisionDigest),
          actionIntentDigest: String(rawAssetSponsor.linkage.actionIntentDigest),
        },
      }
    : null;
  const indexerProgramId = optionalText(trustProfile?.programId)
    ?? optionalText(provider.ownerProgramRef)
    ?? 'provider_program_unavailable';
  const exactIndexerObservation = indexerObservation?.programId === indexerProgramId
    ? indexerObservation
    : null;
  const checkpointSlot = Number(exactIndexerObservation?.checkpoint?.lastProcessedSlot);
  const checkpointLastSyncedAt = dateTime(exactIndexerObservation?.checkpoint?.lastSuccessfulSync);
  const runtimeLastProgressAt = dateTime(exactIndexerObservation?.runtime?.lastProgressAt);
  const indexerState = !exactIndexerObservation
    ? 'not_configured'
    : exactIndexerObservation.loadState === 'unavailable'
      ? 'unavailable'
      : !exactIndexerObservation.checkpoint
        ? 'not_configured'
        : exactIndexerObservation.unresolvedFailure
          || exactIndexerObservation.runtime?.phase === 'error'
          || Boolean(exactIndexerObservation.runtime?.lastError)
          ? 'failed'
          : Number.isSafeInteger(checkpointSlot)
            && Number.isSafeInteger(observedSlot)
            && checkpointSlot < observedSlot
            ? 'behind'
            : 'synced';
  const indexerFailure = indexerState === 'unavailable'
    ? 'provider_indexer_observation_unavailable'
    : indexerState === 'not_configured'
      ? 'provider_indexer_checkpoint_not_configured'
      : optionalText(exactIndexerObservation?.unresolvedFailure?.lastError)
        ?? optionalText(exactIndexerObservation?.runtime?.lastError);
  const observationAttempt = transactionAttempts && transactionAttempts.length > 0
    ? transactionAttempts[transactionAttempts.length - 1]
    : null;
  const trustObservationSlot = Number(observationAttempt?.quoteSlot);
  const trustObservationBlockhash = optionalText(observationAttempt?.recentBlockhash);
  const rpcIndexerCrossCheck = indexerState === 'synced'
    ? 'rpc_finalized_and_indexer_program_checkpoint_converged' as const
    : indexerState === 'behind'
      ? 'rpc_finalized_indexer_program_checkpoint_behind' as const
      : indexerState === 'failed'
        ? 'rpc_finalized_indexer_program_checkpoint_failed' as const
        : indexerState === 'unavailable'
          ? 'rpc_finalized_indexer_observation_unavailable' as const
          : 'rpc_finalized_only_indexer_not_configured' as const;
  const trust = trustProfile
    && optionalText(trustProfile.genesisHash)
    && optionalText(trustProfile.programId)
    && optionalText(trustProfile.loaderProgramId)
    && optionalText(trustProfile.programDataAddress)
    && optionalText(trustProfile.upgradeAuthority)
    && /^[a-f0-9]{64}$/.test(String(trustProfile.deployedProgramBytesSha256 ?? ''))
    && optionalText(trustProfile.decoderPackage)
    && optionalText(trustProfile.decoderVersion)
    && /^[a-f0-9]{64}$/.test(String(trustProfile.decoderArtifactSha256 ?? ''))
    && optionalText(trustProfile.decoderConformance)
    && trustProfile.readinessState === 'ready'
    && (trustProfile.riskMaturity === 'stable' || trustProfile.riskMaturity === 'experimental')
    && trustProfile.commitment === 'finalized'
    && trustProfile.rpcAccess === 'public_no_credentials'
    && Number.isSafeInteger(deploymentObservedSlot)
    && deploymentObservedSlot > 0
    && deploymentObservedAt
    && Number.isSafeInteger(trustObservationSlot)
    && trustObservationSlot > 0
    && trustObservationBlockhash
      ? {
        readinessState: 'ready' as const,
        riskMaturity: trustProfile.riskMaturity as 'stable' | 'experimental',
        genesisHash: trustProfile.genesisHash,
        programId: trustProfile.programId,
        loaderProgramId: trustProfile.loaderProgramId,
        programDataAddress: trustProfile.programDataAddress,
        upgradeAuthority: trustProfile.upgradeAuthority,
        deployedProgramBytesSha256: trustProfile.deployedProgramBytesSha256,
        decoderPackage: trustProfile.decoderPackage,
        decoderVersion: trustProfile.decoderVersion,
        decoderArtifactSha256: trustProfile.decoderArtifactSha256,
        decoderConformance: trustProfile.decoderConformance,
        commitment: 'finalized' as const,
        rpcAccess: 'public_no_credentials' as const,
        deploymentObservedSlot,
        deploymentObservedAt,
        observationSlot: trustObservationSlot,
        observationBlockhash: trustObservationBlockhash,
        rpcIndexerCrossCheck,
      }
    : null;
  const rawReconciliationFallback = reconciliation?.reconciliationFallback;
  const fallbackOriginalEvidence = rawReconciliationFallback?.originalEvidence;
  const fallbackCorrectedState = rawReconciliationFallback?.correctedState;
  const fallbackAffectedObjects = rawReconciliationFallback?.affectedObjects;
  const fallbackMechanism = rawReconciliationFallback?.fallbackMechanism;
  const fallbackSuperseding = rawReconciliationFallback?.superseding;
  const reconciliationFallback = rawReconciliationFallback?.schemaVersion === 1
    && rawReconciliationFallback?.authority === 'frozen_trust_profile_and_independent_provider_readback'
    && ['provider_incident', 'profile_revalidation'].includes(
      String(rawReconciliationFallback?.sourceState),
    )
    && /^[a-f0-9]{64}$/.test(String(rawReconciliationFallback?.policyDigest ?? ''))
    && rawReconciliationFallback?.reconciliationAuthorityRef === 'independent_provider_readback'
    && optionalText(rawReconciliationFallback?.decisionAuthorityRef)
    && rawReconciliationFallback?.conflictRule
      === 'questioned_provider_program_decoder_cannot_adjudicate_itself'
    && optionalText(fallbackOriginalEvidence?.requestId)
    && optionalText(fallbackOriginalEvidence?.receiptId)
    && /^[a-f0-9]{64}$/.test(String(fallbackOriginalEvidence?.receiptEvidenceDigest ?? ''))
    && /^[a-f0-9]{64}$/.test(String(fallbackOriginalEvidence?.originalDecisionDigest ?? ''))
    && fallbackOriginalEvidence?.preserved === true
    && optionalText(fallbackAffectedObjects?.resourceRef)
    && optionalText(fallbackAffectedObjects?.ownerProgramRef)
    && (fallbackAffectedObjects?.providerProfileRef === null
      || optionalText(fallbackAffectedObjects?.providerProfileRef))
    && (fallbackAffectedObjects?.providerProfileVersion === null
      || Number.isSafeInteger(Number(fallbackAffectedObjects?.providerProfileVersion)))
    && (fallbackAffectedObjects?.incidentId === null
      || /^[a-f0-9]{64}$/.test(String(fallbackAffectedObjects?.incidentId ?? '')))
    && (fallbackAffectedObjects?.profileRevalidationBlocker === null
      || optionalText(fallbackAffectedObjects?.profileRevalidationBlocker))
    && ['frozen_provider_trust_profile_target', 'manual_recovery_pending'].includes(
      String(fallbackCorrectedState?.source),
    )
    && (fallbackCorrectedState?.source === 'manual_recovery_pending'
      || (
        optionalText(fallbackCorrectedState?.targetProfileRef)
        && Number.isSafeInteger(Number(fallbackCorrectedState?.targetProfileVersion))
        && Number(fallbackCorrectedState.targetProfileVersion) > 0
        && /^[a-f0-9]{64}$/.test(String(fallbackCorrectedState?.targetProfileDigest ?? ''))
        && optionalText(fallbackCorrectedState?.targetOwnerProgramRef)
        && optionalText(fallbackCorrectedState?.decoderConformance)
      ))
    && fallbackMechanism?.mode === 'manual_recovery_only'
    && fallbackMechanism?.independentFallbackProviderRef === null
    && fallbackMechanism?.activation === 'fail_closed_when_independent_fallback_absent'
    && fallbackMechanism?.operatorMaySelectProvider === false
    && fallbackMechanism?.questionedProviderMayAdjudicate === false
    && fallbackSuperseding?.artifactOwner === 'DecisionOutputArtifact'
    && fallbackSuperseding?.receiptOwner === 'GovernanceExecutionReceipt'
    && fallbackSuperseding?.materialChangeGate === 'new_decision_stage_or_superseding_case'
    && fallbackSuperseding?.required === true
    ? {
        sourceState: rawReconciliationFallback.sourceState as 'provider_incident' | 'profile_revalidation',
        authority: 'frozen_trust_profile_and_independent_provider_readback' as const,
        policyDigest: String(rawReconciliationFallback.policyDigest),
        reconciliationAuthorityRef: 'independent_provider_readback' as const,
        decisionAuthorityRef: String(rawReconciliationFallback.decisionAuthorityRef),
        conflictRule: 'questioned_provider_program_decoder_cannot_adjudicate_itself' as const,
        originalEvidence: {
          requestId: String(fallbackOriginalEvidence.requestId),
          receiptId: String(fallbackOriginalEvidence.receiptId),
          receiptEvidenceDigest: String(fallbackOriginalEvidence.receiptEvidenceDigest),
          originalDecisionDigest: String(fallbackOriginalEvidence.originalDecisionDigest),
          preserved: true as const,
        },
        affectedObjects: {
          resourceRef: String(fallbackAffectedObjects.resourceRef),
          ownerProgramRef: String(fallbackAffectedObjects.ownerProgramRef),
          providerProfileRef: fallbackAffectedObjects.providerProfileRef === null
            ? null
            : String(fallbackAffectedObjects.providerProfileRef),
          providerProfileVersion: fallbackAffectedObjects.providerProfileVersion === null
            ? null
            : Number(fallbackAffectedObjects.providerProfileVersion),
          incidentId: fallbackAffectedObjects.incidentId === null
            ? null
            : String(fallbackAffectedObjects.incidentId),
          profileRevalidationBlocker: fallbackAffectedObjects.profileRevalidationBlocker === null
            ? null
            : String(fallbackAffectedObjects.profileRevalidationBlocker),
        },
        correctedState: {
          source: fallbackCorrectedState.source as
            | 'frozen_provider_trust_profile_target'
            | 'manual_recovery_pending',
          targetProfileRef: fallbackCorrectedState.targetProfileRef === null
            ? null
            : String(fallbackCorrectedState.targetProfileRef),
          targetProfileVersion: fallbackCorrectedState.targetProfileVersion === null
            ? null
            : Number(fallbackCorrectedState.targetProfileVersion),
          targetProfileDigest: fallbackCorrectedState.targetProfileDigest === null
            ? null
            : String(fallbackCorrectedState.targetProfileDigest),
          targetOwnerProgramRef: fallbackCorrectedState.targetOwnerProgramRef === null
            ? null
            : String(fallbackCorrectedState.targetOwnerProgramRef),
          decoderConformance: fallbackCorrectedState.decoderConformance === null
            ? null
            : String(fallbackCorrectedState.decoderConformance),
        },
        fallbackMechanism: {
          mode: 'manual_recovery_only' as const,
          independentFallbackProviderRef: null,
          activation: 'fail_closed_when_independent_fallback_absent' as const,
          operatorMaySelectProvider: false as const,
          questionedProviderMayAdjudicate: false as const,
        },
        superseding: {
          artifactOwner: 'DecisionOutputArtifact' as const,
          receiptOwner: 'GovernanceExecutionReceipt' as const,
          materialChangeGate: 'new_decision_stage_or_superseding_case' as const,
          required: true as const,
        },
      }
    : null;
  const readinessBlockers = [
    status === 'held' ? 'provider_reconciliation_hold' : null,
    status === 'degraded' ? 'provider_reconciliation_degraded' : null,
    blocker ? `provider_blocker:${blocker}` : null,
    !trust ? 'provider_trust_profile_readback_unavailable' : null,
    !authorities ? 'provider_authority_readback_unavailable' : null,
    !providerResourceLifecycle ? 'provider_resource_lifecycle_unavailable' : null,
    !authorityPaymentBoundary ? 'provider_payer_authority_boundary_unavailable' : null,
    syncState !== 'synced' ? `provider_sync_${syncState}` : null,
    incident && incident.state !== 'reconciled' ? `provider_incident_${incident.state}` : null,
    revalidation ? 'provider_profile_revalidation_required' : null,
    ((incident && incident.state !== 'reconciled') || revalidation) && !reconciliationFallback
      ? 'provider_reconciliation_fallback_policy_unavailable'
      : null,
  ].filter((item): item is string => Boolean(item));
  const readinessState = readinessBlockers.length === 0
    ? 'ready' as const
    : (!trust || !authorities || !providerResourceLifecycle || !authorityPaymentBoundary)
      ? 'setup_required' as const
      : status === 'held'
        ? 'unavailable' as const
        : 'degraded' as const;
  const riskMaturity = trust?.riskMaturity ?? 'experimental';
  return {
    status,
    readiness: {
      readinessState,
      riskMaturity,
      stageOpenAllowed: readinessState === 'ready',
      executionOpenAllowed: readinessState === 'ready',
      riskConfirmationRequired: riskMaturity === 'experimental',
      authority: 'provider_trust_profile_resource_reconciliation_readback',
      blockers: readinessBlockers,
    },
    provider: optionalText(provider.module) ?? 'provider_unavailable',
    profileRef: optionalText(provider.profileRef),
    profileVersion: optionalText(provider.profileVersion),
    profileDigest,
    decoderConformance: profileDigest
      ? optionalText(currentProfileReadback.decoderConformance)
      : null,
    resourceRef: optionalText(provider.resourceRef),
    observedSlot: Number.isSafeInteger(observedSlot) && observedSlot > 0 ? observedSlot : null,
    observedAt: dateTime(reconciliation.observedAt ?? providerExecution.executedAt),
    blocker,
    incident,
    revalidation,
    sync: {
      state: syncState,
      source: 'solana_rpc_finalized_account_graph',
      lastSyncedAt,
      lastAttemptAt,
      failure: blocker,
    },
    trust,
    authorities,
    providerResourceLifecycle,
    reconciliationFallback,
    authorityPaymentBoundary,
    mandateCostPolicy,
    fundingSourceFeePayerBoundary,
    enforcement,
    costReconciliation,
    transactionAttempts,
    proposalTransactionReadback,
    executionPlanReadback,
    providerActionSafetyBoundary,
    servicePayerAuthorityBoundary,
    providerCostControlBoundary,
    assetAuthoritySponsorBoundary,
    attemptOwner,
    retryBoundary,
    humanReadableActions,
    actionContexts,
    expiredAttempts,
    preSignStatePreconditions,
    sources: {
      rpc: {
        state: syncState,
        observedSlot: Number.isSafeInteger(observedSlot) && observedSlot > 0 ? observedSlot : null,
        lastSyncedAt,
        lastAttemptAt,
        failure: blocker,
      },
      indexer: {
        state: indexerState,
        programId: indexerProgramId,
        indexedSlot: Number.isSafeInteger(checkpointSlot) && checkpointSlot >= 0
          ? checkpointSlot
          : null,
        providerObservedSlot: Number.isSafeInteger(observedSlot) && observedSlot > 0
          ? observedSlot
          : null,
        lagSlots: Number.isSafeInteger(checkpointSlot)
          && Number.isSafeInteger(observedSlot)
          ? Math.max(0, observedSlot - checkpointSlot)
          : null,
        lastSyncedAt: checkpointLastSyncedAt,
        lastProgressAt: runtimeLastProgressAt,
        failure: indexerFailure,
      },
      webhook: {
        state: 'not_applicable',
        reason: 'provider_uses_rpc_account_graph_readback',
      },
    },
  };
}

function actorResponsibility(
  responsibilities: Responsibility[],
  actorPubkey: string,
  kind: 'coordinator' | 'review' | 'execution' | 'outcome',
): Responsibility | null {
  return responsibilities.find((item) => (
    item?.kind === kind && sameActor(item.assigneePubkey, actorPubkey)
  )) ?? null;
}

function responsibilityRole(kind: string | undefined): GovernanceCaseInboxRole {
  if (kind === 'coordinator') return 'coordinator';
  if (kind === 'review') return 'reviewer';
  if (kind === 'execution') return 'executor';
  if (kind === 'outcome') return 'outcome_reviewer';
  return 'proposer';
}

function acceptedTask(
  responsibility: Responsibility | null,
  input: {
    category: GovernanceCaseInboxCategory;
    role: GovernanceCaseInboxRole;
    action: GovernanceCaseInboxPrimaryAction;
    waitingReason: string;
    providerHealth: GovernanceCaseInboxProviderHealth | null;
    providerRecovery: GovernanceCaseInboxProviderRecovery | null;
  },
): GovernanceCaseInboxTask | null {
  if (!responsibility) return null;
  if (responsibility.status === 'accepted') {
    return {
      category: input.category,
      role: input.role,
      primaryAction: input.action,
      status: 'available',
      deadline: dateTime(responsibility.deadlineAt),
      disabledReason: null,
      providerHealth: input.providerHealth,
      providerRecovery: input.providerRecovery,
    };
  }
  if (responsibility.status === 'assigned') {
    return {
      category: input.category,
      role: input.role,
      primaryAction: 'accept_responsibility',
      status: 'available',
      deadline: dateTime(responsibility.deadlineAt),
      disabledReason: null,
      providerHealth: input.providerHealth,
      providerRecovery: input.providerRecovery,
    };
  }
  return {
    category: input.category,
    role: input.role,
    primaryAction: 'view_case',
    status: 'blocked',
    deadline: null,
    disabledReason: input.waitingReason,
    providerHealth: input.providerHealth,
    providerRecovery: input.providerRecovery,
  };
}

function projectGovernanceExecutionParticipantBoundary(input: {
  phase: string;
  actorPubkey: string;
  executor: Responsibility | null;
  providerHealth: GovernanceCaseInboxProviderHealth | null;
}): GovernanceExecutionParticipantBoundary | null {
  if (input.phase !== 'execution_preparation' && input.phase !== 'execution_in_progress') {
    return null;
  }
  const providerHealth = input.providerHealth;
  const authorities = providerHealth?.authorities;
  const payment = providerHealth?.authorityPaymentBoundary;
  if (!providerHealth || !authorities?.length || !payment || !optionalText(providerHealth.resourceRef)) {
    return null;
  }
  const sourceRequestIds = new Set<string>();
  const sourceDecisionDigests = new Set<string>();
  const authorityRoles: string[] = [];
  const actorAuthorityRoles: string[] = [];
  const allowedOperations = new Set<string>();
  for (const authority of authorities) {
    const sourceRequestId = optionalText(authority.sourceRequestId);
    const sourceDecisionDigest = optionalText(authority.sourceDecisionDigest);
    if (!optionalText(authority.role)
      || !sourceRequestId
      || !sourceDecisionDigest
      || !/^[a-f0-9]{64}$/.test(sourceDecisionDigest)) {
      return null;
    }
    authorityRoles.push(authority.role);
    sourceRequestIds.add(sourceRequestId);
    sourceDecisionDigests.add(sourceDecisionDigest);
    for (const operation of authority.allowedOperations) allowedOperations.add(operation);
    if (sameActor(authority.publicAuthority, input.actorPubkey)) {
      actorAuthorityRoles.push(authority.role);
    }
  }
  if (
    authorityRoles.length === 0
    || allowedOperations.size === 0
    || sourceRequestIds.size !== 1
    || sourceDecisionDigests.size !== 1
  ) return null;
  const responsibilityStatus = ['assigned', 'accepted'].includes(String(input.executor?.status))
    ? input.executor!.status as 'assigned' | 'accepted'
    : null;
  const hasExecutionResponsibility = sameActor(input.executor?.assigneePubkey, input.actorPubkey)
    && responsibilityStatus !== null;
  const hasProviderAuthority = actorAuthorityRoles.length > 0;
  if (!hasExecutionResponsibility && !hasProviderAuthority) return null;
  const actorTaskSource = hasProviderAuthority
    ? 'provider_execution_authority'
    : 'case_execution_responsibility';
  return {
    schemaVersion: 1,
    authority: 'canonical_case_responsibility_and_resource_authority_binding',
    taskProducer: 'my_governance_case_inbox',
    actorPubkey: input.actorPubkey,
    actorTaskSource,
    participantRole: hasProviderAuthority
      ? 'external_authority_participant'
      : 'execution_coordinator',
    responsibilityStatus,
    provider: providerHealth.provider,
    resourceRef: providerHealth.resourceRef!,
    requestId: [...sourceRequestIds][0]!,
    decisionDigest: [...sourceDecisionDigests][0]!,
    authorityRoles,
    actorAuthorityRoles,
    allowedOperations: [...allowedOperations],
    pendingWork: hasProviderAuthority
      ? 'provider_signature_or_execution_task'
      : 'provider_execution_task',
    signerAuthoritySource: hasProviderAuthority
      ? 'resource_authority_binding'
      : 'none_assignment_only',
    assignmentGrantsSignerAuthority: false,
    assignmentGrantsPayerAuthority: false,
    payerPolicyId: payment.payerPolicyId,
    feePayerRole: payment.feePayerRole,
    payerSeparatedFromSigner: true,
    signerRefExposed: false,
    privateKeyExposure: payment.privateKeyExposure,
  };
}

export function projectGovernanceCaseInboxTask(
  value: any,
  actorPubkeyInput: string,
  providerExecution: any = null,
  indexerObservation: GovernanceProviderIndexerObservation | null = null,
): GovernanceCaseInboxTask | null {
  const actorPubkey = actorPubkeyInput.trim();
  if (!actorPubkey) return null;
  const responsibilities: Responsibility[] = Array.isArray(value?.responsibilities)
    ? value.responsibilities
    : [];
  const coordinator = actorResponsibility(responsibilities, actorPubkey, 'coordinator');
  const reviewer = actorResponsibility(responsibilities, actorPubkey, 'review');
  const currentReviewer = responsibilities.find((item) => item?.kind === 'review') ?? null;
  const executor = actorResponsibility(responsibilities, actorPubkey, 'execution');
  const outcomeReviewer = actorResponsibility(responsibilities, actorPubkey, 'outcome');
  const eligibleActors = Array.isArray(value?.primaryRequest?.snapshot?.eligibleActors)
    ? value.primaryRequest.snapshot.eligibleActors
    : [];
  const eligible = eligibleActors.some((item: any) => sameActor(item?.pubkey, actorPubkey));
  const signals = Array.isArray(value?.primaryRequest?.signals)
    ? value.primaryRequest.signals
    : [];
  const signalRecorded = signals.some((item: any) => (
    sameActor(item?.actorPubkey, actorPubkey)
    && (!item?.signalType || item.signalType === 'committee_vote')
  ));
  const proposer = sameActor(value?.openedByPubkey, actorPubkey);
  const memberRightsPayload = value?.requestedActionPayload?.kind === 'circle_member_removal'
    ? value.requestedActionPayload
    : null;
  const appellant = sameActor(memberRightsPayload?.targetPubkey, actorPubkey);
  const actorResponsibilityValue = coordinator ?? reviewer ?? executor ?? outcomeReviewer;
  const providerHealth = projectGovernanceCaseInboxProviderHealth(
    providerExecution,
    indexerObservation,
  );
  const providerRecovery = projectGovernanceCaseInboxProviderRecovery(providerExecution);
  const providerAuthorityParticipant = providerHealth?.authorities?.some((authority) => (
    sameActor(authority.publicAuthority, actorPubkey)
  )) === true;
  const relevant = proposer
    || appellant
    || Boolean(actorResponsibilityValue)
    || eligible
    || signalRecorded
    || providerAuthorityParticipant;
  if (!relevant) return null;

  const phase = String(value?.casePhase || 'intake');
  const executionParticipantBoundary = projectGovernanceExecutionParticipantBoundary({
    phase,
    actorPubkey,
    executor,
    providerHealth,
  });
  const attachExecutionParticipantBoundary = (
    task: GovernanceCaseInboxTask | null,
  ): GovernanceCaseInboxTask | null => {
    if (!task || !executionParticipantBoundary) return task;
    return { ...task, executionParticipantBoundary };
  };
  if (appellant) {
    const terminal = phase === 'closed' || phase === 'archived';
    return {
      category: terminal ? 'record' : 'review',
      role: 'appellant',
      primaryAction: terminal ? 'view_record' : 'view_case',
      status: terminal ? 'completed' : 'available',
      deadline: dateTime(memberRightsPayload?.appeal?.deadline),
      disabledReason: terminal ? 'case_terminal' : null,
      providerHealth,
      providerRecovery,
    };
  }
  if (phase === 'closed' || phase === 'archived') {
    return {
      category: 'record',
      role: responsibilityRole(String(actorResponsibilityValue?.kind || '')),
      primaryAction: 'view_record',
      status: 'completed',
      deadline: null,
      disabledReason: 'case_terminal',
      providerHealth,
      providerRecovery,
    };
  }

  if (
    value?.primaryRequest?.executionMode === 'stage_decision_only'
    && value?.primaryRequest?.decision?.decision === 'accepted'
    && (executor || outcomeReviewer)
  ) {
    const executionContract = acceptedDecisionExecutionContract(value);
    if (executionContract === 'unavailable') {
      return {
        category: executor ? 'execution' : 'outcome',
        role: executor ? 'executor' : 'outcome_reviewer',
        primaryAction: 'view_case',
        status: 'blocked',
        deadline: dateTime(executor?.deadlineAt ?? outcomeReviewer?.deadlineAt),
        disabledReason: 'decision_execution_contract_unavailable',
        providerHealth,
        providerRecovery,
      };
    }
    if (executionContract === 'manual') {
      const completionStatus = String(value?.manualExecutionCompletion?.status || '');
      if (executor) {
        if (completionStatus === 'approved') {
          return {
            category: 'record',
            role: 'executor',
            primaryAction: 'view_record',
            status: 'completed',
            deadline: dateTime(executor.deadlineAt),
            disabledReason: 'manual_execution_approved',
            providerHealth,
            providerRecovery,
          };
        }
        if (completionStatus === 'submitted') {
          return {
            category: 'execution',
            role: 'executor',
            primaryAction: 'view_case',
            status: 'waiting',
            deadline: dateTime(executor.deadlineAt),
            disabledReason: 'manual_execution_review_required',
            providerHealth,
            providerRecovery,
          };
        }
        return acceptedTask(executor, {
          category: 'execution',
          role: 'executor',
          action: 'submit_execution_evidence',
          waitingReason: 'execution_responsibility_unavailable',
          providerHealth,
          providerRecovery,
        });
      }
      if (completionStatus === 'submitted') {
        return acceptedTask(outcomeReviewer, {
          category: 'outcome',
          role: 'outcome_reviewer',
          action: 'review_execution_evidence',
          waitingReason: 'outcome_responsibility_unavailable',
          providerHealth,
          providerRecovery,
        });
      }
      // Manual execution approved is not Case close. While still in outcome_review,
      // the accepted Outcome reviewer must record the actual outcome next.
      if (completionStatus === 'approved' && phase === 'outcome_review') {
        return acceptedTask(outcomeReviewer, {
          category: 'outcome',
          role: 'outcome_reviewer',
          action: 'record_outcome',
          waitingReason: 'outcome_responsibility_unavailable',
          providerHealth,
          providerRecovery,
        }) ?? {
          category: 'outcome',
          role: responsibilityRole(String(actorResponsibilityValue?.kind || '')),
          primaryAction: 'view_case',
          status: 'waiting',
          deadline: null,
          disabledReason: 'outcome_reviewer_action_required',
          providerHealth,
          providerRecovery,
        };
      }
      return {
        category: completionStatus === 'approved' ? 'record' : 'outcome',
        role: 'outcome_reviewer',
        primaryAction: completionStatus === 'approved' ? 'view_record' : 'view_case',
        status: completionStatus === 'approved' ? 'completed' : 'waiting',
        deadline: null,
        disabledReason: completionStatus === 'approved'
          ? 'manual_execution_approved'
          : 'manual_execution_submission_required',
        providerHealth,
        providerRecovery,
      };
    }
    // Internal adapters have already recorded their canonical receipt and a
    // no-op decision has no execution step. Provider execution is projected by
    // its own phase/readback path below; none of these may be relabelled as
    // controlled manual work merely because the request uses a staged lifecycle.
  }

  if (phase === 'intake' || phase === 'proposal_drafting' || phase === 'ready_for_decision') {
    return acceptedTask(coordinator, {
      category: 'drafting',
      role: 'coordinator',
      action: 'continue_brief',
      waitingReason: 'coordinator_responsibility_unavailable',
      providerHealth,
      providerRecovery,
    }) ?? {
      category: 'drafting',
      role: proposer ? 'proposer' : responsibilityRole(String(actorResponsibilityValue?.kind || '')),
      primaryAction: 'view_case',
      status: 'waiting',
      deadline: null,
      disabledReason: 'coordinator_action_required',
      providerHealth,
      providerRecovery,
    };
  }

  if (phase === 'evidence_review') {
    const currentReviewSignoff = currentAcceptedReviewSignoff(value, currentReviewer);
    if (currentReviewSignoff) {
      if (coordinator) {
        return {
          category: 'decision',
          role: 'coordinator',
          primaryAction: 'open_approval_stage',
          status: 'available',
          deadline: dateTime(coordinator.deadlineAt),
          disabledReason: null,
          providerHealth,
          providerRecovery,
        };
      }
      return {
        category: 'decision',
        role: responsibilityRole(String(actorResponsibilityValue?.kind || '')),
        primaryAction: 'view_case',
        status: 'waiting',
        deadline: null,
        disabledReason: 'coordinator_open_approval_required',
        providerHealth,
        providerRecovery,
      };
    }
    return acceptedTask(reviewer, {
      category: 'review',
      role: 'reviewer',
      action: 'review_brief',
      waitingReason: 'review_responsibility_unavailable',
      providerHealth,
      providerRecovery,
    }) ?? {
      category: 'review',
      role: coordinator ? 'coordinator' : responsibilityRole(String(actorResponsibilityValue?.kind || '')),
      primaryAction: 'view_case',
      status: 'waiting',
      deadline: null,
      disabledReason: 'reviewer_action_required',
      providerHealth,
      providerRecovery,
    };
  }

  if (phase === 'decision_in_progress') {
    const deadline = dateTime(value?.primaryRequest?.expiresAt);
    if (eligible && !signalRecorded) {
      return {
        category: 'decision',
        role: 'voter',
        primaryAction: 'cast_vote',
        status: 'available',
        deadline,
        disabledReason: null,
        providerHealth,
        providerRecovery,
      };
    }
    if (signalRecorded) {
      return {
        category: 'decision',
        role: 'voter',
        primaryAction: 'view_case',
        status: 'completed',
        deadline,
        disabledReason: 'ballot_already_recorded',
        providerHealth,
        providerRecovery,
      };
    }
    return {
      category: 'decision',
      role: coordinator ? 'coordinator' : responsibilityRole(String(actorResponsibilityValue?.kind || '')),
      primaryAction: 'view_case',
      status: 'blocked',
      deadline,
      disabledReason: 'frozen_electorate_required',
      providerHealth,
      providerRecovery,
    };
  }

  if (phase === 'execution_preparation' || phase === 'execution_in_progress') {
    const executionTask = acceptedTask(executor, {
      category: 'execution',
      role: 'executor',
      action: 'open_execution',
      waitingReason: 'execution_responsibility_unavailable',
      providerHealth,
      providerRecovery,
    }) ?? (providerAuthorityParticipant
      ? {
          category: 'execution',
          role: 'executor',
          primaryAction: 'open_execution',
          status: 'available',
          deadline: null,
          disabledReason: null,
          providerHealth,
          providerRecovery,
        } satisfies GovernanceCaseInboxTask
      : null) ?? {
        category: 'execution',
        role: responsibilityRole(String(actorResponsibilityValue?.kind || '')),
        primaryAction: 'view_case',
        status: 'waiting',
        deadline: null,
        disabledReason: 'execution_assignee_action_required',
        providerHealth,
        providerRecovery,
      };
    if (
      executionTask.primaryAction === 'open_execution'
      && providerHealth
      && providerHealth.readiness.executionOpenAllowed !== true
    ) {
      return attachExecutionParticipantBoundary({
        ...executionTask,
        primaryAction: 'view_case',
        status: 'blocked',
        disabledReason: `provider_readiness_${providerHealth.readiness.readinessState}`,
      });
    }
    return attachExecutionParticipantBoundary(executionTask);
  }

  if (phase === 'outcome_review') {
    const outcomeAny = responsibilities.find((item) => item?.kind === 'outcome') ?? null;
    const executionAny = responsibilities.find((item) => item?.kind === 'execution') ?? null;
    const riskFloor = String(
      value?.templateSelection?.actionContract?.riskFloor
      ?? value?.actionContractVersion?.riskFloor
      ?? '',
    );
    const highImpact = riskFloor === 'high' || riskFloor === 'critical';
    const separationBlocked = Boolean(
      highImpact
      && executionAny
      && outcomeAny
      && ['assigned', 'accepted'].includes(String(executionAny.status))
      && sameActor(executionAny.assigneePubkey, String(outcomeAny.assigneePubkey || '')),
    );
    const outcomeTask = acceptedTask(outcomeReviewer, {
      category: 'outcome',
      role: 'outcome_reviewer',
      action: 'record_outcome',
      waitingReason: 'outcome_responsibility_unavailable',
      providerHealth,
      providerRecovery,
    });
    if (
      outcomeTask
      && outcomeTask.primaryAction === 'record_outcome'
      && separationBlocked
    ) {
      return {
        ...outcomeTask,
        primaryAction: 'view_case',
        status: 'blocked',
        disabledReason: 'outcome_executor_separation_required',
      };
    }
    return outcomeTask ?? {
      category: 'outcome',
      role: responsibilityRole(String(actorResponsibilityValue?.kind || '')),
      primaryAction: 'view_case',
      status: 'waiting',
      deadline: null,
      disabledReason: !outcomeAny
        ? 'outcome_reviewer_unassigned'
        : separationBlocked
          ? 'outcome_executor_separation_required'
          : 'outcome_reviewer_action_required',
      providerHealth,
      providerRecovery,
    };
  }

  return {
    category: 'record',
    role: responsibilityRole(String(actorResponsibilityValue?.kind || '')),
    primaryAction: 'view_case',
    status: 'blocked',
    deadline: null,
    disabledReason: 'case_phase_unavailable',
    providerHealth,
    providerRecovery,
  };
}

function governanceCaseDetailActionAnchor(
  action: GovernanceCaseInboxPrimaryAction,
  role: GovernanceCaseInboxRole,
  disabledReason: string | null,
): string {
  if (action === 'continue_brief') return 'case-brief-title';
  if (action === 'review_brief') return 'case-review-focus';
  if (action === 'open_approval_stage') return 'case-focus-action';
  if (action === 'cast_vote') return 'case-decision-stages-title';
  if (action === 'open_execution') return 'case-responsibility-execution';
  if (action === 'submit_execution_evidence' || action === 'review_execution_evidence') {
    return 'case-manual-execution-control';
  }
  if (action === 'record_outcome') return 'case-actual-outcome-title';
  if (action === 'view_record') return 'case-actual-outcome-title';
  if (action === 'view_case' && disabledReason === 'manual_execution_submission_required') {
    return 'case-responsibility-execution';
  }
  if (action === 'view_case' && disabledReason === 'manual_execution_review_required') {
    return 'case-responsibility-outcome';
  }
  if (action === 'accept_responsibility') {
    if (role === 'reviewer') return 'case-responsibility-review';
    if (role === 'executor') return 'case-responsibility-execution';
    if (role === 'outcome_reviewer') return 'case-responsibility-outcome';
    return 'case-responsibility-coordinator';
  }
  return 'case-workflow-title';
}

function currentAcceptedReviewSignoff(value: any, reviewer: any): any | null {
  if (reviewer?.status !== 'accepted' || !reviewer.assigneePubkey) return null;
  const timeline = Array.isArray(value?.reviewWorkflowEvents)
    ? value.reviewWorkflowEvents
    : Array.isArray(value?.timelineEvents) ? value.timelineEvents : [];
  const signoff = timeline.find((event: any) => (
    event?.eventType === 'review_conclusion_recorded'
    && event?.toState === 'signoff_granted'
    && event?.actorPubkey === reviewer.assigneePubkey
    && Number(event?.responsibilityVersion) === Number(reviewer.version)
    && Number(event?.briefDraftPostId) === Number(value?.briefDraftPostId)
    && Number(event?.briefDraftVersion) === Number(value?.briefDraftVersion)
    && typeof event?.briefSnapshotDigest === 'string'
    && event.briefSnapshotDigest === value?.briefSnapshotDigest
  )) ?? null;
  if (!signoff) return null;
  const relationshipError = governanceCaseReviewRelationshipSignoffGateError(
    { ...value, timelineEvents: timeline },
    reviewer.assigneePubkey,
    'signoff_granted',
  );
  return relationshipError ? null : signoff;
}

/**
 * Case detail uses the same actor-task owner as My Governance. This adds only
 * transport/UI guidance; it creates no workflow state and grants no authority.
 */
export function projectGovernanceCaseDetailExperience(
  value: any,
  actorPubkey: string | null,
  providerExecution: any = null,
  indexerObservation: GovernanceProviderIndexerObservation | null = null,
): GovernanceCaseDetailExperience {
  const terminal = value?.casePhase === 'closed' || value?.casePhase === 'archived';
  const task = actorPubkey
    ? projectGovernanceCaseInboxTask(
      value,
      actorPubkey,
      providerExecution,
      indexerObservation,
    )
    : null;
  return {
    realtimePolicy: terminal
      ? { mode: 'stopped', refreshAfterMs: null, terminal: true }
      : { mode: 'foreground_refetch', refreshAfterMs: 4000, terminal: false },
    nextRequiredAction: task
      ? {
          category: task.category,
          role: task.role,
          primaryAction: task.primaryAction,
          status: task.status,
          disabledReason: task.disabledReason,
          targetAnchor: governanceCaseDetailActionAnchor(
            task.primaryAction,
            task.role,
            task.disabledReason,
          ),
        }
      : {
          category: null,
          role: null,
          primaryAction: null,
          status: terminal ? 'completed' : 'blocked',
          disabledReason: terminal
            ? 'case_terminal'
            : actorPubkey ? 'actor_task_unavailable' : 'governance_actor_required',
          targetAnchor: null,
        },
  };
}
