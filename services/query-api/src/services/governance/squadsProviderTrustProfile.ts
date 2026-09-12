import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import profileDocument from './providerTrustProfiles/squads-solana-devnet-v1.json';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const publicKeySchema = z.string().superRefine((value, context) => {
  try {
    new PublicKey(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid_solana_public_key' });
  }
});
const identitySchema = z.object({
  policyName: z.string().regex(/^alcheme-squads-devnet-[a-z-]+$/),
  credentialRef: z.string().regex(/^macos-keychain:Alcheme Governance OS OpenBao Devnet\/squads-[a-z-]+-runtime-token$/),
  tokenPeriodSeconds: z.literal(86400),
}).strict();
const roleSchema = z.enum([
  'config_authority',
  'proposer_member',
  'approver_member',
  'executor_member',
  'fee_payer',
]);
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

const squadsProviderTrustProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileRef: z.literal('squads:solana:devnet:shared-v4'),
  version: z.literal(1),
  provider: z.literal('squads_v4'),
  readinessState: z.literal('ready'),
  riskMaturity: z.literal('stable'),
  chain: z.object({
    chainId: z.literal('solana:devnet'),
    cluster: z.literal('devnet'),
    genesisHash: publicKeySchema,
  }).strict(),
  deployment: z.object({
    programId: z.literal('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'),
    loaderProgramId: publicKeySchema,
    programDataAddress: publicKeySchema,
    upgradeAuthority: publicKeySchema,
    lastDeployedSlot: z.number().int().positive(),
    deployedProgramBytesSha256: sha256Schema,
    sourceReproducibility: z.literal('unverified'),
    observation: z.object({
      commitment: z.literal('finalized'),
      slot: z.number().int().positive(),
      observedAt: z.string().datetime(),
    }).strict(),
  }).strict(),
  programConfig: z.object({
    address: publicKeySchema,
    authority: publicKeySchema,
    treasury: publicKeySchema,
    multisigCreationFeeLamports: z.literal(0),
    verifiedFinalizedSlot: z.number().int().positive(),
  }).strict(),
  clientDecoder: z.object({
    packageName: z.literal('@sqds/multisig'),
    version: z.literal('2.1.4'),
    npmIntegrity: z.string().startsWith('sha512-'),
    gitHead: z.string().regex(/^[a-f0-9]{40}$/),
    idlSha256: sha256Schema,
    accountTypes: z.tuple([
      z.literal('Multisig'),
      z.literal('Proposal'),
      z.literal('VaultTransaction'),
    ]),
  }).strict(),
  decoderConformance: z.object({
    commitment: z.literal('finalized'),
    twoOfThree: z.object({
      observedAtSlot: z.number().int().positive(),
      multisig: publicKeySchema,
      proposal: publicKeySchema,
      vaultTransaction: publicKeySchema,
      vault: publicKeySchema,
      threshold: z.literal(2),
      memberCount: z.literal(3),
      proposalStatus: z.literal('Executed'),
    }).strict(),
    memo: z.object({
      observedAtSlot: z.number().int().positive(),
      multisig: publicKeySchema,
      proposal: publicKeySchema,
      vaultTransaction: publicKeySchema,
      vault: publicKeySchema,
      memoProgram: z.literal('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      proposalStatus: z.literal('Executed'),
    }).strict(),
  }).strict(),
  resourceContract: z.object({
    capability: z.literal('squads_multisig_vault'),
    contractVersion: z.literal(1),
    threshold: z.literal(2),
    memberCount: z.literal(3),
    timeLockSeconds: z.literal(0),
    vaultIndex: z.literal(0),
    memberPermissions: z.object({
      proposer_member: z.literal(3),
      approver_member: z.literal(2),
      executor_member: z.literal(4),
    }).strict(),
    effect: z.literal('vault_authority_no_asset_memo'),
    memoProgram: z.literal('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
    noRealAssets: z.literal(true),
  }).strict(),
  decisionPolicyMapping: decisionPolicyMappingSchema,
  readback: z.object({
    rpc: z.object({
      endpoint: z.string().url().startsWith('https://'),
      access: z.literal('public_no_credentials'),
      purpose: z.literal('provider_execution_and_authoritative_readback'),
    }).strict(),
    commitment: z.literal('finalized'),
    timeoutMs: z.literal(12000),
    maximumAttempts: z.literal(5),
    backoffSeconds: z.tuple([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
    slotConvergenceWindow: z.literal(32),
    resubmitPolicy: z.literal('never_automatic'),
  }).strict(),
  reconciliationPolicy: reconciliationPolicySchema,
  payerPolicy: z.object({
    fundingSource: z.literal('solana_devnet_faucet_only'),
    singleTransactionLimitLamports: z.literal(50000000),
    totalVerticalLimitLamports: z.literal(500000000),
    maximumWalletBalanceLamports: z.literal(1000000000),
    refundRequiresSeparateApproval: z.literal(true),
  }).strict(),
  keyCustodyRecord: z.object({
    schemaVersion: z.literal(1),
    recordRef: z.literal('squads-devnet-key-custody:v1'),
    decisionRef: z.literal('DEC-P06-M4-SQUADS-DEVNET-ONLY-v1'),
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
      keyRef: z.string().regex(/^alcheme-squads-devnet-[a-z-]+-v1$/),
      role: roleSchema,
      allowedOperations: z.array(z.string().min(1)).nonempty(),
      permissionMask: z.number().int().min(1).max(7).nullable(),
      applicationIdentity: identitySchema,
      publicKey: publicKeySchema.nullable(),
      status: z.literal('pending_generation'),
    }).strict()).length(5).superRefine((contracts, context) => {
      if (new Set(contracts.map((contract) => contract.role)).size !== contracts.length) {
        context.addIssue({ code: 'custom', message: 'duplicate_openbao_key_contract_role' });
      }
      if (new Set(contracts.map((contract) => contract.keyRef)).size !== contracts.length) {
        context.addIssue({ code: 'custom', message: 'duplicate_openbao_key_contract_ref' });
      }
    }),
    keyAlgorithm: z.literal('ed25519'),
    derived: z.literal(false),
    exportable: z.literal(false),
    allowPlaintextBackup: z.literal(false),
    managementApplicationIdentitySeparation: z.literal('required'),
    runtimeLocations: z.literal('config_raft_snapshot_recovery_outside_git_and_agent_temporary_directories'),
    operatorRunbookRef: z.literal('docs/ops/governance-openbao-custody-runbook.zh-CN.md'),
    primaryMaintainer: z.literal('Taiyi'),
    recoveryOwner: z.literal('Taiyi'),
    samePersonRecoveryException: z.literal(true),
    inventoryOwner: z.literal('payer_policy_and_resource_authority_binding'),
    fundingSource: z.literal('solana_devnet_faucet_only'),
    lossProcedure: z.literal('fail_closed_rebootstrap_devnet_environment_no_owner_operator_fallback'),
    status: z.literal('verified_pre_wallet_pending_runtime_owner'),
  }).strict(),
  environmentBoundary: z.object({
    activationScope: z.literal('circle_capability_contract_profile_version'),
    inPlaceClusterSwitch: z.literal('forbidden'),
    openCaseProfileSwitch: z.literal('forbidden'),
    mainnet: z.literal('unavailable'),
  }).strict(),
}).strict();

