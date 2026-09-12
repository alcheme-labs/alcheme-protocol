import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

import { BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import {
  CreateProposalArgs,
  GovernanceConfig,
  GoverningTokenConfigAccountArgs,
  GoverningTokenType,
  InstructionExecutionStatus,
  MintMaxVoteWeightSource,
  MintMaxVoteWeightSourceType,
  OptionVoteResult,
  PROGRAM_VERSION,
  ProposalState,
  ProposalTransaction,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID as GOVERNANCE_TOKEN_PROGRAM_ID,
  Vote,
  VoteThreshold,
  VoteThresholdType,
  VoteTipping,
  VoteType,
  YesNoVote,
  createInstructionData,
  getGovernance,
  getGovernanceAccount,
  getGovernanceInstructionSchema,
  getProposalDepositAddress,
  getProposal,
  getRealm,
  getRealmConfigAddress,
  getTokenOwnerRecord,
  getVoteRecord,
  tryGetRealmConfig,
  withCastVote,
  withCreateGovernance,
  withCreateRealm,
  withDepositGoverningTokens,
  withExecuteTransaction,
  withInsertTransaction,
  withSetGovernanceDelegate,
  withSignOffProposal,
} from '@solana/spl-governance';
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
} from '@solana/spl-token';
import {
  Connection,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  type RealmsProviderFinalityTransition,
  validRealmsProviderFinalityTransitions,
} from './realmsProviderFinality';
import {
  buildProviderExecutionActionContext,
  type ProviderExecutionActionContext,
} from './providerExecutionActionContext';

const moduleRequire = createRequire(__filename);
const governanceModulePath = moduleRequire.resolve('@solana/spl-governance');
const governanceBorsh = moduleRequire(moduleRequire.resolve('borsh', {
  paths: [path.dirname(governanceModulePath)],
})) as {
  serialize(schema: Map<Function, unknown>, value: unknown): Uint8Array;
};

export type RealmsDevnetRole =
  | 'bootstrap_authority'
  | 'proposer'
  | 'voter'
  | 'executor'
  | 'fee_payer';

export interface RealmsDevnetBootstrapContract {
  requestId: string;
  decisionDigest: string;
  actionIntentDigest: string;
  circleId: number;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: number;
  programId: string;
  realmName: string;
  communityMintDecimals: 0;
  proposerWeight: '1';
  voterWeight: '2';
  voteThresholdPercentage: 50;
  baseVotingTimeSeconds: 3600;
  voteTipping: 'early';
  approvedInstruction: 'system_program_zero_lamport_executor_self_transfer';
  authorities: Record<RealmsDevnetRole, {
    keyRef: string;
    publicKey: string;
  }>;
}

export interface RealmsDevnetDirectRentQuote {
  mintLamports: number;
  tokenAccountLamports: number;
}

export interface RealmsDevnetBootstrapStep {
  id:
    | 'create_community_mint'
    | 'create_realm_and_electorate'
    | 'create_governance'
    | 'create_and_sign_off_proposal'
    | 'cast_vote'
    | 'execute_no_asset_instruction';
  authoritySigners: Array<{
    role: Exclude<RealmsDevnetRole, 'fee_payer'>;
    operation:
      | 'create_community_mint'
      | 'create_realm'
      | 'create_governance'
      | 'create_proposal'
      | 'cast_vote'
      | 'execute_approved_no_asset_instruction';
  }>;
  instructions: TransactionInstruction[];
  manifestDigest: string;
}

export interface RealmsDevnetBootstrapPlan {
  schemaVersion: 1;
  programVersion: 3;
  addresses: {
    communityMint: string;
    governingTokenSource: string;
    realm: string;
    realmConfig: string;
    proposerTokenOwnerRecord: string;
    voterTokenOwnerRecord: string;
    governance: string;
    proposal: string;
    proposalTransaction: string;
    voteRecord: string;
  };
  steps: RealmsDevnetBootstrapStep[];
  planDigest: string;
}

export interface RealmsDevnetBootstrapLimits {
  singleTransactionLimitLamports: number;
  totalBootstrapLimitLamports: number;
  maximumWalletBalanceLamports: number;
}

interface RealmsProviderAttemptCheckpoint {
  id: string;
  manifestDigest: string;
  status: 'quoted' | 'signed' | 'submitted' | 'confirmed' | 'finalized';
  finalityTransitions: RealmsProviderFinalityTransition[];
  messageDigest: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  quoteSlot: number;
  quotedAt: string;
  feeLamports: number;
  directRentLamports: number;
  authorizedCeilingLamports: number;
  balanceBeforeLamports: number;
  signature?: string;
  rawTransactionBase64?: string;
  slot?: number;
  balanceAfterLamports?: number;
  actualSpendLamports?: number;
}

interface RealmsDevnetBootstrapStepCheckpoint extends RealmsProviderAttemptCheckpoint {
  id: RealmsDevnetBootstrapStep['id'];
}

interface RealmsDevnetExpiredAttemptCheckpoint {
  stepId: RealmsDevnetBootstrapStep['id'];
  manifestDigest: string;
  messageDigest: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  quoteSlot: number;
  quotedAt: string;
  feeLamports: number;
  directRentLamports: number;
  authorizedCeilingLamports: number;
  balanceBeforeLamports: number;
  signature: string;
  finalityTransitions: RealmsProviderFinalityTransition[];
  expiredAtBlockHeight: number;
  disposition: 'authoritative_expiry_same_intent_manual_retry';
}

export interface RealmsDevnetBootstrapCheckpoint {
  schemaVersion: 1;
  planDigest: string;
  funding: {
    targetBalanceLamports: number;
    status: 'not_required' | 'submitted' | 'finalized';
    signature?: string;
    balanceLamports: number;
  };
  steps: RealmsDevnetBootstrapStepCheckpoint[];
  expiredAttempts?: RealmsDevnetExpiredAttemptCheckpoint[];
}

export interface RealmsProviderExecutionExpiryEvidence {
  schemaVersion: 1;
  kind: 'realms_provider_execution_expiry';
  state: 'execution_expired';
  authority: 'solana_rpc_finalized_block_height_and_missing_signature_status';
  commitment: 'finalized';
  planDigest: string;
  stepId: string;
  manifestDigest: string;
  messageDigest: string;
  signature: string;
  lastValidBlockHeight: number;
  observedBlockHeight: number;
  signatureStatus: 'not_found';
  providerEffect: 'not_observed';
  retryBoundary: 'same_intent_manual_retry_only';
}

export class RealmsProviderExecutionExpiredError extends Error {
  readonly evidence: RealmsProviderExecutionExpiryEvidence;

  constructor(evidence: RealmsProviderExecutionExpiryEvidence) {
    super('realms_provider_blockhash_expired');
    this.name = 'RealmsProviderExecutionExpiredError';
    this.evidence = evidence;
  }
}

export interface RealmsDevnetBootstrapProviderReceipt {
  schemaVersion: 1;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: number;
  plan: Omit<RealmsDevnetBootstrapPlan, 'steps'> & {
    steps: Array<Omit<RealmsDevnetBootstrapStep, 'instructions'>>;
  };
  fundingSignature: string | null;
  transactions: Array<{
    stepId: RealmsDevnetBootstrapStep['id'];
    signature: string;
    slot: number;
    blockhash: string;
    messageDigest: string;
    manifestDigest: string;
    lastValidBlockHeight: number;
    actionContext: ProviderExecutionActionContext<RealmsDevnetBootstrapStep['id']>;
    feeLamports: number;
    directRentLamports: number;
    actualSpendLamports: number;
    finalityTransitions: RealmsProviderFinalityTransition[];
  }>;
  finalBalanceLamports: number;
  totalSpendLamports: number;
  providerFinality: 'finalized';
}

export interface RealmsDevnetDelegationContract {
  requestId: string;
  decisionDigest: string;
  actionIntentDigest: string;
  circleId: number;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: number;
  programId: string;
  realm: string;
  governingTokenMint: string;
  voterTokenOwnerRecord: string;
  voterOwner: string;
  voterDepositAmount: string;
  delegate: string;
  voteRecord: string;
  yesVoteWeight: string;
  voter: { keyRef: string; publicKey: string };
  feePayer: { keyRef: string; publicKey: string };
}

export interface RealmsDevnetDelegationStateReadback {
  schemaVersion: 1;
  authority: 'independent_provider_readback';
  commitment: 'finalized';
  observedSlot: number;
  tokenOwnerRecord: string;
  voterOwner: string;
  depositAmount: string;
  governanceDelegate: string | null;
  voteRecord: string;
  voteRecordVoter: string;
  yesVoteWeight: string;
  stateDigest: string;
}

interface RealmsDevnetDelegationStepCheckpoint extends RealmsProviderAttemptCheckpoint {
  id: 'set_governance_delegate' | 'revoke_governance_delegate';
  statePrecondition: RealmsDevnetDelegationStatePrecondition;
  readback?: RealmsDevnetDelegationStateReadback;
}

export interface RealmsDevnetDelegationStatePrecondition {
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
}

export interface RealmsDevnetDelegationCheckpoint {
  schemaVersion: 1;
  planDigest: string;
  baseline: RealmsDevnetDelegationStateReadback;
  steps: RealmsDevnetDelegationStepCheckpoint[];
}

export interface RealmsDevnetDelegationProviderReceipt {
  schemaVersion: 1;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: number;
  planDigest: string;
  baseline: RealmsDevnetDelegationStateReadback;
  setReadback: RealmsDevnetDelegationStateReadback;
  revokeReadback: RealmsDevnetDelegationStateReadback;
  transactions: Array<{
    stepId: RealmsDevnetDelegationStepCheckpoint['id'];
    signature: string;
    slot: number;
    blockhash: string;
    messageDigest: string;
    manifestDigest: string;
    lastValidBlockHeight: number;
    actionContext: ProviderExecutionActionContext<RealmsDevnetDelegationStepCheckpoint['id']>;
    feeLamports: number;
    actualSpendLamports: number;
    statePrecondition: RealmsDevnetDelegationStatePrecondition;
    finalityTransitions: RealmsProviderFinalityTransition[];
  }>;
  finalBalanceLamports: number;
  totalSpendLamports: number;
  providerFinality: 'finalized';
  historicalVoteInvariant: 'unchanged';
  finalDelegate: null;
}

