import { createHash } from 'node:crypto';

import type { Prisma, PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';

import {
  SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
  SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
  SQUADS_PROVIDER_DISABLE_ACTION_TYPE,
  SQUADS_PROVIDER_RESTORE_ACTION_TYPE,
  GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { isCurrentGovernanceCaseFrozenEvidencePolicy } from './governanceEvidenceShare';
import {
  readSquadsOpenBaoRuntimeKeyInventory,
  signSquadsOpenBaoCanonicalMessage,
} from './realmsOpenBaoRuntimeReadback';
import {
  createSquadsDevnetConnection,
  executeSquadsGrantPayout,
  executeSquadsDevnetVertical,
  readNextSquadsGrantPayoutTransactionIndex,
  readExistingSquadsDevnetResource,
  readSquadsDevnetAccountGraph,
  validSquadsDevnetCheckpoint,
  type SquadsDevnetAccountGraphReadback,
  type SquadsDevnetCheckpoint,
  type SquadsDevnetContract,
  type SquadsDevnetProviderReceipt,
  type SquadsGrantPayoutCheckpoint,
  type SquadsGrantPayoutContract,
  type SquadsGrantPayoutReceipt,
} from './squadsDevnetProvider';
import { buildProviderTransactionAttemptInventory } from './providerTransactionAttempt';
import { recordGovernanceGrantPayoutFinality } from './governanceGrantLifecycle';
import { refreshGovernanceGrantSettlementReadiness } from './governanceGrantAgreement';
import { resolveProviderExecutionAuthorityHealthPreflight } from './providerExecutionAuthorityHealthPreflight';
import { resolveGovernanceFundingAmendmentRetryPreflight } from './governanceFundingAmendment';
import {
  getSquadsProviderTrustProfile,
  resolveSquadsProviderTrustReadiness,
} from './squadsProviderTrustProfile';
import { verifySquadsProviderTrustProfileReadback } from './squadsProviderTrustReadback';
import type {
  GovernanceActionExecutionOutcome,
  GovernanceExecutableRequest,
  GovernanceRequestExecutionSource,
} from './requestExecution';

const CONTRACT_VERSION = 1;
const FUNDING_TARGET_LAMPORTS = 250_000_000;
const GRANT_PAYOUT_LAMPORTS = 1_000_000;
const GRANT_PAYOUT_VAULT_FUNDING_LAMPORTS = 10_000_000;
const GRANT_PAYOUT_SINGLE_LIMIT_LAMPORTS = 5_000_000;
const GRANT_PAYOUT_TOTAL_LIMIT_LAMPORTS = 10_000_000;
const GRANT_PAYOUT_RETRY_BASE_MS = 15 * 60 * 1000;
const GRANT_PAYOUT_RETRY_MAX_MS = 6 * 60 * 60 * 1000;

function grantPayoutFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (/^(squads_grant_payout|squads_provider)_[a-z0-9_]{1,96}$/.test(code)) return code;
  if (/^(realms_)?openbao_[a-z0-9_]{1,96}$/.test(code)) {
    return 'squads_grant_payout_signing_unavailable';
  }
  return 'squads_grant_payout_provider_unavailable';
}

export interface SquadsExistingResourceAdoptionInput {
  targetCircleId: number;
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

export interface SquadsCanonicalPreSignStateReadback {
  schemaVersion: 1;
  authority: 'canonical_owner_provider_state_and_p05_health';
  requestId: string;
  decisionDigest: string;
  actionIntentDigest: string;
  resourceBindingId: string;
  payerPolicyId: string;
  preflightId: string;
  role: string;
  operation: string;
  providerState: {
    observedSlot: number;
    feePayerBalanceLamports: number;
    stepId: string;
    manifestDigest: string;
    messageDigest: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
    feeLamports: number;
    authorizedCeilingLamports: number;
    simulation: 'passed';
  };
  canonicalOwnerDigest: string;
  authorityHealthDigest: string;
  emergencyFreeze: 'clear_fresh_p05_authority_health';
  observedAt: string;
  digest: string;
}

export function buildSquadsProviderRequestIdempotencyKey(input: {
  phase: 'binding' | 'adoption' | 'bootstrap' | 'disable' | 'restore';
  circleId: number;
  profileRef: string;
  profileVersion: number;
  profileDigest: string;
  contractVersion: number;
  resourceBindingId?: string;
  resourceRef?: string;
}): string {
  const digest = hashCanonicalGovernanceValue(
    'alcheme.governance.squads-provider-request-idempotency',
    input,
  );
  return `squads-${input.phase}:${input.circleId}:${digest}`;
}

export function buildSquadsGrantPayoutRequestIdempotencyKey(input: {
  circleId: number;
  agreementId: string;
  trancheIntentId: string;
  milestoneResultDigest: string;
  transactionIndex: string;
  recipient: string;
  amountLamports: string;
  renewalOfRequestId: string | null;
}): string {
  return `squads-grant-payout:${input.circleId}:${hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-request-idempotency-v1', input,
  )}`;
}

export function buildSquadsProviderAdoptionPayload(
  input: SquadsExistingResourceAdoptionInput,
) {
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const roles = profile.keyCustodyRecord.keyContracts.map((contract) => contract.role);
  const suppliedAuthorities = new Map(input.authorities.map((authority) => [authority.role, authority]));
  const normalizedAddresses = Object.fromEntries(Object.entries(input.addresses).map(
    ([key, value]) => [key, new PublicKey(value).toBase58()],
  )) as SquadsExistingResourceAdoptionInput['addresses'];
  if (
    input.targetCircleId !== 35
    || !/^\d+$/.test(input.originCircleRef)
    || !/^gov_req_[a-f0-9]{56}$/.test(input.historicalRequestRef)
    || suppliedAuthorities.size !== roles.length
    || roles.some((role) => !suppliedAuthorities.has(role))
    || !/^[a-f0-9]{64}$/.test(input.expectedStateDigest)
    || input.memoText !== `Alcheme P06-M4 Circle ${input.originCircleRef} Squads Devnet no-asset`
  ) throw new Error('squads_provider_adoption_input_invalid');
  const expectedSteps = [
    'create_multisig',
    'create_vault_transaction',
    'create_proposal',
    'approve_by_proposer',
    'approve_by_approver',
    'execute_vault_transaction',
  ] as const;
  if (
    input.transactions.length !== expectedSteps.length
    || input.transactions.some((transaction, index) => (
      transaction.stepId !== expectedSteps[index]
      || typeof transaction.signature !== 'string'
      || transaction.signature.length < 64
      || !Number.isSafeInteger(transaction.slot)
      || transaction.slot <= 0
      || (index > 0 && transaction.slot <= input.transactions[index - 1].slot)
    ))
  ) throw new Error('squads_provider_adoption_transaction_manifest_invalid');
  const authorityBindings = profile.keyCustodyRecord.keyContracts.map((contract) => ({
    role: contract.role,
    keyRef: contract.keyRef,
    publicKey: new PublicKey(suppliedAuthorities.get(contract.role)!.publicKey).toBase58(),
    allowedOperations: [...contract.allowedOperations].sort(),
    permissionMask: contract.permissionMask,
    applicationIdentity: contract.applicationIdentity,
  }));
  if (new Set(authorityBindings.map((binding) => binding.publicKey)).size !== authorityBindings.length) {
    throw new Error('squads_provider_adoption_authority_separation_required');
  }
  const feePayer = authorityBindings.find((binding) => binding.role === 'fee_payer')!;
  return {
    schemaVersion: 1 as const,
    operation: 'adopt_existing_finalized_no_asset_resource' as const,
    targetCircleId: input.targetCircleId,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: profile.resourceContract.capability,
    contractVersion: CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    sourceAuthority: {
      kind: 'new_exact_governance_request' as const,
      historicalRequestAuthority: 'not_reused' as const,
    },
    origin: {
      circleRef: input.originCircleRef,
      historicalRequestRef: input.historicalRequestRef,
      authority: 'provider_history_only' as const,
    },
    resource: {
      type: 'squads_multisig_vault' as const,
      ...normalizedAddresses,
      ownerProgramRef: profile.deployment.programId,
      threshold: profile.resourceContract.threshold,
      memberCount: profile.resourceContract.memberCount,
      timeLockSeconds: profile.resourceContract.timeLockSeconds,
      vaultIndex: profile.resourceContract.vaultIndex,
      noRealAssets: true as const,
      expectedStateDigest: input.expectedStateDigest,
    },
    authorityBindings,
    providerReadback: {
      commitment: profile.readback.commitment,
      memoProgram: profile.resourceContract.memoProgram,
      memoText: input.memoText,
      transactions: input.transactions.map((transaction) => ({ ...transaction })),
      resubmitPolicy: 'never_automatic' as const,
      providerTransaction: 'prohibited' as const,
    },
    payerPolicy: {
      economicBearer: 'solana_devnet_faucet_only' as const,
      feePayerSignerRef: feePayer.keyRef,
      feePayerPublicKey: feePayer.publicKey,
      singleTransactionLimitLamports: '0' as const,
      totalActionLimitLamports: '0' as const,
      funding: 'prohibited' as const,
      refund: 'separately_governed' as const,
    },
    activation: {
      scope: profile.environmentBoundary.activationScope,
      status: 'pending_authoritative_readback' as const,
      inPlaceClusterSwitch: profile.environmentBoundary.inPlaceClusterSwitch,
      openCaseProfileSwitch: profile.environmentBoundary.openCaseProfileSwitch,
    },
    lifecycle: {
      disable: 'new_governance_request' as const,
      rollback: 'disable_binding_without_rewriting_provider_history' as const,
      inFlightDisposition: 'no_provider_transaction_in_flight' as const,
      fallback: 'prohibited' as const,
    },
  };
}

export function buildSquadsProviderBindingPayload() {
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const feePayer = profile.keyCustodyRecord.keyContracts.find(
    (contract) => contract.role === 'fee_payer',
  );
  if (!feePayer) throw new Error('squads_fee_payer_key_contract_required');
  return {
    schemaVersion: 1 as const,
    operation: 'create' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: profile.resourceContract.capability,
    contractVersion: CONTRACT_VERSION,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    resource: {
      type: 'squads_multisig_vault' as const,
      ref: null,
      ownerProgramRef: profile.deployment.programId,
      purpose: 'dedicated_no_real_asset_devnet_regression' as const,
      status: 'pending_provider_bootstrap' as const,
      threshold: profile.resourceContract.threshold,
      memberCount: profile.resourceContract.memberCount,
      timeLockSeconds: profile.resourceContract.timeLockSeconds,
      vaultIndex: profile.resourceContract.vaultIndex,
      noRealAssets: true as const,
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
    },
    authorityBindings: profile.keyCustodyRecord.keyContracts.map((contract) => ({
      role: contract.role,
      keyRef: contract.keyRef,
      allowedOperations: [...contract.allowedOperations],
      permissionMask: contract.permissionMask,
      applicationIdentity: contract.applicationIdentity,
      currentAuthority: null,
      custodyStatus: contract.status,
    })),
    payerPolicy: {
      economicBearer: 'solana_devnet_faucet_only' as const,
      feePayerSignerRef: feePayer.keyRef,
      rentFundingSourceRef: feePayer.keyRef,
      refundRecipientRef: feePayer.keyRef,
      singleLimit: { lamports: '0', reason: 'wallet_not_generated' },
      fundingBlockerCode: 'openbao_wallet_not_generated' as const,
      status: 'inactive' as const,
    },
    activation: 'not_activated' as const,
  };
}

export async function buildSquadsProviderBootstrapPayload(
  prisma: PrismaClient,
  input: { circleId: number; retryRequestId?: string; sourcePayerPolicyId?: string },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('squads_provider_bootstrap_circle_invalid');
  }
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const home = await findCircleHome(prisma, input.circleId);
  if (!home) throw new Error('squads_provider_bootstrap_home_not_configured');
  const resource = await prisma.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: profile.resourceContract.capability,
      contractVersion: CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'pending_custody',
      resourceRef: null,
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
  });
  if (!resource) throw new Error('squads_provider_bootstrap_resource_not_ready');
  if (record(resource.verification).profileDigest !== readiness.profileDigest) {
    throw new Error('squads_provider_bootstrap_profile_digest_mismatch');
  }
  const contracts = new Map(profile.keyCustodyRecord.keyContracts.map(
    (contract) => [contract.role, contract],
  ));
  if (resource.authorityBindings.length !== contracts.size) {
    throw new Error('squads_provider_bootstrap_authority_inventory_mismatch');
  }
  const authorityBindings = resource.authorityBindings.map((binding) => {
    const contract = contracts.get(binding.authorityRole as never);
    if (
      !contract
      || binding.keyRef !== contract.keyRef
      || binding.custodyProvider !== 'openbao_transit'
      || binding.custodyStatus !== 'verified'
      || binding.status !== 'pending_provider_bootstrap'
      || typeof binding.currentAuthority !== 'string'
      || !sameStringSet(stringArray(binding.allowedOperations), contract.allowedOperations)
    ) throw new Error('squads_provider_bootstrap_authority_owner_mismatch');
    return {
      role: contract.role,
      keyRef: contract.keyRef,
      publicKey: new PublicKey(binding.currentAuthority).toBase58(),
      permissionMask: contract.permissionMask,
      allowedOperations: [...contract.allowedOperations].sort(),
    };
  }).sort((left, right) => left.role.localeCompare(right.role));
  if (new Set(authorityBindings.map((binding) => binding.publicKey)).size !== authorityBindings.length) {
    throw new Error('squads_provider_bootstrap_authority_separation_required');
  }
  const feePayer = authorityBindings.find((binding) => binding.role === 'fee_payer');
  if (!feePayer) throw new Error('squads_provider_bootstrap_fee_payer_required');
  const payer = input.sourcePayerPolicyId
    ? await prisma.payerPolicy.findUnique({ where: { id: input.sourcePayerPolicyId } })
    : await prisma.payerPolicy.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        feePayerSignerRef: feePayer.keyRef,
        version: 1,
        status: { in: ['inactive', 'superseded'] },
      },
      orderBy: { updatedAt: 'desc' },
    });
  const retryPayer = input.retryRequestId
    ? await prisma.payerPolicy.findUnique({ where: { sourceRequestId: input.retryRequestId } })
    : payer?.status === 'superseded'
      ? await prisma.payerPolicy.findFirst({
        where: {
          homeIdentityBindingId: home.id,
          network: profile.chain.chainId,
          feePayerSignerRef: feePayer.keyRef,
          version: 2,
          status: 'active',
          supersededAt: null,
          sourceRequestId: { not: null },
        },
        orderBy: { effectiveFrom: 'desc' },
      })
      : null;
  const retryRequest = retryPayer?.sourceRequestId
    ? await prisma.governanceRequest.findUnique({
      where: { id: retryPayer.sourceRequestId },
      include: {
        decision: true,
        invocation: { select: { payloadDigest: true } },
      },
    })
    : null;
  const retryPayload = record(retryRequest?.payload);
  const retryResource = record(retryPayload.resourceBinding);
  const retryPayerAuthorization = record(retryPayload.payerAuthorization);
  const retryPayloadDigest = retryRequest
    ? hashCanonicalGovernanceValue('alcheme.governance.action-payload', retryRequest.payload)
    : null;
  const retryIdempotencyKey = buildSquadsProviderRequestIdempotencyKey({
    phase: 'bootstrap',
    circleId: input.circleId,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    contractVersion: CONTRACT_VERSION,
    resourceBindingId: resource.id,
  });
  const current = payer?.status === 'inactive'
    && payer.fundingBlockerCode === 'devnet_fee_cap_required'
    && payer.supersededAt === null;
  const exactRetry = payer?.status === 'superseded'
    && payer.fundingBlockerCode === 'devnet_fee_cap_required'
    && retryPayer?.version === 2
    && retryPayer.status === 'active'
    && retryPayer.feePayerSignerRef === feePayer.keyRef
    && retryRequest?.state === 'accepted'
    && retryRequest.actionType === SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE
    && retryRequest.targetType === 'circle'
    && retryRequest.targetRef === String(input.circleId)
    && retryRequest.homeIdentityBindingId === home.id
    && retryRequest.executionMode === 'provider_bound_action'
    && retryRequest.executionAuthorizationStatus === 'authorized'
    && retryRequest.decision?.decision === 'accepted'
    && retryPayer.sourceDecisionDigest === retryRequest.decision.decisionDigest
    && retryRequest.idempotencyKey === retryIdempotencyKey
    && retryPayload.chainId === profile.chain.chainId
    && retryPayload.profileRef === profile.profileRef
    && retryPayload.profileVersion === profile.version
    && retryPayload.profileDigest === readiness.profileDigest
    && retryResource.id === resource.id
    && retryPayerAuthorization.currentPolicyId === payer.id
    && retryRequest.invocation?.payloadDigest === retryPayloadDigest
    && retryRequest.decision.payloadDigest === retryPayloadDigest;
  if (!payer || payer.version !== 1 || payer.homeIdentityBindingId !== home.id || (!current && !exactRetry)) {
    throw new Error('squads_provider_bootstrap_payer_owner_mismatch');
  }
  const operations = [...new Set(authorityBindings.flatMap(
    (binding) => binding.allowedOperations,
  ))].sort();
  return {
    schemaVersion: 1 as const,
    operation: 'bootstrap_no_asset_devnet_squads' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: profile.resourceContract.capability,
    contractVersion: CONTRACT_VERSION,
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
      singleTransactionLimitLamports: String(profile.payerPolicy.singleTransactionLimitLamports),
      totalVerticalLimitLamports: String(profile.payerPolicy.totalVerticalLimitLamports),
      maximumWalletBalanceLamports: String(profile.payerPolicy.maximumWalletBalanceLamports),
      fundingTargetLamports: String(FUNDING_TARGET_LAMPORTS),
      fundingSource: profile.payerPolicy.fundingSource,
    },
    providerIntent: {
      programId: profile.deployment.programId,
      clientPackage: profile.clientDecoder.packageName,
      clientVersion: profile.clientDecoder.version,
      operations,
      threshold: profile.resourceContract.threshold,
      memberCount: profile.resourceContract.memberCount,
      timeLockSeconds: profile.resourceContract.timeLockSeconds,
      vaultIndex: profile.resourceContract.vaultIndex,
      memberPermissions: profile.resourceContract.memberPermissions,
      memoProgram: profile.resourceContract.memoProgram,
      memoText: `Alcheme P06-M4 Circle ${input.circleId} Squads Devnet no-asset`,
      noRealAssets: true as const,
      commitment: profile.readback.commitment,
      resubmitPolicy: profile.readback.resubmitPolicy,
    },
    activation: {
      scope: profile.environmentBoundary.activationScope,
      status: 'pending_provider_finality' as const,
      inPlaceClusterSwitch: profile.environmentBoundary.inPlaceClusterSwitch,
      openCaseProfileSwitch: profile.environmentBoundary.openCaseProfileSwitch,
    },
  };
}

