import type { Prisma, PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';

import {
  REALMS_EMERGENCY_ONCHAIN_PAUSE_ACTION_TYPE,
  REALMS_EMERGENCY_ONCHAIN_UNPAUSE_ACTION_TYPE,
  REALMS_PROGRAM_UPGRADE_ACTION_TYPE,
  REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
  REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
  REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
  REALMS_PROVIDER_DISABLE_ACTION_TYPE,
  REALMS_PROVIDER_RESTORE_ACTION_TYPE,
  REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE,
} from './actionRegistry';
import {
  applyEmergencyOnchainUnpause,
  buildEmergencyOnchainPauseRecord,
  normalizeEmergencyOnchainPauseRecord,
  normalizeEmergencyOnchainPauseTarget,
  readIndependentEmergencyOnchainPauseEvidence,
  type EmergencyOnchainPauseEnforcement,
} from './governanceEmergencyOnchainPause';
import {
  buildProgramUpgradeContract,
  buildProgramUpgradeRecord,
  normalizeProgramUpgradeRecord,
  readIndependentProgramUpgradeObservation,
  type ProgramUpgradeAuthorityDisposition,
} from './governanceProgramUpgrade';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  getRealmsProviderTrustProfile,
  resolveRealmsProviderTrustReadiness,
} from './realmsProviderTrustProfile';
import { verifyRealmsProviderTrustProfileReadback } from './realmsProviderTrustReadback';
import {
  createRealmsDevnetConnection,
  executeRealmsDevnetBootstrap,
  executeRealmsDevnetDelegationConformance,
  isCurrentRealmsVotingPowerSecurityProfile,
  readRealmsDevnetAccountGraph,
  readRealmsDevnetDelegationState,
  validRealmsDevnetBootstrapCheckpoint,
  validRealmsDevnetDelegationCheckpoint,
  type RealmsDevnetAccountGraphReadback,
  type RealmsDevnetBootstrapCheckpoint,
  type RealmsDevnetBootstrapContract,
  type RealmsDevnetBootstrapProviderReceipt,
  type RealmsDevnetDelegationCheckpoint,
  type RealmsDevnetDelegationContract,
  type RealmsDevnetDelegationProviderReceipt,
  type RealmsVotingPowerSecurityProfile,
} from './realmsDevnetProvider';
import { buildProviderTransactionAttemptInventory } from './providerTransactionAttempt';
import { validRealmsProviderFinalityTransitions } from './realmsProviderFinality';
import { signRealmsOpenBaoCanonicalMessage } from './realmsOpenBaoRuntimeReadback';
import type {
  GovernanceActionExecutionOutcome,
  GovernanceExecutableRequest,
  GovernanceRequestExecutionSource,
} from './requestExecution';
import { isCurrentGovernanceCaseFrozenEvidencePolicy } from './governanceEvidenceShare';
import { resolveProviderExecutionAuthorityHealthPreflight } from './providerExecutionAuthorityHealthPreflight';
import { resolveGovernanceFundingAmendmentRetryPreflight } from './governanceFundingAmendment';

const REALMS_PROVIDER_BINDING_CONTRACT_VERSION = 1;
const REALMS_BOOTSTRAP_SINGLE_TRANSACTION_LIMIT_LAMPORTS = '50000000';
const REALMS_BOOTSTRAP_TOTAL_LIMIT_LAMPORTS = '250000000';
const REALMS_BOOTSTRAP_MAXIMUM_BALANCE_LAMPORTS = '500000000';
const REALMS_DELEGATION_SINGLE_TRANSACTION_LIMIT_LAMPORTS = '50000';
const REALMS_DELEGATION_TOTAL_LIMIT_LAMPORTS = '100000';

export function buildRealmsProviderRequestIdempotencyKey(input: {
  phase: 'binding' | 'bootstrap' | 'disable' | 'restore' | 'delegation' | 'challenge';
  circleId: number;
  profileRef: string;
  profileVersion: number;
  profileDigest: string;
  contractVersion: number;
  resourceBindingId?: string;
}): string {
  const identityDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-request-idempotency',
    input,
  );
  return `realms-${input.phase}:${input.circleId}:${identityDigest}`;
}

export async function buildRealmsVotingPowerChallengeConformancePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_voting_power_challenge_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('realms_voting_power_challenge_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'active',
      resourceRef: { not: null },
    },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('realms_voting_power_challenge_resource_not_found');
  const reconciliation = normalizeRecord(normalizeRecord(resource.verification).reconciliation);
  const votingPowerSecurity = reconciliation.votingPowerSecurity;
  if (
    reconciliation.state !== 'verified'
    || reconciliation.blocker !== null
    || reconciliation.observedStateDigest !== resource.stateDigest
    || Number(reconciliation.observedSlot) !== Number(resource.verifiedSlot)
    || !isCurrentRealmsVotingPowerSecurityProfile(votingPowerSecurity)
    || votingPowerSecurity.source.realm !== resource.resourceRef
    || votingPowerSecurity.source.profileRef !== profile.profileRef
    || votingPowerSecurity.source.profileVersion !== profile.version
    || votingPowerSecurity.source.programId !== profile.deployment.programId
  ) {
    throw new Error('realms_voting_power_challenge_snapshot_unavailable');
  }
  return {
    schemaVersion: 1 as const,
    operation: 'suspend_and_reopen_challenge_conformance' as const,
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBinding: {
      id: resource.id,
      resourceRef: resource.resourceRef,
      ownerProgramRef: resource.ownerProgramRef,
      contractVersion: resource.contractVersion,
    },
    frozenSnapshot: {
      observedSlot: Number(reconciliation.observedSlot),
      observedStateDigest: String(reconciliation.observedStateDigest),
      votingPowerProfileDigest: votingPowerSecurity.profileDigest,
      sameResourceRootDigest: votingPowerSecurity.sameResourceRoot.rootDigest,
      sameResourceRootRef: votingPowerSecurity.sameResourceRoot.rootRef,
      voteRecord: votingPowerSecurity.voteRecord,
      tokenOwnerRecords: votingPowerSecurity.tokenOwnerRecords,
      delegationGraphDigest: votingPowerSecurity.delegationGraph.graphDigest,
    },
    challengePolicy: {
      kind: 'fraud_or_attack_conformance' as const,
      suspension: 'immediate_on_accepted_decision' as const,
      resolution: 'reopen_only_after_two_finalized_readbacks_match_frozen_tally' as const,
      supersede: 'new_governed_snapshot_required_on_mismatch' as const,
      historicalTally: 'immutable' as const,
      providerMutation: 'none' as const,
      failureDisposition: 'degraded_hold_no_fallback' as const,
    },
  };
}

export function buildRealmsProviderBindingPayload() {
  const profile = getRealmsProviderTrustProfile();
  const readiness = resolveRealmsProviderTrustReadiness();
  const feePayer = profile.keyCustodyRecord.keyContracts.find(
    (contract) => contract.role === 'fee_payer',
  );
  if (!feePayer) throw new Error('realms_fee_payer_key_contract_required');

  return {
    schemaVersion: 1 as const,
    operation: 'create' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: 'realms_governance' as const,
    contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    resource: {
      type: 'realm' as const,
      ref: null,
      ownerProgramRef: profile.deployment.programId,
      purpose: 'dedicated_no_real_asset_devnet_regression' as const,
      status: 'pending_provider_bootstrap' as const,
    },
    custody: {
      recordRef: profile.keyCustodyRecord.recordRef,
      decisionRef: profile.keyCustodyRecord.decisionRef,
      signerProvider: profile.keyCustodyRecord.signerProvider,
      serviceTopology: profile.keyCustodyRecord.serviceTopology,
      endpoint: profile.keyCustodyRecord.endpoint,
      tls: profile.keyCustodyRecord.tls,
      transitMount: profile.keyCustodyRecord.transitMount,
      keyAlgorithm: profile.keyCustodyRecord.keyAlgorithm,
      exportable: profile.keyCustodyRecord.exportable,
      allowPlaintextBackup: profile.keyCustodyRecord.allowPlaintextBackup,
      status: profile.keyCustodyRecord.status,
      verification: profile.keyCustodyRecord.verification,
    },
    authorityBindings: profile.keyCustodyRecord.keyContracts.map((contract) => ({
      role: contract.role,
      keyRef: contract.keyRef,
      allowedOperations: [...contract.allowedOperations],
      currentAuthority: null,
      custodyStatus: contract.status,
    })),
    payerPolicy: {
      economicBearer: 'solana_devnet_faucet_only' as const,
      feePayerSignerRef: feePayer.keyRef,
      rentFundingSourceRef: feePayer.keyRef,
      refundRecipientRef: feePayer.keyRef,
      singleLimit: {
        lamports: '0',
        reason: 'wallet_not_generated',
      },
      fundingBlockerCode: 'openbao_wallet_not_generated' as const,
      status: 'inactive' as const,
    },
    activation: 'not_activated' as const,
  };
}

export async function buildRealmsProviderBootstrapPayload(
  prisma: PrismaClient,
  input: {
    circleId: number;
    retryRequestId?: string;
    sourcePayerPolicyId?: string;
  },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_provider_bootstrap_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const readiness = resolveRealmsProviderTrustReadiness();
  const home = await prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('realms_provider_bootstrap_home_not_configured');
  const resource = await prisma.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'pending_custody',
      resourceRef: null,
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
  });
  if (!resource) throw new Error('realms_provider_bootstrap_resource_not_ready');
  const resourceVerification = normalizeRecord(resource.verification);
  if (resourceVerification.profileDigest !== readiness.profileDigest) {
    throw new Error('realms_provider_bootstrap_profile_digest_mismatch');
  }
  const expectedContracts = new Map(
    profile.keyCustodyRecord.keyContracts.map((contract) => [contract.role, contract]),
  );
  if (resource.authorityBindings.length !== expectedContracts.size) {
    throw new Error('realms_provider_bootstrap_authority_inventory_mismatch');
  }
  const authorityBindings = resource.authorityBindings.map((binding) => {
    const contract = expectedContracts.get(binding.authorityRole as never);
    const allowedOperations = normalizeStringArray(binding.allowedOperations);
    if (
      !contract
      || binding.keyRef !== contract.keyRef
      || binding.custodyProvider !== 'openbao_transit'
      || binding.custodyStatus !== 'verified'
      || binding.status !== 'pending_provider_bootstrap'
      || typeof binding.currentAuthority !== 'string'
      || !sameStringSet(allowedOperations, contract.allowedOperations)
    ) {
      throw new Error('realms_provider_bootstrap_authority_owner_mismatch');
    }
    let publicKey: string;
    try {
      publicKey = new PublicKey(binding.currentAuthority).toBase58();
    } catch {
      throw new Error('realms_provider_bootstrap_authority_public_key_invalid');
    }
    return {
      role: contract.role,
      keyRef: contract.keyRef,
      publicKey,
      allowedOperations: [...contract.allowedOperations].sort(),
    };
  }).sort((left, right) => left.role.localeCompare(right.role));
  if (new Set(authorityBindings.map((binding) => binding.publicKey)).size !== authorityBindings.length) {
    throw new Error('realms_provider_bootstrap_authority_separation_required');
  }
  const feePayer = authorityBindings.find((binding) => binding.role === 'fee_payer');
  if (!feePayer) throw new Error('realms_provider_bootstrap_fee_payer_required');
  const payer = input.sourcePayerPolicyId
    ? await prisma.payerPolicy.findUnique({ where: { id: input.sourcePayerPolicyId } })
    : await prisma.payerPolicy.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        feePayerSignerRef: feePayer.keyRef,
        status: 'inactive',
        fundingBlockerCode: 'devnet_fee_cap_required',
        supersededAt: null,
      },
      orderBy: { version: 'desc' },
    });
  const retryPayer = input.retryRequestId
    ? await prisma.payerPolicy.findUnique({ where: { sourceRequestId: input.retryRequestId } })
    : null;
  const sourcePayerCurrent = payer?.status === 'inactive'
    && payer.fundingBlockerCode === 'devnet_fee_cap_required'
    && payer.supersededAt === null;
  const sourcePayerConsumedByExactRetry = payer?.status === 'superseded'
    && payer.supersededAt !== null
    && retryPayer?.version === 2
    && retryPayer.status === 'active'
    && retryPayer.homeIdentityBindingId === home.id
    && retryPayer.network === profile.chain.chainId
    && retryPayer.feePayerSignerRef === feePayer.keyRef
    && retryPayer.economicBearer === 'solana_devnet_faucet_only';
  if (
    !payer
    || payer.version !== 1
    || payer.homeIdentityBindingId !== home.id
    || payer.network !== profile.chain.chainId
    || payer.feePayerSignerRef !== feePayer.keyRef
    || payer.economicBearer !== 'solana_devnet_faucet_only'
    || (!sourcePayerCurrent && !sourcePayerConsumedByExactRetry)
  ) {
    throw new Error('realms_provider_bootstrap_payer_owner_mismatch');
  }
  const operations = [...new Set(
    authorityBindings.flatMap((binding) => binding.allowedOperations),
  )].sort();
  return {
    schemaVersion: 1 as const,
    operation: 'bootstrap_no_asset_devnet_realm' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: 'realms_governance' as const,
    contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    resourceBinding: {
      id: resource.id,
      status: 'pending_provider_bootstrap' as const,
      currentResourceRef: null,
    },
    authorityBindings,
    payerAuthorization: {
      currentPolicyId: payer.id,
      nextVersion: 2 as const,
      economicBearer: 'solana_devnet_faucet_only' as const,
      feePayerSignerRef: feePayer.keyRef,
      singleTransactionLimitLamports: REALMS_BOOTSTRAP_SINGLE_TRANSACTION_LIMIT_LAMPORTS,
      totalBootstrapLimitLamports: REALMS_BOOTSTRAP_TOTAL_LIMIT_LAMPORTS,
      maximumWalletBalanceLamports: REALMS_BOOTSTRAP_MAXIMUM_BALANCE_LAMPORTS,
      fundingSource: 'solana_devnet_faucet_only' as const,
    },
    providerIntent: {
      realmName: `Alcheme Circle ${input.circleId} Devnet`,
      programId: profile.deployment.programId,
      clientPackage: profile.clientDecoder.packageName,
      clientVersion: profile.clientDecoder.version,
      operations,
      noRealAssets: true as const,
      communityMintDecimals: 0 as const,
      proposerWeight: '1' as const,
      voterWeight: '2' as const,
      voteThresholdPercentage: 50 as const,
      baseVotingTimeSeconds: 3600 as const,
      voteTipping: 'early' as const,
      approvedInstruction: 'system_program_zero_lamport_executor_self_transfer' as const,
      commitment: profile.readback.commitment,
      resubmitPolicy: profile.readback.resubmitPolicy,
    },
    activation: {
      scope: 'circle_capability_contract_profile_version' as const,
      status: 'pending_provider_finality' as const,
      inPlaceClusterSwitch: profile.environmentBoundary.inPlaceClusterSwitch,
      openCaseProfileSwitch: profile.environmentBoundary.openCaseProfileSwitch,
    },
  };
}

export async function buildRealmsProviderDelegationConformancePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_provider_delegation_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const readiness = resolveRealmsProviderTrustReadiness();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('realms_provider_delegation_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'active',
      resourceRef: { not: null },
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('realms_provider_delegation_active_resource_not_found');
  const verification = normalizeRecord(resource.verification);
  const reconciliation = normalizeRecord(verification.reconciliation);
  const votingPowerSecurity = reconciliation.votingPowerSecurity;
  if (
    reconciliation.state !== 'verified'
    || !isCurrentRealmsVotingPowerSecurityProfile(votingPowerSecurity)
    || votingPowerSecurity.source.realm !== resource.resourceRef
    || votingPowerSecurity.source.programId !== resource.ownerProgramRef
    || votingPowerSecurity.source.profileRef !== profile.profileRef
    || votingPowerSecurity.source.profileVersion !== profile.version
    || votingPowerSecurity.tokenOwnerRecords.some((record) => record.governanceDelegate !== null)
    || votingPowerSecurity.delegationGraph.mapping !== 'exact_no_delegate'
  ) {
    throw new Error('realms_provider_delegation_readiness_mismatch');
  }
  const currentProfileDigest = typeof verification.profileDigest === 'string'
    ? verification.profileDigest
    : null;
  if (!currentProfileDigest || !/^[a-f0-9]{64}$/.test(currentProfileDigest)) {
    throw new Error('realms_provider_delegation_current_profile_digest_invalid');
  }
  const contracts = new Map(
    profile.keyCustodyRecord.keyContracts.map((contract) => [contract.role, contract]),
  );
  const authorities = new Map(
    resource.authorityBindings.map((binding: any) => [binding.authorityRole, binding]),
  );
  const voterContract = contracts.get('voter');
  const feePayerContract = contracts.get('fee_payer');
  const voterAuthority = authorities.get('voter') as any;
  const proposerAuthority = authorities.get('proposer') as any;
  const feePayerAuthority = authorities.get('fee_payer') as any;
  const voterRecord = votingPowerSecurity.tokenOwnerRecords.find((record) => record.role === 'voter');
  const proposerRecord = votingPowerSecurity.tokenOwnerRecords.find((record) => record.role === 'proposer');
  if (
    !voterContract
    || !feePayerContract
    || !voterAuthority
    || !proposerAuthority
    || !feePayerAuthority
    || !voterRecord
    || !proposerRecord
    || voterAuthority.status !== 'active'
    || proposerAuthority.status !== 'active'
    || feePayerAuthority.status !== 'active'
    || voterAuthority.keyRef !== voterContract.keyRef
    || feePayerAuthority.keyRef !== feePayerContract.keyRef
    || voterAuthority.currentAuthority !== voterRecord.owner
    || proposerAuthority.currentAuthority !== proposerRecord.owner
    || feePayerAuthority.currentAuthority === voterRecord.owner
    || feePayerAuthority.currentAuthority === proposerRecord.owner
    || !sameStringSet(normalizeStringArray(voterAuthority.allowedOperations), ['cast_vote'])
    || !sameStringSet(voterContract.allowedOperations, [
      'cast_vote',
      'revoke_governance_delegate',
      'set_governance_delegate',
    ])
  ) {
    throw new Error('realms_provider_delegation_authority_owner_mismatch');
  }
  const payer = await db.payerPolicy.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      feePayerSignerRef: feePayerAuthority.keyRef,
      status: 'active',
      supersededAt: null,
    },
    orderBy: { version: 'desc' },
  });
  if (!payer || payer.economicBearer !== 'solana_devnet_faucet_only') {
    throw new Error('realms_provider_delegation_payer_owner_mismatch');
  }
  return {
    schemaVersion: 1 as const,
    operation: 'provider_native_delegation_conformance' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: 'realms_governance' as const,
    contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileTransition: {
      currentDigest: currentProfileDigest,
      targetDigest: readiness.profileDigest,
      mode: 'single_current_contract_explicit_governed_activation' as const,
      deploymentChanged: false as const,
      resourceChanged: false as const,
    },
    resourceBinding: {
      id: resource.id,
      status: 'active' as const,
      resourceRef: resource.resourceRef as string,
      verificationDigest: resource.verificationDigest,
      stateDigest: resource.stateDigest,
    },
    authorityTransition: {
      bindingId: voterAuthority.id as string,
      role: 'voter' as const,
      keyRef: voterAuthority.keyRef as string,
      publicKey: voterAuthority.currentAuthority as string,
      currentAllowedOperations: ['cast_vote'] as const,
      targetAllowedOperations: [...voterContract.allowedOperations].sort(),
      delegate: proposerAuthority.currentAuthority as string,
      scope: 'provider_delegation_conformance_only' as const,
      maxDepth: 1 as const,
    },
    payerAuthorization: {
      currentPolicyId: payer.id as string,
      currentVersion: payer.version as number,
      nextVersion: (payer.version as number) + 1,
      economicBearer: 'solana_devnet_faucet_only' as const,
      feePayerSignerRef: feePayerAuthority.keyRef as string,
      feePayerPublicKey: feePayerAuthority.currentAuthority as string,
      singleTransactionLimitLamports: REALMS_DELEGATION_SINGLE_TRANSACTION_LIMIT_LAMPORTS,
      totalLimitLamports: REALMS_DELEGATION_TOTAL_LIMIT_LAMPORTS,
      maximumWalletBalanceLamports: REALMS_BOOTSTRAP_MAXIMUM_BALANCE_LAMPORTS,
      fundingSource: 'existing_devnet_faucet_balance_no_top_up' as const,
      priorActionScope: payer.actionScope,
    },
    providerIntent: {
      programId: profile.deployment.programId,
      realm: votingPowerSecurity.source.realm,
      governingTokenMint: votingPowerSecurity.source.governingTokenMint,
      voterTokenOwnerRecord: voterRecord.recordRef,
      voterOwner: voterRecord.owner,
      voterDepositAmount: voterRecord.depositAmount,
      delegate: proposerRecord.owner,
      voteRecord: votingPowerSecurity.voteRecord.recordRef,
      yesVoteWeight: votingPowerSecurity.voteRecord.yesVoteWeight,
      initialDelegate: null,
      finalDelegate: null,
      operations: ['set_governance_delegate', 'revoke_governance_delegate'] as const,
      commitment: 'finalized' as const,
      noRealAssets: true as const,
    },
    lifecycle: {
      effectiveAt: 'accepted_decision_execution' as const,
      expirySeconds: 600 as const,
      revocation: 'mandatory_same_request' as const,
      inFlightDisposition: 'set_finalized_without_revoke_enters_hold' as const,
      retry: 'same_request_idempotent_revoke_only' as const,
      rollback: 'provider_native_revoke_then_finalized_readback' as const,
      historicalVoteInvariant: 'vote_record_and_tally_unchanged' as const,
      mapping: 'weaker_provider_delegate_broader_than_vote_only_template_blocked' as const,
    },
  };
}

export async function buildRealmsProviderDisablePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_provider_disable_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('realms_provider_disable_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: { in: ['active', 'degraded'] },
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('realms_provider_disable_active_binding_not_found');
  const providerRestore = normalizeRecord(normalizeRecord(resource.verification).providerRestore);
  const activeLifecycle = providerRestore.schemaVersion === 1
    && providerRestore.state === 'restored'
    && typeof providerRestore.requestId === 'string'
    && /^[a-f0-9]{64}$/.test(String(providerRestore.decisionDigest ?? ''))
    ? {
      state: 'restored' as const,
      requestId: providerRestore.requestId,
      decisionDigest: String(providerRestore.decisionDigest),
    }
    : {
      state: 'activated' as const,
      requestId: resource.sourceRequestId,
      decisionDigest: resource.sourceDecisionDigest,
    };
  if (
    typeof activeLifecycle.requestId !== 'string'
    || activeLifecycle.requestId.length === 0
    || !/^[a-f0-9]{64}$/.test(String(activeLifecycle.decisionDigest ?? ''))
  ) {
    throw new Error('realms_provider_disable_active_lineage_invalid');
  }
  const requests = await db.governanceRequest.findMany({
    where: {
      homeIdentityBindingId: home.id,
      targetType: 'circle',
      targetRef: String(input.circleId),
      actionType: {
        in: [
          REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
          REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
        ],
      },
    },
    include: {
      receipts: {
        select: { executionStatus: true, executionRef: true, executedAt: true },
        orderBy: { executedAt: 'asc' },
      },
    },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
  });
  const entries = requests.map((request: any) => {
    const terminal = request.receipts.some((receipt: any) => (
      receipt.executionStatus === 'executed'
    ));
    return {
      requestId: request.id,
      actionType: request.actionType,
      state: request.state,
      disposition: terminal
        ? 'preserve_terminal_provider_facts'
        : request.state === 'accepted'
          ? 'block_new_dispatch_require_independent_reconciliation'
          : 'preserve_frozen_request_block_new_dispatch',
      terminalExecutionRefs: request.receipts
        .filter((receipt: any) => receipt.executionStatus === 'executed')
        .map((receipt: any) => receipt.executionRef)
        .filter((value: unknown): value is string => typeof value === 'string')
        .sort(),
    };
  });
  const inFlightDisposition = {
    schemaVersion: 1 as const,
    entries,
    terminalFacts: 'append_only' as const,
    newDispatch: 'blocked' as const,
    submittedTransactions: 'independent_reconciliation_only' as const,
  };
  return {
    schemaVersion: 1 as const,
    operation: 'disable' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: 'realms_governance' as const,
    contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBinding: {
      id: resource.id,
      resourceRef: resource.resourceRef,
      ownerProgramRef: resource.ownerProgramRef,
      status: resource.status,
      authorityCount: resource.authorityBindings.length,
    },
    activeLifecycle,
    inFlightDisposition,
    inFlightDispositionDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-in-flight-disposition',
      inFlightDisposition,
    ),
    rollbackPolicy: {
      preSubmit: 'new_governed_restore_requires_independent_readback' as const,
      postSubmit: 'forward_recovery_or_independent_reconciliation_only' as const,
      chainFacts: 'never_rewritten' as const,
      fallback: 'prohibited' as const,
    },
    pauseBoundary: {
      authority: 'resource_pause_separate_from_workflow_freeze' as const,
      workflowFreezeClaimsChainPaused: false as const,
      effect: 'provider_dispatch_disabled_no_chain_pause_claim' as const,
      providerTransaction: 'not_submitted' as const,
      providerStateReadback: 'canonical_resource_binding_disabled' as const,
      onchainPauseInstruction: 'not_claimed' as const,
      restoreAuthority: 'new_governed_restore_requires_independent_readback' as const,
      rollback: 'forward_recovery_only_chain_facts_never_rewritten' as const,
      fallbackAuthority: 'none' as const,
    },
    reason: 'governed_provider_disable' as const,
  };
}

export async function buildRealmsProviderRestorePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_provider_restore_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('realms_provider_restore_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'disabled',
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('realms_provider_restore_disabled_binding_not_found');
  const providerDisable = normalizeRecord(normalizeRecord(resource.verification).providerDisable);
  if (
    providerDisable.schemaVersion !== 1
    || providerDisable.state !== 'disabled'
    || typeof providerDisable.requestId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(providerDisable.decisionDigest ?? ''))
    || typeof providerDisable.inFlightDispositionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(providerDisable.inFlightDispositionDigest)
  ) {
    throw new Error('realms_provider_restore_disable_lineage_invalid');
  }
  return {
    schemaVersion: 1 as const,
    operation: 'restore' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: 'realms_governance' as const,
    contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBinding: {
      id: resource.id,
      resourceRef: resource.resourceRef,
      ownerProgramRef: resource.ownerProgramRef,
      status: 'disabled' as const,
      authorityCount: resource.authorityBindings.length,
    },
    disabledBy: {
      requestId: providerDisable.requestId,
      decisionDigest: providerDisable.decisionDigest,
      inFlightDispositionDigest: providerDisable.inFlightDispositionDigest,
    },
    restorePolicy: {
      authority: 'new_governance_decision' as const,
      prerequisite: 'independent_provider_readback_verified' as const,
      profileSwitch: 'prohibited' as const,
      chainFactRewrite: 'prohibited' as const,
      fallback: 'prohibited' as const,
    },
  };
}

export async function executeRealmsProviderBindingAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
    source?: GovernanceRequestExecutionSource;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.actionType === REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE) {
    return executeRealmsVotingPowerChallengeConformanceAction(prisma, input);
  }
  if (request.actionType === REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE) {
    return executeRealmsProviderDelegationConformanceAction(prisma, input);
  }
  if (request.actionType === REALMS_PROVIDER_RESTORE_ACTION_TYPE) {
    return executeRealmsProviderRestoreAction(prisma, input);
  }
  if (request.actionType === REALMS_PROVIDER_DISABLE_ACTION_TYPE) {
    return executeRealmsProviderDisableAction(prisma, input);
  }
  if (request.actionType === REALMS_EMERGENCY_ONCHAIN_PAUSE_ACTION_TYPE) {
    return executeRealmsEmergencyOnchainPauseAction(prisma, input);
  }
  if (request.actionType === REALMS_EMERGENCY_ONCHAIN_UNPAUSE_ACTION_TYPE) {
    return executeRealmsEmergencyOnchainUnpauseAction(prisma, input);
  }
  if (request.actionType === REALMS_PROGRAM_UPGRADE_ACTION_TYPE) {
    return executeRealmsProgramUpgradeAction(prisma, input);
  }
  if (request.actionType === REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE) {
    return executeRealmsProviderBootstrapAction(prisma, input);
  }
  if (request.actionType !== REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE) return null;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('realms_provider_binding_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('realms_provider_binding_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('realms_provider_binding_circle_invalid');

  const expectedPayload = buildRealmsProviderBindingPayload();
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('realms_provider_binding_evidence_policy_mismatch');
  }
  const expectedPayloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-binding-payload',
    { ...expectedPayload, evidencePolicy },
  );
  const suppliedPayloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-binding-payload',
    suppliedPayload,
  );
  if (suppliedPayloadDigest !== expectedPayloadDigest) {
    throw new Error('realms_provider_binding_profile_contract_mismatch');
  }

  const resourceBindingId = stableId('realms-resource', request.id);
  const payerPolicyId = stableId('realms-payer', request.id);
  const verification = {
    schemaVersion: 1,
    profileDigest: expectedPayload.profileDigest,
    deploymentVerification: 'snapshot_verified_read_only',
    resourceReadback: 'pending_provider_bootstrap',
    custodyRecordRef: expectedPayload.custody.recordRef,
    custodyStatus: expectedPayload.custody.status,
    custodyEndpoint: expectedPayload.custody.endpoint,
    custodyTls: expectedPayload.custody.tls,
    custodyVerification: expectedPayload.custody.verification,
    activation: 'not_activated',
  };
  const verificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    verification,
  );
  const actionScope = {
    schemaVersion: 1,
    capability: expectedPayload.capability,
    chainId: expectedPayload.chainId,
    profileRef: expectedPayload.profileRef,
    profileVersion: expectedPayload.profileVersion,
    allowedOperations: expectedPayload.authorityBindings.flatMap(
      (binding) => binding.allowedOperations,
    ).sort(),
  };
  const actionScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy-action-scope',
    actionScope,
  );
  const policyDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy',
    {
      homeIdentityBindingId: request.homeIdentityBindingId,
      version: 1,
      network: expectedPayload.chainId,
      actionScope,
      economicBearer: expectedPayload.payerPolicy.economicBearer,
      feePayerSignerRef: expectedPayload.payerPolicy.feePayerSignerRef,
      rentFundingSourceRef: expectedPayload.payerPolicy.rentFundingSourceRef,
      refundRecipientRef: expectedPayload.payerPolicy.refundRecipientRef,
      singleLimit: expectedPayload.payerPolicy.singleLimit,
      fundingBlockerCode: expectedPayload.payerPolicy.fundingBlockerCode,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      status: expectedPayload.payerPolicy.status,
    },
  );

  await prisma.$transaction(async (tx) => {
    const existing = await tx.governedResourceBinding.findUnique({
      where: { sourceRequestId: request.id },
      include: { authorityBindings: true },
    });
    if (existing) {
      assertExistingBindingMatches(existing, {
        resourceBindingId,
        authorityCount: expectedPayload.authorityBindings.length,
        decisionDigest,
        verificationDigest,
      });
      return;
    }
    const home = await tx.governanceHomeIdentityBinding.findUnique({
      where: { id: request.homeIdentityBindingId! },
      select: {
        id: true,
        homeType: true,
        homeRef: true,
        status: true,
        supersededAt: true,
      },
    });
    if (
      !home
      || home.homeType !== 'circle'
      || home.homeRef !== String(circleId)
      || home.status !== 'active'
      || home.supersededAt
    ) {
      throw new Error('realms_provider_binding_home_identity_mismatch');
    }
    const competing = await tx.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        capability: expectedPayload.capability,
        status: { in: ['pending_custody', 'active', 'degraded'] },
      },
      select: { id: true },
    });
    if (competing) throw new Error('realms_provider_binding_already_exists');

    await tx.governedResourceBinding.create({
      data: {
        id: resourceBindingId,
        homeIdentityBindingId: home.id,
        network: expectedPayload.chainId,
        provider: expectedPayload.provider,
        capability: expectedPayload.capability,
        contractVersion: expectedPayload.contractVersion,
        profileRef: expectedPayload.profileRef,
        profileVersion: expectedPayload.profileVersion,
        resourceType: expectedPayload.resource.type,
        resourceRef: null,
        ownerProgramRef: expectedPayload.resource.ownerProgramRef,
        purpose: expectedPayload.resource.purpose,
        verification: verification as Prisma.InputJsonValue,
        verificationDigest,
        verifiedSlot: null,
        stateDigest: null,
        status: 'pending_custody',
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
        activatedAt: null,
        disabledAt: null,
      },
    });
    for (const binding of expectedPayload.authorityBindings) {
      await tx.resourceAuthorityBinding.create({
        data: {
          id: stableId(`realms-${binding.role}`, request.id),
          governedResourceBindingId: resourceBindingId,
          homeIdentityBindingId: home.id,
          network: expectedPayload.chainId,
          provider: expectedPayload.provider,
          profileRef: expectedPayload.profileRef,
          profileVersion: expectedPayload.profileVersion,
          authorityRole: binding.role,
          keyRef: binding.keyRef,
          currentAuthority: null,
          ownerProgramRef: expectedPayload.resource.ownerProgramRef,
          providerResourceRef: null,
          allowedOperations: binding.allowedOperations as Prisma.InputJsonValue,
          custodyProvider: expectedPayload.custody.signerProvider,
          custodyStatus: binding.custodyStatus,
          custodyVerification: expectedPayload.custody.verification as Prisma.InputJsonValue,
          verifiedSlot: null,
          stateDigest: null,
          status: 'pending_custody',
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
          activatedAt: null,
          retiredAt: null,
        },
      });
    }
    await tx.payerPolicy.create({
      data: {
        id: payerPolicyId,
        homeIdentityBindingId: home.id,
        version: 1,
        network: expectedPayload.chainId,
        actionScope: actionScope as Prisma.InputJsonValue,
        actionScopeDigest,
        economicBearer: expectedPayload.payerPolicy.economicBearer,
        feePayerSignerRef: expectedPayload.payerPolicy.feePayerSignerRef,
        rentFundingSourceRef: expectedPayload.payerPolicy.rentFundingSourceRef,
        refundRecipientRef: expectedPayload.payerPolicy.refundRecipientRef,
        relayerRef: null,
        singleLimit: expectedPayload.payerPolicy.singleLimit as Prisma.InputJsonValue,
        expiry: null,
        fundingBlockerCode: expectedPayload.payerPolicy.fundingBlockerCode,
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
        policyDigest,
        status: expectedPayload.payerPolicy.status,
        effectiveFrom: null,
        supersededAt: null,
      },
    });
  });

  return {
    executionStatus: 'executed',
    executionRef: resourceBindingId,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'canonical_binding_owners_created',
      chainId: expectedPayload.chainId,
      provider: expectedPayload.provider,
      capability: expectedPayload.capability,
      contractVersion: expectedPayload.contractVersion,
      profileRef: expectedPayload.profileRef,
      profileVersion: expectedPayload.profileVersion,
      resourceBindingId,
      resourceStatus: 'pending_custody',
      authorityBindingCount: expectedPayload.authorityBindings.length,
      authorityStatus: 'pending_custody',
      payerPolicyId,
      payerStatus: 'inactive',
      payerLimit: 'zero',
      providerEffect: 'not_started',
      providerFinality: 'not_applicable_pre_provider',
      activation: 'not_activated',
    },
  };
}

async function executeRealmsProviderDelegationConformanceAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
    source?: GovernanceRequestExecutionSource;
  },
): Promise<GovernanceActionExecutionOutcome> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle' || !request.homeIdentityBindingId || !request.invocationId) {
    throw new Error('realms_provider_delegation_runtime_owner_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest) || !Number.isFinite(now.getTime())) {
    throw new Error('realms_provider_delegation_execution_contract_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('realms_provider_delegation_circle_invalid');
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('realms_provider_delegation_evidence_policy_mismatch');
  }
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-action-intent',
    suppliedPayload,
  );
  const attemptKey = `realms-provider-delegation:${request.id}:v1`;
  const existingPreflight = await prisma.costPreflight.findUnique({
    where: {
      invocationId_attemptKey: {
        invocationId: request.invocationId,
        attemptKey,
      },
    },
    include: { payerPolicy: true },
  });
  if (existingPreflight && (
    existingPreflight.actionIntentDigest !== actionIntentDigest
    || existingPreflight.payerPolicy.sourceRequestId !== request.id
    || existingPreflight.payerPolicy.sourceDecisionDigest !== decisionDigest
  )) {
    throw new Error('realms_provider_delegation_preflight_idempotency_conflict');
  }
  if (!existingPreflight) {
    const expectedPayload = await buildRealmsProviderDelegationConformancePayload(prisma, {
      circleId,
    });
    if (hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-delegation-payload',
      suppliedPayload,
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-delegation-payload',
      { ...expectedPayload, evidencePolicy },
    )) {
      throw new Error('realms_provider_delegation_contract_mismatch');
    }
  }
  const profile = getRealmsProviderTrustProfile();
  const profileTransition = normalizeRecord(suppliedPayload.profileTransition);
  const resourceBinding = normalizeRecord(suppliedPayload.resourceBinding);
  const authorityTransition = normalizeRecord(suppliedPayload.authorityTransition);
  const payerAuthorization = normalizeRecord(suppliedPayload.payerAuthorization);
  const providerIntent = normalizeRecord(suppliedPayload.providerIntent);
  const lifecycle = normalizeRecord(suppliedPayload.lifecycle);
  const operations = normalizeStringArray(providerIntent.operations);
  const targetOperations = normalizeStringArray(authorityTransition.targetAllowedOperations);
  if (
    suppliedPayload.schemaVersion !== 1
    || suppliedPayload.operation !== 'provider_native_delegation_conformance'
    || suppliedPayload.chainId !== profile.chain.chainId
    || suppliedPayload.provider !== profile.provider
    || suppliedPayload.capability !== 'realms_governance'
    || suppliedPayload.contractVersion !== REALMS_PROVIDER_BINDING_CONTRACT_VERSION
    || suppliedPayload.profileRef !== profile.profileRef
    || suppliedPayload.profileVersion !== profile.version
    || profileTransition.targetDigest !== resolveRealmsProviderTrustReadiness().profileDigest
    || profileTransition.deploymentChanged !== false
    || profileTransition.resourceChanged !== false
    || resourceBinding.status !== 'active'
    || authorityTransition.role !== 'voter'
    || authorityTransition.scope !== 'provider_delegation_conformance_only'
    || authorityTransition.maxDepth !== 1
    || !sameStringSet(operations, ['set_governance_delegate', 'revoke_governance_delegate'])
    || !sameStringSet(targetOperations, [
      'cast_vote',
      'set_governance_delegate',
      'revoke_governance_delegate',
    ])
    || providerIntent.programId !== profile.deployment.programId
    || providerIntent.initialDelegate !== null
    || providerIntent.finalDelegate !== null
    || providerIntent.commitment !== 'finalized'
    || providerIntent.noRealAssets !== true
    || payerAuthorization.singleTransactionLimitLamports
      !== REALMS_DELEGATION_SINGLE_TRANSACTION_LIMIT_LAMPORTS
    || payerAuthorization.totalLimitLamports !== REALMS_DELEGATION_TOTAL_LIMIT_LAMPORTS
    || payerAuthorization.maximumWalletBalanceLamports !== REALMS_BOOTSTRAP_MAXIMUM_BALANCE_LAMPORTS
    || payerAuthorization.fundingSource !== 'existing_devnet_faucet_balance_no_top_up'
    || lifecycle.expirySeconds !== 600
    || lifecycle.revocation !== 'mandatory_same_request'
    || lifecycle.inFlightDisposition !== 'set_finalized_without_revoke_enters_hold'
    || lifecycle.retry !== 'same_request_idempotent_revoke_only'
    || lifecycle.mapping !== 'weaker_provider_delegate_broader_than_vote_only_template_blocked'
  ) {
    throw new Error('realms_provider_delegation_payload_invalid');
  }
  for (const value of [
    resourceBinding.resourceRef,
    authorityTransition.publicKey,
    authorityTransition.delegate,
    payerAuthorization.feePayerPublicKey,
    providerIntent.realm,
    providerIntent.governingTokenMint,
    providerIntent.voterTokenOwnerRecord,
    providerIntent.voterOwner,
    providerIntent.delegate,
    providerIntent.voteRecord,
  ]) {
    try {
      new PublicKey(String(value));
    } catch {
      throw new Error('realms_provider_delegation_public_key_invalid');
    }
  }
  const payerPolicyId = stableId('realms-delegation-payer', request.id);
  const preflightId = stableId('realms-delegation-preflight', request.id);
  const existingProviderCheckpoint = existingPreflight
    ? normalizeDelegationProviderCheckpoint(existingPreflight.estimatedCost)
    : null;
  const revokeOnlyRecovery = existingProviderCheckpoint?.steps.some((step) => (
    step.id === 'set_governance_delegate'
    && step.status === 'finalized'
    && step.readback?.governanceDelegate === authorityTransition.delegate
  )) === true && existingProviderCheckpoint.steps.every((step) => (
    step.id !== 'revoke_governance_delegate' || step.status !== 'finalized'
  ));
  const checkedAt = existingPreflight?.checkedAt
    ? new Date(existingPreflight.checkedAt)
    : new Date(now);
  const expiresAt = existingPreflight?.expiresAt
    ? new Date(existingPreflight.expiresAt)
    : new Date(checkedAt.getTime() + 600_000);
  if (expiresAt.getTime() <= now.getTime() && !revokeOnlyRecovery) {
    throw new Error('realms_provider_delegation_authorization_expired');
  }
  const actionScope = {
    schemaVersion: 1,
    actionType: REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBindingId: resourceBinding.id,
    requestId: request.id,
    operations,
    noRealAssets: true,
  };
  const actionScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy-action-scope',
    actionScope,
  );
  const singleLimit = {
    lamports: REALMS_DELEGATION_SINGLE_TRANSACTION_LIMIT_LAMPORTS,
    scope: 'per_transaction',
    includes: ['fee'],
  };
  const periodLimit = {
    lamports: REALMS_DELEGATION_TOTAL_LIMIT_LAMPORTS,
    scope: 'single_delegation_conformance_lifecycle',
    maximumWalletBalanceLamports: REALMS_BOOTSTRAP_MAXIMUM_BALANCE_LAMPORTS,
  };
  const policyDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy',
    {
      id: payerPolicyId,
      homeIdentityBindingId: request.homeIdentityBindingId,
      version: payerAuthorization.nextVersion,
      network: profile.chain.chainId,
      actionScope,
      economicBearer: payerAuthorization.economicBearer,
      feePayerSignerRef: payerAuthorization.feePayerSignerRef,
      singleLimit,
      periodLimit,
      expiry: expiresAt.toISOString(),
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      status: 'active',
    },
  );
  const estimatedCost = {
    status: 'pending_rpc_quote',
    singleTransactionLimitLamports: REALMS_DELEGATION_SINGLE_TRANSACTION_LIMIT_LAMPORTS,
    totalLimitLamports: REALMS_DELEGATION_TOTAL_LIMIT_LAMPORTS,
  };
  const quoteContext = {
    schemaVersion: 1,
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBindingId: resourceBinding.id,
    commitment: 'finalized',
    resubmitPolicy: profile.readback.resubmitPolicy,
  };
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.cost-preflight',
    {
      id: preflightId,
      invocationId: request.invocationId,
      payerPolicyRef: payerPolicyId,
      attemptKey,
      estimatedCost,
      quoteContext,
      status: 'pending',
      checkedAt: checkedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      actionIntentDigest,
    },
  );

  if (!existingPreflight) await prisma.$transaction(async (tx) => {
    const [resource, voterAuthority, sourcePayer] = await Promise.all([
      tx.governedResourceBinding.findUnique({ where: { id: String(resourceBinding.id) } }),
      tx.resourceAuthorityBinding.findUnique({ where: { id: String(authorityTransition.bindingId) } }),
      tx.payerPolicy.findUnique({ where: { id: String(payerAuthorization.currentPolicyId) } }),
    ]);
    if (
      !resource
      || resource.homeIdentityBindingId !== request.homeIdentityBindingId
      || resource.status !== 'active'
      || resource.resourceRef !== resourceBinding.resourceRef
      || resource.verificationDigest !== resourceBinding.verificationDigest
      || resource.stateDigest !== resourceBinding.stateDigest
      || !voterAuthority
      || voterAuthority.governedResourceBindingId !== resource.id
      || voterAuthority.authorityRole !== 'voter'
      || voterAuthority.keyRef !== authorityTransition.keyRef
      || voterAuthority.currentAuthority !== authorityTransition.publicKey
      || !sameStringSet(normalizeStringArray(voterAuthority.allowedOperations), ['cast_vote'])
      || !sourcePayer
      || sourcePayer.homeIdentityBindingId !== request.homeIdentityBindingId
      || sourcePayer.version !== payerAuthorization.currentVersion
      || sourcePayer.status !== 'active'
      || sourcePayer.supersededAt
      || sourcePayer.feePayerSignerRef !== payerAuthorization.feePayerSignerRef
    ) {
      throw new Error('realms_provider_delegation_activation_owner_mismatch');
    }
    const verification = normalizeRecord(resource.verification);
    if (verification.profileDigest !== profileTransition.currentDigest) {
      throw new Error('realms_provider_delegation_profile_transition_mismatch');
    }
    const delegationConformance = {
      schemaVersion: 1,
      state: 'authorized',
      requestId: request.id,
      decisionDigest,
      actionIntentDigest,
      authorizedAt: checkedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      profileTransition,
      resourceBinding,
      authorityTransition,
      lifecycle,
    };
    const nextVerification = {
      ...verification,
      profileDigest: profileTransition.targetDigest,
      delegationConformance,
    };
    const resourceUpdated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        status: 'active',
        verificationDigest: resource.verificationDigest,
        stateDigest: resource.stateDigest,
      },
      data: {
        verification: nextVerification as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    if (resourceUpdated.count !== 1) {
      throw new Error('realms_provider_delegation_resource_activation_conflict');
    }
    const custodyVerification = {
      ...normalizeRecord(voterAuthority.custodyVerification),
      delegationAuthorization: {
        schemaVersion: 1,
        requestId: request.id,
        decisionDigest,
        actionIntentDigest,
        allowedOperations: targetOperations,
        expiresAt: expiresAt.toISOString(),
      },
    };
    const authorityUpdated = await tx.resourceAuthorityBinding.updateMany({
      where: {
        id: voterAuthority.id,
        governedResourceBindingId: resource.id,
        status: 'active',
        keyRef: voterAuthority.keyRef,
        sourceRequestId: voterAuthority.sourceRequestId,
        sourceDecisionDigest: voterAuthority.sourceDecisionDigest,
      },
      data: {
        allowedOperations: targetOperations as Prisma.InputJsonValue,
        custodyVerification: custodyVerification as Prisma.InputJsonValue,
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
    });
    if (authorityUpdated.count !== 1) {
      throw new Error('realms_provider_delegation_authority_activation_conflict');
    }
    await tx.payerPolicy.create({
      data: {
        id: payerPolicyId,
        homeIdentityBindingId: request.homeIdentityBindingId!,
        version: Number(payerAuthorization.nextVersion),
        network: profile.chain.chainId,
        actionScope: actionScope as Prisma.InputJsonValue,
        actionScopeDigest,
        economicBearer: String(payerAuthorization.economicBearer),
        feePayerSignerRef: String(payerAuthorization.feePayerSignerRef),
        rentFundingSourceRef: null,
        refundRecipientRef: String(payerAuthorization.feePayerSignerRef),
        relayerRef: null,
        singleLimit: singleLimit as Prisma.InputJsonValue,
        periodLimit: periodLimit as Prisma.InputJsonValue,
        expiry: expiresAt,
        fundingBlockerCode: null,
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
        policyDigest,
        status: 'active',
        effectiveFrom: checkedAt,
        supersededAt: null,
      },
    });
    const payerSuperseded = await tx.payerPolicy.updateMany({
      where: {
        id: sourcePayer.id,
        status: 'active',
        supersededAt: null,
      },
      data: { status: 'superseded', supersededAt: checkedAt },
    });
    if (payerSuperseded.count !== 1) {
      throw new Error('realms_provider_delegation_source_payer_conflict');
    }
    await tx.costPreflight.create({
      data: {
        id: preflightId,
        invocationId: request.invocationId!,
        payerPolicyRef: payerPolicyId,
        assetAuthorityPolicyRef: null,
        attemptKey,
        estimatedCost: estimatedCost as Prisma.InputJsonValue,
        reservationRef: null,
        quoteContext: quoteContext as Prisma.InputJsonValue,
        status: 'pending',
        checkedAt,
        expiresAt,
        actionIntentDigest,
        transactionAttemptDigest: null,
        preflightDigest,
      },
    });
  });

  const baselinePreflight = await prisma.costPreflight.findUnique({
    where: {
      invocationId_attemptKey: {
        invocationId: request.invocationId,
        attemptKey,
      },
    },
    include: { payerPolicy: true },
  });
  if (
    !baselinePreflight
    || baselinePreflight.actionIntentDigest !== actionIntentDigest
    || baselinePreflight.payerPolicyRef !== payerPolicyId
    || baselinePreflight.payerPolicy.policyDigest !== policyDigest
  ) {
    throw new Error('realms_provider_delegation_preflight_owner_mismatch');
  }
  const fundingAmendment = input.source === 'manual_retry'
    ? await resolveGovernanceFundingAmendmentRetryPreflight(prisma, {
      originalRequestId: request.id,
      originalDecisionDigest: decisionDigest,
      invocationId: request.invocationId,
      actionIntentDigest,
      baselinePreflight,
    })
    : null;
  const preflight = fundingAmendment?.preflight ?? baselinePreflight;
  if (!fundingAmendment && !['pending', 'ready', 'consumed'].includes(preflight.status)) {
    throw new Error('realms_provider_delegation_preflight_owner_mismatch');
  }
  if (preflight.status === 'consumed') {
    const consumed = normalizeConsumedDelegationEvidence(preflight.estimatedCost);
    const resource = await prisma.governedResourceBinding.findUnique({
      where: { id: String(resourceBinding.id) },
    });
    const delegationConformance = normalizeRecord(
      normalizeRecord(resource?.verification).delegationConformance,
    );
    if (
      !resource
      || resource.status !== 'active'
      || delegationConformance.state !== 'completed'
      || delegationConformance.requestId !== request.id
      || delegationConformance.decisionDigest !== decisionDigest
      || delegationConformance.actionIntentDigest !== actionIntentDigest
    ) {
      throw new Error('realms_provider_delegation_consumed_readback_mismatch');
    }
    return {
      executionStatus: 'executed',
      executionRef: resource.resourceRef!,
      errorCode: null,
      executionEvidence: {
        schemaVersion: 1,
        effect: 'realms_devnet_delegation_conformance_finalized',
        resourceBindingId: resource.id,
        payerPolicyId: preflight.payerPolicyRef,
        preflightId: preflight.id,
        providerReceipt: consumed,
        replay: 'canonical_consumed_readback',
      },
    };
  }
  const providerCheckpoint = existingProviderCheckpoint
    ?? normalizeDelegationProviderCheckpoint(preflight.estimatedCost);
  let latestProviderCheckpoint = providerCheckpoint;
  const providerContract: RealmsDevnetDelegationContract = {
    requestId: request.id,
    decisionDigest,
    actionIntentDigest,
    circleId,
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    programId: String(providerIntent.programId),
    realm: String(providerIntent.realm),
    governingTokenMint: String(providerIntent.governingTokenMint),
    voterTokenOwnerRecord: String(providerIntent.voterTokenOwnerRecord),
    voterOwner: String(providerIntent.voterOwner),
    voterDepositAmount: String(providerIntent.voterDepositAmount),
    delegate: String(providerIntent.delegate),
    voteRecord: String(providerIntent.voteRecord),
    yesVoteWeight: String(providerIntent.yesVoteWeight),
    voter: {
      keyRef: String(authorityTransition.keyRef),
      publicKey: String(authorityTransition.publicKey),
    },
    feePayer: {
      keyRef: String(payerAuthorization.feePayerSignerRef),
      publicKey: String(payerAuthorization.feePayerPublicKey),
    },
  };
  const connection = createRealmsDevnetConnection(
    profile.readback.rpc.endpoint,
    profile.readback.timeoutMs,
  );
  const providerReceipt = await executeRealmsDevnetDelegationConformance(
    providerContract,
    {
      singleTransactionLimitLamports: parseLamports(
        String(fundingAmendment?.singleLimit.lamports
          ?? REALMS_DELEGATION_SINGLE_TRANSACTION_LIMIT_LAMPORTS),
      ),
      totalBootstrapLimitLamports: parseLamports(String(
        fundingAmendment?.periodLimit.lamports ?? REALMS_DELEGATION_TOTAL_LIMIT_LAMPORTS,
      )),
      maximumWalletBalanceLamports: parseLamports(
        REALMS_BOOTSTRAP_MAXIMUM_BALANCE_LAMPORTS,
      ),
    },
    {
      connection,
      verifyTrustProfile: verifyRealmsProviderTrustProfileReadback,
      sign: ({ role, operation, message }) => signRealmsOpenBaoCanonicalMessage(prisma, {
        circleId,
        requestId: request.id,
        decisionDigest,
        actionIntentDigest,
        role,
        operation,
        message,
      }),
      readDelegationState: async (expectedDelegate) => {
        const readback = await readRealmsDevnetDelegationState(connection, providerContract);
        if (readback.governanceDelegate !== expectedDelegate) {
          throw new Error('realms_provider_delegation_authoritative_readback_mismatch');
        }
        return readback;
      },
      readCanonicalOwnerState: async ({ stepId, expectedDelegate }) => {
        const [currentResource, currentAuthority, currentPayer] = await Promise.all([
          prisma.governedResourceBinding.findUnique({
            where: { id: String(resourceBinding.id) },
          }),
          prisma.resourceAuthorityBinding.findUnique({
            where: { id: String(authorityTransition.bindingId) },
          }),
          prisma.payerPolicy.findUnique({ where: { id: payerPolicyId } }),
        ]);
        const currentVerification = normalizeRecord(currentResource?.verification);
        const currentDelegation = normalizeRecord(currentVerification.delegationConformance);
        const expectedLifecycleState = stepId === 'set_governance_delegate'
          ? 'authorized'
          : 'revoke_pending';
        const expectedResourceStatus = stepId === 'set_governance_delegate'
          ? 'active'
          : 'degraded';
        const expectedBlocker = stepId === 'set_governance_delegate'
          ? null
          : 'provider_delegate_set_revoke_not_finalized';
        if (
          (stepId === 'set_governance_delegate' && expectedDelegate !== null)
          || (stepId === 'revoke_governance_delegate'
            && expectedDelegate !== providerContract.delegate)
          || !currentResource
          || currentResource.homeIdentityBindingId !== request.homeIdentityBindingId
          || currentResource.status !== expectedResourceStatus
          || currentResource.resourceRef !== resourceBinding.resourceRef
          || currentResource.profileRef !== profile.profileRef
          || currentResource.profileVersion !== profile.version
          || !currentResource.verificationDigest
          || !currentResource.stateDigest
          || currentDelegation.state !== expectedLifecycleState
          || currentDelegation.requestId !== request.id
          || currentDelegation.decisionDigest !== decisionDigest
          || currentDelegation.actionIntentDigest !== actionIntentDigest
          || (currentDelegation.blocker ?? null) !== expectedBlocker
          || !currentAuthority
          || currentAuthority.governedResourceBindingId !== currentResource.id
          || currentAuthority.status !== 'active'
          || currentAuthority.keyRef !== providerContract.voter.keyRef
          || currentAuthority.currentAuthority !== providerContract.voter.publicKey
          || currentAuthority.sourceRequestId !== request.id
          || currentAuthority.sourceDecisionDigest !== decisionDigest
          || !sameStringSet(
            normalizeStringArray(currentAuthority.allowedOperations),
            targetOperations,
          )
          || !currentPayer
          || currentPayer.status !== 'active'
          || currentPayer.supersededAt !== null
          || currentPayer.feePayerSignerRef !== providerContract.feePayer.keyRef
          || currentPayer.sourceRequestId !== request.id
          || currentPayer.sourceDecisionDigest !== decisionDigest
          || currentPayer.policyDigest !== policyDigest
        ) {
          throw new Error('realms_provider_delegation_canonical_owner_state_drift');
        }
        const authorityHealth = await resolveProviderExecutionAuthorityHealthPreflight(
          prisma,
          request,
          new Date(),
        );
        const ownerStateFacts = {
          schemaVersion: 1 as const,
          resource: {
            id: currentResource.id,
            status: currentResource.status,
            resourceRef: currentResource.resourceRef,
            profileRef: currentResource.profileRef,
            profileVersion: currentResource.profileVersion,
            verificationDigest: currentResource.verificationDigest,
            stateDigest: currentResource.stateDigest,
          },
          authority: {
            id: currentAuthority.id,
            status: currentAuthority.status,
            currentAuthority: currentAuthority.currentAuthority,
            allowedOperations: [...targetOperations].sort(),
            sourceRequestId: currentAuthority.sourceRequestId,
            sourceDecisionDigest: currentAuthority.sourceDecisionDigest,
          },
          payer: {
            id: currentPayer.id,
            status: currentPayer.status,
            feePayerSignerRef: currentPayer.feePayerSignerRef,
            policyDigest: currentPayer.policyDigest,
            sourceRequestId: currentPayer.sourceRequestId,
            sourceDecisionDigest: currentPayer.sourceDecisionDigest,
          },
          lifecycle: {
            state: currentDelegation.state,
            blocker: currentDelegation.blocker ?? null,
            requestId: currentDelegation.requestId,
            decisionDigest: currentDelegation.decisionDigest,
            actionIntentDigest: currentDelegation.actionIntentDigest,
          },
          emergencyFreeze: authorityHealth,
        };
        return {
          schemaVersion: 1,
          authority: 'canonical_resource_authority_payer_readback',
          resourceBindingId: currentResource.id,
          authorityBindingId: currentAuthority.id,
          payerPolicyId: currentPayer.id,
          emergencyFreeze: 'clear_fresh_p05_authority_health',
          stateDigest: hashCanonicalGovernanceValue(
            'alcheme.governance.realms-delegation-canonical-owner-state-v1',
            ownerStateFacts,
          ),
        };
      },
      checkpoint: async (checkpoint) => {
        latestProviderCheckpoint = checkpoint;
        const providerAttemptInventory = realmsProviderAttemptInventory(
          checkpoint,
          actionIntentDigest,
          preflight.payerPolicyRef,
        );
        const updated = await prisma.costPreflight.updateMany({
          where: {
            id: preflight.id,
            actionIntentDigest,
            status: { in: ['pending', 'ready'] },
          },
          data: {
            estimatedCost: {
              ...estimatedCost,
              status: 'provider_in_progress',
              providerCheckpoint: checkpoint as unknown as Prisma.InputJsonValue,
              providerAttemptInventory: providerAttemptInventory as unknown as Prisma.InputJsonValue,
            } as unknown as Prisma.InputJsonValue,
            transactionAttemptDigest: providerAttemptInventory.latestAttemptDigest,
            status: 'ready',
          },
        });
        if (updated.count !== 1) {
          throw new Error('realms_provider_delegation_checkpoint_conflict');
        }
        const setFinalized = checkpoint.steps.some((step) => (
          step.id === 'set_governance_delegate'
          && step.status === 'finalized'
          && step.readback?.governanceDelegate === providerContract.delegate
        ));
        const revokeFinalized = checkpoint.steps.some((step) => (
          step.id === 'revoke_governance_delegate'
          && step.status === 'finalized'
          && step.readback?.governanceDelegate === null
        ));
        if (setFinalized && !revokeFinalized) {
          const resource = await prisma.governedResourceBinding.findUnique({
            where: { id: String(resourceBinding.id) },
          });
          const verification = normalizeRecord(resource?.verification);
          const currentLifecycle = normalizeRecord(verification.delegationConformance);
          if (resource && currentLifecycle.requestId === request.id) {
            const nextVerification = {
              ...verification,
              delegationConformance: {
                ...currentLifecycle,
                state: 'revoke_pending',
                blocker: 'provider_delegate_set_revoke_not_finalized',
                providerCheckpoint: checkpoint,
              },
            };
            await prisma.governedResourceBinding.updateMany({
              where: {
                id: resource.id,
                status: { in: ['active', 'degraded'] },
                verificationDigest: resource.verificationDigest,
              },
              data: {
                status: 'degraded',
                verification: nextVerification as unknown as Prisma.InputJsonValue,
                verificationDigest: hashCanonicalGovernanceValue(
                  'alcheme.governance.governed-resource-binding-verification',
                  nextVerification,
                ),
              },
            });
          }
        }
      },
    },
    providerCheckpoint,
  );
  await prisma.$transaction(async (tx) => {
    const resource = await tx.governedResourceBinding.findUnique({
      where: { id: String(resourceBinding.id) },
    });
    const verification = normalizeRecord(resource?.verification);
    const currentLifecycle = normalizeRecord(verification.delegationConformance);
    if (
      !resource
      || !['active', 'degraded'].includes(resource.status)
      || currentLifecycle.requestId !== request.id
      || currentLifecycle.decisionDigest !== decisionDigest
      || currentLifecycle.actionIntentDigest !== actionIntentDigest
    ) {
      throw new Error('realms_provider_delegation_completion_owner_mismatch');
    }
    const delegationConformance = {
      ...currentLifecycle,
      state: 'completed',
      completedAt: now.toISOString(),
      blocker: null,
      providerReceipt,
      bottomResourceIdentity: providerReceipt.baseline.tokenOwnerRecord,
      duplicateResourceCount: 0,
      maxDepthObserved: 1,
      cycleDetected: false,
      providerMapping: 'weaker_provider_delegate_broader_than_vote_only_template_blocked',
      historicalVoteInvariant: providerReceipt.historicalVoteInvariant,
    };
    const nextVerification = { ...verification, delegationConformance };
    const resourceUpdated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        status: { in: ['active', 'degraded'] },
        verificationDigest: resource.verificationDigest,
      },
      data: {
        status: 'active',
        verification: nextVerification as unknown as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
        verifiedSlot: BigInt(providerReceipt.revokeReadback.observedSlot),
      },
    });
    if (resourceUpdated.count !== 1) {
      throw new Error('realms_provider_delegation_completion_conflict');
    }
    const voterContract = profile.keyCustodyRecord.keyContracts.find(
      (contract) => contract.role === 'voter',
    );
    if (!voterContract) {
      throw new Error('realms_provider_delegation_voter_contract_missing');
    }
    const authorityRestored = await tx.resourceAuthorityBinding.updateMany({
      where: {
        id: String(authorityTransition.bindingId),
        governedResourceBindingId: resource.id,
        authorityRole: 'voter',
        keyRef: String(authorityTransition.keyRef),
        status: 'active',
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
      data: {
        allowedOperations: ['cast_vote'] as Prisma.InputJsonValue,
        custodyVerification: profile.keyCustodyRecord.verification as Prisma.InputJsonValue,
      },
    });
    if (authorityRestored.count !== 1) {
      throw new Error('realms_provider_delegation_authority_restore_conflict');
    }
    const temporaryPayerConsumed = await tx.payerPolicy.updateMany({
      where: {
        id: payerPolicyId,
        status: 'active',
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      },
      data: {
        status: 'consumed',
        supersededAt: now,
      },
    });
    if (temporaryPayerConsumed.count !== 1) {
      throw new Error('realms_provider_delegation_payer_consumption_conflict');
    }
    const sourcePayerRestored = await tx.payerPolicy.updateMany({
      where: {
        id: String(payerAuthorization.currentPolicyId),
        version: Number(payerAuthorization.currentVersion),
        status: 'superseded',
        feePayerSignerRef: String(payerAuthorization.feePayerSignerRef),
      },
      data: {
        status: 'active',
        supersededAt: null,
      },
    });
    if (sourcePayerRestored.count !== 1) {
      throw new Error('realms_provider_delegation_source_payer_restore_conflict');
    }
    const consumed = await tx.costPreflight.updateMany({
      where: {
        id: preflight.id,
        status: { in: ['pending', 'ready'] },
        actionIntentDigest,
      },
      data: {
        estimatedCost: {
          ...estimatedCost,
          status: 'consumed',
          providerCheckpoint: latestProviderCheckpoint as unknown as Prisma.InputJsonValue,
          providerReceipt,
          providerAttemptInventory: latestProviderCheckpoint
            ? realmsProviderAttemptInventory(
                latestProviderCheckpoint,
                actionIntentDigest,
                preflight.payerPolicyRef,
              )
            : null,
        } as unknown as Prisma.InputJsonValue,
        balanceReadback: {
          finalBalanceLamports: providerReceipt.finalBalanceLamports,
          totalSpendLamports: providerReceipt.totalSpendLamports,
          providerFinality: providerReceipt.providerFinality,
        } as Prisma.InputJsonValue,
        reservationRef: String(resourceBinding.resourceRef),
        transactionAttemptDigest: latestProviderCheckpoint
          ? realmsProviderAttemptInventory(
              latestProviderCheckpoint,
              actionIntentDigest,
              preflight.payerPolicyRef,
            ).latestAttemptDigest
          : null,
        status: 'consumed',
      },
    });
    if (consumed.count !== 1) {
      throw new Error('realms_provider_delegation_preflight_consumption_conflict');
    }
  });
  const reconciliation = await reconcileRealmsProviderBindingReadback(prisma, {
    circleId,
    now,
  });
  if (!reconciliation || reconciliation.state !== 'verified') {
    throw new Error('realms_provider_delegation_post_revoke_reconciliation_failed');
  }
  return {
    executionStatus: 'executed',
    executionRef: String(resourceBinding.resourceRef),
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_devnet_delegation_conformance_finalized',
      resourceBindingId: String(resourceBinding.id),
      payerPolicyId,
      preflightId: preflight.id,
      providerReceipt,
      reconciliation,
    },
  };
}