export interface RealmsDevnetAccountGraphReadback {
  schemaVersion: 1;
  status: 'verified_finalized';
  observedSlot: number;
  lastTransactionSlot: number;
  slotSpan: number;
  ownerProgramRef: string;
  resourceRef: string;
  accountGraph: RealmsDevnetBootstrapPlan['addresses'];
  proposalState: 'completed';
  instructionExecutionStatus: 'success';
  proposerWeight: '1';
  voterWeight: '2';
  yesVoteWeight: '2';
  signatoryRecord: 'not_applicable_direct_governance_authority_signoff';
  voterWeightAddin: 'not_configured';
  maxVoterWeightAddin: 'not_configured';
  customPlugins: 'unavailable';
  votingPowerSecurity: RealmsVotingPowerSecurityProfile;
  noRealAssets: true;
  stateDigest: string;
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
  voteRecord: {
    recordRef: string;
    voter: string;
    yesVoteWeight: string;
  };
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

const REALMS_VOTING_POWER_SECURITY_PROFILE_DOMAIN =
  'alcheme.governance.realms-voting-power-security-profile-v1';

export function isCurrentRealmsVotingPowerSecurityProfile(
  value: unknown,
): value is RealmsVotingPowerSecurityProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const profile = value as any;
  if (
    profile.schemaVersion !== 1
    || profile.readinessState !== 'unavailable'
    || profile.mode !== 'standard_token_weight_no_addins'
    || profile.source?.authority !== 'independent_provider_readback'
    || profile.source?.chainId !== 'solana:devnet'
    || typeof profile.source?.profileRef !== 'string'
    || !profile.source.profileRef
    || !Number.isSafeInteger(profile.source?.profileVersion)
    || profile.source.profileVersion <= 0
    || typeof profile.source?.programId !== 'string'
    || typeof profile.source?.realm !== 'string'
    || typeof profile.source?.governingTokenMint !== 'string'
    || profile.source?.commitment !== 'finalized'
    || !Number.isSafeInteger(profile.source?.snapshotSlot)
    || profile.source.snapshotSlot <= 0
    || !Array.isArray(profile.tokenOwnerRecords)
    || profile.tokenOwnerRecords.length !== 2
    || profile.tokenOwnerRecords.some((record: any) => (
      !['proposer', 'voter'].includes(record?.role)
      || typeof record?.recordRef !== 'string'
      || !record.recordRef
      || typeof record?.owner !== 'string'
      || !record.owner
      || !/^\d+$/.test(String(record?.depositAmount ?? ''))
      || record?.governanceDelegate !== null
      || !Number.isSafeInteger(record?.unrelinquishedVotesCount)
      || record.unrelinquishedVotesCount < 0
      || !Number.isSafeInteger(record?.outstandingProposalCount)
      || record.outstandingProposalCount < 0
    ))
    || new Set(profile.tokenOwnerRecords.map((record: any) => record.role)).size !== 2
    || new Set(profile.tokenOwnerRecords.map((record: any) => record.recordRef)).size !== 2
    || typeof profile.voteRecord?.recordRef !== 'string'
    || typeof profile.voteRecord?.voter !== 'string'
    || !/^\d+$/.test(String(profile.voteRecord?.yesVoteWeight ?? ''))
    || profile.sameResourceRoot?.schemaVersion !== 1
    || typeof profile.sameResourceRoot?.rootRef !== 'string'
    || !profile.sameResourceRoot.rootRef
    || !/^[a-f0-9]{64}$/.test(String(profile.sameResourceRoot?.rootDigest ?? ''))
    || !Array.isArray(profile.sameResourceRoot?.paths)
    || profile.sameResourceRoot.paths.length !== 7
    || profile.sameResourceRoot.paths.some((path: any) => (
      ![
        'realm_config',
        'governing_token_mint',
        'token_owner_record',
        'vote_record',
        'voter_weight_addin',
        'max_voter_weight_addin',
      ].includes(path?.kind)
      || !['observed', 'not_configured'].includes(path?.status)
      || (path?.status === 'observed' && (typeof path?.ref !== 'string' || !path.ref))
      || (path?.status === 'not_configured' && path?.ref !== null)
    ))
    || profile.sameResourceRoot.paths.filter((path: any) => path?.kind === 'token_owner_record').length !== 2
    || profile.sameResourceRoot.paths.filter((path: any) => path?.kind === 'realm_config').length !== 1
    || profile.sameResourceRoot.paths.filter((path: any) => path?.kind === 'governing_token_mint').length !== 1
    || profile.sameResourceRoot.paths.filter((path: any) => path?.kind === 'vote_record').length !== 1
    || profile.sameResourceRoot.paths.filter((path: any) => path?.kind === 'voter_weight_addin').length !== 1
    || profile.sameResourceRoot.paths.filter((path: any) => path?.kind === 'max_voter_weight_addin').length !== 1
    || profile.sameResourceRoot.duplicatePathCount !== 0
    || profile.sameResourceRoot.cycleDetected !== false
    || profile.sameResourceRoot.recordExpiry !== 'not_applicable_no_vwr'
    || !Array.isArray(profile.delegationGraph?.edges)
    || profile.delegationGraph.edges.length !== 0
    || !/^[a-f0-9]{64}$/.test(String(profile.delegationGraph?.graphDigest ?? ''))
    || profile.delegationGraph?.duplicateResourceCount !== 0
    || profile.delegationGraph?.cycleDetected !== false
    || profile.delegationGraph?.maxDepthObserved !== 0
    || profile.delegationGraph?.mapping !== 'exact_no_delegate'
    || profile.protections?.depositLock !== 'standard_token_owner_record_vote_lifecycle_only'
    || profile.protections?.snapshotDelay !== 'not_configured'
    || profile.protections?.cooldown !== 'not_configured'
    || profile.protections?.recordExpiry !== 'not_applicable_no_vwr'
    || profile.protections?.borrowedCapitalRisk !== 'unmitigated'
    || profile.protections?.flashGovernanceRisk !== 'unmitigated'
    || profile.plugins?.voterWeightAddin !== 'not_configured'
    || profile.plugins?.maxVoterWeightAddin !== 'not_configured'
    || profile.plugins?.vsr !== 'not_configured'
    || profile.plugins?.customPlugins !== 'unavailable'
    || profile.enforcement?.deposit !== 'spl_governance_token_owner_record'
    || profile.enforcement?.duplicateVote !== 'spl_governance_vote_record'
    || profile.enforcement?.weightedTemplateActivation !== 'blocked'
    || JSON.stringify(profile.blockerCodes) !== JSON.stringify([
      'voting_power_snapshot_delay_not_configured',
      'voting_power_deposit_cooldown_not_configured',
      'voting_power_borrowed_capital_risk_unmitigated',
      'voting_power_vsr_vwr_not_configured',
    ])
    || !/^[a-f0-9]{64}$/.test(String(profile.profileDigest ?? ''))
  ) return false;
  const observedRootRefs = profile.sameResourceRoot.paths
    .filter((path: any) => path.status === 'observed')
    .map((path: any) => path.ref);
  if (
    new Set(observedRootRefs).size !== observedRootRefs.length
    || observedRootRefs.includes(profile.sameResourceRoot.rootRef)
  ) return false;
  const { profileDigest, ...facts } = profile;
  const { rootDigest, ...rootFacts } = profile.sameResourceRoot;
  return hashCanonicalGovernanceValue(
    REALMS_VOTING_POWER_SECURITY_PROFILE_DOMAIN,
    facts,
  ) === profileDigest
    && hashCanonicalGovernanceValue(
      'alcheme.governance.realms-voting-power-same-resource-root-v1',
      rootFacts,
    ) === rootDigest;
}

interface RealmsDevnetProviderConnection {
  getMinimumBalanceForRentExemption(size: number, commitment?: 'finalized'): Promise<number>;
  getBalance(publicKey: PublicKey, commitment?: 'finalized'): Promise<number>;
  requestAirdrop(publicKey: PublicKey, lamports: number): Promise<string>;
  getLatestBlockhash(commitment?: 'finalized'): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
  getSlot(commitment?: 'finalized'): Promise<number>;
  getBlockHeight(commitment?: 'finalized'): Promise<number>;
  getFeeForMessage(message: ReturnType<Transaction['compileMessage']>, commitment?: 'finalized'):
    Promise<{ value: number | null }>;
  simulateTransaction(
    transaction: Transaction,
    signers: undefined,
    includeAccounts: PublicKey[],
  ): Promise<{
    value: {
      err: unknown | null;
      accounts?: Array<{ lamports: number } | null> | null;
    };
  }>;
  sendRawTransaction(rawTransaction: Buffer, options: {
    skipPreflight: false;
    preflightCommitment: 'finalized';
    maxRetries: 0;
  }): Promise<string>;
  confirmTransaction(strategy: string | {
      signature: string;
      blockhash: string;
      lastValidBlockHeight: number;
    }, commitment?: 'finalized'): Promise<{ value: { err: unknown | null } }>;
  getSignatureStatuses(signatures: string[], config: { searchTransactionHistory: true }): Promise<{
    value: Array<{
      confirmationStatus?: 'processed' | 'confirmed' | 'finalized' | null;
      err: unknown | null;
    } | null>;
  }>;
  getTransaction(signature: string, config: {
    commitment: 'finalized';
    maxSupportedTransactionVersion: 0;
  }): Promise<{ slot: number; meta: { err: unknown | null } | null } | null>;
}

async function submitRealmsProviderTransaction(
  connection: Pick<RealmsDevnetProviderConnection, 'sendRawTransaction'>,
  rawTransaction: Buffer,
): Promise<string> {
  try {
    return await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: 'finalized',
      maxRetries: 0,
    });
  } catch (error) {
    if (error instanceof SendTransactionError) {
      throw new Error('realms_provider_submission_rejected');
    }
    throw error;
  } finally {
    rawTransaction.fill(0);
  }
}

export interface RealmsDevnetBootstrapProviderDependencies {
  connection: RealmsDevnetProviderConnection;
  verifyTrustProfile(): Promise<{
    chainId: 'solana:devnet';
    profileRef: string;
    profileVersion: number;
    programId: string;
    commitment: 'finalized';
  }>;
  sign(input: {
    role: RealmsDevnetRole;
    operation: string;
    message: Uint8Array;
  }): Promise<{ publicKey: string; signature: Uint8Array }>;
  checkpoint(value: RealmsDevnetBootstrapCheckpoint): Promise<void>;
  waitForReadback?(milliseconds: number): Promise<void>;
  allowExpiredAttemptRebuild?: boolean;
}

interface RealmsDevnetDelegationProviderDependencies {
  connection: RealmsDevnetProviderConnection;
  verifyTrustProfile: RealmsDevnetBootstrapProviderDependencies['verifyTrustProfile'];
  sign: RealmsDevnetBootstrapProviderDependencies['sign'];
  readDelegationState(expectedDelegate: string | null): Promise<RealmsDevnetDelegationStateReadback>;
  readCanonicalOwnerState(input: {
    stepId: 'set_governance_delegate' | 'revoke_governance_delegate';
    expectedDelegate: string | null;
  }): Promise<RealmsDevnetDelegationStatePrecondition['canonicalOwnerState']>;
  checkpoint(value: RealmsDevnetDelegationCheckpoint): Promise<void>;
  waitForReadback?(milliseconds: number): Promise<void>;
}

const U64_MAX = new BN('18446744073709551615');