export async function buildSquadsGrantPayoutPayload(
  prisma: PrismaClient,
  input: { circleId: number; agreementId: string; trancheIntentId: string; now?: Date },
  dependencies?: {
    createConnection?: typeof createSquadsDevnetConnection;
    readNextTransactionIndex?: typeof readNextSquadsGrantPayoutTransactionIndex;
  },
) {
  if (input.circleId !== 35 || !input.agreementId || !input.trancheIntentId) {
    throw new Error('squads_grant_payout_scope_invalid');
  }
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const home = await findCircleHome(prisma, input.circleId);
  if (!home) throw new Error('squads_grant_payout_home_not_configured');
  const [resource, agreement, retiredAttempt] = await Promise.all([
    prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: profile.resourceContract.capability,
        contractVersion: CONTRACT_VERSION,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: 'active',
      },
      include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    }),
    prisma.governanceGrantAgreement.findUnique({
      where: { id: input.agreementId },
      include: { governanceCase: { select: { homeIdentityBindingId: true } } },
    }),
    prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        provider: profile.provider,
        capability: 'grant_settlement',
        contractVersion: CONTRACT_VERSION,
        profileRef: profile.profileRef,
        profileVersion: profile.version,
        status: 'disabled',
        purpose: 'circle_35_no_real_asset_grant_payout',
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);
  if (
    !resource
    || typeof resource.resourceRef !== 'string'
    || record(resource.verification).profileDigest !== readiness.profileDigest
    || record(resource.verification).resourceReadback !== 'verified_finalized'
  ) throw new Error('squads_grant_payout_resource_not_ready');
  if (
    !agreement
    || agreement.governanceCase?.homeIdentityBindingId !== home.id
    || agreement.status !== 'active'
    || agreement.budgetUnit !== 'lamports'
  ) throw new Error('squads_grant_payout_agreement_not_ready');
  const lifecycle = record(agreement.lifecycle);
  const intents = Array.isArray(lifecycle.trancheIntents) ? lifecycle.trancheIntents : [];
  const intent = intents.find((candidate: any) => candidate?.id === input.trancheIntentId);
  if (
    !intent
    || intent.status !== 'contractual_pending_settlement'
    || intent.amountUnits !== String(GRANT_PAYOUT_LAMPORTS)
    || intent.budgetUnit !== agreement.budgetUnit
    || intent.recipientRef !== agreement.recipientRef
    || intent.resourceRef !== null
    || intent.payoutRef !== null
    || intent.providerFinality !== null
    || !/^[a-f0-9]{64}$/.test(String(intent.milestoneResultDigest ?? ''))
  ) throw new Error('squads_grant_payout_intent_not_ready');
  const recipient = new PublicKey(String(agreement.recipientRef).replace(/^wallet:/, '')).toBase58();
  if (agreement.recipientRef !== `wallet:${recipient}`) {
    throw new Error('squads_grant_payout_recipient_invalid');
  }
  const contracts = new Map(profile.keyCustodyRecord.keyContracts.map(
    (contract) => [contract.role, contract],
  ));
  const authorityBindings = resource.authorityBindings.map((binding) => {
    const contract = contracts.get(binding.authorityRole as never);
    if (
      !contract
      || binding.keyRef !== contract.keyRef
      || binding.custodyProvider !== 'openbao_transit'
      || binding.custodyStatus !== 'verified'
      || binding.status !== 'active'
      || typeof binding.currentAuthority !== 'string'
      || !sameStringSet(stringArray(binding.allowedOperations), contract.allowedOperations)
    ) throw new Error('squads_grant_payout_authority_owner_mismatch');
    return {
      role: contract.role,
      keyRef: contract.keyRef,
      publicKey: new PublicKey(binding.currentAuthority).toBase58(),
      permissionMask: contract.permissionMask,
      allowedOperations: [...contract.allowedOperations].sort(),
    };
  }).sort((left, right) => left.role.localeCompare(right.role));
  if (authorityBindings.length !== contracts.size) {
    throw new Error('squads_grant_payout_authority_inventory_mismatch');
  }
  const vault = record(resource.verification).accountGraph?.accountGraph?.vault;
  if (typeof vault !== 'string') throw new Error('squads_grant_payout_vault_readback_required');
  const connection = (dependencies?.createConnection ?? createSquadsDevnetConnection)(
    profile.readback.rpc.endpoint,
    profile.readback.timeoutMs,
  );
  const transactionIndex = await (
    dependencies?.readNextTransactionIndex ?? readNextSquadsGrantPayoutTransactionIndex
  )(connection, {
    programId: profile.deployment.programId,
    multisig: resource.resourceRef,
  });
  const now = input.now ?? new Date();
  const retirement = record(retiredAttempt?.verification).attemptRetirement;
  const retirementRecord = record(retirement);
  const renewal = retiredAttempt
    ? {
      mode: 'renew_expired_no_effect' as const,
      resourceBindingId: retiredAttempt.id,
      payerPolicyId: String(retirementRecord.payerPolicyId ?? ''),
      assetAuthorityPolicyId: String(retirementRecord.assetAuthorityPolicyId ?? ''),
      renewalOfRequestId: String(retirementRecord.requestId ?? ''),
      renewalOfDecisionDigest: String(retirementRecord.decisionDigest ?? ''),
      retirementDigest: String(retirementRecord.retirementDigest ?? ''),
    }
    : {
      mode: 'new' as const,
      resourceBindingId: null,
      payerPolicyId: null,
      assetAuthorityPolicyId: null,
      renewalOfRequestId: null,
      renewalOfDecisionDigest: null,
      retirementDigest: null,
    };
  if (retiredAttempt && (
    retirementRecord.state !== 'expired_no_provider_effect'
    || !/^gov_req_[a-f0-9]{56}$/.test(String(renewal.renewalOfRequestId ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(renewal.renewalOfDecisionDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(renewal.retirementDigest ?? ''))
    || !renewal.payerPolicyId
    || !renewal.assetAuthorityPolicyId
  )) throw new Error('squads_grant_payout_retired_attempt_invalid');
  return {
    schemaVersion: 1 as const,
    operation: 'execute_exact_devnet_grant_payout' as const,
    circleId: input.circleId,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    profileRef: profile.profileRef,
    profileVersion: profile.version,
    profileDigest: readiness.profileDigest,
    agreement: {
      id: agreement.id,
      caseId: agreement.caseId,
      termsDigest: agreement.termsDigest,
      lifecycleDigest: agreement.lifecycleDigest,
      lifecycleVersion: agreement.lifecycleVersion,
      trancheIntentId: intent.id,
      milestoneResultDigest: intent.milestoneResultDigest,
      budgetUnit: agreement.budgetUnit,
      amountUnits: intent.amountUnits,
      recipientRef: agreement.recipientRef,
    },
    resourceBinding: {
      id: resource.id,
      multisig: resource.resourceRef,
      vault: new PublicKey(vault).toBase58(),
      stateDigest: resource.stateDigest,
      verifiedSlot: String(resource.verifiedSlot),
      contractVersion: resource.contractVersion,
    },
    authorityBindings,
    providerIntent: {
      programId: profile.deployment.programId,
      vault: new PublicKey(vault).toBase58(),
      transactionIndex,
      recipient,
      amountLamports: String(GRANT_PAYOUT_LAMPORTS),
      vaultFundingTargetLamports: String(GRANT_PAYOUT_VAULT_FUNDING_LAMPORTS),
      commitment: 'finalized' as const,
      noRealAssets: true as const,
    },
    payerAuthorization: {
      economicBearer: 'solana_devnet_faucet_only' as const,
      feePayerSignerRef: authorityBindings.find((binding) => binding.role === 'fee_payer')?.keyRef,
      singleTransactionLimitLamports: String(GRANT_PAYOUT_SINGLE_LIMIT_LAMPORTS),
      totalActionLimitLamports: String(GRANT_PAYOUT_TOTAL_LIMIT_LAMPORTS),
      maximumWalletBalanceLamports: String(profile.payerPolicy.maximumWalletBalanceLamports),
      fundingSource: 'solana_devnet_faucet' as const,
    },
    settlementAttempt: renewal,
    activation: {
      effectiveAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
      maxDepth: 1 as const,
      nonce: transactionIndex,
    },
    lifecycle: {
      inFlightDisposition: 'hold_resource_and_retry_same_request' as const,
      rollback: 'provider_effect_is_final_reconcile_canonical_readback' as const,
      disable: 'block_new_payout_requests' as const,
      fallback: 'prohibited' as const,
    },
  };
}

interface SquadsGrantPayoutAttemptRetirement {
  resourceBindingId: string;
  requestId: string;
  decisionDigest: string;
  retirementDigest: string;
  retiredAt: string;
  authoritativeReadback: {
    providerFinality: 'finalized';
    observedSlot: number;
    nextTransactionIndex: string;
    vaultBalanceLamports: string;
  };
}

function isSafeGrantPayoutNoEffectCheckpoint(
  value: unknown,
  expectedFundingTargetLamports: string,
): boolean {
  if (value === null) return true;
  const checkpoint = record(value);
  const funding = record(checkpoint.funding);
  const faucetAttempt = record(funding.faucetAttempt);
  const fundingTargetLamports = Number(expectedFundingTargetLamports);
  return (
    checkpoint.schemaVersion === 1
    && Number.isSafeInteger(fundingTargetLamports)
    && fundingTargetLamports > 0
    && funding.status === 'pending'
    && funding.source === 'solana_devnet_faucet'
    && funding.targetBalanceLamports === fundingTargetLamports
    && funding.balanceBeforeLamports === 0
    && funding.signature === undefined
    && funding.slot === undefined
    && funding.balanceAfterLamports === undefined
    && typeof faucetAttempt.attemptedAt === 'string'
    && Number.isFinite(Date.parse(faucetAttempt.attemptedAt))
    && (faucetAttempt.outcome === 'rate_limited' || faucetAttempt.outcome === 'unavailable')
    && checkpoint.recipientBalanceBeforeLamports === null
    && Array.isArray(checkpoint.steps)
    && checkpoint.steps.length === 0
  );
}

function grantPayoutNoEffectCheckpointsMatch(left: unknown, right: unknown): boolean {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-no-effect-checkpoint-v1',
    left,
  ) === hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-no-effect-checkpoint-v1',
    right,
  );
}

function grantPayoutNoEffectFundingReadbackMatches(
  checkpointValue: unknown,
  balanceReadback: unknown,
): boolean {
  if (checkpointValue === null) return balanceReadback === null;
  const funding = record(record(checkpointValue).funding);
  return hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-no-effect-funding-readback-v1',
    funding,
  ) === hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-no-effect-funding-readback-v1',
    balanceReadback,
  );
}

export async function retireExpiredSquadsGrantPayoutAttempt(
  prisma: PrismaClient,
  input: { resourceBindingId: string; requestId: string; now?: Date },
  dependencies?: {
    createConnection?: typeof createSquadsDevnetConnection;
    verifyTrustProfile?: typeof verifySquadsProviderTrustProfileReadback;
    readNextTransactionIndex?: typeof readNextSquadsGrantPayoutTransactionIndex;
    refreshGrantReadiness?: typeof refreshGovernanceGrantSettlementReadiness;
  },
): Promise<SquadsGrantPayoutAttemptRetirement> {
  const now = input.now ?? new Date();
  const [resource, request] = await Promise.all([
    prisma.governedResourceBinding.findUnique({
      where: { id: input.resourceBindingId },
      include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    }),
    prisma.governanceRequest.findUnique({
      where: { id: input.requestId },
      include: { decision: { select: { decision: true, decisionDigest: true } } },
    }),
  ]);
  const payload = record(request?.payload);
  const activation = record(payload.activation);
  const agreementContract = record(payload.agreement);
  const providerIntent = record(payload.providerIntent);
  const verification = record(resource?.verification);
  const retry = record(verification.retry);
  const activationExpiresAt = Date.parse(String(activation.expiresAt ?? ''));
  if (
    !resource
    || resource.id !== input.resourceBindingId
    || resource.capability !== 'grant_settlement'
    || resource.status !== 'hold'
    || resource.sourceRequestId !== input.requestId
    || !isSafeGrantPayoutNoEffectCheckpoint(
      verification.providerCheckpoint,
      String(providerIntent.vaultFundingTargetLamports ?? ''),
    )
    || retry.mode !== 'same_request_only'
    || retry.requestId !== input.requestId
    || !request
    || request.state !== 'accepted'
    || request.actionType !== GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE
    || request.executionMode !== 'provider_bound_action'
    || request.compatibilityBundleVersion !== null
    || request.executionAuthorizationStatus !== 'authorized'
    || request.decision?.decision !== 'accepted'
    || request.decision.decisionDigest !== resource.sourceDecisionDigest
    || !Number.isFinite(activationExpiresAt)
    || activationExpiresAt > now.getTime()
    || providerIntent.commitment !== 'finalized'
    || providerIntent.noRealAssets !== true
    || typeof agreementContract.id !== 'string'
    || typeof agreementContract.caseId !== 'string'
    || typeof providerIntent.vault !== 'string'
    || typeof providerIntent.transactionIndex !== 'string'
    || typeof providerIntent.vaultFundingTargetLamports !== 'string'
  ) throw new Error('squads_grant_payout_retirement_contract_mismatch');
  if (!request.invocationId) throw new Error('squads_grant_payout_retirement_invocation_missing');
  const attemptKey = `squads-grant-payout:${request.id}:v1`;
  const preflight = await prisma.costPreflight.findUnique({
    where: { invocationId_attemptKey: { invocationId: request.invocationId, attemptKey } },
    include: { payerPolicy: true, assetAuthorityPolicy: true },
  });
  const estimatedCost = record(preflight?.estimatedCost);
  if (
    !preflight
    || preflight.status !== 'ready'
    || !isSafeGrantPayoutNoEffectCheckpoint(
      estimatedCost.providerCheckpoint,
      providerIntent.vaultFundingTargetLamports,
    )
    || !grantPayoutNoEffectCheckpointsMatch(
      verification.providerCheckpoint,
      estimatedCost.providerCheckpoint,
    )
    || !grantPayoutNoEffectFundingReadbackMatches(
      estimatedCost.providerCheckpoint,
      preflight.balanceReadback,
    )
    || preflight.reservationRef !== null
    || (
      preflight.transactionAttemptDigest !== null
      && !/^[a-f0-9]{64}$/.test(preflight.transactionAttemptDigest)
    )
    || !preflight.payerPolicy
    || preflight.payerPolicy.sourceRequestId !== request.id
    || preflight.payerPolicy.status !== 'active'
    || !preflight.assetAuthorityPolicy
    || preflight.assetAuthorityPolicy.status !== 'active'
    || resource.authorityBindings.length !== 3
    || resource.authorityBindings.some((binding) => (
      binding.status !== 'hold'
      || binding.sourceRequestId !== request.id
      || binding.sourceDecisionDigest !== request.decision?.decisionDigest
    ))
  ) throw new Error('squads_grant_payout_retirement_owner_mismatch');
  await (dependencies?.verifyTrustProfile ?? verifySquadsProviderTrustProfileReadback)();
  const profile = getSquadsProviderTrustProfile();
  const connection = (dependencies?.createConnection ?? createSquadsDevnetConnection)(
    profile.readback.rpc.endpoint,
    profile.readback.timeoutMs,
  );
  const [nextTransactionIndex, vaultBalanceLamports, observedSlot] = await Promise.all([
    (dependencies?.readNextTransactionIndex ?? readNextSquadsGrantPayoutTransactionIndex)(connection, {
      programId: String(providerIntent.programId ?? ''),
      multisig: String(record(payload.resourceBinding).multisig ?? ''),
    }),
    connection.getBalance(new PublicKey(providerIntent.vault), 'finalized'),
    connection.getSlot('finalized'),
  ]);
  if (
    nextTransactionIndex !== providerIntent.transactionIndex
    || vaultBalanceLamports !== 0
    || !Number.isSafeInteger(observedSlot)
    || observedSlot <= 0
  ) throw new Error('squads_grant_payout_retirement_provider_effect_detected');
  const retirementFacts = {
    schemaVersion: 1,
    state: 'expired_no_provider_effect' as const,
    requestId: request.id,
    decisionDigest: request.decision.decisionDigest,
    activationExpiresAt: new Date(activationExpiresAt).toISOString(),
    retiredAt: now.toISOString(),
    payerPolicyId: preflight.payerPolicy.id,
    assetAuthorityPolicyId: preflight.assetAuthorityPolicy.id,
    preflightId: preflight.id,
    priorTransactionAttemptDigest: preflight.transactionAttemptDigest,
    authoritativeReadback: {
      providerFinality: 'finalized' as const,
      observedSlot,
      nextTransactionIndex,
      vaultBalanceLamports: String(vaultBalanceLamports),
    },
  };
  const retirementDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-attempt-retirement-v1',
    retirementFacts,
  );
  const attemptRetirement = { ...retirementFacts, retirementDigest };
  const priorAttemptHistory = Array.isArray(verification.attemptHistory)
    ? verification.attemptHistory
    : [];
  const nextVerification = {
    ...verification,
    retry: {
      ...retry,
      state: 'retired',
      retiredAt: now.toISOString(),
      nextRetryAt: null,
    },
    attemptRetirement,
    attemptHistory: [...priorAttemptHistory, attemptRetirement],
  };
  await prisma.$transaction(async (tx) => {
    const resourceUpdated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        status: 'hold',
        sourceRequestId: request.id,
        sourceDecisionDigest: request.decision!.decisionDigest,
        verificationDigest: resource.verificationDigest,
      },
      data: {
        status: 'disabled',
        disabledAt: now,
        verification: nextVerification as unknown as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    if (resourceUpdated.count !== 1) throw new Error('squads_grant_payout_retirement_resource_conflict');
    const authoritiesUpdated = await tx.resourceAuthorityBinding.updateMany({
      where: {
        governedResourceBindingId: resource.id,
        sourceRequestId: request.id,
        sourceDecisionDigest: request.decision!.decisionDigest,
        status: 'hold',
      },
      data: { status: 'retired', retiredAt: now },
    });
    if (authoritiesUpdated.count !== 3) throw new Error('squads_grant_payout_retirement_authority_conflict');
    const payerUpdated = await tx.payerPolicy.updateMany({
      where: {
        id: preflight.payerPolicy!.id,
        sourceRequestId: request.id,
        sourceDecisionDigest: request.decision!.decisionDigest,
        status: 'active',
      },
      data: {
        status: 'inactive',
        supersededAt: now,
        fundingBlockerCode: 'grant_payout_activation_expired',
      },
    });
    if (payerUpdated.count !== 1) throw new Error('squads_grant_payout_retirement_payer_conflict');
    const assetUpdated = await tx.assetAuthorityPolicy.updateMany({
      where: { id: preflight.assetAuthorityPolicy!.id, status: 'active' },
      data: {
        status: 'inactive',
        supersededAt: now,
        rotationRevocation: {
          ...record(preflight.assetAuthorityPolicy!.rotationRevocation),
          attemptRetirement,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    if (assetUpdated.count !== 1) throw new Error('squads_grant_payout_retirement_asset_conflict');
    const preflightUpdated = await tx.costPreflight.updateMany({
      where: { id: preflight.id, status: 'ready', actionIntentDigest: preflight.actionIntentDigest },
      data: {
        status: 'expired',
        estimatedCost: {
          ...estimatedCost,
          status: 'expired_no_provider_effect',
          providerCheckpoint: null,
          attemptRetirement,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    if (preflightUpdated.count !== 1) throw new Error('squads_grant_payout_retirement_preflight_conflict');
  });
  const agreement = await prisma.governanceGrantAgreement.findUnique({
    where: { id: agreementContract.id },
    select: { id: true, caseId: true, settlementReadinessVersion: true },
  });
  if (!agreement || agreement.caseId !== agreementContract.caseId) {
    throw new Error('squads_grant_payout_retirement_agreement_mismatch');
  }
  try {
    await (dependencies?.refreshGrantReadiness ?? refreshGovernanceGrantSettlementReadiness)(
      prisma,
      {
        caseId: agreement.caseId,
        agreementId: agreement.id,
        expectedEvaluationVersion: Number(agreement.settlementReadinessVersion ?? 0),
        now,
      },
    );
  } catch {
    throw new Error('squads_grant_payout_retirement_readback_conflict');
  }
  return {
    resourceBindingId: resource.id,
    requestId: request.id,
    decisionDigest: request.decision.decisionDigest,
    retirementDigest,
    retiredAt: now.toISOString(),
    authoritativeReadback: retirementFacts.authoritativeReadback,
  };
}

export async function buildSquadsProviderDisablePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('squads_provider_disable_circle_invalid');
  }
  const profile = getSquadsProviderTrustProfile();
  const home = await findCircleHome(prisma, input.circleId);
  if (!home) throw new Error('squads_provider_disable_home_not_found');
  const resource = await prisma.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: profile.resourceContract.capability,
      contractVersion: CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: { in: ['active', 'degraded'] },
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
  });
  if (!resource) throw new Error('squads_provider_disable_active_binding_not_found');
  const verification = record(resource.verification);
  const providerRestore = record(verification.providerRestore);
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
      requestId: String(record(verification.providerContract).requestId ?? ''),
      decisionDigest: String(record(verification.providerContract).decisionDigest ?? ''),
    };
  if (!activeLifecycle.requestId || !/^[a-f0-9]{64}$/.test(activeLifecycle.decisionDigest)) {
    throw new Error('squads_provider_disable_active_lineage_invalid');
  }
  const requests = await prisma.governanceRequest.findMany({
    where: {
      homeIdentityBindingId: home.id,
      targetType: 'circle',
      targetRef: String(input.circleId),
      actionType: { in: [
        SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
        SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
      ] },
    },
    include: {
      receipts: {
        select: { executionStatus: true, executionRef: true },
        orderBy: { executedAt: 'asc' },
      },
    },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
  });
  const entries = requests.map((request) => {
    const terminal = request.receipts.some((receipt) => receipt.executionStatus === 'executed');
    return {
      requestId: request.id,
      actionType: request.actionType,
      state: request.state,
      disposition: terminal
        ? 'preserve_terminal_provider_facts' as const
        : request.state === 'accepted'
          ? 'block_new_dispatch_require_independent_reconciliation' as const
          : 'preserve_frozen_request_block_new_dispatch' as const,
      terminalExecutionRefs: request.receipts
        .filter((receipt) => receipt.executionStatus === 'executed')
        .map((receipt) => receipt.executionRef)
        .filter((value): value is string => typeof value === 'string')
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
    capability: profile.resourceContract.capability,
    contractVersion: CONTRACT_VERSION,
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
      'alcheme.governance.squads-provider-in-flight-disposition',
      inFlightDisposition,
    ),
    rollbackPolicy: {
      preSubmit: 'new_governed_restore_requires_independent_readback' as const,
      postSubmit: 'forward_recovery_or_independent_reconciliation_only' as const,
      chainFacts: 'never_rewritten' as const,
      fallback: 'prohibited' as const,
    },
    reason: 'governed_provider_disable' as const,
  };
}

export async function buildSquadsProviderRestorePayload(
  prisma: PrismaClient,
  input: { circleId: number },
) {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('squads_provider_restore_circle_invalid');
  }
  const profile = getSquadsProviderTrustProfile();
  const home = await findCircleHome(prisma, input.circleId);
  if (!home) throw new Error('squads_provider_restore_home_not_found');
  const resource = await prisma.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: profile.resourceContract.capability,
      contractVersion: CONTRACT_VERSION,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: 'disabled',
    },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
  });
  if (!resource) throw new Error('squads_provider_restore_disabled_binding_not_found');
  const providerDisable = record(record(resource.verification).providerDisable);
  if (
    providerDisable.schemaVersion !== 1
    || providerDisable.state !== 'disabled'
    || typeof providerDisable.requestId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(providerDisable.decisionDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(providerDisable.inFlightDispositionDigest ?? ''))
  ) throw new Error('squads_provider_restore_disable_lineage_invalid');
  return {
    schemaVersion: 1 as const,
    operation: 'restore' as const,
    chainId: profile.chain.chainId,
    provider: profile.provider,
    capability: profile.resourceContract.capability,
    contractVersion: CONTRACT_VERSION,
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
      decisionDigest: String(providerDisable.decisionDigest),
      inFlightDispositionDigest: String(providerDisable.inFlightDispositionDigest),
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

export async function executeSquadsProviderBindingAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
    source?: GovernanceRequestExecutionSource;
  },
  dependencies?: {
    readOpenBaoKeyInventory?: typeof readSquadsOpenBaoRuntimeKeyInventory;
    verifyTrustProfile?: typeof verifySquadsProviderTrustProfileReadback;
    readExistingResource?: typeof readExistingSquadsDevnetResource;
    createConnection?: typeof createSquadsDevnetConnection;
    executeGrantPayout?: typeof executeSquadsGrantPayout;
    refreshGrantReadiness?: typeof refreshGovernanceGrantSettlementReadiness;
    resolveAuthorityHealthPreflight?: typeof resolveProviderExecutionAuthorityHealthPreflight;
    resolveCanonicalPreSignState?: typeof resolveSquadsCanonicalPreSignState;
    signCanonicalMessage?: typeof signSquadsOpenBaoCanonicalMessage;
  },
): Promise<GovernanceActionExecutionOutcome | null> {
  if (input.request.actionType === GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE) {
    return executeGrantPayoutAction(prisma, input, dependencies);
  }
  if (input.request.actionType === SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE) {
    return executeBootstrap(prisma, input, dependencies);
  }
  if (input.request.actionType === SQUADS_PROVIDER_DISABLE_ACTION_TYPE) {
    return executeControl(prisma, input, 'disabled');
  }
  if (input.request.actionType === SQUADS_PROVIDER_RESTORE_ACTION_TYPE) {
    return executeControl(prisma, input, 'restored');
  }
  if (input.request.actionType !== SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE) return null;
  if (record(input.request.payload).operation === 'adopt_existing_finalized_no_asset_resource') {
    return executeAdoption(prisma, input, dependencies);
  }
  return executeCreate(prisma, input);
}