export type SquadsProviderTrustProfile = z.infer<typeof squadsProviderTrustProfileSchema>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const parsedProfile = deepFreeze(squadsProviderTrustProfileSchema.parse(profileDocument));
const profileDigest = hashCanonicalGovernanceValue(
  'alcheme.governance.provider-trust-profile',
  parsedProfile,
);

export function getSquadsProviderTrustProfile(): Readonly<SquadsProviderTrustProfile> {
  return parsedProfile;
}

export function resolveSquadsDecisionPolicyActivationGate(
  mapping: DecisionPolicyMapping,
) {
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
    state: blockers.length > 0 ? 'blocked' as const : 'ready' as const,
    activationAllowed: blockers.length === 0,
    blockers,
  };
}

export function resolveSquadsProviderTrustReadiness() {
  const decisionPolicyActivationGate = resolveSquadsDecisionPolicyActivationGate(
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
    sourceReproducibility: parsedProfile.deployment.sourceReproducibility,
    deploymentVerification: 'snapshot_verified_read_only' as const,
    decoderConformance: 'real_account_graphs_verified' as const,
    decisionPolicyMapping: parsedProfile.decisionPolicyMapping,
    decisionPolicyActivationGate,
    activation: 'not_activated' as const,
    walletCustody: parsedProfile.keyCustodyRecord.status,
    keyCustodyRecord: parsedProfile.keyCustodyRecord,
    devnetExecutionScope: 'approved' as const,
    authorizationDecisionRef: parsedProfile.keyCustodyRecord.decisionRef,
    mainnet: parsedProfile.environmentBoundary.mainnet,
    blockerCodes: [
      'squads_governed_resource_binding_required',
      'squads_openbao_wallet_keys_required',
      ...decisionPolicyActivationGate.blockers.map((blocker) =>
        `squads_decision_policy_${String(blocker.policy)}_${blocker.status}_blocks_activation`),
    ],
  };
}