export async function buildRealmsDevnetBootstrapPlan(
  contract: RealmsDevnetBootstrapContract,
  rent: RealmsDevnetDirectRentQuote,
): Promise<RealmsDevnetBootstrapPlan> {
  assertBootstrapContract(contract, rent);
  if (PROGRAM_VERSION !== 3) {
    throw new Error('realms_provider_client_program_version_mismatch');
  }
  if (!TOKEN_PROGRAM_ID.equals(GOVERNANCE_TOKEN_PROGRAM_ID)) {
    throw new Error('realms_provider_token_program_mismatch');
  }

  const programId = new PublicKey(contract.programId);
  const bootstrapAuthority = publicKey(contract.authorities.bootstrap_authority.publicKey);
  const proposer = publicKey(contract.authorities.proposer.publicKey);
  const voter = publicKey(contract.authorities.voter.publicKey);
  const executor = publicKey(contract.authorities.executor.publicKey);
  const feePayer = publicKey(contract.authorities.fee_payer.publicKey);
  const seedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-devnet-bootstrap-seeds',
    {
      requestId: contract.requestId,
      decisionDigest: contract.decisionDigest,
      actionIntentDigest: contract.actionIntentDigest,
      chainId: contract.chainId,
      profileRef: contract.profileRef,
      profileVersion: contract.profileVersion,
    },
  );
  const mintSeed = `alch-mint-${seedDigest.slice(0, 20)}`;
  const tokenSourceSeed = `alch-src-${seedDigest.slice(0, 21)}`;
  const communityMint = await PublicKey.createWithSeed(
    bootstrapAuthority,
    mintSeed,
    TOKEN_PROGRAM_ID,
  );
  const governingTokenSource = await PublicKey.createWithSeed(
    bootstrapAuthority,
    tokenSourceSeed,
    TOKEN_PROGRAM_ID,
  );

  const createCommunityMintInstructions = [
    SystemProgram.createAccountWithSeed({
      fromPubkey: feePayer,
      newAccountPubkey: communityMint,
      basePubkey: bootstrapAuthority,
      seed: mintSeed,
      lamports: rent.mintLamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      communityMint,
      contract.communityMintDecimals,
      bootstrapAuthority,
      null,
      TOKEN_PROGRAM_ID,
    ),
    SystemProgram.createAccountWithSeed({
      fromPubkey: feePayer,
      newAccountPubkey: governingTokenSource,
      basePubkey: bootstrapAuthority,
      seed: tokenSourceSeed,
      lamports: rent.tokenAccountLamports,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      governingTokenSource,
      communityMint,
      bootstrapAuthority,
      TOKEN_PROGRAM_ID,
    ),
    createMintToInstruction(
      communityMint,
      governingTokenSource,
      bootstrapAuthority,
      3,
      [],
      TOKEN_PROGRAM_ID,
    ),
  ];

  const standardTokenConfig = new GoverningTokenConfigAccountArgs({
    voterWeightAddin: undefined,
    maxVoterWeightAddin: undefined,
    tokenType: GoverningTokenType.Liquid,
  });
  const createRealmInstructions: TransactionInstruction[] = [];
  const realm = await withCreateRealm(
    createRealmInstructions,
    programId,
    PROGRAM_VERSION,
    contract.realmName,
    bootstrapAuthority,
    communityMint,
    feePayer,
    undefined,
    new MintMaxVoteWeightSource({
      type: MintMaxVoteWeightSourceType.Absolute,
      value: new BN(contract.proposerWeight).add(new BN(contract.voterWeight)),
    }),
    new BN(1),
    standardTokenConfig,
    undefined,
  );
  const proposerTokenOwnerRecord = await withDepositGoverningTokens(
    createRealmInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    communityMint,
    communityMint,
    proposer,
    bootstrapAuthority,
    feePayer,
    new BN(contract.proposerWeight),
    true,
  );
  const voterTokenOwnerRecord = await withDepositGoverningTokens(
    createRealmInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    communityMint,
    communityMint,
    voter,
    bootstrapAuthority,
    feePayer,
    new BN(contract.voterWeight),
    true,
  );

  const governanceConfig = new GovernanceConfig({
    communityVoteThreshold: new VoteThreshold({
      type: VoteThresholdType.YesVotePercentage,
      value: contract.voteThresholdPercentage,
    }),
    minCommunityTokensToCreateProposal: new BN(1),
    minInstructionHoldUpTime: 0,
    baseVotingTime: contract.baseVotingTimeSeconds,
    communityVoteTipping: VoteTipping.Early,
    minCouncilTokensToCreateProposal: U64_MAX,
    councilVoteThreshold: new VoteThreshold({ type: VoteThresholdType.Disabled }),
    councilVetoVoteThreshold: new VoteThreshold({ type: VoteThresholdType.Disabled }),
    communityVetoVoteThreshold: new VoteThreshold({ type: VoteThresholdType.Disabled }),
    councilVoteTipping: VoteTipping.Disabled,
    votingCoolOffTime: 0,
    depositExemptProposalCount: 10,
  });
  const createGovernanceInstructions: TransactionInstruction[] = [];
  const governance = await withCreateGovernance(
    createGovernanceInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    executor,
    governanceConfig,
    proposerTokenOwnerRecord,
    feePayer,
    bootstrapAuthority,
  );

  const proposalSeed = new PublicKey(Buffer.from(seedDigest, 'hex'));
  const createProposalInstructions: TransactionInstruction[] = [];
  const proposal = await withCreateDeterministicProposal(
    createProposalInstructions,
    {
      programId,
      realm,
      governance,
      tokenOwnerRecord: proposerTokenOwnerRecord,
      governingTokenMint: communityMint,
      governanceAuthority: proposer,
      payer: feePayer,
      proposalSeed,
      name: `Alcheme Circle ${contract.circleId} no-asset execution`,
      descriptionLink: `alcheme://governance/requests/${contract.requestId}`,
    },
  );
  const noAssetInstruction = SystemProgram.transfer({
    fromPubkey: executor,
    toPubkey: executor,
    lamports: 0,
  });
  const proposalTransaction = await withInsertTransaction(
    createProposalInstructions,
    programId,
    PROGRAM_VERSION,
    governance,
    proposal,
    proposerTokenOwnerRecord,
    proposer,
    0,
    0,
    0,
    [createInstructionData(noAssetInstruction)],
    feePayer,
  );
  withSignOffProposal(
    createProposalInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    governance,
    proposal,
    proposer,
    undefined,
    proposerTokenOwnerRecord,
  );

  const castVoteInstructions: TransactionInstruction[] = [];
  const voteRecord = await withCastVote(
    castVoteInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    governance,
    proposal,
    proposerTokenOwnerRecord,
    voterTokenOwnerRecord,
    voter,
    communityMint,
    Vote.fromYesNoVote(YesNoVote.Yes),
    feePayer,
  );
  const executeInstructions: TransactionInstruction[] = [];
  await withExecuteTransaction(
    executeInstructions,
    programId,
    PROGRAM_VERSION,
    governance,
    proposal,
    proposalTransaction,
    [createInstructionData(noAssetInstruction)],
  );

  const steps: RealmsDevnetBootstrapStep[] = [
    step('create_community_mint', [
      { role: 'bootstrap_authority', operation: 'create_community_mint' },
    ], createCommunityMintInstructions),
    step('create_realm_and_electorate', [
      { role: 'bootstrap_authority', operation: 'create_realm' },
      { role: 'proposer', operation: 'create_proposal' },
      { role: 'voter', operation: 'cast_vote' },
    ], createRealmInstructions),
    step('create_governance', [
      { role: 'bootstrap_authority', operation: 'create_governance' },
    ], createGovernanceInstructions),
    step('create_and_sign_off_proposal', [
      { role: 'proposer', operation: 'create_proposal' },
    ], createProposalInstructions),
    step('cast_vote', [
      { role: 'voter', operation: 'cast_vote' },
    ], castVoteInstructions),
    step(
      'execute_no_asset_instruction',
      [{ role: 'executor', operation: 'execute_approved_no_asset_instruction' }],
      executeInstructions,
    ),
  ];
  for (const item of steps) {
    assertStepSignerContract(item, contract.authorities, feePayer);
  }
  const addresses = {
    communityMint: communityMint.toBase58(),
    governingTokenSource: governingTokenSource.toBase58(),
    realm: realm.toBase58(),
    realmConfig: (await getRealmConfigAddress(programId, realm)).toBase58(),
    proposerTokenOwnerRecord: proposerTokenOwnerRecord.toBase58(),
    voterTokenOwnerRecord: voterTokenOwnerRecord.toBase58(),
    governance: governance.toBase58(),
    proposal: proposal.toBase58(),
    proposalTransaction: proposalTransaction.toBase58(),
    voteRecord: voteRecord.toBase58(),
  };
  const planDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-devnet-bootstrap-plan',
    {
      programVersion: PROGRAM_VERSION,
      addresses,
      steps: steps.map((item) => ({
        id: item.id,
        authoritySigners: item.authoritySigners,
        manifestDigest: item.manifestDigest,
      })),
    },
  );
  return {
    schemaVersion: 1,
    programVersion: PROGRAM_VERSION,
    addresses,
    steps,
    planDigest,
  };
}

export async function executeRealmsDevnetBootstrap(
  contract: RealmsDevnetBootstrapContract,
  limits: RealmsDevnetBootstrapLimits,
  dependencies: RealmsDevnetBootstrapProviderDependencies,
  resume?: RealmsDevnetBootstrapCheckpoint | null,
): Promise<RealmsDevnetBootstrapProviderReceipt> {
  assertLimits(limits);
  const trust = await dependencies.verifyTrustProfile();
  if (
    trust.chainId !== contract.chainId
    || trust.profileRef !== contract.profileRef
    || trust.profileVersion !== contract.profileVersion
    || trust.programId !== new PublicKey(contract.programId).toBase58()
    || trust.commitment !== 'finalized'
  ) {
    throw new Error('realms_provider_trust_profile_execution_mismatch');
  }
  const connection = dependencies.connection;
  const rent = {
    mintLamports: await connection.getMinimumBalanceForRentExemption(MINT_SIZE, 'finalized'),
    tokenAccountLamports: await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, 'finalized'),
  };
  const plan = await buildRealmsDevnetBootstrapPlan(contract, rent);
  const feePayer = new PublicKey(contract.authorities.fee_payer.publicKey);
  const checkpoint = normalizeCheckpoint(resume, plan.planDigest, limits);
  // The total bootstrap limit is an authorization ceiling, not a funding target.
  // Keeping only one transaction limit in the Devnet payer limits the faucet
  // request and still leaves every later step subject to the cumulative cap.
  const fundingTargetLamports = Math.min(
    limits.singleTransactionLimitLamports,
    limits.totalBootstrapLimitLamports,
  );

  let balance = await connection.getBalance(feePayer, 'finalized');
  if (balance > limits.maximumWalletBalanceLamports) {
    throw new Error('realms_provider_fee_payer_balance_cap_exceeded');
  }
  if (checkpoint.funding.status === 'submitted') {
    if (balance < checkpoint.funding.targetBalanceLamports) {
      throw new Error('realms_provider_faucet_readback_ambiguous');
    }
    checkpoint.funding = {
      ...checkpoint.funding,
      status: 'finalized',
      balanceLamports: balance,
    };
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
  }
  if (balance < fundingTargetLamports) {
    const amount = fundingTargetLamports - balance;
    if (balance + amount > limits.maximumWalletBalanceLamports) {
      throw new Error('realms_provider_faucet_cap_exceeded');
    }
    const signature = await connection.requestAirdrop(feePayer, amount);
    checkpoint.funding = {
      targetBalanceLamports: fundingTargetLamports,
      status: 'submitted',
      signature,
      balanceLamports: balance,
    };
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
    const confirmation = await connection.confirmTransaction(signature, 'finalized');
    if (confirmation.value.err) {
      throw new Error('realms_provider_faucet_transaction_failed');
    }
    balance = await connection.getBalance(feePayer, 'finalized');
    if (
      balance < fundingTargetLamports
      || balance > limits.maximumWalletBalanceLamports
    ) {
      throw new Error('realms_provider_faucet_balance_readback_invalid');
    }
    checkpoint.funding = {
      ...checkpoint.funding,
      status: 'finalized',
      balanceLamports: balance,
    };
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
  } else if (checkpoint.funding.status === 'not_required') {
    checkpoint.funding = {
      targetBalanceLamports: balance,
      status: 'not_required',
      balanceLamports: balance,
    };
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
  }

  let totalSpendLamports = checkpoint.steps
    .filter((item) => item.status === 'finalized')
    .reduce((total, item) => total + (item.actualSpendLamports ?? 0), 0);
  for (const providerStep of plan.steps) {
    let existing = checkpoint.steps.find((candidate) => candidate.id === providerStep.id);
    if (existing && existing.manifestDigest !== providerStep.manifestDigest) {
      throw new Error('realms_provider_attempt_manifest_conflict');
    }
    if (existing?.status === 'finalized') continue;
    if (existing && (
      existing.status === 'signed'
      || existing.status === 'submitted'
      || existing.status === 'confirmed'
    )) {
      try {
        const finalized = await readFinalizedAttempt(
          connection,
          existing,
          checkpoint.planDigest,
          feePayer,
          dependencies.waitForReadback,
          async (transition) => {
            const changed = appendFinalityTransition(existing!, transition);
            if (transition.state === 'confirmed' && existing!.status !== 'confirmed') {
              existing!.status = 'confirmed';
              await dependencies.checkpoint(cloneCheckpoint(checkpoint));
            } else if (changed && transition.state === 'confirmed') {
              await dependencies.checkpoint(cloneCheckpoint(checkpoint));
            }
          },
        );
        existing.status = 'finalized';
        existing.slot = finalized.slot;
        existing.balanceAfterLamports = finalized.balanceAfterLamports;
        existing.actualSpendLamports = existing.balanceBeforeLamports - finalized.balanceAfterLamports;
        delete existing.rawTransactionBase64;
        assertActualSpend(existing.actualSpendLamports, limits, totalSpendLamports);
        totalSpendLamports += existing.actualSpendLamports;
        await dependencies.checkpoint(cloneCheckpoint(checkpoint));
        continue;
      } catch (error) {
        if (
          !dependencies.allowExpiredAttemptRebuild
          || !(error instanceof Error)
          || error.message !== 'realms_provider_blockhash_expired'
        ) throw error;
        const expiredAtBlockHeight = await connection.getBlockHeight('finalized');
        if (
          !Number.isSafeInteger(expiredAtBlockHeight)
          || expiredAtBlockHeight <= existing.lastValidBlockHeight
        ) throw new Error('realms_provider_blockhash_expiry_readback_conflict');
        const expiredAttempts = checkpoint.expiredAttempts ?? [];
        if (
          expiredAttempts.length >= 24
          || expiredAttempts.some((attempt) => attempt.messageDigest === existing!.messageDigest)
          || !existing.signature
        ) throw new Error('realms_provider_expired_attempt_history_conflict');
        expiredAttempts.push({
          stepId: existing.id,
          manifestDigest: existing.manifestDigest,
          messageDigest: existing.messageDigest,
          recentBlockhash: existing.recentBlockhash,
          lastValidBlockHeight: existing.lastValidBlockHeight,
          quoteSlot: existing.quoteSlot,
          quotedAt: existing.quotedAt,
          feeLamports: existing.feeLamports,
          directRentLamports: existing.directRentLamports,
          authorizedCeilingLamports: existing.authorizedCeilingLamports,
          balanceBeforeLamports: existing.balanceBeforeLamports,
          signature: existing.signature,
          finalityTransitions: existing.finalityTransitions,
          expiredAtBlockHeight,
          disposition: 'authoritative_expiry_same_intent_manual_retry',
        });
        checkpoint.expiredAttempts = expiredAttempts;
        checkpoint.steps = checkpoint.steps.filter((candidate) => candidate !== existing);
        await dependencies.checkpoint(cloneCheckpoint(checkpoint));
        existing = undefined;
      }
    }

    const balanceBeforeLamports = await connection.getBalance(feePayer, 'finalized');
    const [latest, quoteSlot] = await Promise.all([
      connection.getLatestBlockhash('finalized'),
      connection.getSlot('finalized'),
    ]);
    const quotedAt = new Date().toISOString();
    const transaction = new Transaction({
      feePayer,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(...providerStep.instructions);
    const message = transaction.compileMessage();
    const feeQuote = await connection.getFeeForMessage(message, 'finalized');
    if (!Number.isSafeInteger(feeQuote.value) || feeQuote.value === null || feeQuote.value < 0) {
      throw new Error('realms_provider_fee_quote_invalid');
    }
    const simulation = await connection.simulateTransaction(transaction, undefined, [feePayer]);
    const simulatedPayer = simulation.value.accounts?.[0];
    if (simulation.value.err || !simulatedPayer || !Number.isSafeInteger(simulatedPayer.lamports)) {
      throw new Error('realms_provider_preflight_simulation_failed');
    }
    const simulatedSpendLamports = balanceBeforeLamports - simulatedPayer.lamports;
    if (
      simulatedSpendLamports < feeQuote.value
      || simulatedSpendLamports > limits.singleTransactionLimitLamports
      || totalSpendLamports + simulatedSpendLamports > limits.totalBootstrapLimitLamports
    ) {
      throw new Error('realms_provider_preflight_cost_cap_exceeded');
    }
    const directRentLamports = providerStep.id === 'create_community_mint'
      ? rent.mintLamports + rent.tokenAccountLamports
      : 0;
    const messageBytes = transaction.serializeMessage();
    const messageDigest = createHash('sha256').update(messageBytes).digest('hex');
    existing = {
      id: providerStep.id,
      manifestDigest: providerStep.manifestDigest,
      status: 'quoted',
      finalityTransitions: [],
      messageDigest,
      recentBlockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      quoteSlot,
      quotedAt,
      feeLamports: feeQuote.value,
      directRentLamports,
      authorizedCeilingLamports: simulatedSpendLamports,
      balanceBeforeLamports,
    };
    checkpoint.steps.push(existing);
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));

    const requestedSignatures = [
      {
        role: 'fee_payer' as const,
        operation: 'pay_approved_devnet_fee_and_rent',
      },
      ...providerStep.authoritySigners,
    ];
    const signatures = await Promise.all(requestedSignatures.map(async (signer) => ({
      signer,
      readback: await dependencies.sign({
        role: signer.role,
        operation: signer.operation,
        message: messageBytes,
      }),
    })));
    for (const { signer, readback } of signatures) {
      const expected = contract.authorities[signer.role].publicKey;
      assertProviderSignature(readback, expected);
      transaction.addSignature(new PublicKey(expected), Buffer.from(readback.signature));
    }
    if (!transaction.verifySignatures()) {
      throw new Error('realms_provider_transaction_signature_verification_failed');
    }
    const rawTransaction = transaction.serialize();
    const payerSignature = signatures[0].readback;
    const signature = bs58.encode(payerSignature.signature);
    existing.status = 'signed';
    existing.signature = signature;
    existing.rawTransactionBase64 = rawTransaction.toString('base64');
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));

    const submittedSignature = await submitRealmsProviderTransaction(
      connection,
      rawTransaction,
    );
    if (submittedSignature !== signature) {
      throw new Error('realms_provider_transaction_signature_readback_mismatch');
    }
    existing.status = 'submitted';
    appendFinalityTransition(existing, {
      state: 'submitted',
      authority: 'provider_signature_readback',
    });
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
    const finalized = await readFinalizedAttempt(
      connection,
      existing,
      checkpoint.planDigest,
      feePayer,
      dependencies.waitForReadback,
      async (transition) => {
        const changed = appendFinalityTransition(existing!, transition);
        if (transition.state === 'confirmed' && existing!.status !== 'confirmed') {
          existing!.status = 'confirmed';
          await dependencies.checkpoint(cloneCheckpoint(checkpoint));
        } else if (changed && transition.state === 'confirmed') {
          await dependencies.checkpoint(cloneCheckpoint(checkpoint));
        }
      },
    );
    existing.status = 'finalized';
    existing.slot = finalized.slot;
    existing.balanceAfterLamports = finalized.balanceAfterLamports;
    existing.actualSpendLamports = balanceBeforeLamports - finalized.balanceAfterLamports;
    delete existing.rawTransactionBase64;
    assertActualSpend(existing.actualSpendLamports, limits, totalSpendLamports);
    totalSpendLamports += existing.actualSpendLamports;
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
  }

  const finalizedSteps = checkpoint.steps.filter((item) => item.status === 'finalized');
  if (finalizedSteps.length !== plan.steps.length) {
    throw new Error('realms_provider_finalized_step_inventory_mismatch');
  }
  const finalBalanceLamports = await connection.getBalance(feePayer, 'finalized');
  if (finalBalanceLamports > limits.maximumWalletBalanceLamports) {
    throw new Error('realms_provider_fee_payer_balance_cap_exceeded');
  }
  const expectedStateChanges: Record<RealmsDevnetBootstrapStep['id'], string> = {
    create_community_mint: 'community_governance_weight_mint_and_source_created',
    create_realm_and_electorate: 'realm_and_frozen_electorate_deposits_created',
    create_governance: 'governance_account_created_with_frozen_config',
    create_and_sign_off_proposal: 'proposal_instruction_inserted_and_signed_off',
    cast_vote: 'frozen_approve_vote_recorded',
    execute_no_asset_instruction: 'approved_zero_lamport_instruction_executed',
  };
  return {
    schemaVersion: 1,
    chainId: contract.chainId,
    profileRef: contract.profileRef,
    profileVersion: contract.profileVersion,
    plan: {
      schemaVersion: plan.schemaVersion,
      programVersion: plan.programVersion,
      addresses: plan.addresses,
      steps: plan.steps.map(({ instructions: _instructions, ...providerStep }) => providerStep),
      planDigest: plan.planDigest,
    },
    fundingSignature: checkpoint.funding.signature ?? null,
    transactions: finalizedSteps.map((item) => ({
      stepId: item.id,
      signature: item.signature!,
      slot: item.slot!,
      blockhash: item.recentBlockhash,
      messageDigest: item.messageDigest,
      manifestDigest: item.manifestDigest,
      lastValidBlockHeight: item.lastValidBlockHeight,
      actionContext: buildProviderExecutionActionContext({
        actionIntentDigest: contract.actionIntentDigest,
        planDigest: plan.planDigest,
        steps: plan.steps,
        step: item,
        expectedStateChange: expectedStateChanges[item.id],
      }),
      feeLamports: item.feeLamports,
      directRentLamports: item.directRentLamports,
      actualSpendLamports: item.actualSpendLamports!,
      finalityTransitions: item.finalityTransitions,
    })),
    finalBalanceLamports,
    totalSpendLamports,
    providerFinality: 'finalized',
  };
}