export interface SquadsOpenBaoKeyReadback {
  role: string;
  keyRef: string;
  publicKey: string;
  policyName: string;
  credentialRef: string;
  tokenPeriodSeconds: 86400;
  tokenAccessor: string;
}

export async function recordSquadsOpenBaoKeyReadback(
  prisma: PrismaClient,
  input: { circleId: number; keys: SquadsOpenBaoKeyReadback[]; observedAt?: Date },
): Promise<{ resourceBindingId: string; keyCount: number; payerBlockerCode: 'devnet_fee_cap_required' }> {
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const home = await findCircleHome(prisma, input.circleId);
  if (!home) throw new Error('squads_openbao_key_readback_home_required');
  const candidates = await prisma.governedResourceBinding.findMany({
    where: {
      homeIdentityBindingId: home.id,
      provider: profile.provider,
      capability: profile.resourceContract.capability,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: { in: ['pending_custody', 'active', 'degraded', 'hold'] },
    },
    include: { authorityBindings: true },
  });
  const currentCandidates = candidates.filter((candidate) => (
    record(candidate.verification).profileDigest === readiness.profileDigest
  ));
  if (currentCandidates.length !== 1) {
    throw new Error('squads_openbao_key_readback_single_current_owner_required');
  }
  const resource = currentCandidates[0];
  const supplied = new Map(input.keys.map((key) => [key.role, key]));
  if (supplied.size !== profile.keyCustodyRecord.keyContracts.length) {
    throw new Error('squads_openbao_key_readback_inventory_mismatch');
  }
  const identities: Record<string, unknown> = {};
  const publicKeys = new Set<string>();
  for (const contract of profile.keyCustodyRecord.keyContracts) {
    const key = supplied.get(contract.role);
    if (
      !key
      || key.keyRef !== contract.keyRef
      || key.policyName !== contract.applicationIdentity.policyName
      || key.credentialRef !== contract.applicationIdentity.credentialRef
      || key.tokenPeriodSeconds !== contract.applicationIdentity.tokenPeriodSeconds
      || !/^[A-Za-z0-9._-]{8,160}$/.test(key.tokenAccessor)
    ) throw new Error('squads_openbao_key_readback_contract_mismatch');
    const publicKey = new PublicKey(key.publicKey).toBase58();
    if (publicKeys.has(publicKey)) throw new Error('squads_openbao_key_readback_role_separation_required');
    publicKeys.add(publicKey);
    identities[contract.role] = {
      authMethod: 'openbao_periodic_token',
      policyName: key.policyName,
      credentialRef: key.credentialRef,
      tokenPeriodSeconds: key.tokenPeriodSeconds,
      tokenAccessor: key.tokenAccessor,
    };
  }
  const observedAt = input.observedAt ?? new Date();
  const recoveringCurrentIdentity = resource.status !== 'pending_custody';
  const authorityByRole = new Map(resource.authorityBindings.map((binding) => [
    binding.authorityRole,
    binding,
  ]));
  if (
    recoveringCurrentIdentity
    && (
      authorityByRole.size !== profile.keyCustodyRecord.keyContracts.length
      || profile.keyCustodyRecord.keyContracts.some((contract) => {
        const key = supplied.get(contract.role)!;
        const authority = authorityByRole.get(contract.role);
        return !authority
          || authority.keyRef !== contract.keyRef
          || authority.currentAuthority !== new PublicKey(key.publicKey).toBase58()
          || authority.custodyProvider !== 'openbao_transit'
          || !['active', 'degraded', 'hold'].includes(authority.status);
      })
    )
  ) throw new Error('squads_openbao_key_readback_current_authority_mismatch');
  const verification = {
    ...record(resource.verification),
    profileDigest: readiness.profileDigest,
    custodyStatus: recoveringCurrentIdentity
      ? record(resource.verification).custodyStatus
      : 'verified_wallet_keys_pending_provider',
    applicationIdentities: identities,
    keyReadbackVerifiedAt: observedAt.toISOString(),
  };
  const verificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    verification,
  );
  await prisma.$transaction(async (tx) => {
    if (recoveringCurrentIdentity) {
      const updated = await tx.governedResourceBinding.updateMany({
        where: {
          id: resource.id,
          status: resource.status,
          sourceRequestId: resource.sourceRequestId,
          sourceDecisionDigest: resource.sourceDecisionDigest,
          verificationDigest: resource.verificationDigest,
        },
        data: { verification: verification as Prisma.InputJsonValue, verificationDigest },
      });
      if (updated.count !== 1) throw new Error('squads_openbao_key_readback_resource_conflict');
      for (const contract of profile.keyCustodyRecord.keyContracts) {
        const key = supplied.get(contract.role)!;
        const authority = authorityByRole.get(contract.role)!;
        const authorityUpdated = await tx.resourceAuthorityBinding.updateMany({
          where: {
            id: authority.id,
            governedResourceBindingId: resource.id,
            authorityRole: contract.role,
            keyRef: contract.keyRef,
            currentAuthority: authority.currentAuthority,
            status: authority.status,
            sourceRequestId: authority.sourceRequestId,
            sourceDecisionDigest: authority.sourceDecisionDigest,
          },
          data: {
            custodyStatus: 'verified',
            custodyVerification: {
              ...record(authority.custodyVerification),
              policyName: key.policyName,
              credentialRef: key.credentialRef,
              tokenAccessor: key.tokenAccessor,
              verifiedAt: observedAt.toISOString(),
            },
          },
        });
        if (authorityUpdated.count !== 1) {
          throw new Error('squads_openbao_key_readback_authority_conflict');
        }
      }
      return;
    }
    const updated = await tx.governedResourceBinding.updateMany({
      where: { id: resource.id, status: 'pending_custody', verificationDigest: resource.verificationDigest },
      data: { verification: verification as Prisma.InputJsonValue, verificationDigest },
    });
    if (updated.count !== 1) throw new Error('squads_openbao_key_readback_resource_conflict');
    for (const contract of profile.keyCustodyRecord.keyContracts) {
      const key = supplied.get(contract.role)!;
      const authority = await tx.resourceAuthorityBinding.updateMany({
        where: {
          governedResourceBindingId: resource.id,
          authorityRole: contract.role,
          keyRef: contract.keyRef,
          status: 'pending_custody',
          currentAuthority: null,
        },
        data: {
          currentAuthority: key.publicKey,
          custodyStatus: 'verified',
          custodyVerification: {
            keyVersion: 1,
            algorithm: 'ed25519',
            derived: false,
            exportable: false,
            allowPlaintextBackup: false,
            policyName: key.policyName,
            credentialRef: key.credentialRef,
            tokenAccessor: key.tokenAccessor,
            verifiedAt: observedAt.toISOString(),
          },
          status: 'pending_provider_bootstrap',
        },
      });
      if (authority.count !== 1) throw new Error('squads_openbao_key_readback_authority_conflict');
    }
    const payer = await tx.payerPolicy.updateMany({
      where: {
        homeIdentityBindingId: home.id,
        network: profile.chain.chainId,
        feePayerSignerRef: profile.keyCustodyRecord.keyContracts.find(
          (contract) => contract.role === 'fee_payer',
        )!.keyRef,
        status: 'inactive',
        fundingBlockerCode: 'openbao_wallet_not_generated',
        supersededAt: null,
      },
      data: { fundingBlockerCode: 'devnet_fee_cap_required' },
    });
    if (payer.count !== 1) throw new Error('squads_openbao_key_readback_payer_conflict');
  });
  return { resourceBindingId: resource.id, keyCount: publicKeys.size, payerBlockerCode: 'devnet_fee_cap_required' };
}

async function executeCreate(
  prisma: PrismaClient,
  input: { request: GovernanceExecutableRequest; decisionDigest: string; now: Date },
): Promise<GovernanceActionExecutionOutcome | null> {
  const { request, decisionDigest } = input;
  if (request.targetType !== 'circle') return null;
  if (!request.homeIdentityBindingId) throw new Error('squads_provider_binding_home_identity_required');
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) throw new Error('squads_provider_binding_decision_digest_invalid');
  const circleId = positiveInteger(request.targetRef);
  if (!circleId) throw new Error('squads_provider_binding_circle_invalid');
  const expected = buildSquadsProviderBindingPayload();
  const supplied = record(request.payload);
  assertEvidencePolicy(supplied, 'squads_provider_binding_evidence_policy_mismatch');
  assertPayloadDigest(
    'alcheme.governance.squads-provider-binding-payload',
    supplied,
    { ...expected, evidencePolicy: supplied.evidencePolicy },
    'squads_provider_binding_profile_contract_mismatch',
  );
  const resourceBindingId = stableId('squads-resource', request.id);
  const payerPolicyId = stableId('squads-payer', request.id);
  const verification = {
    schemaVersion: 1,
    profileDigest: expected.profileDigest,
    deploymentVerification: 'snapshot_verified_read_only',
    sourceReproducibility: 'unverified',
    resourceReadback: 'pending_provider_bootstrap',
    custodyRecordRef: expected.custody.recordRef,
    custodyStatus: expected.custody.status,
    custodyEndpoint: expected.custody.endpoint,
    custodyTls: expected.custody.tls,
    activation: 'not_activated',
  };
  const verificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    verification,
  );
  const actionScope = {
    schemaVersion: 1,
    capability: expected.capability,
    chainId: expected.chainId,
    profileRef: expected.profileRef,
    profileVersion: expected.profileVersion,
    allowedOperations: [...new Set(expected.authorityBindings.flatMap(
      (binding) => binding.allowedOperations,
    ))].sort(),
  };
  const actionScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy-action-scope',
    actionScope,
  );
  const policyDigest = hashCanonicalGovernanceValue('alcheme.governance.payer-policy', {
    homeIdentityBindingId: request.homeIdentityBindingId,
    version: 1,
    network: expected.chainId,
    actionScope,
    feePayerSignerRef: expected.payerPolicy.feePayerSignerRef,
    sourceRequestId: request.id,
    sourceDecisionDigest: decisionDigest,
    status: 'inactive',
  });
  await prisma.$transaction(async (tx) => {
    const existing = await tx.governedResourceBinding.findUnique({
      where: { sourceRequestId: request.id },
      include: { authorityBindings: true },
    });
    if (existing) {
      if (
        existing.id !== resourceBindingId
        || existing.sourceDecisionDigest !== decisionDigest
        || existing.verificationDigest !== verificationDigest
        || existing.authorityBindings.length !== expected.authorityBindings.length
      ) {
        throw new Error('squads_provider_binding_idempotency_conflict');
      }
      return;
    }
    const home = await tx.governanceHomeIdentityBinding.findUnique({
      where: { id: request.homeIdentityBindingId! },
    });
    if (
      !home
      || home.homeType !== 'circle'
      || home.homeRef !== String(circleId)
      || home.status !== 'active'
      || home.supersededAt
    ) throw new Error('squads_provider_binding_home_identity_mismatch');
    const competing = await tx.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        capability: expected.capability,
        status: { in: ['pending_custody', 'active', 'degraded'] },
      },
    });
    if (competing) throw new Error('squads_provider_binding_already_exists');
    await tx.governedResourceBinding.create({ data: {
      id: resourceBindingId,
      homeIdentityBindingId: home.id,
      network: expected.chainId,
      provider: expected.provider,
      capability: expected.capability,
      contractVersion: expected.contractVersion,
      profileRef: expected.profileRef,
      profileVersion: expected.profileVersion,
      resourceType: expected.resource.type,
      resourceRef: null,
      ownerProgramRef: expected.resource.ownerProgramRef,
      purpose: expected.resource.purpose,
      verification: verification as Prisma.InputJsonValue,
      verificationDigest,
      status: 'pending_custody',
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
    } });
    for (const binding of expected.authorityBindings) {
      await tx.resourceAuthorityBinding.create({ data: {
        id: stableId(`squads-${binding.role}`, request.id),
        governedResourceBindingId: resourceBindingId,
        homeIdentityBindingId: home.id,
        network: expected.chainId,
        provider: expected.provider,
        profileRef: expected.profileRef,
        profileVersion: expected.profileVersion,
        authorityRole: binding.role,
        keyRef: binding.keyRef,
        currentAuthority: null,
        ownerProgramRef: expected.resource.ownerProgramRef,
        providerResourceRef: null,
        allowedOperations: binding.allowedOperations as Prisma.InputJsonValue,
        custodyProvider: expected.custody.signerProvider,
        custodyStatus: binding.custodyStatus,
        custodyVerification: {
          permissionMask: binding.permissionMask,
          applicationIdentity: binding.applicationIdentity,
        } as Prisma.InputJsonValue,
        status: 'pending_custody',
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      } });
    }
    await tx.payerPolicy.create({ data: {
      id: payerPolicyId,
      homeIdentityBindingId: home.id,
      version: 1,
      network: expected.chainId,
      actionScope: actionScope as Prisma.InputJsonValue,
      actionScopeDigest,
      economicBearer: expected.payerPolicy.economicBearer,
      feePayerSignerRef: expected.payerPolicy.feePayerSignerRef,
      rentFundingSourceRef: expected.payerPolicy.rentFundingSourceRef,
      refundRecipientRef: expected.payerPolicy.refundRecipientRef,
      singleLimit: expected.payerPolicy.singleLimit as Prisma.InputJsonValue,
      fundingBlockerCode: expected.payerPolicy.fundingBlockerCode,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      policyDigest,
      status: 'inactive',
    } });
  });
  return {
    executionStatus: 'executed',
    executionRef: resourceBindingId,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'canonical_binding_owners_created',
      chainId: expected.chainId,
      provider: expected.provider,
      capability: expected.capability,
      profileRef: expected.profileRef,
      profileVersion: expected.profileVersion,
      resourceBindingId,
      resourceStatus: 'pending_custody',
      authorityBindingCount: expected.authorityBindings.length,
      payerPolicyId,
      payerStatus: 'inactive',
      providerEffect: 'not_started',
      activation: 'not_activated',
    },
  };
}