async function executeRealmsVotingPowerChallengeConformanceAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('realms_voting_power_challenge_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('realms_voting_power_challenge_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('realms_voting_power_challenge_circle_invalid');
  const supplied = normalizeRecord(request.payload);
  const suppliedResource = normalizeRecord(supplied.resourceBinding);
  const persistedResource = typeof suppliedResource.id === 'string'
    ? await (prisma as any).governedResourceBinding.findUnique({
      where: { id: suppliedResource.id },
    })
    : null;
  const persistedVerification = normalizeRecord(persistedResource?.verification);
  const persistedChallenge = normalizeRecord(persistedVerification.votingPowerChallenge);
  const resumingSuspendedRequest = Boolean(
    persistedResource
    && persistedResource.homeIdentityBindingId === request.homeIdentityBindingId
    && persistedResource.status === 'degraded'
    && persistedChallenge.state === 'suspended'
    && persistedChallenge.requestId === request.id
    && persistedChallenge.decisionDigest === decisionDigest
    && persistedChallenge.blocker === 'challenge_resolution_pending',
  );
  const expected = resumingSuspendedRequest
    ? {
      schemaVersion: 1 as const,
      operation: 'suspend_and_reopen_challenge_conformance' as const,
      chainId: persistedResource.network,
      profileRef: persistedResource.profileRef,
      profileVersion: persistedResource.profileVersion,
      resourceBinding: {
        id: persistedResource.id,
        resourceRef: persistedResource.resourceRef,
        ownerProgramRef: persistedResource.ownerProgramRef,
        contractVersion: persistedResource.contractVersion,
      },
      frozenSnapshot: persistedChallenge.frozenSnapshot,
      challengePolicy: persistedChallenge.policy,
    }
    : await buildRealmsVotingPowerChallengeConformancePayload(prisma, { circleId });
  const evidencePolicy = supplied.evidencePolicy;
  const { evidencePolicy: _evidencePolicy, ...suppliedPayload } = supplied;
  const expectedFrozenSnapshot = normalizeRecord(expected.frozenSnapshot);
  const suppliedStable = {
    ...suppliedPayload,
    frozenSnapshot: {
      ...normalizeRecord(supplied.frozenSnapshot),
      observedSlot: expectedFrozenSnapshot.observedSlot,
      observedStateDigest: expectedFrozenSnapshot.observedStateDigest,
      votingPowerProfileDigest: expectedFrozenSnapshot.votingPowerProfileDigest,
    },
  };
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
    || hashCanonicalGovernanceValue(
      'alcheme.governance.realms-voting-power-challenge-payload',
      suppliedStable,
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.realms-voting-power-challenge-payload',
      expected,
    )
  ) {
    throw new Error('realms_voting_power_challenge_payload_mismatch');
  }
  const frozen = normalizeRecord(supplied.frozenSnapshot);
  if (
    !Number.isSafeInteger(frozen.observedSlot)
    || Number(frozen.observedSlot) <= 0
    || !/^[a-f0-9]{64}$/.test(String(frozen.observedStateDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(frozen.votingPowerProfileDigest ?? ''))
  ) {
    throw new Error('realms_voting_power_challenge_frozen_snapshot_invalid');
  }

  const preReadback = await reconcileRealmsProviderBindingReadback(prisma, { circleId, now });
  if (!preReadback || preReadback.state !== 'verified' || !preReadback.votingPowerSecurity) {
    throw new Error('realms_voting_power_challenge_pre_readback_unavailable');
  }
  const preSecurity = preReadback.votingPowerSecurity;
  const stableSnapshotMatches = (
    preSecurity.sameResourceRoot.rootDigest === frozen.sameResourceRootDigest
    && preSecurity.sameResourceRoot.rootRef === frozen.sameResourceRootRef
    && preSecurity.delegationGraph.graphDigest === frozen.delegationGraphDigest
    && hashCanonicalGovernanceValue('alcheme.governance.vote-record-facts', preSecurity.voteRecord)
      === hashCanonicalGovernanceValue('alcheme.governance.vote-record-facts', frozen.voteRecord)
    && hashCanonicalGovernanceValue('alcheme.governance.token-owner-record-facts', preSecurity.tokenOwnerRecords)
      === hashCanonicalGovernanceValue('alcheme.governance.token-owner-record-facts', frozen.tokenOwnerRecords)
  );
  if (!stableSnapshotMatches) {
    throw new Error('realms_voting_power_challenge_snapshot_drift');
  }

  await (prisma as any).$transaction(async (tx: any) => {
    const resource = await tx.governedResourceBinding.findUnique({
      where: { id: expected.resourceBinding.id },
    });
    const verification = normalizeRecord(resource?.verification);
    const reconciliation = normalizeRecord(verification.reconciliation);
    const challenge = normalizeRecord(verification.votingPowerChallenge);
    const resuming = (
      resource?.status === 'degraded'
      && challenge.state === 'suspended'
      && challenge.requestId === request.id
      && challenge.decisionDigest === decisionDigest
      && challenge.blocker === 'challenge_resolution_pending'
      && hashCanonicalGovernanceValue(
        'alcheme.governance.realms-voting-power-challenge-frozen-snapshot',
        challenge.frozenSnapshot,
      ) === hashCanonicalGovernanceValue(
        'alcheme.governance.realms-voting-power-challenge-frozen-snapshot',
        supplied.frozenSnapshot,
      )
    );
    if (
      !resource
      || resource.homeIdentityBindingId !== request.homeIdentityBindingId
      || (resource.status !== 'active' && !resuming)
      || resource.resourceRef !== expected.resourceBinding.resourceRef
      || reconciliation.state !== 'verified'
      || reconciliation.observedStateDigest !== preReadback.observedStateDigest
      || Number(reconciliation.observedSlot) !== preReadback.observedSlot
    ) {
      throw new Error('realms_voting_power_challenge_suspension_owner_mismatch');
    }
    const votingPowerChallenge = {
      ...(resuming ? challenge : {
        schemaVersion: 1,
        state: 'suspended',
        requestId: request.id,
        decisionDigest,
        suspendedAt: now.toISOString(),
        blocker: 'challenge_resolution_pending',
        frozenSnapshot: supplied.frozenSnapshot,
        policy: expected.challengePolicy,
        historicalTallyInvariant: 'pending',
      }),
      ...(resuming ? { lastRetryAt: now.toISOString() } : {}),
      preReadback: {
        observedSlot: preReadback.observedSlot,
        observedStateDigest: preReadback.observedStateDigest,
        votingPowerProfileDigest: preSecurity.profileDigest,
        voteRecord: preSecurity.voteRecord,
      },
    };
    const nextVerification = { ...verification, votingPowerChallenge };
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        status: resource.status,
        verificationDigest: resource.verificationDigest,
      },
      data: {
        status: 'degraded',
        verification: nextVerification as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    if (updated.count !== 1) {
      throw new Error('realms_voting_power_challenge_suspension_conflict');
    }
  });

  const postReadback = await reconcileRealmsProviderBindingReadback(prisma, { circleId, now });
  if (!postReadback || postReadback.state !== 'verified' || !postReadback.votingPowerSecurity) {
    throw new Error('realms_voting_power_challenge_post_readback_unavailable');
  }
  const postSecurity = postReadback.votingPowerSecurity;
  const historicalTallyInvariant = hashCanonicalGovernanceValue(
    'alcheme.governance.vote-record-facts',
    preSecurity.voteRecord,
  ) === hashCanonicalGovernanceValue(
    'alcheme.governance.vote-record-facts',
    postSecurity.voteRecord,
  ) ? 'unchanged' : 'conflict';
  if (
    historicalTallyInvariant !== 'unchanged'
    || postSecurity.sameResourceRoot.rootDigest !== preSecurity.sameResourceRoot.rootDigest
    || hashCanonicalGovernanceValue('alcheme.governance.token-owner-record-facts', preSecurity.tokenOwnerRecords)
      !== hashCanonicalGovernanceValue('alcheme.governance.token-owner-record-facts', postSecurity.tokenOwnerRecords)
  ) {
    await (prisma as any).$transaction(async (tx: any) => {
      const resource = await tx.governedResourceBinding.findUnique({
        where: { id: expected.resourceBinding.id },
      });
      const verification = normalizeRecord(resource?.verification);
      const challenge = normalizeRecord(verification.votingPowerChallenge);
      if (
        !resource
        || resource.status !== 'degraded'
        || challenge.state !== 'suspended'
        || challenge.requestId !== request.id
        || challenge.decisionDigest !== decisionDigest
      ) {
        throw new Error('realms_voting_power_challenge_mismatch_owner_conflict');
      }
      const nextVerification = {
        ...verification,
        votingPowerChallenge: {
          ...challenge,
          blocker: 'challenge_superseding_snapshot_required',
          historicalTallyInvariant: 'conflict',
        },
      };
      const updated = await tx.governedResourceBinding.updateMany({
        where: {
          id: resource.id,
          status: 'degraded',
          verificationDigest: resource.verificationDigest,
        },
        data: {
          verification: nextVerification as Prisma.InputJsonValue,
          verificationDigest: hashCanonicalGovernanceValue(
            'alcheme.governance.governed-resource-binding-verification',
            nextVerification,
          ),
        },
      });
      if (updated.count !== 1) {
        throw new Error('realms_voting_power_challenge_mismatch_owner_conflict');
      }
    });
    throw new Error('realms_voting_power_challenge_superseding_snapshot_required');
  }

  await (prisma as any).$transaction(async (tx: any) => {
    const resource = await tx.governedResourceBinding.findUnique({
      where: { id: expected.resourceBinding.id },
    });
    const verification = normalizeRecord(resource?.verification);
    const challenge = normalizeRecord(verification.votingPowerChallenge);
    const reconciliation = normalizeRecord(verification.reconciliation);
    if (
      !resource
      || resource.status !== 'degraded'
      || challenge.state !== 'suspended'
      || challenge.requestId !== request.id
      || challenge.decisionDigest !== decisionDigest
      || reconciliation.state !== 'verified'
      || reconciliation.observedStateDigest !== postReadback.observedStateDigest
      || Number(reconciliation.observedSlot) !== postReadback.observedSlot
    ) {
      throw new Error('realms_voting_power_challenge_reopen_owner_mismatch');
    }
    const votingPowerChallenge = {
      ...challenge,
      state: 'reopened',
      reopenedAt: now.toISOString(),
      blocker: null,
      postReadback: {
        observedSlot: postReadback.observedSlot,
        observedStateDigest: postReadback.observedStateDigest,
        votingPowerProfileDigest: postSecurity.profileDigest,
        voteRecord: postSecurity.voteRecord,
      },
      resolution: 'authoritative_readback_matched_frozen_historical_tally',
      historicalTallyInvariant,
    };
    const nextVerification = { ...verification, votingPowerChallenge };
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        status: 'degraded',
        verificationDigest: resource.verificationDigest,
      },
      data: {
        status: 'active',
        verification: nextVerification as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    if (updated.count !== 1) {
      throw new Error('realms_voting_power_challenge_reopen_conflict');
    }
  });
  return {
    executionStatus: 'executed',
    executionRef: expected.resourceBinding.resourceRef,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_voting_power_challenge_reopened',
      resourceBindingId: expected.resourceBinding.id,
      noProviderTransaction: true,
      preReadback,
      postReadback,
      historicalTallyInvariant,
    },
  };
}

async function executeRealmsProviderRestoreAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('realms_provider_restore_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('realms_provider_restore_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('realms_provider_restore_circle_invalid');
  const expectedPayload = await buildRealmsProviderRestorePayload(prisma, { circleId });
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('realms_provider_restore_evidence_policy_mismatch');
  }
  if (
    hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-restore-payload',
      normalizeRealmsProviderRestorePayload(suppliedPayload),
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-restore-payload',
      { ...expectedPayload, evidencePolicy },
    )
  ) {
    throw new Error('realms_provider_restore_owner_fact_mismatch');
  }
  const reconciliation = await reconcileRealmsProviderBindingReadback(prisma, {
    circleId,
    now,
    allowDisabled: true,
  });
  if (!reconciliation || reconciliation.state !== 'verified') {
    throw new Error(`realms_provider_restore_${reconciliation?.blocker ?? 'readback_unavailable'}`);
  }
  const providerRestore = {
    schemaVersion: 1,
    state: 'restored',
    requestId: request.id,
    decisionDigest,
    restoredAt: now.toISOString(),
    disabledBy: expectedPayload.disabledBy,
    reconciliation: {
      receiptId: reconciliation.receiptId,
      receiptEvidenceDigest: reconciliation.receiptEvidenceDigest,
      observedStateDigest: reconciliation.observedStateDigest,
      observedSlot: reconciliation.observedSlot,
      observedAt: reconciliation.observedAt,
    },
    restorePolicy: expectedPayload.restorePolicy,
  };
  await (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.governedResourceBinding.findUnique({
      where: { id: expectedPayload.resourceBinding.id },
      select: { verification: true, verificationDigest: true, stateDigest: true, status: true },
    });
    const verification = normalizeRecord(current?.verification);
    const providerDisable = normalizeRecord(verification.providerDisable);
    if (
      !current
      || current.status !== 'disabled'
      || providerDisable.requestId !== expectedPayload.disabledBy.requestId
      || providerDisable.decisionDigest !== expectedPayload.disabledBy.decisionDigest
      || normalizeRecord(verification.reconciliation).state !== 'verified'
    ) {
      throw new Error('realms_provider_restore_reconciliation_drift');
    }
    const nextVerification = {
      ...verification,
      activation: 'active',
      providerRestore,
    };
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: expectedPayload.resourceBinding.id,
        homeIdentityBindingId: request.homeIdentityBindingId,
        status: 'disabled',
        verificationDigest: current.verificationDigest,
        stateDigest: current.stateDigest,
      },
      data: {
        status: 'active',
        disabledAt: null,
        verification: nextVerification as unknown as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    if (updated.count !== 1) {
      throw new Error('realms_provider_restore_persistence_conflict');
    }
    const payer = await tx.payerPolicy.updateMany({
      where: {
        homeIdentityBindingId: request.homeIdentityBindingId,
        network: expectedPayload.chainId,
        status: 'inactive',
        fundingBlockerCode: 'provider_binding_disabled',
      },
      data: { status: 'active', fundingBlockerCode: null },
    });
    if (payer.count !== 1) {
      throw new Error('realms_provider_restore_payer_persistence_conflict');
    }
  });
  return {
    executionStatus: 'executed',
    executionRef: expectedPayload.resourceBinding.id,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_provider_binding_restored',
      resourceBindingId: expectedPayload.resourceBinding.id,
      providerRestore,
      noProviderTransaction: true,
      noChainFactRewrite: true,
    },
  };
}

function normalizeRealmsProviderRestorePayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const resourceBinding = normalizeRecord(value.resourceBinding);
  const {
    verificationDigest: _verificationDigest,
    stateDigest: _stateDigest,
    ...governedResourceIdentity
  } = resourceBinding;
  return {
    ...value,
    resourceBinding: governedResourceIdentity,
  };
}

async function executeRealmsProviderDisableAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('realms_provider_disable_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('realms_provider_disable_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('realms_provider_disable_circle_invalid');
  const expectedPayload = await buildRealmsProviderDisablePayload(prisma, { circleId });
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('realms_provider_disable_evidence_policy_mismatch');
  }
  const suppliedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-disable-payload',
    suppliedPayload,
  );
  const expectedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-disable-payload',
    { ...expectedPayload, evidencePolicy },
  );
  if (suppliedDigest !== expectedDigest) {
    throw new Error('realms_provider_disable_owner_fact_mismatch');
  }
  const providerDisable = {
    schemaVersion: 1,
    state: 'disabled',
    requestId: request.id,
    decisionDigest,
    disabledAt: now.toISOString(),
    reason: expectedPayload.reason,
    inFlightDisposition: expectedPayload.inFlightDisposition,
    inFlightDispositionDigest: expectedPayload.inFlightDispositionDigest,
    rollbackPolicy: expectedPayload.rollbackPolicy,
    pauseBoundary: expectedPayload.pauseBoundary,
  };
  const resource = expectedPayload.resourceBinding;
  await (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.governedResourceBinding.findUnique({
      where: { id: resource.id },
      select: {
        verification: true,
        verificationDigest: true,
        stateDigest: true,
        status: true,
      },
    });
    if (!current || current.status !== resource.status) {
      throw new Error('realms_provider_disable_binding_not_found');
    }
    const verification = {
      ...normalizeRecord(current.verification),
      providerDisable,
    };
    const verificationDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.governed-resource-binding-verification',
      verification,
    );
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        homeIdentityBindingId: request.homeIdentityBindingId,
        status: resource.status,
        verificationDigest: current.verificationDigest,
        stateDigest: current.stateDigest,
      },
      data: {
        status: 'disabled',
        disabledAt: now,
        verification: verification as unknown as Prisma.InputJsonValue,
        verificationDigest,
      },
    });
    if (updated.count !== 1) {
      throw new Error('realms_provider_disable_persistence_conflict');
    }
    const payer = await tx.payerPolicy.updateMany({
      where: {
        homeIdentityBindingId: request.homeIdentityBindingId,
        network: expectedPayload.chainId,
        feePayerSignerRef: { not: null },
        status: 'active',
      },
      data: {
        status: 'inactive',
        fundingBlockerCode: 'provider_binding_disabled',
      },
    });
    if (payer.count !== 1) {
      throw new Error('realms_provider_disable_payer_persistence_conflict');
    }
  });
  return {
    executionStatus: 'executed',
    executionRef: resource.id,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_provider_binding_disabled',
      resourceBindingId: resource.id,
      providerDisable,
      noProviderTransaction: true,
      noChainFactRewrite: true,
    },
  };
}

export async function buildRealmsEmergencyOnchainPausePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('emergency_onchain_pause_circle_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('emergency_onchain_pause_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'active',
    },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('emergency_onchain_pause_active_binding_not_found');
  const verification = normalizeRecord(resource.verification);
  const existing = normalizeRecord(verification.emergencyOnchainPause);
  if (
    existing.schemaVersion === 1
    && ['paused', 'unpause_due', 'unpause_blocked', 'rollback_failed'].includes(String(existing.state))
  ) {
    throw new Error('emergency_onchain_pause_already_active');
  }
  const target = normalizeEmergencyOnchainPauseTarget(verification.emergencyOnchainPauseTarget);
  if (!target) throw new Error('emergency_onchain_pause_instruction_unavailable');
  return {
    schemaVersion: 1,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: 'realms_governance' as const,
    contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    resourceBinding: {
      id: resource.id,
      resourceRef: resource.resourceRef,
      ownerProgramRef: resource.ownerProgramRef,
      status: resource.status,
    },
    target,
    pauseEnforcement: 'explicit_unpause_required' as EmergencyOnchainPauseEnforcement,
    trigger: 'governed_emergency_onchain_pause',
    scope: 'resource_onchain_pause_only',
    reason: 'governed_emergency_onchain_pause' as const,
  };
}

async function executeRealmsEmergencyOnchainPauseAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('emergency_onchain_pause_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('emergency_onchain_pause_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('emergency_onchain_pause_circle_invalid');
  const expectedBase = await buildRealmsEmergencyOnchainPausePayload(prisma, { circleId });
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('emergency_onchain_pause_evidence_policy_mismatch');
  }
  if (
    suppliedPayload.trigger !== expectedBase.trigger
    || suppliedPayload.scope !== expectedBase.scope
    || suppliedPayload.pauseEnforcement !== expectedBase.pauseEnforcement
    || suppliedPayload.reason !== expectedBase.reason
  ) {
    throw new Error('emergency_onchain_pause_owner_fact_mismatch');
  }
  const maxDurationSeconds = Number(suppliedPayload.maxDurationSeconds);
  if (!Number.isSafeInteger(maxDurationSeconds) || maxDurationSeconds <= 0) {
    throw new Error('emergency_onchain_pause_max_duration_invalid');
  }
  const transactionSignature = String(suppliedPayload.transactionSignature || '').trim();
  if (!transactionSignature) {
    throw new Error('emergency_onchain_pause_transaction_signature_required');
  }
  if (suppliedPayload.chainPauseEvidence != null) {
    throw new Error('emergency_onchain_pause_client_chain_evidence_forbidden');
  }
  const recoveryConditions = {
    requiresExplicitUnpause: true as const,
    unpauseAuthorityRef: expectedBase.target.unpauseAuthorityRef,
    chainPausedMustBeFalse: true as const,
    fallbackAuthority: 'none' as const,
  };
  const recoveryConditionsDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.emergency-onchain-pause-recovery-conditions',
    recoveryConditions,
  );
  const memberNotification = {
    trigger: expectedBase.trigger,
    scope: expectedBase.scope,
    maxDurationSeconds,
    pauseEnforcement: expectedBase.pauseEnforcement,
    programId: expectedBase.target.programId,
    accountRef: expectedBase.target.accountRef,
  };
  const memberNotificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.emergency-onchain-pause-member-notification',
    memberNotification,
  );
  const ratificationRequestId = request.id;
  const ratificationDecisionDigest = decisionDigest;
  const chainPauseEvidence = await readIndependentEmergencyOnchainPauseEvidence({
    programId: expectedBase.target.programId,
    accountRef: expectedBase.target.accountRef,
    expectedPaused: true,
    transactionSignature,
  });
  const emergencyOnchainPause = buildEmergencyOnchainPauseRecord({
    requestId: request.id,
    decisionDigest,
    activatedAt: now,
    maxDurationSeconds,
    pauseEnforcement: expectedBase.pauseEnforcement,
    trigger: expectedBase.trigger,
    scope: expectedBase.scope,
    target: expectedBase.target,
    memberNotificationDigest,
    ratificationRequestId,
    ratificationDecisionDigest,
    recoveryConditionsDigest,
    chainPauseEvidence,
  });
  const expectedPayload = {
    ...expectedBase,
    maxDurationSeconds,
    pauseEnforcement: expectedBase.pauseEnforcement,
    trigger: expectedBase.trigger,
    scope: expectedBase.scope,
    memberNotificationDigest,
    ratificationRequestId,
    ratificationDecisionDigest,
    recoveryConditionsDigest,
    transactionSignature,
    evidencePolicy,
  };
  const suppliedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-emergency-onchain-pause-payload',
    suppliedPayload,
  );
  const expectedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-emergency-onchain-pause-payload',
    expectedPayload,
  );
  if (suppliedDigest !== expectedDigest) {
    throw new Error('emergency_onchain_pause_owner_fact_mismatch');
  }
  await (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.governedResourceBinding.findUnique({
      where: { id: expectedBase.resourceBinding.id },
      select: {
        verification: true,
        verificationDigest: true,
        stateDigest: true,
        status: true,
      },
    });
    if (!current || current.status !== 'active') {
      throw new Error('emergency_onchain_pause_binding_not_found');
    }
    const verification = {
      ...normalizeRecord(current.verification),
      emergencyOnchainPause,
      emergencyOnchainPauseLastObservation: {
        schemaVersion: 1,
        commitment: 'finalized',
        paused: true,
        observedSlot: chainPauseEvidence.observedSlot,
        receiptRef: chainPauseEvidence.receiptRef,
        observedAt: now.toISOString(),
        authoritative: true,
        selfProvesPause: false,
      },
    };
    const verificationDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.governed-resource-binding-verification',
      verification,
    );
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: expectedBase.resourceBinding.id,
        homeIdentityBindingId: request.homeIdentityBindingId,
        status: 'active',
        verificationDigest: current.verificationDigest,
        stateDigest: current.stateDigest,
      },
      data: {
        verification: verification as unknown as Prisma.InputJsonValue,
        verificationDigest,
      },
    });
    if (updated.count !== 1) {
      throw new Error('emergency_onchain_pause_persistence_conflict');
    }
  });
  return {
    executionStatus: 'executed',
    executionRef: expectedBase.resourceBinding.id,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_emergency_onchain_pause_activated',
      resourceBindingId: expectedBase.resourceBinding.id,
      emergencyOnchainPause,
      workflowFreezeClaimsChainPaused: false,
      providerDisableUnchanged: true,
      independentChainReadback: true,
    },
  };
}

async function executeRealmsEmergencyOnchainUnpauseAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('emergency_onchain_unpause_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('emergency_onchain_unpause_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('emergency_onchain_unpause_circle_invalid');
  const profile = getRealmsProviderTrustProfile();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('emergency_onchain_unpause_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: { in: ['active', 'disabled'] },
    },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('emergency_onchain_unpause_binding_not_found');
  const verification = normalizeRecord(resource.verification);
  const currentPause = normalizeEmergencyOnchainPauseRecord(verification.emergencyOnchainPause);
  if (!currentPause) {
    throw new Error('emergency_onchain_unpause_active_pause_missing');
  }
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('emergency_onchain_unpause_evidence_policy_mismatch');
  }
  if (suppliedPayload.chainPauseEvidence != null) {
    throw new Error('emergency_onchain_unpause_client_chain_evidence_forbidden');
  }
  const transactionSignature = String(suppliedPayload.transactionSignature || '').trim();
  if (!transactionSignature) {
    throw new Error('emergency_onchain_unpause_transaction_signature_required');
  }
  const expectedPayload = {
    schemaVersion: 1,
    resourceBindingId: resource.id,
    pauseRequestId: currentPause.requestId,
    transactionSignature,
    evidencePolicy,
  };
  const suppliedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-emergency-onchain-unpause-payload',
    suppliedPayload,
  );
  const expectedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-emergency-onchain-unpause-payload',
    expectedPayload,
  );
  if (suppliedDigest !== expectedDigest) {
    throw new Error('emergency_onchain_unpause_owner_fact_mismatch');
  }
  const chainPauseEvidence = await readIndependentEmergencyOnchainPauseEvidence({
    programId: currentPause.programId,
    accountRef: currentPause.accountRef,
    expectedPaused: false,
    transactionSignature,
  });
  const emergencyOnchainPause = applyEmergencyOnchainUnpause(currentPause, {
    requestId: request.id,
    decisionDigest,
    completedAt: now,
    chainPauseEvidence,
  });
  await (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.governedResourceBinding.findUnique({
      where: { id: resource.id },
      select: {
        verification: true,
        verificationDigest: true,
        stateDigest: true,
        status: true,
      },
    });
    if (!current) throw new Error('emergency_onchain_unpause_binding_not_found');
    const nextVerification = {
      ...normalizeRecord(current.verification),
      emergencyOnchainPause,
      emergencyOnchainPauseLastObservation: {
        schemaVersion: 1,
        commitment: 'finalized',
        paused: false,
        observedSlot: chainPauseEvidence.observedSlot,
        receiptRef: chainPauseEvidence.receiptRef,
        observedAt: now.toISOString(),
        authoritative: true,
        selfProvesPause: false,
      },
    };
    const verificationDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.governed-resource-binding-verification',
      nextVerification,
    );
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        homeIdentityBindingId: request.homeIdentityBindingId,
        verificationDigest: current.verificationDigest,
        stateDigest: current.stateDigest,
      },
      data: {
        verification: nextVerification as unknown as Prisma.InputJsonValue,
        verificationDigest,
      },
    });
    if (updated.count !== 1) {
      throw new Error('emergency_onchain_unpause_persistence_conflict');
    }
  });
  return {
    executionStatus: 'executed',
    executionRef: resource.id,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_emergency_onchain_pause_unpaused',
      resourceBindingId: resource.id,
      emergencyOnchainPause,
      workflowFreezeClaimsChainPaused: false,
      independentChainReadback: true,
    },
  };
}

async function executeRealmsProgramUpgradeAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) {
    throw new Error('program_upgrade_home_identity_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('program_upgrade_decision_digest_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('program_upgrade_circle_invalid');
  const profile = getRealmsProviderTrustProfile();
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) throw new Error('program_upgrade_home_not_found');
  const resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'active',
    },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) throw new Error('program_upgrade_active_binding_not_found');
  const verification = normalizeRecord(resource.verification);
  const targetSeed = normalizeRecord(verification.programUpgradeTarget);
  if (targetSeed.schemaVersion !== 1) {
    throw new Error('program_upgrade_target_unavailable');
  }
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('program_upgrade_evidence_policy_mismatch');
  }
  if (suppliedPayload.chainObservation != null) {
    throw new Error('program_upgrade_client_chain_observation_forbidden');
  }
  const mode = suppliedPayload.mode === 'finalize' ? 'finalize' as const : 'verify' as const;
  const transactionSignature = mode === 'finalize'
    ? String(suppliedPayload.transactionSignature || '').trim()
    : undefined;
  if (mode === 'finalize' && !transactionSignature) {
    throw new Error('program_upgrade_transaction_signature_required');
  }
  const contract = buildProgramUpgradeContract({
    genesisHash: String(targetSeed.genesisHash || profile.chain.genesisHash),
    current: {
      programId: String(targetSeed.programId || profile.deployment.programId),
      programDataAddress: String(targetSeed.programDataAddress || profile.deployment.programDataAddress),
      deploySlot: Number(targetSeed.deploySlot ?? profile.deployment.lastDeployedSlot),
      codeSha256: String(targetSeed.codeSha256 || profile.deployment.deployedProgramBytesSha256),
      upgradeAuthority: String(targetSeed.upgradeAuthority || profile.deployment.upgradeAuthority),
    },
    codeRelease: {
      repository: String(suppliedPayload.repository || targetSeed.repository),
      commit: String(suppliedPayload.commit || targetSeed.commit),
      buildArtifactSha256: String(suppliedPayload.buildArtifactSha256 || targetSeed.buildArtifactSha256),
      buildArtifactSize: Number(suppliedPayload.buildArtifactSize ?? targetSeed.buildArtifactSize),
      auditStatus: (suppliedPayload.auditStatus || targetSeed.auditStatus) as 'passed' | 'waived_with_digest',
      auditDigest: String(suppliedPayload.auditDigest || targetSeed.auditDigest),
    },
    buffer: {
      address: String(suppliedPayload.bufferAddress || targetSeed.bufferAddress),
      authority: String(suppliedPayload.bufferAuthority || targetSeed.bufferAuthority),
      codeSha256: String(suppliedPayload.bufferCodeSha256 || targetSeed.bufferCodeSha256),
      size: Number(suppliedPayload.bufferSize ?? targetSeed.bufferSize),
    },
    spill: {
      recipient: String(suppliedPayload.spillRecipient || targetSeed.spillRecipient),
      accountMetasDigest: String(suppliedPayload.accountMetasDigest || targetSeed.accountMetasDigest),
      instructionDigest: String(suppliedPayload.instructionDigest || targetSeed.instructionDigest),
    },
    target: {
      postDeployCodeSha256: String(
        suppliedPayload.postDeployCodeSha256 || targetSeed.postDeployCodeSha256,
      ),
      postDeploySlotMin: Number(suppliedPayload.postDeploySlotMin ?? targetSeed.postDeploySlotMin),
      postUpgradeAuthority: String(
        suppliedPayload.postUpgradeAuthority || targetSeed.postUpgradeAuthority,
      ),
      bufferCloseExpected: true,
    },
    disposition: {
      upgradeAuthorityDisposition: String(
        suppliedPayload.upgradeAuthorityDisposition || targetSeed.upgradeAuthorityDisposition || 'revoke',
      ) as ProgramUpgradeAuthorityDisposition,
    },
  });
  const observation = await readIndependentProgramUpgradeObservation({
    programId: contract.current.programId,
    programDataAddress: contract.current.programDataAddress,
    bufferAddress: contract.buffer.address,
    transactionSignature,
  });
  const programUpgrade = buildProgramUpgradeRecord({
    requestId: request.id,
    decisionDigest,
    activatedAt: now,
    contract,
    observation,
    mode,
  });
  const expectedPayload = {
    schemaVersion: 1,
    mode,
    repository: contract.codeRelease.repository,
    commit: contract.codeRelease.commit,
    buildArtifactSha256: contract.codeRelease.buildArtifactSha256,
    buildArtifactSize: contract.codeRelease.buildArtifactSize,
    auditStatus: contract.codeRelease.auditStatus,
    auditDigest: contract.codeRelease.auditDigest,
    bufferAddress: contract.buffer.address,
    bufferAuthority: contract.buffer.authority,
    bufferCodeSha256: contract.buffer.codeSha256,
    bufferSize: contract.buffer.size,
    spillRecipient: contract.spill.recipient,
    accountMetasDigest: contract.spill.accountMetasDigest,
    instructionDigest: contract.spill.instructionDigest,
    postDeployCodeSha256: contract.target.postDeployCodeSha256,
    postDeploySlotMin: contract.target.postDeploySlotMin,
    postUpgradeAuthority: contract.target.postUpgradeAuthority,
    upgradeAuthorityDisposition: contract.disposition.upgradeAuthorityDisposition,
    upgradePayloadDigest: contract.upgradePayloadDigest,
    ...(mode === 'finalize' ? { transactionSignature } : {}),
    evidencePolicy,
  };
  const suppliedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-program-upgrade-payload',
    suppliedPayload,
  );
  const expectedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-program-upgrade-payload',
    expectedPayload,
  );
  if (suppliedDigest !== expectedDigest) {
    throw new Error('program_upgrade_owner_fact_mismatch');
  }
  await (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.governedResourceBinding.findUnique({
      where: { id: resource.id },
      select: {
        verification: true,
        verificationDigest: true,
        stateDigest: true,
        status: true,
      },
    });
    if (!current || current.status !== 'active') {
      throw new Error('program_upgrade_binding_not_found');
    }
    const nextVerification = {
      ...normalizeRecord(current.verification),
      programUpgrade,
      programUpgradeLastObservation: {
        ...observation,
        observedAt: now.toISOString(),
      },
    };
    const verificationDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.governed-resource-binding-verification',
      nextVerification,
    );
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        homeIdentityBindingId: request.homeIdentityBindingId,
        status: 'active',
        verificationDigest: current.verificationDigest,
        stateDigest: current.stateDigest,
      },
      data: {
        verification: nextVerification as unknown as Prisma.InputJsonValue,
        verificationDigest,
      },
    });
    if (updated.count !== 1) {
      throw new Error('program_upgrade_persistence_conflict');
    }
  });
  return {
    executionStatus: programUpgrade.state === 'compromised' || programUpgrade.state === 'verification_blocked'
      ? 'failed'
      : 'executed',
    executionRef: resource.id,
    errorCode: programUpgrade.state === 'compromised'
      ? 'program_upgrade_post_state_mismatch'
      : programUpgrade.state === 'verification_blocked'
        ? 'program_upgrade_buffer_verification_failed'
        : null,
    executionEvidence: {
      schemaVersion: 1,
      effect: programUpgrade.state === 'finalized'
        ? 'realms_program_upgrade_finalized'
        : programUpgrade.state === 'verified'
          ? 'realms_program_upgrade_verified'
          : 'realms_program_upgrade_not_executed',
      resourceBindingId: resource.id,
      programUpgrade,
      executedShown: false,
      independentChainReadback: true,
    },
  };
}

async function executeRealmsProviderBootstrapAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
    source?: GovernanceRequestExecutionSource;
  },
): Promise<GovernanceActionExecutionOutcome> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle') {
    throw new Error('realms_provider_bootstrap_target_mismatch');
  }
  if (!request.homeIdentityBindingId || !request.invocationId) {
    throw new Error('realms_provider_bootstrap_runtime_owner_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('realms_provider_bootstrap_decision_digest_invalid');
  }
  if (!Number.isFinite(now.getTime())) {
    throw new Error('realms_provider_bootstrap_time_invalid');
  }
  const circleId = parsePositiveInteger(request.targetRef);
  if (!circleId) throw new Error('realms_provider_bootstrap_circle_invalid');
  const suppliedPayload = normalizeRecord(request.payload);
  const evidencePolicy = suppliedPayload.evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
    || evidencePolicy.packages.length !== 0
  ) {
    throw new Error('realms_provider_bootstrap_evidence_policy_mismatch');
  }
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-action-intent',
    suppliedPayload,
  );
  const attemptKey = `realms-provider-bootstrap:${request.id}:v1`;
  const existingPreflight = await prisma.costPreflight.findUnique({
    where: {
      invocationId_attemptKey: {
        invocationId: request.invocationId,
        attemptKey,
      },
    },
    include: { payerPolicy: true },
  });
  if (existingPreflight) {
    if (
      existingPreflight.actionIntentDigest !== actionIntentDigest
      || existingPreflight.payerPolicy.sourceRequestId !== request.id
      || existingPreflight.payerPolicy.sourceDecisionDigest !== decisionDigest
    ) {
      throw new Error('realms_provider_bootstrap_preflight_idempotency_conflict');
    }
  }

  const suppliedPayerAuthorization = normalizeRecord(suppliedPayload.payerAuthorization);
  const sourcePayerPolicyId = typeof suppliedPayerAuthorization.currentPolicyId === 'string'
    ? suppliedPayerAuthorization.currentPolicyId
    : undefined;
  const expectedPayload = await buildRealmsProviderBootstrapPayload(prisma, {
    circleId,
    retryRequestId: existingPreflight ? request.id : undefined,
    sourcePayerPolicyId: existingPreflight ? sourcePayerPolicyId : undefined,
  });
  const expectedPayloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-bootstrap-payload',
    { ...expectedPayload, evidencePolicy },
  );
  const suppliedPayloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-bootstrap-payload',
    suppliedPayload,
  );
  if (suppliedPayloadDigest !== expectedPayloadDigest) {
    throw new Error('realms_provider_bootstrap_contract_mismatch');
  }
  const payerAuthorization = expectedPayload.payerAuthorization;
  const actionScope = {
    schemaVersion: 1,
    actionType: REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
    chainId: expectedPayload.chainId,
    profileRef: expectedPayload.profileRef,
    profileVersion: expectedPayload.profileVersion,
    resourceBindingId: expectedPayload.resourceBinding.id,
    operations: expectedPayload.providerIntent.operations,
    noRealAssets: true,
  };
  const actionScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy-action-scope',
    actionScope,
  );
  const payerPolicyId = stableId('realms-bootstrap-payer', request.id);
  const singleLimit = {
    lamports: payerAuthorization.singleTransactionLimitLamports,
    scope: 'per_transaction',
    includes: ['fee', 'rent'],
  };
  const periodLimit = {
    lamports: payerAuthorization.totalBootstrapLimitLamports,
    scope: 'initial_realm_bootstrap',
    maximumWalletBalanceLamports: payerAuthorization.maximumWalletBalanceLamports,
  };
  const policyDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy',
    {
      id: payerPolicyId,
      homeIdentityBindingId: request.homeIdentityBindingId,
      version: payerAuthorization.nextVersion,
      network: expectedPayload.chainId,
      actionScope,
      economicBearer: payerAuthorization.economicBearer,
      feePayerSignerRef: payerAuthorization.feePayerSignerRef,
      singleLimit,
      periodLimit,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      status: 'active',
    },
  );
  const preflightId = stableId('realms-cost-preflight', request.id);
  const checkedAt = new Date(now);
  const expiresAt = new Date(checkedAt.getTime() + 300_000);
  const estimatedCost = {
    status: 'pending_rpc_quote',
    singleTransactionLimitLamports: payerAuthorization.singleTransactionLimitLamports,
    totalBootstrapLimitLamports: payerAuthorization.totalBootstrapLimitLamports,
  };
  const quoteContext = {
    schemaVersion: 1,
    chainId: expectedPayload.chainId,
    profileRef: expectedPayload.profileRef,
    profileVersion: expectedPayload.profileVersion,
    resourceBindingId: expectedPayload.resourceBinding.id,
    commitment: expectedPayload.providerIntent.commitment,
    resubmitPolicy: expectedPayload.providerIntent.resubmitPolicy,
  };
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.cost-preflight',
    {
      id: preflightId,
      invocationId: request.invocationId,
      payerPolicyRef: payerPolicyId,
      attemptKey,
      estimatedCost,
      quoteContext,
      status: 'pending',
      checkedAt: checkedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      actionIntentDigest,
    },
  );

  if (!existingPreflight) await prisma.$transaction(async (tx) => {
    const sourcePayer = await tx.payerPolicy.findUnique({
      where: { id: payerAuthorization.currentPolicyId },
    });
    if (
      !sourcePayer
      || sourcePayer.homeIdentityBindingId !== request.homeIdentityBindingId
      || sourcePayer.status !== 'inactive'
      || sourcePayer.fundingBlockerCode !== 'devnet_fee_cap_required'
      || sourcePayer.supersededAt
    ) {
      throw new Error('realms_provider_bootstrap_source_payer_mismatch');
    }
    await tx.payerPolicy.create({
      data: {
        id: payerPolicyId,
        homeIdentityBindingId: request.homeIdentityBindingId!,
        version: payerAuthorization.nextVersion,
        network: expectedPayload.chainId,
        actionScope: actionScope as Prisma.InputJsonValue,
        actionScopeDigest,
        economicBearer: payerAuthorization.economicBearer,
        feePayerSignerRef: payerAuthorization.feePayerSignerRef,
        rentFundingSourceRef: payerAuthorization.feePayerSignerRef,
        refundRecipientRef: payerAuthorization.feePayerSignerRef,
        relayerRef: null,
        singleLimit: singleLimit as Prisma.InputJsonValue,
        periodLimit: periodLimit as Prisma.InputJsonValue,
        expiry: null,
        fundingBlockerCode: null,
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
        policyDigest,
        status: 'active',
        effectiveFrom: checkedAt,
        supersededAt: null,
      },
    });
    const superseded = await tx.payerPolicy.updateMany({
      where: {
        id: sourcePayer.id,
        status: 'inactive',
        supersededAt: null,
      },
      data: { status: 'superseded', supersededAt: checkedAt },
    });
    if (superseded.count !== 1) {
      throw new Error('realms_provider_bootstrap_source_payer_conflict');
    }
    await tx.costPreflight.create({
      data: {
        id: preflightId,
        invocationId: request.invocationId!,
        payerPolicyRef: payerPolicyId,
        assetAuthorityPolicyRef: null,
        attemptKey,
        estimatedCost: estimatedCost as Prisma.InputJsonValue,
        reservationRef: null,
        quoteContext: quoteContext as Prisma.InputJsonValue,
        status: 'pending',
        checkedAt,
        expiresAt,
        actionIntentDigest,
        transactionAttemptDigest: null,
        preflightDigest,
      },
    });
  });

  const baselinePreflight = await prisma.costPreflight.findUnique({
    where: {
      invocationId_attemptKey: {
        invocationId: request.invocationId,
        attemptKey,
      },
    },
    include: { payerPolicy: true },
  });
  if (
    !baselinePreflight
    || baselinePreflight.actionIntentDigest !== actionIntentDigest
    || baselinePreflight.payerPolicyRef !== payerPolicyId
    || baselinePreflight.payerPolicy.policyDigest !== policyDigest
  ) {
    throw new Error('realms_provider_bootstrap_preflight_owner_mismatch');
  }
  const fundingAmendment = input.source === 'manual_retry'
    ? await resolveGovernanceFundingAmendmentRetryPreflight(prisma, {
      originalRequestId: request.id,
      originalDecisionDigest: decisionDigest,
      invocationId: request.invocationId,
      actionIntentDigest,
      baselinePreflight,
    })
    : null;
  const preflight = fundingAmendment?.preflight ?? baselinePreflight;
  if (!fundingAmendment && !['pending', 'ready', 'consumed'].includes(preflight.status)) {
    throw new Error('realms_provider_bootstrap_preflight_owner_mismatch');
  }
  const providerCheckpoint = normalizeProviderCheckpoint(preflight.estimatedCost);
  let latestProviderCheckpoint = providerCheckpoint;
  const authorities = Object.fromEntries(
    expectedPayload.authorityBindings.map((binding) => [binding.role, {
      keyRef: binding.keyRef,
      publicKey: binding.publicKey,
    }]),
  ) as RealmsDevnetBootstrapContract['authorities'];
  const providerContract: RealmsDevnetBootstrapContract = {
    requestId: request.id,
    decisionDigest,
    actionIntentDigest,
    circleId,
    chainId: expectedPayload.chainId,
    profileRef: expectedPayload.profileRef,
    profileVersion: expectedPayload.profileVersion,
    programId: expectedPayload.providerIntent.programId,
    realmName: expectedPayload.providerIntent.realmName,
    communityMintDecimals: expectedPayload.providerIntent.communityMintDecimals,
    proposerWeight: expectedPayload.providerIntent.proposerWeight,
    voterWeight: expectedPayload.providerIntent.voterWeight,
    voteThresholdPercentage: expectedPayload.providerIntent.voteThresholdPercentage,
    baseVotingTimeSeconds: expectedPayload.providerIntent.baseVotingTimeSeconds,
    voteTipping: expectedPayload.providerIntent.voteTipping,
    approvedInstruction: expectedPayload.providerIntent.approvedInstruction,
    authorities,
  };
  const profile = getRealmsProviderTrustProfile();
  if (preflight.status === 'consumed') {
    const consumed = normalizeConsumedProviderEvidence(preflight.estimatedCost);
    const [resource, activeAuthorityCount] = await Promise.all([
      prisma.governedResourceBinding.findUnique({
        where: { id: expectedPayload.resourceBinding.id },
      }),
      prisma.resourceAuthorityBinding.count({
        where: {
          governedResourceBindingId: expectedPayload.resourceBinding.id,
          status: 'active',
          providerResourceRef: consumed.accountGraph.resourceRef,
          stateDigest: consumed.accountGraph.stateDigest,
        },
      }),
    ]);
    if (
      !resource
      || resource.status !== 'active'
      || resource.resourceRef !== consumed.accountGraph.resourceRef
      || resource.stateDigest !== consumed.accountGraph.stateDigest
      || activeAuthorityCount !== expectedPayload.authorityBindings.length
      || consumed.providerReceipt.chainId !== expectedPayload.chainId
      || consumed.providerReceipt.profileRef !== expectedPayload.profileRef
      || consumed.providerReceipt.profileVersion !== expectedPayload.profileVersion
      || consumed.providerReceipt.providerFinality !== 'finalized'
    ) {
      throw new Error('realms_provider_bootstrap_consumed_readback_mismatch');
    }
    return {
      executionStatus: 'executed',
      executionRef: consumed.accountGraph.resourceRef,
      errorCode: null,
      executionEvidence: {
        schemaVersion: 1,
        effect: 'realms_devnet_no_asset_vertical_finalized',
        resourceBindingId: expectedPayload.resourceBinding.id,
        payerPolicyId: preflight.payerPolicyRef,
        preflightId: preflight.id,
        providerReceipt: consumed.providerReceipt,
        accountGraph: consumed.accountGraph,
        expiredAttemptHistory: projectExpiredAttemptHistory(consumed.providerCheckpoint),
        replay: 'canonical_consumed_readback',
      },
    };
  }
  const connection = createRealmsDevnetConnection(
    profile.readback.rpc.endpoint,
    profile.readback.timeoutMs,
  );
  const providerReceipt = await executeRealmsDevnetBootstrap(
    providerContract,
    {
      singleTransactionLimitLamports: parseLamports(
        String(fundingAmendment?.singleLimit.lamports
          ?? payerAuthorization.singleTransactionLimitLamports),
      ),
      totalBootstrapLimitLamports: parseLamports(
        String(fundingAmendment?.periodLimit.lamports
          ?? payerAuthorization.totalBootstrapLimitLamports),
      ),
      maximumWalletBalanceLamports: parseLamports(
        payerAuthorization.maximumWalletBalanceLamports,
      ),
    },
    {
      connection,
      verifyTrustProfile: verifyRealmsProviderTrustProfileReadback,
      sign: ({ role, operation, message }) => signRealmsOpenBaoCanonicalMessage(prisma, {
        circleId,
        requestId: request.id,
        decisionDigest,
        actionIntentDigest,
        role,
        operation,
        message,
      }),
      checkpoint: async (checkpoint) => {
        latestProviderCheckpoint = checkpoint;
        const providerAttemptInventory = realmsProviderAttemptInventory(
          checkpoint,
          actionIntentDigest,
          preflight.payerPolicyRef,
        );
        const updated = await prisma.costPreflight.updateMany({
          where: {
            id: preflight.id,
            actionIntentDigest,
            status: { in: ['pending', 'ready'] },
          },
          data: {
            estimatedCost: {
              ...estimatedCost,
              status: 'provider_in_progress',
              providerCheckpoint: checkpoint as unknown as Prisma.InputJsonValue,
              providerAttemptInventory: providerAttemptInventory as unknown as Prisma.InputJsonValue,
            } as unknown as Prisma.InputJsonValue,
            balanceReadback: checkpoint.funding as unknown as Prisma.InputJsonValue,
            transactionAttemptDigest: providerAttemptInventory.latestAttemptDigest,
            status: 'ready',
          },
        });
        if (updated.count !== 1) {
          throw new Error('realms_provider_bootstrap_checkpoint_conflict');
        }
      },
      allowExpiredAttemptRebuild: input.source === 'manual_retry',
    },
    providerCheckpoint,
  );
  const accountGraph = await readRealmsDevnetAccountGraph(
    connection,
    providerContract,
    providerReceipt,
    profile.readback.slotConvergenceWindow,
  );
  const currentResourceOwner = await prisma.governedResourceBinding.findUnique({
    where: { id: expectedPayload.resourceBinding.id },
  });
  if (
    !currentResourceOwner
    || currentResourceOwner.status !== 'pending_custody'
    || currentResourceOwner.resourceRef !== null
    || currentResourceOwner.profileRef !== expectedPayload.profileRef
    || currentResourceOwner.profileVersion !== expectedPayload.profileVersion
  ) {
    throw new Error('realms_provider_bootstrap_resource_owner_mismatch');
  }
  const activationVerification = {
    ...normalizeRecord(currentResourceOwner.verification),
    schemaVersion: 1,
    profileDigest: expectedPayload.profileDigest,
    providerReceipt,
    accountGraph,
    resourceReadback: 'verified_finalized',
    custodyStatus: 'verified_wallet_keys_provider_active',
    activation: 'active',
    activatedAt: now.toISOString(),
  };
  const activationVerificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    activationVerification,
  );
  await prisma.$transaction(async (tx) => {
    const resource = await tx.governedResourceBinding.updateMany({
      where: {
        id: expectedPayload.resourceBinding.id,
        homeIdentityBindingId: request.homeIdentityBindingId!,
        status: 'pending_custody',
        resourceRef: null,
        verificationDigest: currentResourceOwner.verificationDigest,
      },
      data: {
        resourceRef: accountGraph.resourceRef,
        verification: activationVerification as unknown as Prisma.InputJsonValue,
        verificationDigest: activationVerificationDigest,
        verifiedSlot: BigInt(accountGraph.observedSlot),
        stateDigest: accountGraph.stateDigest,
        status: 'active',
        activatedAt: now,
      },
    });
    if (resource.count !== 1) {
      const existing = await tx.governedResourceBinding.findUnique({
        where: { id: expectedPayload.resourceBinding.id },
      });
      if (
        !existing
        || existing.status !== 'active'
        || existing.resourceRef !== accountGraph.resourceRef
        || existing.stateDigest !== accountGraph.stateDigest
      ) {
        throw new Error('realms_provider_bootstrap_resource_activation_conflict');
      }
    }
    const authoritiesUpdated = await tx.resourceAuthorityBinding.updateMany({
      where: {
        governedResourceBindingId: expectedPayload.resourceBinding.id,
        status: 'pending_provider_bootstrap',
      },
      data: {
        providerResourceRef: accountGraph.resourceRef,
        verifiedSlot: BigInt(accountGraph.observedSlot),
        stateDigest: accountGraph.stateDigest,
        status: 'active',
        activatedAt: now,
      },
    });
    if (authoritiesUpdated.count !== expectedPayload.authorityBindings.length) {
      const activeCount = await tx.resourceAuthorityBinding.count({
        where: {
          governedResourceBindingId: expectedPayload.resourceBinding.id,
          status: 'active',
          providerResourceRef: accountGraph.resourceRef,
          stateDigest: accountGraph.stateDigest,
        },
      });
      if (activeCount !== expectedPayload.authorityBindings.length) {
        throw new Error('realms_provider_bootstrap_authority_activation_conflict');
      }
    }
    const consumed = await tx.costPreflight.updateMany({
      where: {
        id: preflight.id,
        status: { in: ['pending', 'ready'] },
        actionIntentDigest,
      },
      data: {
        estimatedCost: {
          ...estimatedCost,
          status: 'consumed',
          providerCheckpoint: latestProviderCheckpoint as unknown as Prisma.InputJsonValue,
          providerReceipt,
          accountGraph,
          providerAttemptInventory: latestProviderCheckpoint
            ? realmsProviderAttemptInventory(
                latestProviderCheckpoint,
                actionIntentDigest,
                preflight.payerPolicyRef,
              )
            : null,
        } as unknown as Prisma.InputJsonValue,
        balanceReadback: {
          finalBalanceLamports: providerReceipt.finalBalanceLamports,
          totalSpendLamports: providerReceipt.totalSpendLamports,
          providerFinality: providerReceipt.providerFinality,
        } as Prisma.InputJsonValue,
        reservationRef: accountGraph.resourceRef,
        transactionAttemptDigest: latestProviderCheckpoint
          ? realmsProviderAttemptInventory(
              latestProviderCheckpoint,
              actionIntentDigest,
              preflight.payerPolicyRef,
            ).latestAttemptDigest
          : null,
        status: 'consumed',
      },
    });
    if (consumed.count !== 1) {
      const existing = await tx.costPreflight.findUnique({ where: { id: preflight.id } });
      if (existing?.status !== 'consumed' || existing.reservationRef !== accountGraph.resourceRef) {
        throw new Error('realms_provider_bootstrap_preflight_consumption_conflict');
      }
    }
  });
  return {
    executionStatus: 'executed',
    executionRef: accountGraph.resourceRef,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'realms_devnet_no_asset_vertical_finalized',
      resourceBindingId: expectedPayload.resourceBinding.id,
      payerPolicyId,
      preflightId: preflight.id,
      providerReceipt,
      accountGraph,
      expiredAttemptHistory: projectExpiredAttemptHistory(latestProviderCheckpoint),
    },
  };
}

export interface RealmsProviderBindingReconciliationReadback {
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
  accountSemantics: {
    signatoryRecord: 'not_applicable_direct_governance_authority_signoff';
    voterWeightAddin: 'not_configured';
    maxVoterWeightAddin: 'not_configured';
    customPlugins: 'unavailable';
  } | null;
  votingPowerSecurity: RealmsVotingPowerSecurityProfile | null;
  observedAt: string;
}

export interface RealmsProviderProfileRevalidationReadback {
  schemaVersion: 1;
  state: 'hold';
  blocker: 'provider_profile_revalidation_required';
  authority: 'frozen_provider_trust_profile';
  resourceBindingId: string;
  triggers: Array<'profile_ref_drift' | 'profile_version_drift' | 'profile_digest_drift' | 'program_drift'>;
  current: {
    profileRef: string;
    profileVersion: number;
    profileDigest: string | null;
    ownerProgramRef: string | null;
  };
  target: {
    profileRef: string;
    profileVersion: number;
    profileDigest: string;
    ownerProgramRef: string;
    decoderConformance: 'selected_accounts_verified';
  };
  transitionPolicy: 'governed_transition_plan_pin_suspend_reopen';
  executionDisposition: 'blocked';
  observedAt: string;
}

interface RealmsProviderIncidentEvent {
  schemaVersion: 1;
  incidentId: string;
  lifecycleState: 'suspected' | 'confirmed' | 'contained' | 'reconciled';
  authority: 'independent_provider_readback';
  resourceBindingId: string;
  receiptId: string;
  originalReceiptEvidenceDigest: string;
  expectedStateDigest: string;
  observedStateDigest: string | null;
  observedSlot: number | null;
  blocker: RealmsProviderBindingReconciliationReadback['blocker'];
  occurredAt: string;
  previousEventDigest: string | null;
  supersedesEventDigest: string | null;
  eventDigest: string;
}

interface RealmsProviderIncidentLedger {
  schemaVersion: 1;
  events: RealmsProviderIncidentEvent[];
}