export async function executeRealmsDevnetDelegationConformance(
  contract: RealmsDevnetDelegationContract,
  limits: RealmsDevnetBootstrapLimits,
  dependencies: RealmsDevnetDelegationProviderDependencies,
  resume?: RealmsDevnetDelegationCheckpoint | null,
): Promise<RealmsDevnetDelegationProviderReceipt> {
  assertDelegationContract(contract);
  assertLimits(limits);
  const trust = await dependencies.verifyTrustProfile();
  if (
    trust.chainId !== contract.chainId
    || trust.profileRef !== contract.profileRef
    || trust.profileVersion !== contract.profileVersion
    || trust.programId !== new PublicKey(contract.programId).toBase58()
    || trust.commitment !== 'finalized'
  ) {
    throw new Error('realms_provider_delegation_trust_profile_mismatch');
  }

  const programId = publicKey(contract.programId);
  const realm = publicKey(contract.realm);
  const governingTokenMint = publicKey(contract.governingTokenMint);
  const voterOwner = publicKey(contract.voterOwner);
  const voterAuthority = publicKey(contract.voter.publicKey);
  const delegate = publicKey(contract.delegate);
  const feePayer = publicKey(contract.feePayer.publicKey);
  if (!voterOwner.equals(voterAuthority) || voterAuthority.equals(delegate) || feePayer.equals(voterAuthority)) {
    throw new Error('realms_provider_delegation_authority_separation_required');
  }

  const setInstructions: TransactionInstruction[] = [];
  await withSetGovernanceDelegate(
    setInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    governingTokenMint,
    voterOwner,
    voterAuthority,
    delegate,
  );
  const revokeInstructions: TransactionInstruction[] = [];
  await withSetGovernanceDelegate(
    revokeInstructions,
    programId,
    PROGRAM_VERSION,
    realm,
    governingTokenMint,
    voterOwner,
    voterAuthority,
    // The installed SPL Governance client declares `undefined` for None, while
    // its borsh option encoder only emits None for `null` at runtime.
    null as unknown as undefined,
  );
  const steps = [
    {
      id: 'set_governance_delegate' as const,
      operation: 'set_governance_delegate' as const,
      expectedDelegate: delegate.toBase58(),
      instructions: setInstructions,
      manifestDigest: instructionManifestDigest(setInstructions),
    },
    {
      id: 'revoke_governance_delegate' as const,
      operation: 'revoke_governance_delegate' as const,
      expectedDelegate: null,
      instructions: revokeInstructions,
      manifestDigest: instructionManifestDigest(revokeInstructions),
    },
  ];
  for (const item of steps) {
    if (item.instructions.length !== 1) {
      throw new Error(`realms_provider_${item.id}_instruction_inventory_invalid`);
    }
    const signerRefs = new Set<string>([feePayer.toBase58()]);
    for (const instruction of item.instructions) {
      if (
        !instruction.programId.equals(programId)
        || instruction.keys.length !== 2
        || !instruction.keys[0].pubkey.equals(voterAuthority)
        || instruction.keys[0].isWritable
        || !instruction.keys[0].isSigner
        || !instruction.keys[1].pubkey.equals(publicKey(contract.voterTokenOwnerRecord))
        || !instruction.keys[1].isWritable
        || instruction.keys[1].isSigner
      ) {
        throw new Error(`realms_provider_${item.id}_account_privilege_inventory_invalid`);
      }
      for (const account of instruction.keys) {
        if (account.isSigner) signerRefs.add(account.pubkey.toBase58());
      }
    }
    if (
      signerRefs.size !== 2
      || !signerRefs.has(feePayer.toBase58())
      || !signerRefs.has(voterAuthority.toBase58())
    ) {
      throw new Error(`realms_provider_${item.id}_signer_contract_mismatch`);
    }
  }
  const planDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-delegation-plan',
    {
      programVersion: PROGRAM_VERSION,
      realm: realm.toBase58(),
      governingTokenMint: governingTokenMint.toBase58(),
      voterTokenOwnerRecord: publicKey(contract.voterTokenOwnerRecord).toBase58(),
      voterOwner: voterOwner.toBase58(),
      delegate: delegate.toBase58(),
      voteRecord: publicKey(contract.voteRecord).toBase58(),
      steps: steps.map(({ id, operation, expectedDelegate, manifestDigest }) => ({
        id,
        operation,
        expectedDelegate,
        manifestDigest,
      })),
    },
  );
  const baseline = resume?.baseline ?? await dependencies.readDelegationState(null);
  assertDelegationReadback(contract, baseline, null, baseline);
  const checkpoint = normalizeDelegationCheckpoint(resume, planDigest, baseline);
  const connection = dependencies.connection;
  let totalSpendLamports = checkpoint.steps
    .filter((item) => item.status === 'finalized')
    .reduce((total, item) => total + (item.actualSpendLamports ?? 0), 0);
  const startingBalance = await connection.getBalance(feePayer, 'finalized');
  if (startingBalance > limits.maximumWalletBalanceLamports) {
    throw new Error('realms_provider_fee_payer_balance_cap_exceeded');
  }

  for (const providerStep of steps) {
    let existing = checkpoint.steps.find((candidate) => candidate.id === providerStep.id);
    if (existing && existing.manifestDigest !== providerStep.manifestDigest) {
      throw new Error('realms_provider_delegation_attempt_manifest_conflict');
    }
    if (existing?.status === 'finalized' && existing.readback) {
      assertDelegationReadback(
        contract,
        existing.readback,
        providerStep.expectedDelegate,
        checkpoint.baseline,
      );
      continue;
    }
    if (existing?.status === 'quoted') {
      checkpoint.steps = checkpoint.steps.filter((candidate) => candidate !== existing);
      existing = undefined;
    }
    if (existing && ['signed', 'submitted', 'confirmed', 'finalized'].includes(existing.status)) {
      if (existing.status !== 'finalized') {
        const finalized = await readFinalizedAttempt(
          connection,
          existing,
          checkpoint.planDigest,
          feePayer,
          dependencies.waitForReadback,
          async (transition) => {
            const changed = appendFinalityTransition(existing!, transition);
            if (transition.state === 'confirmed' && existing!.status !== 'confirmed') {
              existing!.status = 'confirmed';
              await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
            } else if (changed && transition.state === 'confirmed') {
              await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
            }
          },
        );
        existing.status = 'finalized';
        existing.slot = finalized.slot;
        existing.balanceAfterLamports = finalized.balanceAfterLamports;
        existing.actualSpendLamports = existing.balanceBeforeLamports - finalized.balanceAfterLamports;
        delete existing.rawTransactionBase64;
        assertActualSpend(existing.actualSpendLamports, limits, totalSpendLamports);
        totalSpendLamports += existing.actualSpendLamports;
      }
      existing.readback = await dependencies.readDelegationState(providerStep.expectedDelegate);
      assertDelegationReadback(
        contract,
        existing.readback,
        providerStep.expectedDelegate,
        checkpoint.baseline,
      );
      await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
      continue;
    }

    const balanceBeforeLamports = await connection.getBalance(feePayer, 'finalized');
    const [latest, quoteSlot] = await Promise.all([
      connection.getLatestBlockhash('finalized'),
      connection.getSlot('finalized'),
    ]);
    const quotedAt = new Date().toISOString();
    const transaction = new Transaction({
      feePayer,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }).add(...providerStep.instructions);
    const message = transaction.compileMessage();
    const feeQuote = await connection.getFeeForMessage(message, 'finalized');
    if (!Number.isSafeInteger(feeQuote.value) || feeQuote.value === null || feeQuote.value < 0) {
      throw new Error('realms_provider_delegation_fee_quote_invalid');
    }
    const simulation = await connection.simulateTransaction(transaction, undefined, [feePayer]);
    const simulatedPayer = simulation.value.accounts?.[0];
    if (simulation.value.err || !simulatedPayer || !Number.isSafeInteger(simulatedPayer.lamports)) {
      throw new Error('realms_provider_delegation_preflight_simulation_failed');
    }
    const simulatedSpendLamports = balanceBeforeLamports - simulatedPayer.lamports;
    if (
      simulatedSpendLamports < feeQuote.value
      || simulatedSpendLamports > limits.singleTransactionLimitLamports
      || totalSpendLamports + simulatedSpendLamports > limits.totalBootstrapLimitLamports
    ) {
      throw new Error('realms_provider_delegation_cost_cap_exceeded');
    }
    const messageBytes = transaction.serializeMessage();
    const messageDigest = createHash('sha256').update(messageBytes).digest('hex');
    const expectedCurrentDelegate = providerStep.id === 'set_governance_delegate'
      ? null
      : contract.delegate;
    const [preSignReadback, preSignBalanceLamports, preSignTrust, canonicalOwnerState] = await Promise.all([
      dependencies.readDelegationState(expectedCurrentDelegate),
      connection.getBalance(feePayer, 'finalized'),
      dependencies.verifyTrustProfile(),
      dependencies.readCanonicalOwnerState({
        stepId: providerStep.id,
        expectedDelegate: expectedCurrentDelegate,
      }),
    ]);
    try {
      assertDelegationReadback(
        contract,
        preSignReadback,
        expectedCurrentDelegate,
        checkpoint.baseline,
      );
    } catch {
      throw new Error('realms_provider_delegation_pre_sign_state_drift');
    }
    if (
      preSignBalanceLamports !== balanceBeforeLamports
      || preSignTrust.chainId !== contract.chainId
      || preSignTrust.profileRef !== contract.profileRef
      || preSignTrust.profileVersion !== contract.profileVersion
      || preSignTrust.programId !== programId.toBase58()
      || preSignTrust.commitment !== 'finalized'
      || canonicalOwnerState.schemaVersion !== 1
      || canonicalOwnerState.authority !== 'canonical_resource_authority_payer_readback'
      || !canonicalOwnerState.resourceBindingId
      || !canonicalOwnerState.authorityBindingId
      || !canonicalOwnerState.payerPolicyId
      || !['not_configured_p05_gate', 'clear_fresh_p05_authority_health']
        .includes(canonicalOwnerState.emergencyFreeze)
      || !/^[a-f0-9]{64}$/.test(canonicalOwnerState.stateDigest)
    ) throw new Error('realms_provider_delegation_pre_sign_state_drift');
    const statePreconditionFacts = {
      schemaVersion: 1 as const,
      authority: 'independent_provider_readback_before_transit_sign' as const,
      chainId: contract.chainId,
      profileRef: contract.profileRef,
      profileVersion: contract.profileVersion,
      programId: programId.toBase58(),
      actionIntentDigest: contract.actionIntentDigest,
      planDigest,
      stepId: providerStep.id,
      manifestDigest: providerStep.manifestDigest,
      messageDigest,
      expectedDelegate: expectedCurrentDelegate,
      observedSlot: preSignReadback.observedSlot,
      providerStateDigest: preSignReadback.stateDigest,
      feePayerBalanceLamports: preSignBalanceLamports,
      canonicalOwnerState,
      instructionSafety: (() => {
        const facts = {
          schemaVersion: 1 as const,
          authority: 'provider_instruction_manifest_and_simulation' as const,
          programIds: [programId.toBase58()],
          instructionCount: 1 as const,
          transactionSignerCount: 2 as const,
          writableAccountRefs: [publicKey(contract.voterTokenOwnerRecord).toBase58()],
          accountPrivilegeCheck: 'exact_spl_governance_set_delegate_accounts' as const,
          assetOutflowLamports: 0 as const,
          opaqueInstructions: false as const,
          simulation: 'passed' as const,
        };
        return {
          ...facts,
          digest: hashCanonicalGovernanceValue(
            'alcheme.governance.realms-delegation-instruction-safety-v1',
            facts,
          ),
        };
      })(),
    };
    const statePrecondition: RealmsDevnetDelegationStatePrecondition = {
      ...statePreconditionFacts,
      digest: hashCanonicalGovernanceValue(
        'alcheme.governance.realms-delegation-pre-sign-state-v1',
        statePreconditionFacts,
      ),
    };
    existing = {
      id: providerStep.id,
      manifestDigest: providerStep.manifestDigest,
      status: 'quoted',
      finalityTransitions: [],
      messageDigest,
      recentBlockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      quoteSlot,
      quotedAt,
      feeLamports: feeQuote.value,
      directRentLamports: 0,
      authorizedCeilingLamports: simulatedSpendLamports,
      balanceBeforeLamports,
      statePrecondition,
    };
    checkpoint.steps.push(existing);
    await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
    const [payerSignature, voterSignature] = await Promise.all([
      dependencies.sign({
        role: 'fee_payer',
        operation: 'pay_approved_devnet_fee_and_rent',
        message: messageBytes,
      }),
      dependencies.sign({
        role: 'voter',
        operation: providerStep.operation,
        message: messageBytes,
      }),
    ]);
    assertProviderSignature(payerSignature, contract.feePayer.publicKey);
    assertProviderSignature(voterSignature, contract.voter.publicKey);
    transaction.addSignature(feePayer, Buffer.from(payerSignature.signature));
    transaction.addSignature(voterAuthority, Buffer.from(voterSignature.signature));
    if (!transaction.verifySignatures()) {
      throw new Error('realms_provider_delegation_signature_verification_failed');
    }
    const rawTransaction = transaction.serialize();
    const signature = bs58.encode(payerSignature.signature);
    existing.status = 'signed';
    existing.signature = signature;
    existing.rawTransactionBase64 = rawTransaction.toString('base64');
    await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
    const submittedSignature = await submitRealmsProviderTransaction(
      connection,
      rawTransaction,
    );
    if (submittedSignature !== signature) {
      throw new Error('realms_provider_delegation_signature_readback_mismatch');
    }
    existing.status = 'submitted';
    appendFinalityTransition(existing, {
      state: 'submitted',
      authority: 'provider_signature_readback',
    });
    await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
    const finalized = await readFinalizedAttempt(
      connection,
      existing,
      checkpoint.planDigest,
      feePayer,
      dependencies.waitForReadback,
      async (transition) => {
        const changed = appendFinalityTransition(existing!, transition);
        if (transition.state === 'confirmed' && existing!.status !== 'confirmed') {
          existing!.status = 'confirmed';
          await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
        } else if (changed && transition.state === 'confirmed') {
          await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
        }
      },
    );
    existing.status = 'finalized';
    existing.slot = finalized.slot;
    existing.balanceAfterLamports = finalized.balanceAfterLamports;
    existing.actualSpendLamports = balanceBeforeLamports - finalized.balanceAfterLamports;
    delete existing.rawTransactionBase64;
    assertActualSpend(existing.actualSpendLamports, limits, totalSpendLamports);
    totalSpendLamports += existing.actualSpendLamports;
    existing.readback = await dependencies.readDelegationState(providerStep.expectedDelegate);
    assertDelegationReadback(
      contract,
      existing.readback,
      providerStep.expectedDelegate,
      checkpoint.baseline,
    );
    await dependencies.checkpoint(cloneDelegationCheckpoint(checkpoint));
  }

  const setAttempt = checkpoint.steps.find((item) => item.id === 'set_governance_delegate');
  const revokeAttempt = checkpoint.steps.find((item) => item.id === 'revoke_governance_delegate');
  if (
    setAttempt?.status !== 'finalized'
    || !setAttempt.readback
    || revokeAttempt?.status !== 'finalized'
    || !revokeAttempt.readback
  ) {
    throw new Error('realms_provider_delegation_finalized_inventory_mismatch');
  }
  const finalBalanceLamports = await connection.getBalance(feePayer, 'finalized');
  if (finalBalanceLamports > limits.maximumWalletBalanceLamports) {
    throw new Error('realms_provider_fee_payer_balance_cap_exceeded');
  }
  return {
    schemaVersion: 1,
    chainId: contract.chainId,
    profileRef: contract.profileRef,
    profileVersion: contract.profileVersion,
    planDigest,
    baseline: checkpoint.baseline,
    setReadback: setAttempt.readback,
    revokeReadback: revokeAttempt.readback,
    transactions: [setAttempt, revokeAttempt].map((item) => ({
      stepId: item.id,
      signature: item.signature!,
      slot: item.slot!,
      blockhash: item.recentBlockhash,
      messageDigest: item.messageDigest,
      manifestDigest: item.manifestDigest,
      lastValidBlockHeight: item.lastValidBlockHeight,
      actionContext: buildProviderExecutionActionContext({
        actionIntentDigest: contract.actionIntentDigest,
        planDigest,
        steps: [setAttempt, revokeAttempt],
        step: item,
        expectedStateChange: item.id === 'set_governance_delegate'
          ? 'governance_delegate_set_to_frozen_delegate'
          : 'governance_delegate_revoked_to_none',
      }),
      feeLamports: item.feeLamports,
      actualSpendLamports: item.actualSpendLamports!,
      statePrecondition: item.statePrecondition,
      finalityTransitions: item.finalityTransitions,
    })),
    finalBalanceLamports,
    totalSpendLamports,
    providerFinality: 'finalized',
    historicalVoteInvariant: 'unchanged',
    finalDelegate: null,
  };
}