async function executeAdoption(
  prisma: PrismaClient,
  input: { request: GovernanceExecutableRequest; decisionDigest: string; now: Date },
  dependencies?: {
    readOpenBaoKeyInventory?: typeof readSquadsOpenBaoRuntimeKeyInventory;
    verifyTrustProfile?: typeof verifySquadsProviderTrustProfileReadback;
    readExistingResource?: typeof readExistingSquadsDevnetResource;
    createConnection?: typeof createSquadsDevnetConnection;
  },
): Promise<GovernanceActionExecutionOutcome> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle' || !request.homeIdentityBindingId || !request.invocationId) {
    throw new Error('squads_provider_adoption_runtime_owner_required');
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error('squads_provider_adoption_decision_digest_invalid');
  }
  const circleId = positiveInteger(request.targetRef);
  if (!circleId) throw new Error('squads_provider_adoption_circle_invalid');
  const supplied = record(request.payload);
  assertEvidencePolicy(supplied, 'squads_provider_adoption_evidence_policy_mismatch');
  const origin = record(supplied.origin);
  const resource = record(supplied.resource);
  const providerReadback = record(supplied.providerReadback);
  const expected = buildSquadsProviderAdoptionPayload({
    targetCircleId: Number(supplied.targetCircleId),
    originCircleRef: String(origin.circleRef ?? ''),
    historicalRequestRef: String(origin.historicalRequestRef ?? ''),
    addresses: {
      multisig: String(resource.multisig ?? ''),
      vault: String(resource.vault ?? ''),
      proposal: String(resource.proposal ?? ''),
      vaultTransaction: String(resource.vaultTransaction ?? ''),
    },
    authorities: Array.isArray(supplied.authorityBindings)
      ? supplied.authorityBindings.map((binding) => ({
        role: String(record(binding).role) as SquadsExistingResourceAdoptionInput['authorities'][number]['role'],
        publicKey: String(record(binding).publicKey ?? ''),
      }))
      : [],
    transactions: Array.isArray(providerReadback.transactions)
      ? providerReadback.transactions.map((transaction) => ({
        stepId: String(record(transaction).stepId) as SquadsExistingResourceAdoptionInput['transactions'][number]['stepId'],
        signature: String(record(transaction).signature ?? ''),
        slot: Number(record(transaction).slot),
      }))
      : [],
    memoText: String(providerReadback.memoText ?? ''),
    expectedStateDigest: String(resource.expectedStateDigest ?? ''),
  });
  assertPayloadDigest(
    'alcheme.governance.squads-provider-adoption-payload',
    supplied,
    { ...expected, evidencePolicy: supplied.evidencePolicy },
    'squads_provider_adoption_contract_mismatch',
  );
  if (expected.targetCircleId !== circleId) {
    throw new Error('squads_provider_adoption_circle_scope_mismatch');
  }
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.squads-provider-adoption-action-intent',
    supplied,
  );
  const runtime = dependencies ?? {};
  const [profileReadback, inventory] = await Promise.all([
    (runtime.verifyTrustProfile ?? verifySquadsProviderTrustProfileReadback)(),
    (runtime.readOpenBaoKeyInventory ?? readSquadsOpenBaoRuntimeKeyInventory)(),
  ]);
  if (
    profileReadback.profileRef !== expected.profileRef
    || profileReadback.profileVersion !== expected.profileVersion
    || profileReadback.profileDigest !== expected.profileDigest
    || profileReadback.chainId !== expected.chainId
    || profileReadback.commitment !== 'finalized'
  ) throw new Error('squads_provider_adoption_profile_readback_mismatch');
  const inventoryByRole = new Map(inventory.map((entry) => [entry.role, entry]));
  if (
    inventoryByRole.size !== expected.authorityBindings.length
    || expected.authorityBindings.some((binding) => {
      const observed = inventoryByRole.get(binding.role);
      return !observed
        || observed.keyRef !== binding.keyRef
        || observed.publicKey !== binding.publicKey
        || observed.policyName !== binding.applicationIdentity.policyName
        || observed.credentialRef !== binding.applicationIdentity.credentialRef
        || observed.tokenPeriodSeconds !== binding.applicationIdentity.tokenPeriodSeconds;
    })
  ) throw new Error('squads_provider_adoption_openbao_inventory_mismatch');
  const existingOwner = await prisma.governedResourceBinding.findUnique({
    where: { sourceRequestId: request.id },
    include: { authorityBindings: true },
  });
  if (existingOwner) {
    const persistedVerification = record(existingOwner.verification);
    const persistedReceipt = persistedVerification.providerReceipt as SquadsDevnetProviderReceipt | undefined;
    const persistedGraph = persistedVerification.accountGraph as SquadsDevnetAccountGraphReadback | undefined;
    if (
      existingOwner.sourceDecisionDigest !== decisionDigest
      || existingOwner.homeIdentityBindingId !== request.homeIdentityBindingId
      || existingOwner.resourceRef !== expected.resource.multisig
      || existingOwner.stateDigest !== expected.resource.expectedStateDigest
      || existingOwner.status !== 'active'
      || existingOwner.authorityBindings.length !== expected.authorityBindings.length
      || !persistedReceipt
      || persistedReceipt.providerFinality !== 'finalized'
      || !persistedGraph
      || persistedGraph.stateDigest !== expected.resource.expectedStateDigest
    ) throw new Error('squads_provider_adoption_idempotency_conflict');
    const reconciliation = await reconcileSquadsProviderBindingReadback(prisma, { circleId });
    if (reconciliation?.state !== 'verified') {
      throw new Error('squads_provider_adoption_replay_readback_blocked');
    }
    return {
      executionStatus: 'executed',
      executionRef: existingOwner.resourceRef!,
      errorCode: null,
      executionEvidence: {
        schemaVersion: 1,
        effect: 'squads_existing_no_asset_resource_adopted_finalized',
        resourceBindingId: existingOwner.id,
        providerReceipt: persistedReceipt,
        accountGraph: persistedGraph,
        providerTransaction: 'none',
        activation: 'active',
        replay: 'canonical_persisted_readback',
      },
    };
  }
  const authorities = Object.fromEntries(expected.authorityBindings.map((binding) => [
    binding.role,
    {
      keyRef: binding.keyRef,
      publicKey: binding.publicKey,
      permissionMask: binding.permissionMask,
    },
  ])) as SquadsDevnetContract['authorities'];
  const contract: SquadsDevnetContract = {
    requestId: expected.origin.historicalRequestRef,
    decisionDigest,
    actionIntentDigest,
    circleId: Number(expected.origin.circleRef),
    chainId: expected.chainId,
    profileRef: expected.profileRef,
    profileVersion: expected.profileVersion,
    programId: expected.resource.ownerProgramRef,
    treasury: getSquadsProviderTrustProfile().programConfig.treasury,
    memoProgram: expected.providerReadback.memoProgram,
    memoText: expected.providerReadback.memoText,
    threshold: expected.resource.threshold,
    timeLockSeconds: expected.resource.timeLockSeconds,
    vaultIndex: expected.resource.vaultIndex,
    authorities,
  };
  const connection = (runtime.createConnection ?? createSquadsDevnetConnection)(
    getSquadsProviderTrustProfile().readback.rpc.endpoint,
    getSquadsProviderTrustProfile().readback.timeoutMs,
  );
  const authoritative = await (runtime.readExistingResource ?? readExistingSquadsDevnetResource)(
    connection,
    contract,
    {
      addresses: {
        multisig: expected.resource.multisig,
        vault: expected.resource.vault,
        proposal: expected.resource.proposal,
        vaultTransaction: expected.resource.vaultTransaction,
      },
      transactions: expected.providerReadback.transactions,
    },
  );
  if (
    authoritative.accountGraph.stateDigest !== expected.resource.expectedStateDigest
    || authoritative.accountGraph.status !== 'verified_finalized'
    || authoritative.providerReceipt.providerFinality !== 'finalized'
    || authoritative.providerReceipt.totalSpendLamports < 0
    || authoritative.providerReceipt.finalBalanceLamports > getSquadsProviderTrustProfile().payerPolicy.maximumWalletBalanceLamports
  ) throw new Error('squads_provider_adoption_authoritative_readback_mismatch');

  const resourceBindingId = stableId('squads-resource', request.id);
  const payerPolicyId = stableId('squads-payer', request.id);
  const preflightId = stableId('squads-cost-preflight', request.id);
  const applicationIdentities = Object.fromEntries(inventory.map((entry) => [entry.role, {
    authMethod: 'openbao_periodic_token',
    policyName: entry.policyName,
    credentialRef: entry.credentialRef,
    tokenPeriodSeconds: entry.tokenPeriodSeconds,
    tokenAccessor: entry.tokenAccessor,
  }]));
  const verification = {
    schemaVersion: 1,
    profileDigest: expected.profileDigest,
    deploymentVerification: 'snapshot_verified_read_only',
    sourceReproducibility: 'unverified',
    resourceReadback: 'verified_finalized',
    custodyRecordRef: getSquadsProviderTrustProfile().keyCustodyRecord.recordRef,
    custodyStatus: 'verified_wallet_keys_provider_active',
    applicationIdentities,
    providerReceipt: authoritative.providerReceipt,
    accountGraph: authoritative.accountGraph,
    providerContract: contract,
    continuityAdoption: {
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      origin: expected.origin,
      providerTransaction: 'none',
      adoptedAt: now.toISOString(),
    },
    activation: 'active',
    activatedAt: now.toISOString(),
  };
  const verificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    verification,
  );
  const actionScope = {
    schemaVersion: 1,
    actionType: SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
    operation: expected.operation,
    chainId: expected.chainId,
    profileRef: expected.profileRef,
    profileVersion: expected.profileVersion,
    resourceRef: expected.resource.multisig,
    providerTransaction: 'prohibited',
  };
  const actionScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy-action-scope',
    actionScope,
  );
  const policyDigest = hashCanonicalGovernanceValue('alcheme.governance.payer-policy', {
    id: payerPolicyId,
    homeIdentityBindingId: request.homeIdentityBindingId,
    version: 1,
    network: expected.chainId,
    actionScope,
    feePayerSignerRef: expected.payerPolicy.feePayerSignerRef,
    singleLimit: { lamports: '0', scope: 'read_only_adoption' },
    periodLimit: { lamports: '0', scope: 'read_only_adoption' },
    sourceRequestId: request.id,
    sourceDecisionDigest: decisionDigest,
    status: 'active',
  });
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.cost-preflight',
    { preflightId, actionIntentDigest, checkedAt: now.toISOString(), providerTransaction: 'none' },
  );
  await prisma.$transaction(async (tx) => {
    const existing = await tx.governedResourceBinding.findUnique({
      where: { sourceRequestId: request.id },
      include: { authorityBindings: true },
    });
    if (existing) {
      if (
        existing.id !== resourceBindingId
        || existing.sourceDecisionDigest !== decisionDigest
        || existing.verificationDigest !== verificationDigest
        || existing.authorityBindings.length !== expected.authorityBindings.length
      ) throw new Error('squads_provider_adoption_idempotency_conflict');
      return;
    }
    const home = await tx.governanceHomeIdentityBinding.findUnique({
      where: { id: request.homeIdentityBindingId! },
    });
    if (
      !home
      || home.homeType !== 'circle'
      || home.homeRef !== String(circleId)
      || home.status !== 'active'
      || home.supersededAt
    ) throw new Error('squads_provider_adoption_home_identity_mismatch');
    const competing = await tx.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        capability: expected.capability,
        status: { in: ['pending_custody', 'active', 'degraded'] },
      },
    });
    if (competing) throw new Error('squads_provider_binding_already_exists');
    await tx.governedResourceBinding.create({ data: {
      id: resourceBindingId,
      homeIdentityBindingId: home.id,
      network: expected.chainId,
      provider: expected.provider,
      capability: expected.capability,
      contractVersion: expected.contractVersion,
      profileRef: expected.profileRef,
      profileVersion: expected.profileVersion,
      resourceType: expected.resource.type,
      resourceRef: authoritative.accountGraph.resourceRef,
      ownerProgramRef: expected.resource.ownerProgramRef,
      purpose: 'adopted_existing_no_real_asset_devnet_continuity',
      verification: verification as unknown as Prisma.InputJsonValue,
      verificationDigest,
      verifiedSlot: BigInt(authoritative.accountGraph.observedSlot),
      stateDigest: authoritative.accountGraph.stateDigest,
      status: 'active',
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      activatedAt: now,
    } });
    for (const binding of expected.authorityBindings) {
      const identity = inventoryByRole.get(binding.role)!;
      await tx.resourceAuthorityBinding.create({ data: {
        id: stableId(`squads-${binding.role}`, request.id),
        governedResourceBindingId: resourceBindingId,
        homeIdentityBindingId: home.id,
        network: expected.chainId,
        provider: expected.provider,
        profileRef: expected.profileRef,
        profileVersion: expected.profileVersion,
        authorityRole: binding.role,
        keyRef: binding.keyRef,
        currentAuthority: binding.publicKey,
        ownerProgramRef: expected.resource.ownerProgramRef,
        providerResourceRef: authoritative.accountGraph.resourceRef,
        allowedOperations: binding.allowedOperations as Prisma.InputJsonValue,
        custodyProvider: 'openbao_transit',
        custodyStatus: 'verified',
        custodyVerification: {
          keyVersion: 1,
          algorithm: 'ed25519',
          derived: false,
          exportable: false,
          allowPlaintextBackup: false,
          policyName: identity.policyName,
          credentialRef: identity.credentialRef,
          tokenAccessor: identity.tokenAccessor,
          verifiedAt: now.toISOString(),
          permissionMask: binding.permissionMask,
        } as Prisma.InputJsonValue,
        verifiedSlot: BigInt(authoritative.accountGraph.observedSlot),
        stateDigest: authoritative.accountGraph.stateDigest,
        status: 'active',
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
        activatedAt: now,
      } });
    }
    await tx.payerPolicy.create({ data: {
      id: payerPolicyId,
      homeIdentityBindingId: home.id,
      version: 1,
      network: expected.chainId,
      actionScope: actionScope as Prisma.InputJsonValue,
      actionScopeDigest,
      economicBearer: expected.payerPolicy.economicBearer,
      feePayerSignerRef: expected.payerPolicy.feePayerSignerRef,
      rentFundingSourceRef: expected.payerPolicy.feePayerSignerRef,
      refundRecipientRef: expected.payerPolicy.feePayerSignerRef,
      singleLimit: { lamports: '0', scope: 'read_only_adoption' },
      periodLimit: { lamports: '0', scope: 'read_only_adoption' },
      fundingBlockerCode: null,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      policyDigest,
      status: 'active',
      effectiveFrom: now,
    } });
    await tx.costPreflight.create({ data: {
      id: preflightId,
      invocationId: request.invocationId!,
      payerPolicyRef: payerPolicyId,
      attemptKey: `squads-provider-adoption:${request.id}:v1`,
      estimatedCost: {
        status: 'consumed',
        providerTransaction: 'none',
        estimatedLamports: '0',
      } as Prisma.InputJsonValue,
      balanceReadback: {
        feePayerPublicKey: expected.payerPolicy.feePayerPublicKey,
        balanceLamports: String(authoritative.providerReceipt.finalBalanceLamports),
        observedAt: now.toISOString(),
      } as Prisma.InputJsonValue,
      reservationRef: authoritative.accountGraph.resourceRef,
      quoteContext: actionScope as Prisma.InputJsonValue,
      status: 'consumed',
      checkedAt: now,
      expiresAt: null,
      actionIntentDigest,
      transactionAttemptDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.squads-provider-adoption-readback',
        authoritative,
      ),
      preflightDigest,
    } });
  });
  return {
    executionStatus: 'executed',
    executionRef: authoritative.accountGraph.resourceRef,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'squads_existing_no_asset_resource_adopted_finalized',
      resourceBindingId,
      payerPolicyId,
      preflightId,
      providerReceipt: authoritative.providerReceipt,
      accountGraph: authoritative.accountGraph,
      providerTransaction: 'none',
      activation: 'active',
    },
  };
}

