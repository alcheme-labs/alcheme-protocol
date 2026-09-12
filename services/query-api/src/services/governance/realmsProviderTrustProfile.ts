import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import profileDocument from './providerTrustProfiles/realms-solana-devnet-v1.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const publicKeySchema = z.string().superRefine((value, context) => {
  try {
    new PublicKey(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid_solana_public_key' });
  }
});
const decisionPolicyMappingEntrySchema = z.object({
  status: z.enum(['exact', 'stricter', 'weaker', 'not_representable', 'not_applicable']),
  providerPolicy: z.string().min(1),
  activationGate: z.enum(['ready', 'blocked', 'not_applicable']),
  authorityImpact: z.boolean(),
  reason: z.string().min(1),
}).strict().superRefine((entry, context) => {
  if (entry.status === 'not_applicable') {
    if (entry.activationGate !== 'not_applicable') {
      context.addIssue({ code: 'custom', message: 'provider_decision_policy_not_applicable_gate_invalid' });
    }
    return;
  }
  if (entry.activationGate === 'not_applicable') {
    context.addIssue({ code: 'custom', message: 'provider_decision_policy_applicable_gate_required' });
  }
  if (entry.authorityImpact && ['weaker', 'not_representable'].includes(entry.status)
    && entry.activationGate !== 'blocked') {
    context.addIssue({ code: 'custom', message: 'provider_decision_policy_authority_gap_must_block_activation' });
  }
});
const decisionPolicyMappingSchema = z.object({
  admission: decisionPolicyMappingEntrySchema,
  proposalCreation: decisionPolicyMappingEntrySchema,
  voterEligibility: decisionPolicyMappingEntrySchema,
  votingPower: decisionPolicyMappingEntrySchema,
  executionAuthority: decisionPolicyMappingEntrySchema,
  signerSetAsVoterPolicy: decisionPolicyMappingEntrySchema,
}).strict();
type DecisionPolicyMapping = z.infer<typeof decisionPolicyMappingSchema>;

const reconciliationPolicySchema = z.object({
  schemaVersion: z.literal(1),
  authorityRef: z.literal('provider_trust_profile_reconciliation_policy'),
  reconciliationAuthorityRef: z.literal('independent_provider_readback'),
  decisionAuthorityRef: z.string().min(1),
  conflictRule: z.literal('questioned_provider_program_decoder_cannot_adjudicate_itself'),
  fallbackMechanism: z.object({
    mode: z.literal('manual_recovery_only'),
    independentFallbackProviderRef: z.null(),
    activation: z.literal('fail_closed_when_independent_fallback_absent'),
    operatorMaySelectProvider: z.literal(false),
    questionedProviderMayAdjudicate: z.literal(false),
  }).strict(),
  superseding: z.object({
    artifactOwner: z.literal('DecisionOutputArtifact'),
    receiptOwner: z.literal('GovernanceExecutionReceipt'),
    materialChangeGate: z.literal('new_decision_stage_or_superseding_case'),
    required: z.literal(true),
  }).strict(),
}).strict();

const realmsProviderTrustProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileRef: z.string().min(1),
  version: z.number().int().positive(),
  provider: z.literal('realms'),
  readinessState: z.literal('ready'),
  riskMaturity: z.literal('stable'),
  chain: z.object({
    chainId: z.literal('solana:devnet'),
    cluster: z.literal('devnet'),
    genesisHash: publicKeySchema,
  }).strict(),
  deployment: z.object({
    programId: publicKeySchema,
    loaderProgramId: publicKeySchema,
    programDataAddress: publicKeySchema,
    upgradeAuthority: publicKeySchema,
    lastDeployedSlot: z.number().int().nonnegative(),
    deployedProgramBytesLength: z.number().int().positive(),
    deployedProgramBytesSha256: sha256Schema,
    observation: z.object({
      commitment: z.literal('finalized'),
      slot: z.number().int().positive(),
      observedAt: z.string().datetime(),
    }).strict(),
  }).strict(),
  clientDecoder: z.object({
    packageName: z.literal('@solana/spl-governance'),
    version: z.literal('0.3.28'),
    npmShasum: z.string().regex(/^[a-f0-9]{40}$/),
    npmIntegrity: z.string().startsWith('sha512-'),
    tarballSha256: sha256Schema,
    gitHead: z.string().regex(/^[a-f0-9]{40}$/),
    publishedManifestSha256: sha256Schema,
    accountTypes: z.tuple([
      z.literal('Realm'),
      z.literal('RealmConfigAccount'),
      z.literal('Governance'),
      z.literal('Proposal'),
      z.literal('ProposalTransaction'),
      z.literal('TokenOwnerRecord'),
      z.literal('VoteRecord'),
    ]),
  }).strict(),
  accountGraph: z.object({
    mode: z.literal('standard_token_weight_no_addins'),
    voterWeightAddin: z.null(),
    maxVoterWeightAddin: z.null(),
    customPlugins: z.literal('unavailable'),
  }).strict(),
  decisionPolicyMapping: decisionPolicyMappingSchema,
  decoderConformance: z.object({
    observedAtSlot: z.number().int().positive(),
    commitment: z.literal('finalized'),
    accounts: z.object({
      realm: z.object({
        address: publicKeySchema,
        ownerProgram: publicKeySchema,
        dataLength: z.number().int().positive(),
        dataSha256: sha256Schema,
        expected: z.object({
          name: z.string().min(1),
          communityMint: publicKeySchema,
          authority: publicKeySchema,
          realmConfig: z.literal('not_present'),
        }).strict(),
      }).strict(),
      governance: z.object({
        address: publicKeySchema,
        ownerProgram: publicKeySchema,
        dataLength: z.number().int().positive(),
        dataSha256: sha256Schema,
        expected: z.object({
          realm: publicKeySchema,
          governedAccount: publicKeySchema,
          proposalCount: z.number().int().nonnegative(),
        }).strict(),
      }).strict(),
    }).strict(),
  }).strict(),
  readback: z.object({
    rpc: z.object({
      endpoint: z.string().url().startsWith('https://'),
      access: z.literal('public_no_credentials'),
      purpose: z.literal('provider_execution_and_authoritative_readback'),
    }).strict(),
    commitment: z.literal('finalized'),
    timeoutMs: z.literal(12000),
    maximumAttempts: z.literal(5),
    backoffSeconds: z.tuple([
      z.literal(1),
      z.literal(2),
      z.literal(4),
      z.literal(8),
      z.literal(16),
    ]),
    slotConvergenceWindow: z.literal(32),
    resubmitPolicy: z.literal('never_automatic'),
  }).strict(),
  reconciliationPolicy: reconciliationPolicySchema,
  keyCustodyRecord: z.object({
    schemaVersion: z.literal(1),
    recordRef: z.literal('realms-devnet-key-custody:v1'),
    decisionRef: z.literal('DEC-P06-M3-SOLO-DEVNET-CUSTODY-v1'),
    approvedAt: z.string().datetime(),
    scope: z.literal('solana:devnet_no_real_assets'),
    signerProvider: z.literal('openbao_transit'),
    serviceTopology: z.literal('local_single_node_integrated_raft'),
    endpoint: z.literal('https://127.0.0.1:18200'),
    networkExposure: z.literal('localhost_only'),
    tls: z.object({
      serverName: z.literal('localhost'),
      minimumVersion: z.literal('tls13'),
      trustAnchorRef: z.literal('openbao-realms-devnet-local-server-crt'),
      certificateSha256: sha256Schema,
      notBefore: z.string().datetime(),
      notAfter: z.string().datetime(),
    }).strict(),
    transitMount: z.literal('transit'),
    keyContracts: z.array(z.object({
      keyRef: z.string().regex(/^alcheme-realms-devnet-[a-z-]+-v1$/),
      role: z.enum(['bootstrap_authority', 'proposer', 'voter', 'executor', 'fee_payer']),
      allowedOperations: z.array(z.string().min(1)).nonempty(),
      publicKey: publicKeySchema.nullable(),
      status: z.literal('pending_generation'),
    }).strict()).length(5).superRefine((contracts, context) => {
      const roles = new Set(contracts.map((contract) => contract.role));
      const refs = new Set(contracts.map((contract) => contract.keyRef));
      if (roles.size !== contracts.length) {
        context.addIssue({ code: 'custom', message: 'duplicate_openbao_key_contract_role' });
      }
      if (refs.size !== contracts.length) {
        context.addIssue({ code: 'custom', message: 'duplicate_openbao_key_contract_ref' });
      }
    }),
    keyAlgorithm: z.literal('ed25519'),
    derived: z.literal(false),
    exportable: z.literal(false),
    allowPlaintextBackup: z.literal(false),
    applicationAccess: z.literal('exact_key_sign_and_read_only'),
    managementApplicationIdentitySeparation: z.literal('required'),
    runtimeLocations: z.literal('config_raft_snapshot_recovery_outside_git_and_agent_temporary_directories'),
    operatorRunbookRef: z.literal('docs/ops/governance-openbao-custody-runbook.zh-CN.md'),
    recoveryMaterial: z.object({
      provider: z.literal('keepassxc'),
      purpose: z.literal('openbao_unseal_and_recovery_material_only'),
      databaseName: z.literal('Alcheme Devnet Governance.kdbx'),
      primaryLocationPolicy: z.literal('outside_git_repository_and_agent_temporary_directories'),
      encryptedBackup: z.literal('required_independent_location'),
      accessMode: z.literal('interactive_keepassxc_cli'),
    }).strict(),
    verification: z.object({
      raftPersistence: z.literal('verified'),
      restartSealUnseal: z.literal('verified'),
      tlsLocalhost: z.literal('verified'),
      auditReadback: z.literal('verified'),
      backupRestore: z.literal('verified'),
      leastPrivilegeDenial: z.literal('verified'),
      solanaCanonicalMessageConformance: z.literal('verified'),
      runtimeOwnerReadback: z.literal('pending'),
      receipt: z.object({
        openBaoVersion: z.literal('2.6.0'),
        raftNodeId: z.literal('alcheme-realms-devnet-1'),
        clusterId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/),
        snapshotSha256: sha256Schema,
        snapshotBytes: z.number().int().positive(),
        snapshotPrimaryRef: z.literal('openbao_devnet_external_snapshot_primary'),
        snapshotIndependentBackupRef: z.literal('alcheme_devnet_governance_encrypted_snapshot_copy'),
        originalUnsealVerifiedAt: z.string().datetime(),
        isolatedRestoreVerifiedAt: z.string().datetime(),
      }).strict(),
    }).strict(),
    primaryMaintainer: z.literal('Taiyi'),
    recoveryOwner: z.literal('Taiyi'),
    samePersonRecoveryException: z.literal(true),
    inventoryOwner: z.literal('payer_policy_and_resource_authority_binding'),
    secretMaterial: z.literal('openbao_sealed_storage_only_never_exported_to_application_git_business_database_log_evidence_chat_command_output_or_plaintext_file'),
    fundingSource: z.literal('solana_devnet_faucet_only'),
    walletSpecificCapRequiredBeforeFunding: z.literal(true),
    feePayerAuthoritySeparation: z.literal('required'),
    rotationProcedure: z.string().min(1),
    lossProcedure: z.literal('fail_closed_rebootstrap_devnet_environment_no_owner_operator_fallback'),
    incidentProcedure: z.string().min(1),
    retirementProcedure: z.string().min(1),
    environmentRetention: z.literal('repeatable_bootstrap_with_explicit_retirement_evidence'),
    status: z.literal('verified_pre_wallet_pending_runtime_owner'),
    createdAt: z.string().datetime(),
    lastVerifiedAt: z.string().datetime(),
  }).strict(),
  environmentBoundary: z.object({
    activationScope: z.literal('circle_capability_contract_profile_version'),
    inPlaceClusterSwitch: z.literal('forbidden'),
    openCaseProfileSwitch: z.literal('forbidden'),
    mainnet: z.literal('unavailable'),
  }).strict(),
}).strict();