export function createRealmsDevnetConnection(endpoint: string, timeoutMs: number): Connection {
  return new Connection(endpoint, {
    commitment: 'finalized',
    // High-risk writes own their retry/checkpoint semantics. web3.js must not
    // amplify a single faucet or Provider call after a 429 response.
    disableRetryOnRateLimit: true,
    fetch: async (input: any, init: any) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    }),
  });
}

export async function readRealmsDevnetDelegationState(
  connection: Connection,
  contract: RealmsDevnetDelegationContract,
): Promise<RealmsDevnetDelegationStateReadback> {
  const programId = publicKey(contract.programId);
  const tokenOwnerRecordRef = publicKey(contract.voterTokenOwnerRecord);
  const voteRecordRef = publicKey(contract.voteRecord);
  const [tokenOwnerRecord, voteRecord, observedSlot] = await Promise.all([
    getTokenOwnerRecord(connection, tokenOwnerRecordRef),
    getVoteRecord(connection, voteRecordRef),
    connection.getSlot('finalized'),
  ]);
  const voterOwner = publicKey(contract.voterOwner);
  if (
    !tokenOwnerRecord.owner.equals(programId)
    || !tokenOwnerRecord.account.realm.equals(publicKey(contract.realm))
    || !tokenOwnerRecord.account.governingTokenMint.equals(publicKey(contract.governingTokenMint))
    || !tokenOwnerRecord.account.governingTokenOwner.equals(voterOwner)
    || !voteRecord.owner.equals(programId)
    || !voteRecord.account.governingTokenOwner.equals(voterOwner)
    || !Number.isSafeInteger(observedSlot)
    || observedSlot <= 0
  ) {
    throw new Error('realms_provider_delegation_account_graph_mismatch');
  }
  const facts = {
    schemaVersion: 1 as const,
    authority: 'independent_provider_readback' as const,
    commitment: 'finalized' as const,
    observedSlot,
    tokenOwnerRecord: tokenOwnerRecordRef.toBase58(),
    voterOwner: voterOwner.toBase58(),
    depositAmount: tokenOwnerRecord.account.governingTokenDepositAmount.toString(),
    governanceDelegate: tokenOwnerRecord.account.governanceDelegate?.toBase58() ?? null,
    voteRecord: voteRecordRef.toBase58(),
    voteRecordVoter: voteRecord.account.governingTokenOwner.toBase58(),
    yesVoteWeight: voteRecord.account.getYesVoteWeight()?.toString() ?? '0',
  };
  return {
    ...facts,
    stateDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-delegation-readback',
      facts,
    ),
  };
}