export async function resolveSquadsCanonicalPreSignState(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    actionIntentDigest: string;
    resourceBindingId: string;
    resourceStatuses: string[];
    authorityStatuses: string[];
    expectedAuthorities: Array<{ role: string; publicKey: string }>;
    payerPolicyId: string;
    preflightId: string;
    profileRef: string;
    profileVersion: number;
    feePayerPublicKey: string;
    checkpoint: SquadsDevnetCheckpoint | SquadsGrantPayoutCheckpoint | null;
    role: string;
    operation: string;
    message: Uint8Array;
    connection: { getSlot(commitment: 'finalized'): Promise<number>; getBalance(
      publicKey: PublicKey,
      commitment: 'finalized',
    ): Promise<number> };
    verifyTrustProfile: () => Promise<unknown>;
    resolveAuthorityHealthPreflight: typeof resolveProviderExecutionAuthorityHealthPreflight;
    now: Date;
  },
): Promise<SquadsCanonicalPreSignStateReadback> {
  const steps = Array.isArray(input.checkpoint?.steps) ? input.checkpoint.steps : [];
  const step = [...steps].reverse().find((candidate) => candidate.status === 'quoted');
  const messageDigest = createHash('sha256').update(input.message).digest('hex');
  if (
    !step
    || step.messageDigest !== messageDigest
    || !/^[a-f0-9]{64}$/.test(step.manifestDigest)
    || !step.recentBlockhash
    || !Number.isSafeInteger(step.lastValidBlockHeight)
    || step.lastValidBlockHeight <= 0
    || !Number.isSafeInteger(step.feeLamports)
    || step.feeLamports < 0
    || !Number.isSafeInteger(step.authorizedCeilingLamports)
    || step.authorizedCeilingLamports < step.feeLamports
    || !Number.isSafeInteger(step.balanceBeforeLamports)
    || step.balanceBeforeLamports < 0
  ) throw new Error('squads_provider_pre_sign_checkpoint_invalid');
  const [resource, payer, preflight, authorityHealth, observedSlot, feePayerBalanceLamports] =
    await Promise.all([
      prisma.governedResourceBinding.findUnique({
        where: { id: input.resourceBindingId },
        include: { authorityBindings: true },
      }),
      prisma.payerPolicy.findUnique({ where: { id: input.payerPolicyId } }),
      prisma.costPreflight.findUnique({ where: { id: input.preflightId } }),
      input.resolveAuthorityHealthPreflight(prisma, input.request, input.now),
      input.connection.getSlot('finalized'),
      input.connection.getBalance(new PublicKey(input.feePayerPublicKey), 'finalized'),
      input.verifyTrustProfile(),
    ]);
  const authorities = Array.isArray(resource?.authorityBindings)
    ? resource.authorityBindings
    : [];
  const exactAuthorities = input.expectedAuthorities.map((expected) => authorities.find(
    (authority: any) => (
      authority.authorityRole === expected.role
      && authority.currentAuthority === new PublicKey(expected.publicKey).toBase58()
      && input.authorityStatuses.includes(String(authority.status))
      && authority.profileRef === input.profileRef
      && Number(authority.profileVersion) === input.profileVersion
    ),
  ));
  if (
    !resource
    || !input.resourceStatuses.includes(String(resource.status))
    || resource.profileRef !== input.profileRef
    || Number(resource.profileVersion) !== input.profileVersion
    || exactAuthorities.some((authority) => !authority)
    || new Set(exactAuthorities.map((authority: any) => authority.id)).size
      !== input.expectedAuthorities.length
    || !payer
    || payer.id !== input.payerPolicyId
    || payer.status !== 'active'
    || payer.sourceRequestId !== input.request.id
    || payer.sourceDecisionDigest !== input.decisionDigest
    || !payer.policyDigest
    || !preflight
    || preflight.id !== input.preflightId
    || preflight.payerPolicyRef !== payer.id
    || preflight.actionIntentDigest !== input.actionIntentDigest
    || !['pending', 'ready'].includes(String(preflight.status))
    || !Number.isSafeInteger(observedSlot)
    || observedSlot <= 0
    || feePayerBalanceLamports !== step.balanceBeforeLamports
  ) throw new Error('squads_provider_pre_sign_canonical_state_drift');
  const canonicalOwnerFacts = {
    resource: {
      id: resource.id,
      status: resource.status,
      verificationDigest: resource.verificationDigest,
      stateDigest: resource.stateDigest,
      profileRef: resource.profileRef,
      profileVersion: resource.profileVersion,
    },
    authorities: exactAuthorities.map((authority: any) => ({
      id: authority.id,
      role: authority.authorityRole,
      status: authority.status,
      publicAuthority: authority.currentAuthority,
      allowedOperations: [...authority.allowedOperations].map(String).sort(),
    })).sort((left, right) => left.role.localeCompare(right.role)),
    payer: {
      id: payer.id,
      status: payer.status,
      policyDigest: payer.policyDigest,
      sourceRequestId: payer.sourceRequestId,
      sourceDecisionDigest: payer.sourceDecisionDigest,
    },
    preflight: {
      id: preflight.id,
      status: preflight.status,
      preflightDigest: preflight.preflightDigest,
      actionIntentDigest: preflight.actionIntentDigest,
    },
  };
  const facts = {
    schemaVersion: 1 as const,
    authority: 'canonical_owner_provider_state_and_p05_health' as const,
    requestId: input.request.id,
    decisionDigest: input.decisionDigest,
    actionIntentDigest: input.actionIntentDigest,
    resourceBindingId: input.resourceBindingId,
    payerPolicyId: input.payerPolicyId,
    preflightId: input.preflightId,
    role: input.role,
    operation: input.operation,
    providerState: {
      observedSlot,
      feePayerBalanceLamports,
      stepId: String(step.id),
      manifestDigest: step.manifestDigest,
      messageDigest,
      recentBlockhash: step.recentBlockhash,
      lastValidBlockHeight: step.lastValidBlockHeight,
      feeLamports: step.feeLamports,
      authorizedCeilingLamports: step.authorizedCeilingLamports,
      simulation: 'passed' as const,
    },
    canonicalOwnerDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.squads-canonical-pre-sign-owner-state-v1',
      canonicalOwnerFacts,
    ),
    authorityHealthDigest: authorityHealth.digest,
    emergencyFreeze: 'clear_fresh_p05_authority_health' as const,
    observedAt: input.now.toISOString(),
  };
  return {
    ...facts,
    digest: hashCanonicalGovernanceValue(
      'alcheme.governance.squads-pre-sign-state-precondition-v1',
      facts,
    ),
  };
}

async function executeBootstrap(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
    source?: GovernanceRequestExecutionSource;
  },
  dependencies?: {
    resolveAuthorityHealthPreflight?: typeof resolveProviderExecutionAuthorityHealthPreflight;
    resolveCanonicalPreSignState?: typeof resolveSquadsCanonicalPreSignState;
    signCanonicalMessage?: typeof signSquadsOpenBaoCanonicalMessage;
  },
): Promise<GovernanceActionExecutionOutcome> {
  const { request, decisionDigest, now } = input;
  if (request.targetType !== 'circle' || !request.homeIdentityBindingId || !request.invocationId) {
    throw new Error('squads_provider_bootstrap_runtime_owner_required');
  }
  const circleId = positiveInteger(request.targetRef);
  if (!circleId) throw new Error('squads_provider_bootstrap_circle_invalid');
  const supplied = record(request.payload);
  assertEvidencePolicy(supplied, 'squads_provider_bootstrap_evidence_policy_mismatch');
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.squads-provider-action-intent',
    supplied,
  );
  const attemptKey = `squads-provider-bootstrap:${request.id}:v1`;
  const existingPreflight = await prisma.costPreflight.findUnique({
    where: { invocationId_attemptKey: { invocationId: request.invocationId, attemptKey } },
    include: { payerPolicy: true },
  });
  const payerPayload = record(supplied.payerAuthorization);
  const expected = await buildSquadsProviderBootstrapPayload(prisma, {
    circleId,
    retryRequestId: existingPreflight ? request.id : undefined,
    sourcePayerPolicyId: existingPreflight && typeof payerPayload.currentPolicyId === 'string'
      ? payerPayload.currentPolicyId
      : undefined,
  });
  assertPayloadDigest(
    'alcheme.governance.squads-provider-bootstrap-payload',
    supplied,
    { ...expected, evidencePolicy: supplied.evidencePolicy },
    'squads_provider_bootstrap_contract_mismatch',
  );
  const payer = expected.payerAuthorization;
  const payerPolicyId = stableId('squads-bootstrap-payer', request.id);
  const preflightId = stableId('squads-cost-preflight', request.id);
  const actionScope = {
    schemaVersion: 1,
    actionType: SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
    chainId: expected.chainId,
    profileRef: expected.profileRef,
    profileVersion: expected.profileVersion,
    resourceBindingId: expected.resourceBinding.id,
    operations: expected.providerIntent.operations,
    noRealAssets: true,
  };
  const singleLimit = {
    lamports: payer.singleTransactionLimitLamports,
    scope: 'per_transaction',
    includes: ['fee', 'rent'],
  };
  const periodLimit = {
    lamports: payer.totalVerticalLimitLamports,
    scope: 'initial_squads_devnet_vertical',
    maximumWalletBalanceLamports: payer.maximumWalletBalanceLamports,
  };
  const policyDigest = hashCanonicalGovernanceValue('alcheme.governance.payer-policy', {
    id: payerPolicyId,
    homeIdentityBindingId: request.homeIdentityBindingId,
    version: 2,
    network: expected.chainId,
    actionScope,
    feePayerSignerRef: payer.feePayerSignerRef,
    singleLimit,
    periodLimit,
    sourceRequestId: request.id,
    sourceDecisionDigest: decisionDigest,
    status: 'active',
  });
  const checkedAt = now;
  const expiresAt = new Date(now.getTime() + 300_000);
  const estimatedCost = {
    status: 'pending_rpc_quote',
    singleTransactionLimitLamports: payer.singleTransactionLimitLamports,
    totalVerticalLimitLamports: payer.totalVerticalLimitLamports,
  };
  if (!existingPreflight) await prisma.$transaction(async (tx) => {
    const sourcePayer = await tx.payerPolicy.findUnique({ where: { id: payer.currentPolicyId } });
    if (
      !sourcePayer
      || sourcePayer.status !== 'inactive'
      || sourcePayer.fundingBlockerCode !== 'devnet_fee_cap_required'
      || sourcePayer.supersededAt
    ) throw new Error('squads_provider_bootstrap_source_payer_mismatch');
    await tx.payerPolicy.create({ data: {
      id: payerPolicyId,
      homeIdentityBindingId: request.homeIdentityBindingId!,
      version: 2,
      network: expected.chainId,
      actionScope: actionScope as Prisma.InputJsonValue,
      actionScopeDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.payer-policy-action-scope',
        actionScope,
      ),
      economicBearer: payer.economicBearer,
      feePayerSignerRef: payer.feePayerSignerRef,
      rentFundingSourceRef: payer.feePayerSignerRef,
      refundRecipientRef: payer.feePayerSignerRef,
      singleLimit: singleLimit as Prisma.InputJsonValue,
      periodLimit: periodLimit as Prisma.InputJsonValue,
      fundingBlockerCode: null,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      policyDigest,
      status: 'active',
      effectiveFrom: checkedAt,
    } });
    const superseded = await tx.payerPolicy.updateMany({
      where: { id: sourcePayer.id, status: 'inactive', supersededAt: null },
      data: { status: 'superseded', supersededAt: checkedAt },
    });
    if (superseded.count !== 1) throw new Error('squads_provider_bootstrap_source_payer_conflict');
    await tx.costPreflight.create({ data: {
      id: preflightId,
      invocationId: request.invocationId!,
      payerPolicyRef: payerPolicyId,
      attemptKey,
      estimatedCost: estimatedCost as Prisma.InputJsonValue,
      quoteContext: {
        chainId: expected.chainId,
        profileRef: expected.profileRef,
        profileVersion: expected.profileVersion,
        resourceBindingId: expected.resourceBinding.id,
        commitment: expected.providerIntent.commitment,
        resubmitPolicy: expected.providerIntent.resubmitPolicy,
      } as Prisma.InputJsonValue,
      status: 'pending',
      checkedAt,
      expiresAt,
      actionIntentDigest,
      preflightDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.cost-preflight',
        { preflightId, attemptKey, actionIntentDigest, checkedAt: checkedAt.toISOString() },
      ),
    } });
  });
  const baselinePreflight = await prisma.costPreflight.findUnique({
    where: { invocationId_attemptKey: { invocationId: request.invocationId, attemptKey } },
    include: { payerPolicy: true },
  });
  if (!baselinePreflight
    || baselinePreflight.actionIntentDigest !== actionIntentDigest
    || baselinePreflight.payerPolicy.policyDigest !== policyDigest) {
    throw new Error('squads_provider_bootstrap_preflight_owner_mismatch');
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
  const consumed = consumedEvidence(preflight.estimatedCost);
  if (preflight.status === 'consumed' && consumed) return {
    executionStatus: 'executed',
    executionRef: consumed.accountGraph.resourceRef,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'squads_devnet_no_asset_vertical_finalized',
      resourceBindingId: expected.resourceBinding.id,
      payerPolicyId: preflight.payerPolicyRef,
      preflightId: preflight.id,
      providerReceipt: consumed.providerReceipt,
      accountGraph: consumed.accountGraph,
      preSignStateReadbacks: consumed.preSignStateReadbacks,
      replay: 'canonical_consumed_readback',
    },
  };
  const authorities = Object.fromEntries(expected.authorityBindings.map((binding) => [
    binding.role,
    {
      keyRef: binding.keyRef,
      publicKey: binding.publicKey,
      permissionMask: binding.permissionMask,
    },
  ])) as SquadsDevnetContract['authorities'];
  const contract: SquadsDevnetContract = {
    requestId: request.id,
    decisionDigest,
    actionIntentDigest,
    circleId,
    chainId: expected.chainId,
    profileRef: expected.profileRef,
    profileVersion: expected.profileVersion,
    programId: expected.providerIntent.programId,
    treasury: getSquadsProviderTrustProfile().programConfig.treasury,
    memoProgram: expected.providerIntent.memoProgram,
    memoText: expected.providerIntent.memoText,
    threshold: expected.providerIntent.threshold,
    timeLockSeconds: expected.providerIntent.timeLockSeconds,
    vaultIndex: expected.providerIntent.vaultIndex,
    authorities,
  };
  let latestCheckpoint = providerCheckpoint(preflight.estimatedCost);
  const preSignStateReadbacks: SquadsCanonicalPreSignStateReadback[] = [];
  const profile = getSquadsProviderTrustProfile();
  const connection = createSquadsDevnetConnection(
    profile.readback.rpc.endpoint,
    profile.readback.timeoutMs,
  );
  const receipt = await executeSquadsDevnetVertical(contract, {
    singleTransactionLimitLamports: Number(
      fundingAmendment?.singleLimit.lamports ?? payer.singleTransactionLimitLamports,
    ),
    totalVerticalLimitLamports: Number(
      fundingAmendment?.periodLimit.lamports ?? payer.totalVerticalLimitLamports,
    ),
    maximumWalletBalanceLamports: Number(payer.maximumWalletBalanceLamports),
    fundingTargetLamports: Number(payer.fundingTargetLamports),
  }, {
    connection,
    verifyTrustProfile: async () => { await verifySquadsProviderTrustProfileReadback(); },
    sign: async ({ role, operation, message }) => {
      const preSignState = await (dependencies?.resolveCanonicalPreSignState
        ?? resolveSquadsCanonicalPreSignState)(prisma, {
          request,
          decisionDigest,
          actionIntentDigest,
          resourceBindingId: expected.resourceBinding.id,
          resourceStatuses: ['pending_custody'],
          authorityStatuses: ['pending_provider_bootstrap'],
          expectedAuthorities: expected.authorityBindings.map((authority) => ({
            role: authority.role,
            publicKey: authority.publicKey,
          })),
          payerPolicyId,
          preflightId: preflight.id,
          profileRef: expected.profileRef,
          profileVersion: expected.profileVersion,
          feePayerPublicKey: contract.authorities.fee_payer.publicKey,
          checkpoint: latestCheckpoint,
          role,
          operation,
          message,
          connection,
          verifyTrustProfile: verifySquadsProviderTrustProfileReadback,
          resolveAuthorityHealthPreflight: dependencies?.resolveAuthorityHealthPreflight
            ?? resolveProviderExecutionAuthorityHealthPreflight,
          now: new Date(),
        });
      preSignStateReadbacks.push(preSignState);
      const providerAttemptInventory = squadsProviderAttemptInventory(
        latestCheckpoint,
        actionIntentDigest,
        preflight.payerPolicyRef,
      );
      const persisted = await prisma.costPreflight.updateMany({
        where: { id: preflight.id, actionIntentDigest, status: { in: ['pending', 'ready'] } },
        data: {
          estimatedCost: {
            ...estimatedCost,
            status: 'provider_in_progress',
            providerCheckpoint: latestCheckpoint as unknown as Prisma.InputJsonValue,
            preSignStateReadbacks: preSignStateReadbacks as unknown as Prisma.InputJsonValue,
            providerAttemptInventory: providerAttemptInventory as unknown as Prisma.InputJsonValue,
          } as unknown as Prisma.InputJsonValue,
          transactionAttemptDigest: providerAttemptInventory.latestAttemptDigest,
          status: 'ready',
        },
      });
      if (persisted.count !== 1) {
        throw new Error('squads_provider_bootstrap_pre_sign_state_conflict');
      }
      return (dependencies?.signCanonicalMessage ?? signSquadsOpenBaoCanonicalMessage)(prisma, {
        circleId,
        requestId: request.id,
        decisionDigest,
        actionIntentDigest,
        role,
        operation,
        message,
      });
    },
    checkpoint: async (checkpoint) => {
      latestCheckpoint = checkpoint;
      const providerAttemptInventory = squadsProviderAttemptInventory(
        checkpoint,
        actionIntentDigest,
        preflight.payerPolicyRef,
      );
      const updated = await prisma.costPreflight.updateMany({
        where: { id: preflight.id, actionIntentDigest, status: { in: ['pending', 'ready'] } },
        data: {
          estimatedCost: {
            ...estimatedCost,
            status: 'provider_in_progress',
            providerCheckpoint: checkpoint as unknown as Prisma.InputJsonValue,
            preSignStateReadbacks: preSignStateReadbacks as unknown as Prisma.InputJsonValue,
            providerAttemptInventory: providerAttemptInventory as unknown as Prisma.InputJsonValue,
          } as unknown as Prisma.InputJsonValue,
          balanceReadback: checkpoint.funding as unknown as Prisma.InputJsonValue,
          transactionAttemptDigest: providerAttemptInventory.latestAttemptDigest,
          status: 'ready',
        },
      });
      if (updated.count !== 1) throw new Error('squads_provider_bootstrap_checkpoint_conflict');
    },
  }, latestCheckpoint);
  const accountGraph = await readSquadsDevnetAccountGraph(connection, contract, receipt);
  const resource = await prisma.governedResourceBinding.findUnique({
    where: { id: expected.resourceBinding.id },
  });
  if (!resource || resource.status !== 'pending_custody' || resource.resourceRef !== null) {
    throw new Error('squads_provider_bootstrap_resource_owner_mismatch');
  }
  const verification = {
    ...record(resource.verification),
    profileDigest: expected.profileDigest,
    providerReceipt: receipt,
    accountGraph,
    resourceReadback: 'verified_finalized',
    custodyStatus: 'verified_wallet_keys_provider_active',
    activation: 'active',
    activatedAt: now.toISOString(),
    providerContract: contract,
  };
  const verificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification',
    verification,
  );
  await prisma.$transaction(async (tx) => {
    const resourceUpdate = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        status: 'pending_custody',
        resourceRef: null,
        verificationDigest: resource.verificationDigest,
      },
      data: {
        resourceRef: accountGraph.resourceRef,
        verification: verification as unknown as Prisma.InputJsonValue,
        verificationDigest,
        verifiedSlot: BigInt(accountGraph.observedSlot),
        stateDigest: accountGraph.stateDigest,
        status: 'active',
        activatedAt: now,
      },
    });
    if (resourceUpdate.count !== 1) throw new Error('squads_provider_bootstrap_resource_activation_conflict');
    const authorityUpdate = await tx.resourceAuthorityBinding.updateMany({
      where: { governedResourceBindingId: resource.id, status: 'pending_provider_bootstrap' },
      data: {
        providerResourceRef: accountGraph.resourceRef,
        verifiedSlot: BigInt(accountGraph.observedSlot),
        stateDigest: accountGraph.stateDigest,
        status: 'active',
        activatedAt: now,
      },
    });
    if (authorityUpdate.count !== expected.authorityBindings.length) {
      throw new Error('squads_provider_bootstrap_authority_activation_conflict');
    }
    const preflightUpdate = await tx.costPreflight.updateMany({
      where: { id: preflight.id, actionIntentDigest, status: { in: ['pending', 'ready'] } },
      data: {
        estimatedCost: {
          ...estimatedCost,
          status: 'consumed',
          providerCheckpoint: latestCheckpoint as unknown as Prisma.InputJsonValue,
          providerReceipt: receipt,
          accountGraph,
          preSignStateReadbacks: preSignStateReadbacks as unknown as Prisma.InputJsonValue,
          providerAttemptInventory: squadsProviderAttemptInventory(
            latestCheckpoint,
            actionIntentDigest,
            preflight.payerPolicyRef,
          ) as unknown as Prisma.InputJsonValue,
        } as unknown as Prisma.InputJsonValue,
        balanceReadback: {
          finalBalanceLamports: receipt.finalBalanceLamports,
          totalSpendLamports: receipt.totalSpendLamports,
          providerFinality: receipt.providerFinality,
        } as Prisma.InputJsonValue,
        reservationRef: accountGraph.resourceRef,
        transactionAttemptDigest: squadsProviderAttemptInventory(
          latestCheckpoint,
          actionIntentDigest,
          preflight.payerPolicyRef,
        ).latestAttemptDigest,
        status: 'consumed',
      },
    });
    if (preflightUpdate.count !== 1) throw new Error('squads_provider_bootstrap_preflight_consumption_conflict');
  });
  return {
    executionStatus: 'executed',
    executionRef: accountGraph.resourceRef,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'squads_devnet_no_asset_vertical_finalized',
      resourceBindingId: resource.id,
      payerPolicyId,
      preflightId,
      providerReceipt: receipt,
      accountGraph,
      preSignStateReadbacks,
    },
  };
}