export type RealmsProviderTrustProfile = z.infer<typeof realmsProviderTrustProfileSchema>;

export interface RealmsProviderTrustReadiness {
  profileRef: string;
  profileVersion: number;
  profileDigest: string;
  chainId: 'solana:devnet';
  programId: string;
  readinessState: 'ready';
  riskMaturity: 'stable';
  deploymentVerification: 'snapshot_verified_read_only';
  observedAtSlot: number;
  activationReadback: 'required';
  decoderConformance: 'selected_accounts_verified';
  decisionPolicyMapping: DecisionPolicyMapping;
  decisionPolicyActivationGate: {
    state: 'ready' | 'blocked';
    activationAllowed: boolean;
    blockers: Array<{
      policy: keyof DecisionPolicyMapping;
      status: 'weaker' | 'not_representable';
      activationGate: 'blocked';
    }>;
  };
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
    tls: {
      serverName: 'localhost';
      minimumVersion: 'tls13';
      trustAnchorRef: 'openbao-realms-devnet-local-server-crt';
      certificateSha256: string;
      notBefore: string;
      notAfter: string;
    };
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
}

const accountTypesByKind = {
  realm: new Set([1, 16]),
  governance: new Set([3, 4, 9, 10, 18, 19, 20, 21]),
} as const;