export async function readRealmsDevnetAccountGraph(
  connection: Connection,
  contract: RealmsDevnetBootstrapContract,
  receipt: RealmsDevnetBootstrapProviderReceipt,
  slotConvergenceWindow: number,
): Promise<RealmsDevnetAccountGraphReadback> {
  if (
    receipt.chainId !== contract.chainId
    || receipt.profileRef !== contract.profileRef
    || receipt.profileVersion !== contract.profileVersion
    || receipt.providerFinality !== 'finalized'
    || receipt.transactions.length !== receipt.plan.steps.length
    || !Number.isInteger(slotConvergenceWindow)
    || slotConvergenceWindow < 0
  ) {
    throw new Error('realms_provider_account_graph_receipt_mismatch');
  }
  const addresses = receipt.plan.addresses;
  const programId = new PublicKey(contract.programId);
  const accountAddresses = [
    addresses.realm,
    addresses.realmConfig,
    addresses.governance,
    addresses.proposal,
    addresses.proposalTransaction,
    addresses.proposerTokenOwnerRecord,
    addresses.voterTokenOwnerRecord,
    addresses.voteRecord,
  ].map((value) => new PublicKey(value));
  const accountReadback = await connection.getMultipleAccountsInfoAndContext(
    accountAddresses,
    { commitment: 'finalized' },
  );
  if (
    accountReadback.value.length !== accountAddresses.length
    || accountReadback.value.some((account) => !account || !account.owner.equals(programId))
  ) {
    throw new Error('realms_provider_account_graph_owner_mismatch');
  }
  const startSlot = accountReadback.context.slot;
  const realm = await getRealm(connection, accountAddresses[0]);
  const realmConfig = await tryGetRealmConfig(connection, programId, accountAddresses[0]);
  const governance = await getGovernance(connection, accountAddresses[2]);
  const proposal = await getProposal(connection, accountAddresses[3]);
  const proposalTransaction = await getGovernanceAccount(
    connection,
    accountAddresses[4],
    ProposalTransaction,
  );
  const proposerRecord = await getTokenOwnerRecord(connection, accountAddresses[5]);
  const voterRecord = await getTokenOwnerRecord(connection, accountAddresses[6]);
  const voteRecord = await getVoteRecord(connection, accountAddresses[7]);
  const endSlot = await connection.getSlot('finalized');
  const lastTransactionSlot = Math.max(...receipt.transactions.map((item) => item.slot));
  const slotSpan = endSlot - startSlot;
  const communityMint = new PublicKey(addresses.communityMint);
  const proposer = new PublicKey(contract.authorities.proposer.publicKey);
  const voter = new PublicKey(contract.authorities.voter.publicKey);
  const executor = new PublicKey(contract.authorities.executor.publicKey);
  const approveOption = proposal.account.options[0];
  if (
    !Number.isSafeInteger(startSlot)
    || startSlot < lastTransactionSlot
    || !Number.isSafeInteger(endSlot)
    || slotSpan < 0
    || slotSpan > slotConvergenceWindow
    || realm.account.name !== contract.realmName
    || !realm.account.communityMint.equals(communityMint)
    || !realm.account.authority?.equals(new PublicKey(
      contract.authorities.bootstrap_authority.publicKey,
    ))
    || !realmConfig
    || !realmConfig.pubkey.equals(accountAddresses[1])
    || !realmConfig.account.realm.equals(accountAddresses[0])
    || realmConfig.account.communityTokenConfig.voterWeightAddin !== undefined
    || realmConfig.account.communityTokenConfig.maxVoterWeightAddin !== undefined
    || !governance.account.realm.equals(accountAddresses[0])
    || !governance.account.governedAccount.equals(executor)
    || !proposal.account.governance.equals(accountAddresses[2])
    || !proposal.account.tokenOwnerRecord.equals(accountAddresses[5])
    || !proposal.account.governingTokenMint.equals(communityMint)
    || proposal.account.state !== ProposalState.Completed
    || proposal.account.options.length !== 1
    || !approveOption
    || approveOption.label !== 'Approve'
    || approveOption.voteWeight.toString() !== contract.voterWeight
    || approveOption.voteResult !== OptionVoteResult.Succeeded
    || approveOption.instructionsExecutedCount !== 1
    || approveOption.instructionsCount !== 1
    || approveOption.instructionsNextIndex !== 1
    || !proposalTransaction.account.proposal.equals(accountAddresses[3])
    || proposalTransaction.account.executionStatus !== InstructionExecutionStatus.Success
    || !proposerRecord.account.realm.equals(accountAddresses[0])
    || !proposerRecord.account.governingTokenMint.equals(communityMint)
    || !proposerRecord.account.governingTokenOwner.equals(proposer)
    || proposerRecord.account.governingTokenDepositAmount.toString() !== contract.proposerWeight
    || proposerRecord.account.governanceDelegate !== undefined
    || !Number.isSafeInteger(proposerRecord.account.unrelinquishedVotesCount)
    || proposerRecord.account.unrelinquishedVotesCount < 0
    || !Number.isSafeInteger(proposerRecord.account.outstandingProposalCount)
    || proposerRecord.account.outstandingProposalCount < 0
    || !voterRecord.account.realm.equals(accountAddresses[0])
    || !voterRecord.account.governingTokenMint.equals(communityMint)
    || !voterRecord.account.governingTokenOwner.equals(voter)
    || voterRecord.account.governingTokenDepositAmount.toString() !== contract.voterWeight
    || voterRecord.account.governanceDelegate !== undefined
    || !Number.isSafeInteger(voterRecord.account.unrelinquishedVotesCount)
    || voterRecord.account.unrelinquishedVotesCount < 0
    || !Number.isSafeInteger(voterRecord.account.outstandingProposalCount)
    || voterRecord.account.outstandingProposalCount < 0
    || accountAddresses[5].equals(accountAddresses[6])
    || proposer.equals(voter)
    || !voteRecord.account.proposal.equals(accountAddresses[3])
    || !voteRecord.account.governingTokenOwner.equals(voter)
    || voteRecord.account.getYesVoteWeight()?.toString() !== contract.voterWeight
  ) {
    throw new Error('realms_provider_account_graph_state_mismatch');
  }
  const tokenOwnerRecords: RealmsVotingPowerSecurityProfile['tokenOwnerRecords'] = [
    {
      role: 'proposer',
      recordRef: accountAddresses[5].toBase58(),
      owner: proposer.toBase58(),
      depositAmount: proposerRecord.account.governingTokenDepositAmount.toString(),
      governanceDelegate: null,
      unrelinquishedVotesCount: proposerRecord.account.unrelinquishedVotesCount,
      outstandingProposalCount: proposerRecord.account.outstandingProposalCount,
    },
    {
      role: 'voter',
      recordRef: accountAddresses[6].toBase58(),
      owner: voter.toBase58(),
      depositAmount: voterRecord.account.governingTokenDepositAmount.toString(),
      governanceDelegate: null,
      unrelinquishedVotesCount: voterRecord.account.unrelinquishedVotesCount,
      outstandingProposalCount: voterRecord.account.outstandingProposalCount,
    },
  ];
  const sameResourceRootFacts: Omit<RealmsVotingPowerSecurityProfile['sameResourceRoot'], 'rootDigest'> = {
    schemaVersion: 1,
    rootRef: accountAddresses[0].toBase58(),
    paths: [
      { kind: 'realm_config', ref: accountAddresses[1].toBase58(), status: 'observed' },
      { kind: 'governing_token_mint', ref: communityMint.toBase58(), status: 'observed' },
      { kind: 'token_owner_record', ref: accountAddresses[5].toBase58(), status: 'observed' },
      { kind: 'token_owner_record', ref: accountAddresses[6].toBase58(), status: 'observed' },
      { kind: 'vote_record', ref: accountAddresses[7].toBase58(), status: 'observed' },
      { kind: 'voter_weight_addin', ref: null, status: 'not_configured' },
      { kind: 'max_voter_weight_addin', ref: null, status: 'not_configured' },
    ],
    duplicatePathCount: 0,
    cycleDetected: false,
    recordExpiry: 'not_applicable_no_vwr',
  };
  const observedPathRefs = sameResourceRootFacts.paths
    .filter((path) => path.status === 'observed')
    .map((path) => path.ref as string);
  if (
    new Set(observedPathRefs).size !== observedPathRefs.length
    || observedPathRefs.includes(sameResourceRootFacts.rootRef)
  ) {
    throw new Error('realms_provider_same_resource_cycle_or_duplicate_path');
  }
  const sameResourceRoot: RealmsVotingPowerSecurityProfile['sameResourceRoot'] = {
    ...sameResourceRootFacts,
    rootDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.realms-voting-power-same-resource-root-v1',
      sameResourceRootFacts,
    ),
  };
  const delegationGraphFacts = {
    edges: [] as never[],
    duplicateResourceCount: 0 as const,
    cycleDetected: false as const,
    maxDepthObserved: 0 as const,
    mapping: 'exact_no_delegate' as const,
  };
  const votingPowerSecurityFacts: Omit<RealmsVotingPowerSecurityProfile, 'profileDigest'> = {
    schemaVersion: 1,
    readinessState: 'unavailable',
    mode: 'standard_token_weight_no_addins',
    source: {
      authority: 'independent_provider_readback',
      chainId: contract.chainId,
      profileRef: contract.profileRef,
      profileVersion: contract.profileVersion,
      programId: programId.toBase58(),
      realm: addresses.realm,
      governingTokenMint: communityMint.toBase58(),
      commitment: 'finalized',
      snapshotSlot: startSlot,
    },
    tokenOwnerRecords,
    voteRecord: {
      recordRef: accountAddresses[7].toBase58(),
      voter: voter.toBase58(),
      yesVoteWeight: voteRecord.account.getYesVoteWeight()?.toString() ?? '0',
    },
    sameResourceRoot,
    delegationGraph: {
      ...delegationGraphFacts,
      graphDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.realms-voting-power-delegation-graph-v1',
        delegationGraphFacts,
      ),
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
    blockerCodes: [
      'voting_power_snapshot_delay_not_configured',
      'voting_power_deposit_cooldown_not_configured',
      'voting_power_borrowed_capital_risk_unmitigated',
      'voting_power_vsr_vwr_not_configured',
    ],
  };
  const votingPowerSecurity: RealmsVotingPowerSecurityProfile = {
    ...votingPowerSecurityFacts,
    profileDigest: hashCanonicalGovernanceValue(
      REALMS_VOTING_POWER_SECURITY_PROFILE_DOMAIN,
      votingPowerSecurityFacts,
    ),
  };
  const facts = {
    schemaVersion: 1 as const,
    observedSlot: startSlot,
    lastTransactionSlot,
    slotSpan,
    ownerProgramRef: programId.toBase58(),
    resourceRef: addresses.realm,
    accountGraph: addresses,
    proposalState: 'completed' as const,
    instructionExecutionStatus: 'success' as const,
    proposerWeight: contract.proposerWeight,
    voterWeight: contract.voterWeight,
    yesVoteWeight: contract.voterWeight,
    signatoryRecord: 'not_applicable_direct_governance_authority_signoff' as const,
    voterWeightAddin: 'not_configured' as const,
    maxVoterWeightAddin: 'not_configured' as const,
    customPlugins: 'unavailable' as const,
    votingPowerSecurity,
    noRealAssets: true as const,
  };
  return {
    ...facts,
    status: 'verified_finalized',
    stateDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.realms-provider-account-graph-readback',
      facts,
    ),
  };
}