async function executeGrantPayoutAction(
  prisma: PrismaClient,
  input: {
    request: GovernanceExecutableRequest;
    decisionDigest: string;
    now: Date;
    source?: GovernanceRequestExecutionSource;
  },
  dependencies?: {
    verifyTrustProfile?: typeof verifySquadsProviderTrustProfileReadback;
    createConnection?: typeof createSquadsDevnetConnection;
    executeGrantPayout?: typeof executeSquadsGrantPayout;
    refreshGrantReadiness?: typeof refreshGovernanceGrantSettlementReadiness;
    resolveAuthorityHealthPreflight?: typeof resolveProviderExecutionAuthorityHealthPreflight;
    resolveCanonicalPreSignState?: typeof resolveSquadsCanonicalPreSignState;
    signCanonicalMessage?: typeof signSquadsOpenBaoCanonicalMessage;
  },
): Promise<GovernanceActionExecutionOutcome> {
  const { request, decisionDigest, now } = input;
  if (
    request.targetType !== 'circle'
    || request.targetRef !== '35'
    || !request.homeIdentityBindingId
    || !request.invocationId
    || !/^[a-f0-9]{64}$/.test(decisionDigest)
  ) throw new Error('squads_grant_payout_runtime_owner_required');
  const supplied = record(request.payload);
  assertEvidencePolicy(supplied, 'squads_grant_payout_evidence_policy_mismatch');
  const profile = getSquadsProviderTrustProfile();
  const readiness = resolveSquadsProviderTrustReadiness();
  const agreementFacts = record(supplied.agreement);
  const resourceFacts = record(supplied.resourceBinding);
  const providerIntent = record(supplied.providerIntent);
  const payerAuthorization = record(supplied.payerAuthorization);
  const activation = record(supplied.activation);
  const lifecyclePolicy = record(supplied.lifecycle);
  const settlementAttempt = record(supplied.settlementAttempt);
  const authorities = Array.isArray(supplied.authorityBindings)
    ? supplied.authorityBindings.map(record)
    : [];
  const effectiveAtMs = Date.parse(String(activation.effectiveAt ?? ''));
  const expiresAtMs = Date.parse(String(activation.expiresAt ?? ''));
  if (
    supplied.schemaVersion !== 1
    || supplied.operation !== 'execute_exact_devnet_grant_payout'
    || supplied.circleId !== 35
    || supplied.chainId !== profile.chain.chainId
    || supplied.provider !== profile.provider
    || supplied.profileRef !== profile.profileRef
    || supplied.profileVersion !== profile.version
    || supplied.profileDigest !== readiness.profileDigest
    || providerIntent.programId !== profile.deployment.programId
    || providerIntent.commitment !== 'finalized'
    || providerIntent.noRealAssets !== true
    || providerIntent.amountLamports !== String(GRANT_PAYOUT_LAMPORTS)
    || providerIntent.vaultFundingTargetLamports !== String(GRANT_PAYOUT_VAULT_FUNDING_LAMPORTS)
    || payerAuthorization.economicBearer !== 'solana_devnet_faucet_only'
    || payerAuthorization.singleTransactionLimitLamports !== String(GRANT_PAYOUT_SINGLE_LIMIT_LAMPORTS)
    || payerAuthorization.totalActionLimitLamports !== String(GRANT_PAYOUT_TOTAL_LIMIT_LAMPORTS)
    || payerAuthorization.maximumWalletBalanceLamports
      !== String(profile.payerPolicy.maximumWalletBalanceLamports)
    || payerAuthorization.fundingSource !== 'solana_devnet_faucet'
    || agreementFacts.budgetUnit !== 'lamports'
    || agreementFacts.amountUnits !== providerIntent.amountLamports
    || agreementFacts.recipientRef !== `wallet:${String(providerIntent.recipient ?? '')}`
    || activation.maxDepth !== 1
    || activation.nonce !== providerIntent.transactionIndex
    || !Number.isFinite(effectiveAtMs)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs - effectiveAtMs !== 86_400_000
    || now.getTime() < effectiveAtMs
    || now.getTime() > expiresAtMs
    || lifecyclePolicy.inFlightDisposition !== 'hold_resource_and_retry_same_request'
    || lifecyclePolicy.rollback !== 'provider_effect_is_final_reconcile_canonical_readback'
    || lifecyclePolicy.disable !== 'block_new_payout_requests'
    || lifecyclePolicy.fallback !== 'prohibited'
    || !['new', 'renew_expired_no_effect'].includes(String(settlementAttempt.mode ?? ''))
  ) throw new Error('squads_grant_payout_contract_mismatch');
  const isRenewal = settlementAttempt.mode === 'renew_expired_no_effect';
  if (
    (!isRenewal && [
      settlementAttempt.resourceBindingId,
      settlementAttempt.payerPolicyId,
      settlementAttempt.assetAuthorityPolicyId,
      settlementAttempt.renewalOfRequestId,
      settlementAttempt.renewalOfDecisionDigest,
      settlementAttempt.retirementDigest,
    ].some((value) => value !== null))
    || (isRenewal && (
      typeof settlementAttempt.resourceBindingId !== 'string'
      || typeof settlementAttempt.payerPolicyId !== 'string'
      || typeof settlementAttempt.assetAuthorityPolicyId !== 'string'
      || !/^gov_req_[a-f0-9]{56}$/.test(String(settlementAttempt.renewalOfRequestId ?? ''))
      || !/^[a-f0-9]{64}$/.test(String(settlementAttempt.renewalOfDecisionDigest ?? ''))
      || !/^[a-f0-9]{64}$/.test(String(settlementAttempt.retirementDigest ?? ''))
    ))
  ) throw new Error('squads_grant_payout_settlement_attempt_mismatch');
  const actionIntentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.squads-grant-payout-action-intent-v1', supplied,
  );
  const preflightId = stableId('squads-grant-preflight', request.id);
  const attemptKey = `squads-grant-payout:${request.id}:v1`;
  const existingPreflight = await prisma.costPreflight.findUnique({
    where: { invocationId_attemptKey: { invocationId: request.invocationId, attemptKey } },
  });
  const [sourceResource, agreement] = await Promise.all([
    prisma.governedResourceBinding.findUnique({
      where: { id: String(resourceFacts.id ?? '') },
      include: { authorityBindings: true },
    }),
    prisma.governanceGrantAgreement.findUnique({
      where: { id: String(agreementFacts.id ?? '') },
      include: { governanceCase: { select: { homeIdentityBindingId: true } } },
    }),
  ]);
  const sourceResourceVault = record(
    record(record(sourceResource?.verification).accountGraph).accountGraph,
  ).vault;
  if (
    !sourceResource
    || sourceResource.homeIdentityBindingId !== request.homeIdentityBindingId
    || sourceResource.status !== 'active'
    || sourceResource.capability !== profile.resourceContract.capability
    || sourceResource.resourceRef !== resourceFacts.multisig
    || sourceResource.stateDigest !== resourceFacts.stateDigest
    || String(sourceResource.verifiedSlot) !== resourceFacts.verifiedSlot
    || sourceResource.profileRef !== supplied.profileRef
    || sourceResource.profileVersion !== supplied.profileVersion
    || resourceFacts.vault !== providerIntent.vault
    || sourceResourceVault !== providerIntent.vault
  ) throw new Error('squads_grant_payout_resource_owner_mismatch');
  const agreementLifecycle = record(agreement?.lifecycle);
  const intent = (Array.isArray(agreementLifecycle.trancheIntents)
    ? agreementLifecycle.trancheIntents : []).find(
    (candidate: any) => candidate?.id === agreementFacts.trancheIntentId,
  );
  if (
    !agreement
    || agreement.governanceCase?.homeIdentityBindingId !== request.homeIdentityBindingId
    || agreement.status !== 'active'
    || agreement.termsDigest !== agreementFacts.termsDigest
    || agreement.lifecycleDigest !== agreementFacts.lifecycleDigest
    || agreement.lifecycleVersion !== agreementFacts.lifecycleVersion
    || agreement.budgetUnit !== 'lamports'
    || agreement.recipientRef !== agreementFacts.recipientRef
    || !intent
    || intent.status !== 'contractual_pending_settlement'
    || intent.milestoneResultDigest !== agreementFacts.milestoneResultDigest
    || intent.amountUnits !== providerIntent.amountLamports
    || intent.recipientRef !== `wallet:${providerIntent.recipient}`
  ) throw new Error('squads_grant_payout_agreement_owner_mismatch');
  const profileContracts = new Map(profile.keyCustodyRecord.keyContracts.map(
    (contract) => [contract.role, contract],
  ));
  const sourceAuthorities = new Map(sourceResource.authorityBindings.map(
    (binding) => [binding.authorityRole, binding],
  ));
  const feePayerAuthority = authorities.find(
    (authority) => authority.role === 'fee_payer',
  );
  if (
    authorities.length !== profileContracts.size
    || authorities.some((authority) => {
      const contract = profileContracts.get(authority.role);
      const source = sourceAuthorities.get(authority.role);
      return !contract || !source
        || authority.keyRef !== contract.keyRef
        || authority.publicKey !== source.currentAuthority
        || authority.permissionMask !== contract.permissionMask
        || !sameStringSet(stringArray(authority.allowedOperations), contract.allowedOperations)
        || source.status !== 'active';
    })
    || !feePayerAuthority
    || payerAuthorization.feePayerSignerRef !== feePayerAuthority.keyRef
  ) throw new Error('squads_grant_payout_authority_owner_mismatch');
  const payoutAuthorities = authorities.filter((authority) => [
    'proposer_member', 'approver_member', 'executor_member',
  ].includes(String(authority.role)));
  if (payoutAuthorities.length !== 3) {
    throw new Error('squads_grant_payout_authority_inventory_mismatch');
  }

  const [renewalResource, renewalPayer, renewalAsset] = isRenewal
    ? await Promise.all([
      prisma.governedResourceBinding.findUnique({
        where: { id: String(settlementAttempt.resourceBindingId) },
        include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
      }),
      prisma.payerPolicy.findUnique({ where: { id: String(settlementAttempt.payerPolicyId) } }),
      prisma.assetAuthorityPolicy.findUnique({
        where: { id: String(settlementAttempt.assetAuthorityPolicyId) },
      }),
    ])
    : [null, null, null];
  const renewalVerification = record(renewalResource?.verification);
  const priorRetirement = record(renewalVerification.attemptRetirement);
  const renewalLineage = record(renewalVerification.renewal);
  const renewalAssetFacts = record(renewalAsset?.rotationRevocation);
  const retiredRenewalOwnersMatch = Boolean(
    renewalResource
    && renewalResource.status === 'disabled'
    && renewalResource.sourceRequestId === settlementAttempt.renewalOfRequestId
    && renewalResource.sourceDecisionDigest === settlementAttempt.renewalOfDecisionDigest
    && priorRetirement.state === 'expired_no_provider_effect'
    && priorRetirement.requestId === settlementAttempt.renewalOfRequestId
    && priorRetirement.decisionDigest === settlementAttempt.renewalOfDecisionDigest
    && priorRetirement.retirementDigest === settlementAttempt.retirementDigest
    && renewalResource.authorityBindings.length === 3
    && renewalResource.authorityBindings.every((binding) => (
      binding.status === 'retired'
      && binding.sourceRequestId === settlementAttempt.renewalOfRequestId
      && binding.sourceDecisionDigest === settlementAttempt.renewalOfDecisionDigest
    ))
    && renewalPayer
    && renewalPayer.status === 'inactive'
    && renewalPayer.sourceRequestId === settlementAttempt.renewalOfRequestId
    && renewalPayer.sourceDecisionDigest === settlementAttempt.renewalOfDecisionDigest
    && renewalPayer.fundingBlockerCode === 'grant_payout_activation_expired'
    && renewalAsset
    && renewalAsset.status === 'inactive'
  );
  const activeRenewalOwnersMatch = Boolean(
    renewalResource
    && renewalResource.status === 'hold'
    && renewalResource.sourceRequestId === request.id
    && renewalResource.sourceDecisionDigest === decisionDigest
    && renewalLineage.renewalOfRequestId === settlementAttempt.renewalOfRequestId
    && renewalLineage.renewalOfDecisionDigest === settlementAttempt.renewalOfDecisionDigest
    && renewalLineage.retirementDigest === settlementAttempt.retirementDigest
    && renewalLineage.requestId === request.id
    && renewalLineage.decisionDigest === decisionDigest
    && renewalResource.authorityBindings.length === 3
    && renewalResource.authorityBindings.every((binding) => (
      binding.status === 'hold'
      && binding.sourceRequestId === request.id
      && binding.sourceDecisionDigest === decisionDigest
    ))
    && renewalPayer
    && renewalPayer.status === 'active'
    && renewalPayer.sourceRequestId === request.id
    && renewalPayer.sourceDecisionDigest === decisionDigest
    && renewalAsset
    && renewalAsset.status === 'active'
    && renewalAssetFacts.sourceRequestId === request.id
    && renewalAssetFacts.sourceDecisionDigest === decisionDigest
    && renewalAssetFacts.renewalOfRequestId === settlementAttempt.renewalOfRequestId
    && renewalAssetFacts.retirementDigest === settlementAttempt.retirementDigest
    && existingPreflight
    && existingPreflight.status === 'ready'
    && existingPreflight.actionIntentDigest === actionIntentDigest
    && existingPreflight.payerPolicyRef === settlementAttempt.payerPolicyId
    && existingPreflight.assetAuthorityPolicyRef === settlementAttempt.assetAuthorityPolicyId
  );
  if (isRenewal && (
    !renewalResource
    || (existingPreflight ? !activeRenewalOwnersMatch : !retiredRenewalOwnersMatch)
  )) throw new Error('squads_grant_payout_renewal_owner_mismatch');
  const payoutResourceId = isRenewal
    ? renewalResource!.id
    : stableId('squads-grant-resource', request.id);
  const payerPolicyId = isRenewal
    ? renewalPayer!.id
    : stableId('squads-grant-payer', request.id);
  const assetPolicyId = isRenewal
    ? renewalAsset!.id
    : stableId('squads-grant-asset', request.id);
  const actionScope = {
    schemaVersion: 1,
    actionType: GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
    capability: 'grant_settlement',
    chainId: supplied.chainId,
    profileRef: supplied.profileRef,
    profileVersion: supplied.profileVersion,
    agreementId: agreement.id,
    trancheIntentId: intent.id,
    resourceBindingId: payoutResourceId,
    allowedOperations: ['grant_payout'],
  };
  const actionScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy-action-scope', actionScope,
  );
  const singleLimit = { lamports: payerAuthorization.singleTransactionLimitLamports, scope: 'per_transaction' };
  const periodLimit = { lamports: payerAuthorization.totalActionLimitLamports, scope: request.id };
  const payerPolicyDigest = hashCanonicalGovernanceValue('alcheme.governance.payer-policy', {
    id: payerPolicyId,
    homeIdentityBindingId: request.homeIdentityBindingId,
    version: 3,
    network: supplied.chainId,
    actionScope,
    feePayerSignerRef: payerAuthorization.feePayerSignerRef,
    singleLimit,
    periodLimit,
    sourceRequestId: request.id,
    sourceDecisionDigest: decisionDigest,
    status: 'active',
  });
  const assetScope = {
    schemaVersion: 1,
    assetClass: 'native_sol',
    assetRef: providerIntent.vault,
    custodyMode: 'squads_vault_2_of_3',
    noRealAssets: true,
  };
  const assetScopeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.asset-authority-policy-scope', assetScope,
  );
  const assetPolicyDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.asset-authority-policy', {
      id: assetPolicyId,
      homeIdentityBindingId: request.homeIdentityBindingId,
      version: 1,
      network: supplied.chainId,
      ...assetScope,
      ownerRef: providerIntent.vault,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
    },
  );
  const initialVerification = {
    schemaVersion: 1,
    profileDigest: supplied.profileDigest,
    sourceResourceBindingId: sourceResource.id,
    attemptHistory: isRenewal && Array.isArray(renewalVerification.attemptHistory)
      ? renewalVerification.attemptHistory
      : [],
    renewal: isRenewal ? {
      schemaVersion: 1,
      renewalOfRequestId: settlementAttempt.renewalOfRequestId,
      renewalOfDecisionDigest: settlementAttempt.renewalOfDecisionDigest,
      retirementDigest: settlementAttempt.retirementDigest,
      requestId: request.id,
      decisionDigest,
      renewedAt: now.toISOString(),
    } : null,
    grantSettlement: {
      schemaVersion: 1,
      budgetUnit: 'lamports',
      assetClass: 'native_sol',
      assetRef: providerIntent.vault,
      providerFinality: null,
      fundingReadback: null,
    },
    inFlightDisposition: lifecyclePolicy.inFlightDisposition,
    providerCheckpoint: null,
  };
  const initialVerificationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.governed-resource-binding-verification', initialVerification,
  );
  if (!existingPreflight) await prisma.$transaction(async (tx) => {
    if (isRenewal) {
      const resourceUpdated = await tx.governedResourceBinding.updateMany({
        where: {
          id: payoutResourceId,
          status: 'disabled',
          sourceRequestId: settlementAttempt.renewalOfRequestId,
          sourceDecisionDigest: settlementAttempt.renewalOfDecisionDigest,
          verificationDigest: renewalResource!.verificationDigest,
        },
        data: {
          status: 'hold',
          disabledAt: null,
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
          verifiedSlot: null,
          stateDigest: null,
          verification: initialVerification as unknown as Prisma.InputJsonValue,
          verificationDigest: initialVerificationDigest,
        },
      });
      if (resourceUpdated.count !== 1) throw new Error('squads_grant_payout_renewal_resource_conflict');
      const authoritiesUpdated = await tx.resourceAuthorityBinding.updateMany({
        where: {
          governedResourceBindingId: payoutResourceId,
          status: 'retired',
          sourceRequestId: settlementAttempt.renewalOfRequestId,
          sourceDecisionDigest: settlementAttempt.renewalOfDecisionDigest,
        },
        data: {
          status: 'hold',
          retiredAt: null,
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
          verifiedSlot: null,
          stateDigest: null,
        },
      });
      if (authoritiesUpdated.count !== 3) {
        throw new Error('squads_grant_payout_renewal_authority_conflict');
      }
      const payerUpdated = await tx.payerPolicy.updateMany({
        where: {
          id: payerPolicyId,
          status: 'inactive',
          sourceRequestId: settlementAttempt.renewalOfRequestId,
          sourceDecisionDigest: settlementAttempt.renewalOfDecisionDigest,
          policyDigest: renewalPayer!.policyDigest,
        },
        data: {
          actionScope: actionScope as Prisma.InputJsonValue,
          actionScopeDigest,
          periodLimit: periodLimit as Prisma.InputJsonValue,
          fundingBlockerCode: null,
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
          policyDigest: payerPolicyDigest,
          status: 'active',
          effectiveFrom: now,
          expiry: new Date(String(activation.expiresAt)),
          supersededAt: null,
        },
      });
      if (payerUpdated.count !== 1) throw new Error('squads_grant_payout_renewal_payer_conflict');
      const assetUpdated = await tx.assetAuthorityPolicy.updateMany({
        where: { id: assetPolicyId, status: 'inactive', policyDigest: renewalAsset!.policyDigest },
        data: {
          rotationRevocation: {
            ...record(renewalAsset!.rotationRevocation),
            sourceRequestId: request.id,
            sourceDecisionDigest: decisionDigest,
            renewalOfRequestId: settlementAttempt.renewalOfRequestId,
            retirementDigest: settlementAttempt.retirementDigest,
          } as unknown as Prisma.InputJsonValue,
          policyDigest: assetPolicyDigest,
          status: 'active',
          effectiveFrom: now,
          supersededAt: null,
        },
      });
      if (assetUpdated.count !== 1) throw new Error('squads_grant_payout_renewal_asset_conflict');
    } else {
      await tx.governedResourceBinding.create({ data: {
      id: payoutResourceId,
      homeIdentityBindingId: request.homeIdentityBindingId!,
      network: supplied.chainId,
      provider: supplied.provider,
      capability: 'grant_settlement',
      contractVersion: 1,
      profileRef: supplied.profileRef,
      profileVersion: supplied.profileVersion,
      resourceType: 'squads_multisig_vault',
      resourceRef: providerIntent.vault,
      ownerProgramRef: providerIntent.programId,
      purpose: 'circle_35_no_real_asset_grant_payout',
      verification: initialVerification as Prisma.InputJsonValue,
      verificationDigest: initialVerificationDigest,
      status: 'hold',
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
    } });
    for (const authority of payoutAuthorities) {
      await tx.resourceAuthorityBinding.create({ data: {
        id: stableId(`squads-grant-authority-${authority.role}`, request.id),
        governedResourceBindingId: payoutResourceId,
        homeIdentityBindingId: request.homeIdentityBindingId!,
        network: supplied.chainId,
        provider: supplied.provider,
        profileRef: supplied.profileRef,
        profileVersion: supplied.profileVersion,
        authorityRole: authority.role,
        keyRef: authority.keyRef,
        currentAuthority: authority.publicKey,
        ownerProgramRef: providerIntent.programId,
        providerResourceRef: resourceFacts.multisig,
        allowedOperations: ['grant_payout'],
        custodyProvider: 'openbao_transit',
        custodyStatus: 'verified',
        custodyVerification: { sourceResourceAuthority: sourceAuthorities.get(authority.role)?.id },
        status: 'hold',
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
      } });
    }
    await tx.payerPolicy.create({ data: {
      id: payerPolicyId,
      homeIdentityBindingId: request.homeIdentityBindingId!,
      version: 3,
      network: supplied.chainId,
      actionScope: actionScope as Prisma.InputJsonValue,
      actionScopeDigest,
      economicBearer: payerAuthorization.economicBearer,
      feePayerSignerRef: payerAuthorization.feePayerSignerRef,
      rentFundingSourceRef: payerAuthorization.feePayerSignerRef,
      refundRecipientRef: payerAuthorization.feePayerSignerRef,
      singleLimit: singleLimit as Prisma.InputJsonValue,
      periodLimit: periodLimit as Prisma.InputJsonValue,
      fundingBlockerCode: null,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      policyDigest: payerPolicyDigest,
      status: 'active',
      effectiveFrom: now,
      expiry: new Date(String(activation.expiresAt)),
    } });
    await tx.assetAuthorityPolicy.create({ data: {
      id: assetPolicyId,
      homeIdentityBindingId: request.homeIdentityBindingId!,
      version: 1,
      network: supplied.chainId,
      assetClass: 'native_sol',
      assetRef: providerIntent.vault,
      assetScopeDigest,
      ownerRef: providerIntent.vault,
      custodyMode: 'squads_vault_2_of_3',
      rotationRevocation: {
        sourceRequestId: request.id,
        sourceDecisionDigest: decisionDigest,
        rotation: 'new_governance_request',
        revocation: 'new_governance_request',
      },
      policyDigest: assetPolicyDigest,
      status: 'active',
      effectiveFrom: now,
    } });
    }
    await tx.costPreflight.create({ data: {
      id: preflightId,
      invocationId: request.invocationId!,
      payerPolicyRef: payerPolicyId,
      assetAuthorityPolicyRef: assetPolicyId,
      attemptKey,
      estimatedCost: {
        status: 'pending_provider_execution',
        providerCheckpoint: null,
        singleTransactionLimitLamports: payerAuthorization.singleTransactionLimitLamports,
        totalActionLimitLamports: payerAuthorization.totalActionLimitLamports,
      },
      quoteContext: {
        chainId: supplied.chainId,
        profileRef: supplied.profileRef,
        profileVersion: supplied.profileVersion,
        sourceResourceBindingId: sourceResource.id,
        grantResourceBindingId: payoutResourceId,
        transactionIndex: providerIntent.transactionIndex,
        commitment: 'finalized',
      },
      status: 'ready',
      checkedAt: now,
      expiresAt: new Date(String(activation.expiresAt)),
      actionIntentDigest,
      preflightDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.cost-preflight',
        { preflightId, attemptKey, actionIntentDigest, checkedAt: now.toISOString() },
      ),
    } });
  });
  const baselinePreflight = await prisma.costPreflight.findUnique({
    where: { invocationId_attemptKey: { invocationId: request.invocationId, attemptKey } },
    include: { payerPolicy: true, assetAuthorityPolicy: true },
  });
  if (
    !baselinePreflight
    || baselinePreflight.actionIntentDigest !== actionIntentDigest
    || baselinePreflight.payerPolicy?.policyDigest !== payerPolicyDigest
    || baselinePreflight.assetAuthorityPolicy?.policyDigest !== assetPolicyDigest
  ) throw new Error('squads_grant_payout_preflight_owner_mismatch');
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
  if (fundingAmendment
    && preflight.assetAuthorityPolicyRef !== baselinePreflight.assetAuthorityPolicyRef) {
    throw new Error('squads_grant_payout_funding_amendment_asset_authority_mismatch');
  }
  const consumed = record(preflight.estimatedCost).providerReceipt as SquadsGrantPayoutReceipt | undefined;
  const preSignStateReadbacks = Array.isArray(record(preflight.estimatedCost).preSignStateReadbacks)
    ? record(preflight.estimatedCost).preSignStateReadbacks as SquadsCanonicalPreSignStateReadback[]
    : [];
  let receipt = consumed;
  let projectedAgreement: Record<string, unknown> | null = null;
  if (preflight.status !== 'consumed' || !receipt) {
    const executionResource = await prisma.governedResourceBinding.findUnique({
      where: { id: payoutResourceId },
      select: {
        status: true,
        sourceRequestId: true,
        sourceDecisionDigest: true,
        verification: true,
      },
    });
    const executionVerification = record(executionResource?.verification);
    const retryFacts = record(executionVerification.retry);
    if (
      executionResource?.status !== 'hold'
      || executionResource.sourceRequestId !== request.id
      || executionResource.sourceDecisionDigest !== decisionDigest
    ) throw new Error('squads_grant_payout_execution_resource_conflict');
    if (executionVerification.retry !== undefined && retryFacts.mode !== 'same_request_only') {
      throw new Error('squads_grant_payout_retry_state_invalid');
    }
    if (retryFacts.mode === 'same_request_only') {
      const nextRetryAt = Date.parse(String(retryFacts.nextRetryAt ?? ''));
      if (
        retryFacts.requestId !== request.id
        || !Number.isSafeInteger(Number(retryFacts.attemptCount))
        || Number(retryFacts.attemptCount) <= 0
        || !Number.isFinite(nextRetryAt)
      ) throw new Error('squads_grant_payout_retry_state_invalid');
      if (nextRetryAt > now.getTime()) {
        throw new Error('squads_grant_payout_retry_not_due');
      }
    }
    const authorityMap = Object.fromEntries(authorities.map((authority) => [authority.role, {
      keyRef: authority.keyRef,
      publicKey: authority.publicKey,
      permissionMask: authority.permissionMask,
    }])) as SquadsGrantPayoutContract['authorities'];
    const contract: SquadsGrantPayoutContract = {
      requestId: request.id,
      decisionDigest,
      actionIntentDigest,
      circleId: 35,
      chainId: 'solana:devnet',
      profileRef: supplied.profileRef,
      profileVersion: 1,
      programId: providerIntent.programId,
      multisig: resourceFacts.multisig,
      vault: providerIntent.vault,
      transactionIndex: providerIntent.transactionIndex,
      agreementId: agreement.id,
      trancheIntentId: intent.id,
      milestoneResultDigest: intent.milestoneResultDigest,
      recipient: providerIntent.recipient,
      amountLamports: providerIntent.amountLamports,
      vaultFundingTargetLamports: providerIntent.vaultFundingTargetLamports,
      authorities: authorityMap,
    };
    let checkpoint = record(preflight.estimatedCost).providerCheckpoint as
      SquadsGrantPayoutCheckpoint | null;
    const priorFundingFailureCode = String(executionVerification.failureCode ?? '');
    if (
      (checkpoint === null || (
        checkpoint.funding.status === 'pending'
        && checkpoint.funding.source === 'solana_devnet_faucet'
        && !checkpoint.funding.faucetAttempt
      ))
      && (priorFundingFailureCode === 'squads_grant_payout_funding_rate_limited'
        || priorFundingFailureCode === 'squads_grant_payout_funding_unavailable')
    ) {
      const priorFailureAt = String(executionVerification.failedAt ?? '');
      if (!Number.isFinite(Date.parse(priorFailureAt))) {
        throw new Error('squads_grant_payout_funding_failure_state_invalid');
      }
      checkpoint = {
        ...(checkpoint ?? {
          schemaVersion: 1,
          funding: {
            status: 'pending' as const,
            source: 'solana_devnet_faucet' as const,
            targetBalanceLamports: Number(providerIntent.vaultFundingTargetLamports),
            balanceBeforeLamports: 0,
          },
          recipientBalanceBeforeLamports: null,
          steps: [],
        }),
        funding: {
          ...(checkpoint?.funding ?? {
            status: 'pending' as const,
            source: 'solana_devnet_faucet' as const,
            targetBalanceLamports: Number(providerIntent.vaultFundingTargetLamports),
            balanceBeforeLamports: 0,
          }),
          faucetAttempt: {
            attemptedAt: priorFailureAt,
            outcome: priorFundingFailureCode === 'squads_grant_payout_funding_rate_limited'
              ? 'rate_limited'
              : 'unavailable',
          },
        },
      };
    }
    const connection = (dependencies?.createConnection ?? createSquadsDevnetConnection)(
      profile.readback.rpc.endpoint, profile.readback.timeoutMs,
    );
    const persistExecutionFailure = async (error: unknown): Promise<never> => {
      const failureCode = grantPayoutFailureCode(error);
      const currentFailureResource = await prisma.governedResourceBinding.findUnique({
        where: { id: payoutResourceId },
        select: { verification: true },
      });
      const priorRetry = record(record(currentFailureResource?.verification).retry);
      const priorAttemptCount = Number(priorRetry.attemptCount ?? 0);
      const attemptCount = Number.isSafeInteger(priorAttemptCount) && priorAttemptCount >= 0
        ? priorAttemptCount + 1
        : 1;
      const retryDelayMs = Math.min(
        GRANT_PAYOUT_RETRY_BASE_MS * (2 ** Math.min(attemptCount - 1, 5)),
        GRANT_PAYOUT_RETRY_MAX_MS,
      );
      const failureVerification = {
        ...initialVerification,
        providerCheckpoint: checkpoint,
        preSignStateReadbacks,
        failureCode,
        failedAt: now.toISOString(),
        retry: {
          mode: 'same_request_only',
          requestId: request.id,
          attemptCount,
          lastAttemptAt: now.toISOString(),
          nextRetryAt: new Date(now.getTime() + retryDelayMs).toISOString(),
          maxBackoffSeconds: GRANT_PAYOUT_RETRY_MAX_MS / 1000,
        },
      };
      const failureResourceUpdated = await prisma.governedResourceBinding.updateMany({
        where: {
          id: payoutResourceId,
          status: 'hold',
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
        },
        data: {
          status: 'hold',
          verification: failureVerification as unknown as Prisma.InputJsonValue,
          verificationDigest: hashCanonicalGovernanceValue(
            'alcheme.governance.governed-resource-binding-verification', failureVerification,
          ),
        },
      });
      if (failureResourceUpdated.count !== 1) {
        throw new Error('squads_grant_payout_failure_resource_conflict');
      }
      const failedAgreement = await prisma.governanceGrantAgreement.findUnique({
        where: { id: agreement.id },
        select: { id: true, caseId: true, settlementReadinessVersion: true },
      });
      if (!failedAgreement) throw new Error('squads_grant_payout_failure_readback_missing');
      try {
        await (dependencies?.refreshGrantReadiness ?? refreshGovernanceGrantSettlementReadiness)(
          prisma,
          {
            caseId: failedAgreement.caseId,
            agreementId: failedAgreement.id,
            expectedEvaluationVersion: Number(failedAgreement.settlementReadinessVersion ?? 0),
            now,
          },
        );
      } catch {
        throw new Error('squads_grant_payout_failure_readback_conflict');
      }
      throw new Error(failureCode);
    };
    try {
      receipt = await (dependencies?.executeGrantPayout ?? executeSquadsGrantPayout)(contract, {
        singleTransactionLimitLamports: Number(
          fundingAmendment?.singleLimit.lamports ?? GRANT_PAYOUT_SINGLE_LIMIT_LAMPORTS,
        ),
        totalVerticalLimitLamports: Number(
          fundingAmendment?.periodLimit.lamports ?? GRANT_PAYOUT_TOTAL_LIMIT_LAMPORTS,
        ),
        maximumWalletBalanceLamports: Number(payerAuthorization.maximumWalletBalanceLamports),
      }, {
        connection,
        verifyTrustProfile: async () => {
          await (dependencies?.verifyTrustProfile ?? verifySquadsProviderTrustProfileReadback)();
        },
        sign: async ({ role, operation, message }) => {
          const preSignState = await (dependencies?.resolveCanonicalPreSignState
            ?? resolveSquadsCanonicalPreSignState)(prisma, {
              request,
              decisionDigest,
              actionIntentDigest,
              resourceBindingId: payoutResourceId,
              resourceStatuses: ['hold'],
              authorityStatuses: ['hold'],
              expectedAuthorities: payoutAuthorities.map((authority) => ({
                role: authority.role,
                publicKey: authority.publicKey,
              })),
              payerPolicyId,
              preflightId: preflight.id,
              profileRef: supplied.profileRef,
              profileVersion: Number(supplied.profileVersion),
              feePayerPublicKey: String(feePayerAuthority.publicKey),
              checkpoint,
              role,
              operation,
              message,
              connection,
              verifyTrustProfile: dependencies?.verifyTrustProfile
                ?? verifySquadsProviderTrustProfileReadback,
              resolveAuthorityHealthPreflight: dependencies?.resolveAuthorityHealthPreflight
                ?? resolveProviderExecutionAuthorityHealthPreflight,
              now: new Date(),
            });
          preSignStateReadbacks.push(preSignState);
          const providerAttemptInventory = squadsProviderAttemptInventory(
            checkpoint,
            actionIntentDigest,
            preflight.payerPolicyRef,
          );
          const persisted = await prisma.costPreflight.updateMany({
            where: { id: preflight.id, actionIntentDigest, status: 'ready' },
            data: {
              estimatedCost: {
                ...record(preflight.estimatedCost),
                status: 'provider_in_progress',
                providerCheckpoint: checkpoint as unknown as Prisma.InputJsonValue,
                preSignStateReadbacks: preSignStateReadbacks as unknown as Prisma.InputJsonValue,
                providerAttemptInventory: providerAttemptInventory as unknown as Prisma.InputJsonValue,
              } as unknown as Prisma.InputJsonValue,
              transactionAttemptDigest: providerAttemptInventory.latestAttemptDigest,
            },
          });
          if (persisted.count !== 1) {
            throw new Error('squads_grant_payout_pre_sign_state_conflict');
          }
          return (dependencies?.signCanonicalMessage ?? signSquadsOpenBaoCanonicalMessage)(prisma, {
            circleId: 35,
            requestId: request.id,
            decisionDigest,
            actionIntentDigest,
            role,
            operation,
            message,
          });
        },
        checkpoint: async (value) => {
          checkpoint = value;
          const providerAttemptInventory = squadsProviderAttemptInventory(
            value,
            actionIntentDigest,
            preflight.payerPolicyRef,
          );
          const checkpointDigest = providerAttemptInventory.inventoryDigest;
          const updated = await prisma.costPreflight.updateMany({
            where: { id: preflight.id, actionIntentDigest, status: 'ready' },
            data: {
              estimatedCost: {
                ...record(preflight.estimatedCost),
                status: 'provider_in_progress',
                providerCheckpoint: value as unknown as Prisma.InputJsonValue,
                preSignStateReadbacks: preSignStateReadbacks as unknown as Prisma.InputJsonValue,
                providerAttemptInventory: providerAttemptInventory as unknown as Prisma.InputJsonValue,
              } as unknown as Prisma.InputJsonValue,
              balanceReadback: value.funding as unknown as Prisma.InputJsonValue,
              transactionAttemptDigest: providerAttemptInventory.latestAttemptDigest,
            },
          });
          if (updated.count !== 1) throw new Error('squads_grant_payout_checkpoint_conflict');
          const holdVerification = {
            ...initialVerification,
            providerCheckpoint: value,
            providerCheckpointDigest: checkpointDigest,
            preSignStateReadbacks,
          };
          const resourceUpdated = await prisma.governedResourceBinding.updateMany({
            where: {
              id: payoutResourceId,
              status: 'hold',
              sourceRequestId: request.id,
              sourceDecisionDigest: decisionDigest,
            },
            data: {
              verification: holdVerification as unknown as Prisma.InputJsonValue,
              verificationDigest: hashCanonicalGovernanceValue(
                'alcheme.governance.governed-resource-binding-verification', holdVerification,
              ),
            },
          });
          if (resourceUpdated.count !== 1) {
            throw new Error('squads_grant_payout_checkpoint_resource_conflict');
          }
        },
      }, checkpoint);
    } catch (error) {
      if (process.env.ALCHEME_P06_PROVIDER_DIAGNOSTIC === '1') {
        process.stderr.write(
          `[p06-squads-provider] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
        );
      }
      await persistExecutionFailure(error);
    }
    if (!receipt) throw new Error('squads_grant_payout_receipt_required');
    const finalVerification = {
      ...initialVerification,
      grantSettlement: {
        schemaVersion: 1,
        budgetUnit: 'lamports',
        assetClass: 'native_sol',
        assetRef: providerIntent.vault,
        providerFinality: 'finalized',
        fundingReadback: {
          authority: 'independent_provider_readback',
          availableUnits: receipt.vaultBalanceAfterLamports,
          slot: receipt.payoutSlot,
          stateDigest: receipt.stateDigest,
          finality: 'finalized',
          observedAt: now.toISOString(),
        },
      },
      providerCheckpoint: checkpoint,
      providerReceipt: receipt,
      preSignStateReadbacks,
    };
    try {
      projectedAgreement = await prisma.$transaction(async (tx) => {
      const resourceUpdated = await tx.governedResourceBinding.updateMany({
        where: {
          id: payoutResourceId,
          status: 'hold',
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
        },
        data: {
          verification: finalVerification as unknown as Prisma.InputJsonValue,
          verificationDigest: hashCanonicalGovernanceValue(
            'alcheme.governance.governed-resource-binding-verification', finalVerification,
          ),
          verifiedSlot: BigInt(receipt!.payoutSlot),
          stateDigest: receipt!.stateDigest,
          status: 'active',
          activatedAt: now,
        },
      });
      if (resourceUpdated.count !== 1) throw new Error('squads_grant_payout_resource_finality_conflict');
      const authorityUpdated = await tx.resourceAuthorityBinding.updateMany({
        where: {
          governedResourceBindingId: payoutResourceId,
          status: 'hold',
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
        },
        data: {
          verifiedSlot: BigInt(receipt!.payoutSlot),
          stateDigest: receipt!.stateDigest,
          status: 'active',
          activatedAt: now,
        },
      });
      if (authorityUpdated.count !== payoutAuthorities.length) {
        throw new Error('squads_grant_payout_authority_finality_conflict');
      }
      const preflightUpdated = await tx.costPreflight.updateMany({
        where: { id: preflight.id, actionIntentDigest, status: 'ready' },
        data: {
          estimatedCost: {
            ...record(preflight.estimatedCost),
            status: 'consumed',
            providerCheckpoint: checkpoint as unknown as Prisma.InputJsonValue,
            providerReceipt: receipt as unknown as Prisma.InputJsonValue,
            preSignStateReadbacks: preSignStateReadbacks as unknown as Prisma.InputJsonValue,
            providerAttemptInventory: squadsProviderAttemptInventory(
              checkpoint,
              actionIntentDigest,
              preflight.payerPolicyRef,
            ) as unknown as Prisma.InputJsonValue,
          } as unknown as Prisma.InputJsonValue,
          balanceReadback: {
            vaultBalanceAfterLamports: receipt!.vaultBalanceAfterLamports,
            recipientBalanceAfterLamports: receipt!.recipientBalanceAfterLamports,
            providerFinality: receipt!.providerFinality,
          },
          reservationRef: receipt!.payoutSignature,
          transactionAttemptDigest: squadsProviderAttemptInventory(
            checkpoint,
            actionIntentDigest,
            preflight.payerPolicyRef,
          ).latestAttemptDigest,
          status: 'consumed',
        },
      });
      if (preflightUpdated.count !== 1) throw new Error('squads_grant_payout_preflight_consumption_conflict');
        const finalized = await recordGovernanceGrantPayoutFinality(prisma, {
          agreementId: agreement.id,
          trancheIntentId: intent.id,
          milestoneResultDigest: intent.milestoneResultDigest,
          amountUnits: providerIntent.amountLamports,
          budgetUnit: 'lamports',
          recipientRef: `wallet:${providerIntent.recipient}`,
          resourceRef: payoutResourceId,
          payoutRef: receipt!.payoutSignature,
          providerStateDigest: receipt!.stateDigest,
          sourceRequestId: request.id,
          sourceDecisionDigest: decisionDigest,
          finalizedAt: now,
        }, { transaction: tx });
        const readiness = await (
          dependencies?.refreshGrantReadiness ?? refreshGovernanceGrantSettlementReadiness
        )(prisma, {
          caseId: agreement.caseId,
          agreementId: agreement.id,
          expectedEvaluationVersion: Number(finalized.agreement.settlementReadinessVersion ?? 0),
          now,
        }, { transaction: tx });
        return readiness.agreement;
      });
    } catch (error) {
      await persistExecutionFailure(error);
    }
  }
  if (!receipt) throw new Error('squads_grant_payout_receipt_required');
  if (!projectedAgreement) {
    const finalized = await recordGovernanceGrantPayoutFinality(prisma, {
      agreementId: agreement.id,
      trancheIntentId: intent.id,
      milestoneResultDigest: intent.milestoneResultDigest,
      amountUnits: providerIntent.amountLamports,
      budgetUnit: 'lamports',
      recipientRef: `wallet:${providerIntent.recipient}`,
      resourceRef: payoutResourceId,
      payoutRef: receipt.payoutSignature,
      providerStateDigest: receipt.stateDigest,
      sourceRequestId: request.id,
      sourceDecisionDigest: decisionDigest,
      finalizedAt: now,
    });
    projectedAgreement = finalized.agreement;
  }
  return {
    executionStatus: 'executed',
    executionRef: receipt.payoutSignature,
    errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'squads_devnet_grant_payout_finalized',
      agreementId: agreement.id,
      trancheIntentId: intent.id,
      grantResourceBindingId: payoutResourceId,
      payerPolicyId,
      assetAuthorityPolicyId: assetPolicyId,
      preflightId,
      providerReceipt: receipt,
      preSignStateReadbacks,
      canonicalFundingStatus: projectedAgreement.fundingStatus,
    },
  };
}

async function executeControl(
  prisma: PrismaClient,
  input: { request: GovernanceExecutableRequest; decisionDigest: string; now: Date },
  operation: 'disabled' | 'restored',
): Promise<GovernanceActionExecutionOutcome> {
  const { request, decisionDigest, now } = input;
  const action = operation === 'disabled' ? 'disable' : 'restore';
  if (request.targetType !== 'circle' || !request.homeIdentityBindingId) {
    throw new Error(`squads_provider_${action}_home_identity_required`);
  }
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    throw new Error(`squads_provider_${action}_decision_digest_invalid`);
  }
  const circleId = positiveInteger(request.targetRef);
  if (!circleId) throw new Error(`squads_provider_${action}_circle_invalid`);
  const supplied = record(request.payload);
  assertEvidencePolicy(supplied, `squads_provider_${action}_evidence_policy_mismatch`);
  const expected = operation === 'disabled'
    ? await buildSquadsProviderDisablePayload(prisma, { circleId })
    : await buildSquadsProviderRestorePayload(prisma, { circleId });
  assertPayloadDigest(
    `alcheme.governance.squads-provider-${action}-payload`,
    supplied,
    { ...expected, evidencePolicy: supplied.evidencePolicy },
    `squads_provider_${action}_owner_fact_mismatch`,
  );
  const resource = await prisma.governedResourceBinding.findUnique({
    where: { id: expected.resourceBinding.id },
  });
  if (!resource || resource.homeIdentityBindingId !== request.homeIdentityBindingId) {
    throw new Error(`squads_provider_${action}_resource_mismatch`);
  }
  if (operation === 'disabled') {
    const disable = expected as Awaited<ReturnType<typeof buildSquadsProviderDisablePayload>>;
    const providerDisable = {
      schemaVersion: 1,
      state: 'disabled',
      requestId: request.id,
      decisionDigest,
      disabledAt: now.toISOString(),
      reason: disable.reason,
      inFlightDisposition: disable.inFlightDisposition,
      inFlightDispositionDigest: disable.inFlightDispositionDigest,
      rollbackPolicy: disable.rollbackPolicy,
    };
    await prisma.$transaction(async (tx) => {
      const current = await tx.governedResourceBinding.findUnique({
        where: { id: resource.id },
      });
      if (!current || !['active', 'degraded'].includes(current.status)) {
        throw new Error('squads_provider_disable_binding_not_found');
      }
      const verification = { ...record(current.verification), providerDisable };
      const updated = await tx.governedResourceBinding.updateMany({
        where: {
          id: resource.id,
          homeIdentityBindingId: request.homeIdentityBindingId!,
          status: current.status,
          verificationDigest: current.verificationDigest,
          stateDigest: current.stateDigest,
        },
        data: {
          status: 'disabled',
          disabledAt: now,
          verification: verification as unknown as Prisma.InputJsonValue,
          verificationDigest: hashCanonicalGovernanceValue(
            'alcheme.governance.governed-resource-binding-verification',
            verification,
          ),
        },
      });
      if (updated.count !== 1) throw new Error('squads_provider_disable_conflict');
      const payer = await tx.payerPolicy.updateMany({
        where: {
          homeIdentityBindingId: resource.homeIdentityBindingId,
          network: resource.network,
          feePayerSignerRef: { not: null },
          status: 'active',
        },
        data: { status: 'inactive', fundingBlockerCode: 'provider_binding_disabled' },
      });
      if (payer.count !== 1) throw new Error('squads_provider_disable_payer_conflict');
    });
    return {
      executionStatus: 'executed', executionRef: resource.id, errorCode: null,
      executionEvidence: {
        schemaVersion: 1,
        effect: 'squads_provider_binding_disabled',
        resourceBindingId: resource.id,
        providerDisable,
        noProviderTransaction: true,
        noChainFactRewrite: true,
      },
    };
  }
  const restore = expected as Awaited<ReturnType<typeof buildSquadsProviderRestorePayload>>;
  const reconciliation = await reconcileSquadsProviderBindingReadback(prisma, {
    circleId,
    allowDisabled: true,
  });
  if (!reconciliation || reconciliation.state !== 'verified') {
    throw new Error(`squads_provider_restore_${reconciliation?.blocker ?? 'readback_unavailable'}`);
  }
  const providerRestore = {
    schemaVersion: 1,
    state: 'restored',
    requestId: request.id,
    decisionDigest,
    restoredAt: now.toISOString(),
    disabledBy: restore.disabledBy,
    reconciliation,
    restorePolicy: restore.restorePolicy,
  };
  await prisma.$transaction(async (tx) => {
    const current = await tx.governedResourceBinding.findUnique({ where: { id: resource.id } });
    const verification = record(current?.verification);
    const providerDisable = record(verification.providerDisable);
    if (
      !current
      || current.status !== 'disabled'
      || providerDisable.requestId !== restore.disabledBy.requestId
      || providerDisable.decisionDigest !== restore.disabledBy.decisionDigest
    ) throw new Error('squads_provider_restore_reconciliation_drift');
    const nextVerification = { ...verification, activation: 'active', providerRestore };
    const updated = await tx.governedResourceBinding.updateMany({
      where: {
        id: resource.id,
        homeIdentityBindingId: request.homeIdentityBindingId!,
        status: 'disabled',
        verificationDigest: current.verificationDigest,
        stateDigest: current.stateDigest,
      },
      data: {
        status: 'active',
        disabledAt: null,
        verifiedSlot: BigInt(reconciliation.observedSlot),
        verification: nextVerification as unknown as Prisma.InputJsonValue,
        verificationDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.governed-resource-binding-verification',
          nextVerification,
        ),
      },
    });
    if (updated.count !== 1) throw new Error('squads_provider_restore_conflict');
    const payer = await tx.payerPolicy.updateMany({
      where: {
        homeIdentityBindingId: resource.homeIdentityBindingId,
        network: resource.network,
        status: 'inactive',
        fundingBlockerCode: 'provider_binding_disabled',
      },
      data: { status: 'active', fundingBlockerCode: null },
    });
    if (payer.count !== 1) throw new Error('squads_provider_restore_payer_conflict');
  });
  return {
    executionStatus: 'executed', executionRef: resource.id, errorCode: null,
    executionEvidence: {
      schemaVersion: 1,
      effect: 'squads_provider_binding_restored',
      resourceBindingId: resource.id,
      providerRestore,
      noProviderTransaction: true,
      noChainFactRewrite: true,
    },
  };
}

export async function reconcileSquadsProviderBindingReadback(
  prisma: PrismaClient,
  input: { circleId: number; allowDisabled?: boolean },
): Promise<{
  state: 'verified';
  resourceBindingId: string;
  observedStateDigest: string;
  observedSlot: number;
  observedAt: string;
  executionProgress: {
    multisigResourceRef: string;
    threshold: 2;
    memberCount: 3;
    approvedMemberCount: 2;
    approvedRoles: ['proposer_member', 'approver_member'];
    pendingRequiredApprovals: 0;
    nonApprovingMemberRoles: ['executor_member'];
    transactionCount: number;
    transactions: Array<{
      stepId: SquadsDevnetProviderReceipt['transactions'][number]['stepId'];
      signature: string;
      slot: number;
      finality: 'finalized';
    }>;
    proposalState: 'executed';
    vaultTransactionState: 'executed';
    executionResult: 'executed_finalized';
    noRealAssets: true;
  };
} | { state: 'blocked'; blocker: string } | null> {
  const profile = getSquadsProviderTrustProfile();
  const home = await findCircleHome(prisma, input.circleId);
  if (!home) return null;
  const resource = await prisma.governedResourceBinding.findFirst({
    where: {
      homeIdentityBindingId: home.id,
      network: profile.chain.chainId,
      provider: profile.provider,
      capability: profile.resourceContract.capability,
      profileRef: profile.profileRef,
      profileVersion: profile.version,
      status: { in: input.allowDisabled ? ['active', 'degraded', 'disabled'] : ['active', 'degraded'] },
    },
  });
  if (!resource) return null;
  try {
    await verifySquadsProviderTrustProfileReadback();
    const verification = record(resource.verification);
    const receipt = verification.providerReceipt as SquadsDevnetProviderReceipt | undefined;
    const persisted = verification.accountGraph as SquadsDevnetAccountGraphReadback | undefined;
    if (!receipt || !persisted || receipt.providerFinality !== 'finalized') {
      return { state: 'blocked', blocker: 'authoritative_receipt_required' };
    }
    const contract = contractFromVerification(resource, verification, input.circleId);
    const connection = createSquadsDevnetConnection(
      profile.readback.rpc.endpoint,
      profile.readback.timeoutMs,
    );
    const observed = await readSquadsDevnetAccountGraph(connection, contract, receipt);
    if (
      observed.stateDigest !== persisted.stateDigest
      || resource.stateDigest !== persisted.stateDigest
      || resource.resourceRef !== observed.resourceRef
    ) return { state: 'blocked', blocker: 'authoritative_state_conflict' };
    return {
      state: 'verified',
      resourceBindingId: resource.id,
      observedStateDigest: observed.stateDigest,
      observedSlot: observed.observedSlot,
      observedAt: new Date().toISOString(),
      executionProgress: {
        multisigResourceRef: observed.resourceRef,
        threshold: observed.threshold,
        memberCount: observed.memberCount,
        approvedMemberCount: observed.approvedMemberCount,
        approvedRoles: ['proposer_member', 'approver_member'],
        pendingRequiredApprovals: 0,
        nonApprovingMemberRoles: ['executor_member'],
        transactionCount: receipt.transactions.length,
        transactions: receipt.transactions.map((transaction) => ({
          stepId: transaction.stepId,
          signature: transaction.signature,
          slot: transaction.slot,
          finality: 'finalized' as const,
        })),
        proposalState: observed.proposalState,
        vaultTransactionState: observed.vaultTransactionState,
        executionResult: 'executed_finalized',
        noRealAssets: observed.noRealAssets,
      },
    };
  } catch (error) {
    return {
      state: 'blocked',
      blocker: error instanceof Error ? error.message : 'readback_unavailable',
    };
  }
}

function contractFromVerification(
  resource: { profileRef: string; profileVersion: number; resourceRef: string | null },
  verification: Record<string, any>,
  circleId: number,
): SquadsDevnetContract {
  const contract = record(verification.providerContract);
  const adoption = record(verification.continuityAdoption);
  const origin = record(adoption.origin);
  const historicalCircleId = positiveInteger(origin.circleRef);
  const continuityContract = adoption.providerTransaction === 'none'
    && origin.authority === 'provider_history_only'
    && historicalCircleId !== null
    && contract.circleId === historicalCircleId
    && contract.requestId === origin.historicalRequestRef;
  const profile = getSquadsProviderTrustProfile();
  if (
    (contract.circleId !== circleId && !continuityContract)
    || typeof contract.requestId !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(contract.decisionDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(contract.actionIntentDigest ?? ''))
    || contract.chainId !== profile.chain.chainId
    || contract.profileRef !== resource.profileRef
    || contract.profileVersion !== resource.profileVersion
    || contract.programId !== profile.deployment.programId
    || typeof resource.resourceRef !== 'string'
  ) throw new Error('squads_provider_restore_contract_readback_required');
  return contract as unknown as SquadsDevnetContract;
}

function consumedEvidence(value: unknown): {
  providerReceipt: SquadsDevnetProviderReceipt;
  accountGraph: SquadsDevnetAccountGraphReadback;
  preSignStateReadbacks: SquadsCanonicalPreSignStateReadback[];
} | null {
  const root = record(value);
  const receipt = root.providerReceipt;
  const graph = root.accountGraph;
  const preSignStateReadbacks = Array.isArray(root.preSignStateReadbacks)
    ? root.preSignStateReadbacks
    : [];
  return receipt && graph ? {
    providerReceipt: receipt as SquadsDevnetProviderReceipt,
    accountGraph: graph as SquadsDevnetAccountGraphReadback,
    preSignStateReadbacks: preSignStateReadbacks as SquadsCanonicalPreSignStateReadback[],
  } : null;
}

function providerCheckpoint(value: unknown): SquadsDevnetCheckpoint | null {
  const candidate = record(value).providerCheckpoint;
  return validSquadsDevnetCheckpoint(candidate) ? candidate : null;
}

function squadsProviderAttemptInventory(
  checkpoint: { steps: Array<Record<string, any>> } | null,
  actionIntentDigest: string,
  payerPolicyId: string,
) {
  return buildProviderTransactionAttemptInventory({
    providerModule: 'squads_provider_binding',
    actionIntentDigest,
    payerPolicyId,
    attempts: (checkpoint?.steps ?? []).map((attempt) => ({
      stepId: String(attempt.id ?? attempt.stepId ?? ''),
      messageDigest: String(attempt.messageDigest ?? ''),
      manifestDigest: String(attempt.manifestDigest ?? ''),
      recentBlockhash: String(attempt.recentBlockhash ?? attempt.blockhash ?? ''),
      lastValidBlockHeight: attempt.lastValidBlockHeight == null
        ? null
        : Number(attempt.lastValidBlockHeight),
      quoteSlot: attempt.quoteSlot == null ? null : Number(attempt.quoteSlot),
      quotedAt: attempt.quotedAt == null ? null : String(attempt.quotedAt),
      feeLamports: Number(attempt.feeLamports),
      signature: attempt.signature == null ? null : String(attempt.signature),
      status: String(attempt.status),
    })),
  });
}

function assertEvidencePolicy(payload: Record<string, any>, code: string): void {
  const policy = payload.evidencePolicy;
  if (!isCurrentGovernanceCaseFrozenEvidencePolicy(policy) || policy.packages.length !== 0) {
    throw new Error(code);
  }
}

function assertPayloadDigest(
  domain: string,
  supplied: Record<string, unknown>,
  expected: Record<string, unknown>,
  code: string,
): void {
  if (hashCanonicalGovernanceValue(domain, supplied) !== hashCanonicalGovernanceValue(domain, expected)) {
    throw new Error(code);
  }
}

function stableId(prefix: string, requestId: string): string {
  return `${prefix}:${createHash('sha256').update(requestId).digest('hex').slice(0, 48)}`;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

function findCircleHome(prisma: PrismaClient, circleId: number) {
  return prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(circleId),
      status: 'active',
      supersededAt: null,
    },
    select: { id: true },
  });
}
