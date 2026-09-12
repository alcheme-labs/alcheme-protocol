import { authenticatedApiFetchJson } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import {
    normalizeGovernedActionAppealNoAggravationBoundary,
    normalizeGovernedActionAppealRoutingReadback,
    type GovernedActionAppealNoAggravationBoundary,
    type GovernedActionAppealRoutingReadback,
} from '@/lib/api/governedActionAppealBoundary';

export type CircleGovernanceBindingStatus =
    | 'pending_mandate'
    | 'active'
    | 'superseded'
    | 'deactivated'
    | 'rejected';

export interface GovernanceMandateSummary {
    id: string;
    delegatorGovernanceHome: { type: string; ref: string };
    delegateAuthority: { type: string; ref: string };
    subject: { type: string; ref: string };
    status: 'offered' | 'countered' | 'active' | 'rejected' | 'expired' | 'deactivated';
    currentVersion: number;
    currentTermsDigest: string;
    purposeBindings: Array<{
        purpose: 'collective_decision' | 'operational_execution';
        actionType: string | null;
        actionPrefix: string | null;
    }>;
    purposes: Array<'collective_decision' | 'operational_execution'>;
    environment: string | null;
    network: string | null;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    acceptanceExpiresAt: string | null;
    minimumConstraints: GovernanceMandateMinimumConstraints | null;
    feePolicy: GovernanceMandateFeePolicy;
    effectPolicy: GovernanceMandateEffectPolicy | null;
    crossInstitutionDisclosureImpact: GovernanceCrossInstitutionDisclosureImpact | null;
    health: GovernanceMandateHealth | null;
}

export type GovernanceDisclosureDataCategory =
    | 'redacted_allegation'
    | 'subject_reference'
    | 'evidence_digest'
    | 'operation_status';

export interface GovernanceCrossInstitutionDisclosureDeclaration {
    dataCategories: GovernanceDisclosureDataCategory[];
    recipientRegions: string[];
    retentionDays: number;
}

export interface GovernanceCrossInstitutionDisclosureImpact {
    schemaVersion: 1;
    homeVisibility: 'secret';
    dataCategories: GovernanceDisclosureDataCategory[];
    recipientAuthority: { type: 'circle_governance_committee'; ref: string };
    recipientRoles: Array<'Owner' | 'Admin' | 'Moderator' | 'Member'>;
    recipientCount: number;
    recipientRegions: string[];
    purposes: Array<'collective_review' | 'operational_execution' | 'appeal_review'>;
    retention: { maximumDays: number; startsAt: 'each_disclosure' };
    secondaryUse: 'prohibited';
    revocation: 'stop_future_disclosure_preserve_authorized_history';
    memberNotice: 'before_first_disclosure_and_on_terms_change';
}

export interface GovernanceMandateHealth {
    status: 'active' | 'pending' | 'suspended' | 'inactive' | 'unavailable';
    reason:
        | 'within_effective_window'
        | 'acceptance_pending'
        | 'authority_binding_not_active'
        | 'effective_window_not_started'
        | 'effective_window_ended'
        | 'mandate_terminal'
        | 'mandate_owner_facts_unavailable';
    lifecycleStatus: string | null;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
    observedAt: string;
}

export interface GovernanceMandateFeePolicy {
    mode: 'no_fee' | 'capped_external_quote';
    economicBearer: 'delegator' | 'delegate' | 'shared';
    maximumAmountMinor: string | null;
    unit: string | null;
    settlement: 'not_managed_by_mandate';
    payerAuthority: 'separate_from_governance_authority';
}

export interface GovernanceMandateEffectPolicy {
    naturalExpiry: 'expire_at_mandate_end';
    revoke: 'revoke_immediately';
    transfer: 'supersede_immediately';
    appealSurvival: 'survives_until_resolved';
    fallbackAuthority: { type: string; ref: string };
}

export interface GovernanceMandateMinimumConstraints {
    riskFloor: 'low' | 'medium' | 'high' | 'critical';
    minimumApprovalThreshold: number;
    minimumTimelockSeconds: number;
}

export interface GovernanceMandateOperatorPolicyConstraints {
    roles: Array<'Owner' | 'Admin' | 'Moderator'>;
    maximumActors: number;
    maximumDurationSeconds: number;
    frequency: { windowSeconds: number; maximumInvocations: number };
    appeal: { maximumWindowSeconds: number };
    targetScope: 'target_circle_exact_subject';
}

export interface CircleGovernanceBinding {
    id: string;
    bindingType: 'local_auxiliary' | 'shared_committee' | 'self_governed';
    targetCircleId: number;
    actionType: string | null;
    actionPrefix: string | null;
    committeeCircleId: number;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    executionMode: 'off_chain' | 'on_chain_required' | 'hybrid' | string;
    status: CircleGovernanceBindingStatus;
    targetAuthorizationStatus: 'pending' | 'accepted' | 'rejected';
    committeeMandateStatus: 'pending' | 'accepted' | 'rejected';
    committeeMandateRequestId: string | null;
    mandateId: string | null;
    mandate: GovernanceMandateSummary | null;
    authorityCanonicalState: 'legacy_canonical' | 'shadow_compared' | 'mandate_canonical' | 'retired' | null;
    shadowComparedAt: string | null;
    mandateCanonicalAt: string | null;
    activatedAt: string | null;
    supersededAt: string | null;
    createdByPubkey: string | null;
    sourceRequestId: string | null;
    sourceDecisionDigest: string | null;
    sourceExecutionReceiptId: string | null;
    eligibleActorCount?: number | null;
    authorityTransparency: GovernanceAuthorityTransparency;
    metadata: Record<string, unknown> | null;
}

export interface GovernanceAuthorityTransparency {
    schemaVersion: 1;
    authorityMode: 'delegated_auxiliary' | 'delegated_committee' | 'self_governed' | 'unavailable';
    integrity: 'verified' | 'invalid';
    availability: 'active' | 'not_active' | 'invalid';
    delegator: { type: string; ref: string };
    delegate: { type: string; ref: string };
    subject: { type: string; ref: string };
    scope: { actionType: string | null; actionPrefix: string | null };
    mandate: { purposes: Array<'collective_decision' | 'operational_execution'>; version: number | null };
    decisionAuthority: Record<string, unknown>;
    operatorAuthority: Record<string, unknown>;
    executionAuthority: {
        type: 'action_contract';
        adapter: string;
        executor: 'resolved_at_execution' | 'operation_receipt';
        executionMode: string;
    };
    stageProvider: { authority: 'separate'; status: 'not_projected_in_binding' };
    receipt: {
        status: 'recorded' | 'not_recorded';
        integrity: 'verified' | 'purpose_mismatch';
        executionStatus: string | null;
        ref: string | null;
        actor: string | null;
    };
}

export interface CircleGovernanceBindingsPayload {
    circleId: number;
    recovery: GovernanceRecoveryReadback;
    resourceReadiness: CircleGovernanceResourceReadiness;
    fallback: {
        status: 'action_registry_resolved';
        reason: string;
        authorityTransparency: {
            schemaVersion: 1;
            authorityMode: 'action_registry_resolved';
            scope: 'per_action_and_subject';
            roleDirect: 'only_when_registered_action_allows_direct';
            highCriticalWithoutBinding: 'fail_closed';
            decisionAuthority: 'resolved_by_action_registry';
            operatorAuthority: 'not_granted_by_absence_of_binding';
            executionAuthority: 'resolved_at_execution';
            stageProvider: { authority: 'separate'; status: 'not_projected_in_binding' };
        };
    } | null;
    bindings: CircleGovernanceBinding[];
    committeeBindings: CircleGovernanceBinding[];
}

export interface CircleGovernanceResourceReadiness {
    schemaVersion: 1;
    network: 'solana:localnet';
    state: 'setup_required' | 'ready';
    ordinaryCapabilities: {
        circleCreation: 'resource_not_required';
        nativeGovernance: 'resource_not_required';
    };
    governanceHomeIdentity: 'active' | 'not_configured';
    governedResourceBinding: {
        state: 'not_configured' | 'pending_custody' | 'active' | 'degraded' | 'disabled';
        currentOwner: 'unavailable' | 'governed_resource_binding';
    };
    realmsRuntimeBinding: {
        state: 'not_configured' | 'pending_custody' | 'active' | 'degraded' | 'disabled';
        resourceBindingId: string | null;
        profileRef: string;
        profileVersion: number;
        authorityBindings: Array<{
            role: string;
            keyRef: string;
            publicKey: string | null;
            custodyStatus: string;
            status: string;
        }>;
        payerPolicy: {
            id: string;
            state: string;
            feePayerSignerRef: string | null;
            fundingBlockerCode: string | null;
        } | null;
        applicationIdentity: {
            authMethod: 'openbao_periodic_token';
            credentialRef: string;
            policyName: 'alcheme-realms-devnet-runtime-current';
            tokenPeriodSeconds: 86400;
            lastVerifiedAt: string;
            status: 'verified';
        } | null;
        providerFinality: {
            state: 'finalized';
            transactions: Array<{
                stepId: string;
                signature: string;
                slot: number;
                finalityTransitions: Array<{
                    state: 'submitted' | 'confirmed' | 'finalized';
                    authority:
                        | 'provider_signature_readback'
                        | 'solana_rpc_signature_status'
                        | 'solana_rpc_finalized_transaction';
                    slot?: number;
                }>;
            }>;
        } | null;
        reconciliation: {
            schemaVersion: 1;
            state: 'verified' | 'hold';
            blocker: 'provider_readback_outage' | 'provider_readback_conflict' | null;
            authority: 'independent_provider_readback';
            resourceBindingId: string;
            receiptId: string;
            receiptEvidenceDigest: string;
            expectedStateDigest: string;
            observedStateDigest: string | null;
            observedSlot: number | null;
            observedAt: string;
        } | null;
        votingPowerSecurity: RealmsVotingPowerSecurityProfile | null;
        delegationConformance: {
            schemaVersion: 1;
            state: 'authorized' | 'revoke_pending' | 'completed';
            requestId: string;
            decisionDigest: string;
            delegate: string;
            finalDelegate: null;
            setObservedSlot: number | null;
            revokeObservedSlot: number | null;
            historicalVoteInvariant: 'pending' | 'unchanged';
            providerMapping: 'weaker_provider_delegate_broader_than_vote_only_template_blocked';
            blocker: string | null;
        } | null;
        votingPowerChallenge: {
            schemaVersion: 1;
            state: 'suspended' | 'reopened';
            requestId: string;
            decisionDigest: string;
            suspendedAt: string;
            reopenedAt: string | null;
            preObservedSlot: number;
            postObservedSlot: number | null;
            historicalTallyInvariant: 'pending' | 'unchanged' | 'conflict';
            blocker: 'challenge_resolution_pending' | 'challenge_superseding_snapshot_required' | null;
        } | null;
        providerDisable: {
            schemaVersion: 1;
            state: 'disabled';
            requestId: string;
            decisionDigest: string;
            disabledAt: string;
            reason: 'governed_provider_disable';
            inFlightDispositionDigest: string;
            rollbackPolicy: {
                preSubmit: 'new_governed_restore_requires_independent_readback';
                postSubmit: 'forward_recovery_or_independent_reconciliation_only';
                chainFacts: 'never_rewritten';
                fallback: 'prohibited';
            };
            pauseBoundary: {
                authority: 'resource_pause_separate_from_workflow_freeze';
                workflowFreezeClaimsChainPaused: false;
                effect: 'provider_dispatch_disabled_no_chain_pause_claim';
                providerTransaction: 'not_submitted';
                providerStateReadback: 'canonical_resource_binding_disabled';
                onchainPauseInstruction: 'not_claimed';
                restoreAuthority: 'new_governed_restore_requires_independent_readback';
                rollback: 'forward_recovery_only_chain_facts_never_rewritten';
                fallbackAuthority: 'none';
            };
        } | null;
        emergencyOnchainPause: {
            schemaVersion: 1;
            state:
                | 'paused'
                | 'unpause_due'
                | 'unpause_blocked'
                | 'rollback_failed'
                | 'resumed_via_explicit_unpause'
                | 'resumed_via_onchain_timebound';
            requestId: string;
            decisionDigest: string;
            activatedAt: string;
            maxDurationSeconds: number;
            pauseEndsAt: string;
            pauseEnforcement: 'onchain_timebound' | 'explicit_unpause_required';
            trigger: string;
            scope: string;
            pauseAuthorityRef: string;
            unpauseAuthorityRef: string;
            memberNotificationDigest: string;
            ratificationRequestId: string;
            ratificationDecisionDigest: string;
            recoveryConditionsDigest: string;
            onchainPauseInstruction: 'hosted_app_trust_root.pause_app_trust_root';
            residualRisk: {
                permanentPausePossible: boolean;
                fallbackAuthority: 'none';
                workflowFreezeClaimsChainPaused: false;
                expiredAliasForbidden: true;
                resumedAliasForbidden: true;
            };
        } | null;
        programUpgrade: {
            schemaVersion: 1;
            state: 'verified' | 'finalized' | 'compromised' | 'verification_blocked';
            requestId: string;
            decisionDigest: string;
            upgradePayloadDigest: string;
            codeRelease: {
                repository: string;
                commit: string;
                buildArtifactSha256: string;
                auditStatus: 'passed' | 'waived_with_digest';
            };
            disposition: {
                upgradeAuthorityDisposition: string;
                tempBufferAuthorityRetireExpected: true;
            };
            residualRisk: {
                executedShown: false;
                mismatchOpensIncident: true;
                fallbackAuthority: 'none';
            };
        } | null;
    };
    grantSettlementReadiness: {
        schemaVersion: 1;
        evaluatorRef: 'p06.grant_settlement_readiness';
        evaluatorVersion: 1;
        state: 'not_applicable' | 'setup_required' | 'ready';
        activeAgreementCount: number;
        readyAgreementCount: number;
        setupRequiredAgreementCount: number;
        evaluations: Array<{
            agreementId: string;
            caseId: string;
            trancheIntentId: string | null;
            projectRef: string;
            recipientRef: string;
            budgetUnit: string;
            contractualUnits: string;
            integrity: 'verified' | 'stale' | 'invalid' | 'not_evaluated';
            state: 'setup_required' | 'ready';
            evaluationVersion: number;
            evaluationDigest: string | null;
            evaluatedAt: string | null;
            resource: GovernanceGrantSettlementReadiness['resource'] | null;
            authority: GovernanceGrantSettlementReadiness['authority'] | null;
            assetAuthority: GovernanceGrantSettlementReadiness['assetAuthority'] | null;
            payer: GovernanceGrantSettlementReadiness['payer'] | null;
            fundingReadback: GovernanceGrantSettlementReadiness['fundingReadback'] | null;
            payout: GovernanceGrantSettlementReadiness['payout'] | null;
            activePayoutRequest: {
                id: string;
                state: 'active' | 'accepted';
                openedAt: string;
            } | null;
            blockerCodes: string[];
        }>;
        blockerCodes: string[];
    };
    payerPolicy: {
        state: 'not_configured' | 'present_unverified';
        activeCount: number;
    };
    assetAuthorityPolicy: {
        state: 'not_configured' | 'present_unverified';
        activeCount: number;
    };
    externalResourceActions: 'blocked_setup_required' | 'provider_bound';
    providerExecution: 'unavailable' | 'available';
    authorityVerification: 'not_authorized' | 'authorized';
    realmsProviderTrust: {
        profileRef: string;
        profileVersion: number;
        profileDigest: string;
        chainId: 'solana:devnet';
        programId: string;
        deploymentVerification: 'snapshot_verified_read_only';
        observedAtSlot: number;
        activationReadback: 'required';
        decoderConformance: 'selected_accounts_verified';
        activation: 'not_activated' | 'active';
        walletCustody:
            | 'verified_pre_wallet_pending_runtime_owner'
            | 'verified_pre_wallet_no_keys'
            | 'verified_wallet_keys_pending_provider'
            | 'verified_wallet_keys_provider_active';
        keyCustodyRecord: {
            recordRef: string;
            decisionRef: 'DEC-P06-M3-SOLO-DEVNET-CUSTODY-v1';
            signerProvider: 'openbao_transit';
            serviceTopology: 'local_single_node_integrated_raft';
            endpoint: 'https://127.0.0.1:18200';
            networkExposure: 'localhost_only';
            transitMount: 'transit';
            keyContracts: Array<{
                keyRef: string;
                role: 'bootstrap_authority' | 'proposer' | 'voter' | 'executor' | 'fee_payer';
                allowedOperations: string[];
                publicKey: string | null;
                status: 'pending_generation' | 'verified';
            }>;
            keyAlgorithm: 'ed25519';
            exportable: false;
            allowPlaintextBackup: false;
            applicationAccess: 'exact_key_sign_and_read_only';
            recoveryMaterial: {
                provider: 'keepassxc';
                purpose: 'openbao_unseal_and_recovery_material_only';
                databaseName: 'Alcheme Devnet Governance.kdbx';
                encryptedBackup: 'required_independent_location';
            };
            verification: {
                raftPersistence: 'verified';
                restartSealUnseal: 'verified';
                tlsLocalhost: 'verified';
                auditReadback: 'verified';
                backupRestore: 'verified';
                leastPrivilegeDenial: 'verified';
                solanaCanonicalMessageConformance: 'verified';
                runtimeOwnerReadback: 'pending' | 'verified';
                receipt: {
                    openBaoVersion: '2.6.0';
                    raftNodeId: 'alcheme-realms-devnet-1';
                    clusterId: string;
                    snapshotSha256: string;
                    snapshotBytes: number;
                    snapshotPrimaryRef: 'openbao_devnet_external_snapshot_primary';
                    snapshotIndependentBackupRef: 'alcheme_devnet_governance_encrypted_snapshot_copy';
                    originalUnsealVerifiedAt: string;
                    isolatedRestoreVerifiedAt: string;
                };
            };
            primaryMaintainer: 'Taiyi';
            recoveryOwner: 'Taiyi';
            samePersonRecoveryException: true;
            inventoryOwner: 'payer_policy_and_resource_authority_binding';
            fundingSource: 'solana_devnet_faucet_only';
            feePayerAuthoritySeparation: 'required';
            lossProcedure: 'fail_closed_rebootstrap_devnet_environment_no_owner_operator_fallback';
            environmentRetention: 'repeatable_bootstrap_with_explicit_retirement_evidence';
            status:
                | 'verified_pre_wallet_pending_runtime_owner'
                | 'verified_pre_wallet_no_keys'
                | 'verified_wallet_keys_pending_provider'
                | 'verified_wallet_keys_provider_active';
            lastVerifiedAt: string;
        };
        devnetExecutionScope: 'approved';
        authorizationDecisionRef: 'DEC-P06-M3-REALMS-DEVNET-ONLY-v1';
        mainnet: 'unavailable';
        blockerCodes: string[];
    };
    blockerCodes: string[];
}

export interface RealmsVotingPowerSecurityProfile {
    schemaVersion: 1;
    readinessState: 'unavailable';
    mode: 'standard_token_weight_no_addins';
    source: {
        authority: 'independent_provider_readback';
        chainId: 'solana:devnet';
        profileRef: string;
        profileVersion: number;
        programId: string;
        realm: string;
        governingTokenMint: string;
        commitment: 'finalized';
        snapshotSlot: number;
    };
    tokenOwnerRecords: Array<{
        role: 'proposer' | 'voter';
        recordRef: string;
        owner: string;
        depositAmount: string;
        governanceDelegate: null;
        unrelinquishedVotesCount: number;
        outstandingProposalCount: number;
    }>;
    voteRecord: { recordRef: string; voter: string; yesVoteWeight: string };
    sameResourceRoot: {
        schemaVersion: 1;
        rootRef: string;
        rootDigest: string;
        paths: Array<{
            kind: 'realm_config' | 'governing_token_mint' | 'token_owner_record' | 'vote_record'
                | 'voter_weight_addin' | 'max_voter_weight_addin';
            ref: string | null;
            status: 'observed' | 'not_configured';
        }>;
        duplicatePathCount: number;
        cycleDetected: boolean;
        recordExpiry: 'not_applicable_no_vwr';
    };
    delegationGraph: {
        edges: never[];
        graphDigest: string;
        duplicateResourceCount: number;
        cycleDetected: boolean;
        maxDepthObserved: number;
        mapping: 'exact_no_delegate';
    };
    protections: {
        depositLock: 'standard_token_owner_record_vote_lifecycle_only';
        snapshotDelay: 'not_configured';
        cooldown: 'not_configured';
        recordExpiry: 'not_applicable_no_vwr';
        borrowedCapitalRisk: 'unmitigated';
        flashGovernanceRisk: 'unmitigated';
    };
    plugins: {
        voterWeightAddin: 'not_configured';
        maxVoterWeightAddin: 'not_configured';
        vsr: 'not_configured';
        customPlugins: 'unavailable';
    };
    enforcement: {
        deposit: 'spl_governance_token_owner_record';
        duplicateVote: 'spl_governance_vote_record';
        weightedTemplateActivation: 'blocked';
    };
    blockerCodes: string[];
    profileDigest: string;
}

export interface GovernanceGrantSettlementReadiness {
    schemaVersion: 1;
    evaluator: { ref: 'p06.grant_settlement_readiness'; version: 1 };
    evaluationVersion: number;
    state: 'setup_required' | 'ready';
    scope: {
        circleId: number;
        homeIdentityBindingId: string;
        agreementId: string;
        allocationArtifactId: string;
        projectRef: string;
        recipientRef: string;
        budgetUnit: string;
        contractualUnits: string;
        termsDigest: string;
        lifecycleDigest: string;
        lifecycleVersion: number;
        governingDecisionRequestId: string;
        governingDecisionDigest: string;
    };
    resource: {
        state: 'not_bound' | 'invalid' | 'verified';
        bindingId: string | null;
        chainId: string | null;
        provider: string | null;
        contractVersion: number | null;
        profileRef: string | null;
        profileVersion: number | null;
        resourceRef: string | null;
        stateDigest: string | null;
        verifiedSlot: string | null;
    };
    authority: {
        state: 'not_bound' | 'invalid' | 'verified';
        operation: 'grant_payout';
        bindingRefs: string[];
    };
    assetAuthority: {
        state: 'not_configured' | 'invalid' | 'verified';
        policyRef: string | null;
        policyDigest: string | null;
    };
    payer: {
        state: 'not_configured' | 'invalid' | 'verified';
        policyRef: string | null;
        policyDigest: string | null;
        fundingBlockerCode: string | null;
    };
    fundingReadback: {
        state: 'missing' | 'invalid' | 'verified';
        availableUnits: string | null;
        slot: string | null;
        stateDigest: string | null;
        finality: 'finalized' | null;
    };
    payout: {
        intent: 'not_created' | 'contractual_pending_settlement' | 'blocked_terminated' | 'paid';
        intentRef: string | null;
        payoutRef: string | null;
        paid: boolean;
        providerFinality: 'finalized' | null;
    };
    blockerCodes: string[];
    evaluatedAt: string;
    sourceDigest: string;
    evaluationDigest: string;
}

export interface RealmsProviderTrustReadback {
    status: 'verified_read_only';
    profileRef: string;
    profileVersion: number;
    profileDigest: string;
    chainId: 'solana:devnet';
    genesisHash: string;
    programId: string;
    programDataAddress: string;
    upgradeAuthority: string;
    lastDeployedSlot: number;
    deployedProgramBytesSha256: string;
    decoder: {
        package: string;
        realm: string;
        governance: string;
        realmConfig: string;
        addins: 'absent';
    };
    commitment: 'finalized';
    observedSlot: number;
    observedAt: string;
    attemptCount: number;
    activation: 'not_activated';
    runtimeSigner: {
        status: 'not_configured' | 'pending_keys' | 'verified_read_only' | 'unavailable';
        signerProvider: 'openbao_transit';
        chainId: 'solana:devnet';
        profileRef: string;
        profileVersion: number;
        resourceBindingId: string | null;
        applicationIdentity: {
            authMethod: 'openbao_periodic_token';
            credentialRef: string;
            policyName: 'alcheme-realms-devnet-runtime-current';
            tokenPeriodSeconds: 86400;
            status: 'not_configured' | 'pending_keys' | 'verified' | 'unavailable';
        };
        keys: Array<{
            role: string;
            keyRef: string;
            publicKey: string | null;
            status: 'pending_generation' | 'verified' | 'unavailable';
        }>;
        observedAt: string | null;
        blocker: string | null;
    };
}

export interface SquadsProviderTrustReadback {
    status: 'verified_read_only';
    profileRef: string;
    profileVersion: 1;
    profileDigest: string;
    chainId: 'solana:devnet';
    programId: string;
    programDataAddress: string;
    upgradeAuthority: string;
    deployedProgramBytesSha256: string;
    sourceReproducibility: 'unverified';
    commitment: 'finalized';
    observedSlot: number;
    observedAt: string;
    activation: 'not_activated';
    programConfig: {
        address: string;
        authority: string;
        treasury: string;
        multisigCreationFeeLamports: string;
    };
    decoder: {
        package: '@sqds/multisig@2.1.4';
        threshold: 2;
        memberCount: 3;
        proposalState: 'Executed';
    };
    runtimeSigner: {
        status: 'not_configured' | 'pending_keys' | 'verified_read_only';
        signerProvider: 'openbao_transit';
        chainId: 'solana:devnet';
        profileRef: string;
        profileVersion: 1;
        resourceBindingId: string | null;
        bindingStatus: 'not_configured' | 'pending_custody' | 'active' | 'degraded' | 'disabled';
        identities: Array<{
            role: string;
            keyRef: string;
            publicKey: string | null;
            policyName: string;
            credentialRef: string;
            tokenPeriodSeconds: 86400;
            status: 'pending_generation' | 'verified';
        }>;
        observedAt: string | null;
        blocker: string | null;
    };
    reconciliation: {
        state: 'verified' | 'blocked';
        resourceBindingId?: string;
        observedStateDigest?: string;
        observedSlot?: number;
        observedAt?: string;
        blocker?: string;
        executionProgress?: {
            multisigResourceRef: string;
            threshold: 2;
            memberCount: 3;
            approvedMemberCount: 2;
            approvedRoles: ['proposer_member', 'approver_member'];
            pendingRequiredApprovals: 0;
            nonApprovingMemberRoles: ['executor_member'];
            transactionCount: number;
            transactions: Array<{
                stepId: string;
                signature: string;
                slot: number;
                finality: 'finalized';
            }>;
            proposalState: 'executed';
            vaultTransactionState: 'executed';
            executionResult: 'executed_finalized';
            noRealAssets: true;
        };
    } | null;
    grantSettlement: {
        state: 'active' | 'hold';
        resourceBindingId: string;
        resourceRef: string;
        verifiedSlot: string | null;
        stateDigest: string | null;
        providerFinality: 'finalized' | null;
        payoutSignature: string | null;
        recipient: string | null;
        amountLamports: string | null;
        vaultBalanceAfterLamports: string | null;
    } | null;
}

export interface SquadsExistingResourceAdoptionInput {
    operation: 'adopt_existing_finalized_no_asset_resource';
    targetCircleId: 35;
    originCircleRef: string;
    historicalRequestRef: string;
    addresses: {
        multisig: string;
        vault: string;
        proposal: string;
        vaultTransaction: string;
    };
    authorities: Array<{
        role: 'config_authority' | 'proposer_member' | 'approver_member' | 'executor_member' | 'fee_payer';
        publicKey: string;
    }>;
    transactions: Array<{
        stepId: 'create_multisig' | 'create_vault_transaction' | 'create_proposal'
            | 'approve_by_proposer' | 'approve_by_approver' | 'execute_vault_transaction';
        signature: string;
        slot: number;
    }>;
    memoText: string;
    expectedStateDigest: string;
}

export type GovernedActionRoutingPath =
    | 'direct_operation'
    | 'governance_review'
    | 'blocked';

export interface GovernedActionRoutingReadback {
    schemaVersion: 1;
    circleId: number;
    matrix: Array<{
        actionType: string;
        targetType: string;
        impact: 'low' | 'medium' | 'high' | 'critical';
        governanceMode: 'optional' | 'required_when_bound' | 'always_required';
        defaultPath: GovernedActionRoutingPath;
        currentPath: GovernedActionRoutingPath;
        reason: string;
        routingPolicy: {
            bindingId: string;
            actionType: string;
            subjectType: 'circle';
            subjectRef: string;
            policyId: string;
            policyVersionId: string;
            policyVersion: number;
            effectiveAt: string;
        } | null;
    }>;
    recentDirectOperations: Array<{
        actionType: string;
        receipt: {
            id: string;
            policyVersionRef: string;
            reasonCode: string;
            executionStatus: string;
            executionRef: string | null;
            reviewAt: string | null;
            appealRef: string;
            receiptDigest: string;
        };
        effect: {
            state: string;
            stateVersion: number;
            effectDigest: string;
            activatedAt: string;
        };
    }>;
}

export interface GovernedActionOperationDetail {
    schemaVersion: 1;
    canonicalUrl: string;
    circleId: number;
    actionType: string;
    invocation: {
        id: string; state: string; subjectType: string; subjectRef: string;
        createdAt: string; updatedAt: string; previousReceiptRef: string | null;
    };
    contract: {
        id: string; version: number; executionAdapter: string; executionDomain: string;
        riskFloor: string; reviewTiming: string; idempotencyScope: string; definitionDigest: string;
    };
    authority: {
        snapshotId: string; snapshotDigest: string; sourceType: string; sourceRef: string;
        sourceVersion: string | null; decisionPath: string; resolverVersion: string;
        validFrom: string; validUntil: string | null;
        binding: {
            id: string; purpose: string; status: string; bindingDigest: string;
            effectiveFrom: string; effectiveUntil: string | null;
        };
    };
    executionBoundary: {
        operationAuthority: 'exact_invocation_snapshot_only';
        votingAuthority: 'not_granted_by_operation';
        proposalMutationAuthority: 'not_granted_by_operation';
        authorshipAuthority: 'not_granted_by_operation';
        circleAuthority: 'not_granted_by_operation';
        payerAuthority: 'separate_not_granted_by_operation';
        serviceRoleAuthority: 'limited_task_only_not_circle_authority';
        provider: {
            adapter: string;
            authority: 'exact_execution_only';
            authoritativeFinality: 'not_asserted';
        };
    };
    receipt: {
        id: string; invocationId: string; attemptKey: string; actorPubkey: string;
        subjectType: string; subjectRef: string;
        roleAssignmentProof: {
            bindingId: string; sourceType: string; sourceRef: string; sourceVersion: string | null;
            profileVersionRef: string | null; decisionPath: string;
            selector: Record<string, unknown>; selectorDigest: string;
        };
        policyVersionRef: string; reasonCode: string; limits: Record<string, unknown>;
        limitsDigest: string; payloadDigest: string; resultDigest: string;
        executionStatus: string; executionRef: string | null; capabilityExpiresAt: string | null;
        reviewAt: string | null; appealRef: string; appealWindowEndsAt: string | null;
        escalationRef: string; receiptDigest: string; startedAt: string; completedAt: string;
    };
    effect: {
        id: string; state: string; stateVersion: number; effectDigest: string;
        activatedAt: string; updatedAt: string;
        expiry: { status: 'not_configured' | 'expired'; at: string | null };
        revocation: { status: 'not_revoked' | 'revoked'; at: string | null };
        ratification: { status: 'not_required' | 'required' };
        events: Array<{
            id: string; sequence: number; fromState: string | null; toState: string;
            reasonCode: string; actorPubkey: string | null; sourceReceiptId: string | null;
            occurredAt: string; transitionDigest: string;
        }>;
    };
    appeal: {
        status: 'available' | 'expired' | 'opened' | 'resolved' | 'unavailable';
        windowEndsAt: string | null;
        routing: GovernedActionAppealRoutingReadback;
        resolutionBoundary: GovernedActionAppealNoAggravationBoundary;
        currentActorAppeal: null | {
            id: string; state: string; resolutionPath: string; governanceCaseRef: string | null;
            appealResolutionArtifactRef: string | null; openedAt: string; resolvedAt: string | null;
            resolution: null | {
                id: string; outcome: string; reasonCode: string; effectUpdateRef: string | null;
                resolvedAt: string; resolutionDigest: string;
            };
        };
    };
    recurrence: Array<{
        receiptId: string; actionType: string; executionStatus: string; effectState: string | null;
        completedAt: string; canonicalUrl: string;
    }>;
    escalation: {
        ref: string;
        trigger: 'disputed' | 'repeated' | null;
        caseUrl: string | null;
    };
}

export interface GovernanceRecoveryReadback {
    mode: 'prebound_recovery_circle' | 'manual_recovery_only';
    status: 'not_configured' | 'available' | 'activation_pending' | 'ratification_pending' | 'ratified' | 'ratification_failed' | 'consumed';
    automaticRecoveryConfigured: boolean;
    warning: string;
    trigger: 'zero_eligible_electorate' | null;
    recoveryCircleId: number | null;
    frozenActorCount: number;
    unanimityRequired: boolean;
    maxCostMinor: '0';
    activationTtlSeconds: number;
    ratificationTtlSeconds: number;
    ratificationDeadline: string | null;
    failClosed: true;
    authorityContinuity: GovernanceAuthorityContinuityReadback;
    authorityHealth: GovernanceAuthorityHealthReadback;
    resourceAuthorityRecovery: GovernanceResourceAuthorityRecoveryReadback;
}

export interface GovernanceResourceAuthorityRecoveryReadback {
    authority: 'canonical_resource_authority_and_provider_readback';
    status: 'not_configured' | 'healthy' | 'recovery_pending' | 'rotation_failed' | 'permanently_blocked_external_authority';
    resourceBindingCount: number;
    authorityBindingCount: number;
    verifiedProviderReadbackCount: number;
    acceptedArtifacts: Array<{
        requestId: string;
        decisionDigest: string;
        provider: string;
        resourceBindingId: string;
    }>;
    resourceBindings: Array<{
        id: string;
        provider: string;
        capability: string;
        status: string;
        resourceRef: string | null;
        ownerProgramRef: string;
        verifiedSlot: number | null;
        stateDigest: string | null;
        providerReadback: 'verified' | 'missing';
        authorityBindings: Array<{
            id: string;
            role: string;
            status: string;
            currentAuthority: string | null;
            custodyStatus: string;
            verifiedSlot: number | null;
            stateDigest: string | null;
        }>;
    }>;
    rotation: {
        providerNativeRotationAvailable: false;
        externalSignerRevokeReadback: 'verified' | 'not_verified' | 'not_applicable';
        circleOwnerAdminFallbackAllowed: false;
        fallbackAuthority: 'none';
    };
    unfulfilledObligations: string[];
    residualRisks: string[];
}

export interface GovernanceAuthorityHealthReadback {
    status: 'not_checked' | 'fresh' | 'stale' | 'degraded' | 'drifted';
    stateVersion: number;
    checkedAt: string | null;
    staleAt: string | null;
    committeeEligibleCount: number;
    committeeSignedCount: number;
    operatorProof: 'wallet_signed_signal' | 'missing' | 'not_checked';
    targetManagerProof: 'authenticated_wallet_session' | 'not_checked';
    recoveryPanelStatus: 'not_configured' | 'wallet_signed_signal' | 'degraded_missing_wallet_proof' | 'not_checked';
    externalAuthorityStatus: 'p06_provider_readback_required';
    evidenceDigest: string | null;
    evidenceIntegrity: 'verified' | 'not_recorded' | 'drifted';
    highRiskPlanGate: 'allowed' | 'blocked_stale' | 'blocked_degraded' | 'blocked_emergency_freeze' | 'blocked_review_overdue' | 'not_enforced_until_first_check';
    faultAssessment: {
        faultClass: 'electorate_inactivity' | 'lost_key' | 'compromised_key';
        affectedActorPubkey: string;
        evidenceRef: string;
        emergencyFreeze: {
            trigger: string;
            actorQuorum: {
                actorSnapshotDigest: string;
                eligibleActorCount: number;
                approvalThreshold: number;
                decisionMechanismKind: 'equal_weight_threshold';
                operatorSignatureRequired: true;
            };
            scope: 'new_high_and_critical_plans';
            maximumDurationSeconds: number;
            activatedAt: string;
            freezeEndsAt: string;
            recovery: 'new_accepted_wallet_signed_health_case_without_fault';
            mandatoryReview: 'required_before_release';
            reviewDueAt: string;
            reviewStatus: 'required' | 'overdue';
            payloadMutation: 'forbidden';
            authorityMutation: 'forbidden';
            decisionOverride: 'forbidden';
            notification: 'circle_managers_and_frozen_committee';
            resourcePause: 'not_claimed_p06_authority_required';
        };
    } | null;
    warning: string;
}

export interface GovernanceAuthorityContinuityReadback {
    status: 'not_applicable' | 'healthy' | 'manual_recovery_pending' | 'permanently_blocked_governance_authority' | 'drifted';
    stateVersion: number;
    trigger: 'zero_eligible_electorate' | 'signer_threshold_unreachable' | null;
    canonicalAuthority: 'verified' | 'unverified' | 'not_applicable';
    offPlatformReconstitution: 'not_verified' | 'not_applicable';
    externalAuthorityStatus: 'p06_provider_readback_required';
    fallbackAuthority: 'none';
    reporterAuthority: 'none';
    evidenceDigest: string | null;
    evidenceIntegrity: 'verified' | 'not_recorded' | 'drifted';
    startedAt: string | null;
    terminalAt: string | null;
    canRetryTargetPreflight: boolean;
    canRecordPermanentBlock: boolean;
    faultControls: {
        waitingPeriod: 'until_lawful_authority_restored';
        freeze: 'new_governance_except_recovery_and_history';
        successor: 'prebound_recovery_circle_or_manual_reconstitution';
        notification: 'circle_managers_and_current_members';
        providerAuthority: 'p06_provider_readback_required';
    } | null;
    warning: string;
}

export interface CircleGovernanceCommitteeProfile {
    circleId: number;
    availabilityStatus: 'disabled' | 'enabled';
    allowedActionPrefixes: string[] | null;
    defaultStrategy: string;
    electorateTemplate: CircleGovernanceCommitteeElectorateTemplate;
    windowMinutes: number | null;
    updatedByPubkey: string | null;
    availabilityOpenedAt: string | null;
    availabilityExpiresAt: string | null;
    lastMandateRequestId: string | null;
    lastMandateRequestAt: string | null;
    activatedAt: string | null;
    deactivatedAt: string | null;
}

export interface CircleGovernanceCommitteeElectorateTemplate {
    source: 'active_committee_members';
    weight: { mode: 'equal_one' };
    threshold: {
        mode: 'default_majority' | 'fixed_count' | 'unanimity';
        value: number | null;
    };
    ballotDisclosure: {
        mode: GovernanceBallotDisclosureMode;
    };
    quadraticVoiceCredits: {
        budgetPerActor: number | null;
    };
}

export type GovernanceBallotDisclosureMode =
    | 'public'
    | 'member'
    | 'eligible_only'
    | 'aggregate_until_close'
    | 'provider_defined';

export interface GovernanceProviderExecutionPlanReadback {
    schemaVersion: 1;
    authority: 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt';
    outcome: 'provider_execution_plan';
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    executionMode: 'realms' | 'squads';
    requestId: string;
    decisionDigest: string;
    artifactLinkage: {
        status: 'not_applicable_provider_binding_activation' | 'mapped_execution_resource_artifact';
        artifactRef: string | null;
        artifactDigest: string | null;
        resourceBindingId: string | null;
        titleInferenceAllowed: false;
    };
    actionIntentDigest: string;
    planDigest: string;
    terminalTransactionAttemptDigest: string;
    actionSetDigest: string;
    intentBoundary: {
        governanceInput: 'canonical_request_payload';
        providerActions: 'verified_provider_plan_and_manifest';
        retryVariantFieldsExcluded: ['recent_blockhash', 'fee_quote', 'provider_attempt_reference'];
    };
    aggregateStatus: 'executed';
    aggregateRule: 'all_ordered_steps_finalized';
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
        subject: { type: 'governed_resource'; ref: string };
        network: 'solana:devnet';
        operation: string;
        instructionSemantics: string;
        humanSummary: string;
        programScope: string[];
        accountScope: Array<{ role: string; ref: string }>;
        assetChange: string;
        dependsOnActionIds: string[];
        atomicity: 'single_provider_transaction';
        constraints: {
            simulation: string;
            enforcement: 'provider_onchain' | 'multisig_threshold';
            opaqueInstructions: false;
            idempotencyKey: string;
            deadline: { kind: 'last_valid_block_height'; value: number };
        };
        attempts: [{
            ordinal: 1;
            status: 'finalized';
            providerReference: string;
            slot: number;
            recentBlockhash: string;
            messageDigest: string;
            manifestDigest: string;
        }];
    }>;
}

export interface GovernanceProviderActionSafetyBoundary {
    schemaVersion: 1;
    authority: 'reviewed_provider_adapter_instruction_safety';
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    executionMode: 'realms' | 'squads';
    chainId: 'solana:devnet';
    resourceRef: string;
    ownerProgramRef: string;
    decisionLinkage: {
        requestId: string;
        decisionDigest: string;
        actionIntentDigest: string;
    };
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
}

export interface GovernanceServicePayerAuthorityBoundary {
    schemaVersion: 1;
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
}

export interface GovernanceProviderCostControlBoundary {
    schemaVersion: 1;
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
}

export interface GovernanceAssetAuthoritySponsorBoundary {
    schemaVersion: 1;
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
}

export interface GovernanceProviderResourceExecutionAdmissionReadback {
    schemaVersion: 1;
    authority: 'canonical_governed_resource_and_active_authority_bindings';
    state: 'admitted_for_exact_provider_execution';
    source: 'explicit_request_preflight_or_terminal_receipt_resource_id';
    titleInferenceAllowed: false;
    requestId: string;
    decisionDigest: string;
    binding: {
        id: string;
        cluster: string;
        provider: string;
        providerModule: 'realms_provider_binding' | 'squads_provider_binding';
        capability: string;
        resourceType: string;
        resourceRef: string;
        ownerProgramRef: string;
        purpose: string;
        profileRef: string;
        profileVersion: number;
        verifiedSlot: number;
        stateDigest: string;
        status: 'active';
    };
    controllingAuthorities: Array<{
        bindingId: string;
        role: string;
        publicAuthority: string;
        custodyProvider: string;
        custodyStatus: string;
        allowedOperations: string[];
        keyRefExposed: false;
    }>;
    artifactMapping: {
        artifactId: string;
        artifactDigest: string;
        decisionDigest: string;
        resourceBindingId: string;
        source: 'exact_accepted_request_payload';
        titleInferenceAllowed: false;
        adapterRef: 'realms_provider_binding' | 'squads_provider_binding';
        enforcementBinding: {
            resourceBindingId: string;
            authorityScopeDigest: string;
            authorityBindingIds: string[];
            providerModule: 'realms_provider_binding' | 'squads_provider_binding';
            mode: 'provider_onchain' | 'multisig_threshold';
            allowedAdapter: 'realms_provider_binding' | 'squads_provider_binding';
            allowedOperations: string[];
            residualBypassRisk: string;
            bypassPrevented: false;
            verificationState: 'frozen_pending_live_preflight';
            contractVersion: number;
            profileVersion: number;
        };
    } | null;
    executionAdmission: {
        exactResourceActive: true;
        exactOwnerProgramVerified: true;
        controllingAuthorityActive: true;
        providerStateReadbackVerified: true;
    };
}

export interface GovernanceProviderExecutionReadback {
    schemaVersion: 1;
    status: 'executed' | 'failed' | 'execution_expired' | 'held';
    integrity: 'verified' | 'invalid';
    blocker: string | null;
    receiptId: string | null;
    evidenceDigest: string | null;
    executedAt: string | null;
    privateEvidenceRelease?: {
        schemaVersion: 1;
        status: 'not_sent' | 'sent' | 'blocked';
        integrity: 'verified' | 'invalid';
        blocker: string | null;
        provider: 'realms_provider_binding' | 'squads_provider_binding';
        purpose: string;
        minimumPayloadDigest: string;
        authorization: {
            authority: 'governance_case_frozen_evidence_policy';
            authorizationDigest: string;
            packageCount: number | null;
        };
        sentAt: string | null;
        providerResult: null | {
            source: 'provider_native_result';
            status: string;
            receivedAt: string;
        };
        deletionReceipt: null | {
            authority: 'provider_native_deletion_or_retention_receipt';
            status: string;
            receiptDigest: string | null;
            receivedAt: string | null;
        };
        completionAuthority:
            | 'not_applicable_no_private_evidence_sent'
            | 'provider_result_and_deletion_receipt'
            | 'provider_result_and_deletion_receipt_required';
        httpSuccessSelfProvesCompletion: false;
    };
    expiry?: {
        schemaVersion: 1;
        state: 'execution_expired';
        authority: 'solana_rpc_finalized_block_height_and_missing_signature_status';
        commitment: 'finalized';
        planDigest: string;
        stepId: string;
        manifestDigest: string;
        messageDigest: string;
        providerReference: string;
        lastValidBlockHeight: number;
        observedBlockHeight: number;
        signatureStatus: 'not_found';
        providerEffect: 'not_observed';
        automaticRetryAllowed: false;
        sameIntentRetry: 'manual_only';
        nextGate: 'manual_same_intent_retry_or_governed_terminal_abandonment';
    };
    retry?: {
        mode: 'same_request_only';
        requestId: string;
        attemptCount: number;
        lastAttemptAt: string;
        nextRetryAt: string;
    };
    recovery?: {
        category: 'provider_backoff' | 'funding_blocked' | 'simulation_failed' | 'submission_rejected' | 'finality_ambiguous' | 'blockhash_expired' | 'provider_state_conflict' | 'provider_outage' | 'manual_review';
        action: 'wait_for_persisted_retry_window' | 'open_funding_amendment_or_restore_existing_payer' | 'repair_preflight_or_open_superseding_case' | 'inspect_rejection_then_repair_or_open_superseding_case' | 'authoritative_readback_before_any_resend' | 'prepare_same_request_rebuild_after_authoritative_expiry' | 'independent_reconciliation_required' | 'restore_readback_then_reconcile_same_receipt' | 'inspect_existing_attempt_without_resend';
        automaticMutation: false;
        authorityChangeAllowed: false;
        payerChangeAllowed: false;
        acceptedDecisionPreserved: true;
        decisionMutationAllowed: false;
        retryMode: 'same_request_only' | 'blocked_until_recovery_fact';
        nextEligibleAt: string | null;
    };
    effect?: string;
    provider?: {
        module: 'realms_provider_binding' | 'squads_provider_binding';
        chainId: 'solana:devnet';
        profileRef: string;
        profileVersion: number;
        finality: 'finalized';
        resourceRef: string;
        ownerProgramRef: string;
        observedSlot: number;
        lastTransactionSlot: number | null;
        stateDigest: string;
        proposalState: 'completed' | 'executed';
        instructionExecutionStatus?: 'success';
        vaultTransactionState?: 'executed';
        approvedMemberCount?: number;
        noRealAssets: true;
        transactionCount: number;
        providerResourceLifecycle?: GovernanceProviderResourceLifecycleReadback;
        proposalTransactionReadback?: {
            schemaVersion: 1;
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
        };
        executionPlanReadback?: GovernanceProviderExecutionPlanReadback;
        providerActionSafetyBoundary?: GovernanceProviderActionSafetyBoundary;
        servicePayerAuthorityBoundary?: GovernanceServicePayerAuthorityBoundary;
        attemptOwner?: {
            schemaVersion: 1;
            authority: 'canonical_cost_preflight';
            preflightId: string;
            payerPolicyId: string;
            actionIntentDigest: string;
            transactionAttemptDigest: string;
            status: 'consumed';
            requestId: string;
            decisionDigest: string;
        };
        retryBoundary?: {
            schemaVersion: 1;
            authority: 'canonical_action_intent_and_transaction_attempt';
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
        };
        expiredAttemptHistory?: {
            schemaVersion: 1;
            authority: 'canonical_cost_preflight_checkpoint';
            attempts: Array<{
                stepId: string;
                manifestDigest: string;
                messageDigest: string;
                recentBlockhash: string;
                lastValidBlockHeight: number;
                expiredAtBlockHeight: number;
                disposition: 'authoritative_expiry_same_intent_manual_retry';
            }>;
        };
        transactions: Array<{
            stepId: string;
            signature: string;
            slot: number;
            messageDigest: string;
            manifestDigest: string;
            attemptContext?: {
                schemaVersion: 1;
                authority: 'canonical_provider_attempt_inventory_and_terminal_receipt';
                persistenceAuthority: 'canonical_provider_checkpoint_and_payer_policy';
                transactionAttemptDigest: string;
                attemptOrdinal: number;
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
            };
            humanReadableAction?: {
                schemaVersion: 1;
                authority: 'verified_provider_plan_and_receipt';
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
            };
            actionContext?: {
                schemaVersion: 1;
                authority: 'provider_plan_and_attempt_checkpoint';
                order: number;
                dependsOnStepIds: string[];
                atomicGroupId: string;
                atomicity: 'single_provider_transaction';
                expectedStateChange: string;
                idempotencyKey: string;
                deadline: { kind: 'last_valid_block_height'; value: number };
                aggregateRule: 'all_ordered_steps_finalized';
            };
            statePrecondition?: {
                schemaVersion: 1;
                authority: 'independent_provider_readback_before_transit_sign';
                chainId: 'solana:devnet';
                profileRef: string;
                profileVersion: number;
                programId: string;
                actionIntentDigest: string;
                planDigest: string;
                stepId: 'set_governance_delegate' | 'revoke_governance_delegate';
                manifestDigest: string;
                messageDigest: string;
                expectedDelegate: string | null;
                observedSlot: number;
                providerStateDigest: string;
                feePayerBalanceLamports: number;
                canonicalOwnerState: {
                    schemaVersion: 1;
                    authority: 'canonical_resource_authority_payer_readback';
                    resourceBindingId: string;
                    authorityBindingId: string;
                    payerPolicyId: string;
                    emergencyFreeze: 'not_configured_p05_gate' | 'clear_fresh_p05_authority_health';
                    stateDigest: string;
                };
                instructionSafety: {
                    schemaVersion: 1;
                    authority: 'provider_instruction_manifest_and_simulation';
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
            };
            finalityTransitions: Array<{
                state: 'submitted' | 'confirmed' | 'finalized';
                authority:
                    | 'provider_signature_readback'
                    | 'solana_rpc_signature_status'
                    | 'solana_rpc_finalized_transaction';
                slot?: number;
            }>;
        }>;
        trustProfile?: {
            profileDigest: string;
            readinessState: 'ready';
            riskMaturity: 'stable' | 'experimental';
            genesisHash: string;
            programId: string;
            loaderProgramId: string;
            programDataAddress: string;
            upgradeAuthority: string;
            deployedProgramBytesSha256: string;
            deploymentObservedSlot: number;
            deploymentObservedAt: string;
            observationSlot: number;
            observationBlockhash: string;
            decoderPackage: string;
            decoderVersion: string;
            decoderArtifactSha256: string;
            decoderConformance: string;
            commitment: 'finalized';
            rpcAccess: 'public_no_credentials';
            rpcIndexerCrossCheck:
                | 'rpc_finalized_and_indexer_program_checkpoint_converged'
                | 'rpc_finalized_indexer_program_checkpoint_behind'
                | 'rpc_finalized_indexer_program_checkpoint_failed'
                | 'rpc_finalized_only_indexer_not_configured'
                | 'rpc_finalized_indexer_observation_unavailable';
        };
        executionAuthorities?: Array<{
            role: string;
            publicAuthority: string | null;
            custodyProvider: string;
            custodyStatus: string;
            allowedOperations: string[];
            verifiedSlot: number;
            status: string;
            sourceRequestId: string | null;
            sourceDecisionDigest: string | null;
        }>;
        authorityPaymentBoundary?: GovernanceProviderAuthorityPaymentBoundary;
        mandateCostPolicy?: GovernanceProviderMandateCostPolicy;
        fundingSourceFeePayerBoundary?: GovernanceProviderFundingSourceFeePayerBoundary;
        preSignStateReadback?: {
            schemaVersion: 1;
            authority: 'persisted_cost_preflight_and_provider_receipt';
            state: 'verified';
            resourceBindingId: string;
            latestObservedSlot: number;
            signatureCheckCount: number;
            statePreconditionDigests: string[];
            checks: {
                finalizedProviderQuote: true;
                currentFeePayerBalance: true;
                canonicalResourceAuthorityPayer: true;
                currentTrustProfile: true;
                p05AuthorityHealthAndFreeze: true;
                messageAndManifestBound: true;
            };
            emergencyFreeze: 'clear_fresh_p05_authority_health';
            executionAllowedAtSignature: true;
        };
        enforcementDisclosure?: {
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
        };
        costReconciliation?: {
            schemaVersion: 1;
            authority: 'canonical_cost_preflight_and_provider_receipt';
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
        };
        providerCostControlBoundary?: GovernanceProviderCostControlBoundary;
        assetAuthoritySponsorBoundary?: GovernanceAssetAuthoritySponsorBoundary;
    };
    grantSettlement?: {
        agreementId: string;
        trancheIntentId: string;
        resourceBindingId: string;
        recipient: string;
        amountLamports: string;
        fundingSource: 'solana_devnet_faucet' | 'existing_finalized_balance';
        vaultBalanceAfterLamports: string;
        recipientBalanceAfterLamports: string;
        payoutSignature: string;
        payoutSlot: number;
        canonicalFundingStatus: 'paid';
    };
    decisionMapping?: {
        sourceDecisionDigest: string;
        sourceMechanism: {
            kind: 'equal_weight_threshold';
            contractDigest: string;
            resultDigest: string;
        };
        providerProposalRef: string;
        providerVoteRecordRef: string;
        providerVoterTokenOwnerRecordRef: string;
        providerVote: 'approve';
        yesVoteWeight: string;
        voterWeight: string;
        providerResult: 'completed';
        authorityBoundary: 'governance_voter_authorizes_request_provider_authority_executes_decision';
    };
    reconciliation?: {
        state: 'verified' | 'hold';
        blocker: 'provider_readback_outage' | 'provider_readback_conflict' | null;
        authority: 'independent_provider_readback';
        observedStateDigest: string | null;
        observedSlot: number | null;
        accountSemantics: {
            signatoryRecord: 'not_applicable_direct_governance_authority_signoff';
            voterWeightAddin: 'not_configured';
            maxVoterWeightAddin: 'not_configured';
            customPlugins: 'unavailable';
        } | null;
        votingPowerSecurity: RealmsVotingPowerSecurityProfile | null;
        votingPowerChallenge: {
            state: 'suspended' | 'reopened';
            requestId: string;
            preObservedSlot: number;
            postObservedSlot: number | null;
            historicalTallyInvariant: 'pending' | 'unchanged';
            blocker: 'challenge_resolution_pending' | null;
        } | null;
        providerIncident: {
            incidentId: string;
            lifecycleState: 'suspected' | 'confirmed' | 'contained' | 'reconciled';
            authority: 'independent_provider_readback';
            blocker: 'provider_readback_outage' | 'provider_readback_conflict' | null;
            occurredAt: string;
            eventDigest: string;
            lastReconciledAt: string | null;
            pendingExecution: 'blocked' | 'eligible_after_reconciliation';
            originalDecisionAndReceipt: 'preserved';
        } | null;
        reconciliationFallback: GovernanceProviderReconciliationFallbackReadback | null;
        observedAt: string;
    };
    attempts: {
        total: number;
        failed: number;
        history: Array<{
            receiptId: string | null;
            status: 'executed' | 'failed' | 'skipped' | 'unavailable';
            errorCode: string | null;
            executedAt: string | null;
        }>;
    };
    linkage: {
        caseRef: string | null;
        stageRef: string | null;
        artifactStatus: 'not_applicable_provider_binding_activation';
        artifactRef: null;
    };
}

export interface GovernanceProviderReconciliationFallbackReadback {
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
}

export interface GovernanceProviderResourceLifecycleReadback {
    schemaVersion: 1;
    authority: 'provider_receipt_resource_binding_authority_binding_and_independent_readback';
    state: 'available';
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    resourceBindingId: string;
    resourceRef: string;
    ownerProgramRef: string;
    sourceRequestId: string;
    sourceDecisionDigest: string;
    observedSlot: number;
    lastTransactionSlot: number | null;
    stateDigest: string;
    phases: Array<{
        phase:
            | 'created'
            | 'bootstrap_verified'
            | 'authority_transferred'
            | 'old_authority_revoked'
            | 'readback_verified'
            | 'available';
        authority:
            | 'GovernedResourceBinding'
            | 'provider_receipt_and_finalized_transaction_readback'
            | 'ResourceAuthorityBinding'
            | 'openbao_transit_custody_readback'
            | 'independent_provider_readback';
        evidenceRef: string;
    }>;
    permissionResidue: {
        fallbackAuthority: 'none';
        temporaryWalletAuthority: 'revoked_or_not_retained';
        serviceKeyAuthority: 'not_retained';
        signerKeyExposure: 'none_public_authority_only';
        authorityRoles: Array<{
            role: string;
            custodyProvider: 'openbao_transit';
            custodyStatus: 'verified';
            status: 'active';
            verifiedSlot: number;
        }>;
    };
}

export interface GovernanceProviderExecutionProgressReadback {
    schemaVersion: 1;
    authority: 'canonical_cost_preflight_provider_checkpoint';
    state: 'partially_executed';
    aggregateRule: 'executed_only_when_all_ordered_steps_authoritatively_finalized';
    completed: Array<{
        stepId: string;
        expectedStateChange: string;
        finality: 'finalized';
        actionReceipt: {
            authority: 'canonical_provider_checkpoint_finalized_transaction';
            providerReference: string;
            observedSlot: number;
            messageDigest: string;
            manifestDigest: string;
        };
        irreversibleChange: 'provider_state_change_finalized_requires_governed_compensation_if_abandoned';
    }>;
    remaining: string[];
    active: { stepId: string; status: 'quoted' | 'signed' | 'submitted' | 'confirmed' } | null;
    expiredAttemptCount: number;
    compensation: {
        state: 'not_required_without_terminal_abandonment_decision';
        owner: 'unavailable_requires_governed_assignment';
        directOperatorMutationAllowed: false;
    } | {
        state: 'compensation_required';
        owner: {
            authority: 'terminal_abandonment_case_execution_responsibility';
            caseId: string;
            pubkey: string;
            responsibilityVersion: number;
            status: 'assigned' | 'accepted';
            deadlineAt: string | null;
        };
        directOperatorMutationAllowed: false;
        governingDecisionDigest: string;
    };
    resolutionPolicy: {
        authority: 'original_decision_authority_or_frozen_contingency_rule';
        deterministicResume: {
            mode: 'same_artifact_next_ordered_step';
            originalArtifactRequired: true;
            sameRequestOnly: true;
        };
        choices: {
            replan: 'requires_original_decision_authority_case';
            acceptPartial: 'requires_original_decision_authority_case';
            compensate: 'requires_original_decision_authority_case';
            terminateRemaining: 'requires_original_decision_authority_case';
        };
        emergencyActorPermanentDeviationAllowed: false;
    };
    outcome: {
        authority: 'canonical_provider_checkpoint_and_terminal_resolution_case';
        realizedActionIds: string[];
        unrealizedActionIds: string[];
        irreversibleImpacts: string[];
        remainingObligations: string[];
        acceptedResolution: 'terminate_remaining_and_compensate' | null;
        followUpCaseId: string | null;
        publicRecord: {
            originalDecisionFullyExecuted: false;
            displayedExecutionState: 'partially_executed_not_originally_executed';
            acceptPartialShownAsExecuted: false;
        };
    };
    nextGate: 'authoritative_provider_finality_readback'
        | 'continue_next_ordered_provider_step'
        | 'separate_governed_compensation_execution';
}

export interface GovernanceAutomaticExecutionAvailabilityReadback {
    schemaVersion: 1;
    authority: 'canonical_preflight_provider_readiness';
    state: 'ready' | 'blocked';
    readinessState: 'ready' | 'setup_required' | 'degraded' | 'unavailable';
    riskMaturity: 'stable' | 'experimental';
    stageGate: {
        openStage: 'allowed' | 'blocked';
        execute: 'allowed' | 'blocked';
        riskConfirmation: 'not_required' | 'required';
        riskDoesNotOverrideReadiness: true;
        missingReadiness: string[];
        enforcementReady: boolean;
        finalityReadbackConfigured: boolean;
    };
    providerModule: 'realms_provider_binding' | 'squads_provider_binding';
    mode: 'provider_onchain' | 'multisig_threshold';
    decisionLinkage: { requestId: string; decisionDigest: string };
    checks: {
        acceptedDecision: true;
        currentTrustProfile: boolean;
        activeExactResource: boolean;
        activeExactAuthority: boolean;
        activeExactPayer: boolean;
        simulationCheckpoint: boolean;
        instructionManifest: 'verified_adapter_manifest_only';
        opaqueInstructionsAllowed: false;
    };
    allowedOperations: string[];
    blockers: string[];
    providerAutomatic: 'ready' | 'blocked';
    walletManual: 'blocked_requires_explicit_wallet_confirmation';
    advisoryOnly: 'blocked_no_signed_transaction_generation';
    completionClaimAllowed: false;
    nextGate: 'provider_attempt_and_authoritative_readback'
        | 'repair_existing_readiness_facts_without_authority_or_payer_substitution';
}

export interface GovernanceProviderExecutionPreviewReadback {
    schemaVersion: 1;
    authority: 'canonical_cost_preflight_pre_sign_state_and_active_binding';
    state: 'ready_to_sign';
    provider: 'realms_provider_binding';
    network: 'solana:devnet';
    enforcementMode: 'provider_onchain';
    decisionLinkage: {
        requestId: string;
        decisionDigest: string;
        actionIntentDigest: string;
    };
    resource: {
        bindingId: string;
        resourceRef: string;
        ownerProgramRef: string;
        observedSlot: number;
        stateDigest: string;
    };
    signingAuthority: {
        role: 'voter';
        publicAuthority: string;
        custodyProvider: string;
        keyRefExposed: false;
        assignmentGrantsAuthority: false;
    };
    feePayer: {
        policyId: string;
        role: 'separated_fee_payer_policy';
        economicBearer: string;
        signerRefExposed: false;
    };
    estimate: {
        unit: 'lamports';
        quotedFee: number;
        authorizedCeiling: number;
        totalLimit: string;
    };
    instruction: {
        stepId: 'set_governance_delegate' | 'revoke_governance_delegate';
        summary: string;
        programIds: string[];
        accountScope: Array<{ role: string; ref: string }>;
        assetChange: 'none_no_real_assets';
        simulation: 'passed';
        opaqueInstructions: false;
        rawInstructionExposed: false;
        manifestDigest: string;
        messageDigest: string;
        recentBlockhash: string;
        lastValidBlockHeight: number;
    };
    bypassRisk: {
        known: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path';
        prevented: false;
    };
    nextGate: 'provider_custody_sign_then_authoritative_finality_readback';
}

export interface GovernanceProviderExecutionAuthorityPreflightReadback {
    schemaVersion: 1;
    authority: 'invocation_snapshot_mandate_artifact_and_live_provider_readback';
    state: 'ready';
    executionAllowed: true;
    frozenAuthority: {
        invocationId: string;
        snapshotId: string;
        snapshotDigest: string;
        bindingId: string;
        capabilityDigest: string;
        validFrom: string;
        validUntil: string;
    };
    mandate: {
        id: string;
        version: number;
        termsDigest: string;
        sourceVersion: string;
        purpose: string;
    };
    governedDecision: {
        requestId: string;
        decisionDigest: string;
        artifactId: string;
        artifactDigest: string;
        actionType: string;
        subject: { type: string; ref: string };
        resourceBindingId: string;
    };
    executionEnforcementBinding: {
        resourceBindingId: string;
        authorityScopeDigest: string;
        authorityBindingIds: string[];
        providerModule: 'realms_provider_binding';
        mode: 'provider_onchain';
        allowedAdapter: 'realms_provider_binding';
        allowedOperations: string[];
        residualBypassRisk:
            'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path';
        bypassPrevented: false;
        verificationState: 'verified_live';
        contractVersion: number;
        profileVersion: number;
    };
    liveExecutionAuthority: {
        resolver: 'canonical_resource_authority_and_pre_sign_provider_state_readback';
        provider: 'realms_provider_binding';
        observedSlot: number;
        providerStateDigest: string;
        canonicalBindingStateDigest: string;
        controllingAuthorityCount: number;
        result: 'verified';
    };
    emergencyFreeze: {
        source: 'p05_authority_health_runtime';
        observed: 'clear_fresh_p05_authority_health';
        state: 'verified_clear';
        executionAllowed: true;
    };
    checks: {
        resolvedActionAuthoritySnapshot: true;
        mandate: true;
        decisionAndArtifactDigest: true;
        actionAndSubjectScope: true;
        liveExecutionAuthority: true;
        emergencyFreeze: true;
    };
    nextGate: 'provider_custody_sign_then_authoritative_finality_readback';
}

export interface CircleGovernanceRequest {
    id: string;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    scopeType: string;
    scopeRef: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown> | null;
    idempotencyKey: string;
    proposerPubkey: string;
    state: 'active' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
    caseRef: string | null;
    stageRef: string | null;
    decisionStatus: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'unavailable';
    executionStatus: 'not_ready' | 'not_required' | 'pending' | 'executed' | 'expired' | 'failed' | 'skipped' | 'unavailable';
    openedAt: string | null;
    expiresAt: string | null;
    resolvedAt: string | null;
    snapshot?: unknown;
    signals?: unknown[];
    decision?: {
        decision: 'accepted' | 'rejected' | 'expired' | 'cancelled';
        reason: string;
        tally: Record<string, unknown>;
        mechanism: {
            kind: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding';
            contractDigest: string;
            resultDigest: string;
            evaluatorState: 'active' | 'accepted' | 'rejected';
        } | null;
        decidedAt: string | null;
        decisionDigest: string;
    } | null;
    receipts?: unknown[];
    preExecutionCost?: {
        schemaVersion: 1;
        state: 'pending_rpc_quote' | 'provider_in_progress';
        preflightId: string;
        status: 'pending' | 'ready';
        checkedAt: string | null;
        expiresAt: string | null;
        payer: {
            policyId: string;
            network: string;
            economicBearer: string;
            feePayer: 'policy_bound' | 'not_configured';
            sponsor: 'relayer_configured' | 'not_configured';
            rentFunding: 'policy_bound' | 'not_configured';
            refundRecipient: 'policy_bound' | 'not_configured';
        };
        limits: { unit: 'lamports'; singleTransaction: string; total: string };
        provider: {
            chainId: string;
            profileRef: string;
            profileVersion: number;
            resourceBindingId: string;
        };
        estimate: 'pending_provider_rpc_quote';
        rent: 'pending_provider_quote';
        refund: 'pending_terminal_reconciliation';
        executionProgress: GovernanceProviderExecutionProgressReadback | null;
        automaticExecutionAvailability: GovernanceAutomaticExecutionAvailabilityReadback | null;
        executionPreview: GovernanceProviderExecutionPreviewReadback | null;
        executionAuthorityPreflight: GovernanceProviderExecutionAuthorityPreflightReadback | null;
    } | null;
    providerResourceExecutionAdmission?: GovernanceProviderResourceExecutionAdmissionReadback | null;
    providerExecution?: GovernanceProviderExecutionReadback | null;
    providerExecutionStatus?: {
        schemaVersion: 1;
        status: 'executed' | 'failed' | 'held';
        integrity: 'verified' | 'invalid';
        blocker: string | null;
        acceptedDecisionPreserved: true;
        recovery: NonNullable<GovernanceProviderExecutionReadback['recovery']> | null;
        incident: NonNullable<NonNullable<GovernanceProviderExecutionReadback['reconciliation']>['providerIncident']> | null;
    } | null;
    providerExecutionReference?: {
        schemaVersion: 1;
        ref: string;
        provider: 'realms_provider_binding' | 'squads_provider_binding';
        network: string;
        resourceRef: string;
        receiptId: string;
        receiptEvidenceDigest: string;
        finality: 'finalized';
        reconciliationAuthority: 'independent_provider_readback';
        effect: string | null;
        observedSlot: number | null;
        observedAt: string | null;
        providerNative: {
            ownerProgramRef: string;
            proposalRef: string | null;
            proposalTransactionRef: string | null;
            transactions: Array<{
                stepId: string;
                signature: string;
                slot: number;
                commitment: 'finalized';
            }>;
            transactionCount: number;
            rawTransactionExposed: false;
            signerKeyRefExposed: false;
        };
        residualBypassRisk: {
            enforcementMode: 'provider_onchain' | 'multisig_threshold';
            risk: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
                | 'threshold_signers_can_create_or_execute_transactions_outside_alcheme';
            bypassPrevented: false;
        };
        businessState: Record<string, string>;
        executionAuthorizationReceipt?: {
            schemaVersion: 1;
            receiptRole: 'design_input_only';
            authority: 'canonical_request_decision_cost_preflight_and_provider_truth_readback';
            requestId: string;
            decisionDigest: string;
            receiptId: string;
            authorizationStatus: 'authorized';
            normalizedDecision: {
                decision: 'accepted';
                executionStatus: 'executed';
                decisionDigest: string;
                providerResult: string | null;
                businessStateAuthority: 'independent_provider_readback';
            };
            providerTruth: {
                authority: 'independent_provider_readback';
                providerNativeEvidenceDigest: string;
                finalizedProviderNativeEvidence: true;
                dbReceiptIsProviderTruth: false;
            };
            issuerTrust: {
                mode: 'provider_native_trust_profile';
                issuerRef: 'realms_provider_binding' | 'squads_provider_binding';
                trustProfileDigest: string;
                jwsIngestion: 'not_applicable_provider_native_finalized_transaction';
                revocationIngestion: 'not_applicable_provider_native_finalized_transaction';
                providerProfileRef: string;
                providerProfileVersion: number;
            };
            operationPayloadTarget: {
                actionIntentDigest: string;
                planDigest: string;
                terminalTransactionAttemptDigest: string;
                actionSetDigest: string;
                targetResourceRef: string;
                ownerProgramRef: string;
                operations: string[];
                liveState: {
                    authority: 'independent_provider_readback';
                    observedSlot: number;
                    observedStateDigest: string;
                    finality: 'finalized';
                };
            };
            oneTimeConsumption: {
                authority: 'canonical_cost_preflight';
                preflightId: string;
                status: 'consumed';
                atomicConsumption: 'single_cost_preflight_update_conflict_fail_closed';
                duplicateActionObserved: false;
            };
        };
    } | null;
    executionCompatibility?: {
        status: 'legacy';
        adapter: string;
        risk: 'low' | 'medium' | 'high' | 'critical';
        migrationTarget: 'stage_decision_only_execution_action';
    } | null;
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

export interface GovernanceCaseExecutionAuthorityHeader {
    schemaVersion: 1;
    technicalProvider: {
        module: 'realms_provider_binding' | 'squads_provider_binding';
        network: string;
        profileRef: string;
        profileVersion: number;
        resourceRef: string;
        ownerProgramRef: string;
        observedSlot: number;
        source: 'provider_native_receipt_and_readback' | 'live_execution_authority_preflight';
    } | null;
    executionAuthorities: Array<{
        role: string;
        publicAuthority: string | null;
        custodyProvider: string;
        custodyStatus: string;
        allowedOperations: string[];
        verifiedSlot: number;
        status: string;
        sourceRequestId: string | null;
        sourceDecisionDigest: string | null;
        source: 'provider_native_receipt_and_readback' | 'canonical_resource_authority_binding';
    }>;
    state: {
        decisionStatus: CircleGovernanceRequest['decisionStatus'];
        executionStatus: CircleGovernanceRequest['executionStatus'];
        providerStatus: 'executed' | 'failed' | 'held' | 'preflight_ready' | 'unavailable';
        integrity: 'verified' | 'unavailable';
        receiptId: string | null;
        blocker: string | null;
    };
    boundary: 'workflow_assignment_and_payer_are_not_execution_authority';
}

export interface GovernanceCaseAuthorityMatrix {
    schemaVersion: 1;
    integrity: 'verified' | 'invalid';
    entries: Array<{
        phase: 'discussion' | 'decision' | 'execution' | 'outcome';
        binding: 'unique_authority' | 'reconciled_rule';
        authority: {
            type: string;
            ref: string;
            version: string;
        } | null;
        reconciledRule: {
            rule: string;
            owner: string;
            reason: string;
        } | null;
        source: string;
    }>;
    boundary: 'discussion_decision_execution_outcome_each_has_unique_authority_or_reconciled_rule';
}

export interface GovernanceCaseBlocker {
    id: string;
    code: 'funding_required' | 'funding_amendment_required';
    scope: 'execution';
    scopeRef: string;
    status: 'open' | 'resolved';
    owner: 'original_decision_authority';
    sla: 'governed_resolution_required_no_implicit_deadline';
    resumeState: 'accepted_pending_execution' | 'accepted_pending_funding_amendment';
    resolutionRequirement:
        | 'verified_payer_budget_or_reimbursement'
        | 'original_decision_authority_accepted_cost_amendment';
    evidenceReceiptId: string;
    openedAt: string;
    closedAt: string | null;
    retryEligibility: 'blocked_pending_governed_resolution' | 'manual_same_intent_retry_ready';
    automaticRetry: false;
}

export interface GovernanceCase {
    id: string;
    publiclyReadable: boolean;
    readerAudience: 'public' | 'member' | 'operator';
    realtimePolicy: {
        mode: 'foreground_refetch' | 'stopped';
        refreshAfterMs: number | null;
        terminal: boolean;
    };
    nextRequiredAction: {
        category: GovernanceCaseInboxTask['category'] | null;
        role: GovernanceCaseInboxTask['role'] | null;
        primaryAction: GovernanceCaseInboxTask['primaryAction'] | null;
        status: GovernanceCaseInboxTask['status'];
        disabledReason: string | null;
        targetAnchor: string | null;
    } | null;
    attentionPreference?: GovernanceCaseAttentionPreference | null;
    readState?: GovernanceCaseReadState | null;
    originKind: 'native_invocation' | 'legacy_request' | 'manual_item' | 'plaza_selection' | 'public_url' | 'external_proposal';
    phase: GovernanceCasePhase;
    title: string;
    requestedDecision: string;
    requestedAction: { payload: Record<string, unknown> } | null;
    authorityHealthReadback: (GovernanceAuthorityHealthReadback & {
        authority: 'canonical_circle_governance_binding';
        sourceRequestId: string;
        bindingId: string;
        targetCircleId: number;
    }) | null;
    configurationTransitionReadback: {
        status: 'planned' | 'executed' | 'rolled_back' | 'drifted';
        activeBundle: { id: string; version: number; digest: string } | null;
        targetBundle: { id: string; version: number; digest: string };
        activePolicy: { id: string; versionId: string; version: number } | null;
        bindingId: string;
        sourceRequestId: string | null;
        sourceDecisionDigest: string | null;
        disposition: {
            status: 'pending_cutover' | 'verified' | 'drifted';
            acceptedArtifacts: { total: number; verified: number; immutable: boolean };
            existingOperationEffects: { total: number; verified: number; continueFrozenLifecycle: boolean };
            newInvocations: { total: number; targetPolicy: number; targetBundleOnly: boolean };
            profilePins: { total: number; verified: number; retainedFrozenVersion: boolean };
            appealAccess: 'bound_to_original_receipt';
        };
        recovery: {
            status: 'not_started' | 'governed_rollback_available' | 'rollback_governance_pending' | 'rolled_back' | 'manual_recovery_required';
            irreversibleBoundary: 'not_crossed' | 'unknown_or_crossed';
            oneClickRollback: false;
            canOpenGovernedRollback: boolean;
            sourceBundle: { id: string; version: number; digest: string };
            rollbackCaseId: string | null;
        };
        deadlockRecovery: GovernanceRecoveryReadback & {
            recoveryCaseId: string | null;
            ratificationCaseId: string | null;
        };
    } | null;
    configurationTransitionAuditRecord: {
        schemaVersion: 1;
        visibility: 'authorized_full' | 'public_safe' | 'minimal_risk_summary_only';
        recordDigest: string;
        status: 'planned' | 'executed' | 'rolled_back' | 'drifted';
        historicalCaseRecalculation: false;
        planDigest?: string | null;
        fromBundle?: { id: string; version: number; digest: string };
        toBundle?: { id: string; version: number; digest: string };
        fromBundleDigest?: string | null;
        toBundleDigest?: string | null;
        structuredDiffDigest: string | null;
        oldRulesDecision?: Record<string, unknown> | null;
        handoffReceipts?: Array<Record<string, unknown>>;
        cutover?: Record<string, unknown>;
        failure?: Record<string, unknown>;
        rollback?: Record<string, unknown>;
        recovery?: Record<string, unknown>;
        inFlightDisposition?: Record<string, unknown>;
        failureStatus?: string;
        rollbackStatus?: string;
        recoveryStatus?: string;
        inFlightDispositionStatus?: string;
    } | null;
    memberRights: {
        actionType: 'circle.membership.member.remove';
        impact: 'permanent_member_removal';
        viewerRole: 'respondent_appellant' | 'operator' | 'observer' | null;
        targetUserId: number | null;
        targetRole: string | null;
        publicReason: string | null;
        evidenceDigest: string | null;
        appealWindowSeconds: number | null;
        appealDeadline: string | null;
        effectBeforeDeadline: 'forbidden' | null;
        reporter: { visibility: string; pubkey: string | null } | null;
        authorization: {
            status: 'pending_decision' | 'accepted_artifact' | 'blocked_missing_accepted_artifact' | 'terminal_without_authorization';
            artifactId: string | null;
            artifactDigest: string | null;
            decisionDigest: string | null;
            source: 'native_decision_output_artifact' | null;
        } | null;
        executionStatus: string | null;
        providerFinality: string | null;
        membershipEffect: 'not_executed_by_p05' | null;
    } | null;
    caseType: GovernanceCaseType | 'legacy_unclassified';
    template: GovernanceCaseTemplateSelection | null;
    governanceHome: { type: string; ref: string } | null;
    governedSubject: { type: string; ref: string };
    origin: {
        kind: string;
        ref: string | null;
        sourceUrl: string | null;
        sourceMessageIds: string[];
        snapshot: {
            schemaVersion: 1;
            kind: 'plaza_message_selection';
            circleId: number;
            sourceSetDigest: string;
            sources: Array<{
                type: 'discussion_message';
                ref: string;
                authorPubkey: string;
                payloadDigest: string;
                lamport: string;
                clientTimestamp: string;
                messageKind: string;
                authMode: string;
                signatureVerified: boolean;
            }>;
            visibility: {
                sourceOwner: 'circle_discussion';
                circleType: string;
                caseProjection: 'member_or_operator';
                contentAccess: 'not_granted_by_case';
                publicProjection: 'withheld';
            };
        } | null;
        snapshotDigest: string | null;
        snapshotIntegrity: 'verified' | 'invalid' | 'unavailable' | 'withheld';
    };
    canonicalUrl: string;
    openedAt: string | null;
    proposerPubkey: string | null;
    fieldVisibility: Array<{
        fieldGroup:
            | 'case_identity'
            | 'origin'
            | 'brief'
            | 'source_fact'
            | 'ai_suggestion'
            | 'review_opinion'
            | 'decision'
            | 'execution'
            | 'outcome'
            | 'authority'
            | 'artifact'
            | 'raw_ballot';
        decision: 'allow' | 'redact' | 'deny';
        reason: string;
    }>;
    primaryRequest: CircleGovernanceRequest | null;
    executionAuthorityHeader: GovernanceCaseExecutionAuthorityHeader | null;
    caseAuthorityMatrix: GovernanceCaseAuthorityMatrix | null;
    caseBlockers: GovernanceCaseBlocker[];
    manualExecutionControl: GovernanceManualExecutionControlReadback | null;
    policySimulation: GovernanceCasePolicySimulation | null;
    ballotDisclosure: {
        mode: GovernanceBallotDisclosureMode | null;
        state: 'visible' | 'withheld';
        reason:
            | 'policy_public'
            | 'policy_member'
            | 'frozen_electorate_eligible'
            | 'ballot_closed'
            | 'circle_membership_required'
            | 'frozen_electorate_required'
            | 'public_record_safe_default'
            | 'ballot_active_aggregate_only'
            | 'provider_definition_unavailable'
            | 'mechanism_integrity_conflict';
        rawSignals: Array<{
            actorPubkey: string;
            choice: 'approve' | 'reject' | 'abstain' | 'quadratic_voice_credits' | 'quadratic_funding';
            choiceVector?: Array<{ choiceId: string; votes: number }>;
            cost?: number;
            commitments?: Array<{ projectId: string; amount: number }>;
            totalCommitment?: number;
        }>;
    } | null;
    voteSummary: {
        requestedDecision: string;
        evidence: string | null;
        argumentsFor: string | null;
        argumentsAgainst: string | null;
        risks: string | null;
        rule: {
            id: string;
            strategy: string;
            threshold: Record<string, unknown> | null;
            voteReplacement: { mode: 'not_allowed'; deadline: 'request_expires_at' };
        } | null;
        policyVersion: number | null;
        snapshotDigest: string;
        deadline: string | null;
        provider: { type: string; version: string } | null;
        finality: {
            source: 'governance_decision';
            terminalStates: Array<'accepted' | 'rejected' | 'expired' | 'cancelled'>;
        } | null;
        mechanism: {
            status: 'pending' | 'verified' | 'invalid';
            contractDigest: string;
            resultDigest: string | null;
        } | null;
        ballot: {
            state: 'pending' | 'held' | 'terminal';
            reason: 'threshold_pending' | 'awaiting_qv_signals' | 'awaiting_qf_commitments' | 'tie_pending_until_deadline' | 'result_integrity_conflict' | 'mechanism_integrity_conflict' | 'terminal_decision_recorded';
            choices: Array<'approve' | 'reject' | 'abstain' | { id: string; label: string; projectRef?: string; recipientRef?: string; allocationCap?: number }>;
            quorum: { numerator: number; denominator: number; required: number; met: boolean } | null;
            tally: { approved: number; rejected: number; abstained: number; eligible: number; ignored: number } | null;
            quadraticVoice: {
                creditBudgetPerActor: number;
                costFormula: 'sum_squared_votes';
                completion: 'all_frozen_electorate_submitted';
                choices: Array<{ id: string; label: string; votes: number }>;
                submitted: number;
                pending: number;
                activationReadiness: GovernanceQuadraticVoiceActivationReadiness;
            } | null;
            quadraticFunding: {
                roundRef: string;
                budgetUnit: string;
                matchingBudget: number;
                commitmentCapPerActorPerProject: number;
                formula: 'integer_sqrt_quadratic_matching';
                rounding: 'largest_remainder_then_project_ref';
                candidateSnapshot: Record<string, unknown> | null;
                contributionSnapshotDigest: string | null;
                projects: Array<{
                    id: string; label: string; projectRef: string; recipientRef: string;
                    allocationCap: number; donorCount: number; contributionUnits: number;
                    matchingScore: number; matchingAllocationUnits: number; totalPlannedUnits: number;
                }>;
                submitted: number;
                pending: number;
                allocatedMatchingUnits: number;
                unallocatedMatchingUnits: number;
                settlement: {
                    funding: 'unfunded'; state: 'pending_settlement'; resourceRef: null;
                    escrowRef: null; payoutRef: null; providerFinality: null;
                } | null;
                activationReadiness: GovernanceQuadraticFundingActivationReadiness;
            } | null;
            abstention: { participation: 'counts'; decisionThreshold: 'does_not_count' } | null;
            tie: { resolution: 'pending_until_request_expires'; terminalAtDeadline: 'expired' } | null;
            earlyFinalization: { mode: 'threshold_reached' } | null;
            voteHistory: { mode: 'append_only_first_accepted_signal'; replacement: 'not_allowed' } | null;
            deadline: { source: 'request_expires_at'; instant: string } | null;
            providerMapping: {
                signalType: 'committee_vote';
                choices: { approve: 'approve'; reject: 'reject'; abstain: 'abstain' };
                resultSource: 'governance_decision';
            } | null;
        };
        submission: {
            status: 'not_submitted' | 'recorded';
            choice: 'approve' | 'reject' | 'abstain' | 'quadratic_voice_credits' | 'quadratic_funding' | null;
            recordedAt: string | null;
            replacement: 'not_allowed';
            reason: string | null;
        };
        eligibility: {
            status: 'eligible' | 'ineligible' | 'wallet_required';
            weight: string | null;
            reason: 'frozen_snapshot_eligible' | 'not_in_frozen_electorate' | 'authenticated_wallet_required';
        };
    } | null;
    decisionAuthorityStages: GovernanceCaseDecisionAuthorityStages;
    decisionStages: GovernanceCaseDecisionStages | null;
    decisionOutputArtifacts: GovernanceDecisionOutputArtifact[];
    grantAgreements: GovernanceGrantAgreement[];
    actualOutcome: GovernanceCaseActualOutcomeRecord | null;
    relationship: {
        kind: 'related' | 'supersedes';
        caseId: string;
        canonicalUrl: string;
        reason: string | null;
        recordedAt: string | null;
        recordedBy: {
            homeType: string;
            homeRef: string;
            actorPubkey: string | null;
        };
    } | null;
    corrections: Array<{
        caseId: string;
        canonicalUrl: string;
        reason: string;
        recordedAt: string | null;
        recordedBy: {
            homeType: string;
            homeRef: string;
            actorPubkey: string | null;
        };
    }>;
    brief: {
        draftPostId: number;
        draftVersion: number;
        snapshotDigest: string;
        boundByPubkey: string;
        boundAt: string;
        actors: {
            externalAuthors: Array<{ sourceMaterialId: number; label: string }>;
            materialSubmitters: Array<{
                sourceMaterialId: number;
                userId: number | null;
                pubkey: string | null;
                secondarySnsLabel?: string | null;
            }>;
            briefContributors: Array<{ userId: number; draftVersion: number }>;
            reviewers: Array<{
                pubkey: string;
                status: GovernanceCaseResponsibilityStatus;
                secondarySnsLabel?: string | null;
            }>;
        };
        contentHistory: Array<{
            id: string;
            contentKind: 'ai_draft' | 'ai_suggestion';
            aiGeneration: {
                generationId: number;
                generatedAt: string;
                model: string;
                sourceDigest: string;
                summary: string | null;
                content: string;
            };
            humanAcceptance: {
                acceptedByUserId: number;
                acceptedAt: string;
                mode: 'auto_fill' | 'accept_replace' | 'accept_suggestion';
                resultingWorkingCopyHash: string;
            };
            snapshotRelation: 'exact_snapshot' | 'before_snapshot';
        }>;
        sources: Array<{
            id: number;
            name: string;
            canonicalUrl: string;
            externalAuthorLabel: string;
            publishedAt: string;
            capturedAt: string;
            contentDigest: string;
            sourceVersion: number;
            previousVersionId: number | null;
            versionDiff: {
                previousVersion: number;
                previousContentDigest: string;
                addedChunks: number;
                removedChunks: number;
                unchangedChunks: number;
            } | null;
            chunks: Array<{
                id: number;
                index: number;
                digest: string;
            }>;
            chunkCount: number;
        }>;
        claims: Array<{
            id: string;
            sectionKey: 'supporting_evidence' | 'arguments_for' | 'arguments_against' | 'risks';
            ordinal: number;
            text: string;
            digest: string;
            coverageStatus: 'supported' | 'stale' | 'redacted' | 'unsupported';
            bindings: Array<{
                id: string;
                sourceMaterialId: number;
                sourceMaterialDigest: string;
                sourceMaterialChunkId: number;
                sourceMaterialChunkDigest: string;
                boundByPubkey: string | null;
                boundAt: string | null;
            }>;
        }>;
        coverage: {
            total: number;
            supported: number;
            stale: number;
            redacted: number;
            unsupported: number;
        };
        readiness: {
            sectionReady: boolean;
            documentStatus: string | null;
            currentSnapshotVersion: number | null;
            reviewSnapshotReady: boolean;
            readyForEvidenceReview: boolean;
            missingSectionKeys: GovernanceBriefSectionKey[];
            sections: Array<{
                key: GovernanceBriefSectionKey;
                heading: string;
                complete: boolean;
                ownerPubkey: string | null;
            }>;
        } | null;
    } | null;
    workflow: GovernanceCaseWorkflow;
}

export interface GovernanceCaseAttentionPreference {
    schemaVersion: 1;
    level: 'watch' | 'track' | 'mute';
    version: number;
    persisted: boolean;
    ordinaryUpdatePolicy: 'high_attention' | 'normal_attention' | 'muted';
    requiredActionPolicy: 'always_deliver';
    updatedAt: string | null;
}

export interface GovernanceCaseReadState {
    schemaVersion: 1;
    status: 'new' | 'changed' | 'unchanged';
    currentActivityCursor: string;
    version: number;
    lastReadAt: string | null;
    resumeFragment: string | null;
    resumeUrl: string;
}

export interface GovernanceCaseAudienceExport {
    schemaVersion: 1;
    audience: 'public' | 'operator';
    exportedAt: string;
    case: Record<string, unknown>;
}

export interface GovernanceEvidenceShareEvent {
    id: string;
    eventType: 'requested' | 'authorized' | 'denied' | 'revoked' | 'read' | 'export';
    actorPubkey: string;
    purpose: string;
    result: 'allowed' | 'denied';
    reason: string | null;
    packageVersion: number;
    packageDigest: string;
    createdAt: string;
}

export interface GovernanceEvidenceSharePackage {
    id: string;
    caseId: string;
    bindingId: string;
    targetCircleId: number;
    recipientCircleId: number;
    requestedByPubkey: string;
    purpose: string;
    requestNote: string | null;
    safeSummary: string | null;
    sourceRefs: Array<{ sourceMaterialId: number; contentDigest: string }>;
    moderationReportId: string | null;
    minimumDisclosure: null | {
        schemaVersion: 1;
        kind: 'moderation_report_minimum_disclosure';
        reportId: string;
        targetCircleId: number;
        recipientCircleId: number;
        redactedAllegation: { format: 'reason_code_only'; reasonCode: string };
        subject: { type: 'communication_room_member'; ref: string; snapshotDigest: string };
        sealedEvidenceDigest: string;
        submissionDigest: string;
        includedFields: ['redacted_allegation', 'necessary_subject_ref', 'evidence_digest'];
        excludedFields: ['sealed_report_statement', 'reporter_identity_and_pii', 'offsite_evidence'];
        permittedUse: 'moderation_case_review_only';
        prohibitedUses: ['delegate_training', 'delegate_performance_evaluation', 'other_target'];
        additionalDisclosure: 'separate_item_assignment_required';
    };
    status: 'requested' | 'authorized' | 'denied' | 'revoked';
    effectiveStatus: 'requested' | 'authorized' | 'denied' | 'revoked' | 'expired' | 'source_unavailable';
    version: number;
    digest: string;
    decidedByPubkey: string | null;
    decidedAt: string | null;
    decisionReason: string | null;
    expiresAt: string | null;
    revokedByPubkey: string | null;
    revokedAt: string | null;
    createdAt: string;
    updatedAt: string;
    events: GovernanceEvidenceShareEvent[];
}

export interface GovernanceCaseInboxTask {
    category: 'drafting' | 'review' | 'decision' | 'execution' | 'outcome' | 'record';
    role: 'proposer' | 'coordinator' | 'reviewer' | 'voter' | 'appellant' | 'executor' | 'outcome_reviewer';
    primaryAction:
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
    status: 'available' | 'waiting' | 'completed' | 'blocked';
    deadline: string | null;
    disabledReason: string | null;
    providerRecovery: GovernanceProviderExecutionReadback['recovery'] | null;
    executionProgress: GovernanceProviderExecutionProgressReadback | null;
    automaticExecutionAvailability: GovernanceAutomaticExecutionAvailabilityReadback | null;
    executionPreview: GovernanceProviderExecutionPreviewReadback | null;
    executionAuthorityPreflight: GovernanceProviderExecutionAuthorityPreflightReadback | null;
    resourceExecutionAdmission: GovernanceProviderResourceExecutionAdmissionReadback | null;
    manualExecutionControl: GovernanceManualExecutionControlReadback | null;
    executionParticipantBoundary: GovernanceExecutionParticipantBoundary | null;
    decisionExecutionStatus: {
        decisionStatus: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'unavailable';
        executionStatus: 'not_ready' | 'not_required' | 'pending' | 'executed' | 'expired' | 'failed' | 'skipped' | 'unavailable';
    } | null;
    providerHealth: {
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
            phases: GovernanceProviderResourceLifecycleReadback['phases'];
            permissionResidue: Omit<
                GovernanceProviderResourceLifecycleReadback['permissionResidue'],
                'authorityRoles'
            >;
        } | null;
        reconciliationFallback: GovernanceProviderReconciliationFallbackReadback | null;
        authorityPaymentBoundary: GovernanceProviderAuthorityPaymentBoundary | null;
        mandateCostPolicy: GovernanceProviderMandateCostPolicy | null;
        fundingSourceFeePayerBoundary: GovernanceProviderFundingSourceFeePayerBoundary | null;
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
            duplicatePrevention: GovernanceProviderExecutionPlanReadback['duplicatePrevention'];
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
        providerActionSafetyBoundary: GovernanceProviderActionSafetyBoundary | null;
        servicePayerAuthorityBoundary: GovernanceServicePayerAuthorityBoundary | null;
        providerCostControlBoundary: GovernanceProviderCostControlBoundary | null;
        assetAuthoritySponsorBoundary: GovernanceAssetAuthoritySponsorBoundary | null;
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
        };
    } | null;
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

export interface GovernanceCaseInboxItem {
    case: GovernanceCase;
    task: GovernanceCaseInboxTask;
    readState: GovernanceCaseReadState;
    institutionalIdentities: GovernanceInboxInstitutionalIdentity[];
}

export interface GovernanceInboxInstitutionalIdentity {
    role: 'governance_home_manager' | 'delegated_authority_participant';
    targetCircleId: number;
    committeeCircleId: number | null;
    domainBindingId: string | null;
    mandateId: string | null;
}

export type GovernanceSystemDutyRole =
    | 'external_app_review_primary'
    | 'external_app_risk_emergency'
    | 'external_app_appeal'
    | 'external_app_parameter_governance';

export type GovernanceInstitutionalDutyRole =
    | 'governance_home_manager'
    | 'delegated_authority_participant'
    | 'system_authority_participant';

export interface GovernanceInstitutionalDuty {
    id: string;
    kind: 'governance_home_settings' | 'governance_mandate' | 'system_governance_role';
    role: GovernanceInstitutionalDutyRole;
    circleId: number;
    task: {
        primaryAction: 'open_institutional_settings' | 'view_mandate' | 'view_system_duty';
        status: 'available' | 'completed' | 'blocked';
        deadline: string | null;
        disabledReason: string | null;
        canonicalUrl: string;
    };
    mandate: {
        id: string;
        bindingId: string;
        direction: 'received';
        targetCircleId: number;
        committeeCircleId: number;
        health: GovernanceMandateHealth;
    } | null;
    systemRole: {
        bindingId: string;
        domain: 'external_app';
        roleKey: GovernanceSystemDutyRole;
        environment: 'sandbox' | 'production';
        policy: {
            id: string;
            versionId: string;
            version: number;
        };
        activatedAt: string;
        provenance: {
            requestId: string | null;
            decisionDigest: string | null;
            executionReceiptId: string | null;
            status: 'complete' | 'incomplete';
        };
    } | null;
}

export interface GovernanceOperationInboxItem {
    id: string;
    circleId: number;
    actionType: string;
    occurredAt: string;
    subject: { type: string; ref: string };
    risk: 'low' | 'medium' | 'high' | 'critical';
    provider: {
        type: 'execution_adapter';
        ref: string;
        authoritativeFinality: 'not_asserted';
    };
    invocation: { id: string; state: string };
    effect: { id: string; state: string; stateVersion: number };
    group: 'awaiting_action' | 'active' | 'expiring' | 'appealed' | 'closed';
    lifecycle: { expiresAt: string | null };
    identities: Array<{
        role: 'operational_assignee' | 'respondent_appellant' | 'appeal_reviewer';
        status: 'available' | 'waiting' | 'blocked' | 'completed';
        deadline: string | null;
        disabledReason: string | null;
        canonicalUrl: string;
    }>;
    authority: {
        role: 'governance_home_manager' | 'delegated_authority_participant' | null;
        identities: GovernanceInboxInstitutionalIdentity[];
        sourceType: string;
        sourceRef: string;
        sourceVersion: string | null;
        domainBindingId: string | null;
        mandateId: string | null;
        committeeCircleId: number | null;
    };
    task: {
        kind: 'ratification' | 'appeal' | 'escalation' | 'reconciliation';
        status: 'available' | 'waiting' | 'blocked' | 'completed';
        deadline: string | null;
        disabledReason: string | null;
        canonicalUrl: string;
    };
    appeal: {
        status: 'available' | 'opened' | 'resolved' | 'expired' | 'unavailable';
        windowEndsAt: string | null;
        currentActorAppealId: string | null;
    };
}

export interface GovernanceRuntimeMetricsReadback {
    schemaVersion: 1;
    scope: 'query_api_process_window';
    routeFamily: '/api/v1/governance';
    durability: 'process_memory_not_time_series';
    windowStartedAt: string;
    observedAt: string;
    requests: {
        total: number;
        successes: number;
        clientErrors: number;
        serverErrors: number;
    };
    latency: {
        sampleCount: number;
        averageMs: number;
        p95UpperBoundMs: number | null;
    };
    sloTarget: { status: 'not_configured' };
}

export const GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS = [
    'taskKind',
    'home',
    'subject',
    'identity',
    'assignee',
    'stage',
    'effect',
    'age',
    'risk',
    'institutionalAuthority',
    'mandate',
    'provider',
    'blockingReason',
    'deadline',
] as const;

export type GovernanceOperationalInboxFilterKey =
    typeof GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS[number];
export type GovernanceOperationalInboxFilters = Partial<
    Record<GovernanceOperationalInboxFilterKey, string>
>;

export interface GovernanceOperationalInboxQueue {
    appliedFilters: GovernanceOperationalInboxFilters;
    facets: Record<GovernanceOperationalInboxFilterKey, Array<{ value: string; count: number }>>;
    total: number;
    matched: number;
}

export interface GovernanceInbox {
    queue: GovernanceOperationalInboxQueue;
    items: GovernanceCaseInboxItem[];
    institutionalDuties: GovernanceInstitutionalDuty[];
    operations: GovernanceOperationInboxItem[];
    continueWorking: {
        caseId: string;
        title: string;
        status: GovernanceCaseReadState['status'];
        canonicalUrl: string;
        lastReadAt: string;
    } | null;
}

export interface GovernanceCaseActualOutcomeInput {
    summary: string;
    quantitativeImpact: string[];
    deviations: string[];
    failures: string[];
    outstandingObligations: string[];
    observationPeriod: {
        startedAt: string;
        endedAt: string;
    };
}

export interface GovernanceCaseActualOutcomeRecord {
    integrity: 'verified' | 'invalid';
    summary: string | null;
    quantitativeImpact: string[];
    deviations: string[];
    failures: string[];
    outstandingObligations: string[];
    observationPeriod: {
        startedAt: string;
        endedAt: string;
    } | null;
    digest: string | null;
    recordedByPubkey: string | null;
    recordedAt: string | null;
    externalExecution: {
        factSource: 'authoritative_external_execution_projection';
        businessExecutionOwner: 'storage_fabric';
        actionType: 'storage_fabric.authorize_provider_admission';
        providerResourceRef: string;
        providerAdmissionReceiptRef: string;
        providerAdmissionReceiptDigest: string;
        providerStatus: 'experimental';
        settlementState: 'holdback_only';
        network: 'solana:devnet';
        projectionDigest: string;
        executedAt: string;
    } | null;
}

export const GOVERNANCE_CASE_SEARCH_SCOPES = [
    'proposal', 'claim', 'source', 'review', 'decision', 'execution', 'outcome',
] as const;
export type GovernanceCaseSearchScope = typeof GOVERNANCE_CASE_SEARCH_SCOPES[number];

export interface GovernanceCaseSearchResult {
    id: string;
    scope: GovernanceCaseSearchScope;
    title: string;
    excerpt: string;
    canonicalUrl: string;
}

export interface GovernanceCaseSearchResponse {
    query: string;
    total: number;
    scopeCounts: Array<{ scope: GovernanceCaseSearchScope; count: number }>;
    results: GovernanceCaseSearchResult[];
}

export const CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS = [
    'template', 'status', 'actor', 'provider', 'date', 'result', 'relationship',
] as const;
export type CircleGovernanceSearchFilterKey =
    typeof CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS[number];
export type CircleGovernanceSearchFilters = Partial<
    Record<CircleGovernanceSearchFilterKey, string>
>;

export interface CircleGovernanceSearchResponse {
    query: string | null;
    appliedFilters: CircleGovernanceSearchFilters;
    facets: Record<CircleGovernanceSearchFilterKey, Array<{ value: string; count: number }>>;
    total: number;
    matched: number;
    providerFinality: 'not_asserted';
}

export interface GovernanceDecisionOutputArtifact {
    id: string;
    integrity: 'verified' | 'invalid';
    ordinal: number;
    kind: 'policy_document' | 'allocation_plan' | 'selection_result' | 'appeal_resolution' | 'grant_agreement_amendment' | 'internal_execution_plan' | 'manual_execution_plan';
    schemaRef: string;
    schemaVersion: 1;
    subject: { type: string; ref: string };
    source: { type: string; ref: string | null; digest: string };
    resolver: { ref: string; version: string };
    constraints: {
        execution: {
            mode: 'no_op';
            reason: 'policy_document_record_only';
            adapterRef: null;
            providerReadiness: 'not_applicable';
            automaticExecution: false;
        };
    } | {
        allocationPlan: Record<string, unknown>;
        execution: {
            mode: 'no_op';
            reason: 'unfunded_pending_settlement';
            adapterRef: null;
            providerReadiness: 'not_ready';
            automaticExecution: false;
        };
    } | {
        selectionResult: Record<string, unknown>;
        execution: {
            mode: 'no_op';
            reason: 'selection_result_record_only';
            adapterRef: null;
            providerReadiness: 'not_applicable';
            automaticExecution: false;
        };
    } | {
        appealResolution: Record<string, unknown>;
        execution: {
            mode: 'adapter' | 'no_op';
            reason: 'external_app_appeal_effect_applied'
                | 'communication_mute_appeal_effect_applied'
                | 'appeal_accepted_original_effect_already_terminal'
                | 'appeal_upheld_original_effect_preserved';
            adapterRef: 'external_app' | 'operation_effect' | null;
            providerReadiness: 'not_applicable';
            automaticExecution: boolean;
        };
    } | {
        grantAgreementAmendment: Record<string, unknown>;
        execution: {
            mode: 'no_op';
            reason: 'governed_amendment_requires_explicit_application';
            adapterRef: null;
            providerReadiness: 'not_applicable';
            automaticExecution: false;
        };
    } | {
        executionPlan: Record<string, unknown>;
        execution: {
            mode: 'adapter';
            reason: 'canonical_internal_action_executed';
            adapterRef: string;
            providerReadiness: 'not_applicable';
            automaticExecution: true;
        };
    } | {
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
    contentDigest: string;
    decisionDigest: string;
    finality: 'alcheme_native_decision';
    executionCapability: 'no_op' | 'current_adapter' | 'manual';
    artifactDigest: string;
    createdAt: string | null;
}

export interface GovernanceGrantAgreement {
    id: string;
    integrity: 'verified' | 'invalid';
    caseId: string;
    allocationArtifactId: string;
    projectRef: string;
    recipientRef: string;
    status: 'active' | 'terminated';
    fundingStatus: 'unfunded_pending_settlement' | 'partially_paid' | 'paid';
    settlementReadiness: GovernanceGrantSettlementReadiness | null;
    settlementReadinessIntegrity: 'verified' | 'stale' | 'invalid' | 'not_evaluated';
    settlementReadinessDigest: string | null;
    settlementReadinessVersion: number;
    settlementReadinessEvaluatedAt: string | null;
    budget: {
        unit: string;
        contractualUnits: string;
        committedContractualUnits: string;
        paidContractualUnits: string;
        blockedContractualUnits: string;
        remainingContractualUnits: string;
    };
    governingDecision: { requestId: string; digest: string };
    payoutRequests: Array<{
        id: string;
        state: string;
        openedAt: string | null;
        resolvedAt: string | null;
        decision: null | { decision: string; decisionDigest: string; decidedAt: string | null };
        execution: null | { status: string; ref: string | null; errorCode: string | null; executedAt: string | null };
        providerExecution: GovernanceProviderExecutionReadback | null;
    }>;
    terms: {
        schemaVersion: 1;
        recipient: { ref: string; applicantPubkeys: string[] };
        milestones: Array<{
            id: string;
            title: string;
            deliverable: string;
            evidenceRequirements: string[];
            deadline: string;
            contractualUnits: string;
            reviewerAuthority: {
                primaryReviewerPubkeys: string[];
                alternateReviewerPubkeys: string[];
                recusedReviewerPubkeys: string[];
                effectiveReviewerPubkeys: string[];
                quorum: number;
                conflictDisclosureEventIds: string[];
            };
            appealAuthority: {
                reviewerPubkeys: string[];
                excludedOriginalReviewerPubkeys: string[];
                excludedRecipientOrApplicantPubkeys: string[];
                quorum: number;
            };
            criteria: { accept: string; rework: string; reject: string };
            maxRevisions: number;
        }>;
        appealPolicy: Record<string, unknown>;
        terminationPolicy: Record<string, unknown>;
        outcomePolicy: {
            reviewerPubkeys: string[];
            excludedRecipientOrApplicantPubkeys: string[];
            quorum: number;
            runtimeStatus: 'active';
        };
        terminationDeclaration: null | {
            schemaVersion: 1;
            ground: 'milestone_rejected' | 'schedule_expired' | 'governing_decision_revoked';
            reason: string;
            retainedObligations: string[];
            outstandingObligations: string[];
            requestedAt: string;
        };
        contractualBudget: Record<string, unknown>;
        schedule: Record<string, unknown>;
    };
    termsDigest: string;
    lifecycle: {
        schemaVersion: 1;
        reviews: Array<Record<string, any>>;
        milestoneResults: Array<Record<string, any>>;
        trancheIntents: Array<Record<string, any>>;
        appeals: Array<Record<string, any>>;
        terminationRequest: Record<string, any> | null;
        termination: Record<string, any> | null;
        outcome: Record<string, any> | null;
    };
    lifecycleDigest: string;
    lifecycleVersion: number;
    activatedByPubkey: string;
    activatedAt: string | null;
}

export interface GovernanceQuadraticFundingActivationReadiness {
    schemaVersion: 1;
    evaluator: { ref: 'p06.qf_resource_activation_readiness'; version: 1 };
    nativeMode: {
        state: 'available';
        input: 'signed_unsettled_commitments';
        donationFinality: 'not_applicable_commitment_is_not_funding';
        matchingBudget: 'contractual_allocation_unit_only';
        payoutIntent: 'forbidden';
    };
    resourceFundedMode: {
        state: 'setup_required' | 'ready';
        activation: 'blocked' | 'ready';
        resource: Record<string, unknown> & { state: 'not_bound' | 'invalid' | 'verified' };
        activationAuthority: Record<string, unknown> & { state: 'not_bound' | 'invalid' | 'verified' };
        donationFinality: Record<string, unknown> & { state: 'missing' | 'invalid' | 'verified' };
        matchingPool: Record<string, unknown> & { state: 'not_bound' | 'invalid' | 'verified' };
        antiSybil: Record<string, unknown> & { state: 'not_configured' | 'invalid' | 'verified' };
        payoutIntent: 'not_created';
        blockerCodes: string[];
    };
    evaluatedAt: string;
    sourceDigest: string;
    evaluationDigest: string;
}

export interface GovernanceQuadraticVoiceActivationReadiness {
    schemaVersion: 1;
    evaluator: { ref: 'p06.qv_resource_activation_readiness'; version: 1 };
    nativeMode: {
        state: 'available'; budgetSource: 'frozen_policy_rule';
        creditBudgetPerActor: number; tokenOrAssetBalanceUsed: false;
    };
    externalResourceMode: {
        state: 'setup_required' | 'ready';
        activation: 'blocked' | 'ready';
        resource: Record<string, unknown> & { state: 'not_bound' | 'invalid' | 'verified' };
        activationAuthority: Record<string, unknown> & { state: 'not_bound' | 'invalid' | 'verified' };
        budgetReadback: Record<string, unknown> & { state: 'missing' | 'invalid' | 'verified' };
        enforcement: Record<string, unknown> & { state: 'not_configured' | 'invalid' | 'verified' };
        blockerCodes: string[];
    };
    evaluatedAt: string;
    sourceDigest: string;
    evaluationDigest: string;
}

export interface GovernanceCasePolicySimulation {
    schemaVersion: 1;
    status: 'ready' | 'blocked';
    reason:
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
        disclosures: Array<{
            actorPubkey: string;
            publicReason: GovernanceCaseConflictReason;
        }>;
        viewerStatus: 'eligible' | 'recused' | 'ineligible';
        canSelfDisclose: boolean;
    };
    quadraticFunding: GovernanceQuadraticFundingActivationReadiness | null;
    quadraticVoice: GovernanceQuadraticVoiceActivationReadiness | null;
}

export interface GovernanceCaseDecisionStages {
    integrity: 'verified' | 'invalid';
    digest: string | null;
    resolutionRule: 'all_required' | null;
    frozenAt: string | null;
    evidencePolicy: {
        mode: 'continue_from_frozen_package_digests';
        postFreezeAccess: 'live_visibility_gate';
        revocationEffect: 'deny_future_access_without_rewriting_stage';
        packages: Array<{
            id: string;
            version: number;
            digest: string;
            authorizedAt: string;
            expiresAt: string | null;
        }>;
    } | null;
    outcome: 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | null;
    stages: Array<{
        stageRef: string;
        order: number;
        purpose: 'review_gate' | 'approval';
        institutionalAuthority: { type: string; ref: string; version: string };
        provider: { type: string; version: string };
        mechanism:
            | {
                status: 'not_applicable';
                reason: 'snapshot_bound_human_review';
            }
            | {
                status: 'invalid';
                reason: 'mechanism_contract_invalid';
            }
            | {
                schemaVersion: 1;
                kind: 'equal_weight_threshold';
                algorithm: { id: 'committee.member_threshold'; version: '1' };
                result: { type: 'native_ballot_tally' };
                contractDigest: string;
            }
            | {
                schemaVersion: 1;
                kind: 'quadratic_voice_credits';
                algorithm: { id: 'native.quadratic_voice_credits'; version: '1' };
                result: { type: 'multi_choice_voice_credit_tally' };
                contractDigest: string;
            }
            | {
                schemaVersion: 1;
                kind: 'quadratic_funding';
                algorithm: { id: 'native.quadratic_funding'; version: '1' };
                result: { type: 'allocation_plan' };
                contractDigest: string;
            };
        requiredForApproval: boolean;
        vetoOnReject: boolean;
        startCondition: string;
        expiresAt: string | null;
        onExpire: string;
        onUnavailable: string;
        shortCircuitRule: string;
        decisionRef: { type: string; ref: string };
        state: 'active' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | 'reconciliation_required' | 'unavailable';
    }>;
}

export interface GovernanceCaseDecisionAuthorityStages {
    integrity: 'verified' | 'invalid' | 'not_frozen';
    stages: Array<{
        stageRef: string;
        order: number;
        purpose: 'review_gate' | 'approval';
        decisionAuthority: {
            authorityClass: 'institutional' | 'workflow_stage';
            type: string;
            ref: string;
            version: string;
        };
        state: GovernanceCaseDecisionStages['stages'][number]['state'];
    }>;
}

export interface GovernanceCaseIntakeSuggestion {
    caseId: string;
    title: string;
    phase: GovernanceCasePhase;
    canonicalUrl: string;
    reasons: Array<'same_external_ref' | 'same_title' | 'similar_title' | 'active_same_subject'>;
    recommendedAction: 'merge' | 'related' | 'supersedes';
}

export type GovernanceCasePhase =
    | 'intake'
    | 'proposal_drafting'
    | 'evidence_review'
    | 'ready_for_decision'
    | 'decision_in_progress'
    | 'execution_preparation'
    | 'execution_in_progress'
    | 'outcome_review'
    | 'closed'
    | 'archived';

export type GovernanceCaseResponsibilityKind = 'coordinator' | 'review' | 'execution' | 'outcome';
export type GovernanceCaseReviewConclusion = 'changes_required' | 'signoff_granted' | 'signoff_denied' | 'abstained' | 'conflict_declared';
export type GovernanceCaseReviewRelationshipActorRole = 'reviewer' | 'proposer';
export type GovernanceCaseReviewRelationship = 'none' | 'personal' | 'professional' | 'financial' | 'organizational' | 'other';
export type GovernanceCaseResponsibilityStatus = 'assigned' | 'accepted' | 'declined' | 'escalated' | 'absent';
export type GovernanceCaseResponsibilityAction =
    | 'accept'
    | 'decline'
    | 'reassign'
    | 'escalate'
    | 'absence'
    | 'extend_deadline'
    | 'cancel_deadline';

export interface GovernanceCaseResponsibility {
    kind: GovernanceCaseResponsibilityKind;
    assigneePubkey: string;
    status: GovernanceCaseResponsibilityStatus;
    version: number;
    assignedByPubkey: string;
    assignedAt: string | null;
    deadlineAt: string | null;
    respondedAt: string | null;
    reason: string | null;
}

export interface GovernanceCaseBriefCandidate {
    draftPostId: number;
    title: string;
    documentStatus: string;
    draftVersion: number;
    snapshotDigest: string;
    snapshotCreatedAt: string;
    updatedAt: string;
    sectionReady: boolean;
    missingSectionKeys: GovernanceBriefSectionKey[];
}

export type GovernanceBriefSectionKey =
    | 'identity'
    | 'requested_decision'
    | 'background'
    | 'options'
    | 'arguments'
    | 'supporting_evidence'
    | 'arguments_for'
    | 'arguments_against'
    | 'risks'
    | 'open_questions'
    | 'execution_plan'
    | 'provider_readiness'
    | 'outcome';

export interface GovernanceCaseWorkflow {
    legacy: boolean;
    version: number | null;
    canManage: boolean;
    responsibilities: GovernanceCaseResponsibility[];
    timeline: Array<{
        id: string;
        eventType: string;
        responsibilityKind: GovernanceCaseResponsibilityKind | null;
        actorPubkey: string | null;
        actorUserId: number | null;
        subjectPubkey: string | null;
        fromState: string | null;
        toState: string | null;
        reason: string | null;
        caseVersion: number | null;
        responsibilityVersion: number | null;
        responsibilityDeadlineAt: string | null;
        briefDraftPostId: number | null;
        briefDraftVersion: number | null;
        briefSnapshotDigest: string | null;
        briefSnapshotStatus: 'current' | 'invalidated' | null;
        briefSnapshotInvalidationReason: 'brief_snapshot_changed' | null;
        reviewPublicBasis: string | null;
        reviewThreadId: string | null;
        createdAt: string | null;
    }>;
    candidates: Array<{
        pubkey: string;
        handle: string;
        displayName: string | null;
        role: string;
        eligibleResponsibilityKinds: GovernanceCaseResponsibilityKind[];
    }>;
}

export type GovernanceCaseType =
    | 'signal'
    | 'policy'
    | 'public_asset'
    | 'program'
    | 'grant'
    | 'external_research';

type GovernanceCaseActionAuthorityBase = {
    schemaVersion: 1;
    projectionBindingId: string;
    sourceVersion: string;
    profile: {
        bindingId: string;
        versionRef: string;
        definitionDigest: string;
    };
    authorityPolicyBinding: {
        id: string;
        bindingDigest: string;
        sourceType: 'governance_mandate' | 'governance_recovery_policy' | 'circle_governance_binding';
        sourceRef: string;
        sourceVersion: string | null;
        purpose: 'collective_decision';
        limitsDigest: string;
    };
    governanceHome: { type: 'circle'; ref: string };
    committeeHome: { type: 'circle'; ref: string };
    subject: {
        type:
            | 'circle'
            | 'circle_governance_binding'
            | 'communication_room_member'
            | 'governed_operator_capability'
            | 'external_provider'
            | 'external_app_circle_binding';
        ref: string;
    };
    action: {
        type: string;
        selector: { actionType: string | null; actionPrefix: string | null };
        riskFloor: 'low' | 'medium' | 'high' | 'critical';
    };
    minimumConstraints: GovernanceMandateMinimumConstraints;
    purpose: 'collective_decision';
    operatorSelector: { mode: 'not_applicable'; reason: 'collective_decision' };
    executionAuthorityRequirement: {
        type: 'registered_adapter';
        adapter: string;
        executionDomain: string;
        liveReadback: 'required_before_execution';
        runtimeOwner: 'P06';
    };
    environment: 'local_development';
    network: 'solana:localnet';
    policy: { id: string; versionId: string; version: number; ruleId: string };
    effectiveFrom: string;
    effectiveUntil: string | null;
};

export type GovernanceCaseActionAuthority =
    | (GovernanceCaseActionAuthorityBase & {
        sourceType: 'governance_mandate';
        mandateId: string;
        mandateVersion: number;
        mandateTermsDigest: string;
    })
    | (GovernanceCaseActionAuthorityBase & {
        sourceType: 'governance_recovery_policy';
        mandateId: null;
        mandateVersion: null;
        mandateTermsDigest: null;
        recoveryPolicy: {
            id: string;
            trigger: 'zero_eligible_electorate';
            actorSnapshotDigest: string;
            maxCostMinor: '0';
            singleUse: true;
        };
    })
    | (GovernanceCaseActionAuthorityBase & {
        sourceType: 'circle_governance_binding';
        mandateId: null;
        mandateVersion: null;
        mandateTermsDigest: null;
        selfBinding: { bindingType: 'self_governed'; status: 'active' };
    });

export interface GovernanceCaseTemplateSelection {
    templateId: string;
    templateVersion: number;
    labelKey: string;
    readinessState: 'ready' | 'setup_required' | 'degraded' | 'unavailable';
    profile: { bindingId: string; versionRef: string; definitionDigest: string } | null;
    participationPolicy: GovernanceCaseParticipationPolicy | null;
    conflictOfInterestPolicy: GovernanceCaseConflictOfInterestPolicy | null;
    actionContract: {
        actionType: string;
        contractVersionId: string;
        definitionDigest: string;
        executionAdapter: string;
        executionDomain: string;
        riskFloor: 'low' | 'medium' | 'high' | 'critical';
    } | null;
    actionAuthority: GovernanceCaseActionAuthority | null;
    institutionalResponsibility: {
        schemaVersion: 1;
        sourceType:
            | 'governance_mandate'
            | 'governance_recovery_policy'
            | 'circle_governance_binding'
            | 'system_governance_role_binding';
        sourceRef: string;
        sourceVersion: string;
        decisionAuthority: {
            type: 'governance_committee' | 'recovery_circle' | 'system_governance_role';
            ref: string;
            version: string;
        };
        caseHome: { type: string; ref: string };
        decidingCircleHome: { type: 'circle'; ref: string };
        governedSubject: { type: string; ref: string };
        mandate: null | { id: string; version: number; termsDigest: string };
        systemRole: null | {
            domain: 'external_app';
            roleKey: string;
            environment: 'sandbox' | 'production';
        };
        recoveryPolicy?: null | {
            id: string;
            trigger: 'zero_eligible_electorate';
        };
        workflowAssignmentAuthority: 'none';
    } | null;
    decisionProvider: string;
    decisionMechanism: {
        kind: 'equal_weight_threshold';
        schemaId: 'alcheme.native.equal-weight-threshold';
        schemaVersion: 1;
        resolverId: 'committee.member_threshold';
        resolverVersion: '1';
        provider: 'alcheme_internal';
        availability: 'available';
    } | {
        kind: 'quadratic_voice_credits';
        schemaId: 'alcheme.native.quadratic-voice-credits';
        schemaVersion: 1;
        resolverId: 'native.quadratic_voice_credits';
        resolverVersion: '1';
        provider: 'alcheme_internal';
        availability: 'available';
        choiceSet: Array<{ id: string; label: string }>;
    } | {
        kind: 'quadratic_funding';
        schemaId: 'alcheme.native.quadratic-funding';
        schemaVersion: 1;
        resolverId: 'native.quadratic_funding';
        resolverVersion: '1';
        provider: 'alcheme_internal';
        availability: 'available';
        round: {
            roundRef: string;
            budgetUnit: string;
            matchingBudget: number;
            commitmentCapPerActorPerProject: number;
            formula: 'integer_sqrt_quadratic_matching';
            rounding: 'largest_remainder_then_project_ref';
            projects: Array<{ id: string; label: string; projectRef: string; recipientRef: string; allocationCap: number }>;
            excludedProjects: Array<{ projectRef: string; reason: string }>;
        };
    } | null;
    executionProvider: string;
    sourceProvider: string;
    executionPreparation: string;
    reviewPolicy: {
        reviewerReplacement: 'manager_or_current_reviewer';
        appeal: 'not_available';
        higherReviewGate: 'review_responsibility_escalation';
    } | null;
    outcomePolicy: {
        closeSignoff: 'accepted_outcome_reviewer';
        highImpactThreshold: 'high';
        executorSeparation: 'required';
    } | null;
    digest: string | null;
}

export type GovernanceCaseConflictReason =
    | 'material_relationship'
    | 'financial_interest'
    | 'subject_or_recipient'
    | 'provider_or_operator_role'
    | 'other_public_conflict';

export interface GovernanceCaseConflictOfInterestPolicy {
    disclosure: 'eligible_actor_self_disclosure';
    recusal: 'required_on_disclosure';
    electorateEffect: 'exclude_from_eligible_denominator';
    thresholdEffect: 'evaluate_frozen_rule_against_remaining_electorate';
    alternate: 'none';
    unreachable: 'block_schedule';
    publicReason: 'required';
    selfExemption: 'forbidden';
}

export interface GovernanceCaseTemplateCatalog {
    profile: { bindingId: string; versionRef: string; definitionDigest: string };
    participationPolicy: GovernanceCaseParticipationPolicy | null;
    requestedCaseType: GovernanceCaseType;
    availableTemplates: GovernanceCaseTemplateCatalogItem[];
    excludedTemplates: GovernanceCaseTemplateCatalogItem[];
    actionOptions: Array<{
        actionType: string;
        executionAdapter: string;
        executionDomain: string;
        impact: string;
        readiness?: 'discoverable';
        nextStep?: 'configure_governance_binding' | 'select_subject' | 'open_case';
        userReadiness?:
            | 'configurable'
            | 'pending_authorization'
            | 'ready_for_case'
            | 'service_unavailable'
            | 'network_mismatch'
            | 'historical_read_only';
        reasonCode?: string;
    }>;
    externalActionShadowCompare?: Array<{
        actionType: string;
        legacyProfileCatalogMatched: boolean;
        genericDiscoveryState: string;
        agreement: boolean;
        userReadiness: string;
        nextStep?: string;
        reasonCode?: string;
    }>;
    mechanisms: GovernanceMechanismCatalogItem[];
    providerReadiness: Array<{
        provider: 'alcheme_internal' | 'realms' | 'realms_plugin' | 'squads' | 'metadao'
            | 'solana_attestation_service' | 'trusta_risk' | 'solana_id_reputation'
            | 'kyc_uniqueness_liveness' | 'solana_name_service' | 'kora';
        availability: 'available' | 'unavailable';
        readinessState: 'ready' | 'setup_required' | 'degraded' | 'unavailable';
        riskMaturity: 'stable' | 'experimental';
        registry: {
            sourceRef: 'current_governance_case_template_catalog';
            lifecycle: 'active' | 'candidate';
            capabilityRole: 'native_governance' | 'provider_governance' | 'attestation_transport'
                | 'identity_risk_signal' | 'identity_reputation_signal'
                | 'identity_kyc_uniqueness_liveness' | 'name_resolution_display_input'
                | 'fee_abstraction';
            integrationKind: 'protocol_direct' | 'protocol_direct_or_sdk_proxy'
                | 'managed_service_or_self_hosted' | 'issuer_adapter';
            network: string;
            auth: string;
            feeModel: string;
            availabilityBoundary: string;
            privacyBoundary: string;
            requiredReadback: string[];
            forbiddenMappings: string[];
            contractPortability: {
                evmDependency: 'none';
                requiredProviderKeys: string[];
                forbiddenAssumptions: string[];
                futureGate: 'required_for_new_adapter_or_reference_fixture';
            };
            authoritySeparation: {
                institutionalDecisionAuthority: 'committee_circle' | 'native_governance_policy' | 'provider_external';
                providerStageBinding: 'not_required' | 'required_only_when_committee_policy_selects_external_provider';
                bindingCondition: string;
            };
            specializedReadiness: {
                votingPowerPlugin: null | {
                    registrarRef: 'required_before_activation';
                    pluginProgramRef: 'required_before_activation';
                    voterWeightRecord: 'required_before_activation';
                    calculatedWeight: 'required_before_activation';
                    updatedAt: 'required_before_activation';
                    availability: 'blocked_until_verified_vsr_vwr_nft_or_existing_plugin';
                    offChainContributionScore: 'requires_new_oracle_attestation_and_on_chain_plugin';
                    customPluginAvailabilityClaim: 'forbidden_without_verified_program';
                };
                conditionalMarket: null | {
                    provider: 'metadao';
                    twap: 'required_before_use';
                    liquidity: 'required_before_use';
                    finalization: 'required_before_use';
                    feeDisclosure: 'required_before_use';
                    terminalEvidence: 'provider_native_market_outcome_required';
                    alchemeTallyMode: 'forbidden';
                };
                enforcementGateway: {
                    nativeSnapshotGate: 'alcheme_snapshot_gate' | 'not_applicable';
                    externalProviderConsumption: 'verified_on_chain_plugin_or_gateway_required' | 'not_applicable';
                    missingGatewayDisposition: 'advisory_only' | 'not_applicable';
                    requiredPolicyMapping: 'weaker_or_not_representable_blocks_activation' | 'native_exact';
                };
            };
        };
        stageGate: {
            openStage: 'allowed' | 'blocked';
            execute: 'allowed' | 'blocked';
            riskConfirmation: 'not_required' | 'required';
            riskDoesNotOverrideReadiness: true;
        };
        checks: Record<'program' | 'version' | 'ui' | 'enforcement' | 'finality' | 'readback', boolean>;
        reasonCodes: string[];
    }>;
}

export interface GovernanceCaseParticipationPolicy {
    admission: { source: 'circle_membership'; grantsProposalRight: false; grantsVoteRight: false };
    proposalCreation: { source: 'case_template_role_gate'; eligibleRoles: ['Owner', 'Admin', 'Moderator']; policyRequiresRegisteredAction: true };
    voterEligibility: { source: 'frozen_governance_snapshot'; electorate: 'active_committee_members'; roleGrantsExtraWeight: false };
    votingPower: { mode: 'equal_one' | 'policy_voice_credit_budget'; weightedVotingEnabled: false };
    contribution: Record<'admission' | 'proposal' | 'voterEligibility' | 'votingPower', 'not_configured'>;
    correction: { source: 'circle_membership_correction'; appeal: 'not_available' };
}

export interface GovernanceMechanismCatalogItem {
    kind: 'equal_weight_threshold' | 'quadratic_token_weight' | 'quadratic_voice_credits'
        | 'quadratic_funding' | 'ranked_choice' | 'approval_voting' | 'conviction_voting'
        | 'optimistic_challenge' | 'sortition' | 'bicameral' | 'futarchy';
    availability: 'available' | 'unavailable';
    resource: string;
    formula: string;
    sybilRisk: string;
    resultType: string;
    provider: string;
    boundaries: Record<'electorate' | 'input' | 'resolver' | 'finality' | 'result', string>;
    identityEnforcement: null | {
        claimClass: string;
        acquisition: string;
        appeal: string;
        providerEnforcement: string;
        feePolicy: string;
    };
    reasonCodes: string[];
}

export interface GovernanceCaseTemplateCatalogItem {
    templateId: string;
    templateVersion: number;
    labelKey: string;
    supportedCaseTypes: GovernanceCaseType[];
    readinessState: 'ready' | 'setup_required' | 'degraded' | 'unavailable';
    reasonCodes: string[];
}

export type GovernanceCaseIntakeOriginKind =
    | 'manual_item'
    | 'plaza_selection'
    | 'public_url'
    | 'external_proposal';

export type GovernanceLegacyMigrationAction =
    | 'execute_transfer'
    | 'propose_transfer'
    | 'submit_ai_evaluation'
    | 'update_decision_engine'
    | 'vote';

export type GovernanceLegacyRecoveryRehearsalScenario =
    | 'provider_outage'
    | 'indexer_lag'
    | 'partial_execution'
    | 'lost_key';

export type GovernanceLegacyMigrationCutoverActionStatus =
    | 'wallet_signature_available'
    | 'blocked_by_compatibility_blockers'
    | 'blocked_by_active_recovery'
    | 'already_active'
    | 'recovery_readback_required'
    | 'rolled_back_history_read_only';

export interface GovernanceLegacyMigrationReport {
    circleId: number;
    network: 'solana:localnet';
    compatibilityBundleId: string;
    compatibilityBundleDigest: string;
    state: 'compatibility_ready' | 'cutover_active' | 'recovery_required' | 'rolled_back';
    ownerLockIntent: {
        network: 'solana:localnet';
        circleId: number;
        circleAccountRef: string;
        expectedOwnerPubkey: string;
        actions: GovernanceLegacyMigrationAction[];
        actionMask: number;
        compatibilityBundleDigest: string;
        openProposalDispositionDigest: string;
    } | null;
    migrationRecordRef: string | null;
    transactionSignature: string | null;
    authorityMatrix: Array<{
        actionType: GovernanceLegacyMigrationAction;
        before: { disposition: string; rollback: string };
        after: { disposition: string; rollback: string } | null;
        programGuardLocked: boolean;
    }>;
    inFlightDisposition: {
        governanceRequests: unknown[];
        openTransferProposals: unknown[];
        assetJobs: unknown[];
    };
    residualBypass: GovernanceLegacyMigrationAction[];
    rollbackEvidence: Array<{ actionType: GovernanceLegacyMigrationAction; rollback: string }>;
    historicalExecutionBoundary: {
        policy: 'preserve_original_disposition_never_automatic_reexecute';
        governanceRequestRefs: string[];
        transferProposalRefs: string[];
        crystalAssetJobRefs: string[];
        rollback:
            | 'pre_cutover_no_effect_history_remains_read_only'
            | 'post_cutover_roll_forward_only_history_remains_read_only';
        auditDigest: string;
    };
    recoveryRehearsal: {
        authority: 'canonical_recovery_projections_and_migration_report';
        source: 'canonical_provider_indexer_and_authority_health_owners';
        currentFactState: 'active_recovery_facts' | 'no_active_recovery_fact';
        currentFacts: GovernanceLegacyMigrationRecoveryFact[];
        scenarios: Array<{
            scenario: GovernanceLegacyRecoveryRehearsalScenario;
            blocker:
                | 'provider_readback_outage'
                | 'indexer_lag_or_finality_gap'
                | 'partial_execution_reconciliation_required'
                | 'authority_lost_key_high_risk_freeze';
            executionPolicy:
                | 'block_new_execution_until_reconciled'
                | 'authoritative_program_readback_before_cutover'
                | 'preserve_receipt_and_block_legacy_reexecution'
                | 'block_cutover_until_new_wallet_signed_health_case_and_review';
            recoveryAction:
                | 'restore_readback_then_reconcile_same_receipt'
                | 'refresh_program_readback_then_rebuild_compatibility_bundle'
                | 'same_receipt_reconciliation_or_roll_forward_recovery'
                | 'new_accepted_wallet_signed_health_case_without_fault';
            acceptedDecisionPreserved: true;
            retryMode: 'blocked_until_recovery_fact' | 'same_request_only';
        }>;
        observedCutoverState: GovernanceLegacyMigrationReport['state'];
        historicalBoundary: GovernanceLegacyMigrationReport['historicalExecutionBoundary']['rollback'];
        auditDigest: string;
    };
    chainRecoveryBoundary: {
        authority: 'canonical_program_readback_and_cutover_record';
        currentState: GovernanceLegacyMigrationReport['state'];
        historicalBoundary: GovernanceLegacyMigrationReport['historicalExecutionBoundary']['rollback'];
        verifiedRollbackPath:
            | 'not_applicable_before_cutover_effect'
            | 'not_available_after_program_guard_lock';
        allowedRecovery:
            | 'refresh_dry_run_or_cancel_without_program_effect'
            | 'forward_upgrade_or_governed_recovery_only';
        databaseRollbackMayClaimChainRecovery: false;
        confirmedTransactionSelfProvesRecovery: false;
        normalizedReceiptSelfProvesRecovery: false;
        historicalRecordPolicy: GovernanceLegacyMigrationReport['historicalExecutionBoundary']['policy'];
        auditDigest: string;
    };
    cutoverAction: {
        authority: 'server_verified_migration_surface';
        compatibilityBundleId: string;
        compatibilityBundleDigest: string;
        cutoverState: GovernanceLegacyMigrationReport['state'];
        historicalBoundary: GovernanceLegacyMigrationReport['historicalExecutionBoundary']['rollback'];
        status: GovernanceLegacyMigrationCutoverActionStatus;
        walletSignatureAllowed: boolean;
        disabledReason:
            | null
            | 'compatibility_blockers_present'
            | 'active_recovery_facts_present'
            | 'cutover_already_verified'
            | 'cutover_recovery_required'
            | 'future_routing_rolled_back_history_read_only';
        nextAction:
            | 'owner_wallet_signature_then_server_verified_finalize'
            | 'resolve_compatibility_blockers_then_refresh_dry_run'
            | 'resolve_active_recovery_facts_then_refresh'
            | 'refresh_verified_readback_only'
            | 'restore_dependencies_then_verified_readback'
            | 'new_circle_or_program_upgrade_only';
        auditDigest: string;
    };
    auditTimeline: {
        authority: 'canonical_compatibility_and_cutover_records';
        currentState: GovernanceLegacyMigrationReport['state'];
        historicalBoundary: GovernanceLegacyMigrationReport['historicalExecutionBoundary']['rollback'];
        events: Array<{
            eventType:
                | 'compatibility_bundle_persisted'
                | 'program_cutover_verified'
                | 'recovery_required'
                | 'verified_readback_restored'
                | 'future_routing_rolled_back';
            occurredAt: string;
            state: GovernanceLegacyMigrationReport['state'];
            recordRef: string;
        }>;
        auditDigest: string;
    };
    migrationReadiness: {
        authority: 'canonical_migration_report';
        scope: 'existing_circle_action_cutover';
        currentState: GovernanceLegacyMigrationReport['state'];
        historicalBoundary: GovernanceLegacyMigrationReport['historicalExecutionBoundary']['rollback'];
        status: 'ready' | 'not_ready' | 'recovery_required';
        metrics: {
            actionsTotal: number;
            programGuardsLocked: number;
            residualLegacyBypass: number;
            blockingCompatibilityFacts: number;
            protectedHistoricalRecords: number;
            activeRecoveryFacts: number;
        };
        redlines: {
            programGuardLockComplete: boolean;
            residualLegacyBypassZero: boolean;
            compatibilityBlockersCleared: boolean;
            historicalAutomaticReexecutionForbidden: boolean;
            activeRecoveryFactsClear: boolean;
        };
        auditDigest: string;
    };
    blockers: string[];
}

export interface GovernanceLegacyMigrationRecoveryFact {
    scenario: GovernanceLegacyRecoveryRehearsalScenario;
    caseId: string;
    requestId: string;
    provider: 'realms_provider_binding' | 'squads_provider_binding' | null;
    authority:
        | 'canonical_provider_receipt_and_reconciliation'
        | 'canonical_provider_and_indexer_observation'
        | 'canonical_cost_preflight_provider_checkpoint'
        | 'canonical_wallet_signed_authority_health_binding';
    state: 'blocked' | 'degraded' | 'partially_executed';
    blocker:
        | 'provider_readback_outage'
        | 'indexer_lag_or_finality_gap'
        | 'partial_execution_reconciliation_required'
        | 'authority_lost_key_high_risk_freeze';
    recoveryAction:
        | 'restore_readback_then_reconcile_same_receipt'
        | 'refresh_program_readback_then_rebuild_compatibility_bundle'
        | 'same_receipt_reconciliation_or_roll_forward_recovery'
        | 'new_accepted_wallet_signed_health_case_without_fault';
    retryMode: 'blocked_until_recovery_fact' | 'same_request_only';
    acceptedDecisionPreserved: true;
    observedAt: string | null;
    receiptId: string | null;
    providerObservedSlot: number | null;
    indexedSlot: number | null;
    completedSteps: number | null;
    remainingSteps: number | null;
    authorityBindingId: string | null;
    authorityEvidenceDigest: string | null;
    affectedActorPubkey: string | null;
    evidenceRef: string | null;
    freezeEndsAt: string | null;
    reviewDueAt: string | null;
    reviewStatus: 'required' | 'overdue' | null;
    authorityContinuity: {
        state: 'active_signer_wait' | 'permanently_blocked_external_authority';
        policy: 'authority_health_emergency_freeze_continuity_policy';
        signerWaitExceeded: boolean;
        providerNativeRotationAvailable: false;
        circleOwnerAdminFallbackAllowed: false;
        fallbackAuthority: 'none';
        requiredRecovery: 'new_accepted_wallet_signed_health_case_without_fault_or_external_reconstitution';
    } | null;
    authorityDisposition: {
        authority: 'canonical_provider_resource_authority_or_wallet_signed_health_readback';
        providerReadback:
            | 'authoritative_unavailable'
            | 'authoritative_degraded'
            | 'partial_finalized_checkpoint'
            | 'not_applicable_wallet_signer_fault';
        resourceAuthority:
            | 'provider_authoritative_readback_required'
            | 'canonical_cost_preflight_provider_checkpoint'
            | 'wallet_signed_authority_health_binding';
        recoveryState:
            | 'provider_recovery_required'
            | 'resource_authority_rotation_required'
            | 'partial_execution_reconciliation_required'
            | 'permanently_blocked_external_authority';
        acceptedArtifact: {
            caseId: string;
            requestId: string;
            receiptId: string | null;
            authorityBindingId: string | null;
        };
        unfulfilledObligations: string[];
        residualRisks: string[];
        fallbackAuthority: 'none';
        circleOwnerAdminFallbackAllowed: false;
    };
}

export interface GovernanceLegacyMigrationAuditExport {
    schemaVersion: 1;
    audience: 'circle_manager';
    circleId: number;
    exportedAt: string;
    digestDomain: 'alcheme.governance.legacy-migration-audit-export';
    digestAlgorithm: 'sha256';
    exportDigest: string;
    report: GovernanceLegacyMigrationReport;
}

export function normalizeGovernanceLegacyMigrationAuditExport(
    value: any,
    expectedCircleId: number,
): GovernanceLegacyMigrationAuditExport {
    if (
        value?.schemaVersion !== 1
        || value?.audience !== 'circle_manager'
        || value?.circleId !== expectedCircleId
        || typeof value?.exportedAt !== 'string'
        || !Number.isFinite(Date.parse(value.exportedAt))
        || value?.digestDomain !== 'alcheme.governance.legacy-migration-audit-export'
        || value?.digestAlgorithm !== 'sha256'
        || !/^[a-f0-9]{64}$/.test(String(value?.exportDigest ?? ''))
    ) {
        throw new Error('invalid_governance_legacy_migration_audit_export');
    }
    let report: GovernanceLegacyMigrationReport;
    try {
        report = normalizeGovernanceLegacyMigrationReport(value.report, expectedCircleId);
    } catch {
        throw new Error('invalid_governance_legacy_migration_audit_export');
    }
    return {
        schemaVersion: 1,
        audience: 'circle_manager',
        circleId: expectedCircleId,
        exportedAt: value.exportedAt,
        digestDomain: 'alcheme.governance.legacy-migration-audit-export',
        digestAlgorithm: 'sha256',
        exportDigest: value.exportDigest,
        report,
    };
}

export async function prepareCircleGovernanceMigrationDryRun(
    circleId: number,
): Promise<GovernanceLegacyMigrationReport> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${circleId}/governance-migration/compatibility`,
        { init: { method: 'POST', cache: 'no-store' } },
    );
    return normalizeGovernanceLegacyMigrationReport(data?.report, circleId);
}

export async function fetchCircleGovernanceMigrationReport(
    circleId: number,
): Promise<GovernanceLegacyMigrationReport> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${circleId}/governance-migration`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    return normalizeGovernanceLegacyMigrationReport(data?.report, circleId);
}

export async function exportCircleGovernanceMigrationAudit(
    circleId: number,
): Promise<GovernanceLegacyMigrationAuditExport> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${circleId}/governance-migration/export`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    return normalizeGovernanceLegacyMigrationAuditExport(data?.export, circleId);
}

export async function finalizeCircleGovernanceMigration(input: {
    circleId: number;
    compatibilityBundleId: string;
    transactionSignature: string;
}): Promise<GovernanceLegacyMigrationReport> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/circles/${input.circleId}/governance-migration/finalize`,
        {
            init: {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    compatibilityBundleId: input.compatibilityBundleId,
                    transactionSignature: input.transactionSignature,
                }),
            },
        },
    );
    return normalizeGovernanceLegacyMigrationReport(data?.report, input.circleId);
}

export async function fetchCircleGovernanceBindings(
    circleId: number,
    signal?: AbortSignal,
): Promise<CircleGovernanceBindingsPayload> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${circleId}/governance-bindings`, {
        init: {
            method: 'GET',
            cache: 'no-store',
            signal,
        },
    });
    return {
        circleId: Number(data?.circleId || circleId),
        recovery: normalizeGovernanceRecoveryReadback(data?.recovery),
        resourceReadiness: normalizeCircleGovernanceResourceReadiness(data?.resourceReadiness),
        fallback: data?.fallback?.status === 'action_registry_resolved'
            ? {
                status: 'action_registry_resolved',
                reason: String(data.fallback.reason || 'no_active_governance_binding'),
                authorityTransparency: normalizeUnboundAuthorityTransparency(
                    data.fallback.authorityTransparency,
                ),
            }
            : null,
        bindings: Array.isArray(data?.bindings)
            ? data.bindings.map(normalizeBinding)
            : [],
        committeeBindings: Array.isArray(data?.committeeBindings)
            ? data.committeeBindings.map(normalizeBinding)
            : [],
    };
}

export async function fetchRealmsProviderTrustReadback(
    circleId: number,
): Promise<RealmsProviderTrustReadback> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-trust/realms/readback`,
        {
            init: {
                method: 'GET',
                cache: 'no-store',
            },
        },
    );
    const value = data?.readback;
    if (
        Number(data?.circleId) !== circleId
        || value?.status !== 'verified_read_only'
        || typeof value?.profileRef !== 'string'
        || !value.profileRef.trim()
        || !Number.isSafeInteger(value?.profileVersion)
        || value.profileVersion <= 0
        || typeof value?.profileDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.profileDigest)
        || value?.chainId !== 'solana:devnet'
        || typeof value?.genesisHash !== 'string'
        || typeof value?.programId !== 'string'
        || typeof value?.programDataAddress !== 'string'
        || typeof value?.upgradeAuthority !== 'string'
        || !Number.isSafeInteger(value?.lastDeployedSlot)
        || typeof value?.deployedProgramBytesSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.deployedProgramBytesSha256)
        || typeof value?.decoder?.package !== 'string'
        || typeof value?.decoder?.realm !== 'string'
        || typeof value?.decoder?.governance !== 'string'
        || typeof value?.decoder?.realmConfig !== 'string'
        || value?.decoder?.addins !== 'absent'
        || value?.commitment !== 'finalized'
        || !Number.isSafeInteger(value?.observedSlot)
        || value.observedSlot <= 0
        || typeof value?.observedAt !== 'string'
        || !Number.isFinite(Date.parse(value.observedAt))
        || !Number.isSafeInteger(value?.attemptCount)
        || value.attemptCount <= 0
        || value?.activation !== 'not_activated'
        || !isRealmsRuntimeSignerReadback(value?.runtimeSigner, value)
    ) {
        throw new Error('realms_provider_trust_readback_invalid');
    }
    return {
        status: 'verified_read_only',
        profileRef: value.profileRef.trim(),
        profileVersion: Number(value.profileVersion),
        profileDigest: value.profileDigest,
        chainId: 'solana:devnet',
        genesisHash: value.genesisHash,
        programId: value.programId,
        programDataAddress: value.programDataAddress,
        upgradeAuthority: value.upgradeAuthority,
        lastDeployedSlot: Number(value.lastDeployedSlot),
        deployedProgramBytesSha256: value.deployedProgramBytesSha256,
        decoder: {
            package: value.decoder.package,
            realm: value.decoder.realm,
            governance: value.decoder.governance,
            realmConfig: value.decoder.realmConfig,
            addins: 'absent',
        },
        commitment: 'finalized',
        observedSlot: Number(value.observedSlot),
        observedAt: new Date(value.observedAt).toISOString(),
        attemptCount: Number(value.attemptCount),
        activation: 'not_activated',
        runtimeSigner: normalizeRealmsRuntimeSignerReadback(value.runtimeSigner),
    };
}

function isRealmsRuntimeSignerReadback(value: any, deployment: any): boolean {
    const validStatus = value?.status === 'not_configured'
        || value?.status === 'pending_keys'
        || value?.status === 'verified_read_only'
        || value?.status === 'unavailable';
    const validIdentityStatus = value?.applicationIdentity?.status === 'not_configured'
        || value?.applicationIdentity?.status === 'pending_keys'
        || value?.applicationIdentity?.status === 'verified'
        || value?.applicationIdentity?.status === 'unavailable';
    const validKeys = Array.isArray(value?.keys) && value.keys.every((key: any) => (
        typeof key?.role === 'string'
        && key.role.trim().length > 0
        && typeof key?.keyRef === 'string'
        && key.keyRef.trim().length > 0
        && (key.publicKey === null || typeof key.publicKey === 'string')
        && (key.status === 'pending_generation' || key.status === 'verified' || key.status === 'unavailable')
        && (key.status !== 'verified' || Boolean(key.publicKey))
    ));
    return validStatus
        && value?.signerProvider === 'openbao_transit'
        && value?.chainId === 'solana:devnet'
        && value?.profileRef === deployment?.profileRef
        && value?.profileVersion === deployment?.profileVersion
        && (value?.resourceBindingId === null || typeof value?.resourceBindingId === 'string')
        && value?.applicationIdentity?.authMethod === 'openbao_periodic_token'
        && typeof value?.applicationIdentity?.credentialRef === 'string'
        && value.applicationIdentity.credentialRef.startsWith('macos-keychain:')
        && value?.applicationIdentity?.policyName === 'alcheme-realms-devnet-runtime-current'
        && value?.applicationIdentity?.tokenPeriodSeconds === 86400
        && validIdentityStatus
        && validKeys
        && (value?.observedAt === null
            || (typeof value?.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt))))
        && (value?.blocker === null || typeof value?.blocker === 'string');
}

function normalizeRealmsRuntimeSignerReadback(
    value: any,
): RealmsProviderTrustReadback['runtimeSigner'] {
    return {
        status: value.status,
        signerProvider: 'openbao_transit',
        chainId: 'solana:devnet',
        profileRef: value.profileRef,
        profileVersion: Number(value.profileVersion),
        resourceBindingId: value.resourceBindingId,
        applicationIdentity: {
            authMethod: 'openbao_periodic_token',
            credentialRef: value.applicationIdentity.credentialRef,
            policyName: 'alcheme-realms-devnet-runtime-current',
            tokenPeriodSeconds: 86400,
            status: value.applicationIdentity.status,
        },
        keys: value.keys.map((key: any) => ({
            role: key.role,
            keyRef: key.keyRef,
            publicKey: key.publicKey,
            status: key.status,
        })),
        observedAt: value.observedAt === null
            ? null
            : new Date(value.observedAt).toISOString(),
        blocker: value.blocker,
    };
}

export async function requestRealmsProviderBinding(
    circleId: number,
): Promise<{
    status: 'requires_governance';
    actionType: 'circle.provider_binding.realms.create';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-bindings/realms/requests`,
        { init: { method: 'POST' } },
    );
    if (
        data?.status !== 'requires_governance'
        || data?.actionType !== 'circle.provider_binding.realms.create'
        || !data?.request
    ) {
        throw new Error('realms_provider_binding_request_invalid');
    }
    return {
        status: 'requires_governance',
        actionType: 'circle.provider_binding.realms.create',
        request: normalizeRequest(data.request),
    };
}

export async function requestRealmsProviderDisable(
    circleId: number,
): Promise<{
    status: 'requires_governance';
    actionType: 'circle.provider_binding.realms.disable';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-bindings/realms/disable-requests`,
        { init: { method: 'POST' } },
    );
    if (
        data?.status !== 'requires_governance'
        || data?.actionType !== 'circle.provider_binding.realms.disable'
        || !data?.request
    ) {
        throw new Error('realms_provider_disable_request_invalid');
    }
    return {
        status: 'requires_governance',
        actionType: 'circle.provider_binding.realms.disable',
        request: normalizeRequest(data.request),
    };
}

export async function requestRealmsProviderDelegationConformance(
    circleId: number,
): Promise<{
    status: 'requires_governance';
    actionType: 'circle.provider_binding.realms.delegation_conformance';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-bindings/realms/delegation-conformance-requests`,
        { init: { method: 'POST' } },
    );
    if (
        data?.status !== 'requires_governance'
        || data?.actionType !== 'circle.provider_binding.realms.delegation_conformance'
        || !data?.request
    ) {
        throw new Error('realms_provider_delegation_request_invalid');
    }
    return {
        status: 'requires_governance',
        actionType: 'circle.provider_binding.realms.delegation_conformance',
        request: normalizeRequest(data.request),
    };
}

export async function requestRealmsVotingPowerChallengeConformance(
    circleId: number,
): Promise<{
    status: 'requires_governance';
    actionType: 'circle.provider_binding.realms.voting_power_challenge_conformance';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-bindings/realms/voting-power-challenge-requests`,
        { init: { method: 'POST' } },
    );
    if (
        data?.status !== 'requires_governance'
        || data?.actionType !== 'circle.provider_binding.realms.voting_power_challenge_conformance'
        || !data?.request
    ) {
        throw new Error('realms_voting_power_challenge_request_invalid');
    }
    return {
        status: 'requires_governance',
        actionType: 'circle.provider_binding.realms.voting_power_challenge_conformance',
        request: normalizeRequest(data.request),
    };
}

export async function requestRealmsProviderRestore(
    circleId: number,
): Promise<{
    status: 'requires_governance';
    actionType: 'circle.provider_binding.realms.restore';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-bindings/realms/restore-requests`,
        { init: { method: 'POST' } },
    );
    if (
        data?.status !== 'requires_governance'
        || data?.actionType !== 'circle.provider_binding.realms.restore'
        || !data?.request
    ) {
        throw new Error('realms_provider_restore_request_invalid');
    }
    return {
        status: 'requires_governance',
        actionType: 'circle.provider_binding.realms.restore',
        request: normalizeRequest(data.request),
    };
}

export async function fetchSquadsProviderTrustReadback(
    circleId: number,
): Promise<SquadsProviderTrustReadback> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-trust/squads/readback`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    const value = data?.readback;
    const identities = value?.runtimeSigner?.identities;
    const progress = value?.reconciliation?.executionProgress;
    const grantSettlement = value?.grantSettlement;
    if (
        Number(data?.circleId) !== circleId
        || value?.status !== 'verified_read_only'
        || value?.chainId !== 'solana:devnet'
        || typeof value?.profileRef !== 'string'
        || value?.profileVersion !== 1
        || !/^[a-f0-9]{64}$/.test(String(value?.profileDigest ?? ''))
        || typeof value?.programId !== 'string'
        || typeof value?.programDataAddress !== 'string'
        || typeof value?.upgradeAuthority !== 'string'
        || !/^[a-f0-9]{64}$/.test(String(value?.deployedProgramBytesSha256 ?? ''))
        || value?.sourceReproducibility !== 'unverified'
        || value?.commitment !== 'finalized'
        || !Number.isSafeInteger(value?.observedSlot)
        || value.observedSlot <= 0
        || !Number.isFinite(Date.parse(String(value?.observedAt ?? '')))
        || value?.activation !== 'not_activated'
        || value?.decoder?.package !== '@sqds/multisig@2.1.4'
        || value?.decoder?.threshold !== 2
        || value?.decoder?.memberCount !== 3
        || value?.decoder?.proposalState !== 'Executed'
        || value?.runtimeSigner?.signerProvider !== 'openbao_transit'
        || value?.runtimeSigner?.chainId !== 'solana:devnet'
        || value?.runtimeSigner?.profileRef !== value.profileRef
        || value?.runtimeSigner?.profileVersion !== 1
        || !['not_configured', 'pending_custody', 'active', 'degraded', 'disabled']
            .includes(value?.runtimeSigner?.bindingStatus)
        || !Array.isArray(identities)
        || identities.length !== 5
        || identities.some((identity: any) => (
            typeof identity?.role !== 'string'
            || typeof identity?.keyRef !== 'string'
            || (identity.publicKey !== null && typeof identity.publicKey !== 'string')
            || typeof identity?.policyName !== 'string'
            || !String(identity?.credentialRef ?? '').startsWith('macos-keychain:')
            || identity?.tokenPeriodSeconds !== 86400
            || !['pending_generation', 'verified'].includes(identity?.status)
        ))
        || (value?.reconciliation?.state === 'verified' && (
            typeof progress?.multisigResourceRef !== 'string'
            || progress?.threshold !== 2
            || progress?.memberCount !== 3
            || progress?.approvedMemberCount !== 2
            || JSON.stringify(progress?.approvedRoles) !== JSON.stringify(['proposer_member', 'approver_member'])
            || progress?.pendingRequiredApprovals !== 0
            || JSON.stringify(progress?.nonApprovingMemberRoles) !== JSON.stringify(['executor_member'])
            || progress?.transactionCount !== 6
            || !Array.isArray(progress?.transactions)
            || progress.transactions.length !== 6
            || progress.transactions.some((transaction: any) => (
                typeof transaction?.stepId !== 'string'
                || typeof transaction?.signature !== 'string'
                || !Number.isSafeInteger(transaction?.slot)
                || transaction.slot <= 0
                || transaction?.finality !== 'finalized'
            ))
            || progress?.proposalState !== 'executed'
            || progress?.vaultTransactionState !== 'executed'
            || progress?.executionResult !== 'executed_finalized'
            || progress?.noRealAssets !== true
        ))
        || (grantSettlement != null && (
            !['active', 'hold'].includes(grantSettlement?.state)
            || typeof grantSettlement?.resourceBindingId !== 'string'
            || typeof grantSettlement?.resourceRef !== 'string'
            || (grantSettlement?.verifiedSlot !== null
                && !/^[1-9][0-9]*$/.test(grantSettlement?.verifiedSlot))
            || (grantSettlement?.stateDigest !== null
                && !/^[a-f0-9]{64}$/.test(grantSettlement?.stateDigest))
            || ![null, 'finalized'].includes(grantSettlement?.providerFinality)
            || (grantSettlement?.payoutSignature !== null
                && typeof grantSettlement?.payoutSignature !== 'string')
            || (grantSettlement?.recipient !== null
                && typeof grantSettlement?.recipient !== 'string')
            || (grantSettlement?.amountLamports !== null
                && !/^[1-9][0-9]*$/.test(grantSettlement?.amountLamports))
            || (grantSettlement?.vaultBalanceAfterLamports !== null
                && !/^[0-9]+$/.test(grantSettlement?.vaultBalanceAfterLamports))
        ))
    ) throw new Error('squads_provider_trust_readback_invalid');
    return {
        ...value,
        observedAt: new Date(value.observedAt).toISOString(),
        runtimeSigner: {
            ...value.runtimeSigner,
            observedAt: value.runtimeSigner.observedAt === null
                ? null
                : new Date(value.runtimeSigner.observedAt).toISOString(),
            identities: identities.map((identity: any) => ({ ...identity })),
        },
        grantSettlement: grantSettlement ?? null,
    } as SquadsProviderTrustReadback;
}

async function requestSquadsProviderAction(
    circleId: number,
    phase: 'create' | 'bootstrap' | 'disable' | 'restore',
    body?: SquadsExistingResourceAdoptionInput,
): Promise<{ status: 'requires_governance'; actionType: string; request: CircleGovernanceRequest }> {
    const route = await resolveNodeRoute('governance');
    const suffix = phase === 'create' ? 'requests' : `${phase}-requests`;
    const expectedActionType = `circle.provider_binding.squads.${phase === 'create' ? 'create' : phase}`;
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/provider-bindings/squads/${suffix}`,
        { init: {
            method: 'POST',
            ...(body ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            } : {}),
        } },
    );
    if (
        data?.status !== 'requires_governance'
        || data?.actionType !== expectedActionType
        || !data?.request
    ) throw new Error(`squads_provider_${phase}_request_invalid`);
    return {
        status: 'requires_governance',
        actionType: expectedActionType,
        request: normalizeRequest(data.request),
    };
}

export const requestSquadsProviderBinding = (circleId: number) =>
    requestSquadsProviderAction(circleId, 'create');

export const requestSquadsProviderAdoption = (
    circleId: number,
    input: SquadsExistingResourceAdoptionInput,
) => requestSquadsProviderAction(circleId, 'create', input);

export const requestSquadsProviderBootstrap = (circleId: number) =>
    requestSquadsProviderAction(circleId, 'bootstrap');

export const requestSquadsProviderDisable = (circleId: number) =>
    requestSquadsProviderAction(circleId, 'disable');

export const requestSquadsProviderRestore = (circleId: number) =>
    requestSquadsProviderAction(circleId, 'restore');

function normalizeCircleGrantSettlementReadiness(
    value: any,
): CircleGovernanceResourceReadiness['grantSettlementReadiness'] {
    const states = ['not_applicable', 'setup_required', 'ready'];
    const integrities = ['verified', 'stale', 'invalid', 'not_evaluated'];
    const validCount = (candidate: unknown) => (
        Number.isSafeInteger(candidate) && Number(candidate) >= 0
    );
    const validDigest = (candidate: unknown) => (
        typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate)
    );
    const validOptionalDigest = (candidate: unknown) => candidate === null || validDigest(candidate);
    const validOptionalText = (candidate: unknown) => (
        candidate === null || (typeof candidate === 'string' && candidate.trim().length > 0)
    );
    const validCodes = (candidate: unknown) => (
        Array.isArray(candidate)
        && candidate.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
    if (
        value?.schemaVersion !== 1
        || value?.evaluatorRef !== 'p06.grant_settlement_readiness'
        || value?.evaluatorVersion !== 1
        || !states.includes(value?.state)
        || !validCount(value?.activeAgreementCount)
        || !validCount(value?.readyAgreementCount)
        || !validCount(value?.setupRequiredAgreementCount)
        || !Array.isArray(value?.evaluations)
        || !validCodes(value?.blockerCodes)
    ) throw new Error('circle_governance_grant_settlement_readiness_invalid');

    const evaluations: CircleGovernanceResourceReadiness['grantSettlementReadiness']['evaluations'] = value.evaluations.map((item: any) => {
        const resource = item?.resource;
        const authority = item?.authority;
        const assetAuthority = item?.assetAuthority;
        const payer = item?.payer;
        const fundingReadback = item?.fundingReadback;
        const payout = item?.payout;
        const activePayoutRequest = item?.activePayoutRequest;
        const integrity = item?.integrity;
        const detailsExpected = integrity === 'verified' || integrity === 'stale';
        const detailsAbsent = [
            resource, authority, assetAuthority, payer, fundingReadback, payout,
        ].every((detail) => detail === null);
        const payoutValid = payout?.intent === 'not_created'
            ? payout.intentRef === null
                && payout.payoutRef === null
                && payout.paid === false
                && payout.providerFinality === null
            : payout?.intent === 'contractual_pending_settlement'
                ? typeof payout.intentRef === 'string'
                    && payout.intentRef.trim().length > 0
                    && payout.payoutRef === null
                    && payout.paid === false
                    && payout.providerFinality === null
                : payout?.intent === 'paid'
                    && typeof payout.intentRef === 'string'
                    && payout.intentRef.trim().length > 0
                    && typeof payout.payoutRef === 'string'
                    && payout.payoutRef.trim().length > 0
                    && payout.paid === true
                    && payout.providerFinality === 'finalized';
        if (
            [
                item?.agreementId,
                item?.caseId,
                item?.projectRef,
                item?.recipientRef,
                item?.budgetUnit,
                item?.contractualUnits,
            ].some((field) => typeof field !== 'string' || !field.trim())
            || !/^[1-9][0-9]*$/.test(item?.contractualUnits)
            || !(item?.trancheIntentId === null
                || (typeof item?.trancheIntentId === 'string' && item.trancheIntentId.trim()))
            || !integrities.includes(integrity)
            || !['setup_required', 'ready'].includes(item?.state)
            || !validCount(item?.evaluationVersion)
            || !validOptionalDigest(item?.evaluationDigest)
            || (item?.evaluatedAt !== null && !Number.isFinite(Date.parse(item?.evaluatedAt)))
            || !validCodes(item?.blockerCodes)
            || !(activePayoutRequest === null || (
                typeof activePayoutRequest?.id === 'string'
                && /^gov_req_[a-f0-9]{56}$/.test(activePayoutRequest.id)
                && ['active', 'accepted'].includes(activePayoutRequest?.state)
                && typeof activePayoutRequest?.openedAt === 'string'
                && Number.isFinite(Date.parse(activePayoutRequest.openedAt))
            ))
            || (detailsExpected && (
                !resource
                || !['not_bound', 'invalid', 'verified'].includes(resource?.state)
                || !validOptionalText(resource?.bindingId)
                || !validOptionalText(resource?.chainId)
                || !validOptionalText(resource?.provider)
                || !(resource?.contractVersion === null
                    || (Number.isSafeInteger(resource?.contractVersion) && resource.contractVersion > 0))
                || !validOptionalText(resource?.profileRef)
                || !(resource?.profileVersion === null
                    || (Number.isSafeInteger(resource?.profileVersion) && resource.profileVersion > 0))
                || !validOptionalText(resource?.resourceRef)
                || !validOptionalDigest(resource?.stateDigest)
                || !(resource?.verifiedSlot === null || /^[1-9][0-9]*$/.test(resource?.verifiedSlot))
                || !authority
                || !['not_bound', 'invalid', 'verified'].includes(authority?.state)
                || authority?.operation !== 'grant_payout'
                || !validCodes(authority?.bindingRefs)
                || !assetAuthority
                || !['not_configured', 'invalid', 'verified'].includes(assetAuthority?.state)
                || !validOptionalText(assetAuthority?.policyRef)
                || !validOptionalDigest(assetAuthority?.policyDigest)
                || !payer
                || !['not_configured', 'invalid', 'verified'].includes(payer?.state)
                || !validOptionalText(payer?.policyRef)
                || !validOptionalDigest(payer?.policyDigest)
                || !validOptionalText(payer?.fundingBlockerCode)
                || !fundingReadback
                || !['missing', 'invalid', 'verified'].includes(fundingReadback?.state)
                || !(fundingReadback?.availableUnits === null
                    || /^[1-9][0-9]*$/.test(fundingReadback?.availableUnits))
                || !(fundingReadback?.slot === null || /^[1-9][0-9]*$/.test(fundingReadback?.slot))
                || !validOptionalDigest(fundingReadback?.stateDigest)
                || !['finalized', null].includes(fundingReadback?.finality)
                || !payoutValid
            ))
            || (!detailsExpected && !detailsAbsent)
            || (item?.state === 'ready' && (
                integrity !== 'verified'
                || item.blockerCodes.length !== 0
                || resource?.state !== 'verified'
                || authority?.state !== 'verified'
                || assetAuthority?.state !== 'verified'
                || payer?.state !== 'verified'
                || fundingReadback?.state !== 'verified'
                || fundingReadback?.finality !== 'finalized'
            ))
        ) throw new Error('circle_governance_grant_settlement_evaluation_invalid');
        return {
            agreementId: item.agreementId.trim(),
            caseId: item.caseId.trim(),
            trancheIntentId: item.trancheIntentId === null ? null : item.trancheIntentId.trim(),
            projectRef: item.projectRef.trim(),
            recipientRef: item.recipientRef.trim(),
            budgetUnit: item.budgetUnit.trim(),
            contractualUnits: item.contractualUnits,
            integrity,
            state: item.state,
            evaluationVersion: Number(item.evaluationVersion),
            evaluationDigest: item.evaluationDigest,
            evaluatedAt: item.evaluatedAt,
            resource,
            authority,
            assetAuthority,
            payer,
            fundingReadback,
            payout,
            activePayoutRequest,
            blockerCodes: item.blockerCodes.map((code: string) => code.trim()),
        } as CircleGovernanceResourceReadiness['grantSettlementReadiness']['evaluations'][number];
    });
    const readyAgreementCount = evaluations.filter((item) => item.state === 'ready').length;
    const setupRequiredAgreementCount = evaluations.length - readyAgreementCount;
    const expectedState = evaluations.length === 0
        ? 'not_applicable'
        : setupRequiredAgreementCount === 0
            ? 'ready'
            : 'setup_required';
    if (
        value.activeAgreementCount !== evaluations.length
        || value.readyAgreementCount !== readyAgreementCount
        || value.setupRequiredAgreementCount !== setupRequiredAgreementCount
        || value.state !== expectedState
    ) throw new Error('circle_governance_grant_settlement_summary_invalid');
    return {
        schemaVersion: 1,
        evaluatorRef: 'p06.grant_settlement_readiness',
        evaluatorVersion: 1,
        state: expectedState,
        activeAgreementCount: evaluations.length,
        readyAgreementCount,
        setupRequiredAgreementCount,
        evaluations,
        blockerCodes: value.blockerCodes.map((code: string) => code.trim()),
    };
}

function normalizeRealmsVotingPowerSecurityProfile(
    value: any,
): RealmsVotingPowerSecurityProfile | null {
    if (value == null) return null;
    const source = value?.source;
    const tokenOwnerRecords = value?.tokenOwnerRecords;
    const voterRecord = Array.isArray(tokenOwnerRecords)
        ? tokenOwnerRecords.find((record: any) => record?.role === 'voter')
        : null;
    const requiredBlockers = [
        'voting_power_snapshot_delay_not_configured',
        'voting_power_deposit_cooldown_not_configured',
        'voting_power_borrowed_capital_risk_unmitigated',
        'voting_power_vsr_vwr_not_configured',
    ];
    const validTokenOwnerRecords = Array.isArray(tokenOwnerRecords)
        && tokenOwnerRecords.length === 2
        && new Set(tokenOwnerRecords.map((record: any) => record?.role)).size === 2
        && tokenOwnerRecords.every((record: any) => (
            ['proposer', 'voter'].includes(record?.role)
            && typeof record?.recordRef === 'string'
            && Boolean(record.recordRef.trim())
            && typeof record?.owner === 'string'
            && Boolean(record.owner.trim())
            && /^\d+$/.test(String(record?.depositAmount ?? ''))
            && record?.governanceDelegate === null
            && Number.isSafeInteger(record?.unrelinquishedVotesCount)
            && record.unrelinquishedVotesCount >= 0
            && Number.isSafeInteger(record?.outstandingProposalCount)
            && record.outstandingProposalCount >= 0
        ))
        && new Set(tokenOwnerRecords.map((record: any) => record.recordRef)).size === 2
        && new Set(tokenOwnerRecords.map((record: any) => record.owner)).size === 2;
    if (
        value?.schemaVersion !== 1
        || value?.readinessState !== 'unavailable'
        || value?.mode !== 'standard_token_weight_no_addins'
        || source?.authority !== 'independent_provider_readback'
        || source?.chainId !== 'solana:devnet'
        || typeof source?.profileRef !== 'string'
        || !source.profileRef.trim()
        || !Number.isSafeInteger(source?.profileVersion)
        || source.profileVersion <= 0
        || typeof source?.programId !== 'string'
        || !source.programId.trim()
        || typeof source?.realm !== 'string'
        || !source.realm.trim()
        || typeof source?.governingTokenMint !== 'string'
        || !source.governingTokenMint.trim()
        || source?.commitment !== 'finalized'
        || !Number.isSafeInteger(source?.snapshotSlot)
        || source.snapshotSlot <= 0
        || !validTokenOwnerRecords
        || typeof value?.voteRecord?.recordRef !== 'string'
        || !value.voteRecord.recordRef.trim()
        || value?.voteRecord?.voter !== voterRecord?.owner
        || !/^\d+$/.test(String(value?.voteRecord?.yesVoteWeight ?? ''))
        || value?.sameResourceRoot?.schemaVersion !== 1
        || typeof value?.sameResourceRoot?.rootRef !== 'string'
        || !value.sameResourceRoot.rootRef.trim()
        || !isSha256Digest(value?.sameResourceRoot?.rootDigest)
        || !Array.isArray(value?.sameResourceRoot?.paths)
        || value.sameResourceRoot.paths.length !== 7
        || value.sameResourceRoot.paths.filter((path: any) => path?.kind === 'token_owner_record').length !== 2
        || value.sameResourceRoot.paths.filter((path: any) => path?.kind === 'realm_config').length !== 1
        || value.sameResourceRoot.paths.filter((path: any) => path?.kind === 'governing_token_mint').length !== 1
        || value.sameResourceRoot.paths.filter((path: any) => path?.kind === 'vote_record').length !== 1
        || value.sameResourceRoot.paths.filter((path: any) => path?.kind === 'voter_weight_addin').length !== 1
        || value.sameResourceRoot.paths.filter((path: any) => path?.kind === 'max_voter_weight_addin').length !== 1
        || value.sameResourceRoot.paths.some((path: any) => (
            !['realm_config', 'governing_token_mint', 'token_owner_record', 'vote_record', 'voter_weight_addin', 'max_voter_weight_addin'].includes(path?.kind)
            || !['observed', 'not_configured'].includes(path?.status)
            || (path?.status === 'observed' && (typeof path?.ref !== 'string' || !path.ref.trim()))
            || (path?.status === 'not_configured' && path?.ref !== null)
        ))
        || value.sameResourceRoot.duplicatePathCount !== 0
        || value.sameResourceRoot.cycleDetected !== false
        || value.sameResourceRoot.recordExpiry !== 'not_applicable_no_vwr'
        || new Set(value.sameResourceRoot.paths
            .filter((path: any) => path?.status === 'observed')
            .map((path: any) => path.ref)).size !== 5
        || value.sameResourceRoot.paths.some((path: any) => (
            path?.status === 'observed' && path.ref === value.sameResourceRoot.rootRef
        ))
        || !Array.isArray(value?.delegationGraph?.edges)
        || value.delegationGraph.edges.length !== 0
        || !isSha256Digest(value?.delegationGraph?.graphDigest)
        || value?.delegationGraph?.duplicateResourceCount !== 0
        || value?.delegationGraph?.cycleDetected !== false
        || value?.delegationGraph?.maxDepthObserved !== 0
        || value?.delegationGraph?.mapping !== 'exact_no_delegate'
        || value?.protections?.depositLock !== 'standard_token_owner_record_vote_lifecycle_only'
        || value?.protections?.snapshotDelay !== 'not_configured'
        || value?.protections?.cooldown !== 'not_configured'
        || value?.protections?.recordExpiry !== 'not_applicable_no_vwr'
        || value?.protections?.borrowedCapitalRisk !== 'unmitigated'
        || value?.protections?.flashGovernanceRisk !== 'unmitigated'
        || value?.plugins?.voterWeightAddin !== 'not_configured'
        || value?.plugins?.maxVoterWeightAddin !== 'not_configured'
        || value?.plugins?.vsr !== 'not_configured'
        || value?.plugins?.customPlugins !== 'unavailable'
        || value?.enforcement?.deposit !== 'spl_governance_token_owner_record'
        || value?.enforcement?.duplicateVote !== 'spl_governance_vote_record'
        || value?.enforcement?.weightedTemplateActivation !== 'blocked'
        || !Array.isArray(value?.blockerCodes)
        || JSON.stringify(value.blockerCodes) !== JSON.stringify(requiredBlockers)
        || !isSha256Digest(value?.profileDigest)
    ) {
        throw new Error('realms_voting_power_security_profile_invalid');
    }
    return {
        schemaVersion: 1,
        readinessState: 'unavailable',
        mode: 'standard_token_weight_no_addins',
        source: {
            authority: 'independent_provider_readback',
            chainId: 'solana:devnet',
            profileRef: source.profileRef.trim(),
            profileVersion: Number(source.profileVersion),
            programId: source.programId.trim(),
            realm: source.realm.trim(),
            governingTokenMint: source.governingTokenMint.trim(),
            commitment: 'finalized',
            snapshotSlot: Number(source.snapshotSlot),
        },
        tokenOwnerRecords: tokenOwnerRecords.map((record: any) => ({
            role: record.role as 'proposer' | 'voter',
            recordRef: record.recordRef.trim(),
            owner: record.owner.trim(),
            depositAmount: String(record.depositAmount),
            governanceDelegate: null,
            unrelinquishedVotesCount: Number(record.unrelinquishedVotesCount),
            outstandingProposalCount: Number(record.outstandingProposalCount),
        })),
        voteRecord: {
            recordRef: value.voteRecord.recordRef.trim(),
            voter: value.voteRecord.voter.trim(),
            yesVoteWeight: String(value.voteRecord.yesVoteWeight),
        },
        sameResourceRoot: {
            schemaVersion: 1,
            rootRef: value.sameResourceRoot.rootRef.trim(),
            rootDigest: value.sameResourceRoot.rootDigest,
            paths: value.sameResourceRoot.paths.map((path: any) => ({
                kind: path.kind,
                ref: path.ref == null ? null : String(path.ref),
                status: path.status,
            })),
            duplicatePathCount: 0,
            cycleDetected: false,
            recordExpiry: 'not_applicable_no_vwr',
        },
        delegationGraph: {
            edges: [],
            graphDigest: value.delegationGraph.graphDigest,
            duplicateResourceCount: 0,
            cycleDetected: false,
            maxDepthObserved: 0,
            mapping: 'exact_no_delegate',
        },
        protections: {
            depositLock: 'standard_token_owner_record_vote_lifecycle_only',
            snapshotDelay: 'not_configured',
            cooldown: 'not_configured',
            recordExpiry: 'not_applicable_no_vwr',
            borrowedCapitalRisk: 'unmitigated',
            flashGovernanceRisk: 'unmitigated',
        },
        plugins: {
            voterWeightAddin: 'not_configured',
            maxVoterWeightAddin: 'not_configured',
            vsr: 'not_configured',
            customPlugins: 'unavailable',
        },
        enforcement: {
            deposit: 'spl_governance_token_owner_record',
            duplicateVote: 'spl_governance_vote_record',
            weightedTemplateActivation: 'blocked',
        },
        blockerCodes: requiredBlockers,
        profileDigest: value.profileDigest,
    };
}

function normalizeCircleGovernanceResourceReadiness(
    value: any,
): CircleGovernanceResourceReadiness {
    const validCount = (count: unknown) => Number.isSafeInteger(count) && Number(count) >= 0;
    const validPolicyState = (state: unknown) => (
        state === 'not_configured' || state === 'present_unverified'
    );
    const realms = value?.realmsProviderTrust;
    const runtimeBinding = value?.realmsRuntimeBinding;
    const providerFinality = runtimeBinding?.providerFinality;
    const reconciliation = runtimeBinding?.reconciliation;
    const providerDisable = runtimeBinding?.providerDisable;
    const emergencyOnchainPause = runtimeBinding?.emergencyOnchainPause;
    const programUpgrade = runtimeBinding?.programUpgrade;
    const delegationConformance = runtimeBinding?.delegationConformance;
    const votingPowerChallenge = runtimeBinding?.votingPowerChallenge;
    const votingPowerSecurity = normalizeRealmsVotingPowerSecurityProfile(
        runtimeBinding?.votingPowerSecurity,
    );
    const grantSettlementReadiness = normalizeCircleGrantSettlementReadiness(
        value?.grantSettlementReadiness,
    );
    const keyContracts = realms?.keyCustodyRecord?.keyContracts;
    const pendingKeyContracts = Array.isArray(keyContracts)
        && keyContracts.every((contract: any) => (
            contract?.publicKey === null && contract?.status === 'pending_generation'
        ));
    const verifiedKeyContracts = Array.isArray(keyContracts)
        && keyContracts.every((contract: any) => (
            typeof contract?.publicKey === 'string'
            && Boolean(contract.publicKey.trim())
            && contract?.status === 'verified'
        ));
    if (
        value?.schemaVersion !== 1
        || value?.network !== 'solana:localnet'
        || !['setup_required', 'ready'].includes(value?.state)
        || value?.ordinaryCapabilities?.circleCreation !== 'resource_not_required'
        || value?.ordinaryCapabilities?.nativeGovernance !== 'resource_not_required'
        || !['active', 'not_configured'].includes(value?.governanceHomeIdentity)
        || !['not_configured', 'pending_custody', 'active', 'degraded', 'disabled'].includes(value?.governedResourceBinding?.state)
        || !['unavailable', 'governed_resource_binding'].includes(value?.governedResourceBinding?.currentOwner)
        || !['not_configured', 'pending_custody', 'active', 'degraded', 'disabled'].includes(runtimeBinding?.state)
        || (runtimeBinding?.resourceBindingId !== null && typeof runtimeBinding?.resourceBindingId !== 'string')
        || typeof runtimeBinding?.profileRef !== 'string'
        || !runtimeBinding.profileRef.trim()
        || !Number.isSafeInteger(runtimeBinding?.profileVersion)
        || runtimeBinding.profileVersion <= 0
        || !Array.isArray(runtimeBinding?.authorityBindings)
        || runtimeBinding.authorityBindings.some((binding: any) => (
            typeof binding?.role !== 'string'
            || !binding.role.trim()
            || typeof binding?.keyRef !== 'string'
            || !binding.keyRef.trim()
            || (binding.publicKey !== null && typeof binding.publicKey !== 'string')
            || typeof binding?.custodyStatus !== 'string'
            || !binding.custodyStatus.trim()
            || typeof binding?.status !== 'string'
            || !binding.status.trim()
        ))
        || (runtimeBinding?.payerPolicy !== null && (
            typeof runtimeBinding?.payerPolicy?.id !== 'string'
            || !runtimeBinding.payerPolicy.id.trim()
            || typeof runtimeBinding?.payerPolicy?.state !== 'string'
            || (runtimeBinding?.payerPolicy?.feePayerSignerRef !== null
                && typeof runtimeBinding?.payerPolicy?.feePayerSignerRef !== 'string')
            || (runtimeBinding?.payerPolicy?.fundingBlockerCode !== null
                && typeof runtimeBinding?.payerPolicy?.fundingBlockerCode !== 'string')
        ))
        || (runtimeBinding?.applicationIdentity !== null && (
            runtimeBinding?.applicationIdentity?.authMethod !== 'openbao_periodic_token'
            || runtimeBinding?.applicationIdentity?.credentialRef
                !== 'macos-keychain:Alcheme Governance OS OpenBao Devnet/realms-runtime-application-token'
            || runtimeBinding?.applicationIdentity?.policyName !== 'alcheme-realms-devnet-runtime-current'
            || runtimeBinding?.applicationIdentity?.tokenPeriodSeconds !== 86400
            || !Number.isFinite(Date.parse(runtimeBinding?.applicationIdentity?.lastVerifiedAt))
            || runtimeBinding?.applicationIdentity?.status !== 'verified'
        ))
        || (providerFinality !== null && (
            providerFinality?.state !== 'finalized'
            || !Array.isArray(providerFinality?.transactions)
            || providerFinality.transactions.length === 0
            || providerFinality.transactions.some((transaction: any) => (
                typeof transaction?.stepId !== 'string'
                || !transaction.stepId.trim()
                || typeof transaction?.signature !== 'string'
                || transaction.signature.length < 64
                || !Number.isSafeInteger(transaction?.slot)
                || transaction.slot <= 0
                || !validProviderFinalityTransitions(
                    transaction?.finalityTransitions,
                    transaction?.slot,
                )
            ))
        ))
        || (reconciliation !== null && (
            reconciliation?.schemaVersion !== 1
            || !['verified', 'hold'].includes(reconciliation?.state)
            || reconciliation?.authority !== 'independent_provider_readback'
            || reconciliation?.resourceBindingId !== runtimeBinding?.resourceBindingId
            || typeof reconciliation?.receiptId !== 'string'
            || !reconciliation.receiptId.trim()
            || typeof reconciliation?.receiptEvidenceDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(reconciliation.receiptEvidenceDigest)
            || typeof reconciliation?.expectedStateDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(reconciliation.expectedStateDigest)
            || !Number.isFinite(Date.parse(reconciliation?.observedAt))
            || (reconciliation?.state === 'verified' && (
                reconciliation?.blocker !== null
                || typeof reconciliation?.observedStateDigest !== 'string'
                || !/^[a-f0-9]{64}$/.test(reconciliation.observedStateDigest)
                || !Number.isSafeInteger(reconciliation?.observedSlot)
                || reconciliation.observedSlot <= 0
            ))
            || (reconciliation?.state === 'hold' && (
                !['provider_readback_outage', 'provider_readback_conflict'].includes(reconciliation?.blocker)
                || reconciliation?.observedStateDigest !== null
                || reconciliation?.observedSlot !== null
            ))
        ))
        || (
            runtimeBinding?.state === 'active'
            && reconciliation?.state === 'verified'
            && votingPowerSecurity !== null
            && (
                votingPowerSecurity.source.chainId !== 'solana:devnet'
                || votingPowerSecurity.source.profileRef !== runtimeBinding.profileRef
                || votingPowerSecurity.source.profileVersion !== runtimeBinding.profileVersion
                || votingPowerSecurity.source.programId !== realms?.programId
                || votingPowerSecurity.source.snapshotSlot !== reconciliation.observedSlot
            )
        )
        || (
            !(runtimeBinding?.state === 'active' && reconciliation?.state === 'verified')
            && votingPowerSecurity !== null
        )
        || (providerDisable !== null && (
            providerDisable?.schemaVersion !== 1
            || providerDisable?.state !== 'disabled'
            || typeof providerDisable?.requestId !== 'string'
            || !providerDisable.requestId.trim()
            || typeof providerDisable?.decisionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(providerDisable.decisionDigest)
            || !Number.isFinite(Date.parse(providerDisable?.disabledAt))
            || providerDisable?.reason !== 'governed_provider_disable'
            || typeof providerDisable?.inFlightDispositionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(providerDisable.inFlightDispositionDigest)
            || providerDisable?.rollbackPolicy?.preSubmit !== 'new_governed_restore_requires_independent_readback'
            || providerDisable?.rollbackPolicy?.postSubmit !== 'forward_recovery_or_independent_reconciliation_only'
            || providerDisable?.rollbackPolicy?.chainFacts !== 'never_rewritten'
            || providerDisable?.rollbackPolicy?.fallback !== 'prohibited'
            || providerDisable?.pauseBoundary?.authority !== 'resource_pause_separate_from_workflow_freeze'
            || providerDisable?.pauseBoundary?.workflowFreezeClaimsChainPaused !== false
            || providerDisable?.pauseBoundary?.effect !== 'provider_dispatch_disabled_no_chain_pause_claim'
            || providerDisable?.pauseBoundary?.providerTransaction !== 'not_submitted'
            || providerDisable?.pauseBoundary?.providerStateReadback !== 'canonical_resource_binding_disabled'
            || providerDisable?.pauseBoundary?.onchainPauseInstruction !== 'not_claimed'
            || providerDisable?.pauseBoundary?.restoreAuthority !== 'new_governed_restore_requires_independent_readback'
            || providerDisable?.pauseBoundary?.rollback !== 'forward_recovery_only_chain_facts_never_rewritten'
            || providerDisable?.pauseBoundary?.fallbackAuthority !== 'none'
        ))
        || (emergencyOnchainPause !== null && (
            emergencyOnchainPause?.schemaVersion !== 1
            || ![
                'paused',
                'unpause_due',
                'unpause_blocked',
                'rollback_failed',
                'resumed_via_explicit_unpause',
                'resumed_via_onchain_timebound',
            ].includes(String(emergencyOnchainPause?.state))
            || ['expired', 'resumed'].includes(String(emergencyOnchainPause?.state))
            || typeof emergencyOnchainPause?.requestId !== 'string'
            || !emergencyOnchainPause.requestId.trim()
            || typeof emergencyOnchainPause?.decisionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(emergencyOnchainPause.decisionDigest)
            || !Number.isFinite(Date.parse(emergencyOnchainPause?.activatedAt))
            || !Number.isSafeInteger(emergencyOnchainPause?.maxDurationSeconds)
            || Number(emergencyOnchainPause?.maxDurationSeconds) <= 0
            || !Number.isFinite(Date.parse(emergencyOnchainPause?.pauseEndsAt))
            || !['onchain_timebound', 'explicit_unpause_required'].includes(String(emergencyOnchainPause?.pauseEnforcement))
            || typeof emergencyOnchainPause?.trigger !== 'string'
            || !emergencyOnchainPause.trigger.trim()
            || typeof emergencyOnchainPause?.scope !== 'string'
            || !emergencyOnchainPause.scope.trim()
            || typeof emergencyOnchainPause?.pauseAuthorityRef !== 'string'
            || !emergencyOnchainPause.pauseAuthorityRef.trim()
            || typeof emergencyOnchainPause?.unpauseAuthorityRef !== 'string'
            || !emergencyOnchainPause.unpauseAuthorityRef.trim()
            || typeof emergencyOnchainPause?.memberNotificationDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(emergencyOnchainPause.memberNotificationDigest)
            || typeof emergencyOnchainPause?.ratificationRequestId !== 'string'
            || !emergencyOnchainPause.ratificationRequestId.trim()
            || typeof emergencyOnchainPause?.ratificationDecisionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(emergencyOnchainPause.ratificationDecisionDigest)
            || typeof emergencyOnchainPause?.recoveryConditionsDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(emergencyOnchainPause.recoveryConditionsDigest)
            || emergencyOnchainPause?.onchainPauseInstruction !== 'hosted_app_trust_root.pause_app_trust_root'
            || typeof emergencyOnchainPause?.residualRisk?.permanentPausePossible !== 'boolean'
            || emergencyOnchainPause?.residualRisk?.fallbackAuthority !== 'none'
            || emergencyOnchainPause?.residualRisk?.workflowFreezeClaimsChainPaused !== false
            || emergencyOnchainPause?.residualRisk?.expiredAliasForbidden !== true
            || emergencyOnchainPause?.residualRisk?.resumedAliasForbidden !== true
        ))
        || (programUpgrade !== null && (
            programUpgrade?.schemaVersion !== 1
            || !['verified', 'finalized', 'compromised', 'verification_blocked'].includes(String(programUpgrade?.state))
            || typeof programUpgrade?.requestId !== 'string'
            || !programUpgrade.requestId.trim()
            || typeof programUpgrade?.decisionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(programUpgrade.decisionDigest)
            || typeof programUpgrade?.upgradePayloadDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(programUpgrade.upgradePayloadDigest)
            || typeof programUpgrade?.codeRelease?.repository !== 'string'
            || !programUpgrade.codeRelease.repository.trim()
            || typeof programUpgrade?.codeRelease?.commit !== 'string'
            || !programUpgrade.codeRelease.commit.trim()
            || typeof programUpgrade?.codeRelease?.buildArtifactSha256 !== 'string'
            || !/^[a-f0-9]{64}$/.test(programUpgrade.codeRelease.buildArtifactSha256)
            || !['passed', 'waived_with_digest'].includes(String(programUpgrade?.codeRelease?.auditStatus))
            || typeof programUpgrade?.disposition?.upgradeAuthorityDisposition !== 'string'
            || !programUpgrade.disposition.upgradeAuthorityDisposition.trim()
            || programUpgrade?.disposition?.tempBufferAuthorityRetireExpected !== true
            || programUpgrade?.residualRisk?.executedShown !== false
            || programUpgrade?.residualRisk?.mismatchOpensIncident !== true
            || programUpgrade?.residualRisk?.fallbackAuthority !== 'none'
        ))
        || (delegationConformance !== null && (
            delegationConformance?.schemaVersion !== 1
            || !['authorized', 'revoke_pending', 'completed'].includes(delegationConformance?.state)
            || typeof delegationConformance?.requestId !== 'string'
            || !delegationConformance.requestId.trim()
            || typeof delegationConformance?.decisionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(delegationConformance.decisionDigest)
            || typeof delegationConformance?.delegate !== 'string'
            || !delegationConformance.delegate.trim()
            || delegationConformance?.finalDelegate !== null
            || delegationConformance?.providerMapping !== 'weaker_provider_delegate_broader_than_vote_only_template_blocked'
            || !['pending', 'unchanged'].includes(delegationConformance?.historicalVoteInvariant)
            || (delegationConformance?.blocker !== null && typeof delegationConformance?.blocker !== 'string')
            || (delegationConformance?.state === 'completed' && (
                !Number.isSafeInteger(delegationConformance?.setObservedSlot)
                || delegationConformance.setObservedSlot <= 0
                || !Number.isSafeInteger(delegationConformance?.revokeObservedSlot)
                || delegationConformance.revokeObservedSlot <= 0
                || delegationConformance.historicalVoteInvariant !== 'unchanged'
                || delegationConformance.blocker !== null
            ))
        ))
        || (votingPowerChallenge !== null && (
            votingPowerChallenge?.schemaVersion !== 1
            || !['suspended', 'reopened'].includes(votingPowerChallenge?.state)
            || typeof votingPowerChallenge?.requestId !== 'string'
            || !votingPowerChallenge.requestId.trim()
            || typeof votingPowerChallenge?.decisionDigest !== 'string'
            || !/^[a-f0-9]{64}$/.test(votingPowerChallenge.decisionDigest)
            || !Number.isFinite(Date.parse(votingPowerChallenge?.suspendedAt))
            || !Number.isSafeInteger(votingPowerChallenge?.preObservedSlot)
            || votingPowerChallenge.preObservedSlot <= 0
            || (votingPowerChallenge.state === 'reopened' && (
                !Number.isFinite(Date.parse(votingPowerChallenge?.reopenedAt))
                || !Number.isSafeInteger(votingPowerChallenge?.postObservedSlot)
                || votingPowerChallenge.postObservedSlot <= 0
                || votingPowerChallenge.historicalTallyInvariant !== 'unchanged'
                || votingPowerChallenge.blocker !== null
            ))
            || (votingPowerChallenge.state === 'suspended' && (
                votingPowerChallenge.reopenedAt !== null
                || votingPowerChallenge.postObservedSlot !== null
                || !(
                    (votingPowerChallenge.historicalTallyInvariant === 'pending'
                        && votingPowerChallenge.blocker === 'challenge_resolution_pending')
                    || (votingPowerChallenge.historicalTallyInvariant === 'conflict'
                        && votingPowerChallenge.blocker === 'challenge_superseding_snapshot_required')
                )
            ))
        ))
        || !validPolicyState(value?.payerPolicy?.state)
        || !validCount(value?.payerPolicy?.activeCount)
        || !validPolicyState(value?.assetAuthorityPolicy?.state)
        || !validCount(value?.assetAuthorityPolicy?.activeCount)
        || !['blocked_setup_required', 'provider_bound'].includes(value?.externalResourceActions)
        || !['unavailable', 'available'].includes(value?.providerExecution)
        || !['not_authorized', 'authorized'].includes(value?.authorityVerification)
        || typeof realms?.profileRef !== 'string'
        || !realms.profileRef.trim()
        || !Number.isSafeInteger(realms?.profileVersion)
        || realms.profileVersion <= 0
        || typeof realms?.profileDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(realms.profileDigest)
        || realms?.chainId !== 'solana:devnet'
        || typeof realms?.programId !== 'string'
        || !realms.programId.trim()
        || realms?.deploymentVerification !== 'snapshot_verified_read_only'
        || !Number.isSafeInteger(realms?.observedAtSlot)
        || realms.observedAtSlot <= 0
        || realms?.activationReadback !== 'required'
        || realms?.decoderConformance !== 'selected_accounts_verified'
        || !['not_activated', 'active'].includes(realms?.activation)
        || ![
            'verified_pre_wallet_pending_runtime_owner',
            'verified_pre_wallet_no_keys',
            'verified_wallet_keys_pending_provider',
            'verified_wallet_keys_provider_active',
        ].includes(realms?.walletCustody)
        || typeof realms?.keyCustodyRecord?.recordRef !== 'string'
        || !realms.keyCustodyRecord.recordRef.trim()
        || realms?.keyCustodyRecord?.decisionRef !== 'DEC-P06-M3-SOLO-DEVNET-CUSTODY-v1'
        || realms?.keyCustodyRecord?.signerProvider !== 'openbao_transit'
        || realms?.keyCustodyRecord?.serviceTopology !== 'local_single_node_integrated_raft'
        || realms?.keyCustodyRecord?.endpoint !== 'https://127.0.0.1:18200'
        || realms?.keyCustodyRecord?.networkExposure !== 'localhost_only'
        || realms?.keyCustodyRecord?.transitMount !== 'transit'
        || !Array.isArray(realms?.keyCustodyRecord?.keyContracts)
        || realms.keyCustodyRecord.keyContracts.length !== 5
        || realms.keyCustodyRecord.keyContracts.some((contract: any) => (
            typeof contract?.keyRef !== 'string'
            || !contract.keyRef.trim()
            || !['bootstrap_authority', 'proposer', 'voter', 'executor', 'fee_payer'].includes(contract?.role)
            || !Array.isArray(contract?.allowedOperations)
            || contract.allowedOperations.length < 1
            || contract.allowedOperations.some((operation: unknown) => typeof operation !== 'string' || !operation.trim())
            || (contract.publicKey !== null && (
                typeof contract.publicKey !== 'string' || !contract.publicKey.trim()
            ))
            || !['pending_generation', 'verified'].includes(contract.status)
        ))
        || realms?.keyCustodyRecord?.keyAlgorithm !== 'ed25519'
        || realms?.keyCustodyRecord?.exportable !== false
        || realms?.keyCustodyRecord?.allowPlaintextBackup !== false
        || realms?.keyCustodyRecord?.applicationAccess !== 'exact_key_sign_and_read_only'
        || realms?.keyCustodyRecord?.recoveryMaterial?.provider !== 'keepassxc'
        || realms?.keyCustodyRecord?.recoveryMaterial?.purpose !== 'openbao_unseal_and_recovery_material_only'
        || realms?.keyCustodyRecord?.recoveryMaterial?.databaseName !== 'Alcheme Devnet Governance.kdbx'
        || realms?.keyCustodyRecord?.recoveryMaterial?.encryptedBackup !== 'required_independent_location'
        || realms?.keyCustodyRecord?.verification?.raftPersistence !== 'verified'
        || realms?.keyCustodyRecord?.verification?.restartSealUnseal !== 'verified'
        || realms?.keyCustodyRecord?.verification?.tlsLocalhost !== 'verified'
        || realms?.keyCustodyRecord?.verification?.auditReadback !== 'verified'
        || realms?.keyCustodyRecord?.verification?.backupRestore !== 'verified'
        || realms?.keyCustodyRecord?.verification?.leastPrivilegeDenial !== 'verified'
        || realms?.keyCustodyRecord?.verification?.solanaCanonicalMessageConformance !== 'verified'
        || !['pending', 'verified'].includes(
            realms?.keyCustodyRecord?.verification?.runtimeOwnerReadback,
        )
        || realms?.keyCustodyRecord?.verification?.receipt?.openBaoVersion !== '2.6.0'
        || realms?.keyCustodyRecord?.verification?.receipt?.raftNodeId !== 'alcheme-realms-devnet-1'
        || typeof realms?.keyCustodyRecord?.verification?.receipt?.clusterId !== 'string'
        || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
            realms.keyCustodyRecord.verification.receipt.clusterId,
        )
        || typeof realms?.keyCustodyRecord?.verification?.receipt?.snapshotSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(
            realms.keyCustodyRecord.verification.receipt.snapshotSha256,
        )
        || !Number.isSafeInteger(
            realms?.keyCustodyRecord?.verification?.receipt?.snapshotBytes,
        )
        || realms.keyCustodyRecord.verification.receipt.snapshotBytes <= 0
        || realms?.keyCustodyRecord?.verification?.receipt?.snapshotPrimaryRef
            !== 'openbao_devnet_external_snapshot_primary'
        || realms?.keyCustodyRecord?.verification?.receipt?.snapshotIndependentBackupRef
            !== 'alcheme_devnet_governance_encrypted_snapshot_copy'
        || !Number.isFinite(Date.parse(
            realms?.keyCustodyRecord?.verification?.receipt?.originalUnsealVerifiedAt,
        ))
        || !Number.isFinite(Date.parse(
            realms?.keyCustodyRecord?.verification?.receipt?.isolatedRestoreVerifiedAt,
        ))
        || realms?.keyCustodyRecord?.primaryMaintainer !== 'Taiyi'
        || realms?.keyCustodyRecord?.recoveryOwner !== 'Taiyi'
        || realms?.keyCustodyRecord?.samePersonRecoveryException !== true
        || realms?.keyCustodyRecord?.inventoryOwner !== 'payer_policy_and_resource_authority_binding'
        || realms?.keyCustodyRecord?.fundingSource !== 'solana_devnet_faucet_only'
        || realms?.keyCustodyRecord?.feePayerAuthoritySeparation !== 'required'
        || realms?.keyCustodyRecord?.lossProcedure !== 'fail_closed_rebootstrap_devnet_environment_no_owner_operator_fallback'
        || realms?.keyCustodyRecord?.environmentRetention !== 'repeatable_bootstrap_with_explicit_retirement_evidence'
        || ![
            'verified_pre_wallet_pending_runtime_owner',
            'verified_pre_wallet_no_keys',
            'verified_wallet_keys_pending_provider',
            'verified_wallet_keys_provider_active',
        ].includes(realms?.keyCustodyRecord?.status)
        || typeof realms?.keyCustodyRecord?.lastVerifiedAt !== 'string'
        || !Number.isFinite(Date.parse(realms.keyCustodyRecord.lastVerifiedAt))
        || (
            realms.keyCustodyRecord.verification.runtimeOwnerReadback === 'pending'
            && (
                realms.walletCustody !== 'verified_pre_wallet_pending_runtime_owner'
                || realms.keyCustodyRecord.status !== 'verified_pre_wallet_pending_runtime_owner'
                || !pendingKeyContracts
            )
        )
        || (
            realms.keyCustodyRecord.verification.runtimeOwnerReadback === 'verified'
            && !(
                (
                    realms.walletCustody === 'verified_pre_wallet_no_keys'
                    && realms.keyCustodyRecord.status === 'verified_pre_wallet_no_keys'
                    && pendingKeyContracts
                )
                || (
                    realms.walletCustody === 'verified_wallet_keys_pending_provider'
                    && realms.keyCustodyRecord.status === 'verified_wallet_keys_pending_provider'
                    && verifiedKeyContracts
                    && runtimeBinding.applicationIdentity !== null
                )
                || (
                    realms.walletCustody === 'verified_wallet_keys_provider_active'
                    && realms.keyCustodyRecord.status === 'verified_wallet_keys_provider_active'
                    && realms.activation === 'active'
                    && runtimeBinding.state === 'active'
                    && verifiedKeyContracts
                    && runtimeBinding.applicationIdentity !== null
                )
            )
        )
        || (
            ![
                'verified_wallet_keys_pending_provider',
                'verified_wallet_keys_provider_active',
            ].includes(realms.walletCustody)
            && runtimeBinding.applicationIdentity !== null
        )
        || realms?.devnetExecutionScope !== 'approved'
        || realms?.authorizationDecisionRef !== 'DEC-P06-M3-REALMS-DEVNET-ONLY-v1'
        || realms?.mainnet !== 'unavailable'
        || !Array.isArray(realms?.blockerCodes)
        || realms.blockerCodes.some((code: unknown) => typeof code !== 'string' || !code.trim())
        || !Array.isArray(value?.blockerCodes)
        || value.blockerCodes.some((code: unknown) => typeof code !== 'string' || !code.trim())
    ) {
        throw new Error('circle_governance_resource_readiness_invalid');
    }
    return {
        schemaVersion: 1,
        network: 'solana:localnet',
        state: value.state,
        ordinaryCapabilities: {
            circleCreation: 'resource_not_required',
            nativeGovernance: 'resource_not_required',
        },
        governanceHomeIdentity: value.governanceHomeIdentity,
        governedResourceBinding: {
            state: value.governedResourceBinding.state,
            currentOwner: value.governedResourceBinding.currentOwner,
        },
        realmsRuntimeBinding: {
            state: runtimeBinding.state,
            resourceBindingId: runtimeBinding.resourceBindingId,
            profileRef: runtimeBinding.profileRef.trim(),
            profileVersion: Number(runtimeBinding.profileVersion),
            authorityBindings: runtimeBinding.authorityBindings.map((binding: any) => ({
                role: binding.role.trim(),
                keyRef: binding.keyRef.trim(),
                publicKey: binding.publicKey == null ? null : binding.publicKey.trim(),
                custodyStatus: binding.custodyStatus.trim(),
                status: binding.status.trim(),
            })),
            payerPolicy: runtimeBinding.payerPolicy
                ? {
                    id: runtimeBinding.payerPolicy.id.trim(),
                    state: runtimeBinding.payerPolicy.state.trim(),
                    feePayerSignerRef: runtimeBinding.payerPolicy.feePayerSignerRef == null
                        ? null
                        : runtimeBinding.payerPolicy.feePayerSignerRef.trim(),
                    fundingBlockerCode: runtimeBinding.payerPolicy.fundingBlockerCode == null
                        ? null
                        : runtimeBinding.payerPolicy.fundingBlockerCode.trim(),
                }
                : null,
            applicationIdentity: runtimeBinding.applicationIdentity
                ? {
                    authMethod: 'openbao_periodic_token',
                    credentialRef: runtimeBinding.applicationIdentity.credentialRef,
                    policyName: 'alcheme-realms-devnet-runtime-current',
                    tokenPeriodSeconds: 86400,
                    lastVerifiedAt: runtimeBinding.applicationIdentity.lastVerifiedAt,
                    status: 'verified',
                }
                : null,
            providerFinality: providerFinality
                ? {
                    state: 'finalized',
                    transactions: providerFinality.transactions.map((transaction: any) => ({
                        stepId: transaction.stepId.trim(),
                        signature: transaction.signature,
                        slot: Number(transaction.slot),
                        finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
                            state: transition.state,
                            authority: transition.authority,
                            ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
                        })),
                    })),
                }
                : null,
            reconciliation: reconciliation
                ? {
                    schemaVersion: 1,
                    state: reconciliation.state,
                    blocker: reconciliation.blocker,
                    authority: 'independent_provider_readback',
                    resourceBindingId: reconciliation.resourceBindingId,
                    receiptId: reconciliation.receiptId.trim(),
                    receiptEvidenceDigest: reconciliation.receiptEvidenceDigest,
                    expectedStateDigest: reconciliation.expectedStateDigest,
                    observedStateDigest: reconciliation.observedStateDigest,
                    observedSlot: reconciliation.observedSlot,
                    observedAt: reconciliation.observedAt,
                }
                : null,
            votingPowerSecurity,
            delegationConformance: delegationConformance
                ? {
                    schemaVersion: 1,
                    state: delegationConformance.state,
                    requestId: delegationConformance.requestId.trim(),
                    decisionDigest: delegationConformance.decisionDigest,
                    delegate: delegationConformance.delegate.trim(),
                    finalDelegate: null,
                    setObservedSlot: delegationConformance.setObservedSlot,
                    revokeObservedSlot: delegationConformance.revokeObservedSlot,
                    historicalVoteInvariant: delegationConformance.historicalVoteInvariant,
                    providerMapping: 'weaker_provider_delegate_broader_than_vote_only_template_blocked',
                    blocker: delegationConformance.blocker,
                }
                : null,
            votingPowerChallenge: votingPowerChallenge
                ? {
                    schemaVersion: 1,
                    state: votingPowerChallenge.state,
                    requestId: votingPowerChallenge.requestId.trim(),
                    decisionDigest: votingPowerChallenge.decisionDigest,
                    suspendedAt: votingPowerChallenge.suspendedAt,
                    reopenedAt: votingPowerChallenge.reopenedAt,
                    preObservedSlot: votingPowerChallenge.preObservedSlot,
                    postObservedSlot: votingPowerChallenge.postObservedSlot,
                    historicalTallyInvariant: votingPowerChallenge.historicalTallyInvariant,
                    blocker: votingPowerChallenge.blocker,
                }
                : null,
            providerDisable: providerDisable
                ? {
                    schemaVersion: 1,
                    state: 'disabled',
                    requestId: providerDisable.requestId.trim(),
                    decisionDigest: providerDisable.decisionDigest,
                    disabledAt: providerDisable.disabledAt,
                    reason: 'governed_provider_disable',
                    inFlightDispositionDigest: providerDisable.inFlightDispositionDigest,
                    rollbackPolicy: {
                        preSubmit: 'new_governed_restore_requires_independent_readback',
                        postSubmit: 'forward_recovery_or_independent_reconciliation_only',
                        chainFacts: 'never_rewritten',
                        fallback: 'prohibited',
                    },
                    pauseBoundary: {
                        authority: 'resource_pause_separate_from_workflow_freeze',
                        workflowFreezeClaimsChainPaused: false,
                        effect: 'provider_dispatch_disabled_no_chain_pause_claim',
                        providerTransaction: 'not_submitted',
                        providerStateReadback: 'canonical_resource_binding_disabled',
                        onchainPauseInstruction: 'not_claimed',
                        restoreAuthority: 'new_governed_restore_requires_independent_readback',
                        rollback: 'forward_recovery_only_chain_facts_never_rewritten',
                        fallbackAuthority: 'none',
                    },
                }
                : null,
            emergencyOnchainPause: emergencyOnchainPause
                ? {
                    schemaVersion: 1,
                    state: emergencyOnchainPause.state,
                    requestId: emergencyOnchainPause.requestId.trim(),
                    decisionDigest: emergencyOnchainPause.decisionDigest,
                    activatedAt: emergencyOnchainPause.activatedAt,
                    maxDurationSeconds: Number(emergencyOnchainPause.maxDurationSeconds),
                    pauseEndsAt: emergencyOnchainPause.pauseEndsAt,
                    pauseEnforcement: emergencyOnchainPause.pauseEnforcement,
                    trigger: emergencyOnchainPause.trigger.trim(),
                    scope: emergencyOnchainPause.scope.trim(),
                    pauseAuthorityRef: emergencyOnchainPause.pauseAuthorityRef.trim(),
                    unpauseAuthorityRef: emergencyOnchainPause.unpauseAuthorityRef.trim(),
                    memberNotificationDigest: emergencyOnchainPause.memberNotificationDigest,
                    ratificationRequestId: emergencyOnchainPause.ratificationRequestId.trim(),
                    ratificationDecisionDigest: emergencyOnchainPause.ratificationDecisionDigest,
                    recoveryConditionsDigest: emergencyOnchainPause.recoveryConditionsDigest,
                    onchainPauseInstruction: 'hosted_app_trust_root.pause_app_trust_root',
                    residualRisk: {
                        permanentPausePossible: Boolean(emergencyOnchainPause.residualRisk.permanentPausePossible),
                        fallbackAuthority: 'none',
                        workflowFreezeClaimsChainPaused: false,
                        expiredAliasForbidden: true,
                        resumedAliasForbidden: true,
                    },
                }
                : null,
            programUpgrade: programUpgrade
                ? {
                    schemaVersion: 1,
                    state: programUpgrade.state,
                    requestId: programUpgrade.requestId.trim(),
                    decisionDigest: programUpgrade.decisionDigest,
                    upgradePayloadDigest: programUpgrade.upgradePayloadDigest,
                    codeRelease: {
                        repository: programUpgrade.codeRelease.repository.trim(),
                        commit: programUpgrade.codeRelease.commit.trim(),
                        buildArtifactSha256: programUpgrade.codeRelease.buildArtifactSha256,
                        auditStatus: programUpgrade.codeRelease.auditStatus,
                    },
                    disposition: {
                        upgradeAuthorityDisposition: programUpgrade.disposition.upgradeAuthorityDisposition.trim(),
                        tempBufferAuthorityRetireExpected: true,
                    },
                    residualRisk: {
                        executedShown: false,
                        mismatchOpensIncident: true,
                        fallbackAuthority: 'none',
                    },
                }
                : null,
        },
        grantSettlementReadiness,
        payerPolicy: {
            state: value.payerPolicy.state,
            activeCount: Number(value.payerPolicy.activeCount),
        },
        assetAuthorityPolicy: {
            state: value.assetAuthorityPolicy.state,
            activeCount: Number(value.assetAuthorityPolicy.activeCount),
        },
        externalResourceActions: value.externalResourceActions,
        providerExecution: value.providerExecution,
        authorityVerification: value.authorityVerification,
        realmsProviderTrust: {
            profileRef: realms.profileRef.trim(),
            profileVersion: Number(realms.profileVersion),
            profileDigest: realms.profileDigest,
            chainId: 'solana:devnet',
            programId: realms.programId.trim(),
            deploymentVerification: 'snapshot_verified_read_only',
            observedAtSlot: Number(realms.observedAtSlot),
            activationReadback: 'required',
            decoderConformance: 'selected_accounts_verified',
            activation: realms.activation,
            walletCustody: realms.walletCustody,
            keyCustodyRecord: {
                recordRef: realms.keyCustodyRecord.recordRef.trim(),
                decisionRef: 'DEC-P06-M3-SOLO-DEVNET-CUSTODY-v1',
                signerProvider: 'openbao_transit',
                serviceTopology: 'local_single_node_integrated_raft',
                endpoint: 'https://127.0.0.1:18200',
                networkExposure: 'localhost_only',
                transitMount: 'transit',
                keyContracts: realms.keyCustodyRecord.keyContracts.map((contract: any) => ({
                    keyRef: contract.keyRef.trim(),
                    role: contract.role,
                    allowedOperations: contract.allowedOperations.map((operation: string) => operation.trim()),
                    publicKey: contract.publicKey == null ? null : contract.publicKey.trim(),
                    status: contract.status,
                })),
                keyAlgorithm: 'ed25519',
                exportable: false,
                allowPlaintextBackup: false,
                applicationAccess: 'exact_key_sign_and_read_only',
                recoveryMaterial: {
                    provider: 'keepassxc',
                    purpose: 'openbao_unseal_and_recovery_material_only',
                    databaseName: 'Alcheme Devnet Governance.kdbx',
                    encryptedBackup: 'required_independent_location',
                },
                verification: {
                    raftPersistence: 'verified',
                    restartSealUnseal: 'verified',
                    tlsLocalhost: 'verified',
                    auditReadback: 'verified',
                    backupRestore: 'verified',
                    leastPrivilegeDenial: 'verified',
                    solanaCanonicalMessageConformance: 'verified',
                    runtimeOwnerReadback:
                        realms.keyCustodyRecord.verification.runtimeOwnerReadback,
                    receipt: {
                        openBaoVersion: '2.6.0',
                        raftNodeId: 'alcheme-realms-devnet-1',
                        clusterId:
                            realms.keyCustodyRecord.verification.receipt.clusterId.trim(),
                        snapshotSha256:
                            realms.keyCustodyRecord.verification.receipt.snapshotSha256,
                        snapshotBytes: Number(
                            realms.keyCustodyRecord.verification.receipt.snapshotBytes,
                        ),
                        snapshotPrimaryRef: 'openbao_devnet_external_snapshot_primary',
                        snapshotIndependentBackupRef:
                            'alcheme_devnet_governance_encrypted_snapshot_copy',
                        originalUnsealVerifiedAt:
                            realms.keyCustodyRecord.verification.receipt.originalUnsealVerifiedAt,
                        isolatedRestoreVerifiedAt:
                            realms.keyCustodyRecord.verification.receipt.isolatedRestoreVerifiedAt,
                    },
                },
                primaryMaintainer: 'Taiyi',
                recoveryOwner: 'Taiyi',
                samePersonRecoveryException: true,
                inventoryOwner: 'payer_policy_and_resource_authority_binding',
                fundingSource: 'solana_devnet_faucet_only',
                feePayerAuthoritySeparation: 'required',
                lossProcedure: 'fail_closed_rebootstrap_devnet_environment_no_owner_operator_fallback',
                environmentRetention: 'repeatable_bootstrap_with_explicit_retirement_evidence',
                status: realms.keyCustodyRecord.status,
                lastVerifiedAt: realms.keyCustodyRecord.lastVerifiedAt,
            },
            devnetExecutionScope: 'approved',
            authorizationDecisionRef: 'DEC-P06-M3-REALMS-DEVNET-ONLY-v1',
            mainnet: 'unavailable',
            blockerCodes: realms.blockerCodes.map((code: string) => code.trim()),
        },
        blockerCodes: value.blockerCodes.map((code: string) => code.trim()),
    };
}

export async function fetchGovernedActionRouting(
    circleId: number,
): Promise<GovernedActionRoutingReadback> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/action-routing`,
        {
            init: { method: 'GET', cache: 'no-store' },
        },
    );
    return normalizeGovernedActionRoutingReadback(data?.routing, circleId);
}

function normalizeGovernedActionRoutingReadback(
    value: any,
    expectedCircleId: number,
): GovernedActionRoutingReadback {
    const routingPaths: GovernedActionRoutingPath[] = [
        'direct_operation',
        'governance_review',
        'blocked',
    ];
    const impacts = ['low', 'medium', 'high', 'critical'];
    const modes = ['optional', 'required_when_bound', 'always_required'];
    if (
        value?.schemaVersion !== 1
        || Number(value?.circleId) !== expectedCircleId
        || !Array.isArray(value?.matrix)
        || !Array.isArray(value?.recentDirectOperations)
    ) throw new Error('governed_action_routing_readback_invalid');
    const matrix: GovernedActionRoutingReadback['matrix'] = value.matrix.map((entry: any) => {
        const routingPolicy = entry?.routingPolicy == null
            ? null
            : {
                bindingId: String(entry.routingPolicy.bindingId || ''),
                actionType: String(entry.routingPolicy.actionType || ''),
                subjectType: entry.routingPolicy.subjectType,
                subjectRef: String(entry.routingPolicy.subjectRef || ''),
                policyId: String(entry.routingPolicy.policyId || ''),
                policyVersionId: String(entry.routingPolicy.policyVersionId || ''),
                policyVersion: Number(entry.routingPolicy.policyVersion),
                effectiveAt: String(entry.routingPolicy.effectiveAt || ''),
            };
        if (
            !String(entry?.actionType || '')
            || !String(entry?.targetType || '')
            || !impacts.includes(entry?.impact)
            || !modes.includes(entry?.governanceMode)
            || !routingPaths.includes(entry?.defaultPath)
            || !routingPaths.includes(entry?.currentPath)
            || !String(entry?.reason || '')
            || (
                (entry?.impact === 'high' || entry?.impact === 'critical')
                && entry?.currentPath === 'direct_operation'
            )
            || (routingPolicy && (
                !routingPolicy.bindingId
                || routingPolicy.actionType !== entry.actionType
                || routingPolicy.subjectType !== 'circle'
                || routingPolicy.subjectRef !== String(expectedCircleId)
                || !routingPolicy.policyId
                || !routingPolicy.policyVersionId
                || !Number.isSafeInteger(routingPolicy.policyVersion)
                || routingPolicy.policyVersion <= 0
                || Number.isNaN(new Date(routingPolicy.effectiveAt).getTime())
            ))
        ) throw new Error('governed_action_routing_readback_invalid');
        return {
            actionType: String(entry.actionType),
            targetType: String(entry.targetType),
            impact: entry.impact,
            governanceMode: entry.governanceMode,
            defaultPath: entry.defaultPath,
            currentPath: entry.currentPath,
            reason: String(entry.reason),
            routingPolicy,
        } as GovernedActionRoutingReadback['matrix'][number];
    });
    if (new Set(matrix.map((entry) => entry.actionType)).size !== matrix.length) {
        throw new Error('governed_action_routing_readback_invalid');
    }
    const recentDirectOperations = value.recentDirectOperations.map((entry: any) => {
        const receipt = entry?.receipt;
        const effect = entry?.effect;
        if (
            !String(entry?.actionType || '')
            || !String(receipt?.id || '')
            || !String(receipt?.policyVersionRef || '')
            || !String(receipt?.reasonCode || '')
            || !String(receipt?.executionStatus || '')
            || !String(receipt?.appealRef || '')
            || !/^[a-f0-9]{64}$/.test(String(receipt?.receiptDigest || ''))
            || !String(effect?.state || '')
            || !Number.isSafeInteger(Number(effect?.stateVersion))
            || Number(effect.stateVersion) < 0
            || !/^[a-f0-9]{64}$/.test(String(effect?.effectDigest || ''))
            || Number.isNaN(new Date(effect?.activatedAt).getTime())
        ) throw new Error('governed_action_routing_readback_invalid');
        return {
            actionType: String(entry.actionType),
            receipt: {
                id: String(receipt.id),
                policyVersionRef: String(receipt.policyVersionRef),
                reasonCode: String(receipt.reasonCode),
                executionStatus: String(receipt.executionStatus),
                executionRef: receipt.executionRef == null ? null : String(receipt.executionRef),
                reviewAt: receipt.reviewAt == null ? null : String(receipt.reviewAt),
                appealRef: String(receipt.appealRef),
                receiptDigest: String(receipt.receiptDigest),
            },
            effect: {
                state: String(effect.state),
                stateVersion: Number(effect.stateVersion),
                effectDigest: String(effect.effectDigest),
                activatedAt: new Date(effect.activatedAt).toISOString(),
            },
        };
    });
    return { schemaVersion: 1, circleId: expectedCircleId, matrix, recentDirectOperations };
}

export async function fetchGovernedActionOperationDetail(
    circleId: number,
    receiptId: string,
): Promise<GovernedActionOperationDetail> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/operations/${encodeURIComponent(receiptId)}`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    return normalizeGovernedActionOperationDetail(data?.operation, circleId, receiptId);
}

function normalizeGovernedActionOperationDetail(
    value: any,
    expectedCircleId: number,
    expectedReceiptId: string,
): GovernedActionOperationDetail {
    const digest = /^[a-f0-9]{64}$/;
    const expectedUrl = `/governance/operations/${expectedCircleId}/${encodeURIComponent(expectedReceiptId)}`;
    const validDate = (date: unknown) => (
        typeof date === 'string' && !Number.isNaN(new Date(date).getTime())
    );
    const optionalDate = (date: unknown) => date == null || validDate(date);
    normalizeGovernedActionAppealNoAggravationBoundary(value?.appeal?.resolutionBoundary);
    const appealRouting = normalizeGovernedActionAppealRoutingReadback(value?.appeal?.routing);
    const expectedAppealChannel = String(value?.actionType || '').startsWith('circle.policy.')
        ? 'circle_policy'
        : ['communication.member.mute', 'communication.message.hide'].includes(value?.actionType)
            ? 'operator_misconduct'
            : null;
    const expectedAppealSubmissionPath = expectedAppealChannel === 'circle_policy'
        ? `/api/v1/circles/${expectedCircleId}/operation-receipts/${encodeURIComponent(expectedReceiptId)}/appeals`
        : expectedAppealChannel === 'operator_misconduct'
            ? `/api/v1/communication/circles/${expectedCircleId}/moderation-state/appeals`
            : null;
    const actualAppealSubmissionPath = appealRouting.selectedChannel === 'circle_policy'
        ? appealRouting.channels.circlePolicy.submission?.path ?? null
        : appealRouting.selectedChannel === 'operator_misconduct'
            ? appealRouting.channels.operatorMisconduct.submission?.path ?? null
            : null;
    if (
        value?.schemaVersion !== 1
        || Number(value?.circleId) !== expectedCircleId
        || value?.canonicalUrl !== expectedUrl
        || value?.receipt?.id !== expectedReceiptId
        || value?.receipt?.invocationId !== value?.invocation?.id
        || !String(value?.actionType || '')
        || !String(value?.contract?.id || '')
        || !Number.isSafeInteger(Number(value?.contract?.version))
        || !digest.test(String(value?.contract?.definitionDigest || ''))
        || !digest.test(String(value?.authority?.snapshotDigest || ''))
        || !digest.test(String(value?.authority?.binding?.bindingDigest || ''))
        || value?.authority?.binding?.id !== value?.receipt?.roleAssignmentProof?.bindingId
        || value?.executionBoundary?.operationAuthority !== 'exact_invocation_snapshot_only'
        || value?.executionBoundary?.votingAuthority !== 'not_granted_by_operation'
        || value?.executionBoundary?.proposalMutationAuthority !== 'not_granted_by_operation'
        || value?.executionBoundary?.authorshipAuthority !== 'not_granted_by_operation'
        || value?.executionBoundary?.circleAuthority !== 'not_granted_by_operation'
        || value?.executionBoundary?.payerAuthority !== 'separate_not_granted_by_operation'
        || value?.executionBoundary?.serviceRoleAuthority !== 'limited_task_only_not_circle_authority'
        || value?.executionBoundary?.provider?.adapter !== value?.contract?.executionAdapter
        || value?.executionBoundary?.provider?.authority !== 'exact_execution_only'
        || value?.executionBoundary?.provider?.authoritativeFinality !== 'not_asserted'
        || !digest.test(String(value?.receipt?.receiptDigest || ''))
        || !digest.test(String(value?.effect?.effectDigest || ''))
        || !Number.isSafeInteger(Number(value?.effect?.stateVersion))
        || !validDate(value?.invocation?.createdAt)
        || !validDate(value?.invocation?.updatedAt)
        || !validDate(value?.receipt?.startedAt)
        || !validDate(value?.receipt?.completedAt)
        || !validDate(value?.effect?.activatedAt)
        || !validDate(value?.effect?.updatedAt)
        || !optionalDate(value?.appeal?.windowEndsAt)
        || appealRouting.selectedChannel !== expectedAppealChannel
        || actualAppealSubmissionPath !== expectedAppealSubmissionPath
        || !Array.isArray(value?.effect?.events)
        || !Array.isArray(value?.recurrence)
        || !String(value?.escalation?.ref || '')
        || (value?.escalation?.trigger !== null
            && value?.escalation?.trigger !== 'disputed'
            && value?.escalation?.trigger !== 'repeated')
        || (value?.escalation?.caseUrl !== null
            && value?.escalation?.caseUrl
                !== `/governance/cases/${encodeURIComponent(value.escalation.ref)}`)
    ) throw new Error('governed_action_operation_detail_invalid');
    value.effect.events.forEach((event: any, index: number) => {
        if (
            Number(event?.sequence) !== index
            || !String(event?.id || '')
            || !String(event?.toState || '')
            || !validDate(event?.occurredAt)
            || !digest.test(String(event?.transitionDigest || ''))
        ) throw new Error('governed_action_operation_detail_invalid');
    });
    value.recurrence.forEach((entry: any) => {
        if (
            !String(entry?.receiptId || '')
            || entry?.canonicalUrl !== `/governance/operations/${expectedCircleId}/${encodeURIComponent(entry.receiptId)}`
            || !validDate(entry?.completedAt)
        ) throw new Error('governed_action_operation_detail_invalid');
    });
    return value as GovernedActionOperationDetail;
}

function normalizeGovernanceRecoveryReadback(value: any): GovernanceRecoveryReadback {
    const configured = value?.automaticRecoveryConfigured === true
        && value?.mode === 'prebound_recovery_circle';
    const allowedStatuses: GovernanceRecoveryReadback['status'][] = [
        'not_configured',
        'available',
        'activation_pending',
        'ratification_pending',
        'ratified',
        'ratification_failed',
        'consumed',
    ];
    const status = allowedStatuses.includes(value?.status)
        ? value.status as GovernanceRecoveryReadback['status']
        : 'not_configured';
    return {
        mode: configured ? 'prebound_recovery_circle' : 'manual_recovery_only',
        status,
        automaticRecoveryConfigured: configured,
        warning: String(value?.warning || 'No automatic recovery is configured. A governance deadlock may be permanently unrecoverable.'),
        trigger: configured && value?.trigger === 'zero_eligible_electorate'
            ? 'zero_eligible_electorate'
            : null,
        recoveryCircleId: configured && Number.isSafeInteger(Number(value?.recoveryCircleId))
            ? Number(value.recoveryCircleId)
            : null,
        frozenActorCount: configured && Number.isSafeInteger(Number(value?.frozenActorCount))
            ? Number(value.frozenActorCount)
            : 0,
        unanimityRequired: true,
        maxCostMinor: '0',
        activationTtlSeconds: Number(value?.activationTtlSeconds || 3600),
        ratificationTtlSeconds: Number(value?.ratificationTtlSeconds || 86400),
        ratificationDeadline: value?.ratificationDeadline ? String(value.ratificationDeadline) : null,
        failClosed: true,
        authorityContinuity: normalizeGovernanceAuthorityContinuityReadback(value?.authorityContinuity),
        authorityHealth: normalizeGovernanceAuthorityHealthReadback(value?.authorityHealth),
        resourceAuthorityRecovery: normalizeGovernanceResourceAuthorityRecoveryReadback(value?.resourceAuthorityRecovery),
    };
}

function normalizeGovernanceResourceAuthorityRecoveryReadback(
    value: any,
): GovernanceResourceAuthorityRecoveryReadback {
    const allowedStatuses: GovernanceResourceAuthorityRecoveryReadback['status'][] = [
        'not_configured',
        'healthy',
        'recovery_pending',
        'rotation_failed',
        'permanently_blocked_external_authority',
    ];
    const status = allowedStatuses.includes(value?.status)
        ? value.status as GovernanceResourceAuthorityRecoveryReadback['status']
        : 'not_configured';
    const normalizeSlot = (slot: unknown): number | null => {
        const numberValue = Number(slot);
        return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
    };
    const normalizeDigest = (digest: unknown): string | null => (
        /^[a-f0-9]{64}$/.test(String(digest || '')) ? String(digest) : null
    );
    const resourceBindings = (Array.isArray(value?.resourceBindings) ? value.resourceBindings : [])
        .map((resource: any) => ({
            id: String(resource?.id || ''),
            provider: String(resource?.provider || ''),
            capability: String(resource?.capability || ''),
            status: String(resource?.status || 'unknown'),
            resourceRef: resource?.resourceRef ? String(resource.resourceRef) : null,
            ownerProgramRef: String(resource?.ownerProgramRef || ''),
            verifiedSlot: normalizeSlot(resource?.verifiedSlot),
            stateDigest: normalizeDigest(resource?.stateDigest),
            providerReadback: resource?.providerReadback === 'verified' ? 'verified' as const : 'missing' as const,
            authorityBindings: (Array.isArray(resource?.authorityBindings) ? resource.authorityBindings : [])
                .map((binding: any) => ({
                    id: String(binding?.id || ''),
                    role: String(binding?.role || ''),
                    status: String(binding?.status || 'unknown'),
                    currentAuthority: binding?.currentAuthority ? String(binding.currentAuthority) : null,
                    custodyStatus: String(binding?.custodyStatus || 'unknown'),
                    verifiedSlot: normalizeSlot(binding?.verifiedSlot),
                    stateDigest: normalizeDigest(binding?.stateDigest),
                }))
                .filter((binding: any) => binding.id && binding.role),
        }))
        .filter((resource: any) => resource.id && resource.provider && resource.capability && resource.ownerProgramRef);
    const acceptedArtifacts = (Array.isArray(value?.acceptedArtifacts) ? value.acceptedArtifacts : [])
        .map((artifact: any) => ({
            requestId: String(artifact?.requestId || ''),
            decisionDigest: normalizeDigest(artifact?.decisionDigest) || '',
            provider: String(artifact?.provider || ''),
            resourceBindingId: String(artifact?.resourceBindingId || ''),
        }))
        .filter((artifact: any) => artifact.requestId && artifact.decisionDigest && artifact.provider && artifact.resourceBindingId);
    const rotation = value?.rotation || {};
    return {
        authority: 'canonical_resource_authority_and_provider_readback',
        status,
        resourceBindingCount: Number.isSafeInteger(Number(value?.resourceBindingCount))
            ? Number(value.resourceBindingCount)
            : resourceBindings.length,
        authorityBindingCount: Number.isSafeInteger(Number(value?.authorityBindingCount))
            ? Number(value.authorityBindingCount)
            : resourceBindings.reduce((count: number, resource: any) => count + resource.authorityBindings.length, 0),
        verifiedProviderReadbackCount: Number.isSafeInteger(Number(value?.verifiedProviderReadbackCount))
            ? Number(value.verifiedProviderReadbackCount)
            : resourceBindings.filter((resource: any) => resource.providerReadback === 'verified').length,
        acceptedArtifacts,
        resourceBindings,
        rotation: {
            providerNativeRotationAvailable: false,
            externalSignerRevokeReadback: rotation.externalSignerRevokeReadback === 'verified'
                ? 'verified'
                : rotation.externalSignerRevokeReadback === 'not_applicable'
                    ? 'not_applicable'
                    : 'not_verified',
            circleOwnerAdminFallbackAllowed: false,
            fallbackAuthority: 'none',
        },
        unfulfilledObligations: normalizeStringArray(value?.unfulfilledObligations),
        residualRisks: normalizeStringArray(value?.residualRisks),
    };
}

function normalizeGovernanceAuthorityHealthReadback(value: any): GovernanceAuthorityHealthReadback {
    const status = ['not_checked', 'fresh', 'stale', 'degraded', 'drifted'].includes(value?.status)
        ? value.status as GovernanceAuthorityHealthReadback['status']
        : 'not_checked';
    const gate = ['allowed', 'blocked_stale', 'blocked_degraded', 'blocked_emergency_freeze', 'blocked_review_overdue', 'not_enforced_until_first_check'].includes(value?.highRiskPlanGate)
        ? value.highRiskPlanGate as GovernanceAuthorityHealthReadback['highRiskPlanGate']
        : 'not_enforced_until_first_check';
    const fault = value?.faultAssessment;
    const freeze = fault?.emergencyFreeze;
    const faultClass = ['electorate_inactivity', 'lost_key', 'compromised_key'].includes(fault?.faultClass)
        ? fault.faultClass as NonNullable<GovernanceAuthorityHealthReadback['faultAssessment']>['faultClass']
        : null;
    const eligibleActorCount = Number(freeze?.actorQuorum?.eligibleActorCount);
    const approvalThreshold = Number(freeze?.actorQuorum?.approvalThreshold);
    const maximumDurationSeconds = Number(freeze?.maximumDurationSeconds);
    const faultContractValid = faultClass !== null
        && freeze?.trigger === `ratified_${faultClass}`
        && /^[a-f0-9]{64}$/.test(String(freeze?.actorQuorum?.actorSnapshotDigest || ''))
        && Number.isSafeInteger(eligibleActorCount)
        && eligibleActorCount > 0
        && Number.isSafeInteger(approvalThreshold)
        && approvalThreshold > 0
        && approvalThreshold <= eligibleActorCount
        && freeze?.actorQuorum?.decisionMechanismKind === 'equal_weight_threshold'
        && freeze?.actorQuorum?.operatorSignatureRequired === true
        && freeze?.scope === 'new_high_and_critical_plans'
        && Number.isSafeInteger(maximumDurationSeconds)
        && maximumDurationSeconds >= 300
        && maximumDurationSeconds <= 86_400
        && typeof freeze?.activatedAt === 'string'
        && typeof freeze?.freezeEndsAt === 'string'
        && freeze?.recovery === 'new_accepted_wallet_signed_health_case_without_fault'
        && freeze?.mandatoryReview === 'required_before_release'
        && typeof freeze?.reviewDueAt === 'string'
        && ['required', 'overdue'].includes(freeze?.reviewStatus)
        && freeze?.payloadMutation === 'forbidden'
        && freeze?.authorityMutation === 'forbidden'
        && freeze?.decisionOverride === 'forbidden'
        && freeze?.notification === 'circle_managers_and_frozen_committee'
        && freeze?.resourcePause === 'not_claimed_p06_authority_required';
    return {
        status,
        stateVersion: Number.isSafeInteger(Number(value?.stateVersion)) ? Number(value.stateVersion) : 0,
        checkedAt: value?.checkedAt ? String(value.checkedAt) : null,
        staleAt: value?.staleAt ? String(value.staleAt) : null,
        committeeEligibleCount: Number(value?.committeeEligibleCount || 0),
        committeeSignedCount: Number(value?.committeeSignedCount || 0),
        operatorProof: value?.operatorProof === 'wallet_signed_signal' ? 'wallet_signed_signal' : status === 'not_checked' ? 'not_checked' : 'missing',
        targetManagerProof: value?.targetManagerProof === 'authenticated_wallet_session' ? 'authenticated_wallet_session' : 'not_checked',
        recoveryPanelStatus: value?.recoveryPanelStatus === 'wallet_signed_signal'
            ? 'wallet_signed_signal'
            : value?.recoveryPanelStatus === 'degraded_missing_wallet_proof'
                ? 'degraded_missing_wallet_proof'
                : value?.recoveryPanelStatus === 'not_configured' ? 'not_configured' : 'not_checked',
        externalAuthorityStatus: 'p06_provider_readback_required',
        evidenceDigest: typeof value?.evidenceDigest === 'string' ? value.evidenceDigest : null,
        evidenceIntegrity: ['verified', 'not_recorded', 'drifted'].includes(value?.evidenceIntegrity) ? value.evidenceIntegrity : 'not_recorded',
        highRiskPlanGate: gate,
        faultAssessment: faultContractValid
            ? {
                faultClass: faultClass!,
                affectedActorPubkey: String(fault.affectedActorPubkey || ''),
                evidenceRef: String(fault.evidenceRef || ''),
                emergencyFreeze: {
                    trigger: freeze.trigger,
                    actorQuorum: {
                        actorSnapshotDigest: freeze.actorQuorum.actorSnapshotDigest,
                        eligibleActorCount,
                        approvalThreshold,
                        decisionMechanismKind: 'equal_weight_threshold',
                        operatorSignatureRequired: true,
                    },
                    scope: 'new_high_and_critical_plans',
                    maximumDurationSeconds,
                    activatedAt: freeze.activatedAt,
                    freezeEndsAt: freeze.freezeEndsAt,
                    recovery: 'new_accepted_wallet_signed_health_case_without_fault',
                    mandatoryReview: 'required_before_release',
                    reviewDueAt: freeze.reviewDueAt,
                    reviewStatus: freeze.reviewStatus,
                    payloadMutation: 'forbidden',
                    authorityMutation: 'forbidden',
                    decisionOverride: 'forbidden',
                    notification: 'circle_managers_and_frozen_committee',
                    resourcePause: 'not_claimed_p06_authority_required',
                },
            }
            : null,
        warning: String(value?.warning || 'Authority health has not been checked.'),
    };
}

function normalizeGovernanceCaseAuthorityHealthReadback(value: any): GovernanceCase['authorityHealthReadback'] {
    const targetCircleId = Number(value?.targetCircleId);
    if (
        value?.authority !== 'canonical_circle_governance_binding'
        || typeof value?.sourceRequestId !== 'string'
        || !value.sourceRequestId.trim()
        || typeof value?.bindingId !== 'string'
        || !value.bindingId.trim()
        || !Number.isSafeInteger(targetCircleId)
        || targetCircleId <= 0
        || value?.evidenceIntegrity !== 'verified'
        || typeof value?.evidenceDigest !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.evidenceDigest)
    ) return null;
    return {
        ...normalizeGovernanceAuthorityHealthReadback(value),
        authority: 'canonical_circle_governance_binding',
        sourceRequestId: value.sourceRequestId,
        bindingId: value.bindingId,
        targetCircleId,
    };
}

function normalizeGovernanceAuthorityContinuityReadback(
    value: any,
): GovernanceAuthorityContinuityReadback {
    const allowedStatuses: GovernanceAuthorityContinuityReadback['status'][] = [
        'not_applicable',
        'healthy',
        'manual_recovery_pending',
        'permanently_blocked_governance_authority',
        'drifted',
    ];
    const status = allowedStatuses.includes(value?.status)
        ? value.status as GovernanceAuthorityContinuityReadback['status']
        : 'drifted';
    const evidenceIntegrity = ['verified', 'not_recorded', 'drifted'].includes(value?.evidenceIntegrity)
        ? value.evidenceIntegrity as GovernanceAuthorityContinuityReadback['evidenceIntegrity']
        : 'drifted';
    return {
        status,
        stateVersion: Number.isSafeInteger(Number(value?.stateVersion))
            ? Number(value.stateVersion)
            : 0,
        trigger: value?.trigger === 'zero_eligible_electorate'
            || value?.trigger === 'signer_threshold_unreachable'
            ? value.trigger
            : null,
        canonicalAuthority: ['verified', 'unverified', 'not_applicable'].includes(value?.canonicalAuthority)
            ? value.canonicalAuthority
            : 'unverified',
        offPlatformReconstitution: value?.offPlatformReconstitution === 'not_applicable'
            ? 'not_applicable'
            : 'not_verified',
        externalAuthorityStatus: 'p06_provider_readback_required',
        fallbackAuthority: 'none',
        reporterAuthority: 'none',
        evidenceDigest: typeof value?.evidenceDigest === 'string' ? value.evidenceDigest : null,
        evidenceIntegrity,
        startedAt: value?.startedAt ? String(value.startedAt) : null,
        terminalAt: value?.terminalAt ? String(value.terminalAt) : null,
        canRetryTargetPreflight: value?.canRetryTargetPreflight === true,
        canRecordPermanentBlock: value?.canRecordPermanentBlock === true,
        faultControls: value?.faultControls ? {
            waitingPeriod: 'until_lawful_authority_restored',
            freeze: 'new_governance_except_recovery_and_history',
            successor: 'prebound_recovery_circle_or_manual_reconstitution',
            notification: 'circle_managers_and_current_members',
            providerAuthority: 'p06_provider_readback_required',
        } : null,
        warning: String(value?.warning || 'Authority continuity readback is unavailable. Governance transition remains fail closed.'),
    };
}

export async function fetchCircleGovernanceCommitteeProfile(
    circleId: number,
    signal?: AbortSignal,
): Promise<CircleGovernanceCommitteeProfile> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${circleId}/committee-profile`, {
        init: {
            method: 'GET',
            cache: 'no-store',
            signal,
        },
    });
    return normalizeCommitteeProfile(data?.profile, circleId);
}

export async function updateCircleGovernanceCommitteeProfile(input: {
    circleId: number;
    availabilityStatus: 'disabled' | 'enabled';
    actorPubkey: string;
    windowMinutes?: number | null;
    allowedActionPrefixes?: string[] | null;
    electorateTemplate?: CircleGovernanceCommitteeElectorateTemplate | null;
}): Promise<{
    status: 'executed' | 'requires_governance';
    profile?: CircleGovernanceCommitteeProfile;
    request?: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${input.circleId}/committee-profile`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                availabilityStatus: input.availabilityStatus,
                actorPubkey: input.actorPubkey,
                windowMinutes: input.windowMinutes ?? null,
                allowedActionPrefixes: input.allowedActionPrefixes ?? null,
                electorateTemplate: input.electorateTemplate ?? null,
            }),
        },
    });
    return {
        status: data?.status === 'executed' ? 'executed' : 'requires_governance',
        profile: data?.profile ? normalizeCommitteeProfile(data.profile, input.circleId) : undefined,
        request: data?.request ? normalizeRequest(data.request) : undefined,
    };
}

export async function updateCircleGovernancePolicyVersion(input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
    electorateTemplate: CircleGovernanceCommitteeElectorateTemplate;
    targetCommitteeCircleId?: number | null;
}): Promise<{
    status: 'requires_governance';
    case: GovernanceCase;
} | {
    status: 'manual_recovery_pending';
    authorityContinuity: GovernanceAuthorityContinuityReadback;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(input.bindingId)}/policy-version`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actorPubkey: input.actorPubkey,
                    electorateTemplate: input.electorateTemplate,
                    targetCommitteeCircleId: input.targetCommitteeCircleId ?? null,
                }),
            },
        },
    );
    return data?.status === 'manual_recovery_pending'
        ? {
            status: 'manual_recovery_pending',
            authorityContinuity: normalizeGovernanceAuthorityContinuityReadback(data?.authorityContinuity),
        }
        : {
            status: 'requires_governance',
            case: normalizeGovernanceCase(data?.case),
        };
}

export async function createGovernanceRecoveryPolicy(input: {
    circleId: number;
    bindingId: string;
    recoveryCircleId: number;
    actorPubkey: string;
}): Promise<{
    status: 'requires_governance';
    case: GovernanceCase;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(input.bindingId)}/recovery-policy`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actorPubkey: input.actorPubkey,
                    recoveryCircleId: input.recoveryCircleId,
                }),
            },
        },
    );
    return {
        status: 'requires_governance',
        case: normalizeGovernanceCase(data?.case),
    };
}

export async function openGovernanceAuthorityHealthCase(input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
    faultAssessment?: {
        faultClass: 'electorate_inactivity' | 'lost_key' | 'compromised_key';
        affectedActorPubkey: string;
        evidenceRef: string;
        maximumDurationSeconds: number;
    } | null;
}): Promise<{ status: 'requires_governance'; case: GovernanceCase }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(input.bindingId)}/authority-health/cases`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actorPubkey: input.actorPubkey,
                    faultAssessment: input.faultAssessment ?? null,
                }),
            },
        },
    );
    return { status: 'requires_governance', case: normalizeGovernanceCase(data?.case) };
}

export async function applyGovernanceAuthorityHealth(input: {
    circleId: number;
    bindingId: string;
    requestId: string;
    actorPubkey: string;
}): Promise<GovernanceAuthorityHealthReadback> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(input.bindingId)}/authority-health/applications`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actorPubkey: input.actorPubkey, requestId: input.requestId }),
            },
        },
    );
    return normalizeGovernanceAuthorityHealthReadback(data?.authorityHealth);
}

export async function permanentlyBlockGovernanceAuthority(input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
}): Promise<GovernanceAuthorityContinuityReadback> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(input.bindingId)}/authority-continuity/permanent-block`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actorPubkey: input.actorPubkey }),
            },
        },
    );
    return normalizeGovernanceAuthorityContinuityReadback(data?.authorityContinuity);
}

export async function openGovernanceConfigurationRollback(input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
    rollbackFromCaseId: string;
}): Promise<{
    status: 'requires_governance';
    case: GovernanceCase;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(input.bindingId)}/policy-version`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actorPubkey: input.actorPubkey,
                    rollbackFromCaseId: input.rollbackFromCaseId,
                }),
            },
        },
    );
    return {
        status: 'requires_governance',
        case: normalizeGovernanceCase(data?.case),
    };
}

export async function createLocalAuxiliaryGovernanceBinding(input: {
    circleId: number;
    committeeCircleId: number;
    actionType?: string | null;
    actionPrefix?: string | null;
    actorPubkey: string;
    continuityIncident?: GovernanceContinuityIncidentInput | null;
}): Promise<{
    status: 'requires_governance';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/local-auxiliary`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                committeeCircleId: input.committeeCircleId,
                actionType: input.actionType ?? null,
                actionPrefix: input.actionPrefix ?? null,
                actorPubkey: input.actorPubkey,
                continuityIncident: input.continuityIncident ?? null,
            }),
        },
    });
    return {
        status: 'requires_governance',
        request: normalizeRequest(data?.request),
    };
}

export async function createSelfGovernedGovernanceBinding(input: {
    circleId: number;
    actionType: string;
    subject: { type: string; ref: string };
    network: 'solana:localnet' | 'solana:devnet';
    actorPubkey: string;
}): Promise<{
    status: 'requires_governance';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/self-governed`,
        {
            init: {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    actionType: input.actionType,
                    subject: input.subject,
                    network: input.network,
                    actorPubkey: input.actorPubkey,
                }),
            },
        },
    );
    return {
        status: 'requires_governance',
        request: normalizeRequest(data?.request),
    };
}

export async function createSharedCommitteeMandateBinding(input: {
    circleId: number;
    committeeCircleId: number;
    purposeBindings: Array<{
        purpose: 'collective_decision' | 'operational_execution';
        actionType: string | null;
        actionPrefix: string | null;
    }>;
    actionType?: string | null;
    actionPrefix?: string | null;
    actorPubkey: string;
    effectiveFrom: string;
    effectiveUntil: string;
    acceptanceExpiresAt: string;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    subject: { type: string; ref: string };
    feePolicy: GovernanceMandateFeePolicy;
    effectPolicy: GovernanceMandateEffectPolicy | null;
    operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints | null;
    crossInstitutionDisclosureImpact?: GovernanceCrossInstitutionDisclosureDeclaration | null;
    continuityIncident?: GovernanceContinuityIncidentInput | null;
}): Promise<{
    status: 'requires_governance';
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/shared-mandate`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                committeeCircleId: input.committeeCircleId,
                purposeBindings: input.purposeBindings,
                actionType: input.actionType ?? null,
                actionPrefix: input.actionPrefix ?? null,
                actorPubkey: input.actorPubkey,
                effectiveFrom: input.effectiveFrom,
                effectiveUntil: input.effectiveUntil,
                acceptanceExpiresAt: input.acceptanceExpiresAt,
                minimumConstraints: input.minimumConstraints,
                subject: input.subject,
                feePolicy: input.feePolicy,
                effectPolicy: input.effectPolicy,
                operatorPolicyConstraints: input.operatorPolicyConstraints ?? null,
                crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact ?? null,
                continuityIncident: input.continuityIncident ?? null,
            }),
        },
    });
    return {
        status: 'requires_governance',
        request: normalizeRequest(data?.request),
    };
}

export interface GovernanceContinuityIncidentInput {
    replacementActorPubkey: string;
    incidentReviewRef: string;
    incidentReviewSummary: string;
}

export async function counterSharedCommitteeGovernanceMandate(input: {
    committeeCircleId: number;
    mandateId: string;
    actionType?: string | null;
    actionPrefix?: string | null;
    actorPubkey: string;
    effectiveFrom: string;
    effectiveUntil: string;
    acceptanceExpiresAt: string;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    subject: { type: string; ref: string };
    purposeBindings: Array<{
        purpose: 'collective_decision' | 'operational_execution';
        actionType: string | null;
        actionPrefix: string | null;
    }>;
    feePolicy: GovernanceMandateFeePolicy;
    effectPolicy: GovernanceMandateEffectPolicy | null;
    operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints | null;
    crossInstitutionDisclosureImpact?: GovernanceCrossInstitutionDisclosureDeclaration | null;
}): Promise<{
    binding: CircleGovernanceBinding;
    mandate: GovernanceMandateSummary;
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.committeeCircleId}/governance-mandates/${encodeURIComponent(input.mandateId)}/counter`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actorPubkey: input.actorPubkey,
                    actionType: input.actionType ?? null,
                    actionPrefix: input.actionPrefix ?? null,
                    effectiveFrom: input.effectiveFrom,
                    effectiveUntil: input.effectiveUntil,
                    acceptanceExpiresAt: input.acceptanceExpiresAt,
                    minimumConstraints: input.minimumConstraints,
                    subject: input.subject,
                    purposeBindings: input.purposeBindings,
                    feePolicy: input.feePolicy,
                    effectPolicy: input.effectPolicy,
                    operatorPolicyConstraints: input.operatorPolicyConstraints ?? null,
                    crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact ?? null,
                }),
            },
        },
    );
    return {
        binding: normalizeBinding(data?.binding),
        mandate: normalizeGovernanceMandate(data?.mandate),
        request: normalizeRequest(data?.request),
    };
}

export async function proposeActiveGovernanceMandateSupersede(input: {
    targetCircleId: number;
    mandateId: string;
    actorPubkey: string;
    effectiveUntil: string;
    acceptanceExpiresAt: string;
    minimumConstraints: GovernanceMandateMinimumConstraints;
    operatorPolicyConstraints?: GovernanceMandateOperatorPolicyConstraints | null;
    crossInstitutionDisclosureImpact?: GovernanceCrossInstitutionDisclosureDeclaration | null;
    idempotencyKey: string;
}): Promise<{ case: GovernanceCase; replayed: boolean; mandateVersion: number }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.targetCircleId}/governance-mandates/${encodeURIComponent(input.mandateId)}/supersede`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    actorPubkey: input.actorPubkey,
                    effectiveUntil: input.effectiveUntil,
                    acceptanceExpiresAt: input.acceptanceExpiresAt,
                    minimumConstraints: input.minimumConstraints,
                    operatorPolicyConstraints: input.operatorPolicyConstraints ?? null,
                    crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact ?? null,
                    idempotencyKey: input.idempotencyKey,
                }),
            },
        },
    );
    return {
        case: normalizeGovernanceCase(data?.case),
        replayed: data?.replayed === true,
        mandateVersion: Number(data?.mandateVersion?.version ?? 0),
    };
}

export interface GovernanceMandateAcceptanceChallenge {
    envelope: {
        schemaVersion: 1;
        domain: 'alcheme.governance.mandate.acceptance';
        network: 'solana:localnet' | 'solana:devnet';
        action: 'accept_counter';
        mandateId: string;
        mandateVersion: number;
        mandateTermsDigest: string;
        delegatorGovernanceHome: { type: string; ref: string };
        delegateAuthority: { type: string; ref: string };
        actor: string;
        nonce: string;
        expiresAt: string;
    };
    signedMessage: string;
    envelopeDigest: string;
}

export async function prepareGovernanceMandateAcceptance(input: {
    targetCircleId: number;
    mandateId: string;
    actorPubkey: string;
}): Promise<GovernanceMandateAcceptanceChallenge> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.targetCircleId}/governance-mandates/${encodeURIComponent(input.mandateId)}/acceptance/prepare`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actorPubkey: input.actorPubkey }),
            },
        },
    );
}

export async function acceptGovernanceMandateCounter(input: {
    targetCircleId: number;
    mandateId: string;
    actorPubkey: string;
    signedMessage: string;
    signature: string;
    nonce: string;
    expiresAt: string;
    mandateVersion: number;
    mandateTermsDigest: string;
}): Promise<GovernanceMandateSummary> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.targetCircleId}/governance-mandates/${encodeURIComponent(input.mandateId)}/acceptance`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    );
    return normalizeGovernanceMandate(data?.mandate);
}

export async function requestGovernanceBindingDeactivation(input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
    reason?: string | null;
}): Promise<{ status: 'requires_governance'; case: GovernanceCase }> {
    const route = await resolveNodeRoute('governance');
    const bindingId = input.bindingId;
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${input.circleId}/governance-bindings/${encodeURIComponent(bindingId)}/deactivate`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                actorPubkey: input.actorPubkey,
                reason: input.reason ?? null,
            }),
        },
    });
    return {
        status: 'requires_governance',
        case: normalizeGovernanceCase(data?.case),
    };
}

export async function fetchCircleGovernanceRequests(
    circleId: number,
    view: 'target' | 'committee',
    options?: {
        targetType?: string;
        actionType?: string;
        state?: string;
        signal?: AbortSignal;
    },
): Promise<{
    circleId: number;
    view: 'target' | 'committee';
    requests: CircleGovernanceRequest[];
}> {
    const route = await resolveNodeRoute('governance');
    const params = new URLSearchParams();
    params.set('view', view);
    if (options?.targetType) params.set('targetType', options.targetType);
    if (options?.actionType) params.set('actionType', options.actionType);
    if (options?.state) params.set('state', options.state);
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${circleId}/requests?${params.toString()}`, {
        init: {
            method: 'GET',
            cache: 'no-store',
            signal: options?.signal,
        },
    });
    return {
        circleId: Number(data?.circleId || circleId),
        view: data?.view === 'committee' ? 'committee' : 'target',
        requests: Array.isArray(data?.requests)
            ? data.requests.map(normalizeRequest)
            : [],
    };
}

export async function fetchCircleGovernanceCases(
    circleId: number,
    input: { q?: string; filters?: CircleGovernanceSearchFilters } = {},
): Promise<{
    circleId: number;
    cases: GovernanceCase[];
    search: CircleGovernanceSearchResponse;
}> {
    const route = await resolveNodeRoute('governance');
    const params = new URLSearchParams();
    const queryValue = input.q?.normalize('NFKC').trim();
    if (queryValue && queryValue.length >= 2) params.set('q', queryValue);
    for (const key of CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS) {
        const value = input.filters?.[key]?.normalize('NFKC').trim();
        if (value) params.set(key, value);
    }
    const query = params.toString();
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/circles/${circleId}/cases${query ? `?${query}` : ''}`, {
        init: { method: 'GET', cache: 'no-store' },
    });
    return {
        circleId: Number(data?.circleId || circleId),
        cases: Array.isArray(data?.cases)
            ? data.cases.map((value: unknown) => normalizeGovernanceCase(
                value,
                data?.projection?.publiclyReadable === true,
            ))
            : [],
        search: normalizeCircleGovernanceSearchResponse(data?.search),
    };
}

export async function fetchMyGovernanceInbox(
    filters: GovernanceOperationalInboxFilters = {},
): Promise<GovernanceInbox> {
    const route = await resolveNodeRoute('governance');
    const params = new URLSearchParams();
    for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
        const value = filters[key]?.trim();
        if (value) params.set(key, value);
    }
    const query = params.toString();
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/cases/inbox${query ? `?${query}` : ''}`, {
        init: { method: 'GET', cache: 'no-store' },
    });
    if (!data?.queue
        || !Array.isArray(data?.items)
        || !Array.isArray(data?.institutionalDuties)
        || !Array.isArray(data?.operations)
        || !Object.prototype.hasOwnProperty.call(data ?? {}, 'continueWorking')) {
        throw new Error('invalid_governance_inbox_contract');
    }
    const items = data.items.map((value: any) => ({
        case: normalizeGovernanceCase(value?.case),
        task: normalizeGovernanceCaseInboxTask(value?.task),
        readState: normalizeGovernanceCaseReadState(value?.readState, String(value?.case?.id || ''), true)!,
        institutionalIdentities: normalizeGovernanceInboxInstitutionalIdentities(
            value?.institutionalIdentities,
        ),
    })).filter((item: GovernanceCaseInboxItem) => item.case.id.length > 0);
    const institutionalDuties = data.institutionalDuties.map(normalizeGovernanceInstitutionalDuty);
    const operations = data.operations.map(normalizeGovernanceOperationInboxItem);
    const continueWorking = data.continueWorking == null
        ? null
        : normalizeGovernanceContinueWorking(data.continueWorking);
    return {
        queue: normalizeGovernanceOperationalInboxQueue(data.queue),
        items,
        institutionalDuties,
        operations,
        continueWorking,
    };
}

export function normalizeGovernanceRuntimeMetrics(
    value: unknown,
): GovernanceRuntimeMetricsReadback {
    const candidate = value as any;
    const windowStartedAt = typeof candidate?.windowStartedAt === 'string'
        ? candidate.windowStartedAt
        : '';
    const observedAt = typeof candidate?.observedAt === 'string'
        ? candidate.observedAt
        : '';
    const requestValues = [
        candidate?.requests?.total,
        candidate?.requests?.successes,
        candidate?.requests?.clientErrors,
        candidate?.requests?.serverErrors,
    ];
    const sampleCount = candidate?.latency?.sampleCount;
    const averageMs = candidate?.latency?.averageMs;
    const hasP95UpperBound = Object.prototype.hasOwnProperty.call(
        candidate?.latency ?? {},
        'p95UpperBoundMs',
    );
    const p95UpperBoundMs = candidate?.latency?.p95UpperBoundMs == null
        ? null
        : candidate.latency.p95UpperBoundMs;
    if (candidate?.schemaVersion !== 1
        || candidate?.scope !== 'query_api_process_window'
        || candidate?.routeFamily !== '/api/v1/governance'
        || candidate?.durability !== 'process_memory_not_time_series'
        || !Number.isFinite(Date.parse(windowStartedAt))
        || !Number.isFinite(Date.parse(observedAt))
        || Date.parse(observedAt) < Date.parse(windowStartedAt)
        || requestValues.some((count) => typeof count !== 'number'
            || !Number.isSafeInteger(count)
            || count < 0)
        || requestValues.slice(1).reduce((sum, count) => sum + count, 0) > requestValues[0]
        || typeof sampleCount !== 'number'
        || !Number.isSafeInteger(sampleCount)
        || sampleCount < 0
        || typeof averageMs !== 'number'
        || !Number.isFinite(averageMs)
        || averageMs < 0
        || !hasP95UpperBound
        || (p95UpperBoundMs !== null
            && (typeof p95UpperBoundMs !== 'number'
                || !Number.isFinite(p95UpperBoundMs)
                || p95UpperBoundMs < 0))
        || candidate?.sloTarget?.status !== 'not_configured') {
        throw new Error('invalid_governance_runtime_metrics_contract');
    }
    return {
        schemaVersion: 1,
        scope: 'query_api_process_window',
        routeFamily: '/api/v1/governance',
        durability: 'process_memory_not_time_series',
        windowStartedAt,
        observedAt,
        requests: {
            total: requestValues[0],
            successes: requestValues[1],
            clientErrors: requestValues[2],
            serverErrors: requestValues[3],
        },
        latency: { sampleCount, averageMs, p95UpperBoundMs },
        sloTarget: { status: 'not_configured' },
    };
}

export async function fetchCircleGovernanceRuntimeMetrics(
    circleId: number,
): Promise<GovernanceRuntimeMetricsReadback> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/runtime-metrics`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    if (Number(data?.circleId) !== circleId) {
        throw new Error('invalid_governance_runtime_metrics_circle');
    }
    return normalizeGovernanceRuntimeMetrics(data?.metrics);
}

export async function fetchCircleGovernanceCaseTemplates(
    circleId: number,
    caseType: GovernanceCaseType,
): Promise<GovernanceCaseTemplateCatalog> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${circleId}/case-templates?caseType=${encodeURIComponent(caseType)}`,
        { init: { method: 'GET', cache: 'no-store' } },
    ) as Promise<GovernanceCaseTemplateCatalog>;
}

export async function fetchGovernanceCase(caseId: string): Promise<GovernanceCase> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(caseId)}`, {
        init: { method: 'GET', cache: 'no-store' },
    });
    return normalizeGovernanceCase(data?.case, data?.projection?.publiclyReadable === true);
}

export async function fetchGovernanceCaseSearch(
    caseId: string,
    query: string,
): Promise<GovernanceCaseSearchResponse> {
    const route = await resolveNodeRoute('governance');
    const normalizedQuery = query.normalize('NFKC').trim();
    if (normalizedQuery.length < 2 || normalizedQuery.length > 256) {
        throw new Error('invalid_governance_case_search_query');
    }
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(caseId)}?q=${encodeURIComponent(normalizedQuery)}`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    return normalizeGovernanceCaseSearchResponse(data?.search, caseId);
}

export async function updateGovernanceCaseAttentionPreference(input: {
    caseId: string;
    level: GovernanceCaseAttentionPreference['level'];
    expectedVersion: number;
}): Promise<{ preference: GovernanceCaseAttentionPreference; replayed: boolean }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/attention-preference`,
        {
            init: {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level: input.level, expectedVersion: input.expectedVersion }),
            },
        },
    );
    return {
        preference: normalizeGovernanceCaseAttentionPreference(data?.preference, true)!,
        replayed: data?.replayed === true,
    };
}

export async function updateGovernanceCaseReadCursor(input: {
    caseId: string;
    activityCursor: string;
    resumeFragment: string | null;
    visitId: string;
    expectedVersion: number;
}): Promise<{ readState: GovernanceCaseReadState; replayed: boolean }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/read-cursor`,
        {
            init: {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    activityCursor: input.activityCursor,
                    resumeFragment: input.resumeFragment,
                    visitId: input.visitId,
                    expectedVersion: input.expectedVersion,
                }),
            },
        },
    );
    return {
        readState: normalizeGovernanceCaseReadState(data?.readState, input.caseId, true)!,
        replayed: data?.replayed === true,
    };
}

export async function exportGovernanceCaseAudience(input: {
    caseId: string;
    audience: 'public' | 'operator';
    purpose: string;
    idempotencyKey: string;
}): Promise<GovernanceCaseAudienceExport> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/exports`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audience: input.audience,
                    purpose: input.purpose,
                    idempotencyKey: input.idempotencyKey,
                }),
            },
        },
    );
    const value = data?.export;
    if (
        value?.schemaVersion !== 1
        || value?.audience !== input.audience
        || !value?.exportedAt
        || !value?.case
        || String(value.case.id || '') !== input.caseId
    ) throw new Error('invalid_governance_case_export_contract');
    return value as GovernanceCaseAudienceExport;
}

export async function requestGovernanceEvidenceShare(input: {
    caseId: string;
    purpose: string;
    requestNote?: string | null;
    idempotencyKey: string;
}): Promise<{ package: GovernanceEvidenceSharePackage; replayed: boolean }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/evidence-share-requests`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    );
    return {
        package: normalizeGovernanceEvidenceSharePackage(data?.package),
        replayed: data?.replayed === true,
    };
}

export async function fetchGovernanceCaseEvidenceShares(
    caseId: string,
): Promise<GovernanceEvidenceSharePackage[]> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(caseId)}/evidence-shares`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    return Array.isArray(data?.packages)
        ? data.packages.map(normalizeGovernanceEvidenceSharePackage)
        : [];
}

export async function decideGovernanceEvidenceShare(input: {
    packageId: string;
    action: 'authorize' | 'deny';
    expectedVersion: number;
    sourceMaterialIds?: number[];
    safeSummary?: string | null;
    expiresAt?: string | null;
    reason?: string | null;
    idempotencyKey: string;
}): Promise<{ package: GovernanceEvidenceSharePackage; replayed: boolean }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/evidence-shares/${encodeURIComponent(input.packageId)}/decision`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    );
    return {
        package: normalizeGovernanceEvidenceSharePackage(data?.package),
        replayed: data?.replayed === true,
    };
}

export async function revokeGovernanceEvidenceShare(input: {
    packageId: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
}): Promise<{ package: GovernanceEvidenceSharePackage; replayed: boolean }> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/evidence-shares/${encodeURIComponent(input.packageId)}/revoke`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    );
    return {
        package: normalizeGovernanceEvidenceSharePackage(data?.package),
        replayed: data?.replayed === true,
    };
}

export async function accessGovernanceEvidenceShare(input: {
    packageId: string;
    action: 'read' | 'export';
    purpose: string;
    idempotencyKey: string;
}): Promise<GovernanceEvidenceSharePackage> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/evidence-shares/${encodeURIComponent(input.packageId)}/access`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    );
    if (data?.allowed !== true || !data?.package) throw new Error(String(data?.reason || 'evidence_share_access_denied'));
    return normalizeGovernanceEvidenceSharePackage(data.package);
}

export async function fetchGovernanceCaseBriefCandidates(
    caseId: string,
): Promise<GovernanceCaseBriefCandidate[]> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(caseId)}/brief-candidates`,
        { init: { method: 'GET', cache: 'no-store' } },
    );
    return Array.isArray(data?.candidates)
        ? data.candidates.map(normalizeGovernanceCaseBriefCandidate)
            .filter((candidate: GovernanceCaseBriefCandidate) => candidate.draftPostId > 0)
        : [];
}

export async function bindGovernanceCaseBrief(input: {
    caseId: string;
    draftPostId: number;
    expectedDraftVersion: number;
    expectedSnapshotDigest: string;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{
    replayed: boolean;
    caseVersion: number;
    binding: NonNullable<GovernanceCase['brief']>;
}> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/brief-binding`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draftPostId: input.draftPostId,
                    expectedDraftVersion: input.expectedDraftVersion,
                    expectedSnapshotDigest: input.expectedSnapshotDigest,
                    idempotencyKey: input.idempotencyKey,
                    expectedCaseVersion: input.expectedCaseVersion,
                }),
            },
        },
    ) as Promise<{
        replayed: boolean;
        caseVersion: number;
        binding: NonNullable<GovernanceCase['brief']>;
    }>;
}

export const STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE =
    'storage_fabric.authorize_provider_admission' as const;
export const STORAGE_FABRIC_PROVIDER_ADMISSION_EXECUTION_TARGET_REF =
    'storage-fabric:provider-registry:devnet-demo' as const;
export const STORAGE_FABRIC_PROVIDER_ADMISSION_MAPPING_VERSION =
    'storage-fabric.provider-admission.v1' as const;
export const STORAGE_FABRIC_PROVIDER_ADMISSION_OPERATION_PAYLOAD_KEYS = [
    'providerId',
    'providerPubkey',
    'capacityCommitmentDigest',
    'executionTargetRef',
    'policyDigest',
] as const;

export type ProviderAdmissionOperationPayload = {
    providerId: string;
    providerPubkey: string;
    capacityCommitmentDigest: string;
    executionTargetRef: string;
    policyDigest: string;
};

export type ProviderAdmissionStatePrecondition = {
    providerId: string;
    providerStatus: 'candidate';
    settlementState: 'not_admitted';
    mappingVersion: typeof STORAGE_FABRIC_PROVIDER_ADMISSION_MAPPING_VERSION;
};

export type ProviderAdmissionExternalCredentialSubmission = {
    schemaVersion: 'ExternalCredentialSubmission/v1';
    profileId: 'storage-fabric-provider-admission-route-a-v1';
    credentialJws: string;
    offlineVerificationBundle: Record<string, unknown>;
    governanceDecisionReceipt: Record<string, unknown>;
    operationPayload: Record<string, unknown>;
    operationPayloadDigest: string;
    statePrecondition: Record<string, unknown>;
    statePreconditionDigest: string;
};

export function canExportProviderAdmissionDecisionPackage(input: {
    canManage: boolean;
    actionType?: string | null;
    decision?: string | null;
}): boolean {
    return Boolean(
        input.canManage
        && input.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
        && input.decision === 'accepted',
    );
}

export type PublicSafeProviderAdmissionCandidate = {
    candidateRef: string;
    displayName: string;
    statusSummary: 'eligible' | 'ineligible' | 'retired' | 'already_admitted';
    capacitySummary: string;
    policySummary: string;
    snapshotVersion: string;
    snapshotDigest: string;
    expiresAt?: string;
};

export async function fetchProviderAdmissionCandidates(input: {
    circleId: number;
    cursor?: string;
    limit?: number;
    status?: PublicSafeProviderAdmissionCandidate['statusSummary'];
}): Promise<{
    candidatePickerEnabled: boolean;
    items: PublicSafeProviderAdmissionCandidate[];
    nextCursor: string | null;
}> {
    const route = await resolveNodeRoute('governance_execution');
    const params = new URLSearchParams();
    if (input.cursor) params.set('cursor', input.cursor);
    if (input.limit != null) params.set('limit', String(input.limit));
    if (input.status) params.set('status', input.status);
    const query = params.toString();
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/provider-admission/candidates${query ? `?${query}` : ''}`,
    );
}

export async function createGovernanceCaseIntake(input: {
    circleId: number;
    title: string;
    requestedDecision: string;
    caseType: GovernanceCaseType;
    templateId: string;
    actionType?: string | null;
    subjectType?:
        | 'circle'
        | 'circle_governance_binding'
        | 'communication_room_member'
        | 'feed_post'
        | 'governed_operator_capability'
        | 'external_provider'
        | 'external_app_circle_binding'
        | null;
    subjectRef?: string | null;
    requestedActionPayload?: Record<string, unknown> | null;
    statePrecondition?: Record<string, unknown> | null;
    candidateRef?: string | null;
    expectedSnapshotVersion?: string | null;
    expectedSnapshotDigest?: string | null;
    rationale?: string | null;
    decisionMechanismKind?: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding';
    quadraticVoiceChoices?: string[] | null;
    quadraticFundingRound?: {
        roundRef: string;
        budgetUnit: string;
        matchingBudget: number;
        commitmentCapPerActorPerProject: number;
        projects: Array<{ label: string; projectRef: string; recipientRef: string; allocationCap: number }>;
        excludedProjects: Array<{ projectRef: string; reason: string }>;
    } | null;
    selectionRanking?: {
        seatCount: number;
        candidates: Array<{ label: string; candidateRef: string; score: number }>;
        excludedCandidates: Array<{ candidateRef: string; reason: string }>;
    } | null;
    originKind: GovernanceCaseIntakeOriginKind;
    sourceMessageIds?: string[];
    sourceUrl?: string | null;
    relationshipKind?: 'related' | 'supersedes' | null;
    relatedCaseId?: string | null;
    relationshipReason?: string | null;
    idempotencyKey: string;
}): Promise<{ case: GovernanceCase; replayed: boolean }> {
    const route = await resolveNodeRoute('governance');
    const body: Record<string, unknown> = {
        title: input.title,
        requestedDecision: input.requestedDecision,
        caseType: input.caseType,
        templateId: input.templateId,
        actionType: input.actionType ?? null,
        decisionMechanismKind: input.decisionMechanismKind ?? 'equal_weight_threshold',
        quadraticVoiceChoices: input.quadraticVoiceChoices ?? null,
        quadraticFundingRound: input.quadraticFundingRound ?? null,
        selectionRanking: input.selectionRanking ?? null,
        originKind: input.originKind,
        sourceMessageIds: input.sourceMessageIds ?? [],
        sourceUrl: input.sourceUrl ?? null,
        relationshipKind: input.relationshipKind ?? null,
        relatedCaseId: input.relatedCaseId ?? null,
        relationshipReason: input.relationshipReason ?? null,
        idempotencyKey: input.idempotencyKey,
    };
    if (input.subjectType != null) body.subjectType = input.subjectType;
    if (input.subjectRef != null) body.subjectRef = input.subjectRef;
    if (input.requestedActionPayload != null) {
        body.requestedActionPayload = input.requestedActionPayload;
    }
    if (input.statePrecondition != null) body.statePrecondition = input.statePrecondition;
    if (input.candidateRef != null) body.candidateRef = input.candidateRef;
    if (input.expectedSnapshotVersion != null) {
        body.expectedSnapshotVersion = input.expectedSnapshotVersion;
    }
    if (input.expectedSnapshotDigest != null) {
        body.expectedSnapshotDigest = input.expectedSnapshotDigest;
    }
    if (input.rationale != null) body.rationale = input.rationale;
    const usesProviderAdmissionPicker = Boolean(
        input.actionType === 'storage_fabric.authorize_provider_admission'
        && input.candidateRef,
    );
    const createRoute = usesProviderAdmissionPicker
        ? await resolveNodeRoute('governance_execution')
        : route;
    const data = await authenticatedApiFetchJson(`${createRoute.urlBase}/api/v1/governance/circles/${input.circleId}/cases`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        },
    });
    return {
        case: normalizeGovernanceCase(data?.case),
        replayed: data?.replayed === true,
    };
}

export async function issueProviderAdmissionExternalCredential(
    caseId: string,
): Promise<ProviderAdmissionExternalCredentialSubmission> {
    const route = await resolveNodeRoute('governance_execution');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(caseId)}/external-credentials/provider-admission`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } },
    );
}

export async function readProviderAdmissionExternalCredential(
    caseId: string,
): Promise<ProviderAdmissionExternalCredentialSubmission> {
    const route = await resolveNodeRoute('governance_execution');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(caseId)}/external-credentials/provider-admission`,
    );
}

export async function preflightGovernanceCaseIntake(input: {
    circleId: number;
    title: string;
    originKind: GovernanceCaseIntakeOriginKind;
    sourceMessageIds?: string[];
    sourceUrl?: string | null;
}): Promise<GovernanceCaseIntakeSuggestion[]> {
    const route = await resolveNodeRoute('governance');
    const data = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/circles/${input.circleId}/cases/preflight`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: input.title,
                    originKind: input.originKind,
                    sourceMessageIds: input.sourceMessageIds ?? [],
                    sourceUrl: input.sourceUrl ?? null,
                }),
            },
        },
    );
    return Array.isArray(data?.suggestions)
        ? data.suggestions.map((value: any) => ({
            caseId: String(value?.caseId || ''),
            title: String(value?.title || ''),
            phase: normalizeGovernanceCasePhase(value?.phase),
            canonicalUrl: String(value?.canonicalUrl || ''),
            reasons: Array.isArray(value?.reasons) ? value.reasons : [],
            recommendedAction: value?.recommendedAction === 'merge'
                || value?.recommendedAction === 'supersedes'
                ? value.recommendedAction
                : 'related',
        })).filter((value: GovernanceCaseIntakeSuggestion) => Boolean(value.caseId))
        : [];
}

export async function changeGovernanceCaseResponsibility(input: {
    caseId: string;
    kind: GovernanceCaseResponsibilityKind;
    action: GovernanceCaseResponsibilityAction;
    targetPubkey?: string | null;
    reason?: string | null;
    deadlineAt?: string | null;
    idempotencyKey: string;
    expectedCaseVersion: number;
    expectedResponsibilityVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number; responsibility: GovernanceCaseResponsibility }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/responsibilities/${input.kind}/actions`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: input.action,
                    targetPubkey: input.targetPubkey ?? null,
                    reason: input.reason ?? null,
                    deadlineAt: input.deadlineAt ?? null,
                    idempotencyKey: input.idempotencyKey,
                    expectedCaseVersion: input.expectedCaseVersion,
                    expectedResponsibilityVersion: input.expectedResponsibilityVersion,
                }),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number; responsibility: GovernanceCaseResponsibility }>;
}

export async function submitGovernanceManualExecutionCompletion(input: {
    caseId: string;
    evidence: Array<{
        kind: 'external_receipt' | 'verification_record' | 'artifact';
        ref: string;
        digest: string;
    }>;
    idempotencyKey: string;
    expectedCaseVersion: number;
    expectedCompletionVersion?: number | null;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance_execution');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/manual-execution/completions`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function reviewGovernanceManualExecutionCompletion(input: {
    caseId: string;
    decision: 'approve' | 'reject';
    reason?: string | null;
    idempotencyKey: string;
    expectedCaseVersion: number;
    expectedCompletionVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance_execution');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/manual-execution/reviews`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function bindGovernanceCaseBriefClaimEvidence(input: {
    caseId: string;
    claimId: string;
    sourceMaterialId: number;
    sourceMaterialChunkId: number;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/brief-evidence-bindings`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function transitionGovernanceCase(input: {
    caseId: string;
    toPhase: 'proposal_drafting' | 'evidence_review' | 'closed';
    idempotencyKey: string;
    expectedCaseVersion: number;
    actualOutcome?: GovernanceCaseActualOutcomeInput;
}): Promise<{ replayed: boolean; phase: GovernanceCasePhase; caseVersion: number }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/transitions`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; phase: GovernanceCasePhase; caseVersion: number }>;
}

export async function recordGovernanceCaseReview(input: {
    caseId: string;
    conclusion: GovernanceCaseReviewConclusion;
    reason: string;
    publicBasis?: string | null;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/reviews`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function recordGovernanceCaseReviewRelationship(input: {
    caseId: string;
    actorRole: GovernanceCaseReviewRelationshipActorRole;
    relationship: GovernanceCaseReviewRelationship;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/review-relationships`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function openGovernanceCaseApprovalStage(input: {
    caseId: string;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number; requestId: string }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/approval-stage`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number; requestId: string }>;
}

export async function discloseGovernanceCaseApprovalConflict(input: {
    caseId: string;
    publicReason: GovernanceCaseConflictReason;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/approval-conflicts`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function discloseGovernanceGrantReviewerConflict(input: {
    caseId: string;
    artifactId: string;
    projectRef: string;
    publicReason: GovernanceCaseConflictReason;
    idempotencyKey: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; caseVersion: number }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-reviewer-conflicts`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; caseVersion: number }>;
}

export async function activateGovernanceGrantAgreement(input: {
    caseId: string;
    artifactId: string;
    projectRef: string;
    milestones: Array<{
        title: string;
        deliverable: string;
        evidenceRequirements: string[];
        deadline: string;
        contractualUnits: number;
        primaryReviewerPubkeys: string[];
        alternateReviewerPubkeys: string[];
        reviewerQuorum: number;
        acceptCriteria: string;
        reworkCriteria: string;
        rejectCriteria: string;
        maxRevisions: number;
    }>;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function refreshGovernanceGrantSettlementReadiness(input: {
    caseId: string;
    agreementId: string;
    expectedEvaluationVersion: number;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}`
        + `/grant-agreements/${encodeURIComponent(input.agreementId)}/settlement-readiness`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expectedEvaluationVersion: input.expectedEvaluationVersion,
                }),
            },
        },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function openGovernanceGrantPayoutRequest(input: {
    caseId: string;
    agreementId: string;
    trancheIntentId: string;
}): Promise<{
    status: 'requires_governance';
    actionType: 'circle.grant.payout.execute';
    payoutIntent: Record<string, unknown>;
    payerAuthorization: Record<string, unknown>;
    request: CircleGovernanceRequest;
}> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}`
        + `/grant-agreements/${encodeURIComponent(input.agreementId)}/payout-requests`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trancheIntentId: input.trancheIntentId }),
            },
        },
    ) as Promise<{
        status: 'requires_governance';
        actionType: 'circle.grant.payout.execute';
        payoutIntent: Record<string, unknown>;
        payerAuthorization: Record<string, unknown>;
        request: CircleGovernanceRequest;
    }>;
}

export async function recordGovernanceGrantMilestoneReview(input: {
    caseId: string;
    agreementId: string;
    milestoneId: string;
    outcome: 'accept' | 'rework' | 'reject';
    evidenceRefs: string[];
    summary: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/milestone-reviews`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function openGovernanceGrantMilestoneAppeal(input: {
    caseId: string;
    agreementId: string;
    milestoneId: string;
    originalResultDigest: string;
    reason: string;
    evidenceRefs: string[];
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/milestone-appeals`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function recordGovernanceGrantMilestoneAppealVote(input: {
    caseId: string;
    agreementId: string;
    appealId: string;
    vote: 'uphold' | 'overturn_accept';
    reason: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/milestone-appeal-votes`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function openGovernanceGrantAgreementAmendmentCase(input: {
    caseId: string;
    agreementId: string;
    proposedTerms: Record<string, unknown>;
    reason: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; case: GovernanceCase }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/amendment-cases`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; case: GovernanceCase }>;
}

export async function openGovernanceProviderExecutionTerminalAbandonmentCase(input: {
    caseId: string;
    reason: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; case: GovernanceCase }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/provider-execution/terminal-abandonment-cases`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; case: GovernanceCase }>;
}

export async function openGovernanceProviderExecutionCompensationPlanCase(input: {
    caseId: string;
    reason: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; case: GovernanceCase }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/provider-execution/compensation-plan-cases`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; case: GovernanceCase }>;
}

export async function retryGovernanceFundingAmendedExecution(input: {
    requestId: string;
    confirmation: 'retry_same_intent_with_accepted_funding_amendment';
}): Promise<{ requestId: string; execution: unknown }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/requests/${encodeURIComponent(input.requestId)}/execute`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmation: input.confirmation }),
            },
        },
    ) as Promise<{ requestId: string; execution: unknown }>;
}

export async function openGovernanceGrantAgreementTerminationCase(input: {
    caseId: string;
    agreementId: string;
    ground: 'milestone_rejected' | 'schedule_expired' | 'governing_decision_revoked';
    reason: string;
    retainedObligations: string[];
    outstandingObligations: string[];
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement; case: GovernanceCase }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/termination-cases`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement; case: GovernanceCase }>;
}

export async function applyAcceptedGovernanceGrantAgreementTermination(input: {
    caseId: string;
    agreementId: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/termination-applications`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function recordGovernanceGrantOutcome(input: {
    caseId: string;
    agreementId: string;
    status: 'fulfilled' | 'partially_fulfilled' | 'not_fulfilled' | 'terminated';
    summary: string;
    actualImpact: string[];
    outstandingObligations: string[];
    evidenceRefs: string[];
    observationStartedAt: string;
    observationEndedAt: string;
    idempotencyKey: string;
}): Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/grant-agreements/${encodeURIComponent(input.agreementId)}/outcomes`,
        { init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } },
    ) as Promise<{ replayed: boolean; agreement: GovernanceGrantAgreement }>;
}

export async function cancelGovernanceCaseApprovalStage(input: {
    caseId: string;
    expectedCaseVersion: number;
}): Promise<{ replayed: boolean; requestId: string; decision: unknown }> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/cases/${encodeURIComponent(input.caseId)}/approval-stage/cancel`,
        {
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input),
            },
        },
    ) as Promise<{ replayed: boolean; requestId: string; decision: unknown }>;
}

export interface GovernanceSignalChallengeV2 {
    envelope: {
        v: 2;
        domain: 'alcheme.governance.signal';
        network: 'solana:localnet' | 'solana:devnet';
        caseId: string | null;
        requestId: string;
        actor: string;
        signal: {
            kind: 'single_choice';
            choice: 'approve' | 'reject' | 'abstain';
        } | {
            kind: 'quadratic_voice_credits';
            choiceVector: Array<{ choiceId: string; votes: number }>;
            creditBudget: number;
            cost: number;
            mechanismContractDigest: string;
        } | {
            kind: 'quadratic_funding';
            commitments: Array<{ projectId: string; amount: number }>;
            budgetUnit: string;
            totalCommitment: number;
            mechanismContractDigest: string;
        };
        nonce: string;
        expiresAt: string;
        payloadDigest: string;
        policyDigest: string;
        snapshotDigest: string;
        executionMode: 'legacy_action_checkpoint' | 'stage_decision_only' | 'provider_bound_action' | null;
        caseRef: string | null;
        stageRef: string | null;
        compatibilityBundleVersion: string | null;
        executionModeDigest: string | null;
    };
    signedMessage: string;
    envelopeDigest: string;
}

export async function prepareGovernanceRequestSignal(input: {
    requestId: string;
    actorPubkey: string;
    value: 'approve' | 'reject' | 'abstain' | 'quadratic_voice_credits' | 'quadratic_funding';
    evidence?: Record<string, unknown> | null;
}): Promise<GovernanceSignalChallengeV2> {
    const route = await resolveNodeRoute('governance');
    return authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/requests/${encodeURIComponent(input.requestId)}/signals/prepare`, {
        init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                actorPubkey: input.actorPubkey,
                value: input.value,
                evidence: input.evidence ?? null,
            }),
        },
    });
}

export interface PendingGovernanceSignalChallenge {
    authority: 'server_owned_ttl_challenge';
    requestId: string;
    caseId: string | null;
    actorPubkey: string;
    submission: {
        value: 'approve' | 'reject' | 'abstain' | 'quadratic_voice_credits' | 'quadratic_funding';
        evidence: Record<string, unknown> | null;
    };
    challenge: GovernanceSignalChallengeV2;
    expiresAt: string;
}

export async function fetchPendingGovernanceRequestSignal(input: {
    requestId: string;
    actorPubkey: string;
}): Promise<PendingGovernanceSignalChallenge | null> {
    const route = await resolveNodeRoute('governance');
    const params = new URLSearchParams({ actorPubkey: input.actorPubkey });
    const response = await authenticatedApiFetchJson(
        `${route.urlBase}/api/v1/governance/requests/${encodeURIComponent(input.requestId)}/signals/pending?${params.toString()}`,
    ) as { pending?: PendingGovernanceSignalChallenge | null };
    return response.pending ?? null;
}

export async function submitGovernanceRequestSignal(input: {
    requestId: string;
    actorPubkey: string;
    value: 'approve' | 'reject' | 'abstain' | 'quadratic_voice_credits' | 'quadratic_funding';
    signature: string;
    signedMessage: string;
    nonce: string;
    expiresAt: string;
    evidence?: Record<string, unknown> | null;
}): Promise<{
    signal: unknown;
    decision: unknown | null;
}> {
    const route = await resolveNodeRoute('governance');
    const requestId = input.requestId;
    return authenticatedApiFetchJson(`${route.urlBase}/api/v1/governance/requests/${encodeURIComponent(requestId)}/signals`, {
        init: {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                actorPubkey: input.actorPubkey,
                value: input.value,
                signature: input.signature,
                signedMessage: input.signedMessage,
                nonce: input.nonce,
                expiresAt: input.expiresAt,
                evidence: input.evidence ?? null,
            }),
        },
    });
}

function normalizeCommitteeProfile(value: any, fallbackCircleId: number): CircleGovernanceCommitteeProfile {
    const thresholdMode = value?.electorateTemplate?.threshold?.mode;
    const normalizedThresholdMode = thresholdMode === 'fixed_count' || thresholdMode === 'unanimity'
        ? thresholdMode
        : 'default_majority';
    const fixedThreshold = Number(value?.electorateTemplate?.threshold?.value);
    const ballotDisclosureMode = normalizeGovernanceBallotDisclosureMode(
        value?.electorateTemplate?.ballotDisclosure?.mode,
    );
    const qvBudget = Number(value?.electorateTemplate?.quadraticVoiceCredits?.budgetPerActor);
    if (!ballotDisclosureMode) {
        throw new Error('invalid_committee_electorate_template');
    }
    return {
        circleId: Number(value?.circleId || fallbackCircleId),
        availabilityStatus: value?.availabilityStatus === 'enabled' ? 'enabled' : 'disabled',
        allowedActionPrefixes: Array.isArray(value?.allowedActionPrefixes)
            ? value.allowedActionPrefixes.map((item: unknown) => String(item || '').trim()).filter(Boolean)
            : null,
        defaultStrategy: String(value?.defaultStrategy || 'committee.member_threshold'),
        electorateTemplate: {
            source: 'active_committee_members',
            weight: { mode: 'equal_one' },
            threshold: {
                mode: normalizedThresholdMode,
                value: normalizedThresholdMode === 'fixed_count' && Number.isSafeInteger(fixedThreshold) && fixedThreshold > 0
                    ? fixedThreshold
                    : null,
            },
            ballotDisclosure: { mode: ballotDisclosureMode },
            quadraticVoiceCredits: {
                budgetPerActor: Number.isSafeInteger(qvBudget) && qvBudget > 0
                    ? qvBudget
                    : null,
            },
        },
        windowMinutes: Number.isFinite(Number(value?.windowMinutes))
            ? Number(value.windowMinutes)
            : null,
        updatedByPubkey: value?.updatedByPubkey ? String(value.updatedByPubkey) : null,
        availabilityOpenedAt: value?.availabilityOpenedAt ? String(value.availabilityOpenedAt) : null,
        availabilityExpiresAt: value?.availabilityExpiresAt ? String(value.availabilityExpiresAt) : null,
        lastMandateRequestId: value?.lastMandateRequestId ? String(value.lastMandateRequestId) : null,
        lastMandateRequestAt: value?.lastMandateRequestAt ? String(value.lastMandateRequestAt) : null,
        activatedAt: value?.activatedAt ? String(value.activatedAt) : null,
        deactivatedAt: value?.deactivatedAt ? String(value.deactivatedAt) : null,
    };
}

function normalizeBinding(value: any): CircleGovernanceBinding {
    return {
        id: String(value?.id || ''),
        bindingType: value?.bindingType === 'shared_committee'
            ? 'shared_committee'
            : value?.bindingType === 'self_governed'
                ? 'self_governed'
                : 'local_auxiliary',
        targetCircleId: Number(value?.targetCircleId || 0),
        actionType: value?.actionType ? String(value.actionType) : null,
        actionPrefix: value?.actionPrefix ? String(value.actionPrefix) : null,
        committeeCircleId: Number(value?.committeeCircleId || 0),
        policyId: String(value?.policyId || ''),
        policyVersionId: String(value?.policyVersionId || ''),
        policyVersion: Number(value?.policyVersion || 1),
        ruleId: String(value?.ruleId || ''),
        executionMode: String(value?.executionMode || 'off_chain'),
        status: normalizeBindingStatus(value?.status),
        targetAuthorizationStatus: normalizeMandateStatus(value?.targetAuthorizationStatus),
        committeeMandateStatus: normalizeMandateStatus(value?.committeeMandateStatus),
        committeeMandateRequestId: value?.committeeMandateRequestId ? String(value.committeeMandateRequestId) : null,
        mandateId: value?.mandateId ? String(value.mandateId) : null,
        mandate: value?.mandate ? normalizeGovernanceMandate(value.mandate) : null,
        authorityCanonicalState: normalizeAuthorityCanonicalState(value?.authorityCanonicalState),
        shadowComparedAt: value?.shadowComparedAt ? String(value.shadowComparedAt) : null,
        mandateCanonicalAt: value?.mandateCanonicalAt ? String(value.mandateCanonicalAt) : null,
        activatedAt: value?.activatedAt ? String(value.activatedAt) : null,
        supersededAt: value?.supersededAt ? String(value.supersededAt) : null,
        createdByPubkey: value?.createdByPubkey ? String(value.createdByPubkey) : null,
        sourceRequestId: value?.sourceRequestId ? String(value.sourceRequestId) : null,
        sourceDecisionDigest: value?.sourceDecisionDigest ? String(value.sourceDecisionDigest) : null,
        sourceExecutionReceiptId: value?.sourceExecutionReceiptId ? String(value.sourceExecutionReceiptId) : null,
        eligibleActorCount: Number.isFinite(Number(value?.eligibleActorCount))
            ? Number(value.eligibleActorCount)
            : null,
        authorityTransparency: normalizeGovernanceAuthorityTransparency(
            value?.authorityTransparency,
        ),
        metadata: value?.metadata && typeof value.metadata === 'object' && !Array.isArray(value.metadata)
            ? value.metadata
            : null,
    };
}

function normalizeGovernanceAuthorityTransparency(
    value: any,
): GovernanceAuthorityTransparency {
    const authorityMode = value?.authorityMode;
    const availability = value?.availability;
    const executionAuthority = value?.executionAuthority;
    const stageProvider = value?.stageProvider;
    const receipt = value?.receipt;
    if (value?.schemaVersion !== 1
        || !['delegated_auxiliary', 'delegated_committee', 'self_governed', 'unavailable'].includes(authorityMode)
        || !['verified', 'invalid'].includes(value?.integrity)
        || !['active', 'not_active', 'invalid'].includes(availability)
        || !validMandateRef(value?.delegator)
        || !validMandateRef(value?.delegate)
        || !validMandateRef(value?.subject)
        || !value?.scope || typeof value.scope !== 'object' || Array.isArray(value.scope)
        || !value?.mandate || typeof value.mandate !== 'object' || Array.isArray(value.mandate)
        || !value?.decisionAuthority || typeof value.decisionAuthority !== 'object'
        || Array.isArray(value.decisionAuthority)
        || !value?.operatorAuthority || typeof value.operatorAuthority !== 'object'
        || Array.isArray(value.operatorAuthority)
        || executionAuthority?.type !== 'action_contract'
        || !String(executionAuthority?.adapter || '').trim()
        || !['resolved_at_execution', 'operation_receipt'].includes(executionAuthority?.executor)
        || stageProvider?.authority !== 'separate'
        || stageProvider?.status !== 'not_projected_in_binding'
        || !['recorded', 'not_recorded'].includes(receipt?.status)
        || !['verified', 'purpose_mismatch'].includes(receipt?.integrity)) {
        throw new Error('invalid_governance_authority_transparency');
    }
    return {
        schemaVersion: 1,
        authorityMode,
        integrity: value.integrity,
        availability,
        delegator: { type: String(value.delegator.type), ref: String(value.delegator.ref) },
        delegate: { type: String(value.delegate.type), ref: String(value.delegate.ref) },
        subject: { type: String(value.subject.type), ref: String(value.subject.ref) },
        scope: {
            actionType: value.scope.actionType ? String(value.scope.actionType) : null,
            actionPrefix: value.scope.actionPrefix ? String(value.scope.actionPrefix) : null,
        },
        mandate: {
            purposes: Array.isArray(value.mandate.purposes)
                ? value.mandate.purposes.filter((purpose: unknown) => (
                    purpose === 'collective_decision' || purpose === 'operational_execution'
                ))
                : [],
            version: Number.isSafeInteger(Number(value.mandate.version))
                ? Number(value.mandate.version)
                : null,
        },
        decisionAuthority: value.decisionAuthority,
        operatorAuthority: value.operatorAuthority,
        executionAuthority: {
            type: 'action_contract',
            adapter: String(executionAuthority.adapter),
            executor: executionAuthority.executor,
            executionMode: String(executionAuthority.executionMode || 'off_chain'),
        },
        stageProvider: {
            authority: 'separate',
            status: 'not_projected_in_binding',
        },
        receipt: {
            status: receipt.status,
            integrity: receipt.integrity,
            executionStatus: receipt.executionStatus ? String(receipt.executionStatus) : null,
            ref: receipt.ref ? String(receipt.ref) : null,
            actor: receipt.actor ? String(receipt.actor) : null,
        },
    };
}

function normalizeUnboundAuthorityTransparency(
    value: any,
): NonNullable<CircleGovernanceBindingsPayload['fallback']>['authorityTransparency'] {
    if (value?.schemaVersion !== 1
        || value?.authorityMode !== 'action_registry_resolved'
        || value?.scope !== 'per_action_and_subject'
        || value?.roleDirect !== 'only_when_registered_action_allows_direct'
        || value?.highCriticalWithoutBinding !== 'fail_closed'
        || value?.decisionAuthority !== 'resolved_by_action_registry'
        || value?.operatorAuthority !== 'not_granted_by_absence_of_binding'
        || value?.executionAuthority !== 'resolved_at_execution'
        || value?.stageProvider?.authority !== 'separate'
        || value?.stageProvider?.status !== 'not_projected_in_binding') {
        throw new Error('invalid_unbound_governance_authority_transparency');
    }
    return value;
}

function normalizeAuthorityCanonicalState(
    value: unknown,
): CircleGovernanceBinding['authorityCanonicalState'] {
    return value === 'legacy_canonical'
        || value === 'shadow_compared'
        || value === 'mandate_canonical'
        || value === 'retired'
        ? value
        : null;
}

function normalizeGovernanceMandate(value: any): GovernanceMandateSummary {
    const status = ['offered', 'countered', 'active', 'rejected', 'expired', 'deactivated'].includes(String(value?.status))
        ? String(value.status) as GovernanceMandateSummary['status']
        : 'offered';
    return {
        id: String(value?.id || ''),
        delegatorGovernanceHome: normalizeMandateRef(value?.delegatorGovernanceHome),
        delegateAuthority: normalizeMandateRef(value?.delegateAuthority),
        subject: normalizeMandateRef(value?.subject ?? value?.terms?.subject),
        status,
        currentVersion: Math.max(1, Number(value?.currentVersion || 1)),
        currentTermsDigest: String(value?.currentTermsDigest || ''),
        purposeBindings: Array.isArray(value?.purposeBindings)
            ? value.purposeBindings.flatMap((binding: any) => {
                const purpose = binding?.purpose;
                if (purpose !== 'collective_decision' && purpose !== 'operational_execution') return [];
                return [{
                    purpose,
                    actionType: binding?.actionType || binding?.actionSelector?.actionType
                        ? String(binding.actionType ?? binding.actionSelector.actionType)
                        : null,
                    actionPrefix: binding?.actionPrefix || binding?.actionSelector?.actionPrefix
                        ? String(binding.actionPrefix ?? binding.actionSelector.actionPrefix)
                        : null,
                }];
            })
            : [],
        purposes: Array.isArray(value?.purposes)
            ? value.purposes.filter((purpose: unknown) => (
                purpose === 'collective_decision' || purpose === 'operational_execution'
            ))
            : Array.isArray(value?.purposeBindings)
                ? value.purposeBindings.map((binding: any) => binding?.purpose).filter((purpose: unknown) => (
                    purpose === 'collective_decision' || purpose === 'operational_execution'
                ))
                : [],
        environment: value?.environment ? String(value.environment) : value?.terms?.environment ? String(value.terms.environment) : null,
        network: value?.network ? String(value.network) : value?.terms?.network ? String(value.terms.network) : null,
        effectiveFrom: value?.effectiveFrom ? String(value.effectiveFrom) : value?.terms?.effectiveFrom ? String(value.terms.effectiveFrom) : null,
        effectiveUntil: value?.effectiveUntil ? String(value.effectiveUntil) : value?.terms?.effectiveUntil ? String(value.terms.effectiveUntil) : null,
        acceptanceExpiresAt: value?.acceptanceExpiresAt ? String(value.acceptanceExpiresAt) : null,
        minimumConstraints: normalizeGovernanceMandateMinimumConstraints(
            value?.minimumConstraints ?? value?.terms?.minimumConstraints,
        ),
        feePolicy: normalizeGovernanceMandateFeePolicy(value?.feePolicy ?? value?.terms?.feePolicy),
        effectPolicy: normalizeGovernanceMandateEffectPolicy(value?.effectPolicy ?? value?.terms?.effectPolicy),
        crossInstitutionDisclosureImpact: normalizeGovernanceCrossInstitutionDisclosureImpact(
            value?.crossInstitutionDisclosureImpact ?? value?.terms?.crossInstitutionDisclosureImpact,
        ),
        health: value?.health ? normalizeGovernanceMandateHealth(value.health) : null,
    };
}

function normalizeGovernanceCrossInstitutionDisclosureImpact(
    value: any,
): GovernanceCrossInstitutionDisclosureImpact | null {
    if (value == null) return null;
    const categories = new Set<GovernanceDisclosureDataCategory>([
        'redacted_allegation', 'subject_reference', 'evidence_digest', 'operation_status',
    ]);
    const roles = new Set(['Owner', 'Admin', 'Moderator', 'Member']);
    const purposes = new Set(['collective_review', 'operational_execution', 'appeal_review']);
    if (
        value?.schemaVersion !== 1
        || value?.homeVisibility !== 'secret'
        || !Array.isArray(value?.dataCategories)
        || value.dataCategories.length === 0
        || value.dataCategories.some((category: unknown) => !categories.has(category as GovernanceDisclosureDataCategory))
        || value?.recipientAuthority?.type !== 'circle_governance_committee'
        || !String(value?.recipientAuthority?.ref || '')
        || !Array.isArray(value?.recipientRoles)
        || value.recipientRoles.length === 0
        || value.recipientRoles.some((role: unknown) => !roles.has(String(role)))
        || !Number.isSafeInteger(value?.recipientCount)
        || value.recipientCount < 1
        || !Array.isArray(value?.recipientRegions)
        || value.recipientRegions.length === 0
        || value.recipientRegions.some((region: unknown) => !/^[A-Z]{2}$/.test(String(region)))
        || !Array.isArray(value?.purposes)
        || value.purposes.length === 0
        || value.purposes.some((purpose: unknown) => !purposes.has(String(purpose)))
        || !Number.isSafeInteger(value?.retention?.maximumDays)
        || value.retention.maximumDays < 1
        || value?.retention?.startsAt !== 'each_disclosure'
        || value?.secondaryUse !== 'prohibited'
        || value?.revocation !== 'stop_future_disclosure_preserve_authorized_history'
        || value?.memberNotice !== 'before_first_disclosure_and_on_terms_change'
    ) throw new Error('invalid_governance_mandate_disclosure_impact');
    return value as GovernanceCrossInstitutionDisclosureImpact;
}

function normalizeGovernanceMandateHealth(value: any): GovernanceMandateHealth {
    const statuses = new Set<GovernanceMandateHealth['status']>([
        'active', 'pending', 'suspended', 'inactive', 'unavailable',
    ]);
    const reasons = new Set<GovernanceMandateHealth['reason']>([
        'within_effective_window',
        'acceptance_pending',
        'authority_binding_not_active',
        'effective_window_not_started',
        'effective_window_ended',
        'mandate_terminal',
        'mandate_owner_facts_unavailable',
    ]);
    const observedAt = String(value?.observedAt || '');
    if (
        !statuses.has(value?.status)
        || !reasons.has(value?.reason)
        || !observedAt
        || Number.isNaN(new Date(observedAt).getTime())
    ) throw new Error('invalid_governance_mandate_health_contract');
    return {
        status: value.status,
        reason: value.reason,
        lifecycleStatus: value?.lifecycleStatus ? String(value.lifecycleStatus) : null,
        effectiveFrom: value?.effectiveFrom ? String(value.effectiveFrom) : null,
        effectiveUntil: value?.effectiveUntil ? String(value.effectiveUntil) : null,
        observedAt: new Date(observedAt).toISOString(),
    };
}

function normalizeGovernanceMandateFeePolicy(value: any): GovernanceMandateFeePolicy {
    if (!value || !['no_fee', 'capped_external_quote'].includes(value.mode)
        || !['delegator', 'delegate', 'shared'].includes(value.economicBearer)
        || value.settlement !== 'not_managed_by_mandate'
        || value.payerAuthority !== 'separate_from_governance_authority') {
        throw new Error('invalid_governance_mandate_fee_policy');
    }
    return {
        mode: value.mode,
        economicBearer: value.economicBearer,
        maximumAmountMinor: value.maximumAmountMinor == null ? null : String(value.maximumAmountMinor),
        unit: value.unit == null ? null : String(value.unit),
        settlement: 'not_managed_by_mandate',
        payerAuthority: 'separate_from_governance_authority',
    };
}

function normalizeGovernanceMandateEffectPolicy(value: any): GovernanceMandateEffectPolicy | null {
    if (value == null) return null;
    if (value.naturalExpiry !== 'expire_at_mandate_end'
        || value.revoke !== 'revoke_immediately'
        || value.transfer !== 'supersede_immediately'
        || value.appealSurvival !== 'survives_until_resolved'
        || !validMandateRef(value.fallbackAuthority)) {
        throw new Error('invalid_governance_mandate_effect_policy');
    }
    return {
        naturalExpiry: 'expire_at_mandate_end',
        revoke: value.revoke,
        transfer: value.transfer,
        appealSurvival: 'survives_until_resolved',
        fallbackAuthority: normalizeMandateRef(value.fallbackAuthority),
    };
}

function validMandateRef(value: any): boolean {
    return /^[a-z][a-z0-9_]{1,47}$/.test(String(value?.type ?? ''))
        && Boolean(String(value?.ref ?? '').trim())
        && String(value?.ref ?? '').length <= 128;
}

function normalizeMandateRef(value: any): { type: string; ref: string } {
    if (!validMandateRef(value)) throw new Error('invalid_governance_mandate_ref');
    return { type: String(value.type), ref: String(value.ref) };
}

function normalizeGovernanceMandateMinimumConstraints(
    value: any,
): GovernanceMandateMinimumConstraints | null {
    const riskFloor = String(value?.riskFloor ?? '');
    const minimumApprovalThreshold = Number(value?.minimumApprovalThreshold);
    const minimumTimelockSeconds = Number(value?.minimumTimelockSeconds);
    if (
        !['low', 'medium', 'high', 'critical'].includes(riskFloor)
        || !Number.isSafeInteger(minimumApprovalThreshold)
        || minimumApprovalThreshold <= 0
        || minimumApprovalThreshold > 10_000
        || !Number.isSafeInteger(minimumTimelockSeconds)
        || minimumTimelockSeconds < 0
        || minimumTimelockSeconds > 30 * 24 * 60 * 60
    ) return null;
    return {
        riskFloor: riskFloor as GovernanceMandateMinimumConstraints['riskFloor'],
        minimumApprovalThreshold,
        minimumTimelockSeconds,
    };
}

function normalizeRequest(value: any): CircleGovernanceRequest {
    const executionCompatibility = normalizeGovernanceExecutionCompatibility(
        value?.executionCompatibility,
    );
    return {
        id: String(value?.id || ''),
        policyId: String(value?.policyId || ''),
        policyVersionId: String(value?.policyVersionId || ''),
        policyVersion: Number(value?.policyVersion || 1),
        ruleId: String(value?.ruleId || ''),
        scopeType: String(value?.scopeType || ''),
        scopeRef: String(value?.scopeRef || ''),
        actionType: String(value?.actionType || ''),
        targetType: String(value?.targetType || ''),
        targetRef: String(value?.targetRef || ''),
        payload: value?.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
            ? value.payload
            : null,
        idempotencyKey: String(value?.idempotencyKey || ''),
        proposerPubkey: String(value?.proposerPubkey || ''),
        state: normalizeRequestState(value?.state),
        caseRef: value?.caseRef ? String(value.caseRef) : null,
        stageRef: value?.stageRef ? String(value.stageRef) : null,
        decisionStatus: normalizeDecisionStatus(value?.decisionStatus),
        executionStatus: normalizeExecutionStatus(value?.executionStatus),
        openedAt: value?.openedAt ? String(value.openedAt) : null,
        expiresAt: value?.expiresAt ? String(value.expiresAt) : null,
        resolvedAt: value?.resolvedAt ? String(value.resolvedAt) : null,
        snapshot: value?.snapshot ?? undefined,
        signals: Array.isArray(value?.signals) ? value.signals : undefined,
        decision: normalizeGovernanceRequestDecision(value?.decision),
        receipts: Array.isArray(value?.receipts) ? value.receipts : undefined,
        preExecutionCost: normalizeGovernancePreExecutionCost(value?.preExecutionCost),
        providerResourceExecutionAdmission:
            normalizeGovernanceProviderResourceExecutionAdmission(
                value?.providerResourceExecutionAdmission,
            ),
        providerExecution: normalizeGovernanceProviderExecutionReadback(value?.providerExecution),
        providerExecutionStatus: normalizeGovernancePublicProviderExecutionStatus(
            value?.providerExecutionStatus,
        ),
        providerExecutionReference: normalizeGovernanceProviderExecutionReference(
            value?.providerExecutionReference,
        ),
        executionCompatibility,
    };
}

function normalizeGovernancePreExecutionCost(
    value: any,
): NonNullable<CircleGovernanceRequest['preExecutionCost']> | null {
    if (value == null) return null;
    const state = value?.state === 'pending_rpc_quote' || value?.state === 'provider_in_progress'
        ? value.state
        : null;
    const status = value?.status === 'pending' || value?.status === 'ready'
        ? value.status
        : null;
    const payer = value?.payer;
    const feePayer = payer?.feePayer === 'policy_bound' || payer?.feePayer === 'not_configured'
        ? payer.feePayer
        : null;
    const sponsor = payer?.sponsor === 'relayer_configured' || payer?.sponsor === 'not_configured'
        ? payer.sponsor
        : null;
    const rentFunding = payer?.rentFunding === 'policy_bound'
        || payer?.rentFunding === 'not_configured'
        ? payer.rentFunding
        : null;
    const refundRecipient = payer?.refundRecipient === 'policy_bound'
        || payer?.refundRecipient === 'not_configured'
        ? payer.refundRecipient
        : null;
    if (
        value?.schemaVersion !== 1
        || !state
        || !status
        || !String(value?.preflightId ?? '').trim()
        || !String(payer?.policyId ?? '').trim()
        || !String(payer?.network ?? '').trim()
        || !String(payer?.economicBearer ?? '').trim()
        || !feePayer
        || !sponsor
        || !rentFunding
        || !refundRecipient
        || value?.limits?.unit !== 'lamports'
        || !/^\d+$/.test(String(value?.limits?.singleTransaction ?? ''))
        || !/^\d+$/.test(String(value?.limits?.total ?? ''))
        || !String(value?.provider?.chainId ?? '').trim()
        || value.provider.chainId !== payer.network
        || !String(value?.provider?.profileRef ?? '').trim()
        || !Number.isSafeInteger(value?.provider?.profileVersion)
        || !String(value?.provider?.resourceBindingId ?? '').trim()
        || value?.estimate !== 'pending_provider_rpc_quote'
        || value?.rent !== 'pending_provider_quote'
        || value?.refund !== 'pending_terminal_reconciliation'
    ) return null;
    return {
        schemaVersion: 1,
        state,
        preflightId: String(value.preflightId),
        status,
        checkedAt: value?.checkedAt ? String(value.checkedAt) : null,
        expiresAt: value?.expiresAt ? String(value.expiresAt) : null,
        payer: {
            policyId: String(payer.policyId),
            network: String(payer.network),
            economicBearer: String(payer.economicBearer),
            feePayer,
            sponsor,
            rentFunding,
            refundRecipient,
        },
        limits: {
            unit: 'lamports',
            singleTransaction: String(value.limits.singleTransaction),
            total: String(value.limits.total),
        },
        provider: {
            chainId: String(value.provider.chainId),
            profileRef: String(value.provider.profileRef),
            profileVersion: Number(value.provider.profileVersion),
            resourceBindingId: String(value.provider.resourceBindingId),
        },
        estimate: 'pending_provider_rpc_quote',
        rent: 'pending_provider_quote',
        refund: 'pending_terminal_reconciliation',
        executionProgress: normalizeGovernanceProviderExecutionProgress(
            value?.executionProgress,
        ),
        automaticExecutionAvailability: normalizeGovernanceAutomaticExecutionAvailability(
            value?.automaticExecutionAvailability,
        ),
        executionPreview: normalizeGovernanceProviderExecutionPreview(
            value?.executionPreview,
        ),
        executionAuthorityPreflight:
            normalizeGovernanceProviderExecutionAuthorityPreflight(
                value?.executionAuthorityPreflight,
            ),
    };
}

function normalizeGovernanceProviderExecutionProgress(
    value: any,
): GovernanceProviderExecutionProgressReadback | null {
    if (value == null) return null;
    const completed = Array.isArray(value?.completed) ? value.completed : [];
    const remaining = Array.isArray(value?.remaining) ? value.remaining : [];
    const activeStatus = value?.active?.status;
    const compensationRequired = value?.compensation?.state === 'compensation_required';
    const compensationOwner = value?.compensation?.owner;
    const resolutionPolicy = value?.resolutionPolicy;
    const outcome = value?.outcome;
    const expectedAcceptedResolution = compensationRequired
        ? 'terminate_remaining_and_compensate'
        : null;
    const expectedFollowUpCaseId = compensationRequired
        ? String(compensationOwner?.caseId ?? '')
        : null;
    const validResolutionPolicy = resolutionPolicy?.authority === 'original_decision_authority_or_frozen_contingency_rule'
        && resolutionPolicy?.deterministicResume?.mode === 'same_artifact_next_ordered_step'
        && resolutionPolicy?.deterministicResume?.originalArtifactRequired === true
        && resolutionPolicy?.deterministicResume?.sameRequestOnly === true
        && resolutionPolicy?.choices?.replan === 'requires_original_decision_authority_case'
        && resolutionPolicy?.choices?.acceptPartial === 'requires_original_decision_authority_case'
        && resolutionPolicy?.choices?.compensate === 'requires_original_decision_authority_case'
        && resolutionPolicy?.choices?.terminateRemaining === 'requires_original_decision_authority_case'
        && resolutionPolicy?.emergencyActorPermanentDeviationAllowed === false;
    const validOutcome = outcome?.authority === 'canonical_provider_checkpoint_and_terminal_resolution_case'
        && Array.isArray(outcome?.realizedActionIds)
        && outcome.realizedActionIds.length === completed.length
        && outcome.realizedActionIds.every((stepId: unknown) => String(stepId ?? '').trim())
        && Array.isArray(outcome?.unrealizedActionIds)
        && outcome.unrealizedActionIds.length === remaining.length
        && outcome.unrealizedActionIds.every((stepId: unknown) => String(stepId ?? '').trim())
        && Array.isArray(outcome?.irreversibleImpacts)
        && outcome.irreversibleImpacts.length === completed.length
        && outcome.irreversibleImpacts.every((impact: unknown) => String(impact ?? '').trim())
        && Array.isArray(outcome?.remainingObligations)
        && outcome.remainingObligations.length > 0
        && outcome.remainingObligations.every((obligation: unknown) => String(obligation ?? '').trim())
        && outcome?.acceptedResolution === expectedAcceptedResolution
        && outcome?.followUpCaseId === expectedFollowUpCaseId
        && outcome?.publicRecord?.originalDecisionFullyExecuted === false
        && outcome?.publicRecord?.displayedExecutionState === 'partially_executed_not_originally_executed'
        && outcome?.publicRecord?.acceptPartialShownAsExecuted === false;
    const validCompensation = compensationRequired
        ? compensationOwner?.authority === 'terminal_abandonment_case_execution_responsibility'
            && Boolean(String(compensationOwner?.caseId ?? '').trim())
            && Boolean(String(compensationOwner?.pubkey ?? '').trim())
            && Number.isSafeInteger(Number(compensationOwner?.responsibilityVersion))
            && Number(compensationOwner.responsibilityVersion) > 0
            && ['assigned', 'accepted'].includes(compensationOwner?.status)
            && (compensationOwner?.deadlineAt == null
                || !Number.isNaN(Date.parse(String(compensationOwner.deadlineAt))))
            && isSha256Digest(String(value?.compensation?.governingDecisionDigest ?? ''))
            && value?.nextGate === 'separate_governed_compensation_execution'
        : value?.compensation?.state === 'not_required_without_terminal_abandonment_decision'
            && compensationOwner === 'unavailable_requires_governed_assignment'
            && ['authoritative_provider_finality_readback', 'continue_next_ordered_provider_step']
                .includes(value?.nextGate);
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_cost_preflight_provider_checkpoint'
        || value?.state !== 'partially_executed'
        || value?.aggregateRule !== 'executed_only_when_all_ordered_steps_authoritatively_finalized'
        || completed.length === 0
        || remaining.length === 0
        || completed.some((step: any) => (
            !String(step?.stepId ?? '').trim()
            || !String(step?.expectedStateChange ?? '').trim()
            || step?.finality !== 'finalized'
            || step?.actionReceipt?.authority
                !== 'canonical_provider_checkpoint_finalized_transaction'
            || !String(step?.actionReceipt?.providerReference ?? '').trim()
            || !Number.isSafeInteger(Number(step?.actionReceipt?.observedSlot))
            || Number(step.actionReceipt.observedSlot) <= 0
            || !isSha256Digest(String(step?.actionReceipt?.messageDigest ?? ''))
            || !isSha256Digest(String(step?.actionReceipt?.manifestDigest ?? ''))
            || step?.irreversibleChange
                !== 'provider_state_change_finalized_requires_governed_compensation_if_abandoned'
        ))
        || remaining.some((stepId: unknown) => !String(stepId ?? '').trim())
        || (value?.active !== null && (
            !String(value?.active?.stepId ?? '').trim()
            || !['quoted', 'signed', 'submitted', 'confirmed'].includes(activeStatus)
        ))
        || !Number.isSafeInteger(Number(value?.expiredAttemptCount))
        || Number(value.expiredAttemptCount) < 0
        || !validCompensation
        || !validResolutionPolicy
        || !validOutcome
        || value?.compensation?.directOperatorMutationAllowed !== false
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_cost_preflight_provider_checkpoint',
        state: 'partially_executed',
        aggregateRule: 'executed_only_when_all_ordered_steps_authoritatively_finalized',
        completed: completed.map((step: any) => ({
            stepId: String(step.stepId),
            expectedStateChange: String(step.expectedStateChange),
            finality: 'finalized',
            actionReceipt: {
                authority: 'canonical_provider_checkpoint_finalized_transaction',
                providerReference: String(step.actionReceipt.providerReference),
                observedSlot: Number(step.actionReceipt.observedSlot),
                messageDigest: String(step.actionReceipt.messageDigest),
                manifestDigest: String(step.actionReceipt.manifestDigest),
            },
            irreversibleChange: 'provider_state_change_finalized_requires_governed_compensation_if_abandoned',
        })),
        remaining: remaining.map(String),
        active: value.active === null ? null : {
            stepId: String(value.active.stepId),
            status: activeStatus as 'quoted' | 'signed' | 'submitted' | 'confirmed',
        },
        expiredAttemptCount: Number(value.expiredAttemptCount),
        compensation: compensationRequired ? {
            state: 'compensation_required',
            owner: {
                authority: 'terminal_abandonment_case_execution_responsibility',
                caseId: String(compensationOwner.caseId),
                pubkey: String(compensationOwner.pubkey),
                responsibilityVersion: Number(compensationOwner.responsibilityVersion),
                status: compensationOwner.status as 'assigned' | 'accepted',
                deadlineAt: compensationOwner.deadlineAt == null
                    ? null
                    : String(compensationOwner.deadlineAt),
            },
            directOperatorMutationAllowed: false,
            governingDecisionDigest: String(value.compensation.governingDecisionDigest),
        } : {
            state: 'not_required_without_terminal_abandonment_decision',
            owner: 'unavailable_requires_governed_assignment',
            directOperatorMutationAllowed: false,
        },
        resolutionPolicy: {
            authority: 'original_decision_authority_or_frozen_contingency_rule',
            deterministicResume: {
                mode: 'same_artifact_next_ordered_step',
                originalArtifactRequired: true,
                sameRequestOnly: true,
            },
            choices: {
                replan: 'requires_original_decision_authority_case',
                acceptPartial: 'requires_original_decision_authority_case',
                compensate: 'requires_original_decision_authority_case',
                terminateRemaining: 'requires_original_decision_authority_case',
            },
            emergencyActorPermanentDeviationAllowed: false,
        },
        outcome: {
            authority: 'canonical_provider_checkpoint_and_terminal_resolution_case',
            realizedActionIds: outcome.realizedActionIds.map(String),
            unrealizedActionIds: outcome.unrealizedActionIds.map(String),
            irreversibleImpacts: outcome.irreversibleImpacts.map(String),
            remainingObligations: outcome.remainingObligations.map(String),
            acceptedResolution: expectedAcceptedResolution,
            followUpCaseId: expectedFollowUpCaseId,
            publicRecord: {
                originalDecisionFullyExecuted: false,
                displayedExecutionState: 'partially_executed_not_originally_executed',
                acceptPartialShownAsExecuted: false,
            },
        },
        nextGate: value.nextGate as GovernanceProviderExecutionProgressReadback['nextGate'],
    };
}

function normalizeGovernanceAutomaticExecutionAvailability(
    value: any,
): GovernanceAutomaticExecutionAvailabilityReadback | null {
    if (value == null) return null;
    const state = value?.state === 'ready' || value?.state === 'blocked' ? value.state : null;
    const readinessState = value?.readinessState === 'ready'
        || value?.readinessState === 'setup_required'
        || value?.readinessState === 'degraded'
        || value?.readinessState === 'unavailable'
        ? value.readinessState
        : null;
    const riskMaturity = value?.riskMaturity === 'stable' || value?.riskMaturity === 'experimental'
        ? value.riskMaturity
        : null;
    const providerModule = value?.providerModule === 'realms_provider_binding'
        || value?.providerModule === 'squads_provider_binding'
        ? value.providerModule
        : null;
    const mode = value?.mode === 'provider_onchain' || value?.mode === 'multisig_threshold'
        ? value.mode
        : null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_preflight_provider_readiness'
        || !state
        || !readinessState
        || !riskMaturity
        || !providerModule
        || !mode
        || !Array.isArray(value?.stageGate?.missingReadiness)
        || value.stageGate.missingReadiness.some((blocker: unknown) => !String(blocker ?? '').trim())
        || !['allowed', 'blocked'].includes(value?.stageGate?.openStage)
        || !['allowed', 'blocked'].includes(value?.stageGate?.execute)
        || !['not_required', 'required'].includes(value?.stageGate?.riskConfirmation)
        || value?.stageGate?.riskDoesNotOverrideReadiness !== true
        || typeof value?.stageGate?.enforcementReady !== 'boolean'
        || typeof value?.stageGate?.finalityReadbackConfigured !== 'boolean'
        || (providerModule === 'realms_provider_binding' && mode !== 'provider_onchain')
        || (providerModule === 'squads_provider_binding' && mode !== 'multisig_threshold')
        || !String(value?.decisionLinkage?.requestId ?? '').trim()
        || !isSha256Digest(String(value?.decisionLinkage?.decisionDigest ?? ''))
        || value?.checks?.acceptedDecision !== true
        || typeof value?.checks?.currentTrustProfile !== 'boolean'
        || typeof value?.checks?.activeExactResource !== 'boolean'
        || typeof value?.checks?.activeExactAuthority !== 'boolean'
        || typeof value?.checks?.activeExactPayer !== 'boolean'
        || typeof value?.checks?.simulationCheckpoint !== 'boolean'
        || value?.checks?.instructionManifest !== 'verified_adapter_manifest_only'
        || value?.checks?.opaqueInstructionsAllowed !== false
        || !Array.isArray(value?.allowedOperations)
        || value.allowedOperations.some((operation: unknown) => !String(operation ?? '').trim())
        || !Array.isArray(value?.blockers)
        || value.blockers.some((blocker: unknown) => !String(blocker ?? '').trim())
        || value?.providerAutomatic !== state
        || value?.walletManual !== 'blocked_requires_explicit_wallet_confirmation'
        || value?.advisoryOnly !== 'blocked_no_signed_transaction_generation'
        || value?.completionClaimAllowed !== false
        || ![
            'provider_attempt_and_authoritative_readback',
            'repair_existing_readiness_facts_without_authority_or_payer_substitution',
        ].includes(value?.nextGate)
        || (state === 'ready' && value.blockers.length !== 0)
        || (state === 'blocked' && value.blockers.length === 0)
        || (readinessState === 'ready' && state !== 'ready')
        || (readinessState !== 'ready' && (
            value.stageGate.openStage !== 'blocked'
            || value.stageGate.execute !== 'blocked'
        ))
        || (readinessState === 'ready' && (
            value.stageGate.openStage !== 'allowed'
            || value.stageGate.execute !== 'allowed'
        ))
        || (riskMaturity === 'experimental' && value.stageGate.riskConfirmation !== 'required')
        || (riskMaturity === 'stable' && value.stageGate.riskConfirmation !== 'not_required')
        || value.stageGate.missingReadiness.join('\u0000') !== value.blockers.map(String).join('\u0000')
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_preflight_provider_readiness',
        state,
        readinessState,
        riskMaturity,
        stageGate: {
            openStage: value.stageGate.openStage,
            execute: value.stageGate.execute,
            riskConfirmation: value.stageGate.riskConfirmation,
            riskDoesNotOverrideReadiness: true,
            missingReadiness: value.stageGate.missingReadiness.map(String),
            enforcementReady: value.stageGate.enforcementReady,
            finalityReadbackConfigured: value.stageGate.finalityReadbackConfigured,
        },
        providerModule,
        mode,
        decisionLinkage: {
            requestId: String(value.decisionLinkage.requestId),
            decisionDigest: String(value.decisionLinkage.decisionDigest),
        },
        checks: {
            acceptedDecision: true,
            currentTrustProfile: value.checks.currentTrustProfile,
            activeExactResource: value.checks.activeExactResource,
            activeExactAuthority: value.checks.activeExactAuthority,
            activeExactPayer: value.checks.activeExactPayer,
            simulationCheckpoint: value.checks.simulationCheckpoint,
            instructionManifest: 'verified_adapter_manifest_only',
            opaqueInstructionsAllowed: false,
        },
        allowedOperations: value.allowedOperations.map(String),
        blockers: value.blockers.map(String),
        providerAutomatic: state,
        walletManual: 'blocked_requires_explicit_wallet_confirmation',
        advisoryOnly: 'blocked_no_signed_transaction_generation',
        completionClaimAllowed: false,
        nextGate: value.nextGate,
    };
}

function normalizeGovernanceProviderExecutionPreview(
    value: any,
): GovernanceProviderExecutionPreviewReadback | null {
    if (value == null) return null;
    const accounts = Array.isArray(value?.instruction?.accountScope)
        ? value.instruction.accountScope
        : [];
    const programs = Array.isArray(value?.instruction?.programIds)
        ? value.instruction.programIds
        : [];
    const stepId = value?.instruction?.stepId;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_cost_preflight_pre_sign_state_and_active_binding'
        || value?.state !== 'ready_to_sign'
        || value?.provider !== 'realms_provider_binding'
        || value?.network !== 'solana:devnet'
        || value?.enforcementMode !== 'provider_onchain'
        || !String(value?.decisionLinkage?.requestId ?? '').trim()
        || !isSha256Digest(String(value?.decisionLinkage?.decisionDigest ?? ''))
        || !isSha256Digest(String(value?.decisionLinkage?.actionIntentDigest ?? ''))
        || !String(value?.resource?.bindingId ?? '').trim()
        || !String(value?.resource?.resourceRef ?? '').trim()
        || !String(value?.resource?.ownerProgramRef ?? '').trim()
        || !Number.isSafeInteger(value?.resource?.observedSlot)
        || value.resource.observedSlot <= 0
        || !isSha256Digest(String(value?.resource?.stateDigest ?? ''))
        || value?.signingAuthority?.role !== 'voter'
        || !String(value?.signingAuthority?.publicAuthority ?? '').trim()
        || !String(value?.signingAuthority?.custodyProvider ?? '').trim()
        || value?.signingAuthority?.keyRefExposed !== false
        || value?.signingAuthority?.assignmentGrantsAuthority !== false
        || !String(value?.feePayer?.policyId ?? '').trim()
        || value?.feePayer?.role !== 'separated_fee_payer_policy'
        || !String(value?.feePayer?.economicBearer ?? '').trim()
        || value?.feePayer?.signerRefExposed !== false
        || value?.estimate?.unit !== 'lamports'
        || !Number.isSafeInteger(value?.estimate?.quotedFee)
        || value.estimate.quotedFee < 0
        || !Number.isSafeInteger(value?.estimate?.authorizedCeiling)
        || value.estimate.authorizedCeiling < value.estimate.quotedFee
        || !/^\d+$/.test(String(value?.estimate?.totalLimit ?? ''))
        || !['set_governance_delegate', 'revoke_governance_delegate'].includes(stepId)
        || !String(value?.instruction?.summary ?? '').trim()
        || programs.length !== 1
        || programs[0] !== value.resource.ownerProgramRef
        || accounts.length !== 6
        || accounts.some((account: any) => (
            !String(account?.role ?? '').trim() || !String(account?.ref ?? '').trim()
        ))
        || value?.instruction?.assetChange !== 'none_no_real_assets'
        || value?.instruction?.simulation !== 'passed'
        || value?.instruction?.opaqueInstructions !== false
        || value?.instruction?.rawInstructionExposed !== false
        || !isSha256Digest(String(value?.instruction?.manifestDigest ?? ''))
        || !isSha256Digest(String(value?.instruction?.messageDigest ?? ''))
        || !String(value?.instruction?.recentBlockhash ?? '').trim()
        || !Number.isSafeInteger(value?.instruction?.lastValidBlockHeight)
        || value.instruction.lastValidBlockHeight <= 0
        || value?.bypassRisk?.known
            !== 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
        || value?.bypassRisk?.prevented !== false
        || value?.nextGate !== 'provider_custody_sign_then_authoritative_finality_readback'
    ) return null;
    return value as GovernanceProviderExecutionPreviewReadback;
}

function normalizeGovernanceProviderExecutionAuthorityPreflight(
    value: any,
): GovernanceProviderExecutionAuthorityPreflightReadback | null {
    if (value == null) return null;
    const frozen = value?.frozenAuthority;
    const mandate = value?.mandate;
    const decision = value?.governedDecision;
    const enforcement = value?.executionEnforcementBinding;
    const live = value?.liveExecutionAuthority;
    const freeze = value?.emergencyFreeze;
    const checks = value?.checks;
    const validFrom = Date.parse(String(frozen?.validFrom ?? ''));
    const validUntil = Date.parse(String(frozen?.validUntil ?? ''));
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'invocation_snapshot_mandate_artifact_and_live_provider_readback'
        || value?.state !== 'ready'
        || value?.executionAllowed !== true
        || !String(frozen?.invocationId ?? '').trim()
        || !String(frozen?.snapshotId ?? '').trim()
        || !isSha256Digest(String(frozen?.snapshotDigest ?? ''))
        || !String(frozen?.bindingId ?? '').trim()
        || !isSha256Digest(String(frozen?.capabilityDigest ?? ''))
        || !Number.isFinite(validFrom)
        || !Number.isFinite(validUntil)
        || validUntil <= validFrom
        || !String(mandate?.id ?? '').trim()
        || !Number.isSafeInteger(mandate?.version)
        || mandate.version <= 0
        || !isSha256Digest(String(mandate?.termsDigest ?? ''))
        || mandate?.sourceVersion !== `v${mandate.version}:${mandate.termsDigest.slice(0, 48)}`
        || !String(mandate?.purpose ?? '').trim()
        || !String(decision?.requestId ?? '').trim()
        || !isSha256Digest(String(decision?.decisionDigest ?? ''))
        || !String(decision?.artifactId ?? '').trim()
        || !isSha256Digest(String(decision?.artifactDigest ?? ''))
        || !String(decision?.actionType ?? '').trim()
        || !String(decision?.subject?.type ?? '').trim()
        || !String(decision?.subject?.ref ?? '').trim()
        || !String(decision?.resourceBindingId ?? '').trim()
        || enforcement?.resourceBindingId !== decision?.resourceBindingId
        || !isSha256Digest(String(enforcement?.authorityScopeDigest ?? ''))
        || !Array.isArray(enforcement?.authorityBindingIds)
        || enforcement.authorityBindingIds.some((bindingId: unknown) => (
            !String(bindingId ?? '').trim()
        ))
        || enforcement?.providerModule !== 'realms_provider_binding'
        || enforcement?.mode !== 'provider_onchain'
        || enforcement?.allowedAdapter !== 'realms_provider_binding'
        || !Array.isArray(enforcement?.allowedOperations)
        || enforcement.allowedOperations.length === 0
        || new Set(enforcement.allowedOperations).size !== enforcement.allowedOperations.length
        || enforcement.allowedOperations.some((operation: unknown) => (
            !String(operation ?? '').trim()
        ))
        || !enforcement.allowedOperations.includes(decision.actionType)
        || enforcement?.residualBypassRisk
            !== 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
        || enforcement?.bypassPrevented !== false
        || enforcement?.verificationState !== 'verified_live'
        || !Number.isSafeInteger(enforcement?.contractVersion)
        || enforcement.contractVersion <= 0
        || !Number.isSafeInteger(enforcement?.profileVersion)
        || enforcement.profileVersion <= 0
        || live?.resolver !== 'canonical_resource_authority_and_pre_sign_provider_state_readback'
        || live?.provider !== 'realms_provider_binding'
        || !Number.isSafeInteger(live?.observedSlot)
        || live.observedSlot <= 0
        || !isSha256Digest(String(live?.providerStateDigest ?? ''))
        || !isSha256Digest(String(live?.canonicalBindingStateDigest ?? ''))
        || !Number.isSafeInteger(live?.controllingAuthorityCount)
        || live.controllingAuthorityCount <= 0
        || live?.result !== 'verified'
        || freeze?.source !== 'p05_authority_health_runtime'
        || freeze?.observed !== 'clear_fresh_p05_authority_health'
        || freeze?.state !== 'verified_clear'
        || freeze?.executionAllowed !== true
        || checks?.resolvedActionAuthoritySnapshot !== true
        || checks?.mandate !== true
        || checks?.decisionAndArtifactDigest !== true
        || checks?.actionAndSubjectScope !== true
        || checks?.liveExecutionAuthority !== true
        || checks?.emergencyFreeze !== true
        || value?.nextGate !== 'provider_custody_sign_then_authoritative_finality_readback'
    ) return null;
    return value as GovernanceProviderExecutionAuthorityPreflightReadback;
}

function normalizeGovernanceProviderResourceExecutionAdmission(
    value: any,
): GovernanceProviderResourceExecutionAdmissionReadback | null {
    if (value == null) return null;
    const binding = value?.binding;
    const artifactMapping = value?.artifactMapping;
    const enforcement = artifactMapping?.enforcementBinding;
    const authorities = Array.isArray(value?.controllingAuthorities)
        ? value.controllingAuthorities
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_governed_resource_and_active_authority_bindings'
        || value?.state !== 'admitted_for_exact_provider_execution'
        || value?.source !== 'explicit_request_preflight_or_terminal_receipt_resource_id'
        || value?.titleInferenceAllowed !== false
        || !String(value?.requestId ?? '').trim()
        || !isSha256Digest(String(value?.decisionDigest ?? ''))
        || !String(binding?.id ?? '').trim()
        || !String(binding?.cluster ?? '').trim()
        || !String(binding?.provider ?? '').trim()
        || !['realms_provider_binding', 'squads_provider_binding'].includes(
            binding?.providerModule,
        )
        || !String(binding?.capability ?? '').trim()
        || !String(binding?.resourceType ?? '').trim()
        || !String(binding?.resourceRef ?? '').trim()
        || !String(binding?.ownerProgramRef ?? '').trim()
        || !String(binding?.purpose ?? '').trim()
        || !String(binding?.profileRef ?? '').trim()
        || !Number.isSafeInteger(binding?.profileVersion)
        || binding.profileVersion <= 0
        || !Number.isSafeInteger(binding?.verifiedSlot)
        || binding.verifiedSlot <= 0
        || !isSha256Digest(String(binding?.stateDigest ?? ''))
        || binding?.status !== 'active'
        || authorities.length === 0
        || authorities.some((authority: any) => (
            !String(authority?.bindingId ?? '').trim()
            || !String(authority?.role ?? '').trim()
            || !String(authority?.publicAuthority ?? '').trim()
            || !String(authority?.custodyProvider ?? '').trim()
            || !String(authority?.custodyStatus ?? '').trim()
            || !Array.isArray(authority?.allowedOperations)
            || authority.allowedOperations.length === 0
            || authority.allowedOperations.some((operation: unknown) => (
                !String(operation ?? '').trim()
            ))
            || authority?.keyRefExposed !== false
        ))
        || (artifactMapping !== null && (
            !String(artifactMapping?.artifactId ?? '').trim()
            || !isSha256Digest(String(artifactMapping?.artifactDigest ?? ''))
            || artifactMapping?.decisionDigest !== value.decisionDigest
            || artifactMapping?.resourceBindingId !== binding.id
            || artifactMapping?.source !== 'exact_accepted_request_payload'
            || artifactMapping?.titleInferenceAllowed !== false
            || artifactMapping?.adapterRef !== binding.providerModule
            || enforcement?.resourceBindingId !== binding.id
            || !isSha256Digest(String(enforcement?.authorityScopeDigest ?? ''))
            || !Array.isArray(enforcement?.authorityBindingIds)
            || enforcement.authorityBindingIds.some((bindingId: unknown) => (
                !String(bindingId ?? '').trim()
            ))
            || enforcement?.providerModule !== binding.providerModule
            || enforcement?.allowedAdapter !== binding.providerModule
            || enforcement?.mode !== (binding.providerModule === 'squads_provider_binding'
                ? 'multisig_threshold'
                : 'provider_onchain')
            || !Array.isArray(enforcement?.allowedOperations)
            || enforcement.allowedOperations.length === 0
            || new Set(enforcement.allowedOperations).size !== enforcement.allowedOperations.length
            || enforcement.allowedOperations.some((operation: unknown) => (
                !String(operation ?? '').trim()
            ))
            || !String(enforcement?.residualBypassRisk ?? '').trim()
            || enforcement?.bypassPrevented !== false
            || enforcement?.verificationState !== 'frozen_pending_live_preflight'
            || !Number.isSafeInteger(enforcement?.contractVersion)
            || enforcement.contractVersion <= 0
            || enforcement?.profileVersion !== binding.profileVersion
        ))
        || value?.executionAdmission?.exactResourceActive !== true
        || value?.executionAdmission?.exactOwnerProgramVerified !== true
        || value?.executionAdmission?.controllingAuthorityActive !== true
        || value?.executionAdmission?.providerStateReadbackVerified !== true
    ) return null;
    return value as GovernanceProviderResourceExecutionAdmissionReadback;
}

function normalizeGovernanceProviderExecutionReference(
    value: any,
): NonNullable<CircleGovernanceRequest['providerExecutionReference']> | null {
    if (value == null) return null;
    const observedAt = value?.observedAt ? String(value.observedAt) : null;
    const native = value?.providerNative;
    const residualBypassRisk = value?.residualBypassRisk;
    const authorizationReceipt = value?.executionAuthorizationReceipt;
    const businessStateEntries = value?.businessState
        && typeof value.businessState === 'object'
        && !Array.isArray(value.businessState)
        ? Object.entries(value.businessState)
        : [];
    const expectedResidualRisk = residualBypassRisk?.enforcementMode === 'provider_onchain'
        ? residualBypassRisk?.risk
            === 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
        : residualBypassRisk?.enforcementMode === 'multisig_threshold'
            ? residualBypassRisk?.risk
                === 'threshold_signers_can_create_or_execute_transactions_outside_alcheme'
            : false;
    const nativeTransactions = Array.isArray(native?.transactions) ? native.transactions : [];
    if (
        value?.schemaVersion !== 1
        || !/^provider-execution:[a-f0-9]{64}$/.test(String(value?.ref ?? ''))
        || !['realms_provider_binding', 'squads_provider_binding'].includes(String(value?.provider))
        || typeof value?.network !== 'string'
        || !value.network
        || typeof value?.resourceRef !== 'string'
        || !value.resourceRef
        || typeof value?.receiptId !== 'string'
        || !value.receiptId
        || !/^[a-f0-9]{64}$/.test(String(value?.receiptEvidenceDigest ?? ''))
        || value?.finality !== 'finalized'
        || value?.reconciliationAuthority !== 'independent_provider_readback'
        || (value?.observedSlot !== null && !Number.isSafeInteger(value?.observedSlot))
        || (observedAt !== null && !Number.isFinite(Date.parse(observedAt)))
        || !String(native?.ownerProgramRef ?? '').trim()
        || (native?.proposalRef !== null && !String(native?.proposalRef ?? '').trim())
        || (native?.proposalTransactionRef !== null
            && !String(native?.proposalTransactionRef ?? '').trim())
        || nativeTransactions.length > 12
        || nativeTransactions.some((transaction: any) => (
            !String(transaction?.stepId ?? '').trim()
            || !String(transaction?.signature ?? '').trim()
            || !Number.isSafeInteger(transaction?.slot)
            || transaction.slot <= 0
            || transaction?.commitment !== 'finalized'
        ))
        || native?.transactionCount !== nativeTransactions.length
        || native?.rawTransactionExposed !== false
        || native?.signerKeyRefExposed !== false
        || !expectedResidualRisk
        || residualBypassRisk?.bypassPrevented !== false
        || businessStateEntries.length === 0
        || businessStateEntries.some(([key, entry]) => !key.trim() || typeof entry !== 'string' || !entry.trim())
        || (authorizationReceipt != null && (
        authorizationReceipt?.schemaVersion !== 1
        || authorizationReceipt?.receiptRole !== 'design_input_only'
        || authorizationReceipt?.authority
            !== 'canonical_request_decision_cost_preflight_and_provider_truth_readback'
        || typeof authorizationReceipt?.requestId !== 'string'
        || !authorizationReceipt.requestId.trim()
        || !isSha256Digest(String(authorizationReceipt?.decisionDigest ?? ''))
        || typeof authorizationReceipt?.receiptId !== 'string'
        || !authorizationReceipt.receiptId.trim()
        || authorizationReceipt?.authorizationStatus !== 'authorized'
        || authorizationReceipt?.normalizedDecision?.decision !== 'accepted'
        || authorizationReceipt?.normalizedDecision?.executionStatus !== 'executed'
        || authorizationReceipt?.normalizedDecision?.decisionDigest
            !== authorizationReceipt.decisionDigest
        || authorizationReceipt?.normalizedDecision?.businessStateAuthority
            !== 'independent_provider_readback'
        || (authorizationReceipt?.normalizedDecision?.providerResult !== null
            && typeof authorizationReceipt?.normalizedDecision?.providerResult !== 'string')
        || authorizationReceipt?.providerTruth?.authority !== 'independent_provider_readback'
        || !isSha256Digest(String(authorizationReceipt?.providerTruth?.providerNativeEvidenceDigest ?? ''))
        || authorizationReceipt?.providerTruth?.finalizedProviderNativeEvidence !== true
        || authorizationReceipt?.providerTruth?.dbReceiptIsProviderTruth !== false
        || authorizationReceipt?.providerTruth?.providerNativeEvidenceDigest
            !== value.receiptEvidenceDigest
        || authorizationReceipt?.issuerTrust?.mode !== 'provider_native_trust_profile'
        || authorizationReceipt?.issuerTrust?.issuerRef !== value.provider
        || !isSha256Digest(String(authorizationReceipt?.issuerTrust?.trustProfileDigest ?? ''))
        || authorizationReceipt?.issuerTrust?.jwsIngestion
            !== 'not_applicable_provider_native_finalized_transaction'
        || authorizationReceipt?.issuerTrust?.revocationIngestion
            !== 'not_applicable_provider_native_finalized_transaction'
        || typeof authorizationReceipt?.issuerTrust?.providerProfileRef !== 'string'
        || !authorizationReceipt.issuerTrust.providerProfileRef.trim()
        || !Number.isSafeInteger(authorizationReceipt?.issuerTrust?.providerProfileVersion)
        || !isSha256Digest(String(authorizationReceipt?.operationPayloadTarget?.actionIntentDigest ?? ''))
        || !isSha256Digest(String(authorizationReceipt?.operationPayloadTarget?.planDigest ?? ''))
        || !isSha256Digest(String(
            authorizationReceipt?.operationPayloadTarget?.terminalTransactionAttemptDigest ?? '',
        ))
        || !isSha256Digest(String(authorizationReceipt?.operationPayloadTarget?.actionSetDigest ?? ''))
        || authorizationReceipt?.operationPayloadTarget?.targetResourceRef !== value.resourceRef
        || authorizationReceipt?.operationPayloadTarget?.ownerProgramRef !== native?.ownerProgramRef
        || !Array.isArray(authorizationReceipt?.operationPayloadTarget?.operations)
        || authorizationReceipt.operationPayloadTarget.operations.length === 0
        || authorizationReceipt.operationPayloadTarget.operations.some((operation: unknown) => (
            typeof operation !== 'string' || !operation.trim()
        ))
        || authorizationReceipt?.operationPayloadTarget?.liveState?.authority
            !== 'independent_provider_readback'
        || !Number.isSafeInteger(authorizationReceipt?.operationPayloadTarget?.liveState?.observedSlot)
        || authorizationReceipt.operationPayloadTarget.liveState.observedSlot <= 0
        || !isSha256Digest(String(
            authorizationReceipt?.operationPayloadTarget?.liveState?.observedStateDigest ?? '',
        ))
        || authorizationReceipt?.operationPayloadTarget?.liveState?.finality !== 'finalized'
        || authorizationReceipt?.oneTimeConsumption?.authority !== 'canonical_cost_preflight'
        || typeof authorizationReceipt?.oneTimeConsumption?.preflightId !== 'string'
        || !authorizationReceipt.oneTimeConsumption.preflightId.trim()
        || authorizationReceipt?.oneTimeConsumption?.status !== 'consumed'
        || authorizationReceipt?.oneTimeConsumption?.atomicConsumption
            !== 'single_cost_preflight_update_conflict_fail_closed'
        || authorizationReceipt?.oneTimeConsumption?.duplicateActionObserved !== false
        ))
    ) return null;
    return {
        schemaVersion: 1,
        ref: String(value.ref),
        provider: value.provider,
        network: value.network,
        resourceRef: value.resourceRef,
        receiptId: value.receiptId,
        receiptEvidenceDigest: value.receiptEvidenceDigest,
        finality: 'finalized',
        reconciliationAuthority: 'independent_provider_readback',
        effect: value.effect == null ? null : String(value.effect),
        observedSlot: value.observedSlot == null ? null : Number(value.observedSlot),
        observedAt,
        providerNative: {
            ownerProgramRef: String(native.ownerProgramRef),
            proposalRef: native.proposalRef == null ? null : String(native.proposalRef),
            proposalTransactionRef: native.proposalTransactionRef == null
                ? null
                : String(native.proposalTransactionRef),
            transactions: nativeTransactions.map((transaction: any) => ({
                stepId: String(transaction.stepId),
                signature: String(transaction.signature),
                slot: Number(transaction.slot),
                commitment: 'finalized' as const,
            })),
            transactionCount: nativeTransactions.length,
            rawTransactionExposed: false,
            signerKeyRefExposed: false,
        },
        residualBypassRisk: {
            enforcementMode: residualBypassRisk.enforcementMode,
            risk: residualBypassRisk.risk,
            bypassPrevented: false,
        },
        businessState: Object.fromEntries(businessStateEntries) as Record<string, string>,
        ...(authorizationReceipt == null ? {} : { executionAuthorizationReceipt: {
            schemaVersion: 1,
            receiptRole: 'design_input_only',
            authority: 'canonical_request_decision_cost_preflight_and_provider_truth_readback',
            requestId: String(authorizationReceipt.requestId),
            decisionDigest: String(authorizationReceipt.decisionDigest),
            receiptId: String(authorizationReceipt.receiptId),
            authorizationStatus: 'authorized',
            normalizedDecision: {
                decision: 'accepted',
                executionStatus: 'executed',
                decisionDigest: String(authorizationReceipt.normalizedDecision.decisionDigest),
                providerResult: authorizationReceipt.normalizedDecision.providerResult == null
                    ? null
                    : String(authorizationReceipt.normalizedDecision.providerResult),
                businessStateAuthority: 'independent_provider_readback',
            },
            providerTruth: {
                authority: 'independent_provider_readback',
                providerNativeEvidenceDigest: String(
                    authorizationReceipt.providerTruth.providerNativeEvidenceDigest,
                ),
                finalizedProviderNativeEvidence: true,
                dbReceiptIsProviderTruth: false,
            },
            issuerTrust: {
                mode: 'provider_native_trust_profile',
                issuerRef: authorizationReceipt.issuerTrust.issuerRef,
                trustProfileDigest: String(authorizationReceipt.issuerTrust.trustProfileDigest),
                jwsIngestion: 'not_applicable_provider_native_finalized_transaction',
                revocationIngestion: 'not_applicable_provider_native_finalized_transaction',
                providerProfileRef: String(authorizationReceipt.issuerTrust.providerProfileRef),
                providerProfileVersion: Number(
                    authorizationReceipt.issuerTrust.providerProfileVersion,
                ),
            },
            operationPayloadTarget: {
                actionIntentDigest: String(
                    authorizationReceipt.operationPayloadTarget.actionIntentDigest,
                ),
                planDigest: String(authorizationReceipt.operationPayloadTarget.planDigest),
                terminalTransactionAttemptDigest: String(
                    authorizationReceipt.operationPayloadTarget.terminalTransactionAttemptDigest,
                ),
                actionSetDigest: String(authorizationReceipt.operationPayloadTarget.actionSetDigest),
                targetResourceRef: String(authorizationReceipt.operationPayloadTarget.targetResourceRef),
                ownerProgramRef: String(authorizationReceipt.operationPayloadTarget.ownerProgramRef),
                operations: authorizationReceipt.operationPayloadTarget.operations.map(String),
                liveState: {
                    authority: 'independent_provider_readback',
                    observedSlot: Number(
                        authorizationReceipt.operationPayloadTarget.liveState.observedSlot,
                    ),
                    observedStateDigest: String(
                        authorizationReceipt.operationPayloadTarget.liveState.observedStateDigest,
                    ),
                    finality: 'finalized',
                },
            },
            oneTimeConsumption: {
                authority: 'canonical_cost_preflight',
                preflightId: String(authorizationReceipt.oneTimeConsumption.preflightId),
                status: 'consumed',
                atomicConsumption: 'single_cost_preflight_update_conflict_fail_closed',
                duplicateActionObserved: false,
            },
        } }),
    };
}

function normalizeGovernanceProviderProposalTransactionReadback(
    value: any,
    rawTransactions: any,
): NonNullable<
    NonNullable<GovernanceProviderExecutionReadback['provider']>['proposalTransactionReadback']
> | null {
    if (value == null) return null;
    const transactions = Array.isArray(rawTransactions) ? rawTransactions : [];
    const instructions = Array.isArray(value?.instructions) ? value.instructions : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'provider_receipt_and_independent_finalized_readback'
        || !String(value?.proposalRef ?? '').trim()
        || !String(value?.proposalTransactionRef ?? '').trim()
        || value?.commitment !== 'finalized'
        || value?.executionStatus !== 'executed'
        || instructions.length === 0
        || instructions.length !== transactions.length
        || instructions.some((instruction: any, index: number) => (
            !String(instruction?.stepId ?? '').trim()
            || instruction.stepId !== transactions[index]?.stepId
            || !isSha256Digest(String(instruction?.manifestDigest ?? ''))
            || instruction.manifestDigest !== transactions[index]?.manifestDigest
            || !String(instruction?.summary ?? '').trim()
            || !Array.isArray(instruction?.programScope)
            || instruction.programScope.length === 0
            || instruction.programScope.some((program: unknown) => !String(program ?? '').trim())
            || !String(instruction?.signature ?? '').trim()
            || instruction.signature !== transactions[index]?.signature
            || !Number.isSafeInteger(instruction?.slot)
            || instruction.slot <= 0
            || instruction.slot !== transactions[index]?.slot
            || instruction?.commitment !== 'finalized'
            || instruction?.executionStatus !== 'finalized'
            || instruction?.opaqueInstruction !== false
        ))
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'provider_receipt_and_independent_finalized_readback',
        proposalRef: String(value.proposalRef),
        proposalTransactionRef: String(value.proposalTransactionRef),
        commitment: 'finalized',
        executionStatus: 'executed',
        instructions: instructions.map((instruction: any) => ({
            stepId: String(instruction.stepId),
            manifestDigest: String(instruction.manifestDigest),
            summary: String(instruction.summary),
            programScope: instruction.programScope.map(String),
            signature: String(instruction.signature),
            slot: Number(instruction.slot),
            commitment: 'finalized',
            executionStatus: 'finalized',
            opaqueInstruction: false,
        })),
    };
}

function normalizeGovernanceProviderExecutionPlanReadback(
    value: any,
    provider: any,
    attemptOwner: any,
    retryBoundary: any,
): GovernanceProviderExecutionPlanReadback | null {
    if (value == null) return null;
    const transactions = Array.isArray(provider?.transactions) ? provider.transactions : [];
    const actions = Array.isArray(value?.actions) ? value.actions : [];
    const expectedMode = provider?.module === 'realms_provider_binding' ? 'realms' : 'squads';
    const retryFields = value?.intentBoundary?.retryVariantFieldsExcluded;
    const artifactLinkage = value?.artifactLinkage;
    const legacyArtifactLinkage = artifactLinkage?.status
        === 'not_applicable_provider_binding_activation'
        && artifactLinkage?.artifactRef === null
        && artifactLinkage?.artifactDigest === null
        && artifactLinkage?.resourceBindingId === null;
    const mappedArtifactLinkage = artifactLinkage?.status
        === 'mapped_execution_resource_artifact'
        && Boolean(String(artifactLinkage?.artifactRef ?? '').trim())
        && isSha256Digest(String(artifactLinkage?.artifactDigest ?? ''))
        && Boolean(String(artifactLinkage?.resourceBindingId ?? '').trim());
    const validArtifactLinkage = artifactLinkage?.titleInferenceAllowed === false
        && (legacyArtifactLinkage || mappedArtifactLinkage);
    const duplicatePrevention = value?.duplicatePrevention;
    const actionIdempotencyKeys = Array.isArray(duplicatePrevention?.actionIdempotencyKeys)
        ? duplicatePrevention.actionIdempotencyKeys
        : [];
    const providerReferences = Array.isArray(duplicatePrevention?.providerReferences)
        ? duplicatePrevention.providerReferences
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt'
        || value?.outcome !== 'provider_execution_plan'
        || value?.providerModule !== provider?.module
        || value?.executionMode !== expectedMode
        || !String(value?.requestId ?? '').trim()
        || !isSha256Digest(String(value?.decisionDigest ?? ''))
        || !validArtifactLinkage
        || !isSha256Digest(String(value?.actionIntentDigest ?? ''))
        || value.actionIntentDigest !== attemptOwner?.actionIntentDigest
        || !isSha256Digest(String(value?.planDigest ?? ''))
        || !isSha256Digest(String(value?.terminalTransactionAttemptDigest ?? ''))
        || value.terminalTransactionAttemptDigest !== attemptOwner?.transactionAttemptDigest
        || !isSha256Digest(String(value?.actionSetDigest ?? ''))
        || value.actionSetDigest !== retryBoundary?.actionSetDigest
        || value?.intentBoundary?.governanceInput !== 'canonical_request_payload'
        || value?.intentBoundary?.providerActions !== 'verified_provider_plan_and_manifest'
        || !Array.isArray(retryFields)
        || JSON.stringify(retryFields) !== JSON.stringify([
            'recent_blockhash',
            'fee_quote',
            'provider_attempt_reference',
        ])
        || value?.aggregateStatus !== 'executed'
        || value?.aggregateRule !== 'all_ordered_steps_finalized'
        || duplicatePrevention?.authority
            !== 'canonical_action_intent_attempt_and_authoritative_provider_readback'
        || duplicatePrevention?.state !== 'protected_no_duplicate_action_observed'
        || duplicatePrevention?.actionIntentDigest !== value.actionIntentDigest
        || duplicatePrevention?.terminalTransactionAttemptDigest
            !== value.terminalTransactionAttemptDigest
        || duplicatePrevention?.actionSetDigest !== value.actionSetDigest
        || actionIdempotencyKeys.length !== actions.length
        || new Set(actionIdempotencyKeys).size !== actions.length
        || actionIdempotencyKeys.some((key: unknown) => !isSha256Digest(String(key ?? '')))
        || providerReferences.length !== actions.length
        || new Set(providerReferences).size !== actions.length
        || providerReferences.some((reference: unknown) => !String(reference ?? '').trim())
        || duplicatePrevention?.checks?.uniqueActionIdempotencyKeys !== true
        || duplicatePrevention?.checks?.uniqueProviderReferences !== true
        || duplicatePrevention?.checks?.everyAttemptFinalized !== true
        || duplicatePrevention?.checks?.everyAttemptManifestBound !== true
        || duplicatePrevention?.checks?.authoritativeProviderReadback !== true
        || duplicatePrevention?.duplicateActionObserved !== false
        || duplicatePrevention?.duplicatePaymentObserved
            !== 'not_applicable_no_real_asset_current_vertical'
        || duplicatePrevention?.retryBoundary
            !== 'same_intent_retry_requires_authoritative_expiry'
        || actions.length === 0
        || actions.length !== transactions.length
        || actions.some((action: any, index: number) => {
            const transaction = transactions[index];
            const previousActionIds = actions.slice(0, index).map((item: any) => item?.actionId);
            const dependencies = Array.isArray(action?.dependsOnActionIds)
                ? action.dependsOnActionIds
                : [];
            const accounts = Array.isArray(action?.accountScope) ? action.accountScope : [];
            const programs = Array.isArray(action?.programScope) ? action.programScope : [];
            const attempts = Array.isArray(action?.attempts) ? action.attempts : [];
            const attempt = attempts[0];
            return action?.actionId !== transaction?.stepId
                || action?.order !== index + 1
                || action?.executor !== expectedMode
                || action?.subject?.type !== 'governed_resource'
                || action?.subject?.ref !== provider?.resourceRef
                || action?.network !== provider?.chainId
                || action?.operation !== transaction?.stepId
                || !String(action?.instructionSemantics ?? '').trim()
                || !String(action?.humanSummary ?? '').trim()
                || programs.length === 0
                || programs.some((program: unknown) => !String(program ?? '').trim())
                || accounts.some((account: any) => (
                    !String(account?.role ?? '').trim() || !String(account?.ref ?? '').trim()
                ))
                || !String(action?.assetChange ?? '').trim()
                || dependencies.some((dependency: unknown) => !previousActionIds.includes(dependency))
                || action?.atomicity !== 'single_provider_transaction'
                || !String(action?.constraints?.simulation ?? '').trim()
                || !['provider_onchain', 'multisig_threshold'].includes(
                    action?.constraints?.enforcement,
                )
                || action?.constraints?.opaqueInstructions !== false
                || !isSha256Digest(String(action?.constraints?.idempotencyKey ?? ''))
                || action?.constraints?.deadline?.kind !== 'last_valid_block_height'
                || !Number.isSafeInteger(action?.constraints?.deadline?.value)
                || action.constraints.deadline.value <= 0
                || attempts.length !== 1
                || attempt?.ordinal !== 1
                || attempt?.status !== 'finalized'
                || attempt?.providerReference !== transaction?.signature
                || actionIdempotencyKeys[index] !== action?.constraints?.idempotencyKey
                || providerReferences[index] !== attempt?.providerReference
                || attempt?.slot !== transaction?.slot
                || attempt?.recentBlockhash !== transaction?.attemptContext?.recentBlockhash
                || attempt?.messageDigest !== transaction?.messageDigest
                || attempt?.manifestDigest !== transaction?.manifestDigest;
        })
    ) return null;
    return value as GovernanceProviderExecutionPlanReadback;
}

function normalizeGovernanceProviderActionSafetyBoundary(
    value: any,
    provider: any,
    executionPlanReadback: GovernanceProviderExecutionPlanReadback | null,
    retryBoundary: any,
): GovernanceProviderActionSafetyBoundary | null {
    if (value == null) return null;
    const expectedMode = provider?.module === 'realms_provider_binding' ? 'realms' : 'squads';
    const programAllowlist = Array.isArray(value?.programAllowlist)
        ? value.programAllowlist.map(String).filter(Boolean)
        : [];
    const operationAllowlist = Array.isArray(value?.operationAllowlist)
        ? value.operationAllowlist.map(String).filter(Boolean)
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'reviewed_provider_adapter_instruction_safety'
        || value?.providerModule !== provider?.module
        || value?.executionMode !== expectedMode
        || value?.chainId !== provider?.chainId
        || value?.resourceRef !== provider?.resourceRef
        || value?.ownerProgramRef !== provider?.ownerProgramRef
        || value?.decisionLinkage?.requestId !== executionPlanReadback?.requestId
        || value?.decisionLinkage?.decisionDigest !== executionPlanReadback?.decisionDigest
        || value?.decisionLinkage?.actionIntentDigest !== executionPlanReadback?.actionIntentDigest
        || value?.actionCount !== executionPlanReadback?.actions.length
        || value?.reviewedAdapter !== provider?.module
        || programAllowlist.length === 0
        || operationAllowlist.length !== executionPlanReadback?.actions.length
        || !operationAllowlist.every((operation: string) => (
            executionPlanReadback?.actions.some((action) => action.operation === operation)
        ))
        || value?.checks?.reviewedAdapterOnly !== true
        || value?.checks?.programAllowlistVerified !== true
        || value?.checks?.accountPrivilegeChecked !== true
        || value?.checks?.assetConservation !== 'zero_outflow_current_vertical'
        || value?.checks?.maxOutflowLamports !== 0
        || value?.checks?.simulationRequired !== true
        || value?.checks?.opaqueInstructionsAllowed !== false
        || value?.checks?.rawInstructionAutoExecutionAllowed !== false
        || value?.checks?.materialChangeRequiresNewDecision !== true
        || value?.retryMaterialChangeGate !== retryBoundary?.materialChangesRequire
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'reviewed_provider_adapter_instruction_safety',
        providerModule: value.providerModule,
        executionMode: expectedMode,
        chainId: 'solana:devnet',
        resourceRef: String(value.resourceRef),
        ownerProgramRef: String(value.ownerProgramRef),
        decisionLinkage: {
            requestId: String(value.decisionLinkage.requestId),
            decisionDigest: String(value.decisionLinkage.decisionDigest),
            actionIntentDigest: String(value.decisionLinkage.actionIntentDigest),
        },
        actionCount: Number(value.actionCount),
        reviewedAdapter: value.reviewedAdapter,
        programAllowlist,
        operationAllowlist,
        checks: {
            reviewedAdapterOnly: true,
            programAllowlistVerified: true,
            accountPrivilegeChecked: true,
            assetConservation: 'zero_outflow_current_vertical',
            maxOutflowLamports: 0,
            simulationRequired: true,
            opaqueInstructionsAllowed: false,
            rawInstructionAutoExecutionAllowed: false,
            materialChangeRequiresNewDecision: true,
        },
        retryMaterialChangeGate: 'new_decision_stage_or_superseding_case',
    };
}

function normalizeGovernanceServicePayerAuthorityBoundary(
    value: any,
    authorityPaymentBoundary: GovernanceProviderAuthorityPaymentBoundary | null,
    fundingSourceFeePayerBoundary: GovernanceProviderFundingSourceFeePayerBoundary | null,
    costReconciliation: {
        payerPolicyId: string;
        economicBearer: string;
        sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
        totalSpendLamports: number;
        totalDirectRentLamports: number | null;
        refund: 'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition';
    } | null,
    providerActionSafetyBoundary: GovernanceProviderActionSafetyBoundary | null,
    retryBoundary: any,
): GovernanceServicePayerAuthorityBoundary | null {
    if (value == null) return null;
    const restrictedMintOperation = value?.restrictedMintOperation
        === 'governance_weight_no_real_asset_requires_separate_resource_authority'
        || value?.restrictedMintOperation === 'not_present_current_provider_action'
        ? value.restrictedMintOperation
        : null;
    const totalSpendLamports = Number(value?.costReadback?.totalSpendLamports);
    const totalDirectRentLamports = value?.costReadback?.totalDirectRentLamports === null
        ? null
        : Number(value?.costReadback?.totalDirectRentLamports);
    const refund = value?.costReadback?.refund === 'not_applicable_no_refund'
        || value?.costReadback?.refund === 'unknown_no_provider_refund_disposition'
        ? value.costReadback.refund
        : null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_payer_fee_rent_only_asset_authority_separation'
        || authorityPaymentBoundary === null
        || fundingSourceFeePayerBoundary === null
        || costReconciliation === null
        || providerActionSafetyBoundary === null
        || !String(value?.payerPolicyId ?? '').trim()
        || value.payerPolicyId !== authorityPaymentBoundary.payerPolicyId
        || value.payerPolicyId !== fundingSourceFeePayerBoundary.payerPolicyId
        || value.payerPolicyId !== costReconciliation.payerPolicyId
        || value?.economicBearer !== authorityPaymentBoundary.economicBearer
        || value?.economicBearer !== fundingSourceFeePayerBoundary.economicBearer
        || value?.economicBearer !== costReconciliation.economicBearer
        || value?.feeScope !== 'approved_fee_and_rent_only'
        || value?.payerRole !== 'separated_fee_payer_policy'
        || value?.actualFeePayer !== 'canonical_payer_policy_fee_payer_signer'
        || value?.sponsorRole !== authorityPaymentBoundary.sponsorRole
        || value?.sponsorRole !== fundingSourceFeePayerBoundary.sponsorRole
        || value?.sponsorRole !== costReconciliation.sponsorRole
        || value?.sponsorAuthorityGain !== 'none'
        || value?.servicePayerMayControlToken !== false
        || value?.servicePayerMayControlMetadata !== false
        || value?.servicePayerMayControlProgram !== false
        || value?.servicePayerMayControlGovernanceAuthority !== false
        || value?.mintFreezeUpdateAuthoritySource !== 'asset_authority_policy_required'
        || restrictedMintOperation === null
        || value?.currentActionAssetOutflow !== 'zero_outflow_current_vertical'
        || value?.rawInstructionAutoExecutionAllowed !== false
        || value?.longLivedUniversalKeyAllowed !== false
        || value?.materialAuthorityChangeRequires !== retryBoundary?.materialChangesRequire
        || value?.costReadback?.unit !== 'lamports'
        || !Number.isSafeInteger(totalSpendLamports)
        || totalSpendLamports !== costReconciliation.totalSpendLamports
        || (totalDirectRentLamports === null
            ? costReconciliation.totalDirectRentLamports !== null
            : !Number.isSafeInteger(totalDirectRentLamports)
                || totalDirectRentLamports !== costReconciliation.totalDirectRentLamports)
        || refund !== costReconciliation.refund
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_payer_fee_rent_only_asset_authority_separation',
        payerPolicyId: String(value.payerPolicyId),
        economicBearer: String(value.economicBearer),
        feeScope: 'approved_fee_and_rent_only',
        payerRole: 'separated_fee_payer_policy',
        actualFeePayer: 'canonical_payer_policy_fee_payer_signer',
        sponsorRole: value.sponsorRole,
        sponsorAuthorityGain: 'none',
        servicePayerMayControlToken: false,
        servicePayerMayControlMetadata: false,
        servicePayerMayControlProgram: false,
        servicePayerMayControlGovernanceAuthority: false,
        mintFreezeUpdateAuthoritySource: 'asset_authority_policy_required',
        restrictedMintOperation,
        currentActionAssetOutflow: 'zero_outflow_current_vertical',
        rawInstructionAutoExecutionAllowed: false,
        longLivedUniversalKeyAllowed: false,
        materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case',
        costReadback: {
            unit: 'lamports',
            totalSpendLamports,
            totalDirectRentLamports,
            refund,
        },
    };
}

function normalizeGovernanceProviderCostControlBoundary(
    value: any,
    costReconciliation: {
        payerPolicyId: string;
        economicBearer: string;
        sponsorRole: 'explicit_relayer_from_payer_policy' | 'not_configured';
        totalSpendLamports: number;
        finalBalanceLamports: number;
        refund: 'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition';
    } | null,
    resourceRef: string | null | undefined,
): GovernanceProviderCostControlBoundary | null {
    if (value == null) return null;
    const finalBalanceLamports = Number(value?.balance?.finalBalanceLamports);
    const maximumWalletBalanceLamports = value?.limits?.maximumWalletBalanceLamports === null
        ? null
        : String(value?.limits?.maximumWalletBalanceLamports ?? '');
    const effectiveFrom = value?.timeWindow?.effectiveFrom === null
        ? null
        : String(value?.timeWindow?.effectiveFrom ?? '');
    const expiresAt = value?.timeWindow?.expiresAt === null
        ? null
        : String(value?.timeWindow?.expiresAt ?? '');
    const checkedAt = value?.timeWindow?.checkedAt === null
        ? null
        : String(value?.timeWindow?.checkedAt ?? '');
    const scopeResourceBindingId = value?.scope?.resourceBindingId === null
        ? null
        : String(value?.scope?.resourceBindingId ?? '');
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_payer_policy_cost_control_and_provider_receipt'
        || costReconciliation === null
        || !String(value?.payerPolicyId ?? '').trim()
        || value.payerPolicyId !== costReconciliation.payerPolicyId
        || !isSha256Digest(String(value?.payerPolicyDigest ?? ''))
        || !String(value?.preflightId ?? '').trim()
        || !String(value?.attemptKey ?? '').trim()
        || (value?.scope?.homeIdentityBindingId !== null
            && !String(value?.scope?.homeIdentityBindingId ?? '').trim())
        || (value?.scope?.circleRef !== null && !String(value?.scope?.circleRef ?? '').trim())
        || (value?.scope?.actorPubkey !== null && !String(value?.scope?.actorPubkey ?? '').trim())
        || !String(value?.scope?.actionType ?? '').trim()
        || !String(value?.scope?.network ?? '').trim()
        || (scopeResourceBindingId !== null && !scopeResourceBindingId.trim())
        || scopeResourceBindingId !== (resourceRef ?? null)
        || !isSha256Digest(String(value?.scope?.actionScopeDigest ?? ''))
        || !String(value?.timeWindow?.scope ?? '').trim()
        || (effectiveFrom !== null && !Number.isFinite(Date.parse(effectiveFrom)))
        || (expiresAt !== null && !Number.isFinite(Date.parse(expiresAt)))
        || (checkedAt !== null && !Number.isFinite(Date.parse(checkedAt)))
        || value?.limits?.unit !== 'lamports'
        || !/^\d+$/.test(String(value?.limits?.singleTransactionLamports ?? ''))
        || !/^\d+$/.test(String(value?.limits?.periodLamports ?? ''))
        || (maximumWalletBalanceLamports !== null && !/^\d+$/.test(maximumWalletBalanceLamports))
        || value?.balance?.authority !== 'provider_receipt_final_balance'
        || !Number.isSafeInteger(finalBalanceLamports)
        || finalBalanceLamports !== costReconciliation.finalBalanceLamports
        || !['within_configured_balance_limit', 'no_maximum_wallet_balance_configured']
            .includes(String(value?.balance?.state))
        || value?.rateLimit?.authority !== 'invocation_attempt_key_and_payer_policy_period'
        || value?.rateLimit?.duplicateAttemptKeyScopedToInvocation !== true
        || value?.rateLimit?.actionWindowScope !== value?.timeWindow?.scope
        || value?.alerts?.spendWithinSingleLimit !== true
        || value?.alerts?.spendWithinPeriodLimit !== true
        || (value?.alerts?.finalBalanceWithinConfiguredMaximum !== true
            && value?.alerts?.finalBalanceWithinConfiguredMaximum !== 'not_configured')
        || value?.sponsorReceipt?.authority !== 'provider_cost_control_sponsor_receipt'
        || !isSha256Digest(String(value?.sponsorReceipt?.receiptDigest ?? ''))
        || value?.sponsorReceipt?.sponsorRole !== costReconciliation.sponsorRole
        || (value?.sponsorReceipt?.sponsorRef !== null
            && !String(value?.sponsorReceipt?.sponsorRef ?? '').trim())
        || value?.sponsorReceipt?.economicBearer !== costReconciliation.economicBearer
        || value?.sponsorReceipt?.feePayerSignerRefExposed !== false
        || value?.sponsorReceipt?.refund !== costReconciliation.refund
        || value?.sponsorReceipt?.generatedFrom !== 'payer_policy_cost_preflight_and_provider_receipt'
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_payer_policy_cost_control_and_provider_receipt',
        payerPolicyId: String(value.payerPolicyId),
        payerPolicyDigest: String(value.payerPolicyDigest),
        preflightId: String(value.preflightId),
        attemptKey: String(value.attemptKey),
        scope: {
            homeIdentityBindingId: value.scope.homeIdentityBindingId === null
                ? null
                : String(value.scope.homeIdentityBindingId),
            circleRef: value.scope.circleRef === null ? null : String(value.scope.circleRef),
            actorPubkey: value.scope.actorPubkey === null ? null : String(value.scope.actorPubkey),
            actionType: String(value.scope.actionType),
            network: String(value.scope.network),
            resourceBindingId: scopeResourceBindingId,
            actionScopeDigest: String(value.scope.actionScopeDigest),
        },
        timeWindow: {
            scope: String(value.timeWindow.scope),
            effectiveFrom,
            expiresAt,
            checkedAt,
        },
        limits: {
            unit: 'lamports',
            singleTransactionLamports: String(value.limits.singleTransactionLamports),
            periodLamports: String(value.limits.periodLamports),
            maximumWalletBalanceLamports,
        },
        balance: {
            authority: 'provider_receipt_final_balance',
            finalBalanceLamports,
            state: value.balance.state as
                | 'within_configured_balance_limit'
                | 'no_maximum_wallet_balance_configured',
        },
        rateLimit: {
            authority: 'invocation_attempt_key_and_payer_policy_period',
            duplicateAttemptKeyScopedToInvocation: true,
            actionWindowScope: String(value.rateLimit.actionWindowScope),
        },
        alerts: {
            spendWithinSingleLimit: true,
            spendWithinPeriodLimit: true,
            finalBalanceWithinConfiguredMaximum:
                value.alerts.finalBalanceWithinConfiguredMaximum as true | 'not_configured',
        },
        sponsorReceipt: {
            authority: 'provider_cost_control_sponsor_receipt',
            receiptDigest: String(value.sponsorReceipt.receiptDigest),
            sponsorRole: value.sponsorReceipt.sponsorRole as
                'explicit_relayer_from_payer_policy' | 'not_configured',
            sponsorRef: value.sponsorReceipt.sponsorRef === null
                ? null
                : String(value.sponsorReceipt.sponsorRef),
            economicBearer: String(value.sponsorReceipt.economicBearer),
            feePayerSignerRefExposed: false,
            refund: value.sponsorReceipt.refund as
                'not_applicable_no_refund' | 'unknown_no_provider_refund_disposition',
            generatedFrom: 'payer_policy_cost_preflight_and_provider_receipt',
        },
    };
}

function normalizeGovernanceAssetAuthoritySponsorBoundary(
    value: any,
    servicePayerAuthorityBoundary: GovernanceServicePayerAuthorityBoundary | null,
    providerCostControlBoundary: GovernanceProviderCostControlBoundary | null,
    providerActionSafetyBoundary: GovernanceProviderActionSafetyBoundary | null,
): GovernanceAssetAuthoritySponsorBoundary | null {
    if (value == null) return null;
    const actionCount = Number(value?.actionSafety?.actionCount);
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_asset_authority_policy_sponsor_separation'
        || servicePayerAuthorityBoundary === null
        || providerCostControlBoundary === null
        || providerActionSafetyBoundary === null
        || value?.payerPolicyId !== servicePayerAuthorityBoundary.payerPolicyId
        || value?.payerPolicyId !== providerCostControlBoundary.payerPolicyId
        || value?.payerPolicyDigest !== providerCostControlBoundary.payerPolicyDigest
        || value?.economicBearer !== servicePayerAuthorityBoundary.economicBearer
        || value?.economicBearer !== providerCostControlBoundary.sponsorReceipt.economicBearer
        || value?.sponsorRole !== servicePayerAuthorityBoundary.sponsorRole
        || value?.sponsorRole !== providerCostControlBoundary.sponsorReceipt.sponsorRole
        || value?.sponsorReceiptDigest !== providerCostControlBoundary.sponsorReceipt.receiptDigest
        || value?.assetAuthority?.ownerIssuerMintFreezeUpdateSource
            !== 'asset_authority_policy_required'
        || value?.assetAuthority?.currentActionAssetOutflow
            !== servicePayerAuthorityBoundary.currentActionAssetOutflow
        || value?.assetAuthority?.restrictedMintOperation
            !== servicePayerAuthorityBoundary.restrictedMintOperation
        || value?.assetAuthority?.materialAuthorityChangeRequires
            !== servicePayerAuthorityBoundary.materialAuthorityChangeRequires
        || value?.sponsorSeparation?.sponsorMayPayFees !== true
        || value?.sponsorSeparation?.sponsorAuthorityGain
            !== servicePayerAuthorityBoundary.sponsorAuthorityGain
        || value?.sponsorSeparation?.feePayerSignerRefExposed !== false
        || value?.sponsorSeparation?.sponsorMayControlToken !== false
        || value?.sponsorSeparation?.sponsorMayControlMetadata !== false
        || value?.sponsorSeparation?.sponsorMayControlProgram !== false
        || value?.sponsorSeparation?.sponsorMayControlGovernanceAuthority !== false
        || value?.sponsorSeparation?.longLivedUniversalKeyAllowed !== false
        || value?.actionSafety?.providerModule !== providerActionSafetyBoundary.providerModule
        || value?.actionSafety?.reviewedAdapter !== providerActionSafetyBoundary.reviewedAdapter
        || !Number.isSafeInteger(actionCount)
        || actionCount !== providerActionSafetyBoundary.actionCount
        || value?.actionSafety?.assetConservation !== 'zero_outflow_current_vertical'
        || value?.actionSafety?.maxOutflowLamports !== 0
        || value?.actionSafety?.opaqueInstructionsAllowed !== false
        || value?.actionSafety?.rawInstructionAutoExecutionAllowed !== false
        || value?.linkage?.actionScopeDigest !== providerCostControlBoundary.scope.actionScopeDigest
        || value?.linkage?.resourceBindingId !== providerCostControlBoundary.scope.resourceBindingId
        || value?.linkage?.decisionDigest
            !== providerActionSafetyBoundary.decisionLinkage.decisionDigest
        || value?.linkage?.actionIntentDigest
            !== providerActionSafetyBoundary.decisionLinkage.actionIntentDigest
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_asset_authority_policy_sponsor_separation',
        payerPolicyId: String(value.payerPolicyId),
        payerPolicyDigest: String(value.payerPolicyDigest),
        economicBearer: String(value.economicBearer),
        sponsorRole: value.sponsorRole as 'explicit_relayer_from_payer_policy' | 'not_configured',
        sponsorReceiptDigest: String(value.sponsorReceiptDigest),
        assetAuthority: {
            ownerIssuerMintFreezeUpdateSource: 'asset_authority_policy_required',
            currentActionAssetOutflow: 'zero_outflow_current_vertical',
            restrictedMintOperation: value.assetAuthority.restrictedMintOperation as
                | 'governance_weight_no_real_asset_requires_separate_resource_authority'
                | 'not_present_current_provider_action',
            materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case',
        },
        sponsorSeparation: {
            sponsorMayPayFees: true,
            sponsorAuthorityGain: 'none',
            feePayerSignerRefExposed: false,
            sponsorMayControlToken: false,
            sponsorMayControlMetadata: false,
            sponsorMayControlProgram: false,
            sponsorMayControlGovernanceAuthority: false,
            longLivedUniversalKeyAllowed: false,
        },
        actionSafety: {
            providerModule: value.actionSafety.providerModule as
                'realms_provider_binding' | 'squads_provider_binding',
            reviewedAdapter: value.actionSafety.reviewedAdapter as
                'realms_provider_binding' | 'squads_provider_binding',
            actionCount,
            assetConservation: 'zero_outflow_current_vertical',
            maxOutflowLamports: 0,
            opaqueInstructionsAllowed: false,
            rawInstructionAutoExecutionAllowed: false,
        },
        linkage: {
            actionScopeDigest: String(value.linkage.actionScopeDigest),
            resourceBindingId: value.linkage.resourceBindingId === null
                ? null
                : String(value.linkage.resourceBindingId),
            decisionDigest: String(value.linkage.decisionDigest),
            actionIntentDigest: String(value.linkage.actionIntentDigest),
        },
    };
}

function normalizeGovernanceProviderPreSignStateReadback(
    value: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['preSignStateReadback']> | null {
    if (value == null) return null;
    const digests = Array.isArray(value?.statePreconditionDigests)
        ? value.statePreconditionDigests
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'persisted_cost_preflight_and_provider_receipt'
        || value?.state !== 'verified'
        || !String(value?.resourceBindingId ?? '').trim()
        || !Number.isSafeInteger(value?.latestObservedSlot)
        || value.latestObservedSlot <= 0
        || !Number.isSafeInteger(value?.signatureCheckCount)
        || value.signatureCheckCount <= 0
        || digests.length !== value.signatureCheckCount
        || digests.some((digest: unknown) => !isSha256Digest(String(digest ?? '')))
        || value?.checks?.finalizedProviderQuote !== true
        || value?.checks?.currentFeePayerBalance !== true
        || value?.checks?.canonicalResourceAuthorityPayer !== true
        || value?.checks?.currentTrustProfile !== true
        || value?.checks?.p05AuthorityHealthAndFreeze !== true
        || value?.checks?.messageAndManifestBound !== true
        || value?.emergencyFreeze !== 'clear_fresh_p05_authority_health'
        || value?.executionAllowedAtSignature !== true
    ) return null;
    return value;
}

function normalizeGovernanceProviderExecutionExpiry(
    value: any,
): NonNullable<GovernanceProviderExecutionReadback['expiry']> | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || value?.state !== 'execution_expired'
        || value?.authority !== 'solana_rpc_finalized_block_height_and_missing_signature_status'
        || value?.commitment !== 'finalized'
        || !isSha256Digest(String(value?.planDigest ?? ''))
        || !String(value?.stepId ?? '').trim()
        || !isSha256Digest(String(value?.manifestDigest ?? ''))
        || !isSha256Digest(String(value?.messageDigest ?? ''))
        || String(value?.providerReference ?? '').length < 64
        || String(value?.providerReference ?? '').length > 100
        || !Number.isSafeInteger(value?.lastValidBlockHeight)
        || value.lastValidBlockHeight < 0
        || !Number.isSafeInteger(value?.observedBlockHeight)
        || value.observedBlockHeight <= value.lastValidBlockHeight
        || value?.signatureStatus !== 'not_found'
        || value?.providerEffect !== 'not_observed'
        || value?.automaticRetryAllowed !== false
        || value?.sameIntentRetry !== 'manual_only'
        || value?.nextGate !== 'manual_same_intent_retry_or_governed_terminal_abandonment'
    ) return null;
    return {
        schemaVersion: 1,
        state: 'execution_expired',
        authority: 'solana_rpc_finalized_block_height_and_missing_signature_status',
        commitment: 'finalized',
        planDigest: String(value.planDigest),
        stepId: String(value.stepId),
        manifestDigest: String(value.manifestDigest),
        messageDigest: String(value.messageDigest),
        providerReference: String(value.providerReference),
        lastValidBlockHeight: Number(value.lastValidBlockHeight),
        observedBlockHeight: Number(value.observedBlockHeight),
        signatureStatus: 'not_found',
        providerEffect: 'not_observed',
        automaticRetryAllowed: false,
        sameIntentRetry: 'manual_only',
        nextGate: 'manual_same_intent_retry_or_governed_terminal_abandonment',
    };
}

function normalizeGovernanceProviderPrivateEvidenceRelease(
    value: any,
): GovernanceProviderExecutionReadback['privateEvidenceRelease'] | null {
    if (value == null) return null;
    const status = String(value?.status ?? '');
    const integrity = String(value?.integrity ?? '');
    const provider = String(value?.provider ?? '');
    const authorization = value?.authorization;
    const providerResult = value?.providerResult;
    const deletionReceipt = value?.deletionReceipt;
    const completionAuthority = String(value?.completionAuthority ?? '');
    if (
        value?.schemaVersion !== 1
        || !['not_sent', 'sent', 'blocked'].includes(status)
        || !['verified', 'invalid'].includes(integrity)
        || !['realms_provider_binding', 'squads_provider_binding'].includes(provider)
        || (value?.blocker !== null && !String(value?.blocker ?? '').trim())
        || !String(value?.purpose ?? '').trim()
        || !isSha256Digest(String(value?.minimumPayloadDigest ?? ''))
        || authorization?.authority !== 'governance_case_frozen_evidence_policy'
        || !isSha256Digest(String(authorization?.authorizationDigest ?? ''))
        || (authorization?.packageCount !== null
            && !Number.isSafeInteger(Number(authorization?.packageCount)))
        || (value?.sentAt !== null && !Number.isFinite(Date.parse(String(value.sentAt))))
        || ![
            'not_applicable_no_private_evidence_sent',
            'provider_result_and_deletion_receipt',
            'provider_result_and_deletion_receipt_required',
        ].includes(completionAuthority)
        || value?.httpSuccessSelfProvesCompletion !== false
    ) return null;
    if (status === 'not_sent') {
        if (
            integrity !== 'verified'
            || value.blocker !== null
            || authorization.packageCount !== 0
            || value.sentAt !== null
            || providerResult !== null
            || deletionReceipt?.authority !== 'provider_native_deletion_or_retention_receipt'
            || deletionReceipt?.status !== 'not_required_not_sent'
            || deletionReceipt?.receiptDigest !== null
            || deletionReceipt?.receivedAt !== null
            || completionAuthority !== 'not_applicable_no_private_evidence_sent'
        ) return null;
    } else if (status === 'sent') {
        if (
            integrity !== 'verified'
            || value.blocker !== null
            || !Number.isFinite(Date.parse(String(value.sentAt)))
            || providerResult?.source !== 'provider_native_result'
            || !String(providerResult?.status ?? '').trim()
            || !Number.isFinite(Date.parse(String(providerResult?.receivedAt)))
            || deletionReceipt?.authority !== 'provider_native_deletion_or_retention_receipt'
            || !String(deletionReceipt?.status ?? '').trim()
            || (deletionReceipt?.receiptDigest !== null
                && !isSha256Digest(String(deletionReceipt?.receiptDigest ?? '')))
            || (deletionReceipt?.receivedAt !== null
                && !Number.isFinite(Date.parse(String(deletionReceipt?.receivedAt))))
            || completionAuthority !== 'provider_result_and_deletion_receipt'
        ) return null;
    } else if (
        integrity !== 'invalid'
        || !String(value.blocker ?? '').trim()
        || value.sentAt !== null
        || providerResult !== null
        || deletionReceipt !== null
        || completionAuthority !== 'provider_result_and_deletion_receipt_required'
    ) return null;
    return {
        schemaVersion: 1,
        status: status as 'not_sent' | 'sent' | 'blocked',
        integrity: integrity as 'verified' | 'invalid',
        blocker: value.blocker == null ? null : String(value.blocker),
        provider: provider as 'realms_provider_binding' | 'squads_provider_binding',
        purpose: String(value.purpose),
        minimumPayloadDigest: String(value.minimumPayloadDigest),
        authorization: {
            authority: 'governance_case_frozen_evidence_policy',
            authorizationDigest: String(authorization.authorizationDigest),
            packageCount: authorization.packageCount === null
                ? null
                : Number(authorization.packageCount),
        },
        sentAt: value.sentAt === null ? null : String(value.sentAt),
        providerResult: providerResult === null ? null : {
            source: 'provider_native_result',
            status: String(providerResult.status),
            receivedAt: String(providerResult.receivedAt),
        },
        deletionReceipt: deletionReceipt === null ? null : {
            authority: 'provider_native_deletion_or_retention_receipt',
            status: String(deletionReceipt.status),
            receiptDigest: deletionReceipt.receiptDigest === null
                ? null
                : String(deletionReceipt.receiptDigest),
            receivedAt: deletionReceipt.receivedAt === null
                ? null
                : String(deletionReceipt.receivedAt),
        },
        completionAuthority: completionAuthority as NonNullable<
            GovernanceProviderExecutionReadback['privateEvidenceRelease']
        >['completionAuthority'],
        httpSuccessSelfProvesCompletion: false,
    };
}

function normalizeGovernanceProviderExecutionAttempts(
    attempts: any,
): GovernanceProviderExecutionReadback['attempts'] {
    return {
        total: Number(attempts.total),
        failed: Number(attempts.failed),
        history: attempts.history.map((attempt: any) => ({
            receiptId: attempt?.receiptId == null ? null : String(attempt.receiptId),
            status: ['executed', 'failed', 'skipped'].includes(attempt?.status)
                ? attempt.status
                : 'unavailable',
            errorCode: attempt?.errorCode == null ? null : String(attempt.errorCode),
            executedAt: attempt?.executedAt == null ? null : String(attempt.executedAt),
        })),
    };
}

function normalizeGovernanceProviderExecutionLinkage(
    linkage: any,
): GovernanceProviderExecutionReadback['linkage'] {
    return {
        caseRef: linkage.caseRef == null ? null : String(linkage.caseRef),
        stageRef: linkage.stageRef == null ? null : String(linkage.stageRef),
        artifactStatus: 'not_applicable_provider_binding_activation',
        artifactRef: null,
    };
}

function normalizeGovernanceProviderExecutionReadback(
    value: any,
): GovernanceProviderExecutionReadback | null {
    if (value == null) return null;
    const status = String(value?.status ?? '');
    const integrity = String(value?.integrity ?? '');
    const attempts = value?.attempts;
    const linkage = value?.linkage;
    if (
        value?.schemaVersion !== 1
        || !['executed', 'failed', 'execution_expired', 'held'].includes(status)
        || !['verified', 'invalid'].includes(integrity)
        || !attempts
        || !Number.isSafeInteger(attempts.total)
        || !Number.isSafeInteger(attempts.failed)
        || !Array.isArray(attempts.history)
        || !linkage
        || linkage.artifactStatus !== 'not_applicable_provider_binding_activation'
        || linkage.artifactRef !== null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const provider = value?.provider;
    const decisionMapping = value?.decisionMapping;
    const reconciliation = value?.reconciliation;
    const retry = value?.retry;
    if (retry != null && (
        status !== 'failed'
        || retry?.mode !== 'same_request_only'
        || typeof retry?.requestId !== 'string'
        || !retry.requestId.trim()
        || !Number.isSafeInteger(retry?.attemptCount)
        || retry.attemptCount <= 0
        || typeof retry?.lastAttemptAt !== 'string'
        || !Number.isFinite(Date.parse(retry.lastAttemptAt))
        || typeof retry?.nextRetryAt !== 'string'
        || !Number.isFinite(Date.parse(retry.nextRetryAt))
        || Date.parse(retry.nextRetryAt) < Date.parse(retry.lastAttemptAt)
    )) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const recoveryValue = value?.recovery;
    const recovery = normalizeGovernanceProviderRecovery(recoveryValue);
    if (recoveryValue != null && recovery === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const expiryValue = value?.expiry;
    const expiry = normalizeGovernanceProviderExecutionExpiry(expiryValue);
    if (expiryValue != null && expiry === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const privateEvidenceRelease = normalizeGovernanceProviderPrivateEvidenceRelease(
        value?.privateEvidenceRelease,
    );
    if (value?.privateEvidenceRelease != null && privateEvidenceRelease === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    if (status === 'execution_expired') {
        if (
            integrity !== 'verified'
            || value?.blocker !== 'realms_provider_blockhash_expired'
            || expiry === null
            || retry != null
            || provider != null
            || decisionMapping != null
            || reconciliation != null
            || value?.effect != null
            || recovery?.category !== 'blockhash_expired'
            || recovery?.action !== 'prepare_same_request_rebuild_after_authoritative_expiry'
            || recovery?.retryMode !== 'same_request_only'
            || !isSha256Digest(String(value?.evidenceDigest ?? ''))
        ) throw new Error('invalid_governance_provider_execution_readback');
        return {
            schemaVersion: 1,
            status: 'execution_expired',
            integrity: 'verified',
            blocker: 'realms_provider_blockhash_expired',
            receiptId: value?.receiptId == null ? null : String(value.receiptId),
            evidenceDigest: String(value.evidenceDigest),
            executedAt: value?.executedAt == null ? null : String(value.executedAt),
            expiry,
            ...(privateEvidenceRelease ? { privateEvidenceRelease } : {}),
            recovery,
            attempts: normalizeGovernanceProviderExecutionAttempts(attempts),
            linkage: normalizeGovernanceProviderExecutionLinkage(linkage),
        };
    }
    if (expiry !== null) throw new Error('invalid_governance_provider_execution_readback');
    const challengeEffect = value?.effect === 'realms_voting_power_challenge_reopened';
    const votingPowerChallenge = reconciliation?.votingPowerChallenge;
    const votingPowerSecurity = normalizeRealmsVotingPowerSecurityProfile(
        reconciliation?.votingPowerSecurity,
    );
    const providerIncident = normalizeGovernanceProviderIncident(
        reconciliation?.providerIncident,
    );
    const reconciliationFallback = normalizeGovernanceProviderReconciliationFallback(
        reconciliation?.reconciliationFallback,
    );
    const trustProfile = normalizeGovernanceProviderTrustProfile(provider?.trustProfile);
    const providerResourceLifecycle = normalizeGovernanceProviderResourceLifecycle(
        provider?.providerResourceLifecycle,
        provider,
        value,
    );
    if (provider?.providerResourceLifecycle != null && providerResourceLifecycle === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const executionAuthorities = normalizeGovernanceProviderExecutionAuthorities(
        provider?.executionAuthorities,
    );
    const authorityPaymentBoundary = normalizeGovernanceProviderAuthorityPaymentBoundary(
        provider?.authorityPaymentBoundary,
    );
    if (provider?.authorityPaymentBoundary != null && authorityPaymentBoundary === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const mandateCostPolicy = normalizeGovernanceProviderMandateCostPolicy(
        provider?.mandateCostPolicy,
    );
    if (provider?.mandateCostPolicy != null && mandateCostPolicy === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const fundingSourceFeePayerBoundary = normalizeGovernanceProviderFundingSourceFeePayerBoundary(
        provider?.fundingSourceFeePayerBoundary,
    );
    if (
        provider?.fundingSourceFeePayerBoundary != null
        && fundingSourceFeePayerBoundary === null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const preSignStateReadback = normalizeGovernanceProviderPreSignStateReadback(
        provider?.preSignStateReadback,
    );
    if (provider?.preSignStateReadback != null && preSignStateReadback === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const expiredAttemptHistory = normalizeGovernanceProviderExpiredAttemptHistory(
        provider?.expiredAttemptHistory,
    );
    if (provider?.expiredAttemptHistory != null && expiredAttemptHistory === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const transactionStatePreconditions = Array.isArray(provider?.transactions)
        ? provider.transactions.map((transaction: any) => (
            normalizeGovernanceDelegationStatePrecondition(
                transaction?.statePrecondition,
                transaction,
                provider,
            )
        ))
        : [];
    if (Array.isArray(provider?.transactions) && provider.transactions.some(
        (transaction: any, index: number) => (
            transaction?.statePrecondition != null
            && transactionStatePreconditions[index] === null
        ),
    )) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const proposalTransactionReadback = normalizeGovernanceProviderProposalTransactionReadback(
        provider?.proposalTransactionReadback,
        provider?.transactions,
    );
    if (
        provider?.proposalTransactionReadback != null
        && proposalTransactionReadback === null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const enforcementDisclosure = normalizeGovernanceProviderEnforcementDisclosure(
        provider?.enforcementDisclosure,
    );
    if (provider?.enforcementDisclosure != null && (
        enforcementDisclosure === null
        || enforcementDisclosure.providerModule !== provider?.module
        || enforcementDisclosure.resourceRef !== provider?.resourceRef
        || enforcementDisclosure.ownerProgramRef !== provider?.ownerProgramRef
        || enforcementDisclosure.version !== provider?.profileVersion
    )) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const costReconciliation = normalizeGovernanceProviderCostReconciliation(
        provider?.costReconciliation,
        provider?.transactions,
    );
    if (provider?.costReconciliation != null && costReconciliation === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const attemptOwner = normalizeGovernanceProviderTerminalAttemptOwner(provider?.attemptOwner);
    if (provider?.attemptOwner != null && attemptOwner === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const retryBoundary = normalizeGovernanceProviderRetryBoundary(provider?.retryBoundary);
    if (provider?.retryBoundary != null && retryBoundary === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const executionPlanReadback = normalizeGovernanceProviderExecutionPlanReadback(
        provider?.executionPlanReadback,
        provider,
        attemptOwner,
        retryBoundary,
    );
    if (provider?.executionPlanReadback != null && executionPlanReadback === null) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const providerActionSafetyBoundary = normalizeGovernanceProviderActionSafetyBoundary(
        provider?.providerActionSafetyBoundary,
        provider,
        executionPlanReadback,
        retryBoundary,
    );
    if (
        provider?.providerActionSafetyBoundary != null
        && providerActionSafetyBoundary === null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const servicePayerAuthorityBoundary = normalizeGovernanceServicePayerAuthorityBoundary(
        provider?.servicePayerAuthorityBoundary,
        authorityPaymentBoundary,
        fundingSourceFeePayerBoundary,
        costReconciliation,
        providerActionSafetyBoundary,
        retryBoundary,
    );
    if (
        provider?.servicePayerAuthorityBoundary != null
        && servicePayerAuthorityBoundary === null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const providerCostControlBoundary = normalizeGovernanceProviderCostControlBoundary(
        provider?.providerCostControlBoundary,
        costReconciliation,
        provider?.resourceRef,
    );
    if (
        provider?.providerCostControlBoundary != null
        && providerCostControlBoundary === null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    const assetAuthoritySponsorBoundary = normalizeGovernanceAssetAuthoritySponsorBoundary(
        provider?.assetAuthoritySponsorBoundary,
        servicePayerAuthorityBoundary,
        providerCostControlBoundary,
        providerActionSafetyBoundary,
    );
    if (
        provider?.assetAuthoritySponsorBoundary != null
        && assetAuthoritySponsorBoundary === null
    ) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    if (provider?.module === 'squads_provider_binding') {
        const transactions = provider?.transactions;
        const grantSettlement = value?.grantSettlement;
        const grantPayoutProviderSteps = [
            'payout_create_vault_transaction',
            'payout_create_proposal',
            'payout_approve_by_proposer',
            'payout_approve_by_approver',
            'payout_execute_vault_transaction',
        ];
        if (value?.effect === 'squads_devnet_grant_payout_finalized') {
            const hasFaucetFunding = transactions?.[0]?.stepId === 'devnet_faucet_funding';
            const grantPayoutSteps = hasFaucetFunding
                ? ['devnet_faucet_funding', ...grantPayoutProviderSteps]
                : grantPayoutProviderSteps;
            if (
                status !== 'executed'
                || integrity !== 'verified'
                || value?.blocker !== null
                || provider?.chainId !== 'solana:devnet'
                || provider?.finality !== 'finalized'
                || !String(provider?.profileRef || '').trim()
                || !Number.isSafeInteger(provider?.profileVersion)
                || provider.profileVersion <= 0
                || !String(provider?.resourceRef || '').trim()
                || !String(provider?.ownerProgramRef || '').trim()
                || !Number.isSafeInteger(provider?.observedSlot)
                || provider.observedSlot <= 0
                || provider?.lastTransactionSlot !== provider.observedSlot
                || !/^[a-f0-9]{64}$/.test(String(provider?.stateDigest || ''))
                || provider?.proposalState !== 'executed'
                || provider?.vaultTransactionState !== 'executed'
                || provider?.approvedMemberCount !== 2
                || provider?.noRealAssets !== true
                || provider?.transactionCount !== grantPayoutSteps.length
                || !Array.isArray(transactions)
                || transactions.length !== grantPayoutSteps.length
                || transactions.some((transaction: any, index: number) => (
                    transaction?.stepId !== grantPayoutSteps[index]
                    || !String(transaction?.signature || '').trim()
                    || !Number.isSafeInteger(transaction?.slot)
                    || transaction.slot <= 0
                    || (hasFaucetFunding && index === 0
                        ? transaction.slot > provider.observedSlot
                        : !/^[a-f0-9]{64}$/.test(String(transaction?.messageDigest || ''))
                            || !/^[a-f0-9]{64}$/.test(String(transaction?.manifestDigest || ''))
                            || !validProviderFinalityTransitions(
                                transaction?.finalityTransitions,
                                transaction?.slot,
                            ))
                ))
                || transactions.at(-1)?.slot !== provider.observedSlot
                || decisionMapping != null
                || !grantSettlement
                || !String(grantSettlement?.agreementId || '').trim()
                || !String(grantSettlement?.trancheIntentId || '').trim()
                || !String(grantSettlement?.resourceBindingId || '').trim()
                || !String(grantSettlement?.recipient || '').trim()
                || !/^[1-9][0-9]*$/.test(String(grantSettlement?.amountLamports || ''))
                || !['solana_devnet_faucet', 'existing_finalized_balance']
                    .includes(grantSettlement?.fundingSource)
                || (hasFaucetFunding !== (grantSettlement?.fundingSource === 'solana_devnet_faucet'))
                || !/^[0-9]+$/.test(String(grantSettlement?.vaultBalanceAfterLamports || ''))
                || !/^[0-9]+$/.test(String(grantSettlement?.recipientBalanceAfterLamports || ''))
                || !String(grantSettlement?.payoutSignature || '').trim()
                || grantSettlement.payoutSignature !== transactions.at(-1)?.signature
                || grantSettlement?.payoutSlot !== provider.observedSlot
                || grantSettlement?.canonicalFundingStatus !== 'paid'
                || reconciliation?.state !== 'verified'
                || reconciliation?.blocker !== null
                || reconciliation?.authority !== 'independent_provider_readback'
                || reconciliation?.observedStateDigest !== provider.stateDigest
                || reconciliation?.observedSlot !== provider.observedSlot
                || reconciliation?.accountSemantics !== null
                || reconciliation?.votingPowerSecurity !== null
                || reconciliation?.votingPowerChallenge !== null
                || !String(reconciliation?.observedAt || '').trim()
            ) {
                throw new Error('invalid_governance_provider_execution_readback');
            }
            return {
                schemaVersion: 1,
                status: 'executed',
                integrity: 'verified',
                blocker: null,
                receiptId: value?.receiptId == null ? null : String(value.receiptId),
                evidenceDigest: value?.evidenceDigest == null ? null : String(value.evidenceDigest),
                executedAt: value?.executedAt == null ? null : String(value.executedAt),
                effect: 'squads_devnet_grant_payout_finalized',
                ...(privateEvidenceRelease ? { privateEvidenceRelease } : {}),
                provider: {
                    module: 'squads_provider_binding',
                    chainId: 'solana:devnet',
                    profileRef: String(provider.profileRef),
                    profileVersion: Number(provider.profileVersion),
                    finality: 'finalized',
                    resourceRef: String(provider.resourceRef),
                    ownerProgramRef: String(provider.ownerProgramRef),
                    observedSlot: Number(provider.observedSlot),
                    lastTransactionSlot: Number(provider.lastTransactionSlot),
                    stateDigest: String(provider.stateDigest),
                    proposalState: 'executed',
                    vaultTransactionState: 'executed',
                    approvedMemberCount: 2,
                    noRealAssets: true,
                    transactionCount: grantPayoutSteps.length,
                    transactions: transactions.map((transaction: any, index: number) => ({
                        stepId: String(transaction.stepId),
                        signature: String(transaction.signature),
                        slot: Number(transaction.slot),
                        ...(hasFaucetFunding && index === 0 ? {
                            messageDigest: '',
                            manifestDigest: '',
                            finalityTransitions: [],
                        } : {
                            messageDigest: String(transaction.messageDigest),
                            manifestDigest: String(transaction.manifestDigest),
                            finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
                                state: transition.state as 'submitted' | 'confirmed' | 'finalized',
                                authority: transition.authority as
                                    | 'provider_signature_readback'
                                    | 'solana_rpc_signature_status'
                                    | 'solana_rpc_finalized_transaction',
                                ...(transition.slot === undefined
                                    ? {}
                                    : { slot: Number(transition.slot) }),
                            })),
                        }),
                    })),
                    ...(proposalTransactionReadback ? { proposalTransactionReadback } : {}),
                    ...(executionPlanReadback ? { executionPlanReadback } : {}),
                    ...(providerActionSafetyBoundary ? { providerActionSafetyBoundary } : {}),
                    ...(servicePayerAuthorityBoundary ? { servicePayerAuthorityBoundary } : {}),
                    ...(providerCostControlBoundary ? { providerCostControlBoundary } : {}),
                    ...(assetAuthoritySponsorBoundary ? { assetAuthoritySponsorBoundary } : {}),
                },
                grantSettlement: {
                    agreementId: String(grantSettlement.agreementId),
                    trancheIntentId: String(grantSettlement.trancheIntentId),
                    resourceBindingId: String(grantSettlement.resourceBindingId),
                    recipient: String(grantSettlement.recipient),
                    amountLamports: String(grantSettlement.amountLamports),
                    fundingSource: grantSettlement.fundingSource,
                    vaultBalanceAfterLamports: String(grantSettlement.vaultBalanceAfterLamports),
                    recipientBalanceAfterLamports: String(grantSettlement.recipientBalanceAfterLamports),
                    payoutSignature: String(grantSettlement.payoutSignature),
                    payoutSlot: Number(grantSettlement.payoutSlot),
                    canonicalFundingStatus: 'paid',
                },
                reconciliation: {
                    state: 'verified',
                    blocker: null,
                    authority: 'independent_provider_readback',
                    observedStateDigest: String(reconciliation.observedStateDigest),
                    observedSlot: Number(reconciliation.observedSlot),
                    accountSemantics: null,
                    votingPowerSecurity: null,
                    votingPowerChallenge: null,
                    providerIncident: null,
                    reconciliationFallback: null,
                    observedAt: String(reconciliation.observedAt),
                },
                attempts: {
                    total: Number(attempts.total),
                    failed: Number(attempts.failed),
                    history: attempts.history.map((attempt: any) => ({
                        receiptId: attempt?.receiptId == null ? null : String(attempt.receiptId),
                        status: ['executed', 'failed', 'skipped'].includes(attempt?.status)
                            ? attempt.status
                            : 'unavailable',
                        errorCode: attempt?.errorCode == null ? null : String(attempt.errorCode),
                        executedAt: attempt?.executedAt == null ? null : String(attempt.executedAt),
                    })),
                },
                linkage: {
                    caseRef: linkage.caseRef == null ? null : String(linkage.caseRef),
                    stageRef: linkage.stageRef == null ? null : String(linkage.stageRef),
                    artifactStatus: 'not_applicable_provider_binding_activation',
                    artifactRef: null,
                },
            };
        }
        const expectedSteps = [
            'create_multisig',
            'create_vault_transaction',
            'create_proposal',
            'approve_by_proposer',
            'approve_by_approver',
            'execute_vault_transaction',
        ];
        if (
            status !== 'executed'
            || integrity !== 'verified'
            || value?.effect !== 'squads_existing_no_asset_resource_adopted_finalized'
            || value?.blocker !== null
            || provider?.chainId !== 'solana:devnet'
            || provider?.finality !== 'finalized'
            || !String(provider?.profileRef || '').trim()
            || !Number.isSafeInteger(provider?.profileVersion)
            || provider.profileVersion <= 0
            || !String(provider?.resourceRef || '').trim()
            || !String(provider?.ownerProgramRef || '').trim()
            || !Number.isSafeInteger(provider?.observedSlot)
            || provider.observedSlot <= 0
            || !Number.isSafeInteger(provider?.lastTransactionSlot)
            || provider.lastTransactionSlot <= 0
            || provider.observedSlot < provider.lastTransactionSlot
            || !/^[a-f0-9]{64}$/.test(String(provider?.stateDigest || ''))
            || provider?.proposalState !== 'executed'
            || provider?.vaultTransactionState !== 'executed'
            || provider?.approvedMemberCount !== 2
            || provider?.noRealAssets !== true
            || provider?.transactionCount !== expectedSteps.length
            || !Array.isArray(transactions)
            || transactions.length !== expectedSteps.length
            || transactions.some((transaction: any, index: number) => (
                transaction?.stepId !== expectedSteps[index]
                || !String(transaction?.signature || '').trim()
                || !Number.isSafeInteger(transaction?.slot)
                || transaction.slot <= 0
                || (index > 0 && transaction.slot <= transactions[index - 1].slot)
                || !/^[a-f0-9]{64}$/.test(String(transaction?.messageDigest || ''))
                || !/^[a-f0-9]{64}$/.test(String(transaction?.manifestDigest || ''))
                || (transaction?.humanReadableAction != null
                    && normalizeGovernanceProviderHumanReadableAction(
                        transaction.humanReadableAction,
                        transaction,
                    ) === null)
                || (transaction?.actionContext != null
                    && normalizeGovernanceProviderActionContext(
                        transaction.actionContext,
                        transaction,
                        index,
                        transactions,
                    ) === null)
                || !validProviderFinalityTransitions(transaction?.finalityTransitions, transaction?.slot)
            ))
            || transactions.at(-1)?.slot !== provider.lastTransactionSlot
            || decisionMapping != null
            || reconciliation?.state !== 'verified'
            || reconciliation?.blocker !== null
            || reconciliation?.authority !== 'independent_provider_readback'
            || reconciliation?.observedStateDigest !== provider.stateDigest
            || reconciliation?.observedSlot !== provider.observedSlot
            || reconciliation?.accountSemantics !== null
            || reconciliation?.votingPowerSecurity !== null
            || reconciliation?.votingPowerChallenge !== null
            || !String(reconciliation?.observedAt || '').trim()
        ) {
            throw new Error('invalid_governance_provider_execution_readback');
        }
        return {
            schemaVersion: 1,
            status: 'executed',
            integrity: 'verified',
            blocker: null,
            receiptId: value?.receiptId == null ? null : String(value.receiptId),
            evidenceDigest: value?.evidenceDigest == null ? null : String(value.evidenceDigest),
            executedAt: value?.executedAt == null ? null : String(value.executedAt),
            effect: 'squads_existing_no_asset_resource_adopted_finalized',
            ...(privateEvidenceRelease ? { privateEvidenceRelease } : {}),
            provider: {
                module: 'squads_provider_binding',
                chainId: 'solana:devnet',
                profileRef: String(provider.profileRef),
                profileVersion: Number(provider.profileVersion),
                finality: 'finalized',
                resourceRef: String(provider.resourceRef),
                ownerProgramRef: String(provider.ownerProgramRef),
                observedSlot: Number(provider.observedSlot),
                lastTransactionSlot: Number(provider.lastTransactionSlot),
                stateDigest: String(provider.stateDigest),
                proposalState: 'executed',
                vaultTransactionState: 'executed',
                approvedMemberCount: 2,
                noRealAssets: true,
                transactionCount: expectedSteps.length,
                ...(providerResourceLifecycle ? { providerResourceLifecycle } : {}),
                ...(proposalTransactionReadback ? { proposalTransactionReadback } : {}),
                ...(executionPlanReadback ? { executionPlanReadback } : {}),
                ...(providerActionSafetyBoundary ? { providerActionSafetyBoundary } : {}),
                ...(servicePayerAuthorityBoundary ? { servicePayerAuthorityBoundary } : {}),
                ...(providerCostControlBoundary ? { providerCostControlBoundary } : {}),
                ...(assetAuthoritySponsorBoundary ? { assetAuthoritySponsorBoundary } : {}),
                transactions: transactions.map((transaction: any) => ({
                    stepId: String(transaction.stepId),
                    signature: String(transaction.signature),
                    slot: Number(transaction.slot),
                    messageDigest: String(transaction.messageDigest),
                    manifestDigest: String(transaction.manifestDigest),
                    ...(normalizeGovernanceProviderTransactionAttemptContext(
                        transaction.attemptContext,
                        transaction,
                    ) ? {
                            attemptContext: normalizeGovernanceProviderTransactionAttemptContext(
                                transaction.attemptContext,
                                transaction,
                            )!,
                        } : {}),
                    ...(normalizeGovernanceProviderHumanReadableAction(
                        transaction.humanReadableAction,
                        transaction,
                    ) ? {
                            humanReadableAction: normalizeGovernanceProviderHumanReadableAction(
                                transaction.humanReadableAction,
                                transaction,
                            )!,
                        } : {}),
                    ...(normalizeGovernanceProviderActionContext(
                        transaction.actionContext,
                        transaction,
                        transactions.indexOf(transaction),
                        transactions,
                    ) ? {
                            actionContext: normalizeGovernanceProviderActionContext(
                                transaction.actionContext,
                                transaction,
                                transactions.indexOf(transaction),
                                transactions,
                            )!,
                        } : {}),
                    finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
                        state: transition.state as 'submitted' | 'confirmed' | 'finalized',
                        authority: transition.authority as
                            | 'provider_signature_readback'
                            | 'solana_rpc_signature_status'
                            | 'solana_rpc_finalized_transaction',
                        ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
                    })),
                    })),
                ...(trustProfile ? { trustProfile } : {}),
                ...(executionAuthorities ? { executionAuthorities } : {}),
                ...(authorityPaymentBoundary ? { authorityPaymentBoundary } : {}),
                ...(mandateCostPolicy ? { mandateCostPolicy } : {}),
                ...(fundingSourceFeePayerBoundary ? { fundingSourceFeePayerBoundary } : {}),
                ...(enforcementDisclosure ? { enforcementDisclosure } : {}),
                ...(costReconciliation ? { costReconciliation } : {}),
                ...(attemptOwner ? { attemptOwner } : {}),
                ...(retryBoundary ? { retryBoundary } : {}),
            },
            reconciliation: {
                state: 'verified',
                blocker: null,
                authority: 'independent_provider_readback',
                observedStateDigest: String(reconciliation.observedStateDigest),
                observedSlot: Number(reconciliation.observedSlot),
                accountSemantics: null,
                votingPowerSecurity: null,
                votingPowerChallenge: null,
                providerIncident: null,
                reconciliationFallback: null,
                observedAt: String(reconciliation.observedAt),
            },
            attempts: {
                total: Number(attempts.total),
                failed: Number(attempts.failed),
                history: attempts.history.map((attempt: any) => ({
                    receiptId: attempt?.receiptId == null ? null : String(attempt.receiptId),
                    status: ['executed', 'failed', 'skipped'].includes(attempt?.status)
                        ? attempt.status
                        : 'unavailable',
                    errorCode: attempt?.errorCode == null ? null : String(attempt.errorCode),
                    executedAt: attempt?.executedAt == null ? null : String(attempt.executedAt),
                })),
            },
            linkage: {
                caseRef: linkage.caseRef == null ? null : String(linkage.caseRef),
                stageRef: linkage.stageRef == null ? null : String(linkage.stageRef),
                artifactStatus: 'not_applicable_provider_binding_activation',
                artifactRef: null,
            },
        };
    }
    if (status === 'executed' && (
        integrity !== 'verified'
        || provider?.module !== 'realms_provider_binding'
        || provider?.chainId !== 'solana:devnet'
        || provider?.finality !== 'finalized'
        || provider?.proposalState !== 'completed'
        || provider?.instructionExecutionStatus !== 'success'
        || provider?.noRealAssets !== true
        || !Array.isArray(provider?.transactions)
        || provider.transactions.length !== Number(provider?.transactionCount)
        || provider.transactions.some((transaction: any, index: number) => (
            !validProviderFinalityTransitions(transaction?.finalityTransitions, transaction?.slot)
            || (transaction?.humanReadableAction != null
                && normalizeGovernanceProviderHumanReadableAction(
                    transaction.humanReadableAction,
                    transaction,
                ) === null)
            || (transaction?.actionContext != null
                && normalizeGovernanceProviderActionContext(
                    transaction.actionContext,
                    transaction,
                    index,
                    provider.transactions,
                ) === null)
        ))
        || (!challengeEffect && (
            decisionMapping?.sourceMechanism?.kind !== 'equal_weight_threshold'
        || !/^[a-f0-9]{64}$/.test(String(decisionMapping?.sourceDecisionDigest || ''))
        || !/^[a-f0-9]{64}$/.test(String(decisionMapping?.sourceMechanism?.contractDigest || ''))
        || !/^[a-f0-9]{64}$/.test(String(decisionMapping?.sourceMechanism?.resultDigest || ''))
        || !String(decisionMapping?.providerProposalRef || '').trim()
        || !String(decisionMapping?.providerVoteRecordRef || '').trim()
        || !String(decisionMapping?.providerVoterTokenOwnerRecordRef || '').trim()
        || decisionMapping?.providerVote !== 'approve'
        || !/^\d+$/.test(String(decisionMapping?.yesVoteWeight || ''))
        || !/^\d+$/.test(String(decisionMapping?.voterWeight || ''))
        || decisionMapping?.providerResult !== 'completed'
        || decisionMapping?.authorityBoundary !== 'governance_voter_authorizes_request_provider_authority_executes_decision'
        ))
        || (challengeEffect && (
            decisionMapping != null
            || provider.transactionCount !== 0
            || provider.lastTransactionSlot !== null
            || votingPowerChallenge?.state !== 'reopened'
            || typeof votingPowerChallenge?.requestId !== 'string'
            || !votingPowerChallenge.requestId.trim()
            || !Number.isSafeInteger(votingPowerChallenge?.preObservedSlot)
            || votingPowerChallenge.preObservedSlot <= 0
            || !Number.isSafeInteger(votingPowerChallenge?.postObservedSlot)
            || votingPowerChallenge.postObservedSlot <= 0
            || votingPowerChallenge.historicalTallyInvariant !== 'unchanged'
            || votingPowerChallenge.blocker !== null
        ))
    )) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    if (reconciliation != null && (
        !['verified', 'hold'].includes(String(reconciliation?.state ?? ''))
        || !['provider_readback_outage', 'provider_readback_conflict', null]
            .includes(reconciliation?.blocker ?? null)
        || reconciliation?.authority !== 'independent_provider_readback'
        || !String(reconciliation?.observedAt ?? '').trim()
        || (reconciliation?.providerIncident != null && providerIncident === null)
        || (reconciliation?.reconciliationFallback != null && reconciliationFallback === null)
        || (
            (reconciliation?.providerIncident != null || reconciliation?.profileRevalidation != null)
            && reconciliationFallback === null
        )
        || (providerIncident !== null && (
            reconciliation.state === 'verified'
                ? providerIncident.lifecycleState !== 'reconciled'
                    || providerIncident.pendingExecution !== 'eligible_after_reconciliation'
                : providerIncident.lifecycleState === 'reconciled'
                    || providerIncident.pendingExecution !== 'blocked'
        ))
        || (reconciliation.state === 'verified' && (
            reconciliation.blocker !== null
            || !/^[a-f0-9]{64}$/.test(String(reconciliation.observedStateDigest ?? ''))
            || !Number.isSafeInteger(reconciliation.observedSlot)
            || reconciliation.observedSlot <= 0
            || reconciliation.accountSemantics?.signatoryRecord
                !== 'not_applicable_direct_governance_authority_signoff'
            || reconciliation.accountSemantics?.voterWeightAddin !== 'not_configured'
            || reconciliation.accountSemantics?.maxVoterWeightAddin !== 'not_configured'
            || reconciliation.accountSemantics?.customPlugins !== 'unavailable'
            || votingPowerSecurity === null
            || votingPowerSecurity.source.chainId !== provider?.chainId
            || votingPowerSecurity.source.profileRef !== provider?.profileRef
            || votingPowerSecurity.source.profileVersion !== provider?.profileVersion
            || votingPowerSecurity.source.programId !== provider?.ownerProgramRef
            || votingPowerSecurity.source.realm !== provider?.resourceRef
            || votingPowerSecurity.source.snapshotSlot !== reconciliation.observedSlot
        ))
        || (reconciliation.state === 'hold' && (
            !['provider_readback_outage', 'provider_readback_conflict'].includes(reconciliation.blocker)
            || reconciliation.observedStateDigest !== null
            || reconciliation.observedSlot !== null
            || reconciliation.accountSemantics !== null
            || votingPowerSecurity !== null
        ))
    )) {
        throw new Error('invalid_governance_provider_execution_readback');
    }
    return {
        schemaVersion: 1,
        status: status as GovernanceProviderExecutionReadback['status'],
        integrity: integrity as GovernanceProviderExecutionReadback['integrity'],
        blocker: value?.blocker == null ? null : String(value.blocker),
        receiptId: value?.receiptId == null ? null : String(value.receiptId),
        evidenceDigest: value?.evidenceDigest == null ? null : String(value.evidenceDigest),
        executedAt: value?.executedAt == null ? null : String(value.executedAt),
        ...(privateEvidenceRelease ? { privateEvidenceRelease } : {}),
        ...(retry == null ? {} : {
            retry: {
                mode: 'same_request_only',
                requestId: String(retry.requestId),
                attemptCount: Number(retry.attemptCount),
                lastAttemptAt: new Date(retry.lastAttemptAt).toISOString(),
                nextRetryAt: new Date(retry.nextRetryAt).toISOString(),
            },
        }),
        ...(recovery == null ? {} : { recovery }),
        ...(value?.effect == null ? {} : { effect: String(value.effect) }),
        ...(provider == null ? {} : {
            provider: {
                module: 'realms_provider_binding',
                chainId: 'solana:devnet',
                profileRef: String(provider.profileRef),
                profileVersion: Number(provider.profileVersion),
                finality: 'finalized',
                resourceRef: String(provider.resourceRef),
                ownerProgramRef: String(provider.ownerProgramRef),
                observedSlot: Number(provider.observedSlot),
                lastTransactionSlot: provider.lastTransactionSlot == null
                    ? null
                    : Number(provider.lastTransactionSlot),
                stateDigest: String(provider.stateDigest),
                proposalState: 'completed',
                instructionExecutionStatus: 'success',
                noRealAssets: true,
                transactionCount: Number(provider.transactionCount),
                ...(providerResourceLifecycle ? { providerResourceLifecycle } : {}),
                ...(proposalTransactionReadback ? { proposalTransactionReadback } : {}),
                ...(executionPlanReadback ? { executionPlanReadback } : {}),
                ...(providerActionSafetyBoundary ? { providerActionSafetyBoundary } : {}),
                ...(servicePayerAuthorityBoundary ? { servicePayerAuthorityBoundary } : {}),
                ...(providerCostControlBoundary ? { providerCostControlBoundary } : {}),
                ...(assetAuthoritySponsorBoundary ? { assetAuthoritySponsorBoundary } : {}),
                ...(expiredAttemptHistory ? { expiredAttemptHistory } : {}),
                transactions: provider.transactions.map((transaction: any, index: number) => ({
                    stepId: String(transaction.stepId),
                    signature: String(transaction.signature),
                    slot: Number(transaction.slot),
                    messageDigest: String(transaction.messageDigest),
                    manifestDigest: String(transaction.manifestDigest),
                    ...(normalizeGovernanceProviderTransactionAttemptContext(
                        transaction.attemptContext,
                        transaction,
                    ) ? {
                            attemptContext: normalizeGovernanceProviderTransactionAttemptContext(
                                transaction.attemptContext,
                                transaction,
                            )!,
                        } : {}),
                    ...(normalizeGovernanceProviderHumanReadableAction(
                        transaction.humanReadableAction,
                        transaction,
                    ) ? {
                            humanReadableAction: normalizeGovernanceProviderHumanReadableAction(
                                transaction.humanReadableAction,
                                transaction,
                            )!,
                        } : {}),
                    ...(normalizeGovernanceProviderActionContext(
                        transaction.actionContext,
                        transaction,
                        index,
                        provider.transactions,
                    ) ? {
                            actionContext: normalizeGovernanceProviderActionContext(
                                transaction.actionContext,
                                transaction,
                                index,
                                provider.transactions,
                            )!,
                        } : {}),
                    ...(transactionStatePreconditions[index] == null
                        ? {}
                        : { statePrecondition: transactionStatePreconditions[index]! }),
                    finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
                        state: transition.state as 'submitted' | 'confirmed' | 'finalized',
                        authority: transition.authority as
                            | 'provider_signature_readback'
                            | 'solana_rpc_signature_status'
                            | 'solana_rpc_finalized_transaction',
                        ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
                    })),
                    })),
                ...(trustProfile ? { trustProfile } : {}),
                ...(executionAuthorities ? { executionAuthorities } : {}),
                ...(enforcementDisclosure ? { enforcementDisclosure } : {}),
                ...(costReconciliation ? { costReconciliation } : {}),
                ...(attemptOwner ? { attemptOwner } : {}),
                ...(retryBoundary ? { retryBoundary } : {}),
            },
        }),
        ...(decisionMapping == null ? {} : {
            decisionMapping: {
                sourceDecisionDigest: String(decisionMapping.sourceDecisionDigest),
                sourceMechanism: {
                    kind: 'equal_weight_threshold',
                    contractDigest: String(decisionMapping.sourceMechanism.contractDigest),
                    resultDigest: String(decisionMapping.sourceMechanism.resultDigest),
                },
                providerProposalRef: String(decisionMapping.providerProposalRef),
                providerVoteRecordRef: String(decisionMapping.providerVoteRecordRef),
                providerVoterTokenOwnerRecordRef: String(decisionMapping.providerVoterTokenOwnerRecordRef),
                providerVote: 'approve',
                yesVoteWeight: String(decisionMapping.yesVoteWeight),
                voterWeight: String(decisionMapping.voterWeight),
                providerResult: 'completed',
                authorityBoundary: 'governance_voter_authorizes_request_provider_authority_executes_decision',
            },
        }),
        ...(reconciliation == null ? {} : {
            reconciliation: {
                state: reconciliation.state as 'verified' | 'hold',
                blocker: reconciliation.blocker as 'provider_readback_outage' | 'provider_readback_conflict' | null,
                authority: 'independent_provider_readback',
                observedStateDigest: reconciliation.observedStateDigest == null
                    ? null
                    : String(reconciliation.observedStateDigest),
                observedSlot: reconciliation.observedSlot == null
                    ? null
                    : Number(reconciliation.observedSlot),
                accountSemantics: reconciliation.accountSemantics == null
                    ? null
                    : {
                        signatoryRecord: 'not_applicable_direct_governance_authority_signoff',
                        voterWeightAddin: 'not_configured',
                        maxVoterWeightAddin: 'not_configured',
                        customPlugins: 'unavailable',
                    },
                votingPowerSecurity,
                votingPowerChallenge: votingPowerChallenge == null ? null : {
                    state: votingPowerChallenge.state,
                    requestId: String(votingPowerChallenge.requestId),
                    preObservedSlot: Number(votingPowerChallenge.preObservedSlot),
                    postObservedSlot: votingPowerChallenge.postObservedSlot == null
                        ? null
                        : Number(votingPowerChallenge.postObservedSlot),
                    historicalTallyInvariant: votingPowerChallenge.historicalTallyInvariant,
                    blocker: votingPowerChallenge.blocker,
                },
                providerIncident,
                reconciliationFallback,
                observedAt: String(reconciliation.observedAt),
            },
        }),
        attempts: {
            total: Number(attempts.total),
            failed: Number(attempts.failed),
            history: attempts.history.map((attempt: any) => ({
                receiptId: attempt?.receiptId == null ? null : String(attempt.receiptId),
                status: ['executed', 'failed', 'skipped'].includes(attempt?.status)
                    ? attempt.status
                    : 'unavailable',
                errorCode: attempt?.errorCode == null ? null : String(attempt.errorCode),
                executedAt: attempt?.executedAt == null ? null : String(attempt.executedAt),
            })),
        },
        linkage: {
            caseRef: linkage.caseRef == null ? null : String(linkage.caseRef),
            stageRef: linkage.stageRef == null ? null : String(linkage.stageRef),
            artifactStatus: 'not_applicable_provider_binding_activation',
            artifactRef: null,
        },
    };
}

function normalizeGovernancePublicProviderExecutionStatus(
    value: any,
): NonNullable<CircleGovernanceRequest['providerExecutionStatus']> | null {
    if (value == null) return null;
    const status = String(value?.status ?? '');
    const integrity = String(value?.integrity ?? '');
    const blocker = value?.blocker == null ? null : String(value.blocker);
    const recovery = value?.recovery == null
        ? null
        : normalizeGovernanceProviderRecovery(value.recovery);
    const incident = value?.incident == null
        ? null
        : normalizeGovernanceProviderIncident(value.incident);
    if (
        value?.schemaVersion !== 1
        || !['executed', 'failed', 'held'].includes(status)
        || !['verified', 'invalid'].includes(integrity)
        || value?.acceptedDecisionPreserved !== true
        || (value?.blocker !== null && !String(value.blocker ?? '').trim())
        || (value?.recovery != null && recovery === null)
        || (value?.incident != null && incident === null)
    ) return null;
    return {
        schemaVersion: 1,
        status: status as 'executed' | 'failed' | 'held',
        integrity: integrity as 'verified' | 'invalid',
        blocker,
        acceptedDecisionPreserved: true,
        recovery,
        incident,
    };
}

function normalizeGovernanceProviderIncident(
    value: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['reconciliation']>['providerIncident']> | null {
    if (value == null) return null;
    const lifecycleState = String(value?.lifecycleState ?? '');
    const blocker = value?.blocker ?? null;
    const occurredAt = String(value?.occurredAt ?? '');
    const lastReconciledAt = value?.lastReconciledAt == null
        ? null
        : String(value.lastReconciledAt);
    const reconciled = lifecycleState === 'reconciled';
    if (
        !['suspected', 'confirmed', 'contained', 'reconciled'].includes(lifecycleState)
        || !/^[a-f0-9]{64}$/.test(String(value?.incidentId ?? ''))
        || value?.authority !== 'independent_provider_readback'
        || !/^[a-f0-9]{64}$/.test(String(value?.eventDigest ?? ''))
        || !Number.isFinite(Date.parse(occurredAt))
        || value?.originalDecisionAndReceipt !== 'preserved'
        || (reconciled
            ? blocker !== null
                || value?.pendingExecution !== 'eligible_after_reconciliation'
                || lastReconciledAt === null
                || !Number.isFinite(Date.parse(lastReconciledAt))
                || Date.parse(lastReconciledAt) !== Date.parse(occurredAt)
            : !['provider_readback_outage', 'provider_readback_conflict'].includes(blocker)
                || value?.pendingExecution !== 'blocked'
                || lastReconciledAt !== null)
    ) return null;
    return {
        incidentId: String(value.incidentId),
        lifecycleState: lifecycleState as 'suspected' | 'confirmed' | 'contained' | 'reconciled',
        authority: 'independent_provider_readback',
        blocker: blocker as 'provider_readback_outage' | 'provider_readback_conflict' | null,
        occurredAt,
        eventDigest: String(value.eventDigest),
        lastReconciledAt,
        pendingExecution: reconciled ? 'eligible_after_reconciliation' : 'blocked',
        originalDecisionAndReceipt: 'preserved',
    };
}

function normalizeGovernanceProviderReconciliationFallback(
    value: any,
): GovernanceProviderReconciliationFallbackReadback | null {
    if (value == null) return null;
    const sourceState = String(value?.sourceState ?? '');
    const original = value?.originalEvidence;
    const affected = value?.affectedObjects;
    const corrected = value?.correctedState;
    const fallback = value?.fallbackMechanism;
    const superseding = value?.superseding;
    const correctedSource = String(corrected?.source ?? '');
    const correctedTargetRequired = correctedSource === 'frozen_provider_trust_profile_target';
    if (
        !['provider_incident', 'profile_revalidation'].includes(sourceState)
        || value?.authority !== 'frozen_trust_profile_and_independent_provider_readback'
        || !isSha256Digest(String(value?.policyDigest ?? ''))
        || value?.reconciliationAuthorityRef !== 'independent_provider_readback'
        || !String(value?.decisionAuthorityRef ?? '').trim()
        || value?.conflictRule !== 'questioned_provider_program_decoder_cannot_adjudicate_itself'
        || !String(original?.requestId ?? '').trim()
        || !String(original?.receiptId ?? '').trim()
        || !isSha256Digest(String(original?.receiptEvidenceDigest ?? ''))
        || !isSha256Digest(String(original?.originalDecisionDigest ?? ''))
        || original?.preserved !== true
        || !String(affected?.resourceRef ?? '').trim()
        || !String(affected?.ownerProgramRef ?? '').trim()
        || (affected?.providerProfileRef !== null
            && !String(affected?.providerProfileRef ?? '').trim())
        || (affected?.providerProfileVersion !== null
            && !Number.isSafeInteger(Number(affected?.providerProfileVersion)))
        || (affected?.incidentId !== null
            && !isSha256Digest(String(affected?.incidentId ?? '')))
        || (affected?.profileRevalidationBlocker !== null
            && !String(affected?.profileRevalidationBlocker ?? '').trim())
        || !['frozen_provider_trust_profile_target', 'manual_recovery_pending'].includes(correctedSource)
        || (correctedTargetRequired && (
            !String(corrected?.targetProfileRef ?? '').trim()
            || !Number.isSafeInteger(Number(corrected?.targetProfileVersion))
            || Number(corrected.targetProfileVersion) <= 0
            || !isSha256Digest(String(corrected?.targetProfileDigest ?? ''))
            || !String(corrected?.targetOwnerProgramRef ?? '').trim()
            || !String(corrected?.decoderConformance ?? '').trim()
        ))
        || (!correctedTargetRequired && (
            corrected?.targetProfileRef !== null
            || corrected?.targetProfileVersion !== null
            || corrected?.targetProfileDigest !== null
            || corrected?.targetOwnerProgramRef !== null
            || corrected?.decoderConformance !== null
        ))
        || fallback?.mode !== 'manual_recovery_only'
        || fallback?.independentFallbackProviderRef !== null
        || fallback?.activation !== 'fail_closed_when_independent_fallback_absent'
        || fallback?.operatorMaySelectProvider !== false
        || fallback?.questionedProviderMayAdjudicate !== false
        || superseding?.artifactOwner !== 'DecisionOutputArtifact'
        || superseding?.receiptOwner !== 'GovernanceExecutionReceipt'
        || superseding?.materialChangeGate !== 'new_decision_stage_or_superseding_case'
        || superseding?.required !== true
    ) return null;
    return {
        sourceState: sourceState as GovernanceProviderReconciliationFallbackReadback['sourceState'],
        authority: 'frozen_trust_profile_and_independent_provider_readback',
        policyDigest: String(value.policyDigest),
        reconciliationAuthorityRef: 'independent_provider_readback',
        decisionAuthorityRef: String(value.decisionAuthorityRef),
        conflictRule: 'questioned_provider_program_decoder_cannot_adjudicate_itself',
        originalEvidence: {
            requestId: String(original.requestId),
            receiptId: String(original.receiptId),
            receiptEvidenceDigest: String(original.receiptEvidenceDigest),
            originalDecisionDigest: String(original.originalDecisionDigest),
            preserved: true,
        },
        affectedObjects: {
            resourceRef: String(affected.resourceRef),
            ownerProgramRef: String(affected.ownerProgramRef),
            providerProfileRef: affected.providerProfileRef === null
                ? null
                : String(affected.providerProfileRef),
            providerProfileVersion: affected.providerProfileVersion === null
                ? null
                : Number(affected.providerProfileVersion),
            incidentId: affected.incidentId === null ? null : String(affected.incidentId),
            profileRevalidationBlocker: affected.profileRevalidationBlocker === null
                ? null
                : String(affected.profileRevalidationBlocker),
        },
        correctedState: {
            source: correctedSource as GovernanceProviderReconciliationFallbackReadback['correctedState']['source'],
            targetProfileRef: correctedTargetRequired ? String(corrected.targetProfileRef) : null,
            targetProfileVersion: correctedTargetRequired ? Number(corrected.targetProfileVersion) : null,
            targetProfileDigest: correctedTargetRequired ? String(corrected.targetProfileDigest) : null,
            targetOwnerProgramRef: correctedTargetRequired ? String(corrected.targetOwnerProgramRef) : null,
            decoderConformance: correctedTargetRequired ? String(corrected.decoderConformance) : null,
        },
        fallbackMechanism: {
            mode: 'manual_recovery_only',
            independentFallbackProviderRef: null,
            activation: 'fail_closed_when_independent_fallback_absent',
            operatorMaySelectProvider: false,
            questionedProviderMayAdjudicate: false,
        },
        superseding: {
            artifactOwner: 'DecisionOutputArtifact',
            receiptOwner: 'GovernanceExecutionReceipt',
            materialChangeGate: 'new_decision_stage_or_superseding_case',
            required: true,
        },
    };
}

function normalizeGovernanceProviderExpiredAttemptHistory(
    value: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['expiredAttemptHistory']> | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_cost_preflight_checkpoint'
        || !Array.isArray(value?.attempts)
        || value.attempts.length > 24
    ) return null;
    const messageDigests = new Set<string>();
    const attempts = value.attempts.flatMap((attempt: any) => {
        const stepId = String(attempt?.stepId ?? '').trim();
        const manifestDigest = String(attempt?.manifestDigest ?? '');
        const messageDigest = String(attempt?.messageDigest ?? '');
        const recentBlockhash = String(attempt?.recentBlockhash ?? '').trim();
        const lastValidBlockHeight = Number(attempt?.lastValidBlockHeight);
        const expiredAtBlockHeight = Number(attempt?.expiredAtBlockHeight);
        if (
            !stepId
            || !isSha256Digest(manifestDigest)
            || !isSha256Digest(messageDigest)
            || messageDigests.has(messageDigest)
            || !recentBlockhash
            || !Number.isSafeInteger(lastValidBlockHeight)
            || lastValidBlockHeight < 0
            || !Number.isSafeInteger(expiredAtBlockHeight)
            || expiredAtBlockHeight <= lastValidBlockHeight
            || attempt?.disposition !== 'authoritative_expiry_same_intent_manual_retry'
        ) return [];
        messageDigests.add(messageDigest);
        return [{
            stepId,
            manifestDigest,
            messageDigest,
            recentBlockhash,
            lastValidBlockHeight,
            expiredAtBlockHeight,
            disposition: 'authoritative_expiry_same_intent_manual_retry' as const,
        }];
    });
    if (attempts.length !== value.attempts.length) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_cost_preflight_checkpoint',
        attempts,
    };
}

function normalizeGovernanceDelegationStatePrecondition(
    value: any,
    transaction?: any,
    provider?: any,
): NonNullable<
    NonNullable<GovernanceProviderExecutionReadback['provider']>['transactions'][number]['statePrecondition']
> | null {
    if (value == null) return null;
    const stepId = String(value?.stepId ?? '');
    const expectedDelegate = value?.expectedDelegate;
    const observedSlot = Number(value?.observedSlot);
    const feePayerBalanceLamports = Number(value?.feePayerBalanceLamports);
    const canonicalOwnerState = value?.canonicalOwnerState;
    const instructionSafety = value?.instructionSafety;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'independent_provider_readback_before_transit_sign'
        || value?.chainId !== 'solana:devnet'
        || !String(value?.profileRef ?? '').trim()
        || !Number.isSafeInteger(value?.profileVersion)
        || value.profileVersion <= 0
        || !String(value?.programId ?? '').trim()
        || !isSha256Digest(String(value?.actionIntentDigest ?? ''))
        || !isSha256Digest(String(value?.planDigest ?? ''))
        || !['set_governance_delegate', 'revoke_governance_delegate'].includes(stepId)
        || !isSha256Digest(String(value?.manifestDigest ?? ''))
        || !isSha256Digest(String(value?.messageDigest ?? ''))
        || (expectedDelegate !== null && !String(expectedDelegate ?? '').trim())
        || !Number.isSafeInteger(observedSlot)
        || observedSlot <= 0
        || !isSha256Digest(String(value?.providerStateDigest ?? ''))
        || !Number.isSafeInteger(feePayerBalanceLamports)
        || feePayerBalanceLamports < 0
        || canonicalOwnerState?.schemaVersion !== 1
        || canonicalOwnerState?.authority !== 'canonical_resource_authority_payer_readback'
        || !String(canonicalOwnerState?.resourceBindingId ?? '').trim()
        || !String(canonicalOwnerState?.authorityBindingId ?? '').trim()
        || !String(canonicalOwnerState?.payerPolicyId ?? '').trim()
        || !['not_configured_p05_gate', 'clear_fresh_p05_authority_health']
            .includes(canonicalOwnerState?.emergencyFreeze)
        || !isSha256Digest(String(canonicalOwnerState?.stateDigest ?? ''))
        || instructionSafety?.schemaVersion !== 1
        || instructionSafety?.authority !== 'provider_instruction_manifest_and_simulation'
        || !Array.isArray(instructionSafety?.programIds)
        || instructionSafety.programIds.length !== 1
        || !String(instructionSafety.programIds[0] ?? '').trim()
        || instructionSafety?.instructionCount !== 1
        || instructionSafety?.transactionSignerCount !== 2
        || !Array.isArray(instructionSafety?.writableAccountRefs)
        || instructionSafety.writableAccountRefs.length !== 1
        || !String(instructionSafety.writableAccountRefs[0] ?? '').trim()
        || instructionSafety?.accountPrivilegeCheck !== 'exact_spl_governance_set_delegate_accounts'
        || instructionSafety?.assetOutflowLamports !== 0
        || instructionSafety?.opaqueInstructions !== false
        || instructionSafety?.simulation !== 'passed'
        || !isSha256Digest(String(instructionSafety?.digest ?? ''))
        || !isSha256Digest(String(value?.digest ?? ''))
        || (transaction != null && (
            stepId !== transaction?.stepId
            || value.manifestDigest !== transaction?.manifestDigest
            || value.messageDigest !== transaction?.messageDigest
            || !Number.isSafeInteger(transaction?.slot)
            || observedSlot > transaction.slot
        ))
        || (provider != null && (
            value.chainId !== provider?.chainId
            || value.profileRef !== provider?.profileRef
            || value.profileVersion !== provider?.profileVersion
            || value.programId !== provider?.ownerProgramRef
        ))
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'independent_provider_readback_before_transit_sign',
        chainId: 'solana:devnet',
        profileRef: String(value.profileRef),
        profileVersion: Number(value.profileVersion),
        programId: String(value.programId),
        actionIntentDigest: String(value.actionIntentDigest),
        planDigest: String(value.planDigest),
        stepId: stepId as 'set_governance_delegate' | 'revoke_governance_delegate',
        manifestDigest: String(value.manifestDigest),
        messageDigest: String(value.messageDigest),
        expectedDelegate: expectedDelegate === null ? null : String(expectedDelegate),
        observedSlot,
        providerStateDigest: String(value.providerStateDigest),
        feePayerBalanceLamports,
        canonicalOwnerState: {
            schemaVersion: 1,
            authority: 'canonical_resource_authority_payer_readback',
            resourceBindingId: String(canonicalOwnerState.resourceBindingId),
            authorityBindingId: String(canonicalOwnerState.authorityBindingId),
            payerPolicyId: String(canonicalOwnerState.payerPolicyId),
            emergencyFreeze: canonicalOwnerState.emergencyFreeze,
            stateDigest: String(canonicalOwnerState.stateDigest),
        },
        instructionSafety: {
            schemaVersion: 1,
            authority: 'provider_instruction_manifest_and_simulation',
            programIds: instructionSafety.programIds.map(String),
            instructionCount: 1,
            transactionSignerCount: 2,
            writableAccountRefs: instructionSafety.writableAccountRefs.map(String),
            accountPrivilegeCheck: 'exact_spl_governance_set_delegate_accounts',
            assetOutflowLamports: 0,
            opaqueInstructions: false,
            simulation: 'passed',
            digest: String(instructionSafety.digest),
        },
        digest: String(value.digest),
    };
}

function normalizeGovernanceProviderRecovery(
    value: any,
): NonNullable<GovernanceProviderExecutionReadback['recovery']> | null {
    const pairs = new Map<
        NonNullable<GovernanceProviderExecutionReadback['recovery']>['category'],
        NonNullable<GovernanceProviderExecutionReadback['recovery']>['action']
    >([
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
    const category = String(value?.category ?? '') as NonNullable<GovernanceProviderExecutionReadback['recovery']>['category'];
    const nextEligibleAt = value?.nextEligibleAt == null ? null : String(value.nextEligibleAt);
    if (
        !pairs.has(category)
        || value?.action !== pairs.get(category)
        || value?.automaticMutation !== false
        || value?.authorityChangeAllowed !== false
        || value?.payerChangeAllowed !== false
        || value?.acceptedDecisionPreserved !== true
        || value?.decisionMutationAllowed !== false
        || !['same_request_only', 'blocked_until_recovery_fact'].includes(String(value?.retryMode))
        || (nextEligibleAt !== null && !Number.isFinite(Date.parse(nextEligibleAt)))
    ) return null;
    return {
        category,
        action: value.action,
        automaticMutation: false,
        authorityChangeAllowed: false,
        payerChangeAllowed: false,
        acceptedDecisionPreserved: true,
        decisionMutationAllowed: false,
        retryMode: value.retryMode,
        nextEligibleAt,
    };
}

function normalizeGovernanceProviderTrustProfile(
    value: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['trustProfile']> | null {
    const deploymentObservedSlot = Number(value?.deploymentObservedSlot);
    const observationSlot = Number(value?.observationSlot);
    const deploymentObservedAt = value?.deploymentObservedAt
        ? String(value.deploymentObservedAt)
        : null;
    const rpcIndexerCrossCheck = String(value?.rpcIndexerCrossCheck ?? '');
    if (
        !value
        || !/^[a-f0-9]{64}$/.test(String(value?.profileDigest ?? ''))
        || typeof value?.genesisHash !== 'string'
        || !value.genesisHash
        || typeof value?.programId !== 'string'
        || !value.programId
        || typeof value?.loaderProgramId !== 'string'
        || !value.loaderProgramId
        || typeof value?.programDataAddress !== 'string'
        || !value.programDataAddress
        || typeof value?.upgradeAuthority !== 'string'
        || !value.upgradeAuthority
        || !/^[a-f0-9]{64}$/.test(String(value?.deployedProgramBytesSha256 ?? ''))
        || !Number.isSafeInteger(deploymentObservedSlot)
        || deploymentObservedSlot <= 0
        || !deploymentObservedAt
        || !Number.isFinite(Date.parse(deploymentObservedAt))
        || !Number.isSafeInteger(observationSlot)
        || observationSlot <= 0
        || typeof value?.observationBlockhash !== 'string'
        || !value.observationBlockhash
        || typeof value?.decoderPackage !== 'string'
        || !value.decoderPackage
        || typeof value?.decoderVersion !== 'string'
        || !value.decoderVersion
        || !/^[a-f0-9]{64}$/.test(String(value?.decoderArtifactSha256 ?? ''))
        || typeof value?.decoderConformance !== 'string'
        || !value.decoderConformance
        || value?.readinessState !== 'ready'
        || !['stable', 'experimental'].includes(String(value?.riskMaturity ?? ''))
        || value?.commitment !== 'finalized'
        || value?.rpcAccess !== 'public_no_credentials'
        || ![
            'rpc_finalized_and_indexer_program_checkpoint_converged',
            'rpc_finalized_indexer_program_checkpoint_behind',
            'rpc_finalized_indexer_program_checkpoint_failed',
            'rpc_finalized_only_indexer_not_configured',
            'rpc_finalized_indexer_observation_unavailable',
        ].includes(rpcIndexerCrossCheck)
    ) return null;
    return {
        profileDigest: value.profileDigest,
        readinessState: 'ready',
        riskMaturity: value.riskMaturity,
        genesisHash: value.genesisHash,
        programId: value.programId,
        loaderProgramId: value.loaderProgramId,
        programDataAddress: value.programDataAddress,
        upgradeAuthority: value.upgradeAuthority,
        deployedProgramBytesSha256: value.deployedProgramBytesSha256,
        deploymentObservedSlot,
        deploymentObservedAt,
        observationSlot,
        observationBlockhash: value.observationBlockhash,
        decoderPackage: value.decoderPackage,
        decoderVersion: value.decoderVersion,
        decoderArtifactSha256: value.decoderArtifactSha256,
        decoderConformance: value.decoderConformance,
        commitment: 'finalized',
        rpcAccess: 'public_no_credentials',
        rpcIndexerCrossCheck: rpcIndexerCrossCheck as NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['trustProfile']>['rpcIndexerCrossCheck'],
    };
}

function normalizeGovernanceProviderResourceLifecycle(
    value: any,
    provider: any,
    execution: any,
): GovernanceProviderResourceLifecycleReadback | null {
    if (value == null) return null;
    const phases = Array.isArray(value?.phases) ? value.phases : [];
    const expectedPhases: GovernanceProviderResourceLifecycleReadback['phases'][number]['phase'][] = [
        'created',
        'bootstrap_verified',
        'authority_transferred',
        'old_authority_revoked',
        'readback_verified',
        'available',
    ];
    const observedSlot = Number(value?.observedSlot);
    const lastTransactionSlot = value?.lastTransactionSlot === null
        ? null
        : Number(value?.lastTransactionSlot);
    const authorityRoles = Array.isArray(value?.permissionResidue?.authorityRoles)
        ? value.permissionResidue.authorityRoles.flatMap((role: any) => (
            typeof role?.role === 'string'
                && role.role.trim()
                && role?.custodyProvider === 'openbao_transit'
                && role?.custodyStatus === 'verified'
                && role?.status === 'active'
                && Number.isSafeInteger(Number(role?.verifiedSlot))
                && Number(role.verifiedSlot) > 0
                ? [{
                    role: String(role.role),
                    custodyProvider: 'openbao_transit' as const,
                    custodyStatus: 'verified' as const,
                    status: 'active' as const,
                    verifiedSlot: Number(role.verifiedSlot),
                }]
                : []
        ))
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority
          !== 'provider_receipt_resource_binding_authority_binding_and_independent_readback'
        || value?.state !== 'available'
        || !['realms_provider_binding', 'squads_provider_binding'].includes(value?.providerModule)
        || value.providerModule !== provider?.module
        || typeof value?.resourceBindingId !== 'string'
        || !value.resourceBindingId.trim()
        || value?.resourceRef !== provider?.resourceRef
        || value?.ownerProgramRef !== provider?.ownerProgramRef
        || typeof value?.sourceRequestId !== 'string'
        || !value.sourceRequestId.trim()
        || !isSha256Digest(String(value?.sourceDecisionDigest ?? ''))
        || !Number.isSafeInteger(observedSlot)
        || observedSlot <= 0
        || observedSlot !== Number(provider?.observedSlot)
        || (lastTransactionSlot !== null && (
            !Number.isSafeInteger(lastTransactionSlot)
            || lastTransactionSlot <= 0
            || observedSlot < lastTransactionSlot
        ))
        || lastTransactionSlot !== (provider?.lastTransactionSlot === null
            ? null
            : Number(provider?.lastTransactionSlot))
        || !isSha256Digest(String(value?.stateDigest ?? ''))
        || value.stateDigest !== provider?.stateDigest
        || phases.length !== expectedPhases.length
        || phases.some((phase: any, index: number) => (
            phase?.phase !== expectedPhases[index]
            || typeof phase?.authority !== 'string'
            || !phase.authority.trim()
            || typeof phase?.evidenceRef !== 'string'
            || !phase.evidenceRef.trim()
        ))
        || value?.permissionResidue?.fallbackAuthority !== 'none'
        || value?.permissionResidue?.temporaryWalletAuthority !== 'revoked_or_not_retained'
        || value?.permissionResidue?.serviceKeyAuthority !== 'not_retained'
        || value?.permissionResidue?.signerKeyExposure !== 'none_public_authority_only'
        || authorityRoles.length === 0
        || authorityRoles.length !== value?.permissionResidue?.authorityRoles?.length
        || (
            execution?.effect !== 'squads_existing_no_asset_resource_adopted_finalized'
            && execution?.effect !== 'realms_devnet_no_asset_vertical_finalized'
        )
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'provider_receipt_resource_binding_authority_binding_and_independent_readback',
        state: 'available',
        providerModule: value.providerModule,
        resourceBindingId: value.resourceBindingId,
        resourceRef: value.resourceRef,
        ownerProgramRef: value.ownerProgramRef,
        sourceRequestId: value.sourceRequestId,
        sourceDecisionDigest: value.sourceDecisionDigest,
        observedSlot,
        lastTransactionSlot,
        stateDigest: value.stateDigest,
        phases: phases.map((phase: any, index: number) => ({
            phase: expectedPhases[index],
            authority: phase.authority,
            evidenceRef: phase.evidenceRef,
        })),
        permissionResidue: {
            fallbackAuthority: 'none',
            temporaryWalletAuthority: 'revoked_or_not_retained',
            serviceKeyAuthority: 'not_retained',
            signerKeyExposure: 'none_public_authority_only',
            authorityRoles,
        },
    };
}

function normalizeGovernanceProviderExecutionAuthorities(
    value: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['executionAuthorities']> | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const authorities = value.map((authority: any) => {
        const verifiedSlot = Number(authority?.verifiedSlot);
        const allowedOperations = Array.isArray(authority?.allowedOperations)
            ? authority.allowedOperations.filter((operation: unknown) => (
                typeof operation === 'string' && operation.trim()
            )).map(String)
            : [];
        if (
            typeof authority?.role !== 'string'
            || !authority.role.trim()
            || (authority?.publicAuthority !== null
                && (typeof authority?.publicAuthority !== 'string'
                    || !authority.publicAuthority.trim()))
            || typeof authority?.custodyProvider !== 'string'
            || !authority.custodyProvider.trim()
            || typeof authority?.custodyStatus !== 'string'
            || !authority.custodyStatus.trim()
            || allowedOperations.length === 0
            || !Number.isSafeInteger(verifiedSlot)
            || verifiedSlot <= 0
            || typeof authority?.status !== 'string'
            || !authority.status.trim()
            || (authority?.sourceRequestId !== null
                && (typeof authority?.sourceRequestId !== 'string'
                    || !authority.sourceRequestId.trim()))
            || (authority?.sourceDecisionDigest !== null
                && !/^[a-f0-9]{64}$/.test(String(authority.sourceDecisionDigest)))
        ) return null;
        return {
            role: authority.role,
            publicAuthority: authority.publicAuthority,
            custodyProvider: authority.custodyProvider,
            custodyStatus: authority.custodyStatus,
            allowedOperations,
            verifiedSlot,
            status: authority.status,
            sourceRequestId: authority.sourceRequestId,
            sourceDecisionDigest: authority.sourceDecisionDigest,
        };
    });
    return authorities.every((authority) => authority !== null)
        ? authorities as NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['executionAuthorities']>
        : null;
}

export interface GovernanceProviderAuthorityPaymentBoundary {
    schemaVersion: 1;
    authority: 'canonical_resource_authority_and_payer_policy';
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
}

export interface GovernanceProviderMandateCostPolicy {
    schemaVersion: 1;
    authority: 'frozen_governance_mandate_version_fee_policy';
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
}

export interface GovernanceProviderFundingSourceFeePayerBoundary {
    schemaVersion: 1;
    authority: 'canonical_payer_policy_resource_or_vault_separation';
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
}

function normalizeGovernanceProviderAuthorityPaymentBoundary(
    value: any,
): GovernanceProviderAuthorityPaymentBoundary | null {
    if (value == null) return null;
    const executionAuthorityRoles = Array.isArray(value?.executionAuthorityRoles)
        ? value.executionAuthorityRoles.map(String).filter(Boolean)
        : [];
    const executionCustodyProviders = Array.isArray(value?.executionCustodyProviders)
        ? value.executionCustodyProviders.map(String).filter(Boolean)
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_resource_authority_and_payer_policy'
        || !String(value?.payerPolicyId ?? '').trim()
        || !String(value?.economicBearer ?? '').trim()
        || value?.feePayerRole !== 'fee_payer_only'
        || !['explicit_relayer_from_payer_policy', 'not_configured']
            .includes(String(value?.sponsorRole))
        || !String(value?.feePayerCustodyProvider ?? '').trim()
        || executionAuthorityRoles.length === 0
        || executionCustodyProviders.length === 0
        || value?.separation !== 'verified_distinct_public_keys_and_key_refs'
        || value?.sponsorAuthorityGain !== 'none'
        || value?.privateKeyExposure !== 'none_public_readback_only'
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_resource_authority_and_payer_policy',
        payerPolicyId: String(value.payerPolicyId),
        economicBearer: String(value.economicBearer),
        feePayerRole: 'fee_payer_only',
        sponsorRole: value.sponsorRole,
        feePayerCustodyProvider: String(value.feePayerCustodyProvider),
        executionAuthorityRoles,
        executionCustodyProviders,
        separation: 'verified_distinct_public_keys_and_key_refs',
        sponsorAuthorityGain: 'none',
        privateKeyExposure: 'none_public_readback_only',
    };
}

function normalizeGovernanceProviderMandateCostPolicy(
    value: any,
): GovernanceProviderMandateCostPolicy | null {
    if (value == null) return null;
    const expectedCostClasses = ['decision', 'review', 'operational', 'appeal', 'execution'];
    const classes = Array.isArray(value?.costClasses)
        ? value.costClasses.flatMap((item: any) => {
            if (
                !expectedCostClasses.includes(String(item?.costClass))
                || !['no_fee', 'capped_external_quote'].includes(String(item?.mode))
                || !['delegator', 'delegate', 'shared'].includes(String(item?.economicBearer))
                || (item?.maximumAmountMinor !== null
                    && !String(item?.maximumAmountMinor ?? '').trim())
                || (item?.unit !== null && !String(item?.unit ?? '').trim())
            ) return [];
            return [{
                costClass: item.costClass as GovernanceProviderMandateCostPolicy['costClasses'][number]['costClass'],
                mode: item.mode as GovernanceProviderMandateCostPolicy['costClasses'][number]['mode'],
                economicBearer: item.economicBearer as GovernanceProviderMandateCostPolicy['costClasses'][number]['economicBearer'],
                maximumAmountMinor: item.maximumAmountMinor === null
                    ? null
                    : String(item.maximumAmountMinor),
                unit: item.unit === null ? null : String(item.unit),
            }];
        })
        : [];
    const specialBudget = value?.specialBudget;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'frozen_governance_mandate_version_fee_policy'
        || !String(value?.mandateId ?? '').trim()
        || !Number.isSafeInteger(value?.mandateVersion)
        || value.mandateVersion <= 0
        || !isSha256Digest(String(value?.mandateTermsDigest ?? ''))
        || value?.policySource !== 'GovernanceMandateVersion.terms.feePolicy'
        || classes.length !== expectedCostClasses.length
        || expectedCostClasses.some((costClass) => (
            classes.filter((item: { costClass: string }) => (
                item.costClass === costClass
            )).length !== 1
        ))
        || specialBudget?.mode !== 'not_managed_by_mandate'
        || (specialBudget?.maximumAmountMinor !== null
            && !String(specialBudget?.maximumAmountMinor ?? '').trim())
        || (specialBudget?.unit !== null && !String(specialBudget?.unit ?? '').trim())
        || value?.payerAuthority !== 'separate_from_governance_authority'
        || value?.payerAuthoritySeparatedFromDecisionAuthority !== true
        || value?.silentTransferToVoterOperatorExecutorAllowed !== false
        || value?.executionCostBearer !== 'same_as_mandate_fee_policy'
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'frozen_governance_mandate_version_fee_policy',
        mandateId: String(value.mandateId),
        mandateVersion: Number(value.mandateVersion),
        mandateTermsDigest: String(value.mandateTermsDigest),
        policySource: 'GovernanceMandateVersion.terms.feePolicy',
        costClasses: classes,
        specialBudget: {
            mode: 'not_managed_by_mandate',
            maximumAmountMinor: specialBudget.maximumAmountMinor === null
                ? null
                : String(specialBudget.maximumAmountMinor),
            unit: specialBudget.unit === null ? null : String(specialBudget.unit),
        },
        payerAuthority: 'separate_from_governance_authority',
        payerAuthoritySeparatedFromDecisionAuthority: true,
        silentTransferToVoterOperatorExecutorAllowed: false,
        executionCostBearer: 'same_as_mandate_fee_policy',
    };
}

function normalizeGovernanceProviderFundingSourceFeePayerBoundary(
    value: any,
): GovernanceProviderFundingSourceFeePayerBoundary | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_payer_policy_resource_or_vault_separation'
        || !String(value?.payerPolicyId ?? '').trim()
        || !['governed_resource_account', 'squads_vault']
            .includes(String(value?.fundingSourceRole))
        || !String(value?.fundingSourceRef ?? '').trim()
        || value?.feePayerRole !== 'separated_fee_payer_policy'
        || value?.actualFeePayer !== 'canonical_payer_policy_fee_payer_signer'
        || value?.feePayerSignerRefExposed !== false
        || value?.fundingSourceMaySignFees !== false
        || ![
            'explicit_relayer_sponsor',
            'governed_reimbursement_policy',
            'governance_approved_payer_policy',
        ].includes(String(value?.approvedPaymentPath))
        || !['explicit_relayer_from_payer_policy', 'not_configured']
            .includes(String(value?.sponsorRole))
        || !['governed_reimbursement_policy_configured', 'not_configured']
            .includes(String(value?.reimbursementPolicy))
        || (value?.reimbursementPolicyRef !== null
            && !String(value?.reimbursementPolicyRef ?? '').trim())
        || value?.executorCashFlowResponsibility !== 'forbidden'
        || value?.silentExecutorCostTransferAllowed !== false
        || !String(value?.economicBearer ?? '').trim()
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_payer_policy_resource_or_vault_separation',
        payerPolicyId: String(value.payerPolicyId),
        fundingSourceRole: value.fundingSourceRole,
        fundingSourceRef: String(value.fundingSourceRef),
        feePayerRole: 'separated_fee_payer_policy',
        actualFeePayer: 'canonical_payer_policy_fee_payer_signer',
        feePayerSignerRefExposed: false,
        fundingSourceMaySignFees: false,
        approvedPaymentPath: value.approvedPaymentPath,
        sponsorRole: value.sponsorRole,
        reimbursementPolicy: value.reimbursementPolicy,
        reimbursementPolicyRef: value.reimbursementPolicyRef === null
            ? null
            : String(value.reimbursementPolicyRef),
        executorCashFlowResponsibility: 'forbidden',
        silentExecutorCostTransferAllowed: false,
        economicBearer: String(value.economicBearer),
    };
}

function normalizeGovernanceProviderEnforcementDisclosure(
    value: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['enforcementDisclosure']> | null {
    if (value == null) return null;
    const mode = String(value?.mode ?? '');
    const providerModule = String(value?.providerModule ?? '');
    const operations = Array.isArray(value?.allowedOperations)
        ? value.allowedOperations.map(String).filter(Boolean)
        : [];
    const expectedPair = (
        mode === 'multisig_threshold'
        && providerModule === 'squads_provider_binding'
        && value?.proofScope === 'alcheme_constructed_transaction_matches_accepted_decision'
        && value?.residualBypassRisk
            === 'threshold_signers_can_create_or_execute_transactions_outside_alcheme'
    ) || (
        mode === 'provider_onchain'
        && providerModule === 'realms_provider_binding'
        && value?.proofScope
            === 'spl_governance_owner_program_and_transit_signatures_match_accepted_decision'
        && value?.residualBypassRisk
            === 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
    );
    if (
        value?.schemaVersion !== 1
        || !expectedPair
        || !String(value?.resourceRef ?? '').trim()
        || !String(value?.ownerProgramRef ?? '').trim()
        || !String(value?.decisionLinkage?.requestId ?? '').trim()
        || !isSha256Digest(String(value?.decisionLinkage?.decisionDigest ?? ''))
        || operations.length === 0
        || new Set(operations).size !== operations.length
        || value?.verificationState !== 'verified'
        || !Number.isSafeInteger(value?.version)
        || value.version <= 0
        || value?.bypassPrevented !== false
    ) return null;
    return {
        schemaVersion: 1,
        mode: mode as 'provider_onchain' | 'multisig_threshold',
        providerModule: providerModule as 'realms_provider_binding' | 'squads_provider_binding',
        resourceRef: String(value.resourceRef),
        ownerProgramRef: String(value.ownerProgramRef),
        decisionLinkage: {
            requestId: String(value.decisionLinkage.requestId),
            decisionDigest: String(value.decisionLinkage.decisionDigest),
        },
        allowedOperations: operations,
        verificationState: 'verified',
        version: Number(value.version),
        proofScope: value.proofScope,
        residualBypassRisk: value.residualBypassRisk,
        bypassPrevented: false,
    };
}

function normalizeGovernanceProviderCostReconciliation(
    value: any,
    providerTransactions: any,
): NonNullable<NonNullable<GovernanceProviderExecutionReadback['provider']>['costReconciliation']> | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_cost_preflight_and_provider_receipt'
        || !String(value?.payerPolicyId ?? '').trim()
        || value?.payerRole !== 'separated_fee_payer_policy'
        || !String(value?.economicBearer ?? '').trim()
        || !['explicit_relayer_from_payer_policy', 'not_configured']
            .includes(String(value?.sponsorRole))
        || value?.unit !== 'lamports'
        || !Array.isArray(value?.transactions)
        || !Array.isArray(providerTransactions)
        || value.transactions.length !== providerTransactions.length
        || value?.reconciliation !== 'transaction_sum_matches_provider_receipt'
        || ![
            'not_applicable_delegation_no_account_creation',
            'provider_receipt_direct_rent_itemized',
            'included_in_actual_spend_not_itemized',
        ]
            .includes(value?.rent)
        || !['not_applicable_no_refund', 'unknown_no_provider_refund_disposition']
            .includes(value?.refund)
        || !['solana_devnet_faucet', 'existing_finalized_balance'].includes(value?.fundingSource)
        || (value.fundingSource === 'solana_devnet_faucet'
            && !String(value?.fundingSignature ?? '').trim())
        || (value.fundingSource === 'existing_finalized_balance' && value?.fundingSignature !== null)
        || !Number.isSafeInteger(value?.totalSpendLamports)
        || value.totalSpendLamports < 0
        || !Number.isSafeInteger(value?.finalBalanceLamports)
        || value.finalBalanceLamports < 0
    ) return null;
    const transactions = value.transactions.flatMap((transaction: any, index: number) => {
        const quotedFeeLamports = Number(transaction?.quotedFeeLamports);
        const directRentLamports = transaction?.directRentLamports === null
            ? null
            : Number(transaction?.directRentLamports);
        const actualSpendLamports = Number(transaction?.actualSpendLamports);
        if (
            !String(transaction?.stepId ?? '').trim()
            || transaction.stepId !== providerTransactions[index]?.stepId
            || !Number.isSafeInteger(quotedFeeLamports)
            || quotedFeeLamports < 0
            || (directRentLamports !== null
                && (!Number.isSafeInteger(directRentLamports) || directRentLamports < 0))
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
    if (
        transactions.length !== value.transactions.length
        || (value.rent === 'included_in_actual_spend_not_itemized'
            ? value.totalDirectRentLamports !== null
                || transactions.some((item: { directRentLamports: number | null }) => (
                    item.directRentLamports !== null
                ))
            : !Number.isSafeInteger(value.totalDirectRentLamports)
                || value.totalDirectRentLamports < 0
                || transactions.some((item: { directRentLamports: number | null }) => (
                    item.directRentLamports === null
                ))
                || transactions.reduce((total: number, item: {
                    directRentLamports: number | null;
                }) => (
                    total + (item.directRentLamports ?? 0)
                ), 0) !== value.totalDirectRentLamports)
        || transactions.reduce((total: number, item: { actualSpendLamports: number }) => (
            total + item.actualSpendLamports
        ), 0) !== value.totalSpendLamports
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_cost_preflight_and_provider_receipt',
        payerPolicyId: String(value.payerPolicyId),
        payerRole: 'separated_fee_payer_policy',
        economicBearer: String(value.economicBearer),
        sponsorRole: value.sponsorRole,
        unit: 'lamports',
        transactions,
        totalDirectRentLamports: value.totalDirectRentLamports === null
            ? null
            : Number(value.totalDirectRentLamports),
        totalSpendLamports: Number(value.totalSpendLamports),
        finalBalanceLamports: Number(value.finalBalanceLamports),
        fundingSource: value.fundingSource,
        fundingSignature: value.fundingSignature === null ? null : String(value.fundingSignature),
        reconciliation: 'transaction_sum_matches_provider_receipt',
        rent: value.rent,
        refund: value.refund,
    };
}

function normalizeGovernanceProviderTransactionAttemptContext(
    value: any,
    transaction: any,
): NonNullable<GovernanceProviderExecutionReadback['provider']>['transactions'][number]['attemptContext'] | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_provider_attempt_inventory_and_terminal_receipt'
        || value?.persistenceAuthority !== 'canonical_provider_checkpoint_and_payer_policy'
        || !isSha256Digest(String(value?.transactionAttemptDigest ?? ''))
        || !Number.isSafeInteger(value?.attemptOrdinal)
        || value.attemptOrdinal <= 0
        || !String(value?.recentBlockhash ?? '').trim()
        || !Number.isSafeInteger(value?.quotedFeeLamports)
        || value.quotedFeeLamports < 0
        || value?.feePayerRole !== 'separated_fee_payer_policy'
        || !String(value?.feePayerPolicyId ?? '').trim()
        || value?.feePayerBinding !== 'canonical_payer_policy_and_solana_message_header'
        || value?.providerReference !== transaction?.signature
        || value?.messageDigest !== transaction?.messageDigest
        || value?.manifestDigest !== transaction?.manifestDigest
        || value?.digestCoverage !== 'message_digest_covers_fee_payer_and_compute_budget_instructions'
        || !Number.isSafeInteger(value?.quoteSlot)
        || value.quoteSlot <= 0
        || !Number.isFinite(Date.parse(String(value?.quotedAt ?? '')))
        || value?.quoteSlotState !== 'verified_finalized_provider_quote'
        || value?.resimulationTrigger !== 'blockhash_or_quote_expiry_before_any_resign'
        || value?.priorityFeeLamports !== 0
        || value?.priorityFeeState !== 'verified_zero_current_pinned_provider_constructor'
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_provider_attempt_inventory_and_terminal_receipt',
        persistenceAuthority: 'canonical_provider_checkpoint_and_payer_policy',
        transactionAttemptDigest: String(value.transactionAttemptDigest),
        attemptOrdinal: Number(value.attemptOrdinal),
        recentBlockhash: String(value.recentBlockhash),
        quotedFeeLamports: Number(value.quotedFeeLamports),
        feePayerRole: 'separated_fee_payer_policy',
        feePayerPolicyId: String(value.feePayerPolicyId),
        feePayerBinding: 'canonical_payer_policy_and_solana_message_header',
        providerReference: String(value.providerReference),
        messageDigest: String(value.messageDigest),
        manifestDigest: String(value.manifestDigest),
        digestCoverage: 'message_digest_covers_fee_payer_and_compute_budget_instructions',
        quoteSlot: Number(value.quoteSlot),
        quotedAt: String(value.quotedAt),
        quoteSlotState: 'verified_finalized_provider_quote',
        resimulationTrigger: 'blockhash_or_quote_expiry_before_any_resign',
        priorityFeeLamports: 0,
        priorityFeeState: 'verified_zero_current_pinned_provider_constructor',
    };
}

function normalizeGovernanceProviderTerminalAttemptOwner(
    value: any,
): NonNullable<GovernanceProviderExecutionReadback['provider']>['attemptOwner'] | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_cost_preflight'
        || !String(value?.preflightId ?? '').trim()
        || !String(value?.payerPolicyId ?? '').trim()
        || !isSha256Digest(String(value?.actionIntentDigest ?? ''))
        || !isSha256Digest(String(value?.transactionAttemptDigest ?? ''))
        || value?.status !== 'consumed'
        || !String(value?.requestId ?? '').trim()
        || !isSha256Digest(String(value?.decisionDigest ?? ''))
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_cost_preflight',
        preflightId: String(value.preflightId),
        payerPolicyId: String(value.payerPolicyId),
        actionIntentDigest: String(value.actionIntentDigest),
        transactionAttemptDigest: String(value.transactionAttemptDigest),
        status: 'consumed',
        requestId: String(value.requestId),
        decisionDigest: String(value.decisionDigest),
    };
}

function normalizeGovernanceProviderRetryBoundary(
    value: any,
): NonNullable<GovernanceProviderExecutionReadback['provider']>['retryBoundary'] | null {
    if (value == null) return null;
    const allowedChanges = ['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_action_intent_and_transaction_attempt'
        || !isSha256Digest(String(value?.actionIntentDigest ?? ''))
        || !isSha256Digest(String(value?.terminalTransactionAttemptDigest ?? ''))
        || !isSha256Digest(String(value?.actionSetDigest ?? ''))
        || JSON.stringify(value?.sameIntentRetry?.allowedChanges) !== JSON.stringify(allowedChanges)
        || value?.sameIntentRetry?.requiresSameActionIntentDigest !== true
        || value?.sameIntentRetry?.requiresSameActionSetDigest !== true
        || value?.sameIntentRetry?.authoritativeExpiryRequired !== true
        || value?.materialChangesRequire !== 'new_decision_stage_or_superseding_case'
        || !Array.isArray(value?.materialChanges)
        || value.materialChanges.length === 0
        || value.materialChanges.some((change: unknown) => !String(change ?? '').trim())
        || value?.automaticMaterialMutationAllowed !== false
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_action_intent_and_transaction_attempt',
        actionIntentDigest: String(value.actionIntentDigest),
        terminalTransactionAttemptDigest: String(value.terminalTransactionAttemptDigest),
        actionSetDigest: String(value.actionSetDigest),
        sameIntentRetry: {
            allowedChanges: ['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'],
            requiresSameActionIntentDigest: true,
            requiresSameActionSetDigest: true,
            authoritativeExpiryRequired: true,
        },
        materialChangesRequire: 'new_decision_stage_or_superseding_case',
        materialChanges: value.materialChanges.map(String),
        automaticMaterialMutationAllowed: false,
    };
}

function normalizeGovernanceProviderHumanReadableAction(
    value: any,
    transaction: any,
): NonNullable<GovernanceProviderExecutionReadback['provider']>['transactions'][number]['humanReadableAction'] | null {
    if (value == null) return null;
    const assetChanges = new Set([
        'governance_weight_supply_created_no_real_asset',
        'governance_weight_deposited_no_real_asset',
        'zero_lamport_self_transfer_no_real_asset',
        'none_no_real_assets',
    ]);
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'verified_provider_plan_and_receipt'
        || value?.operation !== transaction?.stepId
        || !String(value?.summary ?? '').trim()
        || !Array.isArray(value?.programScope)
        || value.programScope.length === 0
        || value.programScope.some((program: unknown) => !String(program ?? '').trim())
        || !Array.isArray(value?.accountScope)
        || value.accountScope.length === 0
        || value.accountScope.some((account: any) => (
            !String(account?.role ?? '').trim() || !String(account?.ref ?? '').trim()
        ))
        || !assetChanges.has(value?.assetChange)
        || !['required_passed_before_provider_signature', 'passed'].includes(value?.simulation)
        || !['provider_onchain', 'multisig_threshold'].includes(value?.enforcement)
        || value?.opaqueInstructions !== false
        || value?.manifestDigest !== transaction?.manifestDigest
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'verified_provider_plan_and_receipt',
        operation: String(value.operation),
        summary: String(value.summary),
        programScope: value.programScope.map(String),
        accountScope: value.accountScope.map((account: any) => ({
            role: String(account.role),
            ref: String(account.ref),
        })),
        assetChange: value.assetChange,
        simulation: value.simulation,
        enforcement: value.enforcement,
        opaqueInstructions: false,
        manifestDigest: String(value.manifestDigest),
    };
}

function normalizeGovernanceProviderActionContext(
    value: any,
    transaction: any,
    index: number,
    transactions: any[],
): NonNullable<GovernanceProviderExecutionReadback['provider']>['transactions'][number]['actionContext'] | null {
    if (value == null) return null;
    const expectedDependencies = index === 0
        ? []
        : [String(transactions[index - 1]?.stepId ?? '')];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'provider_plan_and_attempt_checkpoint'
        || value?.order !== index + 1
        || JSON.stringify(value?.dependsOnStepIds) !== JSON.stringify(expectedDependencies)
        || !isSha256Digest(String(value?.atomicGroupId ?? ''))
        || value?.atomicity !== 'single_provider_transaction'
        || !String(value?.expectedStateChange ?? '').trim()
        || !isSha256Digest(String(value?.idempotencyKey ?? ''))
        || value?.deadline?.kind !== 'last_valid_block_height'
        || !Number.isSafeInteger(Number(value?.deadline?.value))
        || Number(value.deadline.value) <= 0
        || value?.aggregateRule !== 'all_ordered_steps_finalized'
        || !String(transaction?.stepId ?? '').trim()
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'provider_plan_and_attempt_checkpoint',
        order: Number(value.order),
        dependsOnStepIds: value.dependsOnStepIds.map(String),
        atomicGroupId: String(value.atomicGroupId),
        atomicity: 'single_provider_transaction',
        expectedStateChange: String(value.expectedStateChange),
        idempotencyKey: String(value.idempotencyKey),
        deadline: {
            kind: 'last_valid_block_height',
            value: Number(value.deadline.value),
        },
        aggregateRule: 'all_ordered_steps_finalized',
    };
}

function validProviderFinalityTransitions(value: unknown, finalizedSlot: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0 || !Number.isSafeInteger(finalizedSlot)) return false;
    const authority = {
        submitted: 'provider_signature_readback',
        confirmed: 'solana_rpc_signature_status',
        finalized: 'solana_rpc_finalized_transaction',
    } as const;
    const order = { submitted: 1, confirmed: 2, finalized: 3 } as const;
    let prior = 0;
    for (const transition of value) {
        const state = String((transition as any)?.state ?? '') as keyof typeof order;
        if (
            !Object.hasOwn(order, state)
            || (transition as any)?.authority !== authority[state]
            || order[state] <= prior
            || (state === 'finalized'
                ? (transition as any)?.slot !== finalizedSlot
                : (transition as any)?.slot !== undefined)
        ) return false;
        prior = order[state];
    }
    return (value.at(-1) as any)?.state === 'finalized';
}

function normalizeGovernanceRequestDecision(
    value: any,
): NonNullable<CircleGovernanceRequest['decision']> | null {
    if (!value || typeof value !== 'object') return null;
    const decision = value.decision;
    if (
        decision !== 'accepted'
        && decision !== 'rejected'
        && decision !== 'expired'
        && decision !== 'cancelled'
    ) return null;
    const tally = value.tally && typeof value.tally === 'object' && !Array.isArray(value.tally)
        ? value.tally
        : {};
    const mechanismValue = tally.mechanism && typeof tally.mechanism === 'object'
        && !Array.isArray(tally.mechanism)
        ? tally.mechanism as Record<string, unknown>
        : null;
    const mechanism = mechanismValue
        && (mechanismValue.kind === 'equal_weight_threshold'
            || mechanismValue.kind === 'quadratic_voice_credits'
            || mechanismValue.kind === 'quadratic_funding')
        && /^[a-f0-9]{64}$/.test(String(mechanismValue.contractDigest || ''))
        && /^[a-f0-9]{64}$/.test(String(mechanismValue.resultDigest || ''))
        && ['active', 'accepted', 'rejected'].includes(String(mechanismValue.evaluatorState || ''))
        ? {
            kind: mechanismValue.kind as 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding',
            contractDigest: String(mechanismValue.contractDigest),
            resultDigest: String(mechanismValue.resultDigest),
            evaluatorState: mechanismValue.evaluatorState as 'active' | 'accepted' | 'rejected',
        }
        : null;
    return {
        decision,
        reason: String(value.reason || ''),
        tally,
        mechanism,
        decidedAt: value.decidedAt ? String(value.decidedAt) : null,
        decisionDigest: String(value.decisionDigest || ''),
    };
}

function normalizeConfigurationTransitionReadback(
    value: any,
): GovernanceCase['configurationTransitionReadback'] {
    if (
        !value
        || !['planned', 'executed', 'rolled_back', 'drifted'].includes(String(value.status || ''))
        || !value.targetBundle
        || !value.bindingId
    ) return null;
    const normalizeBundle = (bundle: any) => bundle
        && bundle.id
        && Number.isSafeInteger(Number(bundle.version))
        && /^[a-f0-9]{64}$/.test(String(bundle.digest || ''))
        ? { id: String(bundle.id), version: Number(bundle.version), digest: String(bundle.digest) }
        : null;
    const targetBundle = normalizeBundle(value.targetBundle);
    if (!targetBundle) return null;
    const activeBundle = normalizeBundle(value.activeBundle);
    const activePolicy = value.activePolicy
        && value.activePolicy.id
        && value.activePolicy.versionId
        && Number.isSafeInteger(Number(value.activePolicy.version))
        ? {
            id: String(value.activePolicy.id),
            versionId: String(value.activePolicy.versionId),
            version: Number(value.activePolicy.version),
        }
        : null;
    const disposition = value.disposition
        && ['pending_cutover', 'verified', 'drifted'].includes(String(value.disposition.status || ''))
        ? {
            status: value.disposition.status as 'pending_cutover' | 'verified' | 'drifted',
            acceptedArtifacts: {
                total: Number(value.disposition.acceptedArtifacts?.total || 0),
                verified: Number(value.disposition.acceptedArtifacts?.verified || 0),
                immutable: value.disposition.acceptedArtifacts?.immutable === true,
            },
            existingOperationEffects: {
                total: Number(value.disposition.existingOperationEffects?.total || 0),
                verified: Number(value.disposition.existingOperationEffects?.verified || 0),
                continueFrozenLifecycle: value.disposition.existingOperationEffects?.continueFrozenLifecycle === true,
            },
            newInvocations: {
                total: Number(value.disposition.newInvocations?.total || 0),
                targetPolicy: Number(value.disposition.newInvocations?.targetPolicy || 0),
                targetBundleOnly: value.disposition.newInvocations?.targetBundleOnly === true,
            },
            profilePins: {
                total: Number(value.disposition.profilePins?.total || 0),
                verified: Number(value.disposition.profilePins?.verified || 0),
                retainedFrozenVersion: value.disposition.profilePins?.retainedFrozenVersion === true,
            },
            appealAccess: 'bound_to_original_receipt' as const,
        }
        : {
            status: 'drifted' as const,
            acceptedArtifacts: { total: 0, verified: 0, immutable: false },
            existingOperationEffects: { total: 0, verified: 0, continueFrozenLifecycle: false },
            newInvocations: { total: 0, targetPolicy: 0, targetBundleOnly: false },
            profilePins: { total: 0, verified: 0, retainedFrozenVersion: false },
            appealAccess: 'bound_to_original_receipt' as const,
        };
    const recoverySourceBundle = normalizeBundle(value.recovery?.sourceBundle);
    const recoveryStatus = String(value.recovery?.status || '');
    const irreversibleBoundary = String(value.recovery?.irreversibleBoundary || '');
    if (
        !recoverySourceBundle
        || ![
            'not_started',
            'governed_rollback_available',
            'rollback_governance_pending',
            'rolled_back',
            'manual_recovery_required',
        ].includes(recoveryStatus)
        || !['not_crossed', 'unknown_or_crossed'].includes(irreversibleBoundary)
        || value.recovery?.oneClickRollback !== false
    ) return null;
    return {
        status: value.status,
        activeBundle,
        targetBundle,
        activePolicy,
        bindingId: String(value.bindingId),
        sourceRequestId: value.sourceRequestId ? String(value.sourceRequestId) : null,
        sourceDecisionDigest: value.sourceDecisionDigest
            ? String(value.sourceDecisionDigest)
            : null,
        disposition,
        recovery: {
            status: recoveryStatus as NonNullable<GovernanceCase['configurationTransitionReadback']>['recovery']['status'],
            irreversibleBoundary: irreversibleBoundary as NonNullable<GovernanceCase['configurationTransitionReadback']>['recovery']['irreversibleBoundary'],
            oneClickRollback: false,
            canOpenGovernedRollback: value.recovery?.canOpenGovernedRollback === true
                && recoveryStatus === 'governed_rollback_available'
                && irreversibleBoundary === 'not_crossed',
            sourceBundle: recoverySourceBundle,
            rollbackCaseId: value.recovery?.rollbackCaseId
                ? String(value.recovery.rollbackCaseId)
                : null,
        },
        deadlockRecovery: {
            ...normalizeGovernanceRecoveryReadback(value.deadlockRecovery),
            recoveryCaseId: value.deadlockRecovery?.recoveryCaseId
                ? String(value.deadlockRecovery.recoveryCaseId)
                : null,
            ratificationCaseId: value.deadlockRecovery?.ratificationCaseId
                ? String(value.deadlockRecovery.ratificationCaseId)
                : null,
        },
    };
}

function normalizeConfigurationTransitionAuditRecord(
    value: any,
): GovernanceCase['configurationTransitionAuditRecord'] {
    if (
        !value
        || value.schemaVersion !== 1
        || !['authorized_full', 'public_safe', 'minimal_risk_summary_only'].includes(String(value.visibility || ''))
        || !['planned', 'executed', 'rolled_back', 'drifted'].includes(String(value.status || ''))
        || !/^[a-f0-9]{64}$/.test(String(value.recordDigest || ''))
        || value.historicalCaseRecalculation !== false
    ) return null;
    return value as GovernanceCase['configurationTransitionAuditRecord'];
}

function normalizeGovernanceCaseOriginSnapshot(
    value: any,
): GovernanceCase['origin']['snapshot'] {
    if (
        !value
        || value.schemaVersion !== 1
        || value.kind !== 'plaza_message_selection'
        || !Number.isInteger(value.circleId)
        || !/^[a-f0-9]{64}$/.test(String(value.sourceSetDigest || ''))
        || !Array.isArray(value.sources)
        || value.visibility?.sourceOwner !== 'circle_discussion'
        || value.visibility?.caseProjection !== 'member_or_operator'
        || value.visibility?.contentAccess !== 'not_granted_by_case'
        || value.visibility?.publicProjection !== 'withheld'
    ) return null;
    const sources = value.sources.map((source: any) => {
        if (
            source?.type !== 'discussion_message'
            || !String(source.ref || '').trim()
            || !String(source.authorPubkey || '').trim()
            || !/^[a-f0-9]{64}$/.test(String(source.payloadDigest || ''))
            || !/^\d+$/.test(String(source.lamport || ''))
            || !String(source.clientTimestamp || '').trim()
            || typeof source.signatureVerified !== 'boolean'
        ) return null;
        return {
            type: 'discussion_message' as const,
            ref: String(source.ref),
            authorPubkey: String(source.authorPubkey),
            payloadDigest: String(source.payloadDigest),
            lamport: String(source.lamport),
            clientTimestamp: String(source.clientTimestamp),
            messageKind: String(source.messageKind || ''),
            authMode: String(source.authMode || ''),
            signatureVerified: source.signatureVerified,
        };
    });
    if (sources.some((source: unknown) => source === null)) return null;
    return {
        schemaVersion: 1,
        kind: 'plaza_message_selection',
        circleId: value.circleId,
        sourceSetDigest: String(value.sourceSetDigest),
        sources: sources as NonNullable<GovernanceCase['origin']['snapshot']>['sources'],
        visibility: {
            sourceOwner: 'circle_discussion',
            circleType: String(value.visibility.circleType || ''),
            caseProjection: 'member_or_operator',
            contentAccess: 'not_granted_by_case',
            publicProjection: 'withheld',
        },
    };
}

function normalizeGovernanceManualExecutionControl(
    value: any,
): GovernanceManualExecutionControlReadback | null {
    if (value == null) return null;
    const states = new Set([
        'blocked', 'awaiting_provider_receipt', 'receipt_recorded_awaiting_review',
        'submission_required', 'submitted_awaiting_review',
        'rejected_resubmission_required', 'approved_receipt_recorded',
    ]);
    const state = String(value?.state ?? '');
    const assignee = value?.stageAssignee;
    const reviewer = value?.reviewer;
    const evidence = value?.completionEvidence;
    const manual = value?.manualSubmission;
    const blockers = Array.isArray(value?.blockers) ? value.blockers.map(String) : [];
    const normalizedAssignee = assignee == null
        ? null
        : String(assignee?.pubkey ?? '').trim()
            && ['assigned', 'accepted'].includes(assignee?.responsibilityStatus)
            && typeof assignee?.deadlineAt === 'string'
            && Number.isFinite(Date.parse(assignee.deadlineAt))
            ? {
                pubkey: String(assignee.pubkey),
                responsibilityStatus: assignee.responsibilityStatus as 'assigned' | 'accepted',
                deadlineAt: new Date(assignee.deadlineAt).toISOString(),
            }
            : null;
    const normalizedReviewer = reviewer == null
        ? null
        : String(reviewer?.pubkey ?? '').trim()
            && ['assigned', 'accepted'].includes(reviewer?.responsibilityStatus)
            && reviewer?.kind === 'outcome'
            ? {
                pubkey: String(reviewer.pubkey),
                responsibilityStatus: reviewer.responsibilityStatus as 'assigned' | 'accepted',
                kind: 'outcome' as const,
            }
            : null;
    const normalizedEvidence = evidence == null
        ? null
        : String(evidence?.receiptId ?? '').trim()
            && isSha256Digest(String(evidence?.evidenceDigest ?? ''))
            && evidence?.providerFinality === 'finalized'
            && Number.isSafeInteger(evidence?.observedSlot)
            && evidence.observedSlot > 0
            && typeof evidence?.executedAt === 'string'
            && Number.isFinite(Date.parse(evidence.executedAt))
            ? {
                receiptId: String(evidence.receiptId),
                evidenceDigest: String(evidence.evidenceDigest),
                providerFinality: 'finalized' as const,
                observedSlot: Number(evidence.observedSlot),
                executedAt: new Date(evidence.executedAt).toISOString(),
            }
            : null;
    const normalizedManual = manual == null
        ? null
        : ['submitted', 'rejected', 'approved'].includes(manual?.status)
            && Number.isInteger(manual?.version)
            && manual.version > 0
            && isSha256Digest(String(manual?.evidenceDigest ?? ''))
            && Number.isInteger(manual?.evidenceCount)
            && manual.evidenceCount > 0
            && typeof manual?.submittedAt === 'string'
            && Number.isFinite(Date.parse(manual.submittedAt))
            && (manual?.reviewedAt == null || (
                typeof manual.reviewedAt === 'string'
                && Number.isFinite(Date.parse(manual.reviewedAt))
            ))
            && (manual?.reviewReason == null || String(manual.reviewReason).trim())
            && (manual?.receiptId == null || String(manual.receiptId).trim())
            ? {
                status: manual.status as 'submitted' | 'rejected' | 'approved',
                version: Number(manual.version),
                evidenceDigest: String(manual.evidenceDigest),
                evidenceCount: Number(manual.evidenceCount),
                submittedAt: new Date(manual.submittedAt).toISOString(),
                reviewedAt: manual.reviewedAt
                    ? new Date(manual.reviewedAt).toISOString()
                    : null,
                reviewReason: manual.reviewReason ? String(manual.reviewReason) : null,
                receiptId: manual.receiptId ? String(manual.receiptId) : null,
            }
            : null;
    const completionSource = String(value?.completionSource ?? '');
    const manualSource = completionSource === 'controlled_manual_submission_and_review';
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_case_responsibility_and_provider_receipt'
        || !states.has(state)
        || (assignee != null && normalizedAssignee === null)
        || (reviewer != null && normalizedReviewer === null)
        || (evidence != null && normalizedEvidence === null)
        || (manual != null && normalizedManual === null)
        || blockers.some((blocker: string) => !blocker.trim())
        || !['canonical_provider_receipt_only', 'controlled_manual_submission_and_review']
            .includes(completionSource)
        || value?.assignmentGrantsSignerAuthority !== false
        || value?.directMarkExecutedAllowed !== false
        || typeof value?.reviewerActionRequiredAfterReceipt !== 'boolean'
        || (state === 'blocked' && blockers.length === 0)
        || (state !== 'blocked' && blockers.length !== 0)
        || (state === 'awaiting_provider_receipt' && normalizedEvidence !== null)
        || (state === 'receipt_recorded_awaiting_review' && normalizedEvidence === null)
        || (manualSource && normalizedEvidence !== null)
        || (manualSource && value.reviewerActionRequiredAfterReceipt !== false)
        || (!manualSource && normalizedManual !== null)
        || (!manualSource && value.reviewerActionRequiredAfterReceipt !== true)
        || (state === 'submission_required' && normalizedManual !== null)
        || (state === 'submitted_awaiting_review' && normalizedManual?.status !== 'submitted')
        || (state === 'rejected_resubmission_required' && normalizedManual?.status !== 'rejected')
        || (state === 'approved_receipt_recorded' && (
            normalizedManual?.status !== 'approved' || !normalizedManual.receiptId
        ))
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_case_responsibility_and_provider_receipt',
        state: state as GovernanceManualExecutionControlReadback['state'],
        stageAssignee: normalizedAssignee,
        reviewer: normalizedReviewer,
        completionEvidence: normalizedEvidence,
        manualSubmission: normalizedManual,
        completionSource: completionSource as GovernanceManualExecutionControlReadback['completionSource'],
        assignmentGrantsSignerAuthority: false,
        directMarkExecutedAllowed: false,
        reviewerActionRequiredAfterReceipt: value.reviewerActionRequiredAfterReceipt,
        blockers,
    };
}

function normalizeGovernanceCaseRealtimePolicy(
    value: any,
): GovernanceCase['realtimePolicy'] {
    const refreshAfterMs = Number(value?.refreshAfterMs);
    if (
        value?.mode === 'foreground_refetch'
        && value?.terminal === false
        && Number.isInteger(refreshAfterMs)
        && refreshAfterMs >= 3_000
        && refreshAfterMs <= 5_000
    ) {
        return { mode: 'foreground_refetch', refreshAfterMs, terminal: false };
    }
    return { mode: 'stopped', refreshAfterMs: null, terminal: true };
}

function normalizeGovernanceCaseNextRequiredAction(
    value: any,
): GovernanceCase['nextRequiredAction'] {
    const categories = new Set<GovernanceCaseInboxTask['category']>([
        'drafting', 'review', 'decision', 'execution', 'outcome', 'record',
    ]);
    const roles = new Set<GovernanceCaseInboxTask['role']>([
        'proposer', 'coordinator', 'reviewer', 'voter', 'appellant', 'executor', 'outcome_reviewer',
    ]);
    const actions = new Set<GovernanceCaseInboxTask['primaryAction']>([
        'accept_responsibility', 'continue_brief', 'review_brief', 'open_approval_stage', 'cast_vote',
        'open_execution', 'submit_execution_evidence', 'review_execution_evidence',
        'record_outcome', 'view_case', 'view_record',
    ]);
    const statuses = new Set<GovernanceCaseInboxTask['status']>([
        'available', 'waiting', 'completed', 'blocked',
    ]);
    const anchors = new Set([
        'case-brief-title',
        'case-responsibility-coordinator',
        'case-responsibility-review',
        'case-review-focus',
        'case-focus-action',
        'case-decision-stages-title',
        'case-responsibility-execution',
        'case-manual-execution-control',
        'case-responsibility-outcome',
        'case-actual-outcome-title',
        'case-workflow-title',
    ]);
    const status = value?.status as GovernanceCaseInboxTask['status'];
    if (!statuses.has(status)) return null;
    const disabledReason = typeof value?.disabledReason === 'string' && value.disabledReason.trim()
        ? value.disabledReason
        : null;
    if (value?.primaryAction == null) {
        return value?.category == null
            && value?.role == null
            && value?.targetAnchor == null
            && disabledReason
            ? {
                category: null,
                role: null,
                primaryAction: null,
                status,
                disabledReason,
                targetAnchor: null,
            }
            : null;
    }
    if (
        !categories.has(value?.category)
        || !roles.has(value?.role)
        || !actions.has(value?.primaryAction)
        || !anchors.has(value?.targetAnchor)
    ) return null;
    return {
        category: value.category,
        role: value.role,
        primaryAction: value.primaryAction,
        status,
        disabledReason,
        targetAnchor: value.targetAnchor,
    };
}

function normalizeGovernanceCase(value: any, publiclyReadable = false): GovernanceCase {
    const home = value?.governanceHome;
    const subject = value?.governedSubject;
    return {
        id: String(value?.id || ''),
        publiclyReadable,
        readerAudience: value?.readerAudience === 'operator'
            ? 'operator'
            : value?.readerAudience === 'member' ? 'member' : 'public',
        realtimePolicy: normalizeGovernanceCaseRealtimePolicy(value?.realtimePolicy),
        nextRequiredAction: normalizeGovernanceCaseNextRequiredAction(value?.nextRequiredAction),
        attentionPreference: normalizeGovernanceCaseAttentionPreference(value?.attentionPreference),
        readState: normalizeGovernanceCaseReadState(value?.readState, String(value?.id || '')),
        originKind: normalizeGovernanceCaseOriginKind(value?.originKind),
        phase: normalizeGovernanceCasePhase(value?.phase),
        title: String(value?.title || ''),
        requestedDecision: String(value?.requestedDecision || ''),
        requestedAction: value?.requestedAction?.payload
            && typeof value.requestedAction.payload === 'object'
            && !Array.isArray(value.requestedAction.payload)
            ? { payload: value.requestedAction.payload as Record<string, unknown> }
            : null,
        authorityHealthReadback: normalizeGovernanceCaseAuthorityHealthReadback(
            value?.authorityHealthReadback,
        ),
        configurationTransitionReadback: normalizeConfigurationTransitionReadback(
            value?.configurationTransitionReadback,
        ),
        configurationTransitionAuditRecord: normalizeConfigurationTransitionAuditRecord(
            value?.configurationTransitionAuditRecord,
        ),
        memberRights: normalizeGovernanceCaseMemberRights(value?.memberRights),
        caseType: normalizeGovernanceCaseType(value?.caseType),
        template: normalizeGovernanceCaseTemplateSelection(value?.template),
        governanceHome: home && typeof home === 'object'
            ? { type: String(home.type || ''), ref: String(home.ref || '') }
            : null,
        governedSubject: {
            type: String(subject?.type || ''),
            ref: String(subject?.ref || ''),
        },
        origin: {
            kind: String(value?.origin?.kind || value?.originKind || ''),
            ref: value?.origin?.ref ? String(value.origin.ref) : null,
            sourceUrl: value?.origin?.sourceUrl ? String(value.origin.sourceUrl) : null,
            sourceMessageIds: Array.isArray(value?.origin?.sourceMessageIds)
                ? value.origin.sourceMessageIds.map((item: unknown) => String(item))
                : [],
            snapshot: normalizeGovernanceCaseOriginSnapshot(value?.origin?.snapshot),
            snapshotDigest: /^[a-f0-9]{64}$/.test(String(value?.origin?.snapshotDigest || ''))
                ? String(value.origin.snapshotDigest)
                : null,
            snapshotIntegrity: ['verified', 'invalid', 'unavailable', 'withheld']
                .includes(String(value?.origin?.snapshotIntegrity || ''))
                ? value.origin.snapshotIntegrity
                : 'unavailable',
        },
        canonicalUrl: String(value?.canonicalUrl || ''),
        openedAt: value?.openedAt ? String(value.openedAt) : null,
        proposerPubkey: value?.proposerPubkey ? String(value.proposerPubkey) : null,
        fieldVisibility: normalizeGovernanceCaseFieldVisibility(value?.fieldVisibility),
        primaryRequest: value?.primaryRequest ? normalizeRequest(value.primaryRequest) : null,
        executionAuthorityHeader: normalizeGovernanceCaseExecutionAuthorityHeader(
            value?.executionAuthorityHeader,
        ),
        caseAuthorityMatrix: normalizeGovernanceCaseAuthorityMatrix(value?.caseAuthorityMatrix),
        caseBlockers: normalizeGovernanceCaseBlockers(value?.caseBlockers),
        manualExecutionControl: normalizeGovernanceManualExecutionControl(
            value?.manualExecutionControl,
        ),
        policySimulation: normalizeGovernanceCasePolicySimulation(value?.policySimulation),
        ballotDisclosure: normalizeGovernanceCaseBallotDisclosure(value?.ballotDisclosure),
        voteSummary: value?.voteSummary && typeof value.voteSummary === 'object'
            ? value.voteSummary
            : null,
        decisionAuthorityStages: normalizeGovernanceCaseDecisionAuthorityStages(
            value?.decisionAuthorityStages,
        ),
        decisionStages: normalizeGovernanceCaseDecisionStages(value?.decisionStages),
        decisionOutputArtifacts: normalizeGovernanceDecisionOutputArtifacts(
            value?.decisionOutputArtifacts,
        ),
        grantAgreements: normalizeGovernanceGrantAgreements(value?.grantAgreements),
        actualOutcome: normalizeGovernanceCaseActualOutcome(value?.actualOutcome),
        relationship: value?.relationship?.caseId
            && (value.relationship.kind === 'related' || value.relationship.kind === 'supersedes')
            ? {
                kind: value.relationship.kind,
                caseId: String(value.relationship.caseId),
                canonicalUrl: String(value.relationship.canonicalUrl || ''),
                reason: value.relationship.reason ? String(value.relationship.reason) : null,
                recordedAt: value.relationship.recordedAt ? String(value.relationship.recordedAt) : null,
                recordedBy: {
                    homeType: String(value.relationship.recordedBy?.homeType || ''),
                    homeRef: String(value.relationship.recordedBy?.homeRef || ''),
                    actorPubkey: value.relationship.recordedBy?.actorPubkey
                        ? String(value.relationship.recordedBy.actorPubkey)
                        : null,
                },
            }
            : null,
        corrections: Array.isArray(value?.corrections)
            ? value.corrections.flatMap((correction: any) => (
                correction?.caseId && correction?.reason
                    ? [{
                        caseId: String(correction.caseId),
                        canonicalUrl: String(correction.canonicalUrl || ''),
                        reason: String(correction.reason),
                        recordedAt: correction.recordedAt ? String(correction.recordedAt) : null,
                        recordedBy: {
                            homeType: String(correction.recordedBy?.homeType || ''),
                            homeRef: String(correction.recordedBy?.homeRef || ''),
                            actorPubkey: correction.recordedBy?.actorPubkey
                                ? String(correction.recordedBy.actorPubkey)
                                : null,
                        },
                    }]
                    : []
            ))
            : [],
        brief: normalizeGovernanceCaseBrief(value?.brief),
        workflow: normalizeGovernanceCaseWorkflow(value?.workflow),
    };
}

function normalizeGovernanceCaseBlockers(value: unknown): GovernanceCaseBlocker[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((blocker: any) => {
        const openedAt = typeof blocker?.openedAt === 'string'
            && Number.isFinite(Date.parse(blocker.openedAt))
            ? blocker.openedAt
            : null;
        const closedAt = typeof blocker?.closedAt === 'string'
            && Number.isFinite(Date.parse(blocker.closedAt))
            ? blocker.closedAt
            : null;
        const status = blocker?.status === 'open' && blocker?.closedAt === null
            ? 'open' as const
            : blocker?.status === 'resolved' && closedAt
                ? 'resolved' as const
                : null;
        const contract = blocker?.code === 'funding_required'
            ? {
                code: 'funding_required' as const,
                resumeState: 'accepted_pending_execution' as const,
                resolutionRequirement: 'verified_payer_budget_or_reimbursement' as const,
            }
            : blocker?.code === 'funding_amendment_required'
                ? {
                    code: 'funding_amendment_required' as const,
                    resumeState: 'accepted_pending_funding_amendment' as const,
                    resolutionRequirement: 'original_decision_authority_accepted_cost_amendment' as const,
                }
                : null;
        if (
            !String(blocker?.id ?? '').trim()
            || !contract
            || blocker?.scope !== 'execution'
            || blocker?.scopeRef !== `execution-receipt:${String(blocker?.evidenceReceiptId ?? '')}`
            || !status
            || blocker?.owner !== 'original_decision_authority'
            || blocker?.sla !== 'governed_resolution_required_no_implicit_deadline'
            || blocker?.resumeState !== contract.resumeState
            || blocker?.resolutionRequirement !== contract.resolutionRequirement
            || !String(blocker?.evidenceReceiptId ?? '').trim()
            || !openedAt
            || blocker?.retryEligibility !== (status === 'resolved'
                ? 'manual_same_intent_retry_ready'
                : 'blocked_pending_governed_resolution')
            || blocker?.automaticRetry !== false
        ) return [];
        return [{
            id: String(blocker.id),
            code: contract.code,
            scope: 'execution' as const,
            scopeRef: String(blocker.scopeRef),
            status,
            owner: 'original_decision_authority' as const,
            sla: 'governed_resolution_required_no_implicit_deadline' as const,
            resumeState: contract.resumeState,
            resolutionRequirement: contract.resolutionRequirement,
            evidenceReceiptId: String(blocker.evidenceReceiptId),
            openedAt,
            closedAt: status === 'resolved' ? closedAt : null,
            retryEligibility: status === 'resolved'
                ? 'manual_same_intent_retry_ready' as const
                : 'blocked_pending_governed_resolution' as const,
            automaticRetry: false as const,
        }];
    });
}

function normalizeGovernanceCaseExecutionAuthorityHeader(
    value: any,
): GovernanceCaseExecutionAuthorityHeader | null {
    if (value == null) return null;
    const decisionStatuses = new Set([
        'pending', 'accepted', 'rejected', 'expired', 'cancelled', 'unavailable',
    ]);
    const executionStatuses = new Set([
        'not_ready', 'not_required', 'pending', 'executed', 'failed', 'skipped', 'unavailable',
    ]);
    const providerStatuses = new Set(['executed', 'failed', 'held', 'preflight_ready', 'unavailable']);
    const state = value?.state;
    if (
        value?.schemaVersion !== 1
        || value?.boundary !== 'workflow_assignment_and_payer_are_not_execution_authority'
        || !decisionStatuses.has(state?.decisionStatus)
        || !executionStatuses.has(state?.executionStatus)
        || !providerStatuses.has(state?.providerStatus)
        || !['verified', 'unavailable'].includes(state?.integrity)
        || (state?.receiptId !== null
            && (typeof state?.receiptId !== 'string' || !state.receiptId.trim()))
        || (state?.blocker !== null
            && (typeof state?.blocker !== 'string' || !state.blocker.trim()))
    ) return null;

    const provider = value?.technicalProvider;
    const technicalProvider = provider == null
        ? null
        : (
            ['realms_provider_binding', 'squads_provider_binding'].includes(provider?.module)
            && typeof provider?.network === 'string'
            && provider.network.trim()
            && typeof provider?.profileRef === 'string'
            && provider.profileRef.trim()
            && Number.isSafeInteger(provider?.profileVersion)
            && provider.profileVersion > 0
            && typeof provider?.resourceRef === 'string'
            && provider.resourceRef.trim()
            && typeof provider?.ownerProgramRef === 'string'
            && provider.ownerProgramRef.trim()
            && Number.isSafeInteger(provider?.observedSlot)
            && provider.observedSlot > 0
            && ['provider_native_receipt_and_readback', 'live_execution_authority_preflight']
                .includes(provider?.source)
                ? {
                    module: provider.module,
                    network: provider.network,
                    profileRef: provider.profileRef,
                    profileVersion: provider.profileVersion,
                    resourceRef: provider.resourceRef,
                    ownerProgramRef: provider.ownerProgramRef,
                    observedSlot: provider.observedSlot,
                    source: provider.source,
                } as GovernanceCaseExecutionAuthorityHeader['technicalProvider']
                : null
        );
    if (provider != null && technicalProvider == null) return null;

    if (!Array.isArray(value?.executionAuthorities)) return null;
    const executionAuthorities = value.executionAuthorities.map((authority: any) => {
        const allowedOperations = Array.isArray(authority?.allowedOperations)
            ? authority.allowedOperations.filter((operation: unknown) => (
                typeof operation === 'string' && operation.trim()
            )).map(String)
            : [];
        if (
            typeof authority?.role !== 'string'
            || !authority.role.trim()
            || (authority?.publicAuthority !== null
                && (typeof authority?.publicAuthority !== 'string'
                    || !authority.publicAuthority.trim()))
            || typeof authority?.custodyProvider !== 'string'
            || !authority.custodyProvider.trim()
            || typeof authority?.custodyStatus !== 'string'
            || !authority.custodyStatus.trim()
            || allowedOperations.length === 0
            || !Number.isSafeInteger(authority?.verifiedSlot)
            || authority.verifiedSlot <= 0
            || typeof authority?.status !== 'string'
            || !authority.status.trim()
            || (authority?.sourceRequestId !== null
                && (typeof authority?.sourceRequestId !== 'string'
                    || !authority.sourceRequestId.trim()))
            || (authority?.sourceDecisionDigest !== null
                && !/^[a-f0-9]{64}$/.test(String(authority.sourceDecisionDigest)))
            || !['provider_native_receipt_and_readback', 'canonical_resource_authority_binding']
                .includes(authority?.source)
        ) return null;
        return {
            role: authority.role,
            publicAuthority: authority.publicAuthority,
            custodyProvider: authority.custodyProvider,
            custodyStatus: authority.custodyStatus,
            allowedOperations,
            verifiedSlot: authority.verifiedSlot,
            status: authority.status,
            sourceRequestId: authority.sourceRequestId,
            sourceDecisionDigest: authority.sourceDecisionDigest,
            source: authority.source,
        } as GovernanceCaseExecutionAuthorityHeader['executionAuthorities'][number];
    });
    if (executionAuthorities.some((authority: GovernanceCaseExecutionAuthorityHeader['executionAuthorities'][number] | null) => (
        authority === null
    ))) return null;
    if (technicalProvider == null && executionAuthorities.length > 0) return null;
    const expectedAuthoritySource = technicalProvider?.source === 'live_execution_authority_preflight'
        ? 'canonical_resource_authority_binding'
        : 'provider_native_receipt_and_readback';
    if (
        technicalProvider
        && executionAuthorities.some((authority: GovernanceCaseExecutionAuthorityHeader['executionAuthorities'][number] | null) => (
            authority?.source !== expectedAuthoritySource
        ))
    ) return null;
    if (
        technicalProvider == null
        && (state.integrity !== 'unavailable' || state.providerStatus !== 'unavailable')
    ) return null;

    return {
        schemaVersion: 1,
        technicalProvider,
        executionAuthorities: executionAuthorities as GovernanceCaseExecutionAuthorityHeader['executionAuthorities'],
        state: {
            decisionStatus: state.decisionStatus,
            executionStatus: state.executionStatus,
            providerStatus: state.providerStatus,
            integrity: state.integrity,
            receiptId: state.receiptId,
            blocker: state.blocker,
        },
        boundary: 'workflow_assignment_and_payer_are_not_execution_authority',
    };
}

function normalizeGovernanceCaseAuthorityMatrix(value: any): GovernanceCaseAuthorityMatrix | null {
    if (value == null) return null;
    if (
        value?.schemaVersion !== 1
        || !['verified', 'invalid'].includes(value?.integrity)
        || value?.boundary !== 'discussion_decision_execution_outcome_each_has_unique_authority_or_reconciled_rule'
        || !Array.isArray(value?.entries)
        || value.entries.length < 4
    ) return null;
    const entries = value.entries.map((entry: any) => {
        const phase = entry?.phase;
        const binding = entry?.binding;
        const authority = entry?.authority;
        const reconciledRule = entry?.reconciledRule;
        if (
            !['discussion', 'decision', 'execution', 'outcome'].includes(phase)
            || !['unique_authority', 'reconciled_rule'].includes(binding)
            || typeof entry?.source !== 'string'
            || !entry.source.trim()
        ) return null;
        if (binding === 'unique_authority') {
            if (
                !authority
                || typeof authority?.type !== 'string'
                || !authority.type.trim()
                || typeof authority?.ref !== 'string'
                || !authority.ref.trim()
                || typeof authority?.version !== 'string'
                || !authority.version.trim()
                || reconciledRule !== null
            ) return null;
            return {
                phase,
                binding,
                authority: {
                    type: authority.type,
                    ref: authority.ref,
                    version: authority.version,
                },
                reconciledRule: null,
                source: entry.source,
            } as GovernanceCaseAuthorityMatrix['entries'][number];
        }
        if (
            authority !== null
            || !reconciledRule
            || typeof reconciledRule?.rule !== 'string'
            || !reconciledRule.rule.trim()
            || typeof reconciledRule?.owner !== 'string'
            || !reconciledRule.owner.trim()
            || typeof reconciledRule?.reason !== 'string'
            || !reconciledRule.reason.trim()
        ) return null;
        return {
            phase,
            binding,
            authority: null,
            reconciledRule: {
                rule: reconciledRule.rule,
                owner: reconciledRule.owner,
                reason: reconciledRule.reason,
            },
            source: entry.source,
        } as GovernanceCaseAuthorityMatrix['entries'][number];
    });
    if (entries.some((entry: GovernanceCaseAuthorityMatrix['entries'][number] | null) => entry === null)) {
        return null;
    }
    const phases = new Set(entries.map((entry: GovernanceCaseAuthorityMatrix['entries'][number] | null) => entry?.phase));
    if (!['discussion', 'decision', 'execution', 'outcome'].every((phase) => phases.has(phase))) {
        return null;
    }
    return {
        schemaVersion: 1,
        integrity: value.integrity,
        entries: entries as GovernanceCaseAuthorityMatrix['entries'],
        boundary: value.boundary,
    };
}

function normalizeGovernanceCaseAttentionPreference(
    value: any,
    required = false,
): GovernanceCaseAttentionPreference | null {
    if (value == null && !required) return null;
    const levels = new Set(['watch', 'track', 'mute']);
    const ordinaryPolicies = new Set(['high_attention', 'normal_attention', 'muted']);
    if (
        value?.schemaVersion !== 1
        || !levels.has(value?.level)
        || !Number.isSafeInteger(value?.version)
        || value.version < 0
        || typeof value?.persisted !== 'boolean'
        || !ordinaryPolicies.has(value?.ordinaryUpdatePolicy)
        || value?.requiredActionPolicy !== 'always_deliver'
    ) throw new Error('invalid_governance_case_attention_preference_contract');
    return {
        schemaVersion: 1,
        level: value.level,
        version: value.version,
        persisted: value.persisted,
        ordinaryUpdatePolicy: value.ordinaryUpdatePolicy,
        requiredActionPolicy: 'always_deliver',
        updatedAt: value.updatedAt ? String(value.updatedAt) : null,
    } as GovernanceCaseAttentionPreference;
}

const GOVERNANCE_CASE_RESUME_FRAGMENTS = new Set([
    'governance-case-attention-title',
    'governance-case-authority-title',
    'governance-case-visibility-title',
    'configuration-transition-impact',
    'case-workflow-title',
    'case-member-rights-title',
    'case-actual-outcome-title',
    'case-responsibility-coordinator',
    'case-responsibility-review',
    'case-review-focus',
    'case-focus-action',
    'case-responsibility-execution',
    'case-responsibility-outcome',
    'case-manual-execution-control',
    'case-public-decision-summary-title',
    'case-ballot-disclosure-title',
    'case-decision-stages-title',
    'case-decision-output-title',
    'case-grant-agreement-title',
    'case-brief-title',
    'case-brief-actors-title',
    'case-brief-content-history-title',
    'case-brief-sources-title',
    'case-brief-claims-title',
    'case-brief-readiness-title',
]);

export function governanceCaseResumeFragment(value: string): string | null {
    return GOVERNANCE_CASE_RESUME_FRAGMENTS.has(value) ? value : null;
}

function normalizeGovernanceCaseReadState(
    value: any,
    caseId: string,
    required = false,
): GovernanceCaseReadState | null {
    if (value == null && !required) return null;
    const statuses = new Set(['new', 'changed', 'unchanged']);
    const fragment = value?.resumeFragment == null
        ? null
        : governanceCaseResumeFragment(String(value.resumeFragment));
    const expectedUrl = `/governance/cases/${encodeURIComponent(caseId)}${fragment ? `#${fragment}` : ''}`;
    if (value?.schemaVersion !== 1
        || !statuses.has(value?.status)
        || typeof value?.currentActivityCursor !== 'string'
        || !value.currentActivityCursor
        || !Number.isSafeInteger(value?.version)
        || value.version < 0
        || (value?.resumeFragment != null && fragment == null)
        || value?.resumeUrl !== expectedUrl
        || (value?.lastReadAt != null && Number.isNaN(new Date(value.lastReadAt).getTime()))) {
        throw new Error('invalid_governance_case_read_state_contract');
    }
    return {
        schemaVersion: 1,
        status: value.status,
        currentActivityCursor: value.currentActivityCursor,
        version: value.version,
        lastReadAt: value.lastReadAt == null ? null : String(value.lastReadAt),
        resumeFragment: fragment,
        resumeUrl: expectedUrl,
    } as GovernanceCaseReadState;
}

function normalizeGovernanceContinueWorking(value: any): NonNullable<GovernanceInbox['continueWorking']> {
    const caseId = String(value?.caseId || '');
    const fragment = String(value?.canonicalUrl || '').split('#')[1] ?? '';
    const expectedUrl = `/governance/cases/${encodeURIComponent(caseId)}${fragment ? `#${fragment}` : ''}`;
    if (!caseId
        || (fragment && governanceCaseResumeFragment(fragment) == null)
        || value?.canonicalUrl !== expectedUrl
        || !new Set(['new', 'changed', 'unchanged']).has(value?.status)
        || Number.isNaN(new Date(value?.lastReadAt).getTime())) {
        throw new Error('invalid_governance_continue_working_contract');
    }
    return {
        caseId,
        title: String(value?.title || ''),
        status: value.status,
        canonicalUrl: expectedUrl,
        lastReadAt: String(value.lastReadAt),
    } as NonNullable<GovernanceInbox['continueWorking']>;
}

function normalizeGovernanceCaseMemberRights(value: any): GovernanceCase['memberRights'] {
    if (
        !value
        || value.actionType !== 'circle.membership.member.remove'
        || value.impact !== 'permanent_member_removal'
    ) return null;
    const viewerRoles = new Set(['respondent_appellant', 'operator', 'observer']);
    return {
        actionType: 'circle.membership.member.remove',
        impact: 'permanent_member_removal',
        viewerRole: viewerRoles.has(value.viewerRole) ? value.viewerRole : null,
        targetUserId: Number.isSafeInteger(value.targetUserId) ? value.targetUserId : null,
        targetRole: value.targetRole ? String(value.targetRole) : null,
        publicReason: value.publicReason ? String(value.publicReason) : null,
        evidenceDigest: /^[a-f0-9]{64}$/.test(String(value.evidenceDigest ?? ''))
            ? String(value.evidenceDigest)
            : null,
        appealWindowSeconds: Number.isSafeInteger(value.appealWindowSeconds)
            ? value.appealWindowSeconds
            : null,
        appealDeadline: value.appealDeadline ? String(value.appealDeadline) : null,
        effectBeforeDeadline: value.effectBeforeDeadline === 'forbidden' ? 'forbidden' : null,
        reporter: value.reporter && typeof value.reporter === 'object'
            ? {
                visibility: String(value.reporter.visibility ?? 'withheld'),
                pubkey: value.reporter.pubkey ? String(value.reporter.pubkey) : null,
            }
            : null,
        authorization: value.authorization && typeof value.authorization === 'object'
            ? {
                status: [
                    'pending_decision',
                    'accepted_artifact',
                    'blocked_missing_accepted_artifact',
                    'terminal_without_authorization',
                ].includes(value.authorization.status)
                    ? value.authorization.status
                    : 'blocked_missing_accepted_artifact',
                artifactId: value.authorization.artifactId ? String(value.authorization.artifactId) : null,
                artifactDigest: /^[a-f0-9]{64}$/.test(String(value.authorization.artifactDigest ?? ''))
                    ? String(value.authorization.artifactDigest)
                    : null,
                decisionDigest: /^[a-f0-9]{64}$/.test(String(value.authorization.decisionDigest ?? ''))
                    ? String(value.authorization.decisionDigest)
                    : null,
                source: value.authorization.source === 'native_decision_output_artifact'
                    ? 'native_decision_output_artifact'
                    : null,
            }
            : null,
        executionStatus: value.executionStatus ? String(value.executionStatus) : null,
        providerFinality: value.providerFinality ? String(value.providerFinality) : null,
        membershipEffect: value.membershipEffect === 'not_executed_by_p05'
            ? 'not_executed_by_p05'
            : null,
    };
}

function normalizeGovernanceEvidenceSharePackage(value: any): GovernanceEvidenceSharePackage {
    const statuses = new Set<GovernanceEvidenceSharePackage['status']>([
        'requested', 'authorized', 'denied', 'revoked',
    ]);
    const effectiveStatuses = new Set<GovernanceEvidenceSharePackage['effectiveStatus']>([
        'requested', 'authorized', 'denied', 'revoked', 'expired', 'source_unavailable',
    ]);
    const status = statuses.has(value?.status) ? value.status : 'requested';
    const effectiveStatus = effectiveStatuses.has(value?.effectiveStatus)
        ? value.effectiveStatus
        : status;
    const disclosure = value?.minimumDisclosure;
    const minimumDisclosure = disclosure?.schemaVersion === 1
        && disclosure?.kind === 'moderation_report_minimum_disclosure'
        && String(disclosure?.reportId ?? '')
        && Number.isSafeInteger(Number(disclosure?.targetCircleId))
        && Number.isSafeInteger(Number(disclosure?.recipientCircleId))
        && disclosure?.redactedAllegation?.format === 'reason_code_only'
        && String(disclosure?.redactedAllegation?.reasonCode ?? '')
        && disclosure?.subject?.type === 'communication_room_member'
        && String(disclosure?.subject?.ref ?? '')
        && isSha256Digest(String(disclosure?.subject?.snapshotDigest ?? ''))
        && isSha256Digest(String(disclosure?.sealedEvidenceDigest ?? ''))
        && isSha256Digest(String(disclosure?.submissionDigest ?? ''))
        && JSON.stringify(disclosure?.includedFields) === JSON.stringify(['redacted_allegation', 'necessary_subject_ref', 'evidence_digest'])
        && JSON.stringify(disclosure?.excludedFields) === JSON.stringify(['sealed_report_statement', 'reporter_identity_and_pii', 'offsite_evidence'])
        && disclosure?.permittedUse === 'moderation_case_review_only'
        && JSON.stringify(disclosure?.prohibitedUses) === JSON.stringify(['delegate_training', 'delegate_performance_evaluation', 'other_target'])
        && disclosure?.additionalDisclosure === 'separate_item_assignment_required'
        ? disclosure as GovernanceEvidenceSharePackage['minimumDisclosure']
        : null;
    if ((value?.moderationReportId == null) !== (minimumDisclosure == null)) {
        throw new Error('governance_evidence_share_moderation_disclosure_invalid');
    }
    return {
        id: String(value?.id || ''),
        caseId: String(value?.caseId || ''),
        bindingId: String(value?.bindingId || ''),
        targetCircleId: Number(value?.targetCircleId || 0),
        recipientCircleId: Number(value?.recipientCircleId || 0),
        requestedByPubkey: String(value?.requestedByPubkey || ''),
        purpose: String(value?.purpose || ''),
        requestNote: value?.requestNote ? String(value.requestNote) : null,
        safeSummary: value?.safeSummary ? String(value.safeSummary) : null,
        sourceRefs: Array.isArray(value?.sourceRefs)
            ? value.sourceRefs.flatMap((item: any) => {
                const sourceMaterialId = Number(item?.sourceMaterialId);
                const contentDigest = String(item?.contentDigest || '');
                return Number.isInteger(sourceMaterialId) && sourceMaterialId > 0 && isSha256Digest(contentDigest)
                    ? [{ sourceMaterialId, contentDigest }]
                    : [];
            })
            : [],
        moderationReportId: value?.moderationReportId ? String(value.moderationReportId) : null,
        minimumDisclosure,
        status,
        effectiveStatus,
        version: Number(value?.version || 0),
        digest: String(value?.digest || ''),
        decidedByPubkey: value?.decidedByPubkey ? String(value.decidedByPubkey) : null,
        decidedAt: value?.decidedAt ? String(value.decidedAt) : null,
        decisionReason: value?.decisionReason ? String(value.decisionReason) : null,
        expiresAt: value?.expiresAt ? String(value.expiresAt) : null,
        revokedByPubkey: value?.revokedByPubkey ? String(value.revokedByPubkey) : null,
        revokedAt: value?.revokedAt ? String(value.revokedAt) : null,
        createdAt: String(value?.createdAt || ''),
        updatedAt: String(value?.updatedAt || ''),
        events: Array.isArray(value?.events)
            ? value.events.flatMap((event: any) => {
                const eventTypes = new Set<GovernanceEvidenceShareEvent['eventType']>([
                    'requested', 'authorized', 'denied', 'revoked', 'read', 'export',
                ]);
                if (!eventTypes.has(event?.eventType)) return [];
                return [{
                    id: String(event?.id || ''),
                    eventType: event.eventType,
                    actorPubkey: String(event?.actorPubkey || ''),
                    purpose: String(event?.purpose || ''),
                    result: event?.result === 'allowed' ? 'allowed' as const : 'denied' as const,
                    reason: event?.reason ? String(event.reason) : null,
                    packageVersion: Number(event?.packageVersion || 0),
                    packageDigest: String(event?.packageDigest || ''),
                    createdAt: String(event?.createdAt || ''),
                }];
            })
            : [],
    };
}

function normalizeGovernanceCaseFieldVisibility(
    value: unknown,
): GovernanceCase['fieldVisibility'] {
    const fieldGroups = new Set<GovernanceCase['fieldVisibility'][number]['fieldGroup']>([
        'case_identity', 'origin', 'brief', 'source_fact', 'ai_suggestion', 'review_opinion',
        'decision', 'execution', 'outcome', 'authority', 'artifact', 'raw_ballot',
    ]);
    const decisions = new Set<GovernanceCase['fieldVisibility'][number]['decision']>([
        'allow', 'redact', 'deny',
    ]);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: any) => {
        const fieldGroup = String(item?.fieldGroup || '') as GovernanceCase['fieldVisibility'][number]['fieldGroup'];
        const decision = String(item?.decision || '') as GovernanceCase['fieldVisibility'][number]['decision'];
        const reason = String(item?.reason || '');
        return fieldGroups.has(fieldGroup) && decisions.has(decision) && reason
            ? [{ fieldGroup, decision, reason }]
            : [];
    });
}

function normalizeGovernanceCaseInboxTask(value: any): GovernanceCaseInboxTask {
    const categories = new Set<GovernanceCaseInboxTask['category']>([
        'drafting', 'review', 'decision', 'execution', 'outcome', 'record',
    ]);
    const roles = new Set<GovernanceCaseInboxTask['role']>([
        'proposer', 'coordinator', 'reviewer', 'voter', 'appellant', 'executor', 'outcome_reviewer',
    ]);
    const actions = new Set<GovernanceCaseInboxTask['primaryAction']>([
        'accept_responsibility', 'continue_brief', 'review_brief', 'open_approval_stage', 'cast_vote',
        'open_execution', 'submit_execution_evidence', 'review_execution_evidence',
        'record_outcome', 'view_case', 'view_record',
    ]);
    const statuses = new Set<GovernanceCaseInboxTask['status']>([
        'available', 'waiting', 'completed', 'blocked',
    ]);
    return {
        category: categories.has(value?.category) ? value.category : 'record',
        role: roles.has(value?.role) ? value.role : 'proposer',
        primaryAction: actions.has(value?.primaryAction) ? value.primaryAction : 'view_case',
        status: statuses.has(value?.status) ? value.status : 'blocked',
        deadline: value?.deadline ? String(value.deadline) : null,
        disabledReason: value?.disabledReason ? String(value.disabledReason) : null,
        providerRecovery: normalizeGovernanceProviderRecovery(value?.providerRecovery),
        executionProgress: normalizeGovernanceProviderExecutionProgress(value?.executionProgress),
        automaticExecutionAvailability: normalizeGovernanceAutomaticExecutionAvailability(
            value?.automaticExecutionAvailability,
        ),
        executionPreview: normalizeGovernanceProviderExecutionPreview(value?.executionPreview),
        executionAuthorityPreflight:
            normalizeGovernanceProviderExecutionAuthorityPreflight(
                value?.executionAuthorityPreflight,
            ),
        resourceExecutionAdmission: normalizeGovernanceProviderResourceExecutionAdmission(
            value?.resourceExecutionAdmission,
        ),
        manualExecutionControl: normalizeGovernanceManualExecutionControl(
            value?.manualExecutionControl,
        ),
        executionParticipantBoundary: normalizeGovernanceExecutionParticipantBoundary(
            value?.executionParticipantBoundary,
        ),
        decisionExecutionStatus: value?.decisionExecutionStatus
            ? {
                decisionStatus: normalizeDecisionStatus(
                    value.decisionExecutionStatus.decisionStatus,
                ),
                executionStatus: normalizeExecutionStatus(
                    value.decisionExecutionStatus.executionStatus,
                ),
            }
            : null,
        providerHealth: normalizeGovernanceCaseInboxProviderHealth(value?.providerHealth),
    };
}

function normalizeGovernanceExecutionParticipantBoundary(
    value: any,
): GovernanceExecutionParticipantBoundary | null {
    const actorTaskSource = String(value?.actorTaskSource ?? '');
    const participantRole = String(value?.participantRole ?? '');
    const responsibilityStatus = value?.responsibilityStatus == null
        ? null
        : String(value.responsibilityStatus);
    const pendingWork = String(value?.pendingWork ?? '');
    const signerAuthoritySource = String(value?.signerAuthoritySource ?? '');
    const authorityRoles = Array.isArray(value?.authorityRoles)
        ? value.authorityRoles.map(String).filter(Boolean)
        : [];
    const actorAuthorityRoles = Array.isArray(value?.actorAuthorityRoles)
        ? value.actorAuthorityRoles.map(String).filter(Boolean)
        : [];
    const allowedOperations = Array.isArray(value?.allowedOperations)
        ? value.allowedOperations.map(String).filter(Boolean)
        : [];
    if (
        value?.schemaVersion !== 1
        || value?.authority !== 'canonical_case_responsibility_and_resource_authority_binding'
        || value?.taskProducer !== 'my_governance_case_inbox'
        || !String(value?.actorPubkey ?? '').trim()
        || !['case_execution_responsibility', 'provider_execution_authority'].includes(actorTaskSource)
        || !['execution_coordinator', 'external_authority_participant'].includes(participantRole)
        || !(responsibilityStatus === null || ['assigned', 'accepted'].includes(responsibilityStatus))
        || !String(value?.provider ?? '').trim()
        || !String(value?.resourceRef ?? '').trim()
        || !String(value?.requestId ?? '').trim()
        || !/^[a-f0-9]{64}$/.test(String(value?.decisionDigest ?? ''))
        || authorityRoles.length === 0
        || allowedOperations.length === 0
        || !['provider_execution_task', 'provider_signature_or_execution_task'].includes(pendingWork)
        || !['none_assignment_only', 'resource_authority_binding'].includes(signerAuthoritySource)
        || value?.assignmentGrantsSignerAuthority !== false
        || value?.assignmentGrantsPayerAuthority !== false
        || !String(value?.payerPolicyId ?? '').trim()
        || value?.feePayerRole !== 'fee_payer_only'
        || value?.payerSeparatedFromSigner !== true
        || value?.signerRefExposed !== false
        || value?.privateKeyExposure !== 'none_public_readback_only'
    ) return null;
    return {
        schemaVersion: 1,
        authority: 'canonical_case_responsibility_and_resource_authority_binding',
        taskProducer: 'my_governance_case_inbox',
        actorPubkey: String(value.actorPubkey),
        actorTaskSource: actorTaskSource as GovernanceExecutionParticipantBoundary['actorTaskSource'],
        participantRole: participantRole as GovernanceExecutionParticipantBoundary['participantRole'],
        responsibilityStatus: responsibilityStatus as GovernanceExecutionParticipantBoundary['responsibilityStatus'],
        provider: String(value.provider),
        resourceRef: String(value.resourceRef),
        requestId: String(value.requestId),
        decisionDigest: String(value.decisionDigest),
        authorityRoles,
        actorAuthorityRoles,
        allowedOperations,
        pendingWork: pendingWork as GovernanceExecutionParticipantBoundary['pendingWork'],
        signerAuthoritySource: signerAuthoritySource as GovernanceExecutionParticipantBoundary['signerAuthoritySource'],
        assignmentGrantsSignerAuthority: false,
        assignmentGrantsPayerAuthority: false,
        payerPolicyId: String(value.payerPolicyId),
        feePayerRole: 'fee_payer_only',
        payerSeparatedFromSigner: true,
        signerRefExposed: false,
        privateKeyExposure: 'none_public_readback_only',
    };
}

function normalizeGovernanceCaseInboxProviderHealth(
    value: any,
): GovernanceCaseInboxTask['providerHealth'] {
    const statuses = new Set(['healthy', 'held', 'degraded']);
    const status = String(value?.status ?? '');
    const provider = String(value?.provider ?? '').trim();
    if (!statuses.has(status) || !provider) return null;
    const readinessState = String(value?.readiness?.readinessState ?? '');
    const riskMaturity = String(value?.readiness?.riskMaturity ?? '');
    const readinessBlockers = Array.isArray(value?.readiness?.blockers)
        ? value.readiness.blockers.map(String).filter(Boolean)
        : [];
    if (
        !['ready', 'setup_required', 'degraded', 'unavailable'].includes(readinessState)
        || !['stable', 'experimental'].includes(riskMaturity)
        || typeof value?.readiness?.stageOpenAllowed !== 'boolean'
        || typeof value?.readiness?.executionOpenAllowed !== 'boolean'
        || typeof value?.readiness?.riskConfirmationRequired !== 'boolean'
        || value?.readiness?.authority !== 'provider_trust_profile_resource_reconciliation_readback'
        || (readinessState === 'ready'
            && (value.readiness.stageOpenAllowed !== true
                || value.readiness.executionOpenAllowed !== true
                || readinessBlockers.length !== 0))
        || (readinessState !== 'ready'
            && (value.readiness.stageOpenAllowed !== false
                || value.readiness.executionOpenAllowed !== false
                || readinessBlockers.length === 0))
        || (riskMaturity === 'experimental' && value.readiness.riskConfirmationRequired !== true)
        || (riskMaturity === 'stable' && value.readiness.riskConfirmationRequired !== false)
    ) return null;
    const observedSlot = Number(value?.observedSlot);
    const observedAt = value?.observedAt ? String(value.observedAt) : null;
    const incidentState = String(value?.incident?.state ?? '');
    const incidentOccurredAt = value?.incident?.occurredAt
        ? String(value.incident.occurredAt)
        : null;
    const incident = ['suspected', 'confirmed', 'contained', 'reconciled'].includes(incidentState)
        && /^[a-f0-9]{64}$/.test(String(value?.incident?.id ?? ''))
        && /^[a-f0-9]{64}$/.test(String(value?.incident?.evidenceDigest ?? ''))
        && ['blocked', 'eligible_after_reconciliation'].includes(
            String(value?.incident?.pendingExecution ?? ''),
        )
        && value?.incident?.originalDecisionAndReceipt === 'preserved'
        && incidentOccurredAt
        && Number.isFinite(Date.parse(incidentOccurredAt))
        ? {
            id: String(value.incident.id),
            state: incidentState as 'suspected' | 'confirmed' | 'contained' | 'reconciled',
            occurredAt: incidentOccurredAt,
            evidenceDigest: String(value.incident.evidenceDigest),
            pendingExecution: value.incident.pendingExecution as 'blocked' | 'eligible_after_reconciliation',
            originalDecisionAndReceipt: 'preserved' as const,
        }
        : null;
    const revalidation = Array.isArray(value?.revalidation?.triggers)
        && value.revalidation.triggers.length > 0
        && typeof value?.revalidation?.currentProfileRef === 'string'
        && typeof value?.revalidation?.currentProfileVersion === 'string'
        && typeof value?.revalidation?.targetProfileRef === 'string'
        && typeof value?.revalidation?.targetProfileVersion === 'string'
        && /^[a-f0-9]{64}$/.test(String(value?.revalidation?.targetProfileDigest ?? ''))
        && value?.revalidation?.transitionPolicy === 'governed_transition_plan_pin_suspend_reopen'
        ? {
            triggers: value.revalidation.triggers.map(String),
            currentProfileRef: value.revalidation.currentProfileRef,
            currentProfileVersion: value.revalidation.currentProfileVersion,
            targetProfileRef: value.revalidation.targetProfileRef,
            targetProfileVersion: value.revalidation.targetProfileVersion,
            targetProfileDigest: value.revalidation.targetProfileDigest,
            transitionPolicy: 'governed_transition_plan_pin_suspend_reopen' as const,
        }
        : null;
    const syncState = String(value?.sync?.state ?? '');
    const lastSyncedAt = value?.sync?.lastSyncedAt ? String(value.sync.lastSyncedAt) : null;
    const lastAttemptAt = value?.sync?.lastAttemptAt ? String(value.sync.lastAttemptAt) : null;
    if (
        !['synced', 'failed', 'conflict', 'revalidation_required'].includes(syncState)
        || value?.sync?.source !== 'solana_rpc_finalized_account_graph'
        || (lastSyncedAt !== null && !Number.isFinite(Date.parse(lastSyncedAt)))
        || (lastAttemptAt !== null && !Number.isFinite(Date.parse(lastAttemptAt)))
    ) return null;
    const trustObservedSlot = Number(value?.trust?.deploymentObservedSlot);
    const trustObservationSlot = Number(value?.trust?.observationSlot);
    const trustObservedAt = value?.trust?.deploymentObservedAt
        ? String(value.trust.deploymentObservedAt)
        : null;
    const trustRpcIndexerCrossCheck = String(value?.trust?.rpcIndexerCrossCheck ?? '');
    const trust = value?.trust
        && typeof value.trust.genesisHash === 'string'
        && typeof value.trust.programId === 'string'
        && typeof value.trust.loaderProgramId === 'string'
        && value.trust.loaderProgramId
        && typeof value.trust.programDataAddress === 'string'
        && value.trust.programDataAddress
        && typeof value.trust.upgradeAuthority === 'string'
        && /^[a-f0-9]{64}$/.test(String(value.trust.deployedProgramBytesSha256 ?? ''))
        && typeof value.trust.decoderPackage === 'string'
        && typeof value.trust.decoderVersion === 'string'
        && /^[a-f0-9]{64}$/.test(String(value.trust.decoderArtifactSha256 ?? ''))
        && typeof value.trust.decoderConformance === 'string'
        && value.trust.readinessState === 'ready'
        && ['stable', 'experimental'].includes(String(value.trust.riskMaturity ?? ''))
        && value.trust.commitment === 'finalized'
        && value.trust.rpcAccess === 'public_no_credentials'
        && Number.isSafeInteger(trustObservedSlot)
        && trustObservedSlot > 0
        && trustObservedAt
        && Number.isFinite(Date.parse(trustObservedAt))
        && Number.isSafeInteger(trustObservationSlot)
        && trustObservationSlot > 0
        && typeof value.trust.observationBlockhash === 'string'
        && value.trust.observationBlockhash
        && [
            'rpc_finalized_and_indexer_program_checkpoint_converged',
            'rpc_finalized_indexer_program_checkpoint_behind',
            'rpc_finalized_indexer_program_checkpoint_failed',
            'rpc_finalized_only_indexer_not_configured',
            'rpc_finalized_indexer_observation_unavailable',
        ].includes(trustRpcIndexerCrossCheck)
        ? {
            readinessState: 'ready' as const,
            riskMaturity: value.trust.riskMaturity as 'stable' | 'experimental',
            genesisHash: value.trust.genesisHash,
            programId: value.trust.programId,
            loaderProgramId: value.trust.loaderProgramId,
            programDataAddress: value.trust.programDataAddress,
            upgradeAuthority: value.trust.upgradeAuthority,
            deployedProgramBytesSha256: value.trust.deployedProgramBytesSha256,
            decoderPackage: value.trust.decoderPackage,
            decoderVersion: value.trust.decoderVersion,
            decoderArtifactSha256: value.trust.decoderArtifactSha256,
            decoderConformance: value.trust.decoderConformance,
            commitment: 'finalized' as const,
            rpcAccess: 'public_no_credentials' as const,
            deploymentObservedSlot: trustObservedSlot,
            deploymentObservedAt: trustObservedAt,
            observationSlot: trustObservationSlot,
            observationBlockhash: value.trust.observationBlockhash,
            rpcIndexerCrossCheck: trustRpcIndexerCrossCheck as NonNullable<NonNullable<GovernanceCaseInboxTask['providerHealth']>['trust']>['rpcIndexerCrossCheck'],
        }
        : null;
    const authorities = normalizeGovernanceProviderExecutionAuthorities(value?.authorities);
    const rawResourceLifecycle = value?.providerResourceLifecycle;
    const resourceLifecyclePhases = Array.isArray(rawResourceLifecycle?.phases)
        ? rawResourceLifecycle.phases
        : [];
    const expectedResourceLifecyclePhases: GovernanceProviderResourceLifecycleReadback['phases'][number]['phase'][] = [
        'created',
        'bootstrap_verified',
        'authority_transferred',
        'old_authority_revoked',
        'readback_verified',
        'available',
    ];
    const providerResourceLifecycle = rawResourceLifecycle == null
        ? null
        : rawResourceLifecycle?.state === 'available'
            && typeof rawResourceLifecycle?.resourceBindingId === 'string'
            && rawResourceLifecycle.resourceBindingId.trim()
            && typeof rawResourceLifecycle?.sourceRequestId === 'string'
            && rawResourceLifecycle.sourceRequestId.trim()
            && isSha256Digest(String(rawResourceLifecycle?.sourceDecisionDigest ?? ''))
            && resourceLifecyclePhases.length === expectedResourceLifecyclePhases.length
            && resourceLifecyclePhases.every((phase: any, index: number) => (
                phase?.phase === expectedResourceLifecyclePhases[index]
                && typeof phase?.authority === 'string'
                && phase.authority.trim()
                && typeof phase?.evidenceRef === 'string'
                && phase.evidenceRef.trim()
            ))
            && rawResourceLifecycle?.permissionResidue?.fallbackAuthority === 'none'
            && rawResourceLifecycle?.permissionResidue?.temporaryWalletAuthority
              === 'revoked_or_not_retained'
            && rawResourceLifecycle?.permissionResidue?.serviceKeyAuthority === 'not_retained'
            && rawResourceLifecycle?.permissionResidue?.signerKeyExposure
              === 'none_public_authority_only'
            ? {
                state: 'available' as const,
                resourceBindingId: String(rawResourceLifecycle.resourceBindingId),
                sourceRequestId: String(rawResourceLifecycle.sourceRequestId),
                sourceDecisionDigest: String(rawResourceLifecycle.sourceDecisionDigest),
                phases: resourceLifecyclePhases.map((phase: any, index: number) => ({
                    phase: expectedResourceLifecyclePhases[index],
                    authority: phase.authority,
                    evidenceRef: phase.evidenceRef,
                })),
                permissionResidue: {
                    fallbackAuthority: 'none' as const,
                    temporaryWalletAuthority: 'revoked_or_not_retained' as const,
                    serviceKeyAuthority: 'not_retained' as const,
                    signerKeyExposure: 'none_public_authority_only' as const,
                },
            }
            : null;
    if (rawResourceLifecycle != null && providerResourceLifecycle === null) return null;
    const reconciliationFallback = normalizeGovernanceProviderReconciliationFallback(
        value?.reconciliationFallback,
    );
    if (
        value?.reconciliationFallback !== null
        && reconciliationFallback === null
    ) return null;
    if (
        (incident !== null || revalidation !== null)
        && reconciliationFallback === null
    ) return null;
    const authorityPaymentBoundary = normalizeGovernanceProviderAuthorityPaymentBoundary(
        value?.authorityPaymentBoundary,
    );
    if (value?.authorityPaymentBoundary !== null && authorityPaymentBoundary === null) return null;
    const mandateCostPolicy = normalizeGovernanceProviderMandateCostPolicy(
        value?.mandateCostPolicy,
    );
    if (value?.mandateCostPolicy !== null && mandateCostPolicy === null) return null;
    const fundingSourceFeePayerBoundary = normalizeGovernanceProviderFundingSourceFeePayerBoundary(
        value?.fundingSourceFeePayerBoundary,
    );
    if (
        value?.fundingSourceFeePayerBoundary !== null
        && fundingSourceFeePayerBoundary === null
    ) return null;
    const enforcement = normalizeGovernanceProviderEnforcementDisclosure(value?.enforcement);
    if (value?.enforcement !== null && enforcement === null) return null;
    const rawHealthCost = value?.costReconciliation;
    const healthCostTransactions = Array.isArray(rawHealthCost?.transactions)
        ? rawHealthCost.transactions.flatMap((transaction: any) => {
            const quotedFeeLamports = Number(transaction?.quotedFeeLamports);
            const directRentLamports = transaction?.directRentLamports === null
                ? null
                : Number(transaction?.directRentLamports);
            const actualSpendLamports = Number(transaction?.actualSpendLamports);
            if (
                !String(transaction?.stepId ?? '').trim()
                || !Number.isSafeInteger(quotedFeeLamports)
                || quotedFeeLamports < 0
                || (directRentLamports !== null
                    && (!Number.isSafeInteger(directRentLamports) || directRentLamports < 0))
                || !Number.isSafeInteger(actualSpendLamports)
                || actualSpendLamports < quotedFeeLamports + (directRentLamports ?? 0)
            ) return [];
            return [{
                stepId: String(transaction.stepId),
                quotedFeeLamports,
                directRentLamports,
                actualSpendLamports,
            }];
        })
        : [];
    const healthTotalSpend = Number(rawHealthCost?.totalSpendLamports);
    const healthTotalDirectRent = rawHealthCost?.totalDirectRentLamports === null
        ? null
        : Number(rawHealthCost?.totalDirectRentLamports);
    const healthFinalBalance = Number(rawHealthCost?.finalBalanceLamports);
    const healthRent = rawHealthCost?.rent === 'not_applicable_delegation_no_account_creation'
        || rawHealthCost?.rent === 'provider_receipt_direct_rent_itemized'
        || rawHealthCost?.rent === 'included_in_actual_spend_not_itemized'
        ? rawHealthCost.rent
        : null;
    const healthRefund = rawHealthCost?.refund === 'not_applicable_no_refund'
        || rawHealthCost?.refund === 'unknown_no_provider_refund_disposition'
        ? rawHealthCost.refund
        : null;
    const healthSponsorRole = rawHealthCost?.sponsorRole
        === 'explicit_relayer_from_payer_policy'
        || rawHealthCost?.sponsorRole === 'not_configured'
        ? rawHealthCost.sponsorRole
        : null;
    const costReconciliation = rawHealthCost === null
        ? null
        : String(rawHealthCost?.payerPolicyId ?? '').trim()
            && rawHealthCost?.payerRole === 'separated_fee_payer_policy'
            && String(rawHealthCost?.economicBearer ?? '').trim()
            && healthSponsorRole
            && rawHealthCost?.unit === 'lamports'
            && healthCostTransactions.length === rawHealthCost?.transactions?.length
            && healthCostTransactions.length > 0
            && (healthRent === 'included_in_actual_spend_not_itemized'
                ? healthTotalDirectRent === null
                    && healthCostTransactions.every((item: {
                        directRentLamports: number | null;
                    }) => item.directRentLamports === null)
                : Number.isSafeInteger(healthTotalDirectRent)
                    && healthCostTransactions.every((item: {
                        directRentLamports: number | null;
                    }) => item.directRentLamports !== null)
                    && healthTotalDirectRent === healthCostTransactions.reduce((sum: number, item: {
                        directRentLamports: number | null;
                    }) => (
                        sum + (item.directRentLamports ?? 0)
                    ), 0))
            && Number.isSafeInteger(healthTotalSpend)
            && healthTotalSpend === healthCostTransactions.reduce((sum: number, item: {
                actualSpendLamports: number;
            }) => (
                sum + item.actualSpendLamports
            ), 0)
            && Number.isSafeInteger(healthFinalBalance)
            && healthFinalBalance >= 0
            && (rawHealthCost?.fundingSource === 'solana_devnet_faucet'
                || rawHealthCost?.fundingSource === 'existing_finalized_balance')
            && (rawHealthCost?.fundingSource !== 'solana_devnet_faucet'
                || String(rawHealthCost?.fundingSignature ?? '').trim())
            && (rawHealthCost?.fundingSource !== 'existing_finalized_balance'
                || rawHealthCost?.fundingSignature === null)
            && rawHealthCost?.reconciliation === 'transaction_sum_matches_provider_receipt'
            && healthRent !== null
            && healthRefund !== null
            ? {
                payerPolicyId: String(rawHealthCost.payerPolicyId),
                payerRole: 'separated_fee_payer_policy' as const,
                economicBearer: String(rawHealthCost.economicBearer),
                sponsorRole: healthSponsorRole,
                unit: 'lamports' as const,
                transactions: healthCostTransactions,
                totalDirectRentLamports: healthTotalDirectRent,
                totalSpendLamports: healthTotalSpend,
                finalBalanceLamports: healthFinalBalance,
                fundingSource: rawHealthCost.fundingSource as 'solana_devnet_faucet'
                    | 'existing_finalized_balance',
                fundingSignature: rawHealthCost.fundingSignature === null
                    ? null
                    : String(rawHealthCost.fundingSignature),
                reconciliation: 'transaction_sum_matches_provider_receipt' as const,
                rent: healthRent,
                refund: healthRefund,
            }
            : null;
    if (rawHealthCost !== null && costReconciliation === null) return null;
    const rawTransactionAttempts = value?.transactionAttempts;
    const transactionAttempts = rawTransactionAttempts === null
        ? null
        : Array.isArray(rawTransactionAttempts)
            && rawTransactionAttempts.length > 0
            && rawTransactionAttempts.every((attempt: any) => (
                String(attempt?.stepId ?? '').trim()
                && isSha256Digest(String(attempt?.transactionAttemptDigest ?? ''))
                && Number.isSafeInteger(attempt?.attemptOrdinal)
                && attempt.attemptOrdinal > 0
                && attempt?.persistenceAuthority === 'canonical_provider_checkpoint_and_payer_policy'
                && String(attempt?.recentBlockhash ?? '').trim()
                && Number.isSafeInteger(attempt?.quotedFeeLamports)
                && attempt.quotedFeeLamports >= 0
                && attempt?.feePayerRole === 'separated_fee_payer_policy'
                && String(attempt?.feePayerPolicyId ?? '').trim()
                && attempt?.feePayerBinding === 'canonical_payer_policy_and_solana_message_header'
                && String(attempt?.providerReference ?? '').trim()
                && isSha256Digest(String(attempt?.messageDigest ?? ''))
                && isSha256Digest(String(attempt?.manifestDigest ?? ''))
                && attempt?.digestCoverage === 'message_digest_covers_fee_payer_and_compute_budget_instructions'
                && Number.isSafeInteger(attempt?.quoteSlot)
                && attempt.quoteSlot > 0
                && Number.isFinite(Date.parse(String(attempt?.quotedAt ?? '')))
                && attempt?.quoteSlotState === 'verified_finalized_provider_quote'
                && attempt?.resimulationTrigger === 'blockhash_or_quote_expiry_before_any_resign'
                && attempt?.priorityFeeLamports === 0
                && attempt?.priorityFeeState === 'verified_zero_current_pinned_provider_constructor'
            ))
            ? rawTransactionAttempts.map((attempt: any) => ({
                stepId: String(attempt.stepId),
                transactionAttemptDigest: String(attempt.transactionAttemptDigest),
                attemptOrdinal: Number(attempt.attemptOrdinal),
                persistenceAuthority: 'canonical_provider_checkpoint_and_payer_policy' as const,
                recentBlockhash: String(attempt.recentBlockhash),
                quotedFeeLamports: Number(attempt.quotedFeeLamports),
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
            }))
            : null;
    if (rawTransactionAttempts !== null && transactionAttempts === null) return null;
    const rawProposalTransactionReadback = value?.proposalTransactionReadback;
    const rawProposalInstructions = Array.isArray(rawProposalTransactionReadback?.instructions)
        ? rawProposalTransactionReadback.instructions
        : [];
    const proposalTransactionReadback = rawProposalTransactionReadback == null
        ? null
        : rawProposalTransactionReadback?.authority
            === 'provider_receipt_and_independent_finalized_readback'
            && String(rawProposalTransactionReadback?.proposalRef ?? '').trim()
            && String(rawProposalTransactionReadback?.proposalTransactionRef ?? '').trim()
            && rawProposalTransactionReadback?.commitment === 'finalized'
            && rawProposalTransactionReadback?.executionStatus === 'executed'
            && rawProposalInstructions.length > 0
            && rawProposalInstructions.every((instruction: any) => (
                String(instruction?.stepId ?? '').trim()
                && isSha256Digest(String(instruction?.manifestDigest ?? ''))
                && String(instruction?.summary ?? '').trim()
                && Array.isArray(instruction?.programScope)
                && instruction.programScope.length > 0
                && instruction.programScope.every((program: unknown) => String(program ?? '').trim())
                && String(instruction?.signature ?? '').trim()
                && Number.isSafeInteger(instruction?.slot)
                && instruction.slot > 0
                && instruction?.commitment === 'finalized'
                && instruction?.executionStatus === 'finalized'
                && instruction?.opaqueInstruction === false
            ))
            ? {
                authority: 'provider_receipt_and_independent_finalized_readback' as const,
                proposalRef: String(rawProposalTransactionReadback.proposalRef),
                proposalTransactionRef: String(
                    rawProposalTransactionReadback.proposalTransactionRef,
                ),
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
    if (rawProposalTransactionReadback != null && proposalTransactionReadback === null) return null;
    const rawAttemptOwner = value?.attemptOwner;
    const attemptOwner = rawAttemptOwner == null
        ? null
        : String(rawAttemptOwner?.preflightId ?? '').trim()
            && String(rawAttemptOwner?.payerPolicyId ?? '').trim()
            && isSha256Digest(String(rawAttemptOwner?.actionIntentDigest ?? ''))
            && isSha256Digest(String(rawAttemptOwner?.transactionAttemptDigest ?? ''))
            && rawAttemptOwner?.status === 'consumed'
            && String(rawAttemptOwner?.requestId ?? '').trim()
            && isSha256Digest(String(rawAttemptOwner?.decisionDigest ?? ''))
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
    if (rawAttemptOwner != null && attemptOwner === null) return null;
    const rawRetryBoundary = value?.retryBoundary;
    const retryBoundary = rawRetryBoundary == null
        ? null
        : isSha256Digest(String(rawRetryBoundary?.actionIntentDigest ?? ''))
            && isSha256Digest(String(rawRetryBoundary?.terminalTransactionAttemptDigest ?? ''))
            && isSha256Digest(String(rawRetryBoundary?.actionSetDigest ?? ''))
            && JSON.stringify(rawRetryBoundary?.sameIntentRetry?.allowedChanges)
                === JSON.stringify(['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'])
            && rawRetryBoundary?.sameIntentRetry?.requiresSameActionIntentDigest === true
            && rawRetryBoundary?.sameIntentRetry?.requiresSameActionSetDigest === true
            && rawRetryBoundary?.sameIntentRetry?.authoritativeExpiryRequired === true
            && rawRetryBoundary?.materialChangesRequire === 'new_decision_stage_or_superseding_case'
            && Array.isArray(rawRetryBoundary?.materialChanges)
            && rawRetryBoundary.materialChanges.length > 0
            && rawRetryBoundary.materialChanges.every((change: unknown) => String(change ?? '').trim())
            && rawRetryBoundary?.automaticMaterialMutationAllowed === false
            ? {
                actionIntentDigest: String(rawRetryBoundary.actionIntentDigest),
                terminalTransactionAttemptDigest: String(
                    rawRetryBoundary.terminalTransactionAttemptDigest,
                ),
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
    if (rawRetryBoundary != null && retryBoundary === null) return null;
    const rawExecutionPlan = value?.executionPlanReadback;
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
    const executionPlanReadback = rawExecutionPlan == null
        ? null
        : rawExecutionPlan?.authority
            === 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt'
            && ['realms_provider_binding', 'squads_provider_binding'].includes(
                rawExecutionPlan?.providerModule,
            )
            && rawExecutionPlan?.providerModule === value?.provider
            && ['realms', 'squads'].includes(rawExecutionPlan?.executionMode)
            && String(rawExecutionPlan?.requestId ?? '').trim()
            && isSha256Digest(String(rawExecutionPlan?.decisionDigest ?? ''))
            && attemptOwner !== null
            && retryBoundary !== null
            && rawExecutionPlan?.actionIntentDigest === attemptOwner.actionIntentDigest
            && isSha256Digest(String(rawExecutionPlan?.planDigest ?? ''))
            && rawExecutionPlan?.terminalTransactionAttemptDigest
                === attemptOwner.transactionAttemptDigest
            && rawExecutionPlan?.actionSetDigest === retryBoundary.actionSetDigest
            && rawExecutionPlan?.aggregateStatus === 'executed'
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
                isSha256Digest(String(key ?? ''))
            ))
            && duplicateProviderReferences.length === rawExecutionActions.length
            && new Set(duplicateProviderReferences).size === rawExecutionActions.length
            && duplicateProviderReferences.every((reference: unknown) => (
                String(reference ?? '').trim()
            ))
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
            && rawExecutionActions.every((action: any, index: number) => {
                const previousIds = rawExecutionActions.slice(0, index).map(
                    (item: any) => item?.actionId,
                );
                const dependencies = Array.isArray(action?.dependsOnActionIds)
                    ? action.dependsOnActionIds
                    : [];
                const attempts = Array.isArray(action?.attempts) ? action.attempts : [];
                const attempt = attempts[0];
                return String(action?.actionId ?? '').trim()
                    && action?.order === index + 1
                    && action?.executor === rawExecutionPlan.executionMode
                    && action?.operation === action.actionId
                    && String(action?.instructionSemantics ?? '').trim()
                    && String(action?.humanSummary ?? '').trim()
                    && Array.isArray(action?.programScope)
                    && action.programScope.length > 0
                    && action.programScope.every((program: unknown) => String(program ?? '').trim())
                    && Array.isArray(action?.accountScope)
                    && action.accountScope.every((account: any) => (
                        String(account?.role ?? '').trim() && String(account?.ref ?? '').trim()
                    ))
                    && String(action?.assetChange ?? '').trim()
                    && dependencies.every((dependency: unknown) => previousIds.includes(dependency))
                    && action?.atomicity === 'single_provider_transaction'
                    && attempts.length === 1
                    && attempt?.status === 'finalized'
                    && duplicateActionIdempotencyKeys[index]
                        === action?.constraints?.idempotencyKey
                    && duplicateProviderReferences[index] === attempt?.providerReference
                    && String(attempt?.providerReference ?? '').trim()
                    && Number.isSafeInteger(attempt?.slot)
                    && attempt.slot > 0
                    && String(attempt?.recentBlockhash ?? '').trim()
                    && isSha256Digest(String(attempt?.messageDigest ?? ''))
                    && isSha256Digest(String(attempt?.manifestDigest ?? ''));
            })
            ? {
                authority: 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt' as const,
                providerModule: rawExecutionPlan.providerModule as
                    'realms_provider_binding' | 'squads_provider_binding',
                executionMode: rawExecutionPlan.executionMode as 'realms' | 'squads',
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
    if (rawExecutionPlan != null && executionPlanReadback === null) return null;
    const providerActionSafetyBoundary = normalizeGovernanceProviderActionSafetyBoundary(
        value?.providerActionSafetyBoundary,
        {
            module: value?.provider,
            chainId: value?.providerActionSafetyBoundary?.chainId,
            resourceRef: value?.resourceRef,
            ownerProgramRef: value?.providerActionSafetyBoundary?.ownerProgramRef,
        },
        executionPlanReadback as any,
        retryBoundary,
    );
    if (
        value?.providerActionSafetyBoundary != null
        && providerActionSafetyBoundary === null
    ) return null;
    const servicePayerAuthorityBoundary = normalizeGovernanceServicePayerAuthorityBoundary(
        value?.servicePayerAuthorityBoundary,
        authorityPaymentBoundary,
        fundingSourceFeePayerBoundary,
        costReconciliation,
        providerActionSafetyBoundary,
        retryBoundary,
    );
    if (
        value?.servicePayerAuthorityBoundary != null
        && servicePayerAuthorityBoundary === null
    ) return null;
    const providerCostControlBoundary = normalizeGovernanceProviderCostControlBoundary(
        value?.providerCostControlBoundary,
        costReconciliation,
        value?.resourceRef,
    );
    if (
        value?.providerCostControlBoundary != null
        && providerCostControlBoundary === null
    ) return null;
    const assetAuthoritySponsorBoundary = normalizeGovernanceAssetAuthoritySponsorBoundary(
        value?.assetAuthoritySponsorBoundary,
        servicePayerAuthorityBoundary,
        providerCostControlBoundary,
        providerActionSafetyBoundary,
    );
    if (
        value?.assetAuthoritySponsorBoundary != null
        && assetAuthoritySponsorBoundary === null
    ) return null;
    const rawHumanReadableActions = value?.humanReadableActions;
    const humanReadableAssetChanges = new Set([
        'governance_weight_supply_created_no_real_asset',
        'governance_weight_deposited_no_real_asset',
        'zero_lamport_self_transfer_no_real_asset',
        'none_no_real_assets',
    ]);
    const humanReadableActions = rawHumanReadableActions == null
        ? null
        : Array.isArray(rawHumanReadableActions)
            && rawHumanReadableActions.length > 0
            && rawHumanReadableActions.every((action: any) => (
                String(action?.operation ?? '').trim()
                && String(action?.summary ?? '').trim()
                && Array.isArray(action?.programScope)
                && action.programScope.length > 0
                && action.programScope.every((program: unknown) => String(program ?? '').trim())
                && Array.isArray(action?.accountScope)
                && action.accountScope.length > 0
                && action.accountScope.every((account: any) => (
                    String(account?.role ?? '').trim() && String(account?.ref ?? '').trim()
                ))
                && humanReadableAssetChanges.has(action?.assetChange)
                && ['required_passed_before_provider_signature', 'passed']
                    .includes(action?.simulation)
                && ['provider_onchain', 'multisig_threshold'].includes(action?.enforcement)
                && action?.opaqueInstructions === false
                && isSha256Digest(String(action?.manifestDigest ?? ''))
            ))
            ? rawHumanReadableActions.map((action: any) => ({
                operation: String(action.operation),
                summary: String(action.summary),
                programScope: action.programScope.map(String),
                accountScope: action.accountScope.map((account: any) => ({
                    role: String(account.role),
                    ref: String(account.ref),
                })),
                assetChange: action.assetChange as NonNullable<
                    NonNullable<GovernanceCaseInboxTask['providerHealth']>['humanReadableActions']
                >[number]['assetChange'],
                simulation: action.simulation as 'required_passed_before_provider_signature' | 'passed',
                enforcement: action.enforcement as 'provider_onchain' | 'multisig_threshold',
                opaqueInstructions: false as const,
                manifestDigest: String(action.manifestDigest),
            }))
            : null;
    if (rawHumanReadableActions != null && humanReadableActions === null) return null;
    const rawActionContexts = value?.actionContexts;
    const actionContexts = rawActionContexts == null
        ? null
        : Array.isArray(rawActionContexts)
            && rawActionContexts.length > 0
            && rawActionContexts.every((context: any, index: number) => (
                String(context?.stepId ?? '').trim()
                && context?.order === index + 1
                && JSON.stringify(context?.dependsOnStepIds) === JSON.stringify(
                    index === 0 ? [] : [String(rawActionContexts[index - 1]?.stepId ?? '')],
                )
                && isSha256Digest(String(context?.atomicGroupId ?? ''))
                && context?.atomicity === 'single_provider_transaction'
                && String(context?.expectedStateChange ?? '').trim()
                && isSha256Digest(String(context?.idempotencyKey ?? ''))
                && context?.deadline?.kind === 'last_valid_block_height'
                && Number.isSafeInteger(Number(context?.deadline?.value))
                && Number(context.deadline.value) > 0
                && context?.aggregateRule === 'all_ordered_steps_finalized'
            ))
            && new Set(rawActionContexts.map((context: any) => context.atomicGroupId)).size
                === rawActionContexts.length
            && new Set(rawActionContexts.map((context: any) => context.idempotencyKey)).size
                === rawActionContexts.length
            ? rawActionContexts.map((context: any) => ({
                stepId: String(context.stepId),
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
            }))
            : null;
    if (rawActionContexts != null && actionContexts === null) return null;
    const expiredAttemptHistory = value?.expiredAttempts === null
        ? null
        : normalizeGovernanceProviderExpiredAttemptHistory({
            schemaVersion: 1,
            authority: 'canonical_cost_preflight_checkpoint',
            attempts: value?.expiredAttempts,
        });
    if (value?.expiredAttempts !== null && expiredAttemptHistory === null) return null;
    const preSignStatePreconditions = value?.preSignStatePreconditions === null
        ? null
        : Array.isArray(value?.preSignStatePreconditions)
            && value.preSignStatePreconditions.length > 0
            && value.preSignStatePreconditions.length <= 2
            && new Set(value.preSignStatePreconditions.map((item: any) => item?.stepId)).size
              === value.preSignStatePreconditions.length
            && value.preSignStatePreconditions.every((item: any) => (
                ['set_governance_delegate', 'revoke_governance_delegate'].includes(item?.stepId)
                && isSha256Digest(String(item?.actionIntentDigest ?? ''))
                && isSha256Digest(String(item?.planDigest ?? ''))
                && isSha256Digest(String(item?.manifestDigest ?? ''))
                && isSha256Digest(String(item?.messageDigest ?? ''))
                && (item?.expectedDelegate === null || String(item?.expectedDelegate ?? '').trim())
                && Number.isSafeInteger(Number(item?.observedSlot))
                && Number(item.observedSlot) > 0
                && isSha256Digest(String(item?.providerStateDigest ?? ''))
                && Number.isSafeInteger(Number(item?.feePayerBalanceLamports))
                && Number(item.feePayerBalanceLamports) >= 0
                && String(item?.canonicalOwnerState?.resourceBindingId ?? '').trim()
                && String(item?.canonicalOwnerState?.authorityBindingId ?? '').trim()
                && String(item?.canonicalOwnerState?.payerPolicyId ?? '').trim()
                && ['not_configured_p05_gate', 'clear_fresh_p05_authority_health']
                    .includes(item?.canonicalOwnerState?.emergencyFreeze)
                && isSha256Digest(String(item?.canonicalOwnerState?.stateDigest ?? ''))
                && Array.isArray(item?.instructionSafety?.programIds)
                && item.instructionSafety.programIds.length === 1
                && String(item.instructionSafety.programIds[0] ?? '').trim()
                && item?.instructionSafety?.instructionCount === 1
                && item?.instructionSafety?.transactionSignerCount === 2
                && Array.isArray(item?.instructionSafety?.writableAccountRefs)
                && item.instructionSafety.writableAccountRefs.length === 1
                && String(item.instructionSafety.writableAccountRefs[0] ?? '').trim()
                && item?.instructionSafety?.accountPrivilegeCheck
                  === 'exact_spl_governance_set_delegate_accounts'
                && item?.instructionSafety?.assetOutflowLamports === 0
                && item?.instructionSafety?.opaqueInstructions === false
                && item?.instructionSafety?.simulation === 'passed'
                && isSha256Digest(String(item?.instructionSafety?.digest ?? ''))
                && isSha256Digest(String(item?.digest ?? ''))
            ))
            ? value.preSignStatePreconditions.map((item: any) => ({
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
    if (value?.preSignStatePreconditions !== null && preSignStatePreconditions === null) return null;
    const rpcSourceState = String(value?.sources?.rpc?.state ?? '');
    const rpcSourceObservedSlot = Number(value?.sources?.rpc?.observedSlot);
    const rpcSourceLastSyncedAt = value?.sources?.rpc?.lastSyncedAt
        ? String(value.sources.rpc.lastSyncedAt)
        : null;
    const rpcSourceLastAttemptAt = value?.sources?.rpc?.lastAttemptAt
        ? String(value.sources.rpc.lastAttemptAt)
        : null;
    const indexerSourceState = String(value?.sources?.indexer?.state ?? '');
    const indexerSourceProgramId = String(value?.sources?.indexer?.programId ?? '').trim();
    const indexerSourceIndexedSlot = value?.sources?.indexer?.indexedSlot === null
        ? null
        : Number(value?.sources?.indexer?.indexedSlot);
    const indexerSourceProviderObservedSlot = value?.sources?.indexer?.providerObservedSlot === null
        ? null
        : Number(value?.sources?.indexer?.providerObservedSlot);
    const indexerSourceLagSlots = value?.sources?.indexer?.lagSlots === null
        ? null
        : Number(value?.sources?.indexer?.lagSlots);
    const indexerSourceLastSyncedAt = value?.sources?.indexer?.lastSyncedAt
        ? String(value.sources.indexer.lastSyncedAt)
        : null;
    const indexerSourceLastProgressAt = value?.sources?.indexer?.lastProgressAt
        ? String(value.sources.indexer.lastProgressAt)
        : null;
    if (
        !['synced', 'failed', 'conflict', 'revalidation_required'].includes(rpcSourceState)
        || (value?.sources?.rpc?.observedSlot !== null
            && (!Number.isSafeInteger(rpcSourceObservedSlot) || rpcSourceObservedSlot <= 0))
        || (rpcSourceLastSyncedAt !== null && !Number.isFinite(Date.parse(rpcSourceLastSyncedAt)))
        || (rpcSourceLastAttemptAt !== null && !Number.isFinite(Date.parse(rpcSourceLastAttemptAt)))
        || !['synced', 'behind', 'failed', 'not_configured', 'unavailable'].includes(indexerSourceState)
        || !indexerSourceProgramId
        || (indexerSourceIndexedSlot !== null
            && (!Number.isSafeInteger(indexerSourceIndexedSlot) || indexerSourceIndexedSlot < 0))
        || (indexerSourceProviderObservedSlot !== null
            && (!Number.isSafeInteger(indexerSourceProviderObservedSlot) || indexerSourceProviderObservedSlot <= 0))
        || (indexerSourceLagSlots !== null
            && (!Number.isSafeInteger(indexerSourceLagSlots) || indexerSourceLagSlots < 0))
        || (indexerSourceLastSyncedAt !== null
            && !Number.isFinite(Date.parse(indexerSourceLastSyncedAt)))
        || (indexerSourceLastProgressAt !== null
            && !Number.isFinite(Date.parse(indexerSourceLastProgressAt)))
        || value?.sources?.webhook?.state !== 'not_applicable'
        || value?.sources?.webhook?.reason !== 'provider_uses_rpc_account_graph_readback'
    ) return null;
    return {
        status: status as NonNullable<GovernanceCaseInboxTask['providerHealth']>['status'],
        readiness: {
            readinessState: readinessState as NonNullable<GovernanceCaseInboxTask['providerHealth']>['readiness']['readinessState'],
            riskMaturity: riskMaturity as NonNullable<GovernanceCaseInboxTask['providerHealth']>['readiness']['riskMaturity'],
            stageOpenAllowed: value.readiness.stageOpenAllowed,
            executionOpenAllowed: value.readiness.executionOpenAllowed,
            riskConfirmationRequired: value.readiness.riskConfirmationRequired,
            authority: 'provider_trust_profile_resource_reconciliation_readback',
            blockers: readinessBlockers,
        },
        provider,
        profileRef: value?.profileRef ? String(value.profileRef) : null,
        profileVersion: value?.profileVersion ? String(value.profileVersion) : null,
        profileDigest: /^[a-f0-9]{64}$/.test(String(value?.profileDigest ?? ''))
            ? String(value.profileDigest)
            : null,
        decoderConformance: value?.decoderConformance
            ? String(value.decoderConformance)
            : null,
        resourceRef: value?.resourceRef ? String(value.resourceRef) : null,
        observedSlot: Number.isSafeInteger(observedSlot) && observedSlot > 0 ? observedSlot : null,
        observedAt: observedAt && Number.isFinite(Date.parse(observedAt)) ? observedAt : null,
        blocker: value?.blocker ? String(value.blocker) : null,
        incident,
        revalidation,
        sync: {
            state: syncState as NonNullable<GovernanceCaseInboxTask['providerHealth']>['sync']['state'],
            source: 'solana_rpc_finalized_account_graph',
            lastSyncedAt,
            lastAttemptAt,
            failure: value?.sync?.failure ? String(value.sync.failure) : null,
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
        expiredAttempts: expiredAttemptHistory?.attempts ?? null,
        preSignStatePreconditions,
        sources: {
            rpc: {
                state: rpcSourceState as NonNullable<GovernanceCaseInboxTask['providerHealth']>['sources']['rpc']['state'],
                observedSlot: value.sources.rpc.observedSlot === null ? null : rpcSourceObservedSlot,
                lastSyncedAt: rpcSourceLastSyncedAt,
                lastAttemptAt: rpcSourceLastAttemptAt,
                failure: value?.sources?.rpc?.failure ? String(value.sources.rpc.failure) : null,
            },
            indexer: {
                state: indexerSourceState as NonNullable<GovernanceCaseInboxTask['providerHealth']>['sources']['indexer']['state'],
                programId: indexerSourceProgramId,
                indexedSlot: indexerSourceIndexedSlot,
                providerObservedSlot: indexerSourceProviderObservedSlot,
                lagSlots: indexerSourceLagSlots,
                lastSyncedAt: indexerSourceLastSyncedAt,
                lastProgressAt: indexerSourceLastProgressAt,
                failure: value?.sources?.indexer?.failure
                    ? String(value.sources.indexer.failure)
                    : null,
            },
            webhook: {
                state: 'not_applicable',
                reason: 'provider_uses_rpc_account_graph_readback',
            },
        },
    };
}

function normalizeGovernanceOperationInboxItem(value: any): GovernanceOperationInboxItem {
    const roles = new Set<GovernanceOperationInboxItem['authority']['role']>([
        'governance_home_manager', 'delegated_authority_participant',
    ]);
    const kinds = new Set<GovernanceOperationInboxItem['task']['kind']>([
        'ratification', 'appeal', 'escalation', 'reconciliation',
    ]);
    const statuses = new Set<GovernanceOperationInboxItem['task']['status']>([
        'available', 'waiting', 'blocked', 'completed',
    ]);
    const identityRoles = new Set<GovernanceOperationInboxItem['identities'][number]['role']>([
        'operational_assignee', 'respondent_appellant', 'appeal_reviewer',
    ]);
    const groups = new Set<GovernanceOperationInboxItem['group']>([
        'awaiting_action', 'active', 'expiring', 'appealed', 'closed',
    ]);
    const appealStatuses = new Set<GovernanceOperationInboxItem['appeal']['status']>([
        'available', 'opened', 'resolved', 'expired', 'unavailable',
    ]);
    const risks = new Set<GovernanceOperationInboxItem['risk']>([
        'low', 'medium', 'high', 'critical',
    ]);
    const item: GovernanceOperationInboxItem = {
        id: String(value?.id || '').trim(),
        circleId: Number(value?.circleId),
        actionType: String(value?.actionType || '').trim(),
        occurredAt: String(value?.occurredAt || '').trim(),
        subject: {
            type: String(value?.subject?.type || '').trim(),
            ref: String(value?.subject?.ref || '').trim(),
        },
        risk: value?.risk,
        provider: {
            type: value?.provider?.type,
            ref: String(value?.provider?.ref || '').trim(),
            authoritativeFinality: value?.provider?.authoritativeFinality,
        },
        invocation: {
            id: String(value?.invocation?.id || '').trim(),
            state: String(value?.invocation?.state || '').trim(),
        },
        effect: {
            id: String(value?.effect?.id || '').trim(),
            state: String(value?.effect?.state || '').trim(),
            stateVersion: Number(value?.effect?.stateVersion),
        },
        group: value?.group,
        lifecycle: {
            expiresAt: value?.lifecycle?.expiresAt == null
                ? null
                : String(value.lifecycle.expiresAt),
        },
        identities: Array.isArray(value?.identities)
            ? value.identities.map((identity: any) => ({
                role: identity?.role,
                status: identity?.status,
                deadline: identity?.deadline == null ? null : String(identity.deadline),
                disabledReason: identity?.disabledReason == null
                    ? null
                    : String(identity.disabledReason),
                canonicalUrl: String(identity?.canonicalUrl || '').trim(),
            }))
            : [],
        authority: {
            role: value?.authority?.role == null ? null : value.authority.role,
            identities: normalizeGovernanceInboxInstitutionalIdentities(
                value?.authority?.identities,
            ),
            sourceType: String(value?.authority?.sourceType || '').trim(),
            sourceRef: String(value?.authority?.sourceRef || '').trim(),
            sourceVersion: value?.authority?.sourceVersion == null
                ? null
                : String(value.authority.sourceVersion),
            domainBindingId: value?.authority?.domainBindingId == null
                ? null
                : String(value.authority.domainBindingId).trim(),
            mandateId: value?.authority?.mandateId == null
                ? null
                : String(value.authority.mandateId),
            committeeCircleId: value?.authority?.committeeCircleId == null
                ? null
                : Number(value.authority.committeeCircleId),
        },
        task: {
            kind: value?.task?.kind,
            status: value?.task?.status,
            deadline: value?.task?.deadline == null ? null : String(value.task.deadline),
            disabledReason: value?.task?.disabledReason == null
                ? null
                : String(value.task.disabledReason),
            canonicalUrl: String(value?.task?.canonicalUrl || '').trim(),
        },
        appeal: {
            status: value?.appeal?.status,
            windowEndsAt: value?.appeal?.windowEndsAt == null
                ? null
                : String(value.appeal.windowEndsAt),
            currentActorAppealId: value?.appeal?.currentActorAppealId == null
                ? null
                : String(value.appeal.currentActorAppealId),
        },
    };
    if (!item.id
        || !Number.isInteger(item.circleId)
        || item.circleId <= 0
        || !item.actionType
        || Number.isNaN(new Date(item.occurredAt).getTime())
        || !item.subject.type
        || !item.subject.ref
        || !risks.has(item.risk)
        || item.provider.type !== 'execution_adapter'
        || !item.provider.ref
        || item.provider.authoritativeFinality !== 'not_asserted'
        || !item.invocation.id
        || !item.invocation.state
        || !item.effect.id
        || !item.effect.state
        || !Number.isInteger(item.effect.stateVersion)
        || !groups.has(item.group)
        || (item.lifecycle.expiresAt != null
            && Number.isNaN(new Date(item.lifecycle.expiresAt).getTime()))
        || item.identities.some((identity) => (
            !identityRoles.has(identity.role)
            || !statuses.has(identity.status)
            || !identity.canonicalUrl.startsWith('/')
            || (identity.deadline != null
                && Number.isNaN(new Date(identity.deadline).getTime()))
        ))
        || (item.authority.role != null && !roles.has(item.authority.role))
        || (item.authority.role == null && item.authority.identities.length > 0)
        || (item.authority.role != null && (
            item.authority.identities.length === 0
            || !item.authority.identities.some((identity) => identity.role === item.authority.role)
        ))
        || !item.authority.sourceType
        || !item.authority.sourceRef
        || !kinds.has(item.task.kind)
        || !statuses.has(item.task.status)
        || !item.task.canonicalUrl.startsWith('/')
        || !appealStatuses.has(item.appeal.status)) {
        throw new Error('invalid_governance_operation_inbox_contract');
    }
    return item;
}

function normalizeGovernanceOperationalInboxQueue(
    value: any,
): GovernanceOperationalInboxQueue {
    const total = Number(value?.total);
    const matched = Number(value?.matched);
    if (!Number.isSafeInteger(total)
        || total < 0
        || !Number.isSafeInteger(matched)
        || matched < 0
        || matched > total
        || !value?.appliedFilters
        || typeof value.appliedFilters !== 'object'
        || Array.isArray(value.appliedFilters)
        || !value?.facets
        || typeof value.facets !== 'object'
        || Array.isArray(value.facets)
        || Object.keys(value.appliedFilters).some((key) => (
            !GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS.includes(
                key as GovernanceOperationalInboxFilterKey,
            )
        ))) {
        throw new Error('invalid_governance_operational_inbox_queue_contract');
    }
    const appliedFilters: GovernanceOperationalInboxFilters = {};
    const facets = {} as GovernanceOperationalInboxQueue['facets'];
    for (const key of GOVERNANCE_OPERATIONAL_INBOX_FILTER_KEYS) {
        const applied = value.appliedFilters[key];
        if (applied != null) {
            if (typeof applied !== 'string' || !applied.trim() || applied.length > 256) {
                throw new Error('invalid_governance_operational_inbox_queue_contract');
            }
            appliedFilters[key] = applied;
        }
        if (!Array.isArray(value.facets[key])) {
            throw new Error('invalid_governance_operational_inbox_queue_contract');
        }
        facets[key] = value.facets[key].map((facet: any) => {
            const facetValue = String(facet?.value || '').trim();
            const count = Number(facet?.count);
            if (!facetValue || !Number.isSafeInteger(count) || count <= 0) {
                throw new Error('invalid_governance_operational_inbox_queue_contract');
            }
            return { value: facetValue, count };
        });
    }
    return { appliedFilters, facets, total, matched };
}

function normalizeGovernanceCaseSearchResponse(
    value: any,
    caseId: string,
): GovernanceCaseSearchResponse {
    const query = String(value?.query || '').normalize('NFKC').trim();
    const total = Number(value?.total);
    if (
        query.length < 2
        || query.length > 256
        || !Number.isSafeInteger(total)
        || total < 0
        || !Array.isArray(value?.scopeCounts)
        || !Array.isArray(value?.results)
    ) {
        throw new Error('invalid_governance_case_search_contract');
    }
    const scopeCounts = GOVERNANCE_CASE_SEARCH_SCOPES.map((scope) => {
        const item = value.scopeCounts.find((candidate: any) => candidate?.scope === scope);
        const count = Number(item?.count);
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error('invalid_governance_case_search_contract');
        }
        return { scope, count };
    });
    const expectedUrl = `/governance/cases/${encodeURIComponent(caseId)}#`;
    const results = value.results.map((item: any): GovernanceCaseSearchResult => {
        const result = {
            id: String(item?.id || '').trim(),
            scope: item?.scope as GovernanceCaseSearchScope,
            title: String(item?.title || '').trim(),
            excerpt: String(item?.excerpt || '').trim(),
            canonicalUrl: String(item?.canonicalUrl || '').trim(),
        };
        if (
            !result.id
            || !GOVERNANCE_CASE_SEARCH_SCOPES.includes(result.scope)
            || !result.title
            || !result.canonicalUrl.startsWith(expectedUrl)
        ) {
            throw new Error('invalid_governance_case_search_contract');
        }
        return result;
    });
    if (total < results.length || scopeCounts.reduce((sum, item) => sum + item.count, 0) !== total) {
        throw new Error('invalid_governance_case_search_contract');
    }
    return { query, total, scopeCounts, results };
}

function normalizeCircleGovernanceSearchResponse(value: any): CircleGovernanceSearchResponse {
    const total = Number(value?.total);
    const matched = Number(value?.matched);
    const query = value?.query == null ? null : String(value.query).normalize('NFKC').trim();
    if (
        (query !== null && (query.length < 2 || query.length > 256))
        || !Number.isSafeInteger(total)
        || total < 0
        || !Number.isSafeInteger(matched)
        || matched < 0
        || matched > total
        || value?.providerFinality !== 'not_asserted'
        || !value?.appliedFilters
        || typeof value.appliedFilters !== 'object'
        || Array.isArray(value.appliedFilters)
        || !value?.facets
        || typeof value.facets !== 'object'
        || Array.isArray(value.facets)
        || Object.keys(value.appliedFilters).some((key) => (
            !CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS.includes(
                key as CircleGovernanceSearchFilterKey,
            )
        ))
    ) {
        throw new Error('invalid_circle_governance_search_contract');
    }
    const appliedFilters: CircleGovernanceSearchFilters = {};
    const facets = {} as CircleGovernanceSearchResponse['facets'];
    for (const key of CIRCLE_GOVERNANCE_SEARCH_FILTER_KEYS) {
        const applied = value.appliedFilters[key];
        if (applied != null) {
            if (typeof applied !== 'string' || !applied.trim() || applied.length > 256) {
                throw new Error('invalid_circle_governance_search_contract');
            }
            appliedFilters[key] = applied;
        }
        if (!Array.isArray(value.facets[key])) {
            throw new Error('invalid_circle_governance_search_contract');
        }
        facets[key] = value.facets[key].map((facet: any) => {
            const facetValue = String(facet?.value || '').trim();
            const count = Number(facet?.count);
            if (!facetValue || !Number.isSafeInteger(count) || count <= 0) {
                throw new Error('invalid_circle_governance_search_contract');
            }
            return { value: facetValue, count };
        });
    }
    return {
        query,
        appliedFilters,
        facets,
        total,
        matched,
        providerFinality: 'not_asserted',
    };
}

function normalizeGovernanceInboxInstitutionalIdentities(
    value: unknown,
): GovernanceInboxInstitutionalIdentity[] {
    const roles = new Set<GovernanceInboxInstitutionalIdentity['role']>([
        'governance_home_manager', 'delegated_authority_participant',
    ]);
    if (!Array.isArray(value)) throw new Error('invalid_governance_inbox_identities_contract');
    const identities = value.map((item: any): GovernanceInboxInstitutionalIdentity => ({
        role: item?.role,
        targetCircleId: Number(item?.targetCircleId),
        committeeCircleId: item?.committeeCircleId == null
            ? null
            : Number(item.committeeCircleId),
        domainBindingId: item?.domainBindingId == null
            ? null
            : String(item.domainBindingId),
        mandateId: item?.mandateId == null ? null : String(item.mandateId),
    }));
    if (identities.some((identity) => (
        !roles.has(identity.role)
        || !Number.isInteger(identity.targetCircleId)
        || identity.targetCircleId <= 0
        || (identity.committeeCircleId != null
            && (!Number.isInteger(identity.committeeCircleId) || identity.committeeCircleId <= 0))
    ))) throw new Error('invalid_governance_inbox_identities_contract');
    return identities;
}

function normalizeGovernanceInstitutionalDuty(value: any): GovernanceInstitutionalDuty {
    const kinds = new Set<GovernanceInstitutionalDuty['kind']>([
        'governance_home_settings', 'governance_mandate', 'system_governance_role',
    ]);
    const participantRoles = new Set<GovernanceInstitutionalDutyRole>([
        'governance_home_manager', 'delegated_authority_participant', 'system_authority_participant',
    ]);
    const actions = new Set<GovernanceInstitutionalDuty['task']['primaryAction']>([
        'open_institutional_settings', 'view_mandate', 'view_system_duty',
    ]);
    const statuses = new Set<GovernanceInstitutionalDuty['task']['status']>([
        'available', 'completed', 'blocked',
    ]);
    const roles = new Set<GovernanceSystemDutyRole>([
        'external_app_review_primary',
        'external_app_risk_emergency',
        'external_app_appeal',
        'external_app_parameter_governance',
    ]);
    const environments = new Set<'sandbox' | 'production'>(['sandbox', 'production']);
    const id = String(value?.id || '').trim();
    const circleId = Number(value?.circleId);
    const canonicalUrl = String(value?.task?.canonicalUrl || '').trim();
    if (
        !id
        || !kinds.has(value?.kind)
        || !participantRoles.has(value?.role)
        || !Number.isInteger(circleId)
        || circleId <= 0
        || !actions.has(value?.task?.primaryAction)
        || !statuses.has(value?.task?.status)
        || !canonicalUrl.startsWith('/')
    ) throw new Error('invalid_governance_institutional_duty_contract');
    const mandate = value?.mandate ? {
        id: String(value.mandate.id || ''),
        bindingId: String(value.mandate.bindingId || ''),
        direction: value.mandate.direction as 'received',
        targetCircleId: Number(value.mandate.targetCircleId),
        committeeCircleId: Number(value.mandate.committeeCircleId),
        health: normalizeGovernanceMandateHealth(value.mandate.health),
    } : null;
    if (mandate && (
        !mandate.id
        || !mandate.bindingId
        || mandate.direction !== 'received'
        || !Number.isInteger(mandate.targetCircleId)
        || !Number.isInteger(mandate.committeeCircleId)
    )) throw new Error('invalid_governance_institutional_mandate_duty_contract');
    const system = value?.systemRole;
    const roleKey = system?.roleKey as GovernanceSystemDutyRole;
    const environment = system?.environment as 'sandbox' | 'production';
    const policyId = String(system?.policy?.id || '').trim();
    const policyVersionId = String(system?.policy?.versionId || '').trim();
    const policyVersion = Number(system?.policy?.version);
    const activatedAt = String(system?.activatedAt || '').trim();
    if (system && (
        system.domain !== 'external_app'
        || !String(system.bindingId || '').trim()
        || !roles.has(roleKey)
        || !environments.has(environment)
        || !policyId
        || !policyVersionId
        || !Number.isInteger(policyVersion)
        || policyVersion <= 0
        || !activatedAt
        || Number.isNaN(new Date(activatedAt).getTime())
    )) throw new Error('invalid_governance_system_duty_contract');
    const requestId = system?.provenance?.requestId ? String(system.provenance.requestId) : null;
    const decisionDigest = system?.provenance?.decisionDigest ? String(system.provenance.decisionDigest) : null;
    const executionReceiptId = system?.provenance?.executionReceiptId
        ? String(system.provenance.executionReceiptId)
        : null;
    return {
        id,
        kind: value.kind,
        role: value.role,
        circleId,
        task: {
            primaryAction: value.task.primaryAction,
            status: value.task.status,
            deadline: value.task.deadline ? String(value.task.deadline) : null,
            disabledReason: value.task.disabledReason ? String(value.task.disabledReason) : null,
            canonicalUrl,
        },
        mandate,
        systemRole: system ? {
            bindingId: String(system.bindingId),
            domain: 'external_app',
            roleKey,
            environment,
            policy: {
                id: policyId,
                versionId: policyVersionId,
                version: policyVersion,
            },
            activatedAt: new Date(activatedAt).toISOString(),
            provenance: {
                requestId,
                decisionDigest,
                executionReceiptId,
                status: requestId && decisionDigest && executionReceiptId ? 'complete' : 'incomplete',
            },
        } : null,
    };
}

function normalizeGovernanceCaseActualOutcome(value: any): GovernanceCaseActualOutcomeRecord | null {
    if (!value || typeof value !== 'object') return null;
    const integrity = value.integrity === 'verified' ? 'verified' : 'invalid';
    const observationPeriod = value.observationPeriod && typeof value.observationPeriod === 'object'
        ? {
            startedAt: String(value.observationPeriod.startedAt || ''),
            endedAt: String(value.observationPeriod.endedAt || ''),
        }
        : null;
    const external = value.externalExecution && typeof value.externalExecution === 'object'
        ? value.externalExecution
        : null;
    const externalExecution = external
        && external.factSource === 'authoritative_external_execution_projection'
        && external.businessExecutionOwner === 'storage_fabric'
        && external.actionType === 'storage_fabric.authorize_provider_admission'
        && external.providerStatus === 'experimental'
        && external.settlementState === 'holdback_only'
        && external.network === 'solana:devnet'
        ? {
            factSource: 'authoritative_external_execution_projection' as const,
            businessExecutionOwner: 'storage_fabric' as const,
            actionType: 'storage_fabric.authorize_provider_admission' as const,
            providerResourceRef: String(external.providerResourceRef || ''),
            providerAdmissionReceiptRef: String(external.providerAdmissionReceiptRef || ''),
            providerAdmissionReceiptDigest: String(external.providerAdmissionReceiptDigest || ''),
            providerStatus: 'experimental' as const,
            settlementState: 'holdback_only' as const,
            network: 'solana:devnet' as const,
            projectionDigest: String(external.projectionDigest || ''),
            executedAt: String(external.executedAt || ''),
        }
        : null;
    return {
        integrity,
        summary: integrity === 'verified' ? String(value.summary || '') : null,
        quantitativeImpact: normalizeStringArray(value.quantitativeImpact),
        deviations: normalizeStringArray(value.deviations),
        failures: normalizeStringArray(value.failures),
        outstandingObligations: normalizeStringArray(value.outstandingObligations),
        observationPeriod,
        digest: value.digest ? String(value.digest) : null,
        recordedByPubkey: value.recordedByPubkey ? String(value.recordedByPubkey) : null,
        recordedAt: value.recordedAt ? String(value.recordedAt) : null,
        externalExecution,
    };
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function normalizeGovernanceCaseBallotDisclosure(
    value: any,
): GovernanceCase['ballotDisclosure'] {
    if (!value || typeof value !== 'object') return null;
    const mode = value.mode == null ? null : normalizeGovernanceBallotDisclosureMode(value.mode);
    const state = value.state === 'visible' ? 'visible' : value.state === 'withheld' ? 'withheld' : null;
    const reasons: Array<NonNullable<GovernanceCase['ballotDisclosure']>['reason']> = [
        'policy_public',
        'policy_member',
        'frozen_electorate_eligible',
        'ballot_closed',
        'circle_membership_required',
        'frozen_electorate_required',
        'public_record_safe_default',
        'ballot_active_aggregate_only',
        'provider_definition_unavailable',
        'mechanism_integrity_conflict',
    ];
    const reason = reasons.find((item) => item === value.reason);
    if (!state || !reason || (value.mode != null && !mode)) return null;
    return {
        mode,
        state,
        reason,
        rawSignals: state === 'visible' && Array.isArray(value.rawSignals)
            ? value.rawSignals.flatMap((signal: any) => {
                const choice = signal?.choice;
                if (choice === 'approve' || choice === 'reject' || choice === 'abstain') {
                    return [{ actorPubkey: String(signal?.actorPubkey || ''), choice }];
                }
                if (
                    choice === 'quadratic_funding'
                    && Array.isArray(signal?.commitments)
                    && Number.isSafeInteger(signal?.totalCommitment)
                    && signal.totalCommitment > 0
                ) {
                    const commitments = signal.commitments.flatMap((item: any) => (
                        typeof item?.projectId === 'string'
                        && item.projectId.trim()
                        && Number.isSafeInteger(item?.amount)
                        && item.amount >= 0
                            ? [{ projectId: item.projectId.trim(), amount: Number(item.amount) }]
                            : []
                    ));
                    return commitments.length === signal.commitments.length
                        ? [{
                            actorPubkey: String(signal?.actorPubkey || ''),
                            choice: 'quadratic_funding' as const,
                            commitments,
                            totalCommitment: Number(signal.totalCommitment),
                        }]
                        : [];
                }
                if (
                    choice !== 'quadratic_voice_credits'
                    || !Array.isArray(signal?.choiceVector)
                    || !Number.isSafeInteger(signal?.cost)
                    || signal.cost < 0
                ) return [];
                const choiceVector = signal.choiceVector.flatMap((item: any) => (
                    typeof item?.choiceId === 'string'
                    && item.choiceId.trim()
                    && Number.isSafeInteger(item?.votes)
                    && item.votes >= 0
                        ? [{ choiceId: item.choiceId.trim(), votes: Number(item.votes) }]
                        : []
                ));
                return choiceVector.length === signal.choiceVector.length
                    ? [{
                        actorPubkey: String(signal?.actorPubkey || ''),
                        choice: 'quadratic_voice_credits' as const,
                        choiceVector,
                        cost: Number(signal.cost),
                    }]
                    : [];
            })
            : [],
    };
}

function normalizeGovernanceBallotDisclosureMode(
    value: unknown,
): GovernanceBallotDisclosureMode | null {
    return value === 'public'
        || value === 'member'
        || value === 'eligible_only'
        || value === 'aggregate_until_close'
        || value === 'provider_defined'
        ? value
        : null;
}

function normalizeGovernanceDecisionOutputArtifacts(
    value: unknown,
): GovernanceDecisionOutputArtifact[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: any) => {
        const policyDocument = item?.kind === 'policy_document'
            && item?.schemaRef === 'alcheme.governance.output.policy_document'
            && item?.constraints?.execution?.reason === 'policy_document_record_only'
            && item?.constraints?.execution?.providerReadiness === 'not_applicable';
        const allocationPlan = item?.kind === 'allocation_plan'
            && item?.schemaRef === 'alcheme.governance.output.allocation_plan'
            && item?.resolver?.ref === 'alcheme.native.quadratic-funding'
            && item?.constraints?.allocationPlan
            && item?.constraints?.execution?.reason === 'unfunded_pending_settlement'
            && item?.constraints?.execution?.providerReadiness === 'not_ready';
        const selectionResult = item?.kind === 'selection_result'
            && item?.schemaRef === 'alcheme.governance.output.selection_result'
            && item?.resolver?.ref === 'alcheme.native.selection-ranking'
            && item?.constraints?.selectionResult
            && item?.constraints?.execution?.reason === 'selection_result_record_only'
            && item?.constraints?.execution?.providerReadiness === 'not_applicable';
        const appealResolution = item?.kind === 'appeal_resolution'
            && item?.schemaRef === 'alcheme.governance.output.appeal_resolution'
            && item?.resolver?.ref === 'alcheme.native.appeal-resolution'
            && item?.constraints?.appealResolution
            && (item?.constraints?.appealResolution?.outcome === 'uphold'
                || item?.constraints?.appealResolution?.outcome === 'modify'
                || item?.constraints?.appealResolution?.outcome === 'revoke')
            && (item?.constraints?.execution?.reason === 'external_app_appeal_effect_applied'
                || item?.constraints?.execution?.reason === 'communication_mute_appeal_effect_applied'
                || item?.constraints?.execution?.reason === 'appeal_accepted_original_effect_already_terminal'
                || item?.constraints?.execution?.reason === 'appeal_upheld_original_effect_preserved')
            && item?.constraints?.execution?.providerReadiness === 'not_applicable';
        const grantAgreementAmendment = item?.kind === 'grant_agreement_amendment'
            && item?.schemaRef === 'alcheme.governance.output.grant_agreement_amendment'
            && item?.resolver?.ref === 'alcheme.native.grant-agreement-amendment'
            && item?.constraints?.grantAgreementAmendment
            && item?.constraints?.execution?.reason === 'governed_amendment_requires_explicit_application'
            && item?.constraints?.execution?.providerReadiness === 'not_applicable';
        const internalExecutionPlan = item?.kind === 'internal_execution_plan'
            && item?.schemaRef === 'alcheme.governance.output.internal_execution_plan'
            && item?.resolver?.ref === 'alcheme.native.internal-execution'
            && item?.constraints?.executionPlan?.aggregateStatus === 'executed'
            && Array.isArray(item?.constraints?.executionPlan?.actions)
            && item.constraints.executionPlan.actions.length === 1
            && item.constraints.executionPlan.actions[0]?.receipt?.status === 'executed'
            && item.constraints.executionPlan.actions[0]?.network === 'alcheme:off_chain'
            && item.constraints.executionPlan.actions[0]?.program === null
            && Array.isArray(item.constraints.executionPlan.actions[0]?.accountMetas)
            && item.constraints.executionPlan.actions[0].accountMetas.length === 0
            && Array.isArray(item.constraints.executionPlan.actions[0]?.assetChanges)
            && item.constraints.executionPlan.actions[0].assetChanges.length === 0
            && item.constraints.executionPlan.actions[0]?.atomicity === 'single_database_transaction'
            && item?.constraints?.execution?.mode === 'adapter'
            && item?.constraints?.execution?.reason === 'canonical_internal_action_executed'
            && typeof item?.constraints?.execution?.adapterRef === 'string'
            && item.constraints.execution.adapterRef.length > 0
            && item?.constraints?.execution?.providerReadiness === 'not_applicable'
            && item?.constraints?.execution?.automaticExecution === true;
        const manualExecutionPlan = item?.kind === 'manual_execution_plan'
            && item?.schemaRef === 'alcheme.governance.output.manual_execution_plan'
            && item?.resolver?.ref === 'alcheme.native.manual-execution'
            && item?.constraints?.executionPlan?.aggregateStatus === 'awaiting_manual_submission'
            && Array.isArray(item?.constraints?.executionPlan?.actions)
            && item.constraints.executionPlan.actions.length === 1
            && item.constraints.executionPlan.actions[0]?.executor === 'manual'
            && item.constraints.executionPlan.actions[0]?.attempt?.state === 'pending_completion_evidence'
            && item.constraints.executionPlan.actions[0]?.assignmentGrantsSignerAuthority === false
            && item.constraints.executionPlan.actions[0]?.network === 'manual:external_or_off_chain'
            && item.constraints.executionPlan.actions[0]?.program === null
            && Array.isArray(item.constraints.executionPlan.actions[0]?.accountMetas)
            && item.constraints.executionPlan.actions[0].accountMetas.length === 0
            && item.constraints.executionPlan.actions[0]?.assetChanges?.status
                === 'not_inferred_requires_completion_evidence'
            && item.constraints.executionPlan.actions[0]?.atomicity
                === 'manual_single_action_not_assumed_atomic'
            && item?.constraints?.execution?.mode === 'manual'
            && item?.constraints?.execution?.reason === 'controlled_manual_execution_required'
            && item?.constraints?.execution?.adapterRef === 'manual_case_execution'
            && item?.constraints?.execution?.automaticExecution === false
            && item?.constraints?.execution?.assignmentGrantsSignerAuthority === false;
        const appliedExternalAppealResolution = appealResolution
            && item.executionCapability === 'current_adapter'
            && item.constraints.execution.mode === 'adapter'
            && item.constraints.execution.reason === 'external_app_appeal_effect_applied'
            && item.constraints.execution.adapterRef === 'external_app'
            && item.constraints.execution.automaticExecution === true
            && item.constraints.appealResolution.effectStatus === 'applied';
        const appliedCommunicationAppealResolution = appealResolution
            && item.executionCapability === 'current_adapter'
            && item.constraints.execution.mode === 'adapter'
            && item.constraints.execution.reason === 'communication_mute_appeal_effect_applied'
            && item.constraints.execution.adapterRef === 'operation_effect'
            && item.constraints.execution.automaticExecution === true
            && item.constraints.appealResolution.domain === 'communication_member_mute'
            && item.constraints.appealResolution.outcome === 'revoke'
            && item.constraints.appealResolution.effectStatus === 'applied'
            && item.constraints.appealResolution.resultingEffectState === 'revoked';
        const upheldAppealResolution = appealResolution
            && item.executionCapability === 'no_op'
            && item.constraints.execution.mode === 'no_op'
            && item.constraints.execution.reason === 'appeal_upheld_original_effect_preserved'
            && item.constraints.execution.adapterRef === null
            && item.constraints.execution.automaticExecution === false
            && item.constraints.appealResolution.outcome === 'uphold'
            && item.constraints.appealResolution.effectStatus === 'preserved';
        const acceptedTerminalAppealResolution = appealResolution
            && item.executionCapability === 'no_op'
            && item.constraints.execution.mode === 'no_op'
            && item.constraints.execution.reason === 'appeal_accepted_original_effect_already_terminal'
            && item.constraints.execution.adapterRef === null
            && item.constraints.execution.automaticExecution === false
            && item.constraints.appealResolution.domain === 'communication_member_mute'
            && item.constraints.appealResolution.outcome === 'revoke'
            && item.constraints.appealResolution.effectStatus === 'preserved'
            && (item.constraints.appealResolution.resultingEffectState === 'expired'
                || item.constraints.appealResolution.resultingEffectState === 'revoked'
                || item.constraints.appealResolution.resultingEffectState === 'superseded');
        if (
            !item
            || (!policyDocument && !allocationPlan && !selectionResult && !appealResolution
                && !grantAgreementAmendment && !internalExecutionPlan && !manualExecutionPlan)
            || item.schemaVersion !== 1
            || (internalExecutionPlan || manualExecutionPlan
                ? item.source?.type !== 'governance_request'
                : appealResolution
                ? item.source?.type !== 'governance_execution_receipt'
                : item.source?.type !== 'draft_snapshot')
            || item.finality !== 'alcheme_native_decision'
            || (manualExecutionPlan
                ? item.executionCapability !== 'manual'
                : internalExecutionPlan
                ? item.executionCapability !== 'current_adapter'
                : appealResolution
                ? !appliedExternalAppealResolution
                    && !appliedCommunicationAppealResolution
                    && !upheldAppealResolution
                    && !acceptedTerminalAppealResolution
                : item.executionCapability !== 'no_op'
                    || item.constraints?.execution?.mode !== 'no_op')
        ) return [];
        const constraints: GovernanceDecisionOutputArtifact['constraints'] = manualExecutionPlan
            ? {
                executionPlan: item.constraints.executionPlan as Record<string, unknown>,
                execution: {
                    mode: 'manual',
                    reason: 'controlled_manual_execution_required',
                    adapterRef: 'manual_case_execution',
                    providerReadiness: 'not_applicable',
                    automaticExecution: false,
                    assignmentGrantsSignerAuthority: false,
                },
            }
            : internalExecutionPlan
            ? {
                executionPlan: item.constraints.executionPlan as Record<string, unknown>,
                execution: {
                    mode: 'adapter',
                    reason: 'canonical_internal_action_executed',
                    adapterRef: String(item.constraints.execution.adapterRef),
                    providerReadiness: 'not_applicable',
                    automaticExecution: true,
                },
            }
            : allocationPlan
            ? {
                allocationPlan: item.constraints.allocationPlan as Record<string, unknown>,
                execution: {
                    mode: 'no_op',
                    reason: 'unfunded_pending_settlement',
                    adapterRef: null,
                    providerReadiness: 'not_ready',
                    automaticExecution: false,
                },
            }
            : selectionResult ? {
                selectionResult: item.constraints.selectionResult as Record<string, unknown>,
                execution: {
                    mode: 'no_op',
                    reason: 'selection_result_record_only',
                    adapterRef: null,
                    providerReadiness: 'not_applicable',
                    automaticExecution: false,
                },
            } : grantAgreementAmendment ? {
                grantAgreementAmendment: item.constraints.grantAgreementAmendment as Record<string, unknown>,
                execution: {
                    mode: 'no_op',
                    reason: 'governed_amendment_requires_explicit_application',
                    adapterRef: null,
                    providerReadiness: 'not_applicable',
                    automaticExecution: false,
                },
            } : appealResolution ? {
                appealResolution: item.constraints.appealResolution as Record<string, unknown>,
                execution: {
                    mode: item.constraints.execution.mode as 'adapter' | 'no_op',
                    reason: item.constraints.execution.reason as
                        | 'external_app_appeal_effect_applied'
                        | 'communication_mute_appeal_effect_applied'
                        | 'appeal_accepted_original_effect_already_terminal'
                        | 'appeal_upheld_original_effect_preserved',
                    adapterRef: item.constraints.execution.adapterRef === 'external_app'
                        || item.constraints.execution.adapterRef === 'operation_effect'
                        ? item.constraints.execution.adapterRef
                        : null,
                    providerReadiness: 'not_applicable',
                    automaticExecution: item.constraints.execution.automaticExecution === true,
                },
            } : {
                execution: {
                    mode: 'no_op',
                    reason: 'policy_document_record_only',
                    adapterRef: null,
                    providerReadiness: 'not_applicable',
                    automaticExecution: false,
                },
            };
        return [{
            id: String(item.id || ''),
            integrity: item.integrity === 'verified' ? 'verified' : 'invalid',
            ordinal: Number(item.ordinal || 0),
            kind: item.kind as GovernanceDecisionOutputArtifact['kind'],
            schemaRef: String(item.schemaRef || ''),
            schemaVersion: 1 as const,
            subject: {
                type: String(item.subject?.type || ''),
                ref: String(item.subject?.ref || ''),
            },
            source: {
                type: String(item.source?.type || ''),
                ref: item.source?.ref ? String(item.source.ref) : null,
                digest: String(item.source?.digest || ''),
            },
            resolver: {
                ref: String(item.resolver?.ref || ''),
                version: String(item.resolver?.version || ''),
            },
            constraints,
            contentDigest: String(item.contentDigest || ''),
            decisionDigest: String(item.decisionDigest || ''),
            finality: 'alcheme_native_decision' as const,
            executionCapability: item.executionCapability as 'no_op' | 'current_adapter' | 'manual',
            artifactDigest: String(item.artifactDigest || ''),
            createdAt: item.createdAt ? String(item.createdAt) : null,
        }];
    });
}

function normalizeGovernanceGrantSettlementReadiness(
    value: any,
): GovernanceGrantSettlementReadiness | null {
    const scope = value?.scope;
    const resource = value?.resource;
    const authority = value?.authority;
    const assetAuthority = value?.assetAuthority;
    const payer = value?.payer;
    const fundingReadback = value?.fundingReadback;
    const payout = value?.payout;
    const digest = (candidate: unknown) => (
        typeof candidate === 'string' && /^[a-f0-9]{64}$/.test(candidate)
    );
    const nullableText = (candidate: unknown) => (
        candidate === null || (typeof candidate === 'string' && candidate.trim().length > 0)
    );
    const nullablePositiveInteger = (candidate: unknown) => (
        candidate === null || (Number.isSafeInteger(candidate) && Number(candidate) > 0)
    );
    const stringList = (candidate: unknown) => (
        Array.isArray(candidate)
        && candidate.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
    if (
        value?.schemaVersion !== 1
        || value?.evaluator?.ref !== 'p06.grant_settlement_readiness'
        || value?.evaluator?.version !== 1
        || !Number.isSafeInteger(value?.evaluationVersion)
        || value.evaluationVersion < 1
        || !['setup_required', 'ready'].includes(value?.state)
        || !Number.isSafeInteger(scope?.circleId)
        || scope.circleId < 1
        || !Number.isSafeInteger(scope?.lifecycleVersion)
        || scope.lifecycleVersion < 1
        || [
            scope?.homeIdentityBindingId,
            scope?.agreementId,
            scope?.allocationArtifactId,
            scope?.projectRef,
            scope?.recipientRef,
            scope?.budgetUnit,
            scope?.contractualUnits,
            scope?.governingDecisionRequestId,
        ].some((item) => typeof item !== 'string' || !item.trim())
        || !/^[1-9][0-9]*$/.test(scope?.contractualUnits)
        || !digest(scope?.termsDigest)
        || !digest(scope?.lifecycleDigest)
        || !digest(scope?.governingDecisionDigest)
        || !['not_bound', 'invalid', 'verified'].includes(resource?.state)
        || !nullableText(resource?.bindingId)
        || !nullableText(resource?.chainId)
        || !nullableText(resource?.provider)
        || !nullablePositiveInteger(resource?.contractVersion)
        || !nullableText(resource?.profileRef)
        || !nullablePositiveInteger(resource?.profileVersion)
        || !nullableText(resource?.resourceRef)
        || (resource?.stateDigest !== null && !digest(resource?.stateDigest))
        || (resource?.verifiedSlot !== null && !/^[1-9][0-9]*$/.test(resource?.verifiedSlot))
        || !['not_bound', 'invalid', 'verified'].includes(authority?.state)
        || authority?.operation !== 'grant_payout'
        || !stringList(authority?.bindingRefs)
        || !['not_configured', 'invalid', 'verified'].includes(assetAuthority?.state)
        || !nullableText(assetAuthority?.policyRef)
        || (assetAuthority?.policyDigest !== null && !digest(assetAuthority?.policyDigest))
        || !['not_configured', 'invalid', 'verified'].includes(payer?.state)
        || !nullableText(payer?.policyRef)
        || (payer?.policyDigest !== null && !digest(payer?.policyDigest))
        || !nullableText(payer?.fundingBlockerCode)
        || !['missing', 'invalid', 'verified'].includes(fundingReadback?.state)
        || (fundingReadback?.availableUnits !== null
            && !/^[1-9][0-9]*$/.test(fundingReadback?.availableUnits))
        || (fundingReadback?.slot !== null && !/^[1-9][0-9]*$/.test(fundingReadback?.slot))
        || (fundingReadback?.stateDigest !== null && !digest(fundingReadback?.stateDigest))
        || !['finalized', null].includes(fundingReadback?.finality)
        || !['not_created', 'contractual_pending_settlement', 'blocked_terminated', 'paid'].includes(payout?.intent)
        || typeof payout?.paid !== 'boolean'
        || (payout?.intentRef !== null && typeof payout?.intentRef !== 'string')
        || (payout?.payoutRef !== null && typeof payout?.payoutRef !== 'string')
        || ![null, 'finalized'].includes(payout?.providerFinality)
        || (payout?.intent === 'paid' && (
            payout.paid !== true
            || payout.providerFinality !== 'finalized'
            || typeof payout.payoutRef !== 'string'
        ))
        || (payout?.intent !== 'paid' && (
            payout?.paid !== false
            || payout?.providerFinality !== null
            || payout?.payoutRef !== null
        ))
        || !stringList(value?.blockerCodes)
        || !Number.isFinite(Date.parse(value?.evaluatedAt))
        || !digest(value?.sourceDigest)
        || !digest(value?.evaluationDigest)
        || (value.state === 'ready' && (
            value.blockerCodes.length !== 0
            || resource.state !== 'verified'
            || authority.state !== 'verified'
            || assetAuthority.state !== 'verified'
            || payer.state !== 'verified'
            || fundingReadback.state !== 'verified'
            || fundingReadback.finality !== 'finalized'
        ))
    ) return null;
    return value as GovernanceGrantSettlementReadiness;
}

function normalizeGovernanceGrantAgreements(value: unknown): GovernanceGrantAgreement[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: any) => {
        const terms = item?.terms;
        const lifecycle = item?.lifecycle;
        const milestones = Array.isArray(terms?.milestones) ? terms.milestones : [];
        if (
            !item?.id
            || (item.integrity !== 'verified' && item.integrity !== 'invalid')
            || (item.status !== 'active' && item.status !== 'terminated')
            || !['unfunded_pending_settlement', 'partially_paid', 'paid'].includes(item.fundingStatus)
            || terms?.schemaVersion !== 1
            || !terms?.recipient?.ref
            || !Array.isArray(terms?.recipient?.applicantPubkeys)
            || lifecycle?.schemaVersion !== 1
            || !Array.isArray(lifecycle?.reviews)
            || !Array.isArray(lifecycle?.milestoneResults)
            || !Array.isArray(lifecycle?.trancheIntents)
            || !Array.isArray(lifecycle?.appeals)
            || !Object.prototype.hasOwnProperty.call(lifecycle, 'terminationRequest')
            || !Object.prototype.hasOwnProperty.call(lifecycle, 'termination')
            || !Object.prototype.hasOwnProperty.call(lifecycle, 'outcome')
            || milestones.length < 1
            || milestones.some((milestone: any) => (
                !milestone?.id
                || !milestone?.title
                || !milestone?.deliverable
                || !milestone?.contractualUnits
                || !Array.isArray(milestone?.evidenceRequirements)
                || !Array.isArray(milestone?.reviewerAuthority?.primaryReviewerPubkeys)
                || !Array.isArray(milestone?.reviewerAuthority?.alternateReviewerPubkeys)
                || !Array.isArray(milestone?.reviewerAuthority?.recusedReviewerPubkeys)
                || !Array.isArray(milestone?.reviewerAuthority?.effectiveReviewerPubkeys)
                || !Array.isArray(milestone?.reviewerAuthority?.conflictDisclosureEventIds)
                || !Array.isArray(milestone?.appealAuthority?.reviewerPubkeys)
                || !Number.isSafeInteger(Number(milestone?.reviewerAuthority?.quorum))
            ))
        ) return [];
        const settlementReadinessIntegrity = [
            'verified', 'stale', 'invalid', 'not_evaluated',
        ].includes(item?.settlementReadinessIntegrity)
            ? item.settlementReadinessIntegrity as GovernanceGrantAgreement['settlementReadinessIntegrity']
            : 'invalid';
        const normalizedSettlementReadiness = normalizeGovernanceGrantSettlementReadiness(
            item?.settlementReadiness,
        );
        const settlementReadiness = settlementReadinessIntegrity === 'verified'
            || settlementReadinessIntegrity === 'stale'
            ? normalizedSettlementReadiness
            : null;
        const settlementReadinessMetadataValid = (
            Number.isSafeInteger(item?.settlementReadinessVersion)
            && item.settlementReadinessVersion >= 0
            && (
                item?.settlementReadinessDigest === null
                || /^[a-f0-9]{64}$/.test(String(item?.settlementReadinessDigest || ''))
            )
            && (
                item?.settlementReadinessEvaluatedAt === null
                || Number.isFinite(Date.parse(item?.settlementReadinessEvaluatedAt))
            )
            && (
                settlementReadinessIntegrity === 'not_evaluated'
                    ? item.settlementReadinessVersion === 0
                        && item.settlementReadinessDigest === null
                        && item.settlementReadinessEvaluatedAt === null
                        && item.settlementReadiness === null
                    : true
            )
        );
        const effectiveSettlementReadinessIntegrity = settlementReadinessMetadataValid
            && (
                !['verified', 'stale'].includes(settlementReadinessIntegrity)
                || settlementReadiness !== null
            )
            ? settlementReadinessIntegrity
            : 'invalid';
        return [{
            id: String(item.id),
            integrity: item.integrity as 'verified' | 'invalid',
            caseId: String(item.caseId || ''),
            allocationArtifactId: String(item.allocationArtifactId || ''),
            projectRef: String(item.projectRef || ''),
            recipientRef: String(item.recipientRef || ''),
            status: item.status as 'active' | 'terminated',
            fundingStatus: item.fundingStatus as GovernanceGrantAgreement['fundingStatus'],
            settlementReadiness: effectiveSettlementReadinessIntegrity === 'verified'
                || effectiveSettlementReadinessIntegrity === 'stale'
                ? settlementReadiness
                : null,
            settlementReadinessIntegrity: effectiveSettlementReadinessIntegrity,
            settlementReadinessDigest: settlementReadinessMetadataValid
                && item.settlementReadinessDigest
                ? String(item.settlementReadinessDigest)
                : null,
            settlementReadinessVersion: settlementReadinessMetadataValid
                ? Number(item.settlementReadinessVersion)
                : 0,
            settlementReadinessEvaluatedAt: settlementReadinessMetadataValid
                && item.settlementReadinessEvaluatedAt
                ? String(item.settlementReadinessEvaluatedAt)
                : null,
            budget: {
                unit: String(item.budget?.unit || ''),
                contractualUnits: String(item.budget?.contractualUnits || ''),
                committedContractualUnits: String(item.budget?.committedContractualUnits || '0'),
                paidContractualUnits: String(item.budget?.paidContractualUnits || '0'),
                blockedContractualUnits: String(item.budget?.blockedContractualUnits || '0'),
                remainingContractualUnits: String(item.budget?.remainingContractualUnits || '0'),
            },
            governingDecision: {
                requestId: String(item.governingDecision?.requestId || ''),
                digest: String(item.governingDecision?.digest || ''),
            },
            payoutRequests: Array.isArray(item.payoutRequests)
                ? item.payoutRequests.flatMap((request: any) => {
                    if (!request?.id || !request?.state) return [];
                    return [{
                        id: String(request.id),
                        state: String(request.state),
                        openedAt: request.openedAt ? String(request.openedAt) : null,
                        resolvedAt: request.resolvedAt ? String(request.resolvedAt) : null,
                        decision: request.decision
                            ? {
                                decision: String(request.decision.decision || ''),
                                decisionDigest: String(request.decision.decisionDigest || ''),
                                decidedAt: request.decision.decidedAt
                                    ? String(request.decision.decidedAt)
                                    : null,
                            }
                            : null,
                        execution: request.execution
                            ? {
                                status: String(request.execution.status || ''),
                                ref: request.execution.ref == null
                                    ? null
                                    : String(request.execution.ref),
                                errorCode: request.execution.errorCode == null
                                    ? null
                                    : String(request.execution.errorCode),
                                executedAt: request.execution.executedAt
                                    ? String(request.execution.executedAt)
                                    : null,
                            }
                            : null,
                        providerExecution: normalizeGovernanceProviderExecutionReadback(
                            request.providerExecution,
                        ),
                    }];
                })
                : [],
            terms: terms as GovernanceGrantAgreement['terms'],
            termsDigest: String(item.termsDigest || ''),
            lifecycle: item.lifecycle as GovernanceGrantAgreement['lifecycle'],
            lifecycleDigest: String(item.lifecycleDigest || ''),
            lifecycleVersion: Number(item.lifecycleVersion || 0),
            activatedByPubkey: String(item.activatedByPubkey || ''),
            activatedAt: item.activatedAt ? String(item.activatedAt) : null,
        }];
    });
}

function normalizeGovernanceQuadraticFundingActivationReadiness(
    value: any,
): GovernanceQuadraticFundingActivationReadiness | null {
    const resource = value?.resourceFundedMode;
    if (
        value?.schemaVersion !== 1
        || value?.evaluator?.ref !== 'p06.qf_resource_activation_readiness'
        || value?.evaluator?.version !== 1
        || value?.nativeMode?.state !== 'available'
        || value?.nativeMode?.input !== 'signed_unsettled_commitments'
        || value?.nativeMode?.donationFinality !== 'not_applicable_commitment_is_not_funding'
        || value?.nativeMode?.matchingBudget !== 'contractual_allocation_unit_only'
        || value?.nativeMode?.payoutIntent !== 'forbidden'
        || !['setup_required', 'ready'].includes(resource?.state)
        || !['blocked', 'ready'].includes(resource?.activation)
        || resource?.payoutIntent !== 'not_created'
        || !Array.isArray(resource?.blockerCodes)
        || resource.blockerCodes.some((code: unknown) => typeof code !== 'string' || !code)
        || !Number.isFinite(Date.parse(String(value?.evaluatedAt || '')))
        || !isSha256Digest(value?.sourceDigest)
        || !isSha256Digest(value?.evaluationDigest)
    ) return null;
    return value as GovernanceQuadraticFundingActivationReadiness;
}

function normalizeGovernanceQuadraticVoiceActivationReadiness(
    value: any,
): GovernanceQuadraticVoiceActivationReadiness | null {
    const external = value?.externalResourceMode;
    if (
        value?.schemaVersion !== 1
        || value?.evaluator?.ref !== 'p06.qv_resource_activation_readiness'
        || value?.evaluator?.version !== 1
        || value?.nativeMode?.state !== 'available'
        || value?.nativeMode?.budgetSource !== 'frozen_policy_rule'
        || !Number.isSafeInteger(Number(value?.nativeMode?.creditBudgetPerActor))
        || Number(value.nativeMode.creditBudgetPerActor) < 1
        || value?.nativeMode?.tokenOrAssetBalanceUsed !== false
        || !['setup_required', 'ready'].includes(external?.state)
        || !['blocked', 'ready'].includes(external?.activation)
        || !Array.isArray(external?.blockerCodes)
        || external.blockerCodes.some((code: unknown) => typeof code !== 'string' || !code)
        || !Number.isFinite(Date.parse(String(value?.evaluatedAt || '')))
        || !isSha256Digest(value?.sourceDigest)
        || !isSha256Digest(value?.evaluationDigest)
    ) return null;
    return value as GovernanceQuadraticVoiceActivationReadiness;
}

function normalizeGovernanceCasePolicySimulation(value: any): GovernanceCasePolicySimulation | null {
    const reasons: GovernanceCasePolicySimulation['reason'][] = [
        'ready',
        'action_contract_unavailable',
        'decision_mechanism_unavailable',
        'active_governance_home_required',
        'approval_authority_required',
        'approval_authority_unavailable',
        'approval_policy_rule_unavailable',
        'approval_conflict_policy_unavailable',
        'approval_conflict_disclosure_invalid',
        'approval_electorate_required',
        'approval_operator_required',
        'approval_quorum_unreachable',
        'approval_recusal_quorum_unreachable',
    ];
    if (
        !value
        || typeof value !== 'object'
        || value.schemaVersion !== 1
        || (value.status !== 'ready' && value.status !== 'blocked')
        || !reasons.includes(value.reason)
        || !value.provider
        || value.provider.type !== 'alcheme_internal'
        || !value.electorate
        || !value.conflictOfInterest
    ) return null;
    const threshold = Number(value.electorate.approvalThreshold);
    const conflictPolicy = normalizeGovernanceCaseConflictPolicy(value.conflictOfInterest.policy);
    if (!conflictPolicy) return null;
    const disclosures = Array.isArray(value.conflictOfInterest.disclosures)
        ? value.conflictOfInterest.disclosures.map((item: any) => ({
            actorPubkey: String(item?.actorPubkey || ''),
            publicReason: normalizeGovernanceCaseConflictReason(item?.publicReason),
        }))
        : [];
    if (disclosures.some((item: { actorPubkey: string; publicReason: GovernanceCaseConflictReason | null }) => (
        !item.actorPubkey || !item.publicReason
    ))) return null;
    const viewerStatus = value.conflictOfInterest.viewerStatus === 'eligible'
        || value.conflictOfInterest.viewerStatus === 'recused'
        ? value.conflictOfInterest.viewerStatus
        : 'ineligible';
    const quadraticFunding = value.quadraticFunding == null
        ? null
        : normalizeGovernanceQuadraticFundingActivationReadiness(value.quadraticFunding);
    if (value.quadraticFunding != null && !quadraticFunding) return null;
    const quadraticVoice = value.quadraticVoice == null
        ? null
        : normalizeGovernanceQuadraticVoiceActivationReadiness(value.quadraticVoice);
    if (value.quadraticVoice != null && !quadraticVoice) return null;
    return {
        schemaVersion: 1,
        status: value.status,
        reason: value.reason,
        actionType: value.actionType ? String(value.actionType) : null,
        institutionalAuthority: value.institutionalAuthority?.type === 'circle_governance_committee'
            ? {
                type: 'circle_governance_committee',
                ref: String(value.institutionalAuthority.ref || ''),
                version: String(value.institutionalAuthority.version || ''),
            }
            : null,
        provider: {
            type: 'alcheme_internal',
            version: String(value.provider.version || ''),
            status: value.provider.status === 'ready' ? 'ready' : 'unavailable',
        },
        electorate: {
            baseEligibleActorCount: Math.max(0, Number(value.electorate.baseEligibleActorCount) || 0),
            eligibleActorCount: Math.max(0, Number(value.electorate.eligibleActorCount) || 0),
            recusalCount: Math.max(0, Number(value.electorate.recusalCount) || 0),
            approvalThreshold: Number.isSafeInteger(threshold) && threshold > 0 ? threshold : null,
            quorumReachable: value.electorate.quorumReachable === true,
        },
        conflictOfInterest: {
            policy: conflictPolicy,
            disclosures: disclosures as GovernanceCasePolicySimulation['conflictOfInterest']['disclosures'],
            viewerStatus,
            canSelfDisclose: value.conflictOfInterest.canSelfDisclose === true,
        },
        quadraticFunding,
        quadraticVoice,
    };
}

function normalizeGovernanceCaseDecisionStages(value: any): GovernanceCaseDecisionStages | null {
    if (!value || typeof value !== 'object') return null;
    const integrity = value.integrity === 'verified' ? 'verified' : 'invalid';
    return {
        integrity,
        digest: value.digest ? String(value.digest) : null,
        resolutionRule: value.resolutionRule === 'all_required' ? 'all_required' : null,
        frozenAt: value.frozenAt ? String(value.frozenAt) : null,
        evidencePolicy: normalizeGovernanceCaseFrozenEvidencePolicy(value.evidencePolicy),
        outcome: ['pending', 'accepted', 'rejected', 'expired', 'cancelled'].includes(value.outcome)
            ? value.outcome
            : null,
        stages: Array.isArray(value.stages) ? value.stages.map((stage: any) => ({
            stageRef: String(stage?.stageRef || ''),
            order: Number(stage?.order || 0),
            purpose: stage?.purpose === 'review_gate' ? 'review_gate' : 'approval',
            institutionalAuthority: {
                type: String(stage?.institutionalAuthority?.type || ''),
                ref: String(stage?.institutionalAuthority?.ref || ''),
                version: String(stage?.institutionalAuthority?.version || ''),
            },
            provider: {
                type: String(stage?.provider?.type || ''),
                version: String(stage?.provider?.version || ''),
            },
            mechanism: normalizeGovernanceDecisionStageMechanism(stage?.mechanism),
            requiredForApproval: stage?.requiredForApproval === true,
            vetoOnReject: stage?.vetoOnReject === true,
            startCondition: String(stage?.startCondition || ''),
            expiresAt: stage?.expiresAt ? String(stage.expiresAt) : null,
            onExpire: String(stage?.onExpire || ''),
            onUnavailable: String(stage?.onUnavailable || ''),
            shortCircuitRule: String(stage?.shortCircuitRule || ''),
            decisionRef: {
                type: String(stage?.decisionRef?.type || ''),
                ref: String(stage?.decisionRef?.ref || ''),
            },
            state: normalizeGovernanceDecisionStageState(stage?.state),
        })) : [],
    };
}

function normalizeGovernanceCaseDecisionAuthorityStages(
    value: any,
): GovernanceCaseDecisionAuthorityStages {
    const integrity = value?.integrity;
    if (
        (integrity !== 'verified' && integrity !== 'invalid' && integrity !== 'not_frozen')
        || !Array.isArray(value?.stages)
    ) return { integrity: 'invalid', stages: [] };
    const stages = value.stages.flatMap((stage: any) => {
        const order = Number(stage?.order);
        const authority = stage?.decisionAuthority;
        if (
            !String(stage?.stageRef || '').trim()
            || !Number.isSafeInteger(order)
            || order <= 0
            || (stage?.purpose !== 'review_gate' && stage?.purpose !== 'approval')
            || !String(authority?.type || '').trim()
            || !String(authority?.ref || '').trim()
            || !String(authority?.version || '').trim()
            || (authority?.authorityClass !== 'institutional'
                && authority?.authorityClass !== 'workflow_stage')
        ) return [];
        return [{
            stageRef: String(stage.stageRef),
            order,
            purpose: stage.purpose,
            decisionAuthority: {
                authorityClass: authority.authorityClass,
                type: String(authority.type),
                ref: String(authority.ref),
                version: String(authority.version),
            },
            state: normalizeGovernanceDecisionStageState(stage.state),
        }];
    });
    if (integrity !== 'verified' && stages.length > 0) return { integrity: 'invalid', stages: [] };
    if (stages.length !== value.stages.length) return { integrity: 'invalid', stages: [] };
    return { integrity, stages };
}

function normalizeGovernanceCaseFrozenEvidencePolicy(
    value: any,
): GovernanceCaseDecisionStages['evidencePolicy'] {
    if (
        value?.mode !== 'continue_from_frozen_package_digests'
        || value?.postFreezeAccess !== 'live_visibility_gate'
        || value?.revocationEffect !== 'deny_future_access_without_rewriting_stage'
        || !Array.isArray(value?.packages)
    ) return null;
    const packages = value.packages.flatMap((item: any) => {
        const version = Number(item?.version);
        if (
            !item?.id
            || !Number.isInteger(version)
            || version < 1
            || !/^[a-f0-9]{64}$/.test(String(item?.digest || ''))
            || !item?.authorizedAt
        ) return [];
        return [{
            id: String(item.id),
            version,
            digest: String(item.digest),
            authorizedAt: String(item.authorizedAt),
            expiresAt: item.expiresAt ? String(item.expiresAt) : null,
        }];
    });
    if (packages.length !== value.packages.length) return null;
    return {
        mode: value.mode,
        postFreezeAccess: value.postFreezeAccess,
        revocationEffect: value.revocationEffect,
        packages,
    };
}

function normalizeGovernanceDecisionStageMechanism(
    value: any,
): GovernanceCaseDecisionStages['stages'][number]['mechanism'] {
    if (
        value?.status === 'not_applicable'
        && value?.reason === 'snapshot_bound_human_review'
    ) {
        return {
            status: 'not_applicable',
            reason: 'snapshot_bound_human_review',
        };
    }
    if (
        value?.schemaVersion === 1
        && value?.kind === 'quadratic_funding'
        && value?.algorithm?.id === 'native.quadratic_funding'
        && value?.algorithm?.version === '1'
        && value?.result?.type === 'allocation_plan'
        && /^[a-f0-9]{64}$/.test(String(value?.contractDigest || ''))
    ) {
        return {
            schemaVersion: 1,
            kind: 'quadratic_funding',
            algorithm: { id: 'native.quadratic_funding', version: '1' },
            result: { type: 'allocation_plan' },
            contractDigest: String(value.contractDigest),
        };
    }
    if (
        value?.schemaVersion === 1
        && value?.kind === 'quadratic_voice_credits'
        && value?.algorithm?.id === 'native.quadratic_voice_credits'
        && value?.algorithm?.version === '1'
        && value?.result?.type === 'multi_choice_voice_credit_tally'
        && /^[a-f0-9]{64}$/.test(String(value?.contractDigest || ''))
    ) {
        return {
            schemaVersion: 1,
            kind: 'quadratic_voice_credits',
            algorithm: { id: 'native.quadratic_voice_credits', version: '1' },
            result: { type: 'multi_choice_voice_credit_tally' },
            contractDigest: String(value.contractDigest),
        };
    }
    if (
        value?.schemaVersion === 1
        && value?.kind === 'equal_weight_threshold'
        && value?.algorithm?.id === 'committee.member_threshold'
        && value?.algorithm?.version === '1'
        && value?.result?.type === 'native_ballot_tally'
        && /^[a-f0-9]{64}$/.test(String(value?.contractDigest || ''))
    ) {
        return {
            schemaVersion: 1,
            kind: 'equal_weight_threshold',
            algorithm: { id: 'committee.member_threshold', version: '1' },
            result: { type: 'native_ballot_tally' },
            contractDigest: String(value.contractDigest),
        };
    }
    return {
        status: 'invalid',
        reason: 'mechanism_contract_invalid',
    };
}

function normalizeGovernanceDecisionStageState(value: unknown): GovernanceCaseDecisionStages['stages'][number]['state'] {
    if (
        value === 'active'
        || value === 'accepted'
        || value === 'rejected'
        || value === 'expired'
        || value === 'cancelled'
        || value === 'reconciliation_required'
    ) return value;
    return 'unavailable';
}

function normalizeGovernanceCasePhase(value: unknown): GovernanceCasePhase {
    if (
        value === 'proposal_drafting'
        || value === 'evidence_review'
        || value === 'ready_for_decision'
        || value === 'decision_in_progress'
        || value === 'execution_preparation'
        || value === 'execution_in_progress'
        || value === 'outcome_review'
        || value === 'closed'
        || value === 'archived'
    ) return value;
    return 'intake';
}

function normalizeGovernanceCaseWorkflow(value: any): GovernanceCaseWorkflow {
    return {
        legacy: value?.legacy !== false,
        version: Number.isInteger(value?.version) ? Number(value.version) : null,
        canManage: value?.canManage === true,
        responsibilities: Array.isArray(value?.responsibilities)
            ? value.responsibilities.map((item: any) => ({
                kind: normalizeResponsibilityKind(item?.kind),
                assigneePubkey: String(item?.assigneePubkey || ''),
                status: normalizeResponsibilityStatus(item?.status),
                version: Number(item?.version || 0),
                assignedByPubkey: String(item?.assignedByPubkey || ''),
                assignedAt: item?.assignedAt ? String(item.assignedAt) : null,
                deadlineAt: item?.deadlineAt ? String(item.deadlineAt) : null,
                respondedAt: item?.respondedAt ? String(item.respondedAt) : null,
                reason: item?.reason ? String(item.reason) : null,
            }))
            : [],
        timeline: Array.isArray(value?.timeline)
            ? value.timeline.map((item: any) => ({
                id: String(item?.id || ''),
                eventType: String(item?.eventType || ''),
                responsibilityKind: item?.responsibilityKind
                    ? normalizeResponsibilityKind(item.responsibilityKind)
                    : null,
                actorPubkey: item?.actorPubkey ? String(item.actorPubkey) : null,
                actorUserId: Number.isInteger(item?.actorUserId)
                    ? Number(item.actorUserId)
                    : null,
                subjectPubkey: item?.subjectPubkey ? String(item.subjectPubkey) : null,
                fromState: item?.fromState ? String(item.fromState) : null,
                toState: item?.toState ? String(item.toState) : null,
                reason: item?.reason ? String(item.reason) : null,
                caseVersion: Number.isInteger(item?.caseVersion)
                    ? Number(item.caseVersion)
                    : null,
                responsibilityVersion: item?.responsibilityVersion == null
                    ? null
                    : Number(item.responsibilityVersion),
                responsibilityDeadlineAt: item?.responsibilityDeadlineAt
                    ? String(item.responsibilityDeadlineAt)
                    : null,
                briefDraftPostId: Number.isInteger(item?.briefDraftPostId)
                    ? Number(item.briefDraftPostId)
                    : null,
                briefDraftVersion: Number.isInteger(item?.briefDraftVersion)
                    ? Number(item.briefDraftVersion)
                    : null,
                briefSnapshotDigest: isSha256Digest(item?.briefSnapshotDigest)
                    ? String(item.briefSnapshotDigest)
                    : null,
                briefSnapshotStatus: item?.briefSnapshotStatus === 'current'
                    || item?.briefSnapshotStatus === 'invalidated'
                    ? item.briefSnapshotStatus
                    : null,
                briefSnapshotInvalidationReason: item?.briefSnapshotInvalidationReason === 'brief_snapshot_changed'
                    ? 'brief_snapshot_changed'
                    : null,
                reviewPublicBasis: item?.reviewPublicBasis ? String(item.reviewPublicBasis) : null,
                reviewThreadId: item?.reviewThreadId ? String(item.reviewThreadId) : null,
                createdAt: item?.createdAt ? String(item.createdAt) : null,
            }))
            : [],
        candidates: Array.isArray(value?.candidates)
            ? value.candidates.map((item: any) => ({
                pubkey: String(item?.pubkey || ''),
                handle: String(item?.handle || ''),
                displayName: item?.displayName ? String(item.displayName) : null,
                role: String(item?.role || 'Member'),
                eligibleResponsibilityKinds: Array.isArray(item?.eligibleResponsibilityKinds)
                    ? item.eligibleResponsibilityKinds.filter(
                        (kind: unknown): kind is GovernanceCaseResponsibilityKind => (
                            ['coordinator', 'review', 'execution', 'outcome'].includes(String(kind))
                        ),
                    )
                    : ['coordinator', 'review', 'execution', 'outcome'],
            })).filter((item: { pubkey: string }) => Boolean(item.pubkey))
            : [],
    };
}

function normalizeGovernanceCaseBrief(value: any): GovernanceCase['brief'] {
    if (
        !Number.isInteger(value?.draftPostId)
        || !Number.isInteger(value?.draftVersion)
        || !isSha256Digest(value?.snapshotDigest)
        || !value?.boundByPubkey
        || !value?.boundAt
    ) return null;
    return {
        draftPostId: Number(value.draftPostId),
        draftVersion: Number(value.draftVersion),
        snapshotDigest: String(value.snapshotDigest),
        boundByPubkey: String(value.boundByPubkey),
        boundAt: String(value.boundAt),
        actors: normalizeGovernanceBriefActors(value?.actors),
        contentHistory: normalizeGovernanceBriefContentHistory(value?.contentHistory),
        sources: Array.isArray(value?.sources)
            ? value.sources.flatMap((source: any) => {
                if (
                    !Number.isInteger(source?.id)
                    || typeof source?.canonicalUrl !== 'string'
                    || !source.canonicalUrl.startsWith('https://')
                    || !source?.externalAuthorLabel
                    || !source?.publishedAt
                    || !source?.capturedAt
                    || !isSha256Digest(source?.contentDigest)
                    || !Number.isInteger(source?.sourceVersion)
                    || source.sourceVersion < 1
                ) return [];
                const versionDiff = normalizeSourceMaterialVersionDiff(source?.versionDiff);
                if (
                    source.sourceVersion > 1
                    && (!Number.isInteger(source?.previousVersionId) || !versionDiff)
                ) return [];
                return [{
                    id: Number(source.id),
                    name: String(source.name || ''),
                    canonicalUrl: String(source.canonicalUrl),
                    externalAuthorLabel: String(source.externalAuthorLabel),
                    publishedAt: String(source.publishedAt),
                    capturedAt: String(source.capturedAt),
                    contentDigest: String(source.contentDigest),
                    sourceVersion: Number(source.sourceVersion),
                    previousVersionId: source.sourceVersion > 1
                        ? Number(source.previousVersionId)
                        : null,
                    versionDiff,
                    chunks: Array.isArray(source?.chunks)
                        ? source.chunks.flatMap((chunk: any) => (
                            Number.isInteger(chunk?.id)
                            && Number.isInteger(chunk?.index)
                            && chunk.index >= 0
                            && isSha256Digest(chunk?.digest)
                                ? [{ id: Number(chunk.id), index: Number(chunk.index), digest: String(chunk.digest) }]
                                : []
                        ))
                        : [],
                    chunkCount: Number.isInteger(source.chunkCount) && source.chunkCount >= 0
                        ? Number(source.chunkCount)
                        : 0,
                }];
            })
            : [],
        claims: Array.isArray(value?.claims)
            ? value.claims.flatMap((claim: any) => {
                const sectionKey = claim?.sectionKey === 'supporting_evidence'
                    || claim?.sectionKey === 'arguments_for'
                    || claim?.sectionKey === 'arguments_against'
                    || claim?.sectionKey === 'risks'
                    ? claim.sectionKey
                    : null;
                const coverageStatus = claim?.coverageStatus === 'supported'
                    || claim?.coverageStatus === 'stale'
                    || claim?.coverageStatus === 'redacted'
                    || claim?.coverageStatus === 'unsupported'
                    ? claim.coverageStatus
                    : null;
                if (
                    !sectionKey
                    || !coverageStatus
                    || typeof claim?.id !== 'string'
                    || !claim.id.startsWith('brief-claim:')
                    || !Number.isInteger(claim?.ordinal)
                    || claim.ordinal < 0
                    || typeof claim?.text !== 'string'
                    || !claim.text.trim()
                    || !isSha256Digest(claim?.digest)
                ) return [];
                return [{
                    id: claim.id,
                    sectionKey,
                    ordinal: Number(claim.ordinal),
                    text: claim.text,
                    digest: String(claim.digest),
                    coverageStatus,
                    bindings: Array.isArray(claim?.bindings)
                        ? claim.bindings.flatMap((binding: any) => (
                            typeof binding?.id === 'string'
                            && Number.isInteger(binding?.sourceMaterialId)
                            && isSha256Digest(binding?.sourceMaterialDigest)
                            && Number.isInteger(binding?.sourceMaterialChunkId)
                            && isSha256Digest(binding?.sourceMaterialChunkDigest)
                                ? [{
                                    id: binding.id,
                                    sourceMaterialId: Number(binding.sourceMaterialId),
                                    sourceMaterialDigest: String(binding.sourceMaterialDigest),
                                    sourceMaterialChunkId: Number(binding.sourceMaterialChunkId),
                                    sourceMaterialChunkDigest: String(binding.sourceMaterialChunkDigest),
                                    boundByPubkey: binding?.boundByPubkey ? String(binding.boundByPubkey) : null,
                                    boundAt: binding?.boundAt ? String(binding.boundAt) : null,
                                }]
                                : []
                        ))
                        : [],
                }];
            })
            : [],
        coverage: normalizeGovernanceBriefCoverage(value?.coverage),
        readiness: normalizeGovernanceBriefReadiness(value?.readiness),
    };
}

function normalizeGovernanceBriefActors(
    value: any,
): NonNullable<GovernanceCase['brief']>['actors'] {
    const statuses: GovernanceCaseResponsibilityStatus[] = [
        'assigned', 'accepted', 'declined', 'escalated', 'absent',
    ];
    return {
        externalAuthors: Array.isArray(value?.externalAuthors)
            ? value.externalAuthors.flatMap((item: any) => (
                Number.isInteger(item?.sourceMaterialId) && typeof item?.label === 'string' && item.label.trim()
                    ? [{ sourceMaterialId: Number(item.sourceMaterialId), label: item.label.trim() }]
                    : []
            ))
            : [],
        materialSubmitters: Array.isArray(value?.materialSubmitters)
            ? value.materialSubmitters.flatMap((item: any) => {
                if (!Number.isInteger(item?.sourceMaterialId)) return [];
                const userId = Number.isInteger(item?.userId) && item.userId > 0 ? Number(item.userId) : null;
                const pubkey = typeof item?.pubkey === 'string' && item.pubkey.trim()
                    ? item.pubkey.trim()
                    : null;
                const secondarySnsLabel = typeof item?.secondarySnsLabel === 'string'
                    && item.secondarySnsLabel.trim().toLowerCase().endsWith('.sol')
                    ? item.secondarySnsLabel.trim()
                    : null;
                return userId || pubkey
                    ? [{ sourceMaterialId: Number(item.sourceMaterialId), userId, pubkey, secondarySnsLabel }]
                    : [];
            })
            : [],
        briefContributors: Array.isArray(value?.briefContributors)
            ? value.briefContributors.flatMap((item: any) => (
                Number.isInteger(item?.userId) && item.userId > 0
                && Number.isInteger(item?.draftVersion) && item.draftVersion > 0
                    ? [{ userId: Number(item.userId), draftVersion: Number(item.draftVersion) }]
                    : []
            ))
            : [],
        reviewers: Array.isArray(value?.reviewers)
            ? value.reviewers.flatMap((item: any) => (
                typeof item?.pubkey === 'string' && item.pubkey.trim()
                && statuses.includes(item?.status)
                    ? [{
                        pubkey: item.pubkey.trim(),
                        status: item.status as GovernanceCaseResponsibilityStatus,
                        secondarySnsLabel: typeof item?.secondarySnsLabel === 'string'
                            && item.secondarySnsLabel.trim().toLowerCase().endsWith('.sol')
                            ? item.secondarySnsLabel.trim()
                            : null,
                    }]
                    : []
            ))
            : [],
    };
}

function normalizeGovernanceBriefContentHistory(
    value: unknown,
): NonNullable<GovernanceCase['brief']>['contentHistory'] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item: any) => {
        const contentKind = item?.contentKind === 'ai_draft' || item?.contentKind === 'ai_suggestion'
            ? item.contentKind
            : null;
        const mode = item?.humanAcceptance?.mode === 'auto_fill'
            || item?.humanAcceptance?.mode === 'accept_replace'
            || item?.humanAcceptance?.mode === 'accept_suggestion'
            ? item.humanAcceptance.mode
            : null;
        const snapshotRelation = item?.snapshotRelation === 'exact_snapshot'
            || item?.snapshotRelation === 'before_snapshot'
            ? item.snapshotRelation
            : null;
        if (
            typeof item?.id !== 'string'
            || !item.id.startsWith('ghost-draft-acceptance:')
            || !contentKind
            || !mode
            || !snapshotRelation
            || !Number.isInteger(item?.aiGeneration?.generationId)
            || !item?.aiGeneration?.generatedAt
            || typeof item?.aiGeneration?.content !== 'string'
            || !item.aiGeneration.content.trim()
            || !isSha256Digest(item?.aiGeneration?.sourceDigest)
            || !Number.isInteger(item?.humanAcceptance?.acceptedByUserId)
            || !item?.humanAcceptance?.acceptedAt
            || !isSha256Digest(item?.humanAcceptance?.resultingWorkingCopyHash)
        ) return [];
        return [{
            id: item.id,
            contentKind,
            aiGeneration: {
                generationId: Number(item.aiGeneration.generationId),
                generatedAt: String(item.aiGeneration.generatedAt),
                model: String(item.aiGeneration.model || ''),
                sourceDigest: String(item.aiGeneration.sourceDigest),
                summary: item.aiGeneration.summary ? String(item.aiGeneration.summary) : null,
                content: item.aiGeneration.content.trim(),
            },
            humanAcceptance: {
                acceptedByUserId: Number(item.humanAcceptance.acceptedByUserId),
                acceptedAt: String(item.humanAcceptance.acceptedAt),
                mode,
                resultingWorkingCopyHash: String(item.humanAcceptance.resultingWorkingCopyHash),
            },
            snapshotRelation,
        }];
    });
}

function normalizeGovernanceBriefCoverage(value: any): {
    total: number;
    supported: number;
    stale: number;
    redacted: number;
    unsupported: number;
} {
    const counts = ['total', 'supported', 'stale', 'redacted', 'unsupported']
        .map((key) => Number.isInteger(value?.[key]) && value[key] >= 0 ? Number(value[key]) : null);
    if (counts.some((count) => count == null)) {
        return { total: 0, supported: 0, stale: 0, redacted: 0, unsupported: 0 };
    }
    const [total, supported, stale, redacted, unsupported] = counts as number[];
    if (supported + stale + redacted + unsupported !== total) {
        return { total: 0, supported: 0, stale: 0, redacted: 0, unsupported: 0 };
    }
    return { total, supported, stale, redacted, unsupported };
}

function normalizeSourceMaterialVersionDiff(value: any): {
    previousVersion: number;
    previousContentDigest: string;
    addedChunks: number;
    removedChunks: number;
    unchangedChunks: number;
} | null {
    if (
        !value
        || !Number.isInteger(value.previousVersion)
        || value.previousVersion < 1
        || !isSha256Digest(value.previousContentDigest)
        || !Number.isInteger(value.addedChunks)
        || value.addedChunks < 0
        || !Number.isInteger(value.removedChunks)
        || value.removedChunks < 0
        || !Number.isInteger(value.unchangedChunks)
        || value.unchangedChunks < 0
    ) return null;
    return {
        previousVersion: Number(value.previousVersion),
        previousContentDigest: String(value.previousContentDigest),
        addedChunks: Number(value.addedChunks),
        removedChunks: Number(value.removedChunks),
        unchangedChunks: Number(value.unchangedChunks),
    };
}

function normalizeGovernanceBriefReadiness(value: any): NonNullable<NonNullable<GovernanceCase['brief']>['readiness']> | null {
    if (!value || !Array.isArray(value.sections)) return null;
    const sections = value.sections
        .map((section: any) => ({
            key: normalizeGovernanceBriefSectionKey(section?.key),
            heading: String(section?.heading || ''),
            complete: section?.complete === true,
            ownerPubkey: section?.ownerPubkey ? String(section.ownerPubkey) : null,
        }))
        .filter((section: { key: GovernanceBriefSectionKey | null }): section is { key: GovernanceBriefSectionKey; heading: string; complete: boolean; ownerPubkey: string | null } => section.key !== null);
    return {
        sectionReady: value.sectionReady === true,
        documentStatus: value.documentStatus ? String(value.documentStatus) : null,
        currentSnapshotVersion: Number.isInteger(value.currentSnapshotVersion)
            ? Number(value.currentSnapshotVersion)
            : null,
        reviewSnapshotReady: value.reviewSnapshotReady === true,
        readyForEvidenceReview: value.readyForEvidenceReview === true,
        missingSectionKeys: Array.isArray(value.missingSectionKeys)
            ? value.missingSectionKeys.map(normalizeGovernanceBriefSectionKey).filter(Boolean) as GovernanceBriefSectionKey[]
            : [],
        sections,
    };
}

function normalizeGovernanceBriefSectionKey(value: unknown): GovernanceBriefSectionKey | null {
    if (
        value === 'identity'
        || value === 'requested_decision'
        || value === 'background'
        || value === 'options'
        || value === 'arguments'
        || value === 'supporting_evidence'
        || value === 'arguments_for'
        || value === 'arguments_against'
        || value === 'risks'
        || value === 'open_questions'
        || value === 'execution_plan'
        || value === 'provider_readiness'
        || value === 'outcome'
    ) return value;
    return null;
}

function normalizeGovernanceCaseBriefCandidate(value: any): GovernanceCaseBriefCandidate {
    return {
        draftPostId: Number(value?.draftPostId || 0),
        title: String(value?.title || ''),
        documentStatus: String(value?.documentStatus || 'drafting'),
        draftVersion: Number(value?.draftVersion || 0),
        snapshotDigest: isSha256Digest(value?.snapshotDigest) ? String(value.snapshotDigest) : '',
        snapshotCreatedAt: String(value?.snapshotCreatedAt || ''),
        updatedAt: String(value?.updatedAt || ''),
        sectionReady: value?.sectionReady === true,
        missingSectionKeys: Array.isArray(value?.missingSectionKeys)
            ? value.missingSectionKeys.map(normalizeGovernanceBriefSectionKey).filter(Boolean) as GovernanceBriefSectionKey[]
            : [],
    };
}

function isSha256Digest(value: unknown): boolean {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function governanceMandateAuthoritySourceVersion(
    version: unknown,
    termsDigest: unknown,
): string | null {
    const normalizedVersion = Number(version);
    const normalizedDigest = String(termsDigest ?? '');
    if (!Number.isSafeInteger(normalizedVersion) || normalizedVersion <= 0
        || !isSha256Digest(normalizedDigest)) return null;
    return `v${normalizedVersion}:${normalizedDigest.slice(0, 48)}`;
}

function normalizeResponsibilityKind(value: unknown): GovernanceCaseResponsibilityKind {
    if (value === 'review' || value === 'execution' || value === 'outcome') return value;
    return 'coordinator';
}

function normalizeResponsibilityStatus(value: unknown): GovernanceCaseResponsibilityStatus {
    if (value === 'accepted' || value === 'declined' || value === 'escalated' || value === 'absent') {
        return value;
    }
    return 'assigned';
}

function normalizeGovernanceCaseType(value: unknown): GovernanceCase['caseType'] {
    if (
        value === 'signal'
        || value === 'policy'
        || value === 'public_asset'
        || value === 'program'
        || value === 'grant'
        || value === 'external_research'
    ) return value;
    return 'legacy_unclassified';
}

function normalizeGovernanceCaseTemplateSelection(value: any): GovernanceCaseTemplateSelection | null {
    if (!value || typeof value !== 'object') return null;
    return {
        templateId: String(value.templateId || ''),
        templateVersion: Number(value.templateVersion || 0),
        labelKey: String(value.labelKey || ''),
        readinessState: value.readinessState === 'ready'
            || value.readinessState === 'setup_required'
            || value.readinessState === 'degraded'
            ? value.readinessState
            : 'unavailable',
        profile: value.profile && typeof value.profile === 'object' ? {
            bindingId: String(value.profile.bindingId || ''),
            versionRef: String(value.profile.versionRef || ''),
            definitionDigest: String(value.profile.definitionDigest || ''),
        } : null,
        participationPolicy: normalizeGovernanceCaseParticipationPolicy(value.participationPolicy),
        conflictOfInterestPolicy: normalizeGovernanceCaseConflictPolicy(value.conflictOfInterestPolicy),
        actionContract: normalizeGovernanceCaseActionContract(value.actionContract),
        actionAuthority: normalizeGovernanceCaseActionAuthority(value.actionAuthority),
        institutionalResponsibility: normalizeGovernanceCaseInstitutionalResponsibility(
            value.institutionalResponsibility,
        ),
        decisionProvider: String(value.decisionProvider || ''),
        decisionMechanism: value.decisionMechanism?.kind === 'equal_weight_threshold'
            && value.decisionMechanism?.schemaId === 'alcheme.native.equal-weight-threshold'
            && value.decisionMechanism?.schemaVersion === 1
            && value.decisionMechanism?.resolverId === 'committee.member_threshold'
            && value.decisionMechanism?.resolverVersion === '1'
            && value.decisionMechanism?.provider === 'alcheme_internal'
            && value.decisionMechanism?.availability === 'available'
            ? {
                kind: 'equal_weight_threshold',
                schemaId: 'alcheme.native.equal-weight-threshold',
                schemaVersion: 1,
                resolverId: 'committee.member_threshold',
                resolverVersion: '1',
                provider: 'alcheme_internal',
                availability: 'available',
            }
            : value.decisionMechanism?.kind === 'quadratic_voice_credits'
                && value.decisionMechanism?.schemaId === 'alcheme.native.quadratic-voice-credits'
                && value.decisionMechanism?.schemaVersion === 1
                && value.decisionMechanism?.resolverId === 'native.quadratic_voice_credits'
                && value.decisionMechanism?.resolverVersion === '1'
                && value.decisionMechanism?.provider === 'alcheme_internal'
                && value.decisionMechanism?.availability === 'available'
                && Array.isArray(value.decisionMechanism?.choiceSet)
                ? {
                    kind: 'quadratic_voice_credits',
                    schemaId: 'alcheme.native.quadratic-voice-credits',
                    schemaVersion: 1,
                    resolverId: 'native.quadratic_voice_credits',
                    resolverVersion: '1',
                    provider: 'alcheme_internal',
                    availability: 'available',
                    choiceSet: value.decisionMechanism.choiceSet.map((choice: any) => ({
                        id: String(choice?.id || ''),
                        label: String(choice?.label || ''),
                    })),
                }
            : value.decisionMechanism?.kind === 'quadratic_funding'
                && value.decisionMechanism?.schemaId === 'alcheme.native.quadratic-funding'
                && value.decisionMechanism?.schemaVersion === 1
                && value.decisionMechanism?.resolverId === 'native.quadratic_funding'
                && value.decisionMechanism?.resolverVersion === '1'
                && value.decisionMechanism?.provider === 'alcheme_internal'
                && value.decisionMechanism?.availability === 'available'
                && value.decisionMechanism?.round?.formula === 'integer_sqrt_quadratic_matching'
                && Array.isArray(value.decisionMechanism?.round?.projects)
                ? {
                    kind: 'quadratic_funding',
                    schemaId: 'alcheme.native.quadratic-funding',
                    schemaVersion: 1,
                    resolverId: 'native.quadratic_funding',
                    resolverVersion: '1',
                    provider: 'alcheme_internal',
                    availability: 'available',
                    round: value.decisionMechanism.round,
                }
            : null,
        executionProvider: String(value.executionProvider || ''),
        sourceProvider: String(value.sourceProvider || ''),
        executionPreparation: String(value.executionPreparation || ''),
        reviewPolicy: normalizeGovernanceCaseReviewPolicy(value.reviewPolicy),
        outcomePolicy: normalizeGovernanceCaseOutcomePolicy(value.outcomePolicy),
        digest: value.digest ? String(value.digest) : null,
    };
}

function normalizeGovernanceCaseInstitutionalResponsibility(
    value: any,
): GovernanceCaseTemplateSelection['institutionalResponsibility'] {
    const sourceType = value?.sourceType;
    const sourceRef = String(value?.sourceRef || '').trim();
    const sourceVersion = String(value?.sourceVersion || '').trim();
    const caseHome = value?.caseHome;
    const decidingCircleHome = value?.decidingCircleHome;
    const governedSubject = value?.governedSubject;
    if (
        value?.schemaVersion !== 1
        || ![
            'governance_mandate',
            'governance_recovery_policy',
            'circle_governance_binding',
            'system_governance_role_binding',
        ].includes(sourceType)
        || !sourceRef
        || !sourceVersion
        || !String(caseHome?.type || '').trim()
        || !String(caseHome?.ref || '').trim()
        || decidingCircleHome?.type !== 'circle'
        || !/^[1-9]\d*$/.test(String(decidingCircleHome?.ref || ''))
        || !String(governedSubject?.type || '').trim()
        || !String(governedSubject?.ref || '').trim()
        || value?.decisionAuthority?.ref !== sourceRef
        || value?.decisionAuthority?.version !== sourceVersion
        || value?.workflowAssignmentAuthority !== 'none'
    ) return null;
    if (sourceType === 'governance_mandate') {
        const mandate = value?.mandate;
        if (
            value?.decisionAuthority?.type !== 'governance_committee'
            || value?.systemRole !== null
            || mandate?.id !== sourceRef
            || !Number.isSafeInteger(Number(mandate?.version))
            || Number(mandate.version) <= 0
            || !isSha256Digest(mandate?.termsDigest)
            || sourceVersion !== governanceMandateAuthoritySourceVersion(
                mandate.version,
                mandate.termsDigest,
            )
        ) return null;
    } else if (sourceType === 'governance_recovery_policy') {
        if (
            value?.decisionAuthority?.type !== 'recovery_circle'
            || value?.mandate !== null
            || value?.systemRole !== null
            || value?.recoveryPolicy?.id !== sourceRef
            || value?.recoveryPolicy?.trigger !== 'zero_eligible_electorate'
            || caseHome.type !== 'circle'
        ) return null;
    } else if (sourceType === 'circle_governance_binding') {
        if (
            value?.decisionAuthority?.type !== 'governance_committee'
            || value?.mandate !== null
            || value?.systemRole !== null
            || value?.recoveryPolicy != null
            || caseHome.type !== 'circle'
            || ![
                'circle_governance_binding',
                'external_provider',
                'external_app_circle_binding',
            ].includes(governedSubject.type)
        ) return null;
    } else {
        const systemRole = value?.systemRole;
        if (
            value?.decisionAuthority?.type !== 'system_governance_role'
            || value?.mandate !== null
            || systemRole?.domain !== 'external_app'
            || !String(systemRole?.roleKey || '').trim()
            || !['sandbox', 'production'].includes(systemRole?.environment)
            || caseHome.type !== 'external_app_system_role'
            || caseHome.ref !== `external_app:${systemRole.environment}`
        ) return null;
    }
    return value as GovernanceCaseTemplateSelection['institutionalResponsibility'];
}

function normalizeGovernanceCaseActionAuthority(
    value: any,
): GovernanceCaseTemplateSelection['actionAuthority'] {
    const minimumConstraints = normalizeGovernanceMandateMinimumConstraints(
        value?.minimumConstraints,
    );
    if (
        value?.schemaVersion !== 1
        || ![
            'governance_mandate',
            'governance_recovery_policy',
            'circle_governance_binding',
        ].includes(value?.sourceType)
        || value?.purpose !== 'collective_decision'
        || value?.environment !== 'local_development'
        || value?.network !== 'solana:localnet'
        || !String(value?.projectionBindingId || '')
        || !String(value?.sourceVersion || '')
        || value?.governanceHome?.type !== 'circle'
        || value?.committeeHome?.type !== 'circle'
        || ![
            'circle',
            'circle_governance_binding',
            'communication_room_member',
            'governed_operator_capability',
            'external_provider',
            'external_app_circle_binding',
        ].includes(value?.subject?.type)
        || !String(value?.subject?.ref || '')
        || !String(value?.profile?.bindingId || '')
        || !String(value?.profile?.versionRef || '')
        || !isSha256Digest(value?.profile?.definitionDigest)
        || !String(value?.authorityPolicyBinding?.id || '')
        || !isSha256Digest(value?.authorityPolicyBinding?.bindingDigest)
        || value?.authorityPolicyBinding?.sourceType !== value?.sourceType
        || value?.authorityPolicyBinding?.purpose !== 'collective_decision'
        || !isSha256Digest(value?.authorityPolicyBinding?.limitsDigest)
        || value?.operatorSelector?.mode !== 'not_applicable'
        || value?.operatorSelector?.reason !== 'collective_decision'
        || value?.executionAuthorityRequirement?.type !== 'registered_adapter'
        || !String(value?.executionAuthorityRequirement?.adapter || '')
        || value?.executionAuthorityRequirement?.liveReadback !== 'required_before_execution'
        || value?.executionAuthorityRequirement?.runtimeOwner !== 'P06'
        || !String(value?.action?.type || '')
        || !['low', 'medium', 'high', 'critical'].includes(value?.action?.riskFloor)
        || !minimumConstraints
        || !String(value?.policy?.id || '')
        || !String(value?.policy?.versionId || '')
        || !Number.isSafeInteger(Number(value?.policy?.version))
        || !String(value?.policy?.ruleId || '')
        || Number.isNaN(new Date(value?.effectiveFrom).getTime())
        || (
            value?.effectiveUntil !== null
            && Number.isNaN(new Date(value?.effectiveUntil).getTime())
        )
    ) return null;
    if (value.sourceType === 'governance_mandate') {
        if (
            !String(value.mandateId || '')
            || !Number.isSafeInteger(Number(value.mandateVersion))
            || Number(value.mandateVersion) <= 0
            || !isSha256Digest(value.mandateTermsDigest)
            || value.sourceVersion !== governanceMandateAuthoritySourceVersion(
                value.mandateVersion,
                value.mandateTermsDigest,
            )
            || value.authorityPolicyBinding.sourceRef !== value.mandateId
            || value.effectiveUntil === null
        ) return null;
    } else if (value.sourceType === 'governance_recovery_policy') {
        if (
            value.mandateId !== null
            || value.mandateVersion !== null
            || value.mandateTermsDigest !== null
            || !String(value.recoveryPolicy?.id || '')
            || value.recoveryPolicy?.trigger !== 'zero_eligible_electorate'
            || !isSha256Digest(value.recoveryPolicy?.actorSnapshotDigest)
            || value.recoveryPolicy?.maxCostMinor !== '0'
            || value.recoveryPolicy?.singleUse !== true
            || value.authorityPolicyBinding.sourceRef !== value.recoveryPolicy.id
            || value.effectiveUntil === null
        ) return null;
    } else if (
        value.mandateId !== null
        || value.mandateVersion !== null
        || value.mandateTermsDigest !== null
        || value.selfBinding?.bindingType !== 'self_governed'
        || value.selfBinding?.status !== 'active'
        || ![
            'circle_governance_binding',
            'external_provider',
            'external_app_circle_binding',
        ].includes(value.subject.type)
        || value.authorityPolicyBinding.sourceRef !== value.projectionBindingId
    ) return null;
    return {
        ...value,
        minimumConstraints,
    } as GovernanceCaseTemplateSelection['actionAuthority'];
}

function normalizeGovernanceCaseActionContract(
    value: any,
): NonNullable<GovernanceCaseTemplateSelection['actionContract']> | null {
    if (
        !value
        || typeof value !== 'object'
        || !['low', 'medium', 'high', 'critical'].includes(value.riskFloor)
        || !String(value.actionType || '').trim()
        || !String(value.contractVersionId || '').trim()
        || !/^[a-f0-9]{64}$/.test(String(value.definitionDigest || ''))
        || !String(value.executionAdapter || '').trim()
        || !String(value.executionDomain || '').trim()
    ) return null;
    return {
        actionType: String(value.actionType || ''),
        contractVersionId: String(value.contractVersionId || ''),
        definitionDigest: String(value.definitionDigest || ''),
        executionAdapter: String(value.executionAdapter || ''),
        executionDomain: String(value.executionDomain || ''),
        riskFloor: value.riskFloor,
    };
}

function normalizeGovernanceCaseOutcomePolicy(
    value: any,
): NonNullable<GovernanceCaseTemplateSelection['outcomePolicy']> | null {
    if (
        value?.closeSignoff !== 'accepted_outcome_reviewer'
        || value?.highImpactThreshold !== 'high'
        || value?.executorSeparation !== 'required'
    ) return null;
    return {
        closeSignoff: 'accepted_outcome_reviewer',
        highImpactThreshold: 'high',
        executorSeparation: 'required',
    };
}

function normalizeGovernanceCaseReviewPolicy(
    value: any,
): NonNullable<GovernanceCaseTemplateSelection['reviewPolicy']> | null {
    if (
        value?.reviewerReplacement !== 'manager_or_current_reviewer'
        || value?.appeal !== 'not_available'
        || value?.higherReviewGate !== 'review_responsibility_escalation'
    ) return null;
    return {
        reviewerReplacement: 'manager_or_current_reviewer',
        appeal: 'not_available',
        higherReviewGate: 'review_responsibility_escalation',
    };
}

function normalizeGovernanceCaseConflictPolicy(
    value: any,
): GovernanceCaseConflictOfInterestPolicy | null {
    if (
        value?.disclosure !== 'eligible_actor_self_disclosure'
        || value?.recusal !== 'required_on_disclosure'
        || value?.electorateEffect !== 'exclude_from_eligible_denominator'
        || value?.thresholdEffect !== 'evaluate_frozen_rule_against_remaining_electorate'
        || value?.alternate !== 'none'
        || value?.unreachable !== 'block_schedule'
        || value?.publicReason !== 'required'
        || value?.selfExemption !== 'forbidden'
    ) return null;
    return {
        disclosure: 'eligible_actor_self_disclosure',
        recusal: 'required_on_disclosure',
        electorateEffect: 'exclude_from_eligible_denominator',
        thresholdEffect: 'evaluate_frozen_rule_against_remaining_electorate',
        alternate: 'none',
        unreachable: 'block_schedule',
        publicReason: 'required',
        selfExemption: 'forbidden',
    };
}

function normalizeGovernanceCaseConflictReason(value: unknown): GovernanceCaseConflictReason | null {
    if (
        value === 'material_relationship'
        || value === 'financial_interest'
        || value === 'subject_or_recipient'
        || value === 'provider_or_operator_role'
        || value === 'other_public_conflict'
    ) return value;
    return null;
}

function normalizeGovernanceCaseParticipationPolicy(
    value: any,
): GovernanceCaseParticipationPolicy | null {
    if (
        value?.admission?.source !== 'circle_membership'
        || value?.admission?.grantsProposalRight !== false
        || value?.admission?.grantsVoteRight !== false
        || value?.proposalCreation?.source !== 'case_template_role_gate'
        || JSON.stringify(value?.proposalCreation?.eligibleRoles) !== JSON.stringify(['Owner', 'Admin', 'Moderator'])
        || value?.proposalCreation?.policyRequiresRegisteredAction !== true
        || value?.voterEligibility?.source !== 'frozen_governance_snapshot'
        || value?.voterEligibility?.electorate !== 'active_committee_members'
        || value?.voterEligibility?.roleGrantsExtraWeight !== false
        || (value?.votingPower?.mode !== 'equal_one'
            && value?.votingPower?.mode !== 'policy_voice_credit_budget')
        || value?.votingPower?.weightedVotingEnabled !== false
        || ['admission', 'proposal', 'voterEligibility', 'votingPower']
            .some((key) => value?.contribution?.[key] !== 'not_configured')
        || value?.correction?.source !== 'circle_membership_correction'
        || value?.correction?.appeal !== 'not_available'
    ) return null;
    return value as GovernanceCaseParticipationPolicy;
}

function normalizeGovernanceCaseOriginKind(value: unknown): GovernanceCase['originKind'] {
    if (
        value === 'legacy_request'
        || value === 'manual_item'
        || value === 'plaza_selection'
        || value === 'public_url'
        || value === 'external_proposal'
    ) {
        return value;
    }
    return 'native_invocation';
}

function normalizeGovernanceExecutionCompatibility(
    value: unknown,
): CircleGovernanceRequest['executionCompatibility'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const descriptor = value as Record<string, unknown>;
    const adapter = typeof descriptor.adapter === 'string' ? descriptor.adapter.trim() : '';
    const risk = descriptor.risk;
    if (
        descriptor.status !== 'legacy'
        || !adapter
        || (risk !== 'low' && risk !== 'medium' && risk !== 'high' && risk !== 'critical')
        || descriptor.migrationTarget !== 'stage_decision_only_execution_action'
    ) {
        return null;
    }
    return {
        status: 'legacy',
        adapter,
        risk,
        migrationTarget: 'stage_decision_only_execution_action',
    };
}

function normalizeBindingStatus(value: unknown): CircleGovernanceBindingStatus {
    const normalized = String(value || '').trim();
    if (
        normalized === 'active'
        || normalized === 'superseded'
        || normalized === 'deactivated'
        || normalized === 'rejected'
    ) {
        return normalized;
    }
    return 'pending_mandate';
}

function normalizeMandateStatus(value: unknown): 'pending' | 'accepted' | 'rejected' {
    const normalized = String(value || '').trim();
    if (normalized === 'accepted' || normalized === 'rejected') return normalized;
    return 'pending';
}

function normalizeRequestState(value: unknown): CircleGovernanceRequest['state'] {
    const normalized = String(value || '').trim();
    if (
        normalized === 'accepted'
        || normalized === 'rejected'
        || normalized === 'expired'
        || normalized === 'cancelled'
    ) {
        return normalized;
    }
    return 'active';
}

function normalizeDecisionStatus(
    value: unknown,
): CircleGovernanceRequest['decisionStatus'] {
    const normalized = String(value || '').trim();
    if (
        normalized === 'pending'
        || normalized === 'accepted'
        || normalized === 'rejected'
        || normalized === 'expired'
        || normalized === 'cancelled'
    ) {
        return normalized;
    }
    return 'unavailable';
}

function normalizeExecutionStatus(
    value: unknown,
): CircleGovernanceRequest['executionStatus'] {
    const normalized = String(value || '').trim();
    if (
        normalized === 'not_ready'
        || normalized === 'not_required'
        || normalized === 'pending'
        || normalized === 'executed'
        || normalized === 'expired'
        || normalized === 'failed'
        || normalized === 'skipped'
    ) {
        return normalized;
    }
    return 'unavailable';
}

const GOVERNANCE_LEGACY_MIGRATION_ACTIONS: GovernanceLegacyMigrationAction[] = [
    'execute_transfer',
    'propose_transfer',
    'submit_ai_evaluation',
    'update_decision_engine',
    'vote',
];
const GOVERNANCE_LEGACY_RECOVERY_REHEARSAL_SCENARIOS: GovernanceLegacyRecoveryRehearsalScenario[] = [
    'provider_outage',
    'indexer_lag',
    'partial_execution',
    'lost_key',
];

export function normalizeGovernanceLegacyMigrationReport(
    value: any,
    expectedCircleId: number,
): GovernanceLegacyMigrationReport {
    const state = value?.state;
    const historical = value?.historicalExecutionBoundary;
    const recoveryRehearsal = value?.recoveryRehearsal;
    const chainRecoveryBoundary = value?.chainRecoveryBoundary;
    const cutoverAction = value?.cutoverAction;
    const auditTimeline = value?.auditTimeline;
    const migrationReadiness = value?.migrationReadiness;
    const blockers = value?.blockers;
    const recoveryScenarios = Array.isArray(recoveryRehearsal?.scenarios)
        ? recoveryRehearsal.scenarios
        : [];
    const currentRecoveryFacts = Array.isArray(recoveryRehearsal?.currentFacts)
        ? recoveryRehearsal.currentFacts
        : [];
    const recoveryScenarioKeys = recoveryScenarios.map((entry: any) => entry?.scenario);
    const authorityMatrix = Array.isArray(value?.authorityMatrix) ? value.authorityMatrix : [];
    const matrixActions = authorityMatrix.map((entry: any) => entry?.actionType);
    if (
        !Number.isSafeInteger(expectedCircleId)
        || expectedCircleId <= 0
        || value?.circleId !== expectedCircleId
        || value?.network !== 'solana:localnet'
        || !isCanonicalGovernanceText(value?.compatibilityBundleId)
        || !isGovernanceDigest(value?.compatibilityBundleDigest)
        || !['compatibility_ready', 'cutover_active', 'recovery_required', 'rolled_back'].includes(state)
        || (value?.ownerLockIntent !== null
            && !isGovernanceLegacyOwnerLockIntent(value.ownerLockIntent, expectedCircleId))
        || (value?.migrationRecordRef !== null
            && !isCanonicalGovernanceText(value?.migrationRecordRef))
        || (value?.transactionSignature !== null
            && !isCanonicalGovernanceText(value?.transactionSignature))
        || authorityMatrix.length !== GOVERNANCE_LEGACY_MIGRATION_ACTIONS.length
        || new Set(matrixActions).size !== GOVERNANCE_LEGACY_MIGRATION_ACTIONS.length
        || GOVERNANCE_LEGACY_MIGRATION_ACTIONS.some((action) => !matrixActions.includes(action))
        || authorityMatrix.some((entry: any) => (
            !isGovernanceLegacyMigrationAction(entry?.actionType)
            || !isMigrationDisposition(entry?.before)
            || (entry?.after !== null && !isMigrationDisposition(entry?.after))
            || typeof entry?.programGuardLocked !== 'boolean'
        ))
        || !value?.inFlightDisposition
        || !Array.isArray(value.inFlightDisposition.governanceRequests)
        || !Array.isArray(value.inFlightDisposition.openTransferProposals)
        || !Array.isArray(value.inFlightDisposition.assetJobs)
        || !isMigrationActionArray(value?.residualBypass)
        || !Array.isArray(value?.rollbackEvidence)
        || value.rollbackEvidence.some((entry: any) => (
            !isGovernanceLegacyMigrationAction(entry?.actionType)
            || !isCanonicalGovernanceText(entry?.rollback)
        ))
        || historical?.policy !== 'preserve_original_disposition_never_automatic_reexecute'
        || (
            historical?.rollback !== 'pre_cutover_no_effect_history_remains_read_only'
            && historical?.rollback !== 'post_cutover_roll_forward_only_history_remains_read_only'
        )
        || !isGovernanceTextArray(historical?.governanceRequestRefs)
        || !isGovernanceTextArray(historical?.transferProposalRefs)
        || !isGovernanceTextArray(historical?.crystalAssetJobRefs)
        || !isGovernanceDigest(historical?.auditDigest)
        || recoveryRehearsal?.authority !== 'canonical_recovery_projections_and_migration_report'
        || recoveryRehearsal?.source !== 'canonical_provider_indexer_and_authority_health_owners'
        || recoveryRehearsal?.currentFactState !== (currentRecoveryFacts.length > 0
            ? 'active_recovery_facts'
            : 'no_active_recovery_fact')
        || currentRecoveryFacts.some((fact: any) => !isGovernanceLegacyMigrationRecoveryFact(fact))
        || new Set(currentRecoveryFacts.map((fact: any) => (
            `${fact.scenario}:${fact.caseId}:${fact.requestId}`
        ))).size !== currentRecoveryFacts.length
        || recoveryRehearsal?.observedCutoverState !== state
        || recoveryRehearsal?.historicalBoundary !== historical?.rollback
        || !isGovernanceDigest(recoveryRehearsal?.auditDigest)
        || recoveryScenarios.length !== GOVERNANCE_LEGACY_RECOVERY_REHEARSAL_SCENARIOS.length
        || new Set(recoveryScenarioKeys).size !== GOVERNANCE_LEGACY_RECOVERY_REHEARSAL_SCENARIOS.length
        || GOVERNANCE_LEGACY_RECOVERY_REHEARSAL_SCENARIOS.some((scenario) => !recoveryScenarioKeys.includes(scenario))
        || recoveryScenarios.some((entry: any) => !isGovernanceLegacyRecoveryRehearsalScenario(entry))
        || !isGovernanceLegacyChainRecoveryBoundary(
            chainRecoveryBoundary,
            state,
            historical?.rollback,
            historical?.policy,
        )
        || !isGovernanceTextArray(blockers)
        || (state === 'compatibility_ready'
            ? (
                value?.migrationRecordRef !== null
                || value?.transactionSignature !== null
                || historical?.rollback !== 'pre_cutover_no_effect_history_remains_read_only'
            )
            : (
                value?.ownerLockIntent !== null
                || !isCanonicalGovernanceText(value?.migrationRecordRef)
                || historical?.rollback !== 'post_cutover_roll_forward_only_history_remains_read_only'
            ))
        || !isGovernanceLegacyCutoverActionReadback(
            cutoverAction,
            state,
            value.compatibilityBundleId,
            value.compatibilityBundleDigest,
            historical.rollback,
            value.ownerLockIntent,
            blockers,
            currentRecoveryFacts.length,
        )
        || !isGovernanceLegacyMigrationAuditTimeline(
            auditTimeline,
            state,
            value.compatibilityBundleId,
            value.migrationRecordRef,
            historical.rollback,
        )
        || !isGovernanceLegacyMigrationReadiness(
            migrationReadiness,
            state,
            historical,
            authorityMatrix,
            value.residualBypass,
            blockers,
            currentRecoveryFacts.length,
        )
    ) {
        throw new Error('invalid_governance_legacy_migration_report');
    }
    return value as GovernanceLegacyMigrationReport;
}

function isGovernanceLegacyChainRecoveryBoundary(
    value: any,
    state: unknown,
    historicalBoundary: unknown,
    historicalPolicy: unknown,
): boolean {
    const hasCutoverEffect = state !== 'compatibility_ready';
    return value?.authority === 'canonical_program_readback_and_cutover_record'
        && value?.currentState === state
        && value?.historicalBoundary === historicalBoundary
        && value?.verifiedRollbackPath === (
            hasCutoverEffect
                ? 'not_available_after_program_guard_lock'
                : 'not_applicable_before_cutover_effect'
        )
        && value?.allowedRecovery === (
            hasCutoverEffect
                ? 'forward_upgrade_or_governed_recovery_only'
                : 'refresh_dry_run_or_cancel_without_program_effect'
        )
        && value?.databaseRollbackMayClaimChainRecovery === false
        && value?.confirmedTransactionSelfProvesRecovery === false
        && value?.normalizedReceiptSelfProvesRecovery === false
        && value?.historicalRecordPolicy === historicalPolicy
        && isGovernanceDigest(value?.auditDigest);
}

function isGovernanceLegacyMigrationReadiness(
    value: any,
    state: unknown,
    historical: any,
    authorityMatrix: any[],
    residualBypass: unknown,
    blockers: string[],
    activeRecoveryFacts: number,
): boolean {
    const metrics = value?.metrics;
    const redlines = value?.redlines;
    const programGuardsLocked = authorityMatrix.filter((entry) => entry?.programGuardLocked === true).length;
    const residualLegacyBypass = Array.isArray(residualBypass) ? residualBypass.length : -1;
    const blockingCompatibilityFacts = blockers.filter(
        (blocker) => blocker !== 'legacy_program_incomplete',
    ).length;
    const protectedHistoricalRecords = [
        historical?.governanceRequestRefs,
        historical?.transferProposalRefs,
        historical?.crystalAssetJobRefs,
    ].reduce((count, refs) => count + (Array.isArray(refs) ? refs.length : 0), 0);
    const programGuardLockComplete = programGuardsLocked === GOVERNANCE_LEGACY_MIGRATION_ACTIONS.length;
    const residualLegacyBypassZero = residualLegacyBypass === 0;
    const compatibilityBlockersCleared = blockingCompatibilityFacts === 0;
    const expectedStatus = state === 'recovery_required' || activeRecoveryFacts > 0
        ? 'recovery_required'
        : state === 'cutover_active'
            && programGuardLockComplete
            && residualLegacyBypassZero
            && compatibilityBlockersCleared
            ? 'ready'
            : 'not_ready';
    return value?.authority === 'canonical_migration_report'
        && value?.scope === 'existing_circle_action_cutover'
        && value?.currentState === state
        && value?.historicalBoundary === historical?.rollback
        && value?.status === expectedStatus
        && metrics?.actionsTotal === GOVERNANCE_LEGACY_MIGRATION_ACTIONS.length
        && metrics?.programGuardsLocked === programGuardsLocked
        && metrics?.residualLegacyBypass === residualLegacyBypass
        && metrics?.blockingCompatibilityFacts === blockingCompatibilityFacts
        && metrics?.protectedHistoricalRecords === protectedHistoricalRecords
        && metrics?.activeRecoveryFacts === activeRecoveryFacts
        && redlines?.programGuardLockComplete === programGuardLockComplete
        && redlines?.residualLegacyBypassZero === residualLegacyBypassZero
        && redlines?.compatibilityBlockersCleared === compatibilityBlockersCleared
        && redlines?.historicalAutomaticReexecutionForbidden === true
        && redlines?.activeRecoveryFactsClear === (activeRecoveryFacts === 0)
        && historical?.policy === 'preserve_original_disposition_never_automatic_reexecute'
        && isGovernanceDigest(value?.auditDigest);
}

function isGovernanceLegacyMigrationAuditTimeline(
    value: any,
    state: unknown,
    compatibilityBundleId: unknown,
    migrationRecordRef: unknown,
    historicalBoundary: unknown,
): boolean {
    const events = Array.isArray(value?.events) ? value.events : [];
    if (
        value?.authority !== 'canonical_compatibility_and_cutover_records'
        || value?.currentState !== state
        || value?.historicalBoundary !== historicalBoundary
        || !isGovernanceDigest(value?.auditDigest)
        || events.length < 1
        || events.length > 3
        || events.some((event: any) => (
            !Number.isFinite(Date.parse(String(event?.occurredAt ?? '')))
            || !isCanonicalGovernanceText(event?.recordRef)
        ))
        || events.some((event: any, index: number) => (
            index > 0 && Date.parse(event.occurredAt) < Date.parse(events[index - 1].occurredAt)
        ))
        || events[0]?.eventType !== 'compatibility_bundle_persisted'
        || events[0]?.state !== 'compatibility_ready'
        || events[0]?.recordRef !== compatibilityBundleId
    ) return false;
    if (state === 'compatibility_ready') return events.length === 1;
    if (
        !isCanonicalGovernanceText(migrationRecordRef)
        || events.length < 2
        || events[1]?.eventType !== 'program_cutover_verified'
        || events[1]?.state !== 'cutover_active'
        || events[1]?.recordRef !== migrationRecordRef
    ) return false;
    if (state === 'cutover_active') {
        return events.length === 2 || (
            events.length === 3
            && events[2]?.eventType === 'verified_readback_restored'
            && events[2]?.state === 'cutover_active'
            && events[2]?.recordRef === migrationRecordRef
        );
    }
    if (state === 'recovery_required') {
        return events.length === 3
            && events[2]?.eventType === 'recovery_required'
            && events[2]?.state === 'recovery_required'
            && events[2]?.recordRef === migrationRecordRef;
    }
    return state === 'rolled_back'
        && events.length === 3
        && events[2]?.eventType === 'future_routing_rolled_back'
        && events[2]?.state === 'rolled_back'
        && events[2]?.recordRef === migrationRecordRef;
}

function isGovernanceLegacyCutoverActionReadback(
    value: any,
    state: unknown,
    compatibilityBundleId: unknown,
    compatibilityBundleDigest: unknown,
    historicalBoundary: unknown,
    ownerLockIntent: unknown,
    blockers: string[],
    activeRecoveryFacts: number,
): boolean {
    if (
        value?.authority !== 'server_verified_migration_surface'
        || value?.compatibilityBundleId !== compatibilityBundleId
        || value?.compatibilityBundleDigest !== compatibilityBundleDigest
        || value?.cutoverState !== state
        || value?.historicalBoundary !== historicalBoundary
        || !isGovernanceDigest(value?.auditDigest)
        || typeof value?.walletSignatureAllowed !== 'boolean'
    ) return false;
    const hasBlockingCompatibilityFact = blockers.some(
        (blocker) => blocker !== 'legacy_program_incomplete',
    );
    if (value.status === 'wallet_signature_available') {
        return state === 'compatibility_ready'
            && ownerLockIntent !== null
            && activeRecoveryFacts === 0
            && !hasBlockingCompatibilityFact
            && value.walletSignatureAllowed === true
            && value.disabledReason === null
            && value.nextAction === 'owner_wallet_signature_then_server_verified_finalize';
    }
    if (value.status === 'blocked_by_compatibility_blockers') {
        return state === 'compatibility_ready'
            && ownerLockIntent === null
            && activeRecoveryFacts === 0
            && hasBlockingCompatibilityFact
            && value.walletSignatureAllowed === false
            && value.disabledReason === 'compatibility_blockers_present'
            && value.nextAction === 'resolve_compatibility_blockers_then_refresh_dry_run';
    }
    if (value.status === 'blocked_by_active_recovery') {
        return state === 'compatibility_ready'
            && ownerLockIntent === null
            && activeRecoveryFacts > 0
            && value.walletSignatureAllowed === false
            && value.disabledReason === 'active_recovery_facts_present'
            && value.nextAction === 'resolve_active_recovery_facts_then_refresh';
    }
    if (value.status === 'already_active') {
        return state === 'cutover_active'
            && ownerLockIntent === null
            && value.walletSignatureAllowed === false
            && value.disabledReason === 'cutover_already_verified'
            && value.nextAction === 'refresh_verified_readback_only';
    }
    if (value.status === 'recovery_readback_required') {
        return state === 'recovery_required'
            && ownerLockIntent === null
            && value.walletSignatureAllowed === false
            && value.disabledReason === 'cutover_recovery_required'
            && value.nextAction === 'restore_dependencies_then_verified_readback';
    }
    if (value.status === 'rolled_back_history_read_only') {
        return state === 'rolled_back'
            && ownerLockIntent === null
            && value.walletSignatureAllowed === false
            && value.disabledReason === 'future_routing_rolled_back_history_read_only'
            && value.nextAction === 'new_circle_or_program_upgrade_only';
    }
    return false;
}

function isGovernanceLegacyMigrationRecoveryFact(value: any): boolean {
    const authorityContinuity = value?.authorityContinuity;
    const authorityContinuityFieldsClear = authorityContinuity === null;
    if (
        !isCanonicalGovernanceText(value?.caseId)
        || !isCanonicalGovernanceText(value?.requestId)
        || (value?.provider !== null
            && !['realms_provider_binding', 'squads_provider_binding'].includes(value?.provider))
        || value?.acceptedDecisionPreserved !== true
        || (value?.observedAt !== null
            && !Number.isFinite(Date.parse(String(value?.observedAt ?? ''))))
        || (value?.receiptId !== null && !isCanonicalGovernanceText(value?.receiptId))
        || (value?.providerObservedSlot !== null
            && (!Number.isSafeInteger(value.providerObservedSlot) || value.providerObservedSlot <= 0))
        || !isGovernanceLegacyAuthorityDisposition(value?.authorityDisposition, value)
    ) return false;
    const authorityFaultFieldsClear = value.authorityBindingId === null
        && value.authorityEvidenceDigest === null
        && value.affectedActorPubkey === null
        && value.evidenceRef === null
        && value.freezeEndsAt === null
        && value.reviewDueAt === null
        && value.reviewStatus === null
        && authorityContinuityFieldsClear;
    if (value.scenario === 'provider_outage') {
        return value.authority === 'canonical_provider_receipt_and_reconciliation'
            && value.state === 'blocked'
            && value.blocker === 'provider_readback_outage'
            && value.recoveryAction === 'restore_readback_then_reconcile_same_receipt'
            && value.retryMode === 'blocked_until_recovery_fact'
            && value.indexedSlot === null
            && value.completedSteps === null
            && value.remainingSteps === null
            && authorityFaultFieldsClear;
    }
    if (value.scenario === 'indexer_lag') {
        return value.authority === 'canonical_provider_and_indexer_observation'
            && value.state === 'degraded'
            && value.blocker === 'indexer_lag_or_finality_gap'
            && value.recoveryAction === 'refresh_program_readback_then_rebuild_compatibility_bundle'
            && value.retryMode === 'same_request_only'
            && (value.indexedSlot === null
                || (Number.isSafeInteger(value.indexedSlot) && value.indexedSlot >= 0))
            && value.completedSteps === null
            && value.remainingSteps === null
            && authorityFaultFieldsClear;
    }
    if (value.scenario === 'partial_execution') {
        return value.authority === 'canonical_cost_preflight_provider_checkpoint'
            && value.state === 'partially_executed'
            && value.blocker === 'partial_execution_reconciliation_required'
            && value.recoveryAction === 'same_receipt_reconciliation_or_roll_forward_recovery'
            && value.retryMode === 'same_request_only'
            && value.indexedSlot === null
            && Number.isSafeInteger(value.completedSteps)
            && value.completedSteps > 0
            && Number.isSafeInteger(value.remainingSteps)
            && value.remainingSteps > 0
            && authorityFaultFieldsClear;
    }
    const freezeEndsAt = Date.parse(String(value?.freezeEndsAt ?? ''));
    const reviewDueAt = Date.parse(String(value?.reviewDueAt ?? ''));
    const observedAt = Date.parse(String(value?.observedAt ?? ''));
    return value.scenario === 'lost_key'
        && value.provider === null
        && value.authority === 'canonical_wallet_signed_authority_health_binding'
        && value.state === 'blocked'
        && value.blocker === 'authority_lost_key_high_risk_freeze'
        && value.recoveryAction === 'new_accepted_wallet_signed_health_case_without_fault'
        && value.retryMode === 'blocked_until_recovery_fact'
        && value.receiptId === null
        && value.providerObservedSlot === null
        && value.indexedSlot === null
        && value.completedSteps === null
        && value.remainingSteps === null
        && isCanonicalGovernanceText(value.authorityBindingId)
        && isGovernanceDigest(value.authorityEvidenceDigest)
        && isCanonicalGovernanceText(value.affectedActorPubkey)
        && isCanonicalGovernanceText(value.evidenceRef)
        && Number.isFinite(observedAt)
        && Number.isFinite(freezeEndsAt)
        && Number.isFinite(reviewDueAt)
        && observedAt <= freezeEndsAt
        && freezeEndsAt === reviewDueAt
        && ['required', 'overdue'].includes(value.reviewStatus)
        && isGovernanceLegacyAuthorityContinuityReadback(authorityContinuity, value.reviewStatus);
}

function isGovernanceLegacyAuthorityDisposition(value: any, fact: any): boolean {
    const accepted = value?.acceptedArtifact;
    const obligations = Array.isArray(value?.unfulfilledObligations) ? value.unfulfilledObligations : [];
    const risks = Array.isArray(value?.residualRisks) ? value.residualRisks : [];
    if (
        value?.authority !== 'canonical_provider_resource_authority_or_wallet_signed_health_readback'
        || value?.fallbackAuthority !== 'none'
        || value?.circleOwnerAdminFallbackAllowed !== false
        || !accepted
        || accepted.caseId !== fact?.caseId
        || accepted.requestId !== fact?.requestId
        || (accepted.receiptId !== null && accepted.receiptId !== fact?.receiptId)
        || (accepted.authorityBindingId !== null && accepted.authorityBindingId !== fact?.authorityBindingId)
        || obligations.length === 0
        || risks.length === 0
        || !isGovernanceTextArray(obligations)
        || !isGovernanceTextArray(risks)
    ) return false;
    if (fact?.scenario === 'provider_outage') {
        return value.providerReadback === 'authoritative_unavailable'
            && value.resourceAuthority === 'provider_authoritative_readback_required'
            && value.recoveryState === 'provider_recovery_required'
            && accepted.authorityBindingId === null;
    }
    if (fact?.scenario === 'indexer_lag') {
        return value.providerReadback === 'authoritative_degraded'
            && value.resourceAuthority === 'provider_authoritative_readback_required'
            && value.recoveryState === 'resource_authority_rotation_required'
            && accepted.authorityBindingId === null;
    }
    if (fact?.scenario === 'partial_execution') {
        return value.providerReadback === 'partial_finalized_checkpoint'
            && value.resourceAuthority === 'canonical_cost_preflight_provider_checkpoint'
            && value.recoveryState === 'partial_execution_reconciliation_required'
            && accepted.authorityBindingId === null;
    }
    if (fact?.scenario === 'lost_key') {
        const terminal = fact?.reviewStatus === 'overdue';
        return value.providerReadback === 'not_applicable_wallet_signer_fault'
            && value.resourceAuthority === 'wallet_signed_authority_health_binding'
            && value.recoveryState === (terminal
                ? 'permanently_blocked_external_authority'
                : 'resource_authority_rotation_required')
            && accepted.receiptId === null
            && accepted.authorityBindingId === fact?.authorityBindingId;
    }
    return false;
}

function isGovernanceLegacyAuthorityContinuityReadback(value: any, reviewStatus: unknown): boolean {
    const signerWaitExceeded = reviewStatus === 'overdue';
    return value?.policy === 'authority_health_emergency_freeze_continuity_policy'
        && value?.state === (signerWaitExceeded
            ? 'permanently_blocked_external_authority'
            : 'active_signer_wait')
        && value?.signerWaitExceeded === signerWaitExceeded
        && value?.providerNativeRotationAvailable === false
        && value?.circleOwnerAdminFallbackAllowed === false
        && value?.fallbackAuthority === 'none'
        && value?.requiredRecovery === 'new_accepted_wallet_signed_health_case_without_fault_or_external_reconstitution';
}

function isGovernanceLegacyRecoveryRehearsalScenario(value: any): boolean {
    return (
        (
            value?.scenario === 'provider_outage'
            && value?.blocker === 'provider_readback_outage'
            && value?.executionPolicy === 'block_new_execution_until_reconciled'
            && value?.recoveryAction === 'restore_readback_then_reconcile_same_receipt'
            && value?.retryMode === 'blocked_until_recovery_fact'
        )
        || (
            value?.scenario === 'indexer_lag'
            && value?.blocker === 'indexer_lag_or_finality_gap'
            && value?.executionPolicy === 'authoritative_program_readback_before_cutover'
            && value?.recoveryAction === 'refresh_program_readback_then_rebuild_compatibility_bundle'
            && value?.retryMode === 'same_request_only'
        )
        || (
            value?.scenario === 'partial_execution'
            && value?.blocker === 'partial_execution_reconciliation_required'
            && value?.executionPolicy === 'preserve_receipt_and_block_legacy_reexecution'
            && value?.recoveryAction === 'same_receipt_reconciliation_or_roll_forward_recovery'
            && value?.retryMode === 'same_request_only'
        )
        || (
            value?.scenario === 'lost_key'
            && value?.blocker === 'authority_lost_key_high_risk_freeze'
            && value?.executionPolicy === 'block_cutover_until_new_wallet_signed_health_case_and_review'
            && value?.recoveryAction === 'new_accepted_wallet_signed_health_case_without_fault'
            && value?.retryMode === 'blocked_until_recovery_fact'
        )
    ) && value?.acceptedDecisionPreserved === true;
}

function isGovernanceLegacyMigrationAction(value: unknown): value is GovernanceLegacyMigrationAction {
    return GOVERNANCE_LEGACY_MIGRATION_ACTIONS.includes(value as GovernanceLegacyMigrationAction);
}

function isMigrationActionArray(value: unknown): value is GovernanceLegacyMigrationAction[] {
    return Array.isArray(value)
        && new Set(value).size === value.length
        && value.every(isGovernanceLegacyMigrationAction);
}

function isMigrationDisposition(value: any): value is { disposition: string; rollback: string } {
    return value && typeof value === 'object'
        && isCanonicalGovernanceText(value.disposition)
        && isCanonicalGovernanceText(value.rollback);
}

function isGovernanceLegacyOwnerLockIntent(value: any, circleId: number): boolean {
    return value?.network === 'solana:localnet'
        && value?.circleId === circleId
        && isCanonicalGovernanceText(value?.circleAccountRef)
        && isCanonicalGovernanceText(value?.expectedOwnerPubkey)
        && isMigrationActionArray(value?.actions)
        && value.actions.length === GOVERNANCE_LEGACY_MIGRATION_ACTIONS.length
        && value?.actionMask === 31
        && isGovernanceDigest(value?.compatibilityBundleDigest)
        && isGovernanceDigest(value?.openProposalDispositionDigest);
}

function isGovernanceTextArray(value: unknown): value is string[] {
    return Array.isArray(value)
        && new Set(value).size === value.length
        && value.every(isCanonicalGovernanceText);
}

function isCanonicalGovernanceText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isGovernanceDigest(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