async function withCreateDeterministicProposal(
  instructions: TransactionInstruction[],
  input: {
    programId: PublicKey;
    realm: PublicKey;
    governance: PublicKey;
    tokenOwnerRecord: PublicKey;
    governingTokenMint: PublicKey;
    governanceAuthority: PublicKey;
    payer: PublicKey;
    proposalSeed: PublicKey;
    name: string;
    descriptionLink: string;
  },
): Promise<PublicKey> {
  const args = new CreateProposalArgs({
    name: input.name,
    descriptionLink: input.descriptionLink,
    governingTokenMint: input.governingTokenMint,
    voteType: VoteType.SINGLE_CHOICE,
    options: ['Approve'],
    useDenyOption: true,
    proposalSeed: input.proposalSeed,
  });
  const data = Buffer.from(
    governanceBorsh.serialize(getGovernanceInstructionSchema(PROGRAM_VERSION), args),
  );
  const [proposal] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('governance'),
      input.governance.toBuffer(),
      input.governingTokenMint.toBuffer(),
      input.proposalSeed.toBuffer(),
    ],
    input.programId,
  );
  const realmConfig = await getRealmConfigAddress(input.programId, input.realm);
  const proposalDeposit = await getProposalDepositAddress(
    input.programId,
    proposal,
    input.payer,
  );
  instructions.push(new TransactionInstruction({
    programId: input.programId,
    keys: [
      { pubkey: input.realm, isWritable: false, isSigner: false },
      { pubkey: proposal, isWritable: true, isSigner: false },
      { pubkey: input.governance, isWritable: true, isSigner: false },
      { pubkey: input.tokenOwnerRecord, isWritable: true, isSigner: false },
      { pubkey: input.governingTokenMint, isWritable: false, isSigner: false },
      { pubkey: input.governanceAuthority, isWritable: false, isSigner: true },
      { pubkey: input.payer, isWritable: true, isSigner: true },
      { pubkey: SYSTEM_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: realmConfig, isWritable: false, isSigner: false },
      { pubkey: proposalDeposit, isWritable: true, isSigner: false },
    ],
    data,
  }));
  return proposal;
}

function step(
  id: RealmsDevnetBootstrapStep['id'],
  authoritySigners: RealmsDevnetBootstrapStep['authoritySigners'],
  instructions: TransactionInstruction[],
): RealmsDevnetBootstrapStep {
  if (instructions.length === 0) throw new Error(`realms_provider_${id}_instructions_missing`);
  if (
    authoritySigners.length === 0
    || new Set(authoritySigners.map((signer) => signer.role)).size !== authoritySigners.length
  ) throw new Error(`realms_provider_${id}_authority_signers_invalid`);
  return {
    id,
    authoritySigners,
    instructions,
    manifestDigest: instructionManifestDigest(instructions),
  };
}

function instructionManifestDigest(instructions: TransactionInstruction[]): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.realms-provider-instruction-manifest',
    instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      accounts: instruction.keys.map((account) => ({
        pubkey: account.pubkey.toBase58(),
        isSigner: account.isSigner,
        isWritable: account.isWritable,
      })),
      dataSha256: createHash('sha256').update(instruction.data).digest('hex'),
    })),
  );
}

function assertStepSignerContract(
  item: RealmsDevnetBootstrapStep,
  authorities: RealmsDevnetBootstrapContract['authorities'],
  feePayer: PublicKey,
): void {
  const actual = new Set<string>([feePayer.toBase58()]);
  for (const instruction of item.instructions) {
    for (const account of instruction.keys) {
      if (account.isSigner) actual.add(account.pubkey.toBase58());
    }
  }
  const expected = new Set([
    authorities.fee_payer.publicKey,
    ...item.authoritySigners.map((signer) => authorities[signer.role].publicKey),
  ]);
  if (
    actual.size !== expected.size
    || [...actual].some((signer) => !expected.has(signer))
  ) {
    throw new Error(`realms_provider_${item.id}_signer_contract_mismatch`);
  }
}

function assertBootstrapContract(
  contract: RealmsDevnetBootstrapContract,
  rent: RealmsDevnetDirectRentQuote,
): void {
  if (
    !contract.requestId
    || !/^[a-f0-9]{64}$/.test(contract.decisionDigest)
    || !/^[a-f0-9]{64}$/.test(contract.actionIntentDigest)
    || !Number.isInteger(contract.circleId)
    || contract.circleId <= 0
    || contract.chainId !== 'solana:devnet'
    || !contract.profileRef
    || !Number.isInteger(contract.profileVersion)
    || contract.profileVersion <= 0
    || Buffer.byteLength(contract.realmName, 'utf8') < 1
    || Buffer.byteLength(contract.realmName, 'utf8') > 32
    || contract.communityMintDecimals !== 0
    || contract.proposerWeight !== '1'
    || contract.voterWeight !== '2'
    || contract.voteThresholdPercentage !== 50
    || contract.baseVotingTimeSeconds !== 3600
    || contract.voteTipping !== 'early'
    || contract.approvedInstruction !== 'system_program_zero_lamport_executor_self_transfer'
    || !Number.isSafeInteger(rent.mintLamports)
    || rent.mintLamports <= 0
    || !Number.isSafeInteger(rent.tokenAccountLamports)
    || rent.tokenAccountLamports <= 0
  ) {
    throw new Error('realms_provider_bootstrap_plan_contract_invalid');
  }
  const publicKeys = Object.values(contract.authorities).map((authority) => (
    publicKey(authority.publicKey).toBase58()
  ));
  if (publicKeys.length !== 5 || new Set(publicKeys).size !== publicKeys.length) {
    throw new Error('realms_provider_bootstrap_authority_separation_required');
  }
}

function assertLimits(limits: RealmsDevnetBootstrapLimits): void {
  if (
    !Number.isSafeInteger(limits.singleTransactionLimitLamports)
    || limits.singleTransactionLimitLamports <= 0
    || !Number.isSafeInteger(limits.totalBootstrapLimitLamports)
    || limits.totalBootstrapLimitLamports < limits.singleTransactionLimitLamports
    || !Number.isSafeInteger(limits.maximumWalletBalanceLamports)
    || limits.maximumWalletBalanceLamports < limits.totalBootstrapLimitLamports
  ) {
    throw new Error('realms_provider_payer_limits_invalid');
  }
}

function assertDelegationContract(contract: RealmsDevnetDelegationContract): void {
  if (
    !contract.requestId
    || !/^[a-f0-9]{64}$/.test(contract.decisionDigest)
    || !/^[a-f0-9]{64}$/.test(contract.actionIntentDigest)
    || !Number.isInteger(contract.circleId)
    || contract.circleId <= 0
    || contract.chainId !== 'solana:devnet'
    || !contract.profileRef
    || !Number.isInteger(contract.profileVersion)
    || contract.profileVersion <= 0
    || !/^\d+$/.test(contract.voterDepositAmount)
    || !/^\d+$/.test(contract.yesVoteWeight)
  ) {
    throw new Error('realms_provider_delegation_contract_invalid');
  }
  for (const value of [
    contract.programId,
    contract.realm,
    contract.governingTokenMint,
    contract.voterTokenOwnerRecord,
    contract.voterOwner,
    contract.delegate,
    contract.voteRecord,
    contract.voter.publicKey,
    contract.feePayer.publicKey,
  ]) publicKey(value);
  if (!contract.voter.keyRef || !contract.feePayer.keyRef) {
    throw new Error('realms_provider_delegation_key_contract_invalid');
  }
}

function normalizeDelegationCheckpoint(
  value: RealmsDevnetDelegationCheckpoint | null | undefined,
  planDigest: string,
  baseline: RealmsDevnetDelegationStateReadback,
): RealmsDevnetDelegationCheckpoint {
  if (!value) {
    return { schemaVersion: 1, planDigest, baseline, steps: [] };
  }
  if (!validRealmsDevnetDelegationCheckpoint(value, planDigest)) {
    throw new Error('realms_provider_delegation_checkpoint_conflict');
  }
  assertSameDelegationVotingFacts(value.baseline, baseline);
  return cloneDelegationCheckpoint(value);
}

export function validRealmsDevnetDelegationCheckpoint(
  value: unknown,
  expectedPlanDigest?: string,
): value is RealmsDevnetDelegationCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as RealmsDevnetDelegationCheckpoint;
  return checkpoint.schemaVersion === 1
    && /^[a-f0-9]{64}$/.test(String(checkpoint.planDigest ?? ''))
    && (expectedPlanDigest === undefined || checkpoint.planDigest === expectedPlanDigest)
    && validDelegationReadback(checkpoint.baseline)
    && checkpoint.baseline.governanceDelegate === null
    && Array.isArray(checkpoint.steps)
    && checkpoint.steps.length <= 2
    && new Set(checkpoint.steps.map((item) => item.id)).size === checkpoint.steps.length
    && checkpoint.steps.every((item) => (
      ['set_governance_delegate', 'revoke_governance_delegate'].includes(item.id)
      && validFinalityTransitionInventory(item)
      && validDelegationStatePrecondition(item.statePrecondition, item, checkpoint.planDigest)
      && (item.readback === undefined || validDelegationReadback(item.readback))
    ));
}

function validDelegationStatePrecondition(
  value: unknown,
  attempt: RealmsDevnetDelegationStepCheckpoint,
  planDigest: string,
): value is RealmsDevnetDelegationStatePrecondition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const precondition = value as RealmsDevnetDelegationStatePrecondition;
  const { digest, ...facts } = precondition;
  return precondition.schemaVersion === 1
    && precondition.authority === 'independent_provider_readback_before_transit_sign'
    && precondition.chainId === 'solana:devnet'
    && typeof precondition.profileRef === 'string'
    && precondition.profileRef.length > 0
    && Number.isSafeInteger(precondition.profileVersion)
    && precondition.profileVersion > 0
    && typeof precondition.programId === 'string'
    && precondition.programId.length > 0
    && /^[a-f0-9]{64}$/.test(precondition.actionIntentDigest)
    && precondition.planDigest === planDigest
    && precondition.stepId === attempt.id
    && precondition.manifestDigest === attempt.manifestDigest
    && precondition.messageDigest === attempt.messageDigest
    && (precondition.expectedDelegate === null
      || (typeof precondition.expectedDelegate === 'string'
        && precondition.expectedDelegate.length > 0))
    && Number.isSafeInteger(precondition.observedSlot)
    && precondition.observedSlot > 0
    && /^[a-f0-9]{64}$/.test(precondition.providerStateDigest)
    && Number.isSafeInteger(precondition.feePayerBalanceLamports)
    && precondition.feePayerBalanceLamports >= 0
    && precondition.canonicalOwnerState?.schemaVersion === 1
    && precondition.canonicalOwnerState.authority === 'canonical_resource_authority_payer_readback'
    && typeof precondition.canonicalOwnerState.resourceBindingId === 'string'
    && precondition.canonicalOwnerState.resourceBindingId.length > 0
    && typeof precondition.canonicalOwnerState.authorityBindingId === 'string'
    && precondition.canonicalOwnerState.authorityBindingId.length > 0
    && typeof precondition.canonicalOwnerState.payerPolicyId === 'string'
    && precondition.canonicalOwnerState.payerPolicyId.length > 0
    && ['not_configured_p05_gate', 'clear_fresh_p05_authority_health']
      .includes(precondition.canonicalOwnerState.emergencyFreeze)
    && /^[a-f0-9]{64}$/.test(precondition.canonicalOwnerState.stateDigest)
    && validDelegationInstructionSafety(precondition.instructionSafety, precondition.programId)
    && /^[a-f0-9]{64}$/.test(digest)
    && digest === hashCanonicalGovernanceValue(
      'alcheme.governance.realms-delegation-pre-sign-state-v1',
      facts,
    );
}

function validDelegationInstructionSafety(
  value: unknown,
  programId: string,
): value is RealmsDevnetDelegationStatePrecondition['instructionSafety'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const safety = value as RealmsDevnetDelegationStatePrecondition['instructionSafety'];
  const { digest, ...facts } = safety;
  return safety.schemaVersion === 1
    && safety.authority === 'provider_instruction_manifest_and_simulation'
    && Array.isArray(safety.programIds)
    && safety.programIds.length === 1
    && safety.programIds[0] === programId
    && safety.instructionCount === 1
    && safety.transactionSignerCount === 2
    && Array.isArray(safety.writableAccountRefs)
    && safety.writableAccountRefs.length === 1
    && typeof safety.writableAccountRefs[0] === 'string'
    && safety.writableAccountRefs[0].length > 0
    && safety.accountPrivilegeCheck === 'exact_spl_governance_set_delegate_accounts'
    && safety.assetOutflowLamports === 0
    && safety.opaqueInstructions === false
    && safety.simulation === 'passed'
    && /^[a-f0-9]{64}$/.test(digest)
    && digest === hashCanonicalGovernanceValue(
      'alcheme.governance.realms-delegation-instruction-safety-v1',
      facts,
    );
}