function providerIncidentEventDigest(
  event: Omit<RealmsProviderIncidentEvent, 'eventDigest'>,
): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-incident-event-v1',
    event,
  );
}

function existingProviderIncidentLedger(verification: Record<string, unknown>): RealmsProviderIncidentLedger | null {
  const value = normalizeRecord(verification.providerIncidentLedger);
  if (Object.keys(value).length === 0) return null;
  if (value.schemaVersion !== 1 || !Array.isArray(value.events)) {
    throw new Error('realms_provider_incident_ledger_invalid');
  }
  let previousEventDigest: string | null = null;
  const openIncidents = new Map<string, RealmsProviderIncidentEvent>();
  const events = value.events.map((raw): RealmsProviderIncidentEvent => {
    const event = normalizeRecord(raw) as unknown as RealmsProviderIncidentEvent;
    const facts = { ...event } as Partial<RealmsProviderIncidentEvent>;
    delete facts.eventDigest;
    if (
      event.schemaVersion !== 1
      || !/^[a-f0-9]{64}$/.test(String(event.incidentId ?? ''))
      || !['suspected', 'confirmed', 'contained', 'reconciled'].includes(String(event.lifecycleState))
      || event.authority !== 'independent_provider_readback'
      || typeof event.resourceBindingId !== 'string'
      || typeof event.receiptId !== 'string'
      || !/^[a-f0-9]{64}$/.test(String(event.originalReceiptEvidenceDigest ?? ''))
      || !/^[a-f0-9]{64}$/.test(String(event.expectedStateDigest ?? ''))
      || !Number.isFinite(new Date(event.occurredAt).getTime())
      || event.previousEventDigest !== previousEventDigest
      || event.eventDigest !== providerIncidentEventDigest(
        facts as Omit<RealmsProviderIncidentEvent, 'eventDigest'>,
      )
    ) {
      throw new Error('realms_provider_incident_ledger_invalid');
    }
    if (event.lifecycleState === 'suspected') {
      if (
        openIncidents.has(event.incidentId)
        || !['provider_readback_outage', 'provider_readback_conflict'].includes(String(event.blocker))
        || event.observedStateDigest !== null
        || event.observedSlot !== null
        || event.supersedesEventDigest !== null
      ) throw new Error('realms_provider_incident_ledger_invalid');
      openIncidents.set(event.incidentId, event);
    } else if (event.lifecycleState === 'confirmed' || event.lifecycleState === 'contained') {
      const previous = openIncidents.get(event.incidentId);
      if (
        !previous
        || (event.lifecycleState === 'confirmed' && previous.lifecycleState !== 'suspected')
        || (event.lifecycleState === 'contained' && previous.lifecycleState !== 'confirmed')
        || (event.lifecycleState === 'confirmed'
          && new Date(event.occurredAt).getTime() <= new Date(previous.occurredAt).getTime())
        || (event.lifecycleState === 'contained'
          && event.occurredAt !== previous.occurredAt)
        || event.blocker !== previous.blocker
        || event.originalReceiptEvidenceDigest !== previous.originalReceiptEvidenceDigest
        || event.expectedStateDigest !== previous.expectedStateDigest
        || event.observedStateDigest !== null
        || event.observedSlot !== null
        || event.supersedesEventDigest !== previous.eventDigest
      ) throw new Error('realms_provider_incident_ledger_invalid');
      openIncidents.set(event.incidentId, event);
    } else {
      const open = openIncidents.get(event.incidentId);
      if (
        !open
        || event.blocker !== null
        || !/^[a-f0-9]{64}$/.test(String(event.observedStateDigest ?? ''))
        || !Number.isSafeInteger(event.observedSlot)
        || Number(event.observedSlot) <= 0
        || event.supersedesEventDigest !== open.eventDigest
      ) throw new Error('realms_provider_incident_ledger_invalid');
      openIncidents.delete(event.incidentId);
    }
    previousEventDigest = event.eventDigest;
    return event;
  });
  return { schemaVersion: 1, events };
}

function evolveProviderIncidentLedger(
  verification: Record<string, unknown>,
  reconciliation: RealmsProviderBindingReconciliationReadback,
): RealmsProviderIncidentLedger | null {
  const existing = existingProviderIncidentLedger(verification);
  const events = existing ? [...existing.events] : [];
  const latestByIncident = new Map<string, RealmsProviderIncidentEvent>();
  for (const event of events) latestByIncident.set(event.incidentId, event);
  const open = [...latestByIncident.values()].find((event) => event.lifecycleState !== 'reconciled');
  if (reconciliation.state === 'hold' && !open) {
    const incidentId = hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-incident-id-v1',
      {
        resourceBindingId: reconciliation.resourceBindingId,
        receiptId: reconciliation.receiptId,
        originalReceiptEvidenceDigest: reconciliation.receiptEvidenceDigest,
        expectedStateDigest: reconciliation.expectedStateDigest,
        blocker: reconciliation.blocker,
        suspectedAt: reconciliation.observedAt,
      },
    );
    const facts: Omit<RealmsProviderIncidentEvent, 'eventDigest'> = {
      schemaVersion: 1,
      incidentId,
      lifecycleState: 'suspected',
      authority: 'independent_provider_readback',
      resourceBindingId: reconciliation.resourceBindingId,
      receiptId: reconciliation.receiptId,
      originalReceiptEvidenceDigest: reconciliation.receiptEvidenceDigest,
      expectedStateDigest: reconciliation.expectedStateDigest,
      observedStateDigest: null,
      observedSlot: null,
      blocker: reconciliation.blocker,
      occurredAt: reconciliation.observedAt,
      previousEventDigest: events.at(-1)?.eventDigest ?? null,
      supersedesEventDigest: null,
    };
    events.push({ ...facts, eventDigest: providerIncidentEventDigest(facts) });
  } else if (
    reconciliation.state === 'hold'
    && open?.lifecycleState === 'suspected'
    && open.blocker === reconciliation.blocker
    && new Date(reconciliation.observedAt).getTime() > new Date(open.occurredAt).getTime()
  ) {
    const confirmedFacts: Omit<RealmsProviderIncidentEvent, 'eventDigest'> = {
      schemaVersion: 1,
      incidentId: open.incidentId,
      lifecycleState: 'confirmed',
      authority: 'independent_provider_readback',
      resourceBindingId: reconciliation.resourceBindingId,
      receiptId: reconciliation.receiptId,
      originalReceiptEvidenceDigest: open.originalReceiptEvidenceDigest,
      expectedStateDigest: reconciliation.expectedStateDigest,
      observedStateDigest: null,
      observedSlot: null,
      blocker: reconciliation.blocker,
      occurredAt: reconciliation.observedAt,
      previousEventDigest: events.at(-1)?.eventDigest ?? null,
      supersedesEventDigest: open.eventDigest,
    };
    const confirmed = {
      ...confirmedFacts,
      eventDigest: providerIncidentEventDigest(confirmedFacts),
    };
    events.push(confirmed);
    const containedFacts: Omit<RealmsProviderIncidentEvent, 'eventDigest'> = {
      ...confirmedFacts,
      lifecycleState: 'contained',
      previousEventDigest: confirmed.eventDigest,
      supersedesEventDigest: confirmed.eventDigest,
    };
    events.push({
      ...containedFacts,
      eventDigest: providerIncidentEventDigest(containedFacts),
    });
  } else if (reconciliation.state === 'verified' && open) {
    const facts: Omit<RealmsProviderIncidentEvent, 'eventDigest'> = {
      schemaVersion: 1,
      incidentId: open.incidentId,
      lifecycleState: 'reconciled',
      authority: 'independent_provider_readback',
      resourceBindingId: reconciliation.resourceBindingId,
      receiptId: reconciliation.receiptId,
      originalReceiptEvidenceDigest: open.originalReceiptEvidenceDigest,
      expectedStateDigest: reconciliation.expectedStateDigest,
      observedStateDigest: reconciliation.observedStateDigest,
      observedSlot: reconciliation.observedSlot,
      blocker: null,
      occurredAt: reconciliation.observedAt,
      previousEventDigest: events.at(-1)?.eventDigest ?? null,
      supersedesEventDigest: open.eventDigest,
    };
    events.push({ ...facts, eventDigest: providerIncidentEventDigest(facts) });
  }
  return events.length > 0 ? { schemaVersion: 1, events } : null;
}

function currentConcurrentVerifiedReconciliation(
  current: any,
  expected: {
    resource: any;
    receiptId: string;
    receiptEvidenceDigest: string;
    expectedStateDigest: string;
    profile: ReturnType<typeof getRealmsProviderTrustProfile>;
    expectedKeyContracts: Map<string, { keyRef: string }>;
  },
): RealmsProviderBindingReconciliationReadback | null {
  if (
    !current
    || current.id !== expected.resource.id
    || current.homeIdentityBindingId !== expected.resource.homeIdentityBindingId
    || current.network !== expected.resource.network
    || current.provider !== expected.resource.provider
    || current.capability !== expected.resource.capability
    || current.contractVersion !== expected.resource.contractVersion
    || current.profileRef !== expected.profile.profileRef
    || current.profileVersion !== expected.profile.version
    || current.resourceRef !== expected.resource.resourceRef
    || current.ownerProgramRef !== expected.resource.ownerProgramRef
    || current.status !== 'active'
    || typeof current.stateDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(current.stateDigest)
  ) return null;

  const reconciliation = normalizeRecord(
    normalizeRecord(current.verification).reconciliation,
  );
  const accountSemantics = normalizeRecord(reconciliation.accountSemantics);
  const votingPowerSecurity = reconciliation.votingPowerSecurity;
  const observedSlot = Number(reconciliation.observedSlot);
  const verifiedSlot = Number(current.verifiedSlot);
  const observedAt = new Date(String(reconciliation.observedAt ?? ''));
  if (
    reconciliation.schemaVersion !== 1
    || reconciliation.state !== 'verified'
    || reconciliation.blocker !== null
    || reconciliation.authority !== 'independent_provider_readback'
    || reconciliation.resourceBindingId !== current.id
    || reconciliation.receiptId !== expected.receiptId
    || reconciliation.receiptEvidenceDigest !== expected.receiptEvidenceDigest
    || reconciliation.expectedStateDigest !== expected.expectedStateDigest
    || reconciliation.observedStateDigest !== current.stateDigest
    || !Number.isSafeInteger(observedSlot)
    || observedSlot <= 0
    || !Number.isSafeInteger(verifiedSlot)
    || verifiedSlot !== observedSlot
    || !Number.isFinite(observedAt.getTime())
    || accountSemantics.signatoryRecord !== 'not_applicable_direct_governance_authority_signoff'
    || accountSemantics.voterWeightAddin !== 'not_configured'
    || accountSemantics.maxVoterWeightAddin !== 'not_configured'
    || accountSemantics.customPlugins !== 'unavailable'
    || !isCurrentRealmsVotingPowerSecurityProfile(votingPowerSecurity)
    || votingPowerSecurity.source.chainId !== expected.profile.chain.chainId
    || votingPowerSecurity.source.profileRef !== expected.profile.profileRef
    || votingPowerSecurity.source.profileVersion !== expected.profile.version
    || votingPowerSecurity.source.programId !== expected.profile.deployment.programId
    || votingPowerSecurity.source.realm !== current.resourceRef
    || votingPowerSecurity.source.snapshotSlot !== observedSlot
  ) return null;

  const authorityBindings = Array.isArray(current.authorityBindings)
    ? current.authorityBindings
    : [];
  if (
    authorityBindings.length !== expected.expectedKeyContracts.size
    || authorityBindings.some((binding: any) => {
      const contract = expected.expectedKeyContracts.get(binding.authorityRole);
      return !contract
        || binding.keyRef !== contract.keyRef
        || binding.status !== 'active'
        || binding.providerResourceRef !== current.resourceRef
        || binding.profileRef !== expected.profile.profileRef
        || binding.profileVersion !== expected.profile.version
        || binding.stateDigest !== current.stateDigest
        || Number(binding.verifiedSlot) !== observedSlot;
    })
  ) return null;

  return reconciliation as unknown as RealmsProviderBindingReconciliationReadback;
}

export async function reconcileRealmsProviderBindingReadback(
  prisma: PrismaClient,
  input: {
    circleId: number;
    now?: Date;
    readAccountGraph?: typeof readRealmsDevnetAccountGraph;
    allowDisabled?: boolean;
  },
): Promise<RealmsProviderBindingReconciliationReadback | RealmsProviderProfileRevalidationReadback | null> {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('realms_provider_reconciliation_circle_invalid');
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error('realms_provider_reconciliation_time_invalid');
  }
  const profile = getRealmsProviderTrustProfile();
  const readiness = resolveRealmsProviderTrustReadiness();
  const db = prisma as any;
  if (
    !db.governanceHomeIdentityBinding?.findFirst
    || !db.governedResourceBinding?.findFirst
  ) return null;
  const home = await db.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
  if (!home) return null;
  let resource = await db.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: 'realms_governance',
      contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: { in: input.allowDisabled ? ['active', 'degraded', 'disabled'] : ['active', 'degraded'] },
      resourceRef: { not: null },
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
  });
  if (!resource) {
    resource = await db.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: 'realms_governance',
        contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
        status: { in: input.allowDisabled ? ['active', 'degraded', 'disabled'] : ['active', 'degraded'] },
        resourceRef: { not: null },
      },
      include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
      orderBy: [{ profileVersion: 'desc' }, { updatedAt: 'desc' }],
    });
  }
  if (!resource) return null;
  const resourceVerification = normalizeRecord(resource.verification);
  const profileRevalidationTriggers: RealmsProviderProfileRevalidationReadback['triggers'] = [];
  if (resource.profileRef !== profile.profileRef) profileRevalidationTriggers.push('profile_ref_drift');
  if (resource.profileVersion !== profile.version) profileRevalidationTriggers.push('profile_version_drift');
  if (resourceVerification.profileDigest !== readiness.profileDigest) {
    profileRevalidationTriggers.push('profile_digest_drift');
  }
  if (resource.ownerProgramRef !== profile.deployment.programId) {
    profileRevalidationTriggers.push('program_drift');
  }
  if (profileRevalidationTriggers.length > 0) {
    const profileRevalidation: RealmsProviderProfileRevalidationReadback = {
      schemaVersion: 1,
      state: 'hold',
      blocker: 'provider_profile_revalidation_required',
      authority: 'frozen_provider_trust_profile',
      resourceBindingId: resource.id,
      triggers: profileRevalidationTriggers,
      current: {
        profileRef: resource.profileRef,
        profileVersion: resource.profileVersion,
        profileDigest: /^[a-f0-9]{64}$/.test(String(resourceVerification.profileDigest ?? ''))
          ? String(resourceVerification.profileDigest)
          : null,
        ownerProgramRef: resource.ownerProgramRef,
      },
      target: {
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        profileDigest: readiness.profileDigest,
        ownerProgramRef: profile.deployment.programId,
        decoderConformance: readiness.decoderConformance,
      },
      transitionPolicy: 'governed_transition_plan_pin_suspend_reopen',
      executionDisposition: 'blocked',
      observedAt: now.toISOString(),
    };
    const verification = { ...resourceVerification, profileRevalidation };
    const verificationDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.governed-resource-binding-verification',
      verification,
    );
    const updated = await db.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        verificationDigest: resource.verificationDigest,
        status: resource.status,
      },
      data: {
        verification: verification as unknown as Prisma.InputJsonValue,
        verificationDigest,
        status: resource.status === 'disabled' ? 'disabled' : 'degraded',
      },
    });
    if (updated.count !== 1) {
      throw new Error('realms_provider_profile_revalidation_persistence_conflict');
    }
    return profileRevalidation;
  }
  const receipt = await db.governanceExecutionReceipt.findFirst({
    where: {
      executorModule: 'realms_provider_binding',
      executionStatus: 'executed',
      executionEvidence: {
        path: ['effect'],
        equals: 'realms_devnet_no_asset_vertical_finalized',
      },
      AND: [{
        executionEvidence: {
          path: ['resourceBindingId'],
          equals: resource.id,
        },
      }],
    },
    include: { request: true },
    orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
  });
  if (!receipt) throw new Error('realms_provider_reconciliation_receipt_not_found');

  const evidence = normalizeRecord(receipt.executionEvidence);
  const providerReceipt = normalizeRecord(evidence.providerReceipt);
  const priorAccountGraph = normalizeRecord(evidence.accountGraph);
  const plan = normalizeRecord(providerReceipt.plan);
  const addresses = normalizeRecord(plan.addresses);
  const requestPayload = normalizeRecord(receipt.request?.payload);
  const providerIntent = normalizeRecord(requestPayload.providerIntent);
  const receiptEvidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-receipt-evidence',
    evidence,
  );
  const expectedStateDigest = String(priorAccountGraph.stateDigest ?? '');
  const persistedVerification = normalizeRecord(resource.verification);
  const persistedReconciliation = normalizeRecord(persistedVerification.reconciliation);
  const persistedVerifiedDigestMatches = (
    persistedReconciliation.schemaVersion === 1
    && persistedReconciliation.state === 'verified'
    && persistedReconciliation.blocker === null
    && persistedReconciliation.authority === 'independent_provider_readback'
    && persistedReconciliation.resourceBindingId === resource.id
    && persistedReconciliation.receiptId === receipt.id
    && persistedReconciliation.receiptEvidenceDigest === receiptEvidenceDigest
    && persistedReconciliation.expectedStateDigest === expectedStateDigest
    && persistedReconciliation.observedStateDigest === resource.stateDigest
    && Number.isSafeInteger(persistedReconciliation.observedSlot)
    && Number(persistedReconciliation.observedSlot) > 0
  );
  const authorityDigestsMatchCurrent = (
    typeof resource.stateDigest === 'string'
    && /^[a-f0-9]{64}$/.test(resource.stateDigest)
    && resource.authorityBindings.every((binding: any) => (
      binding.stateDigest === resource.stateDigest
    ))
  );
  if (
    evidence.schemaVersion !== 1
    || evidence.effect !== 'realms_devnet_no_asset_vertical_finalized'
    || evidence.resourceBindingId !== resource.id
    || receipt.executionEvidenceDigest !== receiptEvidenceDigest
    || !/^[a-f0-9]{64}$/.test(String(receipt.decisionDigest ?? ''))
    || providerReceipt.schemaVersion !== 1
    || providerReceipt.chainId !== profile.chain.chainId
    || providerReceipt.profileRef !== profile.profileRef
    || providerReceipt.profileVersion !== profile.version
    || providerReceipt.providerFinality !== 'finalized'
    || !Array.isArray(providerReceipt.transactions)
    || providerReceipt.transactions.length === 0
    || providerReceipt.transactions.some((raw) => {
      const transaction = normalizeRecord(raw);
      return !Number.isSafeInteger(transaction.slot)
        || Number(transaction.slot) <= 0
        || !validRealmsProviderFinalityTransitions(
          transaction.finalityTransitions,
          Number(transaction.slot),
        )
        || (transaction.finalityTransitions as Array<{ state?: unknown }>).at(-1)?.state
          !== 'finalized';
    })
    || addresses.realm !== resource.resourceRef
    || priorAccountGraph.status !== 'verified_finalized'
    || priorAccountGraph.resourceRef !== resource.resourceRef
    || !/^[a-f0-9]{64}$/.test(expectedStateDigest)
    || !(
      expectedStateDigest === resource.stateDigest
      || persistedVerifiedDigestMatches
      || authorityDigestsMatchCurrent
    )
    || receipt.request?.targetRef !== String(input.circleId)
    || providerIntent.programId !== profile.deployment.programId
    || typeof providerIntent.realmName !== 'string'
    || providerIntent.realmName.length === 0
    || providerIntent.communityMintDecimals !== 0
    || providerIntent.proposerWeight !== '1'
    || providerIntent.voterWeight !== '2'
    || providerIntent.voteThresholdPercentage !== 50
    || providerIntent.baseVotingTimeSeconds !== 3600
    || providerIntent.voteTipping !== 'early'
    || providerIntent.approvedInstruction !== 'system_program_zero_lamport_executor_self_transfer'
  ) {
    throw new Error('realms_provider_reconciliation_owner_fact_mismatch');
  }

  const expectedKeyContracts = new Map(
    profile.keyCustodyRecord.keyContracts.map((contract) => [contract.role, contract]),
  );
  const authorities = Object.fromEntries(
    resource.authorityBindings.map((binding: any) => {
      const contract = expectedKeyContracts.get(binding.authorityRole);
      let publicKey: string;
      try {
        publicKey = new PublicKey(binding.currentAuthority).toBase58();
      } catch {
        throw new Error('realms_provider_reconciliation_authority_invalid');
      }
      if (
        !contract
        || binding.keyRef !== contract.keyRef
        || binding.status !== 'active'
      ) {
        throw new Error('realms_provider_reconciliation_authority_invalid');
      }
      return [binding.authorityRole, { keyRef: binding.keyRef, publicKey }];
    }),
  ) as RealmsDevnetBootstrapContract['authorities'];
  if (
    resource.authorityBindings.length !== expectedKeyContracts.size
    || Object.keys(authorities).length !== expectedKeyContracts.size
  ) {
    throw new Error('realms_provider_reconciliation_authority_invalid');
  }
  const contract: RealmsDevnetBootstrapContract = {
    requestId: receipt.requestId,
    decisionDigest: receipt.decisionDigest,
    actionIntentDigest: String(
      normalizeRecord(
        await db.costPreflight.findFirst({
          where: {
            reservationRef: resource.resourceRef,
            status: 'consumed',
          },
          select: { actionIntentDigest: true },
        }),
      ).actionIntentDigest ?? '',
    ),
    circleId: input.circleId,
    chainId: profile.chain.chainId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    programId: profile.deployment.programId,
    realmName: providerIntent.realmName,
    communityMintDecimals: 0,
    proposerWeight: '1',
    voterWeight: '2',
    voteThresholdPercentage: 50,
    baseVotingTimeSeconds: 3600,
    voteTipping: 'early',
    approvedInstruction: 'system_program_zero_lamport_executor_self_transfer',
    authorities,
  };
  if (!/^[a-f0-9]{64}$/.test(contract.actionIntentDigest)) {
    throw new Error('realms_provider_reconciliation_action_intent_missing');
  }

  let observed: RealmsDevnetAccountGraphReadback | null = null;
  let blocker: RealmsProviderBindingReconciliationReadback['blocker'] = null;
  try {
    const readAccountGraph = input.readAccountGraph ?? readRealmsDevnetAccountGraph;
    observed = await readAccountGraph(
      createRealmsDevnetConnection(profile.readback.rpc.endpoint, profile.readback.timeoutMs),
      contract,
      providerReceipt as unknown as RealmsDevnetBootstrapProviderReceipt,
      profile.readback.slotConvergenceWindow,
    );
    if (
      observed.resourceRef !== resource.resourceRef
      || observed.ownerProgramRef !== resource.ownerProgramRef
      || !isCurrentRealmsVotingPowerSecurityProfile(observed.votingPowerSecurity)
      || observed.votingPowerSecurity.source.chainId !== profile.chain.chainId
      || observed.votingPowerSecurity.source.profileRef !== profile.profileRef
      || observed.votingPowerSecurity.source.profileVersion !== profile.version
      || observed.votingPowerSecurity.source.programId !== profile.deployment.programId
      || observed.votingPowerSecurity.source.realm !== resource.resourceRef
      || observed.votingPowerSecurity.source.snapshotSlot !== observed.observedSlot
    ) {
      blocker = 'provider_readback_conflict';
      observed = null;
    }
  } catch (error) {
    blocker = classifyRealmsProviderReconciliationBlocker(error);
  }

  const reconciliation: RealmsProviderBindingReconciliationReadback = {
    schemaVersion: 1,
    state: observed ? 'verified' : 'hold',
    blocker,
    authority: 'independent_provider_readback',
    resourceBindingId: resource.id,
    receiptId: receipt.id,
    receiptEvidenceDigest,
    expectedStateDigest,
    observedStateDigest: observed?.stateDigest ?? null,
    observedSlot: observed?.observedSlot ?? null,
    accountSemantics: observed
      ? {
        signatoryRecord: observed.signatoryRecord,
        voterWeightAddin: observed.voterWeightAddin,
        maxVoterWeightAddin: observed.maxVoterWeightAddin,
        customPlugins: observed.customPlugins,
      }
      : null,
    votingPowerSecurity: observed?.votingPowerSecurity ?? null,
    observedAt: now.toISOString(),
  };
  const persistedVerificationRecord = normalizeRecord(resource.verification);
  const providerIncidentLedger = evolveProviderIncidentLedger(
    persistedVerificationRecord,
    reconciliation,
  );
  const verification = {
    ...persistedVerificationRecord,
    resourceReadback: observed ? 'verified_finalized' : blocker,
    reconciliation,
    ...(providerIncidentLedger ? { providerIncidentLedger } : {}),
  };
  const verificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    verification,
  );
  const challengeSuspended = normalizeRecord(
    normalizeRecord(resource.verification).votingPowerChallenge,
  ).state === 'suspended';
  const reconciliationResult = await db.$transaction(async (
    tx: any,
  ): Promise<RealmsProviderBindingReconciliationReadback> => {
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        verificationDigest: resource.verificationDigest,
        status: resource.status,
      },
      data: {
        verification: verification as unknown as Prisma.InputJsonValue,
        verificationDigest,
        status: resource.status === 'disabled'
          ? 'disabled'
          : observed
            ? challengeSuspended ? 'degraded' : 'active'
            : 'degraded',
        ...(observed ? {
          verifiedSlot: BigInt(observed.observedSlot),
          stateDigest: observed.stateDigest,
        } : {}),
      },
    });
    if (updated.count !== 1) {
      // A concurrent readback may have committed the same canonical receipt/profile first.
      // Converge only to that fully verified winner; every ownership or finality drift remains a conflict.
      const current = await tx.governedResourceBinding.findUnique({
        where: { id: resource.id },
        include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
      });
      const concurrentWinner = currentConcurrentVerifiedReconciliation(current, {
        resource,
        receiptId: receipt.id,
        receiptEvidenceDigest,
        expectedStateDigest,
        profile,
        expectedKeyContracts,
      });
      if (!concurrentWinner) {
        throw new Error('realms_provider_reconciliation_persistence_conflict');
      }
      return concurrentWinner;
    }
    if (observed) {
      const updatedAuthorities = await tx.resourceAuthorityBinding.updateMany({
        where: {
          governedResourceBindingId: resource.id,
          providerResourceRef: resource.resourceRef,
          profileRef: profile.profileRef,
          profileVersion: profile.version,
          status: 'active',
        },
        data: {
          verifiedSlot: BigInt(observed.observedSlot),
          stateDigest: observed.stateDigest,
        },
      });
      if (updatedAuthorities.count !== expectedKeyContracts.size) {
        throw new Error('realms_provider_reconciliation_authority_persistence_conflict');
      }
    }
    return reconciliation;
  });
  return reconciliationResult;
}