export function assertRealmsAccountDataType(
  kind: keyof typeof accountTypesByKind,
  data: Uint8Array,
): void {
  const accountType = data[0];
  if (!Number.isInteger(accountType) || !accountTypesByKind[kind].has(accountType)) {
    throw new Error(`realms_${kind}_account_type_mismatch`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const parsedProfile = deepFreeze(realmsProviderTrustProfileSchema.parse(profileDocument));
const profileDigest = hashCanonicalGovernanceValue(
  'alcheme.governance.provider-trust-profile',
  parsedProfile,
);

export function getRealmsProviderTrustProfile(): Readonly<RealmsProviderTrustProfile> {
  return parsedProfile;
}

export function resolveRealmsDecisionPolicyActivationGate(
  mapping: DecisionPolicyMapping,
): RealmsProviderTrustReadiness['decisionPolicyActivationGate'] {
  const blockers = (Object.entries(mapping) as Array<[keyof DecisionPolicyMapping, DecisionPolicyMapping[keyof DecisionPolicyMapping]]>)
    .flatMap(([policy, entry]) => (
      entry.authorityImpact
      && (entry.status === 'weaker' || entry.status === 'not_representable')
        ? [{
            policy,
            status: entry.status,
            activationGate: 'blocked' as const,
          }]
        : []
    ));
  return {
    state: blockers.length > 0 ? 'blocked' : 'ready',
    activationAllowed: blockers.length === 0,
    blockers,
  };
}

export function resolveRealmsProviderTrustReadiness(): RealmsProviderTrustReadiness {
  const decisionPolicyActivationGate = resolveRealmsDecisionPolicyActivationGate(
    parsedProfile.decisionPolicyMapping,
  );
  return {
    profileRef: parsedProfile.profileRef,
    profileVersion: parsedProfile.version,
    profileDigest,
    chainId: parsedProfile.chain.chainId,
    programId: parsedProfile.deployment.programId,
    readinessState: parsedProfile.readinessState,
    riskMaturity: parsedProfile.riskMaturity,
    deploymentVerification: 'snapshot_verified_read_only',
    observedAtSlot: parsedProfile.deployment.observation.slot,
    activationReadback: 'required',
    decoderConformance: 'selected_accounts_verified',
    decisionPolicyMapping: parsedProfile.decisionPolicyMapping,
    decisionPolicyActivationGate,
    activation: 'not_activated',
    walletCustody: parsedProfile.keyCustodyRecord.status,
    keyCustodyRecord: {
      recordRef: parsedProfile.keyCustodyRecord.recordRef,
      decisionRef: parsedProfile.keyCustodyRecord.decisionRef,
      signerProvider: parsedProfile.keyCustodyRecord.signerProvider,
      serviceTopology: parsedProfile.keyCustodyRecord.serviceTopology,
      endpoint: parsedProfile.keyCustodyRecord.endpoint,
      networkExposure: parsedProfile.keyCustodyRecord.networkExposure,
      tls: parsedProfile.keyCustodyRecord.tls,
      transitMount: parsedProfile.keyCustodyRecord.transitMount,
      keyContracts: parsedProfile.keyCustodyRecord.keyContracts.map((contract) => ({
        keyRef: contract.keyRef,
        role: contract.role,
        allowedOperations: [...contract.allowedOperations],
        publicKey: contract.publicKey,
        status: contract.status,
      })),
      keyAlgorithm: parsedProfile.keyCustodyRecord.keyAlgorithm,
      exportable: parsedProfile.keyCustodyRecord.exportable,
      allowPlaintextBackup: parsedProfile.keyCustodyRecord.allowPlaintextBackup,
      applicationAccess: parsedProfile.keyCustodyRecord.applicationAccess,
      recoveryMaterial: {
        provider: parsedProfile.keyCustodyRecord.recoveryMaterial.provider,
        purpose: parsedProfile.keyCustodyRecord.recoveryMaterial.purpose,
        databaseName: parsedProfile.keyCustodyRecord.recoveryMaterial.databaseName,
        encryptedBackup: parsedProfile.keyCustodyRecord.recoveryMaterial.encryptedBackup,
      },
      verification: parsedProfile.keyCustodyRecord.verification,
      primaryMaintainer: parsedProfile.keyCustodyRecord.primaryMaintainer,
      recoveryOwner: parsedProfile.keyCustodyRecord.recoveryOwner,
      samePersonRecoveryException: parsedProfile.keyCustodyRecord.samePersonRecoveryException,
      inventoryOwner: parsedProfile.keyCustodyRecord.inventoryOwner,
      fundingSource: parsedProfile.keyCustodyRecord.fundingSource,
      feePayerAuthoritySeparation: parsedProfile.keyCustodyRecord.feePayerAuthoritySeparation,
      lossProcedure: parsedProfile.keyCustodyRecord.lossProcedure,
      environmentRetention: parsedProfile.keyCustodyRecord.environmentRetention,
      status: parsedProfile.keyCustodyRecord.status,
      lastVerifiedAt: parsedProfile.keyCustodyRecord.lastVerifiedAt,
    },
    devnetExecutionScope: 'approved',
    authorizationDecisionRef: 'DEC-P06-M3-REALMS-DEVNET-ONLY-v1',
    mainnet: parsedProfile.environmentBoundary.mainnet,
    blockerCodes: [
      'realms_key_custody_runtime_owner_readback_required',
      'realms_resource_binding_not_configured',
      'realms_authority_binding_not_configured',
      'realms_payer_policy_not_configured',
      'realms_circle_activation_not_configured',
      ...decisionPolicyActivationGate.blockers.map((blocker) =>
        `realms_decision_policy_${String(blocker.policy)}_${blocker.status}_blocks_activation`),
    ],
  };
}