function validDelegationReadback(value: unknown): value is RealmsDevnetDelegationStateReadback {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const readback = value as RealmsDevnetDelegationStateReadback;
  return readback.schemaVersion === 1
    && readback.authority === 'independent_provider_readback'
    && readback.commitment === 'finalized'
    && Number.isSafeInteger(readback.observedSlot)
    && readback.observedSlot > 0
    && /^\d+$/.test(String(readback.depositAmount ?? ''))
    && /^\d+$/.test(String(readback.yesVoteWeight ?? ''))
    && /^[a-f0-9]{64}$/.test(String(readback.stateDigest ?? ''));
}

function cloneDelegationCheckpoint(
  value: RealmsDevnetDelegationCheckpoint,
): RealmsDevnetDelegationCheckpoint {
  return JSON.parse(JSON.stringify(value)) as RealmsDevnetDelegationCheckpoint;
}

function assertSameDelegationVotingFacts(
  actual: RealmsDevnetDelegationStateReadback,
  expected: RealmsDevnetDelegationStateReadback,
): void {
  if (
    actual.tokenOwnerRecord !== expected.tokenOwnerRecord
    || actual.voterOwner !== expected.voterOwner
    || actual.depositAmount !== expected.depositAmount
    || actual.voteRecord !== expected.voteRecord
    || actual.voteRecordVoter !== expected.voteRecordVoter
    || actual.yesVoteWeight !== expected.yesVoteWeight
  ) {
    throw new Error('realms_provider_delegation_historical_vote_invariant_mismatch');
  }
}

function assertDelegationReadback(
  contract: RealmsDevnetDelegationContract,
  actual: RealmsDevnetDelegationStateReadback,
  expectedDelegate: string | null,
  baseline: RealmsDevnetDelegationStateReadback,
): void {
  if (
    !validDelegationReadback(actual)
    || actual.tokenOwnerRecord !== publicKey(contract.voterTokenOwnerRecord).toBase58()
    || actual.voterOwner !== publicKey(contract.voterOwner).toBase58()
    || actual.depositAmount !== contract.voterDepositAmount
    || actual.voteRecord !== publicKey(contract.voteRecord).toBase58()
    || actual.voteRecordVoter !== publicKey(contract.voterOwner).toBase58()
    || actual.yesVoteWeight !== contract.yesVoteWeight
    || actual.governanceDelegate !== expectedDelegate
  ) {
    throw new Error('realms_provider_delegation_readback_mismatch');
  }
  assertSameDelegationVotingFacts(actual, baseline);
}

function normalizeCheckpoint(
  value: RealmsDevnetBootstrapCheckpoint | null | undefined,
  planDigest: string,
  limits: RealmsDevnetBootstrapLimits,
): RealmsDevnetBootstrapCheckpoint {
  if (!value) {
    return {
      schemaVersion: 1,
      planDigest,
      funding: {
        targetBalanceLamports: Math.min(
          limits.singleTransactionLimitLamports,
          limits.totalBootstrapLimitLamports,
        ),
        status: 'not_required',
        balanceLamports: 0,
      },
      steps: [],
      expiredAttempts: [],
    };
  }
  if (!validRealmsDevnetBootstrapCheckpoint(value, planDigest)) {
    throw new Error('realms_provider_attempt_checkpoint_conflict');
  }
  return cloneCheckpoint(value);
}

export function validRealmsDevnetBootstrapCheckpoint(
  value: unknown,
  expectedPlanDigest?: string,
): value is RealmsDevnetBootstrapCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as RealmsDevnetBootstrapCheckpoint;
  return checkpoint.schemaVersion === 1
    && typeof checkpoint.planDigest === 'string'
    && /^[a-f0-9]{64}$/.test(checkpoint.planDigest)
    && (expectedPlanDigest === undefined || checkpoint.planDigest === expectedPlanDigest)
    && checkpoint.funding !== null
    && typeof checkpoint.funding === 'object'
    && ['not_required', 'submitted', 'finalized'].includes(checkpoint.funding.status)
    && Number.isSafeInteger(checkpoint.funding.balanceLamports)
    && checkpoint.funding.balanceLamports >= 0
    && Array.isArray(checkpoint.steps)
    && new Set(checkpoint.steps.map((item) => item.id)).size === checkpoint.steps.length
    && checkpoint.steps.every((item) => validFinalityTransitionInventory(item))
    && validExpiredAttemptInventory(checkpoint.expiredAttempts);
}

function validExpiredAttemptInventory(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 24) return false;
  const messageDigests = new Set<string>();
  return value.every((attempt: any) => {
    const valid = attempt
      && typeof attempt === 'object'
      && !Array.isArray(attempt)
      && typeof attempt.stepId === 'string'
      && /^[a-f0-9]{64}$/.test(String(attempt.manifestDigest ?? ''))
      && /^[a-f0-9]{64}$/.test(String(attempt.messageDigest ?? ''))
      && typeof attempt.recentBlockhash === 'string'
      && attempt.recentBlockhash.length > 0
      && Number.isSafeInteger(attempt.lastValidBlockHeight)
      && attempt.lastValidBlockHeight >= 0
      && Number.isSafeInteger(attempt.expiredAtBlockHeight)
      && attempt.expiredAtBlockHeight > attempt.lastValidBlockHeight
      && Number.isSafeInteger(attempt.feeLamports)
      && attempt.feeLamports >= 0
      && Number.isSafeInteger(attempt.directRentLamports)
      && attempt.directRentLamports >= 0
      && Number.isSafeInteger(attempt.authorizedCeilingLamports)
      && attempt.authorizedCeilingLamports >= 0
      && Number.isSafeInteger(attempt.balanceBeforeLamports)
      && attempt.balanceBeforeLamports >= 0
      && typeof attempt.signature === 'string'
      && attempt.signature.length >= 64
      && attempt.signature.length <= 100
      && Array.isArray(attempt.finalityTransitions)
      && attempt.disposition === 'authoritative_expiry_same_intent_manual_retry';
    if (!valid || messageDigests.has(attempt.messageDigest)) return false;
    messageDigests.add(attempt.messageDigest);
    return true;
  });
}

function cloneCheckpoint(
  value: RealmsDevnetBootstrapCheckpoint,
): RealmsDevnetBootstrapCheckpoint {
  return JSON.parse(JSON.stringify(value)) as RealmsDevnetBootstrapCheckpoint;
}

function assertProviderSignature(
  readback: { publicKey: string; signature: Uint8Array },
  expectedPublicKey: string,
): void {
  if (
    readback.publicKey !== expectedPublicKey
    || !(readback.signature instanceof Uint8Array)
    || readback.signature.length !== 64
  ) {
    throw new Error('realms_provider_signer_readback_mismatch');
  }
}

async function readFinalizedAttempt(
  connection: RealmsDevnetProviderConnection,
  attempt: RealmsProviderAttemptCheckpoint,
  planDigest: string,
  feePayer: PublicKey,
  waitForReadback: (milliseconds: number) => Promise<void> = (milliseconds) => (
    new Promise((resolve) => setTimeout(resolve, milliseconds))
  ),
  onFinalityTransition: (
    transition: RealmsProviderFinalityTransition,
  ) => Promise<void> = async () => undefined,
): Promise<{ slot: number; balanceAfterLamports: number }> {
  if (!attempt.signature) {
    throw new Error('realms_provider_attempt_signature_missing');
  }
  let confirmationAttempted = false;
  let sawFinalizedStatus = false;
  for (let attemptIndex = 0; attemptIndex < 12; attemptIndex += 1) {
    const status = (await connection.getSignatureStatuses(
      [attempt.signature],
      { searchTransactionHistory: true },
    )).value[0];
    if (status?.err) {
      throw new Error('realms_provider_transaction_failed');
    }
    if (!status) {
      const currentBlockHeight = await connection.getBlockHeight('finalized');
      if (!Number.isSafeInteger(currentBlockHeight) || currentBlockHeight < 0) {
        throw new Error('realms_provider_block_height_invalid');
      }
      if (currentBlockHeight > attempt.lastValidBlockHeight) {
        throw new RealmsProviderExecutionExpiredError({
          schemaVersion: 1,
          kind: 'realms_provider_execution_expiry',
          state: 'execution_expired',
          authority: 'solana_rpc_finalized_block_height_and_missing_signature_status',
          commitment: 'finalized',
          planDigest,
          stepId: attempt.id,
          manifestDigest: attempt.manifestDigest,
          messageDigest: attempt.messageDigest,
          signature: attempt.signature,
          lastValidBlockHeight: attempt.lastValidBlockHeight,
          observedBlockHeight: currentBlockHeight,
          signatureStatus: 'not_found',
          providerEffect: 'not_observed',
          retryBoundary: 'same_intent_manual_retry_only',
        });
      }
    }
    if (status?.confirmationStatus === 'finalized') {
      sawFinalizedStatus = true;
      const transaction = await connection.getTransaction(attempt.signature, {
        commitment: 'finalized',
        maxSupportedTransactionVersion: 0,
      });
      if (
        transaction
        && Number.isSafeInteger(transaction.slot)
        && transaction.slot > 0
        && transaction.meta
        && !transaction.meta.err
      ) {
        await onFinalityTransition({
          state: 'finalized',
          authority: 'solana_rpc_finalized_transaction',
          slot: transaction.slot,
        });
        const balanceAfterLamports = await connection.getBalance(feePayer, 'finalized');
        return { slot: transaction.slot, balanceAfterLamports };
      }
    } else {
      if (status?.confirmationStatus === 'confirmed') {
        await onFinalityTransition({
          state: 'confirmed',
          authority: 'solana_rpc_signature_status',
        });
      }
      if (confirmationAttempted) {
        if (attemptIndex < 11) await waitForReadback(1_000);
        continue;
      }
      confirmationAttempted = true;
      const confirmation = await connection.confirmTransaction({
        signature: attempt.signature,
        blockhash: attempt.recentBlockhash,
        lastValidBlockHeight: attempt.lastValidBlockHeight,
      }, 'finalized');
      if (confirmation.value.err) {
        throw new Error('realms_provider_transaction_failed');
      }
    }
    if (attemptIndex < 11) await waitForReadback(1_000);
  }
  throw new Error(sawFinalizedStatus
    ? 'realms_provider_finalized_transaction_readback_invalid'
    : 'realms_provider_attempt_status_ambiguous');
}

function appendFinalityTransition(
  attempt: RealmsProviderAttemptCheckpoint,
  transition: RealmsProviderFinalityTransition,
): boolean {
  const prior = attempt.finalityTransitions.at(-1);
  if (prior?.state === transition.state) {
    if (prior.authority !== transition.authority || prior.slot !== transition.slot) {
      throw new Error('realms_provider_finality_transition_conflict');
    }
    return false;
  }
  const order = { submitted: 1, confirmed: 2, finalized: 3 } as const;
  if (prior && order[transition.state] <= order[prior.state]) {
    throw new Error('realms_provider_finality_transition_regression');
  }
  attempt.finalityTransitions.push(transition);
  return true;
}

function validFinalityTransitionInventory(
  attempt: RealmsProviderAttemptCheckpoint,
): boolean {
  if (!validRealmsProviderFinalityTransitions(attempt.finalityTransitions)) return false;
  const latest = attempt.finalityTransitions.at(-1)?.state;
  if (attempt.status === 'submitted') return latest === 'submitted';
  if (attempt.status === 'confirmed') return latest === 'confirmed';
  if (attempt.status === 'finalized') return latest === 'finalized';
  return latest === undefined;
}


function assertActualSpend(
  actualSpendLamports: number,
  limits: RealmsDevnetBootstrapLimits,
  priorSpendLamports: number,
): void {
  if (
    !Number.isSafeInteger(actualSpendLamports)
    || actualSpendLamports < 0
    || actualSpendLamports > limits.singleTransactionLimitLamports
    || priorSpendLamports + actualSpendLamports > limits.totalBootstrapLimitLamports
  ) {
    throw new Error('realms_provider_actual_cost_cap_exceeded');
  }
}

function publicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error('realms_provider_bootstrap_authority_public_key_invalid');
  }
}