function classifyRealmsProviderReconciliationBlocker(
  error: unknown,
): 'provider_readback_outage' | 'provider_readback_conflict' {
  const code = error instanceof Error ? error.message : '';
  return code.startsWith('realms_provider_account_graph_')
    ? 'provider_readback_conflict'
    : 'provider_readback_outage';
}

export interface RealmsOpenBaoKeyReadback {
  keyRef: string;
  publicKey: string;
}

export interface RealmsOpenBaoApplicationIdentityReadback {
  authMethod: 'openbao_periodic_token';
  credentialRef: string;
  policyName: 'alcheme-realms-devnet-runtime-current';
  tokenPeriodSeconds: 86400;
  tokenAccessor: string;
  lastVerifiedAt: string;
}

export async function recordRealmsOpenBaoKeyReadback(
  prisma: PrismaClient,
  input: {
    keys: RealmsOpenBaoKeyReadback[];
    applicationIdentity: RealmsOpenBaoApplicationIdentityReadback;
    now?: Date;
  },
): Promise<{
  resourceBindingId: string;
  homeIdentityBindingId: string;
  keyCount: number;
  payerBlockerCode: 'devnet_fee_cap_required';
}> {
  const profile = getRealmsProviderTrustProfile();
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error('realms_openbao_key_readback_time_invalid');
  }
  const applicationIdentity = normalizeRealmsOpenBaoApplicationIdentity(
    input.applicationIdentity,
  );
  const expectedContracts = new Map(
    profile.keyCustodyRecord.keyContracts.map((contract) => [contract.keyRef, contract]),
  );
  if (input.keys.length !== expectedContracts.size) {
    throw new Error('realms_openbao_key_readback_inventory_mismatch');
  }
  const supplied = new Map<string, string>();
  for (const key of input.keys) {
    if (!expectedContracts.has(key.keyRef) || supplied.has(key.keyRef)) {
      throw new Error('realms_openbao_key_readback_inventory_mismatch');
    }
    let publicKey: string;
    try {
      publicKey = new PublicKey(key.publicKey).toBase58();
    } catch {
      throw new Error('realms_openbao_public_key_invalid');
    }
    supplied.set(key.keyRef, publicKey);
  }
  if (new Set(supplied.values()).size !== supplied.size) {
    throw new Error('realms_openbao_role_key_separation_required');
  }
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.governedResourceBinding.findMany({
      where: {
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: 'realms_governance',
        contractVersion: REALMS_PROVIDER_BINDING_CONTRACT_VERSION,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: 'pending_custody',
      },
      include: {
        authorityBindings: { orderBy: { authorityRole: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (candidates.length !== 1) {
      throw new Error('realms_openbao_key_readback_single_runtime_owner_required');
    }
    const resource = candidates[0];
    if (resource.authorityBindings.length !== expectedContracts.size) {
      throw new Error('realms_openbao_key_readback_owner_inventory_mismatch');
    }
    for (const binding of resource.authorityBindings) {
      const contract = expectedContracts.get(binding.keyRef);
      const publicKey = supplied.get(binding.keyRef);
      if (
        !contract
        || !publicKey
        || binding.authorityRole !== contract.role
        || binding.custodyProvider !== profile.keyCustodyRecord.signerProvider
        || (binding.currentAuthority !== null && binding.currentAuthority !== publicKey)
      ) {
        throw new Error('realms_openbao_key_readback_owner_mismatch');
      }
      const updated = await tx.resourceAuthorityBinding.updateMany({
        where: {
          id: binding.id,
          OR: [{ currentAuthority: null }, { currentAuthority: publicKey }],
        },
        data: {
          currentAuthority: publicKey,
          custodyStatus: 'verified',
          status: 'pending_provider_bootstrap',
        },
      });
      if (updated.count !== 1) {
        throw new Error('realms_openbao_key_readback_owner_conflict');
      }
    }
    const verification = normalizeRecord(resource.verification);
    const keyReadback = [...supplied.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyRef, publicKey]) => ({ keyRef, publicKey }));
    const nextVerification = {
      ...verification,
      custodyStatus: 'verified_wallet_keys_pending_provider',
      keyReadbackDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.realms-openbao-key-readback',
        keyReadback,
      ),
      keyReadbackVerifiedAt: now.toISOString(),
      applicationIdentity: { ...applicationIdentity },
    };
    await tx.governedResourceBinding.update({
      where: { id: resource.id },
      data: {
        verification: nextVerification as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    const payer = await tx.payerPolicy.findUnique({
      where: { sourceRequestId: resource.sourceRequestId },
    });
    if (!payer || payer.status !== 'inactive') {
      throw new Error('realms_openbao_key_readback_payer_owner_mismatch');
    }
    await tx.payerPolicy.update({
      where: { id: payer.id },
      data: { fundingBlockerCode: 'devnet_fee_cap_required' },
    });
    return {
      resourceBindingId: resource.id,
      homeIdentityBindingId: resource.homeIdentityBindingId,
      keyCount: supplied.size,
      payerBlockerCode: 'devnet_fee_cap_required' as const,
    };
  });
}

function normalizeRealmsOpenBaoApplicationIdentity(
  value: RealmsOpenBaoApplicationIdentityReadback,
): RealmsOpenBaoApplicationIdentityReadback {
  const lastVerifiedAt = new Date(value?.lastVerifiedAt);
  if (
    value?.authMethod !== 'openbao_periodic_token'
    || value?.credentialRef
      !== 'macos-keychain:Alcheme Governance OS OpenBao Devnet/realms-runtime-application-token'
    || value?.policyName !== 'alcheme-realms-devnet-runtime-current'
    || value?.tokenPeriodSeconds !== 86400
    || typeof value?.tokenAccessor !== 'string'
    || !/^[A-Za-z0-9._-]{8,160}$/.test(value.tokenAccessor)
    || !Number.isFinite(lastVerifiedAt.getTime())
  ) {
    throw new Error('realms_openbao_application_identity_readback_invalid');
  }
  return {
    authMethod: value.authMethod,
    credentialRef: value.credentialRef,
    policyName: value.policyName,
    tokenPeriodSeconds: value.tokenPeriodSeconds,
    tokenAccessor: value.tokenAccessor,
    lastVerifiedAt: lastVerifiedAt.toISOString(),
  };
}

function assertExistingBindingMatches(
  existing: {
    id: string;
    sourceDecisionDigest: string;
    verificationDigest: string;
    authorityBindings: unknown[];
  },
  expected: {
    resourceBindingId: string;
    authorityCount: number;
    decisionDigest: string;
    verificationDigest: string;
  },
): void {
  if (
    existing.id !== expected.resourceBindingId
    || existing.sourceDecisionDigest !== expected.decisionDigest
    || existing.verificationDigest !== expected.verificationDigest
    || existing.authorityBindings.length !== expected.authorityCount
  ) {
    throw new Error('realms_provider_binding_idempotency_conflict');
  }
}

function stableId(prefix: string, requestId: string): string {
  const digest = hashCanonicalGovernanceValue('alcheme.governance.runtime-id', {
    prefix,
    requestId,
  });
  return `${prefix}:${digest.slice(0, 48)}`;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLamports(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error('realms_provider_bootstrap_payer_limit_invalid');
  }
  return parsed;
}

function normalizeProviderCheckpoint(value: unknown): RealmsDevnetBootstrapCheckpoint | null {
  const estimatedCost = normalizeRecord(value);
  const checkpoint = estimatedCost.providerCheckpoint;
  if (checkpoint === undefined) return null;
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new Error('realms_provider_bootstrap_checkpoint_invalid');
  }
  return checkpoint as RealmsDevnetBootstrapCheckpoint;
}

function normalizeDelegationProviderCheckpoint(
  value: unknown,
): RealmsDevnetDelegationCheckpoint | null {
  const estimatedCost = normalizeRecord(value);
  const checkpoint = estimatedCost.providerCheckpoint;
  if (checkpoint === undefined) return null;
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new Error('realms_provider_delegation_checkpoint_invalid');
  }
  const candidate = checkpoint as RealmsDevnetDelegationCheckpoint;
  const rawSteps = Array.isArray(candidate.steps) ? candidate.steps : [];
  const canonicalSteps = [...new Set(rawSteps.map((step) => step.id))].map((id) => {
    const matching = rawSteps.filter((step) => step.id === id);
    if (matching.length === 1) return matching[0];
    const progressed = matching.filter((step) => step.status !== 'quoted');
    const quoted = matching.filter((step) => step.status === 'quoted');
    if (
      matching.length !== 2
      || progressed.length !== 1
      || quoted.length !== 1
      || progressed[0].manifestDigest !== quoted[0].manifestDigest
      || quoted[0].signature !== undefined
      || quoted[0].readback !== undefined
      || quoted[0].finalityTransitions.length !== 0
    ) {
      throw new Error('realms_provider_delegation_checkpoint_invalid');
    }
    return progressed[0];
  });
  const canonical = { ...candidate, steps: canonicalSteps };
  if (!validRealmsDevnetDelegationCheckpoint(canonical)) {
    throw new Error('realms_provider_delegation_checkpoint_invalid');
  }
  return canonical;
}

function normalizeConsumedDelegationEvidence(
  value: unknown,
): RealmsDevnetDelegationProviderReceipt {
  const estimatedCost = normalizeRecord(value);
  const receipt = normalizeRecord(estimatedCost.providerReceipt);
  const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : [];
  if (
    receipt.schemaVersion !== 1
    || receipt.chainId !== 'solana:devnet'
    || receipt.providerFinality !== 'finalized'
    || receipt.historicalVoteInvariant !== 'unchanged'
    || receipt.finalDelegate !== null
    || !/^[a-f0-9]{64}$/.test(String(receipt.planDigest ?? ''))
    || transactions.length !== 2
    || transactions.some((raw) => {
      const transaction = normalizeRecord(raw);
      return !['set_governance_delegate', 'revoke_governance_delegate'].includes(
        String(transaction.stepId),
      ) || !Number.isSafeInteger(transaction.slot)
        || Number(transaction.slot) <= 0
        || !validRealmsProviderFinalityTransitions(
          transaction.finalityTransitions,
          Number(transaction.slot),
        );
    })
  ) {
    throw new Error('realms_provider_delegation_consumed_evidence_invalid');
  }
  return receipt as unknown as RealmsDevnetDelegationProviderReceipt;
}

function normalizeConsumedProviderEvidence(value: unknown): {
  providerReceipt: RealmsDevnetBootstrapProviderReceipt;
  accountGraph: RealmsDevnetAccountGraphReadback;
  providerCheckpoint: RealmsDevnetBootstrapCheckpoint | null;
} {
  const estimatedCost = normalizeRecord(value);
  const providerReceipt = normalizeRecord(estimatedCost.providerReceipt);
  const accountGraph = normalizeRecord(estimatedCost.accountGraph);
  const providerCheckpoint = estimatedCost.providerCheckpoint;
  const transactions = Array.isArray(providerReceipt.transactions)
    ? providerReceipt.transactions
    : [];
  const plan = normalizeRecord(providerReceipt.plan);
  if (
    providerReceipt.schemaVersion !== 1
    || providerReceipt.chainId !== 'solana:devnet'
    || providerReceipt.providerFinality !== 'finalized'
    || !Array.isArray(providerReceipt.transactions)
    || transactions.length === 0
    || transactions.some((raw) => {
      const transaction = normalizeRecord(raw);
      return !Number.isSafeInteger(transaction.slot)
        || Number(transaction.slot) <= 0
        || !validRealmsProviderFinalityTransitions(
          transaction.finalityTransitions,
          Number(transaction.slot),
        )
        || (transaction.finalityTransitions as Array<{ state?: unknown }>).at(-1)?.state
          !== 'finalized';
    })
    || typeof plan.planDigest !== 'string'
    || (providerCheckpoint !== undefined && (
      !validRealmsDevnetBootstrapCheckpoint(providerCheckpoint, plan.planDigest)
      || providerCheckpoint.steps.some((step) => step.status !== 'finalized')
    ))
    || accountGraph.schemaVersion !== 1
    || accountGraph.status !== 'verified_finalized'
    || typeof accountGraph.resourceRef !== 'string'
    || typeof accountGraph.stateDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(accountGraph.stateDigest)
  ) {
    throw new Error('realms_provider_bootstrap_consumed_evidence_invalid');
  }
  return {
    providerReceipt: providerReceipt as unknown as RealmsDevnetBootstrapProviderReceipt,
    accountGraph: accountGraph as unknown as RealmsDevnetAccountGraphReadback,
    providerCheckpoint: providerCheckpoint == null
      ? null
      : providerCheckpoint as RealmsDevnetBootstrapCheckpoint,
  };
}

function projectExpiredAttemptHistory(
  checkpoint: RealmsDevnetBootstrapCheckpoint | null,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight_checkpoint',
    attempts: (checkpoint?.expiredAttempts ?? []).map((attempt) => ({
      stepId: attempt.stepId,
      manifestDigest: attempt.manifestDigest,
      messageDigest: attempt.messageDigest,
      recentBlockhash: attempt.recentBlockhash,
      lastValidBlockHeight: attempt.lastValidBlockHeight,
      expiredAtBlockHeight: attempt.expiredAtBlockHeight,
      disposition: attempt.disposition,
    })),
  };
}

function realmsProviderAttemptInventory(
  checkpoint: RealmsDevnetBootstrapCheckpoint | RealmsDevnetDelegationCheckpoint,
  actionIntentDigest: string,
  payerPolicyId: string,
) {
  const expiredAttempts = 'expiredAttempts' in checkpoint
    && Array.isArray(checkpoint.expiredAttempts)
    ? checkpoint.expiredAttempts.map((attempt) => ({ ...attempt, status: 'expired' }))
    : [];
  return buildProviderTransactionAttemptInventory({
    providerModule: 'realms_provider_binding',
    actionIntentDigest,
    payerPolicyId,
    attempts: [
      ...expiredAttempts,
      ...checkpoint.steps.map((attempt) => ({
        ...attempt,
        stepId: attempt.id,
      })),
    ],
  });
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('realms_provider_bootstrap_allowed_operations_invalid');
  }
  return [...new Set(value)].sort();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
