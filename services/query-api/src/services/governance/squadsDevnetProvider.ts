import { createHash } from 'node:crypto';

import * as squads from '@sqds/multisig';
import {
  Connection,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type MessageV0,
} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildProviderExecutionActionContext,
  type ProviderExecutionActionContext,
} from './providerExecutionActionContext';

async function submitSquadsProviderTransaction(
  connection: Pick<Connection, 'sendRawTransaction'>,
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
      throw new Error('squads_provider_submission_rejected');
    }
    throw error;
  } finally {
    rawTransaction.fill(0);
  }
}

export type SquadsDevnetRole =
  | 'config_authority'
  | 'proposer_member'
  | 'approver_member'
  | 'executor_member'
  | 'fee_payer';

export interface SquadsDevnetContract {
  requestId: string;
  decisionDigest: string;
  actionIntentDigest: string;
  circleId: number;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: 1;
  programId: string;
  treasury: string;
  memoProgram: string;
  memoText: string;
  threshold: 2;
  timeLockSeconds: 0;
  vaultIndex: 0;
  authorities: Record<SquadsDevnetRole, {
    keyRef: string;
    publicKey: string;
    permissionMask: number | null;
  }>;
}

export interface SquadsDevnetLimits {
  singleTransactionLimitLamports: number;
  totalVerticalLimitLamports: number;
  maximumWalletBalanceLamports: number;
  fundingTargetLamports: number;
}

export interface SquadsDevnetSignatureReadback {
  keyRef: string;
  keyVersion: 1;
  publicKey: string;
  signature: Uint8Array;
}

interface SquadsDevnetStepCheckpoint<T extends string = SquadsDevnetStepId> {
  id: T;
  manifestDigest: string;
  status: 'quoted' | 'signed' | 'submitted' | 'finalized';
  messageDigest: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  quoteSlot: number;
  quotedAt: string;
  feeLamports: number;
  authorizedCeilingLamports: number;
  balanceBeforeLamports: number;
  balanceAfterLamports?: number;
  actualSpendLamports?: number;
  signature?: string;
  rawTransactionBase64?: string;
  slot?: number;
  finalityTransitions: Array<{
    state: 'submitted' | 'finalized';
    authority: 'provider_signature_readback' | 'solana_rpc_finalized_transaction';
    slot?: number;
  }>;
}

export interface SquadsDevnetCheckpoint {
  schemaVersion: 1;
  funding: {
    status: 'pending' | 'not_required' | 'submitted' | 'finalized';
    targetBalanceLamports: number;
    balanceLamports: number;
    signature?: string;
  };
  steps: SquadsDevnetStepCheckpoint[];
}

export interface SquadsDevnetProviderReceipt {
  schemaVersion: 1;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: 1;
  planDigest?: string;
  addresses: {
    multisig: string;
    vault: string;
    proposal: string;
    vaultTransaction: string;
  };
  memoTextSha256: string;
  transactions: Array<{
    stepId: SquadsDevnetStepId;
    signature: string;
    slot: number;
    blockhash: string;
    messageDigest: string;
    manifestDigest: string;
    lastValidBlockHeight?: number;
    actionContext?: ProviderExecutionActionContext<SquadsDevnetStepId>;
    feeLamports: number;
    actualSpendLamports: number;
    finalityTransitions: SquadsDevnetStepCheckpoint['finalityTransitions'];
  }>;
  fundingSignature: string | null;
  totalSpendLamports: number;
  finalBalanceLamports: number;
  providerFinality: 'finalized';
}

export interface SquadsExistingDevnetResourceManifest {
  addresses: SquadsDevnetProviderReceipt['addresses'];
  transactions: Array<{
    stepId: SquadsDevnetStepId;
    signature: string;
    slot: number;
  }>;
}

export interface SquadsDevnetAccountGraphReadback {
  schemaVersion: 1;
  status: 'verified_finalized';
  observedSlot: number;
  lastTransactionSlot: number;
  ownerProgramRef: string;
  resourceRef: string;
  accountGraph: SquadsDevnetProviderReceipt['addresses'];
  threshold: 2;
  memberCount: 3;
  memberPermissions: Record<'proposer_member' | 'approver_member' | 'executor_member', number>;
  proposalState: 'executed';
  approvedMemberCount: 2;
  vaultTransactionState: 'executed';
  instructionProgram: string;
  instructionDataSha256: string;
  noRealAssets: true;
  stateDigest: string;
}

export interface SquadsDevnetProviderDependencies {
  connection: Connection;
  verifyTrustProfile(): Promise<void>;
  sign(input: {
    role: SquadsDevnetRole;
    operation: string;
    message: Uint8Array;
  }): Promise<SquadsDevnetSignatureReadback>;
  checkpoint(value: SquadsDevnetCheckpoint): Promise<void>;
}

export function deriveSquadsDevnetAccountGraphStateDigest(
  readback: Omit<SquadsDevnetAccountGraphReadback, 'stateDigest'>,
): string {
  const {
    observedSlot: _observedSlot,
    status: _status,
    ...stateFacts
  } = readback;
  return hashCanonicalGovernanceValue(
    'alcheme.governance.squads-provider-account-graph-readback',
    {
      ...stateFacts,
      // The RPC observation slot proves freshness but is not provider state.
      // Anchor the digest to the finalized effect slot so later readbacks of
      // the same account graph remain identical without weakening readback.
      observedSlot: readback.lastTransactionSlot,
    },
  );
}

export type SquadsDevnetStepId =
  | 'create_multisig'
  | 'create_vault_transaction'
  | 'create_proposal'
  | 'approve_by_proposer'
  | 'approve_by_approver'
  | 'execute_vault_transaction';

type SquadsGrantPayoutStepId =
  | 'payout_create_vault_transaction'
  | 'payout_create_proposal'
  | 'payout_approve_by_proposer'
  | 'payout_approve_by_approver'
  | 'payout_execute_vault_transaction';

export interface SquadsGrantPayoutContract {
  requestId: string;
  decisionDigest: string;
  actionIntentDigest: string;
  circleId: 35;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: 1;
  programId: string;
  multisig: string;
  vault: string;
  transactionIndex: string;
  agreementId: string;
  trancheIntentId: string;
  milestoneResultDigest: string;
  recipient: string;
  amountLamports: string;
  vaultFundingTargetLamports: string;
  authorities: SquadsDevnetContract['authorities'];
}

export interface SquadsGrantPayoutCheckpoint {
  schemaVersion: 1;
  funding: {
    status: 'pending' | 'submitted' | 'finalized';
    source: 'solana_devnet_faucet' | 'existing_finalized_balance';
    targetBalanceLamports: number;
    balanceBeforeLamports: number;
    balanceAfterLamports?: number;
    signature?: string;
    slot?: number;
    faucetAttempt?: {
      attemptedAt: string;
      outcome: 'rate_limited' | 'unavailable';
    };
  };
  recipientBalanceBeforeLamports: number | null;
  steps: Array<SquadsDevnetStepCheckpoint<SquadsGrantPayoutStepId>>;
}

export interface SquadsGrantPayoutReceipt {
  schemaVersion: 1;
  chainId: 'solana:devnet';
  profileRef: string;
  profileVersion: 1;
  agreementId: string;
  trancheIntentId: string;
  milestoneResultDigest: string;
  multisig: string;
  vault: string;
  proposal: string;
  vaultTransaction: string;
  transactionIndex: string;
  recipient: string;
  amountLamports: string;
  fundingSource: 'solana_devnet_faucet' | 'existing_finalized_balance';
  fundingSignature: string | null;
  fundingSlot: number;
  payoutSignature: string;
  payoutSlot: number;
  vaultBalanceBeforeLamports: string;
  vaultBalanceAfterLamports: string;
  recipientBalanceBeforeLamports: string;
  recipientBalanceAfterLamports: string;
  totalFeeAndRentLamports: string;
  providerFinality: 'finalized';
  stateDigest: string;
}

interface SquadsStep<T extends string = SquadsDevnetStepId> {
  id: T;
  signerRoles: SquadsDevnetRole[];
  signerOperations: Partial<Record<SquadsDevnetRole, string>>;
  build(blockhash: string): Promise<VersionedTransaction>;
}

export async function executeSquadsDevnetVertical(
  contract: SquadsDevnetContract,
  limits: SquadsDevnetLimits,
  dependencies: SquadsDevnetProviderDependencies,
  priorCheckpoint?: SquadsDevnetCheckpoint | null,
): Promise<SquadsDevnetProviderReceipt> {
  assertContract(contract);
  assertLimits(limits);
  await dependencies.verifyTrustProfile();
  const connection = dependencies.connection;
  const programId = new PublicKey(contract.programId);
  const feePayer = authorityKey(contract, 'fee_payer');
  const addresses = deriveAddresses(contract);
  const checkpoint = normalizeCheckpoint(priorCheckpoint, limits.fundingTargetLamports);

  let balance = await connection.getBalance(feePayer, 'finalized');
  if (balance > limits.maximumWalletBalanceLamports) {
    throw new Error('squads_provider_fee_payer_balance_cap_exceeded');
  }
  if (balance < limits.fundingTargetLamports) {
    if (checkpoint.funding.status === 'finalized') {
      throw new Error('squads_provider_funding_readback_regressed');
    }
    const amount = limits.fundingTargetLamports - balance;
    let signature: string;
    try {
      signature = await connection.requestAirdrop(feePayer, amount);
    } catch {
      throw new Error('squads_provider_funding_unavailable');
    }
    checkpoint.funding = {
      status: 'submitted',
      targetBalanceLamports: limits.fundingTargetLamports,
      balanceLamports: balance,
      signature,
    };
    await dependencies.checkpoint(cloneCheckpoint(checkpoint));
    const confirmation = await connection.confirmTransaction(signature, 'finalized');
    if (confirmation.value.err) throw new Error('squads_provider_faucet_transaction_failed');
    balance = await connection.getBalance(feePayer, 'finalized');
    if (
      balance < limits.fundingTargetLamports
      || balance > limits.maximumWalletBalanceLamports
    ) throw new Error('squads_provider_faucet_balance_readback_invalid');
    checkpoint.funding = {
      status: 'finalized',
      targetBalanceLamports: limits.fundingTargetLamports,
      balanceLamports: balance,
      signature,
    };
  } else {
    checkpoint.funding = {
      status: 'not_required',
      targetBalanceLamports: limits.fundingTargetLamports,
      balanceLamports: balance,
    };
  }
  await dependencies.checkpoint(cloneCheckpoint(checkpoint));

  const totalSpendLamports = await executeTransactionSteps({
    contract,
    connection,
    feePayer,
    limits,
    steps: buildSteps(contract, connection, addresses),
    checkpoints: checkpoint.steps,
    checkpoint: () => dependencies.checkpoint(cloneCheckpoint(checkpoint)),
    sign: dependencies.sign,
  });

  const finalizedSteps = checkpoint.steps.filter((step) => step.status === 'finalized');
  if (finalizedSteps.length !== 6) throw new Error('squads_provider_finalized_step_inventory_mismatch');
  const memoTextSha256 = createHash('sha256').update(contract.memoText).digest('hex');
  const planDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.squads-devnet-execution-plan-v1',
    {
      actionIntentDigest: contract.actionIntentDigest,
      programId: contract.programId,
      addresses,
      memoTextSha256,
      steps: finalizedSteps.map((step) => ({
        id: step.id,
        manifestDigest: step.manifestDigest,
      })),
    },
  );
  const expectedStateChanges: Record<SquadsDevnetStepId, string> = {
    create_multisig: 'two_of_three_multisig_created',
    create_vault_transaction: 'no_asset_memo_vault_transaction_created',
    create_proposal: 'proposal_created_for_frozen_vault_transaction',
    approve_by_proposer: 'proposer_member_approval_recorded',
    approve_by_approver: 'independent_approver_member_approval_recorded',
    execute_vault_transaction: 'approved_no_asset_vault_transaction_executed',
  };
  const finalBalanceLamports = await connection.getBalance(feePayer, 'finalized');
  if (finalBalanceLamports > limits.maximumWalletBalanceLamports) {
    throw new Error('squads_provider_fee_payer_balance_cap_exceeded');
  }
  return {
    schemaVersion: 1,
    chainId: contract.chainId,
    profileRef: contract.profileRef,
    profileVersion: contract.profileVersion,
    planDigest,
    addresses,
    memoTextSha256,
    transactions: finalizedSteps.map((step) => ({
      stepId: step.id,
      signature: step.signature!,
      slot: step.slot!,
      blockhash: step.recentBlockhash,
      messageDigest: step.messageDigest,
      manifestDigest: step.manifestDigest,
      lastValidBlockHeight: step.lastValidBlockHeight,
      actionContext: buildProviderExecutionActionContext({
        actionIntentDigest: contract.actionIntentDigest,
        planDigest,
        steps: finalizedSteps,
        step,
        expectedStateChange: expectedStateChanges[step.id],
      }),
      feeLamports: step.feeLamports,
      actualSpendLamports: step.actualSpendLamports!,
      finalityTransitions: step.finalityTransitions,
    })),
    fundingSignature: checkpoint.funding.signature ?? null,
    totalSpendLamports,
    finalBalanceLamports,
    providerFinality: 'finalized',
  };
}

export async function executeSquadsGrantPayout(
  contract: SquadsGrantPayoutContract,
  limits: Pick<SquadsDevnetLimits,
    'singleTransactionLimitLamports' | 'totalVerticalLimitLamports' | 'maximumWalletBalanceLamports'>,
  dependencies: Omit<SquadsDevnetProviderDependencies, 'checkpoint'> & {
    checkpoint(value: SquadsGrantPayoutCheckpoint): Promise<void>;
  },
  priorCheckpoint?: SquadsGrantPayoutCheckpoint | null,
): Promise<SquadsGrantPayoutReceipt> {
  assertGrantPayoutContract(contract);
  assertLimits({ ...limits, fundingTargetLamports: Number(contract.vaultFundingTargetLamports) });
  await dependencies.verifyTrustProfile();
  const connection = dependencies.connection;
  const feePayer = authorityKey(contract, 'fee_payer');
  const vault = new PublicKey(contract.vault);
  const recipient = new PublicKey(contract.recipient);
  const amountLamports = Number(contract.amountLamports);
  const fundingTargetLamports = Number(contract.vaultFundingTargetLamports);
  const checkpoint = normalizeGrantPayoutCheckpoint(priorCheckpoint, fundingTargetLamports);
  const currentTransactionIndex = await readSquadsCurrentTransactionIndex(connection, contract);
  const expectedTransactionIndex = BigInt(contract.transactionIndex);
  const createCheckpoint = checkpoint.steps.find(
    (step) => step.id === 'payout_create_vault_transaction',
  );
  const createMayHaveAdvancedIndex = createCheckpoint
    ? ['signed', 'submitted', 'finalized'].includes(createCheckpoint.status)
    : false;
  const transactionIndexMatchesCheckpoint = createCheckpoint?.status === 'finalized'
    ? currentTransactionIndex === expectedTransactionIndex
    : createMayHaveAdvancedIndex
      ? currentTransactionIndex === expectedTransactionIndex - 1n
        || currentTransactionIndex === expectedTransactionIndex
      : currentTransactionIndex === expectedTransactionIndex - 1n;
  if (!transactionIndexMatchesCheckpoint) {
    throw new Error('squads_grant_payout_transaction_index_conflict');
  }

  const feePayerBalance = await connection.getBalance(feePayer, 'finalized');
  if (feePayerBalance > limits.maximumWalletBalanceLamports) {
    throw new Error('squads_provider_fee_payer_balance_cap_exceeded');
  }
  const payoutExecuted = checkpoint.steps.some((step) => (
    step.id === 'payout_execute_vault_transaction' && step.status === 'finalized'
  ));
  let vaultBalance = await connection.getBalance(vault, 'finalized');
  if (checkpoint.funding.status === 'pending') {
    if (vaultBalance === fundingTargetLamports) {
      const fundingSlot = await connection.getSlot('finalized');
      const finalizedBalance = await connection.getBalance(vault, 'finalized');
      if (!Number.isSafeInteger(fundingSlot) || fundingSlot <= 0
        || finalizedBalance !== fundingTargetLamports) {
        throw new Error('squads_grant_payout_existing_funding_readback_invalid');
      }
      checkpoint.funding = {
        status: 'finalized',
        source: 'existing_finalized_balance',
        targetBalanceLamports: fundingTargetLamports,
        balanceBeforeLamports: vaultBalance,
        balanceAfterLamports: finalizedBalance,
        slot: fundingSlot,
      };
      await dependencies.checkpoint(structuredClone(checkpoint));
    } else {
      if (vaultBalance !== 0) throw new Error('squads_grant_payout_unattributed_funding_detected');
      if (checkpoint.funding.faucetAttempt) {
        // The public faucet is environmental bootstrap only.  A prior failed
        // attempt is retained in the canonical checkpoint so the reconciler
        // can continue the same Request without repeatedly asking the faucet.
        throw new Error('squads_grant_payout_funding_external_pending');
      }
      let signature: string;
      try {
        signature = await connection.requestAirdrop(vault, fundingTargetLamports);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        const outcome = message.includes('429') || message.includes('rate limit')
          ? 'rate_limited' as const
          : 'unavailable' as const;
        checkpoint.funding = {
          ...checkpoint.funding,
          faucetAttempt: { attemptedAt: new Date().toISOString(), outcome },
        };
        await dependencies.checkpoint(structuredClone(checkpoint));
        throw new Error(outcome === 'rate_limited'
          ? 'squads_grant_payout_funding_rate_limited'
          : 'squads_grant_payout_funding_unavailable');
      }
      checkpoint.funding = {
        ...checkpoint.funding,
        source: 'solana_devnet_faucet',
        status: 'submitted',
        signature,
      };
      await dependencies.checkpoint(structuredClone(checkpoint));
    }
  }
  if (checkpoint.funding.status === 'submitted') {
    if (!checkpoint.funding.signature) throw new Error('squads_grant_payout_funding_signature_missing');
    const confirmation = await connection.confirmTransaction(checkpoint.funding.signature, 'finalized');
    if (confirmation.value.err) throw new Error('squads_grant_payout_funding_failed');
    const transaction = await connection.getTransaction(checkpoint.funding.signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    vaultBalance = await connection.getBalance(vault, 'finalized');
    if (!transaction || transaction.meta?.err || vaultBalance !== fundingTargetLamports) {
      throw new Error('squads_grant_payout_funding_readback_invalid');
    }
    checkpoint.funding = {
      ...checkpoint.funding,
      status: 'finalized',
      balanceAfterLamports: vaultBalance,
      slot: transaction.slot,
    };
    await dependencies.checkpoint(structuredClone(checkpoint));
  }
  const expectedCurrentVaultBalance = payoutExecuted
    ? fundingTargetLamports - amountLamports
    : fundingTargetLamports;
  vaultBalance = await connection.getBalance(vault, 'finalized');
  if (
    checkpoint.funding.status !== 'finalized'
    || (checkpoint.funding.source === 'solana_devnet_faucet' && !checkpoint.funding.signature)
    || !checkpoint.funding.slot
    || vaultBalance !== expectedCurrentVaultBalance
  ) throw new Error('squads_grant_payout_vault_balance_conflict');
  if (checkpoint.recipientBalanceBeforeLamports === null) {
    checkpoint.recipientBalanceBeforeLamports = await connection.getBalance(recipient, 'finalized');
    await dependencies.checkpoint(structuredClone(checkpoint));
  }

  const addresses = deriveSquadsGrantPayoutAddresses(contract);
  const totalSpendLamports = await executeTransactionSteps({
    contract,
    connection,
    feePayer,
    limits,
    steps: buildGrantPayoutSteps(contract, connection, addresses),
    checkpoints: checkpoint.steps,
    checkpoint: () => dependencies.checkpoint(structuredClone(checkpoint)),
    sign: dependencies.sign,
  });
  if (checkpoint.steps.length !== 5 || checkpoint.steps.some((step) => step.status !== 'finalized')) {
    throw new Error('squads_grant_payout_finalized_step_inventory_mismatch');
  }
  const last = checkpoint.steps.find((step) => step.id === 'payout_execute_vault_transaction');
  if (!last?.signature || !last.slot) throw new Error('squads_grant_payout_finalized_signature_missing');
  const [vaultBalanceAfterLamports, recipientBalanceAfterLamports] = await Promise.all([
    connection.getBalance(vault, 'finalized'),
    connection.getBalance(recipient, 'finalized'),
  ]);
  if (
    vaultBalanceAfterLamports !== fundingTargetLamports - amountLamports
    || recipientBalanceAfterLamports !== checkpoint.recipientBalanceBeforeLamports + amountLamports
  ) throw new Error('squads_grant_payout_balance_readback_mismatch');
  const observedSlot = await readSquadsGrantPayoutFinalizedState(connection, contract, addresses, last);
  const facts = {
    schemaVersion: 1 as const,
    chainId: contract.chainId,
    profileRef: contract.profileRef,
    profileVersion: contract.profileVersion,
    agreementId: contract.agreementId,
    trancheIntentId: contract.trancheIntentId,
    milestoneResultDigest: contract.milestoneResultDigest,
    multisig: contract.multisig,
    vault: contract.vault,
    proposal: addresses.proposal,
    vaultTransaction: addresses.vaultTransaction,
    transactionIndex: contract.transactionIndex,
    recipient: contract.recipient,
    amountLamports: contract.amountLamports,
    fundingSource: checkpoint.funding.source,
    fundingSignature: checkpoint.funding.signature ?? null,
    fundingSlot: checkpoint.funding.slot,
    payoutSignature: last.signature,
    payoutSlot: last.slot,
    vaultBalanceBeforeLamports: contract.vaultFundingTargetLamports,
    vaultBalanceAfterLamports: String(vaultBalanceAfterLamports),
    recipientBalanceBeforeLamports: String(checkpoint.recipientBalanceBeforeLamports),
    recipientBalanceAfterLamports: String(recipientBalanceAfterLamports),
    totalFeeAndRentLamports: String(totalSpendLamports),
    providerFinality: 'finalized' as const,
  };
  return {
    ...facts,
    stateDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.squads-grant-payout-finalized-state-v1',
      { ...facts, observedSlot },
    ),
  };
}

export async function readNextSquadsGrantPayoutTransactionIndex(
  connection: Connection,
  input: { programId: string; multisig: string },
): Promise<string> {
  const programId = new PublicKey(input.programId);
  const multisigKey = new PublicKey(input.multisig);
  const account = await connection.getAccountInfo(multisigKey, 'finalized');
  if (!account || !account.owner.equals(programId)) {
    throw new Error('squads_grant_payout_multisig_owner_mismatch');
  }
  const [multisig] = squads.generated.Multisig.fromAccountInfo(account);
  return (BigInt(multisig.transactionIndex.toString()) + 1n).toString();
}

export async function readSquadsDevnetAccountGraph(
  connection: Connection,
  contract: SquadsDevnetContract,
  receipt: SquadsDevnetProviderReceipt,
): Promise<SquadsDevnetAccountGraphReadback> {
  const programId = new PublicKey(contract.programId);
  const addresses = receipt.addresses;
  const keys = [addresses.multisig, addresses.proposal, addresses.vaultTransaction]
    .map((value) => new PublicKey(value));
  const readback = await connection.getMultipleAccountsInfoAndContext(keys, {
    commitment: 'finalized',
  });
  if (
    readback.value.length !== 3
    || readback.value.some((account) => !account || !account.owner.equals(programId))
  ) throw new Error('squads_provider_account_graph_owner_mismatch');
  const [multisigAccount, proposalAccount, transactionAccount] = readback.value as NonNullable<typeof readback.value[number]>[];
  const [multisig] = squads.generated.Multisig.fromAccountInfo(multisigAccount);
  const [proposal] = squads.generated.Proposal.fromAccountInfo(proposalAccount);
  const [vaultTransaction] = squads.generated.VaultTransaction.fromAccountInfo(transactionAccount);
  const expectedMembers = new Map([
    ['proposer_member', contract.authorities.proposer_member],
    ['approver_member', contract.authorities.approver_member],
    ['executor_member', contract.authorities.executor_member],
  ] as const);
  const actualMembers = new Map(multisig.members.map((member) => [
    member.key.toBase58(),
    member.permissions.mask,
  ]));
  const expectedApproved = new Set([
    contract.authorities.proposer_member.publicKey,
    contract.authorities.approver_member.publicKey,
  ]);
  const instruction = vaultTransaction.message.instructions[0];
  const instructionProgram = instruction
    ? vaultTransaction.message.accountKeys[instruction.programIdIndex]?.toBase58()
    : null;
  const instructionData = Buffer.from(instruction?.data ?? []);
  const last = receipt.transactions[receipt.transactions.length - 1];
  const execution = await connection.getTransaction(last.signature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  });
  const logs = execution?.meta?.logMessages ?? [];
  if (
    multisig.threshold !== 2
    || multisig.timeLock !== 0
    || multisig.configAuthority.toBase58() !== contract.authorities.config_authority.publicKey
    || multisig.members.length !== 3
    || [...expectedMembers.values()].some((member) => actualMembers.get(member.publicKey) !== member.permissionMask)
    || proposal.multisig.toBase58() !== addresses.multisig
    || proposal.transactionIndex.toString() !== '1'
    || proposal.status.__kind !== 'Executed'
    || proposal.approved.length !== 2
    || proposal.approved.some((member) => !expectedApproved.has(member.toBase58()))
    || proposal.rejected.length !== 0
    || proposal.cancelled.length !== 0
    || vaultTransaction.multisig.toBase58() !== addresses.multisig
    || vaultTransaction.creator.toBase58() !== contract.authorities.proposer_member.publicKey
    || vaultTransaction.index.toString() !== '1'
    || vaultTransaction.vaultIndex !== 0
    || vaultTransaction.message.instructions.length !== 1
    || instructionProgram !== contract.memoProgram
    || instruction?.accountIndexes.length !== 0
    || instructionData.toString('utf8') !== contract.memoText
    || !vaultTransaction.message.accountKeys[0]?.equals(new PublicKey(addresses.vault))
    || !execution
    || execution.meta?.err
    || execution.slot !== last.slot
    || !logs.some((line) => line.includes(contract.memoProgram))
    || !logs.some((line) => line.includes(contract.memoText))
  ) throw new Error('squads_provider_account_graph_state_mismatch');
  const facts: Omit<SquadsDevnetAccountGraphReadback, 'stateDigest'> = {
    schemaVersion: 1 as const,
    status: 'verified_finalized',
    observedSlot: readback.context.slot,
    lastTransactionSlot: last.slot,
    ownerProgramRef: contract.programId,
    resourceRef: addresses.multisig,
    accountGraph: addresses,
    threshold: 2 as const,
    memberCount: 3 as const,
    memberPermissions: {
      proposer_member: contract.authorities.proposer_member.permissionMask!,
      approver_member: contract.authorities.approver_member.permissionMask!,
      executor_member: contract.authorities.executor_member.permissionMask!,
    },
    proposalState: 'executed' as const,
    approvedMemberCount: 2 as const,
    vaultTransactionState: 'executed' as const,
    instructionProgram: contract.memoProgram,
    instructionDataSha256: createHash('sha256').update(instructionData).digest('hex'),
    noRealAssets: true as const,
  };
  return {
    ...facts,
    stateDigest: deriveSquadsDevnetAccountGraphStateDigest(facts),
  };
}

/**
 * Independently reconstructs the receipt for an already-finalized Squads
 * resource. This is a read-only continuity path: it never submits, signs, or
 * simulates a transaction, and it accepts only the same six-step account graph
 * used by the canonical Squads writer.
 */
export async function readExistingSquadsDevnetResource(
  connection: Connection,
  contract: SquadsDevnetContract,
  manifest: SquadsExistingDevnetResourceManifest,
): Promise<{
  providerReceipt: SquadsDevnetProviderReceipt;
  accountGraph: SquadsDevnetAccountGraphReadback;
}> {
  assertContract(contract);
  const derived = deriveAddresses(contract);
  if (
    manifest.addresses.multisig !== derived.multisig
    || manifest.addresses.vault !== derived.vault
    || manifest.addresses.proposal !== derived.proposal
    || manifest.addresses.vaultTransaction !== derived.vaultTransaction
  ) throw new Error('squads_provider_adoption_address_contract_mismatch');
  const expectedSteps: SquadsDevnetStepId[] = [
    'create_multisig',
    'create_vault_transaction',
    'create_proposal',
    'approve_by_proposer',
    'approve_by_approver',
    'execute_vault_transaction',
  ];
  if (
    manifest.transactions.length !== expectedSteps.length
    || manifest.transactions.some((transaction, index) => (
      transaction.stepId !== expectedSteps[index]
      || typeof transaction.signature !== 'string'
      || transaction.signature.length < 64
      || !Number.isSafeInteger(transaction.slot)
      || transaction.slot <= 0
      || (index > 0 && transaction.slot <= manifest.transactions[index - 1].slot)
    ))
  ) throw new Error('squads_provider_adoption_transaction_manifest_invalid');

  const expectedSignerRoles: Record<SquadsDevnetStepId, SquadsDevnetRole[]> = {
    create_multisig: ['fee_payer', 'config_authority'],
    create_vault_transaction: ['fee_payer', 'proposer_member'],
    create_proposal: ['fee_payer', 'proposer_member'],
    approve_by_proposer: ['fee_payer', 'proposer_member'],
    approve_by_approver: ['fee_payer', 'approver_member'],
    execute_vault_transaction: ['fee_payer', 'executor_member'],
  };
  const programId = new PublicKey(contract.programId).toBase58();
  const expectedTransactions = new Map(buildSteps(contract, connection, derived).map((entry) => [entry.id, entry]));
  const transactions: SquadsDevnetProviderReceipt['transactions'] = [];
  let totalSpendLamports = 0;
  for (const frozen of manifest.transactions) {
    const observed = await connection.getTransaction(frozen.signature, {
      commitment: 'finalized',
      maxSupportedTransactionVersion: 0,
    });
    const message = observed?.transaction.message as MessageV0 | undefined;
    const meta = observed?.meta;
    if (!observed || !message || !meta || meta.err || observed.slot !== frozen.slot) {
      throw new Error('squads_provider_adoption_finalized_transaction_mismatch');
    }
    const requiredSigners = message.staticAccountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
    const expectedSigners = expectedSignerRoles[frozen.stepId]
      .map((role) => contract.authorities[role].publicKey);
    if (
      requiredSigners.length !== expectedSigners.length
      || requiredSigners.some((key) => !expectedSigners.includes(key))
      || !message.staticAccountKeys.some((key) => key.toBase58() === programId)
      || meta.preBalances.length === 0
      || meta.postBalances.length === 0
      || message.staticAccountKeys[0]?.toBase58() !== contract.authorities.fee_payer.publicKey
    ) throw new Error('squads_provider_adoption_transaction_authority_mismatch');
    const expectedStep = expectedTransactions.get(frozen.stepId);
    const expectedTransaction = expectedStep
      ? await expectedStep.build(message.recentBlockhash)
      : null;
    if (
      !expectedTransaction
      || transactionManifestDigest(expectedTransaction) !== messageManifestDigest(message)
    ) throw new Error('squads_provider_adoption_transaction_template_mismatch');
    const actualSpendLamports = meta.preBalances[0] - meta.postBalances[0];
    if (!Number.isSafeInteger(actualSpendLamports) || actualSpendLamports < meta.fee) {
      throw new Error('squads_provider_adoption_transaction_cost_readback_invalid');
    }
    totalSpendLamports += actualSpendLamports;
    transactions.push({
      stepId: frozen.stepId,
      signature: frozen.signature,
      slot: frozen.slot,
      blockhash: message.recentBlockhash,
      messageDigest: createHash('sha256').update(message.serialize()).digest('hex'),
      manifestDigest: messageManifestDigest(message),
      feeLamports: meta.fee,
      actualSpendLamports,
      finalityTransitions: [{
        state: 'finalized',
        authority: 'solana_rpc_finalized_transaction',
        slot: frozen.slot,
      }],
    });
  }
  const finalBalanceLamports = await connection.getBalance(
    new PublicKey(contract.authorities.fee_payer.publicKey),
    'finalized',
  );
  const providerReceipt: SquadsDevnetProviderReceipt = {
    schemaVersion: 1,
    chainId: contract.chainId,
    profileRef: contract.profileRef,
    profileVersion: contract.profileVersion,
    addresses: { ...manifest.addresses },
    memoTextSha256: createHash('sha256').update(contract.memoText).digest('hex'),
    transactions,
    fundingSignature: null,
    totalSpendLamports,
    finalBalanceLamports,
    providerFinality: 'finalized',
  };
  const accountGraph = await readSquadsDevnetAccountGraph(connection, contract, providerReceipt);
  return { providerReceipt, accountGraph };
}

export function createSquadsDevnetConnection(endpoint: string, timeoutMs: number): Connection {
  return new Connection(endpoint, {
    commitment: 'finalized',
    disableRetryOnRateLimit: true,
    fetch: async (input: any, init: any) => fetch(input, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    }),
  });
}

export function validSquadsDevnetCheckpoint(value: unknown): value is SquadsDevnetCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checkpoint = value as SquadsDevnetCheckpoint;
  return checkpoint.schemaVersion === 1
    && !!checkpoint.funding
    && Array.isArray(checkpoint.steps)
    && checkpoint.steps.every((step) => (
      typeof step.id === 'string'
      && /^[a-f0-9]{64}$/.test(step.manifestDigest)
      && /^[a-f0-9]{64}$/.test(step.messageDigest)
      && Array.isArray(step.finalityTransitions)
    ));
}

function buildSteps(
  contract: SquadsDevnetContract,
  connection: Connection,
  addresses: SquadsDevnetProviderReceipt['addresses'],
): SquadsStep[] {
  const programId = new PublicKey(contract.programId);
  const feePayer = authorityKey(contract, 'fee_payer');
  const configAuthority = authorityKey(contract, 'config_authority');
  const proposer = authorityKey(contract, 'proposer_member');
  const approver = authorityKey(contract, 'approver_member');
  const executor = authorityKey(contract, 'executor_member');
  const multisigPda = new PublicKey(addresses.multisig);
  const vault = new PublicKey(addresses.vault);
  const members = [
    {
      key: proposer,
      permissions: squads.types.Permissions.fromPermissions([
        squads.types.Permission.Initiate,
        squads.types.Permission.Vote,
      ]),
    },
    {
      key: approver,
      permissions: squads.types.Permissions.fromPermissions([squads.types.Permission.Vote]),
    },
    {
      key: executor,
      permissions: squads.types.Permissions.fromPermissions([squads.types.Permission.Execute]),
    },
  ];
  return [
    step('create_multisig', ['fee_payer', 'config_authority'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      config_authority: 'create_multisig',
    }, async (blockhash) => squads.transactions.multisigCreateV2({
      blockhash,
      treasury: new PublicKey(contract.treasury),
      configAuthority,
      createKey: configAuthority,
      creator: feePayer,
      multisigPda,
      threshold: contract.threshold,
      members,
      timeLock: contract.timeLockSeconds,
      rentCollector: null,
      memo: `Alcheme Circle ${contract.circleId} Devnet 2-of-3`,
      programId,
    })),
    step('create_vault_transaction', ['fee_payer', 'proposer_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      proposer_member: 'create_vault_transaction',
    }, async (blockhash) => squads.transactions.vaultTransactionCreate({
      blockhash,
      feePayer,
      multisigPda,
      transactionIndex: 1n,
      creator: proposer,
      rentPayer: feePayer,
      vaultIndex: contract.vaultIndex,
      ephemeralSigners: 0,
      transactionMessage: new TransactionMessage({
        payerKey: vault,
        recentBlockhash: blockhash,
        instructions: [new TransactionInstruction({
          programId: new PublicKey(contract.memoProgram),
          keys: [],
          data: Buffer.from(contract.memoText, 'utf8'),
        })],
      }),
      memo: `Alcheme request ${contract.requestId}`,
      programId,
    })),
    step('create_proposal', ['fee_payer', 'proposer_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      proposer_member: 'create_proposal',
    }, async (blockhash) => squads.transactions.proposalCreate({
      blockhash,
      feePayer,
      multisigPda,
      transactionIndex: 1n,
      creator: proposer,
      rentPayer: feePayer,
      isDraft: false,
      programId,
    })),
    step('approve_by_proposer', ['fee_payer', 'proposer_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      proposer_member: 'approve_proposal',
    }, async (blockhash) => squads.transactions.proposalApprove({
      blockhash,
      feePayer,
      multisigPda,
      transactionIndex: 1n,
      member: proposer,
      programId,
    })),
    step('approve_by_approver', ['fee_payer', 'approver_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      approver_member: 'approve_proposal',
    }, async (blockhash) => squads.transactions.proposalApprove({
      blockhash,
      feePayer,
      multisigPda,
      transactionIndex: 1n,
      member: approver,
      programId,
    })),
    step('execute_vault_transaction', ['fee_payer', 'executor_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      executor_member: 'execute_vault_transaction',
    }, async (blockhash) => squads.transactions.vaultTransactionExecute({
      connection,
      blockhash,
      feePayer,
      multisigPda,
      transactionIndex: 1n,
      member: executor,
      programId,
    })),
  ];
}

function step<T extends string>(
  id: T,
  signerRoles: SquadsDevnetRole[],
  signerOperations: Partial<Record<SquadsDevnetRole, string>>,
  build: SquadsStep<T>['build'],
): SquadsStep<T> {
  return { id, signerRoles, signerOperations, build };
}

function deriveAddresses(contract: SquadsDevnetContract): SquadsDevnetProviderReceipt['addresses'] {
  const programId = new PublicKey(contract.programId);
  const [multisig] = squads.getMultisigPda({
    createKey: authorityKey(contract, 'config_authority'),
    programId,
  });
  return {
    multisig: multisig.toBase58(),
    vault: squads.getVaultPda({ multisigPda: multisig, index: 0, programId })[0].toBase58(),
    proposal: squads.getProposalPda({
      multisigPda: multisig,
      transactionIndex: 1n,
      programId,
    })[0].toBase58(),
    vaultTransaction: squads.getTransactionPda({
      multisigPda: multisig,
      index: 1n,
      programId,
    })[0].toBase58(),
  };
}

function transactionManifestDigest(transaction: VersionedTransaction): string {
  return messageManifestDigest(transaction.message as MessageV0);
}

function messageManifestDigest(message: MessageV0): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.squads-provider-instruction-manifest',
    {
      header: message.header,
      staticAccountKeys: message.staticAccountKeys.map((key) => key.toBase58()),
      compiledInstructions: message.compiledInstructions.map((instruction) => ({
        programIdIndex: instruction.programIdIndex,
        accountKeyIndexes: [...instruction.accountKeyIndexes],
        dataSha256: createHash('sha256').update(instruction.data).digest('hex'),
      })),
      addressTableLookups: message.addressTableLookups.map((lookup) => ({
        accountKey: lookup.accountKey.toBase58(),
        writableIndexes: [...lookup.writableIndexes],
        readonlyIndexes: [...lookup.readonlyIndexes],
      })),
    },
  );
}

function assertRequiredSigners(
  transaction: VersionedTransaction,
  roles: SquadsDevnetRole[],
  contract: Pick<SquadsDevnetContract, 'authorities'>,
): void {
  const message = transaction.message as MessageV0;
  const actual = new Set(message.staticAccountKeys
    .slice(0, message.header.numRequiredSignatures)
    .map((key) => key.toBase58()));
  const expected = new Set(roles.map((role) => contract.authorities[role].publicKey));
  if (actual.size !== expected.size || [...actual].some((key) => !expected.has(key))) {
    throw new Error('squads_provider_required_signer_contract_mismatch');
  }
}

function addVerifiedSignature(
  transaction: VersionedTransaction,
  contract: Pick<SquadsDevnetContract, 'authorities'>,
  role: SquadsDevnetRole,
  readback: SquadsDevnetSignatureReadback,
): void {
  const expected = contract.authorities[role];
  const message = transaction.message.serialize();
  if (
    readback.keyRef !== expected.keyRef
    || readback.keyVersion !== 1
    || readback.publicKey !== expected.publicKey
    || readback.signature.length !== nacl.sign.signatureLength
    || !nacl.sign.detached.verify(
      message,
      readback.signature,
      new PublicKey(expected.publicKey).toBytes(),
    )
  ) throw new Error('squads_provider_transit_signature_mismatch');
  const messageV0 = transaction.message as MessageV0;
  const signerIndex = messageV0.staticAccountKeys
    .slice(0, messageV0.header.numRequiredSignatures)
    .findIndex((key) => key.toBase58() === expected.publicKey);
  if (signerIndex < 0) throw new Error('squads_provider_signature_target_missing');
  transaction.signatures[signerIndex] = Uint8Array.from(readback.signature);
}

async function finalizeSubmittedStep<T extends string>(
  connection: Connection,
  feePayer: PublicKey,
  checkpoint: SquadsDevnetStepCheckpoint<T>,
): Promise<{ actualSpendLamports: number }> {
  if (!checkpoint.signature) throw new Error('squads_provider_submitted_signature_missing');
  if (checkpoint.status === 'signed') {
    if (!checkpoint.rawTransactionBase64) throw new Error('squads_provider_signed_transaction_missing');
    const raw = Buffer.from(checkpoint.rawTransactionBase64, 'base64');
    const submitted = await submitSquadsProviderTransaction(connection, raw);
    if (submitted !== checkpoint.signature) throw new Error('squads_provider_signature_readback_mismatch');
    checkpoint.status = 'submitted';
    checkpoint.finalityTransitions.push({
      state: 'submitted',
      authority: 'provider_signature_readback',
    });
  }
  const confirmed = await connection.confirmTransaction({
    signature: checkpoint.signature,
    blockhash: checkpoint.recentBlockhash,
    lastValidBlockHeight: checkpoint.lastValidBlockHeight,
  }, 'finalized');
  if (confirmed.value.err) throw new Error('squads_provider_transaction_failed');
  const transaction = await connection.getTransaction(checkpoint.signature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction || transaction.meta?.err) throw new Error('squads_provider_finalized_readback_missing');
  const balanceAfterLamports = await connection.getBalance(feePayer, 'finalized');
  const actualSpendLamports = checkpoint.balanceBeforeLamports - balanceAfterLamports;
  if (!Number.isSafeInteger(actualSpendLamports) || actualSpendLamports < 0) {
    throw new Error('squads_provider_actual_spend_invalid');
  }
  checkpoint.status = 'finalized';
  checkpoint.slot = transaction.slot;
  checkpoint.balanceAfterLamports = balanceAfterLamports;
  checkpoint.actualSpendLamports = actualSpendLamports;
  checkpoint.finalityTransitions.push({
    state: 'finalized',
    authority: 'solana_rpc_finalized_transaction',
    slot: transaction.slot,
  });
  delete checkpoint.rawTransactionBase64;
  return { actualSpendLamports };
}

function normalizeCheckpoint(
  value: SquadsDevnetCheckpoint | null | undefined,
  fundingTargetLamports: number,
): SquadsDevnetCheckpoint {
  if (value) {
    if (!validSquadsDevnetCheckpoint(value)) throw new Error('squads_provider_checkpoint_invalid');
    return cloneCheckpoint(value);
  }
  return {
    schemaVersion: 1,
    funding: {
      status: 'pending',
      targetBalanceLamports: fundingTargetLamports,
      balanceLamports: 0,
    },
    steps: [],
  };
}

function cloneCheckpoint(value: SquadsDevnetCheckpoint): SquadsDevnetCheckpoint {
  return structuredClone(value);
}

async function executeTransactionSteps<T extends string>(input: {
  contract: Pick<SquadsDevnetContract, 'authorities'>;
  connection: Connection;
  feePayer: PublicKey;
  limits: Pick<SquadsDevnetLimits, 'singleTransactionLimitLamports' | 'totalVerticalLimitLamports'>;
  steps: Array<SquadsStep<T>>;
  checkpoints: Array<SquadsDevnetStepCheckpoint<T>>;
  checkpoint(): Promise<void>;
  sign: SquadsDevnetProviderDependencies['sign'];
}): Promise<number> {
  let totalSpendLamports = input.checkpoints
    .filter((entry) => entry.status === 'finalized')
    .reduce((sum, entry) => sum + (entry.actualSpendLamports ?? 0), 0);
  for (const step of input.steps) {
    const previous = input.checkpoints.find((candidate) => candidate.id === step.id);
    if (previous?.status === 'finalized') continue;
    if (previous && ['signed', 'submitted'].includes(previous.status)) {
      const resumed = await finalizeSubmittedStep(input.connection, input.feePayer, previous);
      totalSpendLamports += resumed.actualSpendLamports;
      assertSpend(resumed.actualSpendLamports, totalSpendLamports, input.limits);
      await input.checkpoint();
      continue;
    }

    const [latest, quoteSlot] = await Promise.all([
      input.connection.getLatestBlockhash('finalized'),
      input.connection.getSlot('finalized'),
    ]);
    const quotedAt = new Date().toISOString();
    const transaction = await step.build(latest.blockhash);
    const manifestDigest = transactionManifestDigest(transaction);
    if (previous && previous.manifestDigest !== manifestDigest) {
      throw new Error('squads_provider_attempt_manifest_conflict');
    }
    assertRequiredSigners(transaction, step.signerRoles, input.contract);
    const balanceBeforeLamports = await input.connection.getBalance(input.feePayer, 'finalized');
    const feeQuote = await input.connection.getFeeForMessage(transaction.message, 'finalized');
    if (feeQuote.value === null || !Number.isSafeInteger(feeQuote.value) || feeQuote.value < 0) {
      throw new Error('squads_provider_fee_quote_invalid');
    }
    const simulation = await input.connection.simulateTransaction(transaction, {
      commitment: 'finalized',
      sigVerify: false,
      accounts: { encoding: 'base64', addresses: [input.feePayer.toBase58()] },
    });
    const simulatedPayer = simulation.value.accounts?.[0];
    if (simulation.value.err || !simulatedPayer || !Number.isSafeInteger(simulatedPayer.lamports)) {
      throw new Error('squads_provider_preflight_simulation_failed');
    }
    const simulatedSpend = balanceBeforeLamports - simulatedPayer.lamports;
    if (
      simulatedSpend < feeQuote.value
      || simulatedSpend > input.limits.singleTransactionLimitLamports
      || totalSpendLamports + simulatedSpend > input.limits.totalVerticalLimitLamports
    ) throw new Error('squads_provider_preflight_cost_cap_exceeded');

    const messageBytes = transaction.message.serialize();
    const current: SquadsDevnetStepCheckpoint<T> = {
      id: step.id,
      manifestDigest,
      status: 'quoted',
      messageDigest: createHash('sha256').update(messageBytes).digest('hex'),
      recentBlockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      quoteSlot,
      quotedAt,
      feeLamports: feeQuote.value,
      authorizedCeilingLamports: simulatedSpend,
      balanceBeforeLamports,
      finalityTransitions: [],
    };
    if (previous) Object.assign(previous, current);
    else input.checkpoints.push(current);
    await input.checkpoint();

    for (const role of step.signerRoles) {
      const operation = step.signerOperations[role];
      if (!operation) throw new Error('squads_provider_signer_operation_missing');
      const readback = await input.sign({ role, operation, message: messageBytes });
      addVerifiedSignature(transaction, input.contract, role, readback);
    }
    if (transaction.signatures.some((signature) => signature.every((byte) => byte === 0))) {
      throw new Error('squads_provider_transaction_signature_inventory_incomplete');
    }
    const raw = Buffer.from(transaction.serialize());
    const signature = bs58.encode(transaction.signatures[0]);
    current.status = 'signed';
    current.signature = signature;
    current.rawTransactionBase64 = raw.toString('base64');
    await input.checkpoint();
    const submitted = await submitSquadsProviderTransaction(input.connection, raw);
    if (submitted !== signature) throw new Error('squads_provider_signature_readback_mismatch');
    current.status = 'submitted';
    current.finalityTransitions.push({
      state: 'submitted',
      authority: 'provider_signature_readback',
    });
    await input.checkpoint();
    const finalized = await finalizeSubmittedStep(input.connection, input.feePayer, current);
    totalSpendLamports += finalized.actualSpendLamports;
    assertSpend(finalized.actualSpendLamports, totalSpendLamports, input.limits);
    await input.checkpoint();
  }
  return totalSpendLamports;
}

function authorityKey(
  contract: Pick<SquadsDevnetContract, 'authorities'>,
  role: SquadsDevnetRole,
): PublicKey {
  return new PublicKey(contract.authorities[role].publicKey);
}

function normalizeGrantPayoutCheckpoint(
  value: SquadsGrantPayoutCheckpoint | null | undefined,
  fundingTargetLamports: number,
): SquadsGrantPayoutCheckpoint {
  if (value) {
    const funding = value.funding;
    const signatureValid = typeof funding?.signature === 'string'
      && funding.signature.length >= 64
      && funding.signature.length <= 100;
    const slotValid = Number.isSafeInteger(funding?.slot) && Number(funding.slot) > 0;
    const exactBalanceAfterReadback = funding?.balanceAfterLamports === fundingTargetLamports;
    const faucetAttempt = funding?.faucetAttempt;
    const faucetAttemptValid = faucetAttempt === undefined || (
      funding?.status === 'pending'
      && funding.source === 'solana_devnet_faucet'
      && typeof faucetAttempt?.attemptedAt === 'string'
      && Number.isFinite(Date.parse(faucetAttempt.attemptedAt))
      && (faucetAttempt.outcome === 'rate_limited' || faucetAttempt.outcome === 'unavailable')
    );
    const fundingStateValid = (
      funding?.status === 'pending'
      && funding.source === 'solana_devnet_faucet'
      && funding.balanceBeforeLamports === 0
      && funding.signature === undefined
      && funding.slot === undefined
      && funding.balanceAfterLamports === undefined
    ) || (
      funding?.status === 'submitted'
      && funding.source === 'solana_devnet_faucet'
      && funding.balanceBeforeLamports === 0
      && signatureValid
      && funding.slot === undefined
      && funding.balanceAfterLamports === undefined
    ) || (
      funding?.status === 'finalized'
      && funding.source === 'solana_devnet_faucet'
      && funding.balanceBeforeLamports === 0
      && exactBalanceAfterReadback
      && signatureValid
      && slotValid
    ) || (
      funding?.status === 'finalized'
      && funding.source === 'existing_finalized_balance'
      && funding.balanceBeforeLamports === fundingTargetLamports
      && exactBalanceAfterReadback
      && funding.signature === undefined
      && slotValid
    );
    if (
      value.schemaVersion !== 1
      || !fundingStateValid
      || !faucetAttemptValid
      || funding.targetBalanceLamports !== fundingTargetLamports
      || (value.recipientBalanceBeforeLamports !== null
        && (!Number.isSafeInteger(value.recipientBalanceBeforeLamports)
          || value.recipientBalanceBeforeLamports < 0))
      || !Array.isArray(value.steps)
      || value.steps.some((step) => !/^[a-f0-9]{64}$/.test(step.manifestDigest))
    ) throw new Error('squads_grant_payout_checkpoint_invalid');
    return structuredClone(value);
  }
  return {
    schemaVersion: 1,
    funding: {
      status: 'pending',
      source: 'solana_devnet_faucet',
      targetBalanceLamports: fundingTargetLamports,
      balanceBeforeLamports: 0,
    },
    recipientBalanceBeforeLamports: null,
    steps: [],
  };
}

function assertGrantPayoutContract(contract: SquadsGrantPayoutContract): void {
  const amount = Number(contract.amountLamports);
  const fundingTarget = Number(contract.vaultFundingTargetLamports);
  const transactionIndex = Number(contract.transactionIndex);
  const addresses = [
    contract.programId,
    contract.multisig,
    contract.vault,
    contract.recipient,
    ...Object.values(contract.authorities).map((authority) => authority.publicKey),
  ].map((value) => new PublicKey(value).toBase58());
  const authorityAddresses = addresses.slice(4);
  if (
    contract.circleId !== 35
    || contract.chainId !== 'solana:devnet'
    || contract.profileVersion !== 1
    || !/^gov_req_[a-f0-9]{56}$/.test(contract.requestId)
    || !/^[a-f0-9]{64}$/.test(contract.decisionDigest)
    || !/^[a-f0-9]{64}$/.test(contract.actionIntentDigest)
    || !/^[a-f0-9]{64}$/.test(contract.milestoneResultDigest)
    || !contract.agreementId
    || !contract.trancheIntentId
    || !Number.isSafeInteger(amount)
    || amount <= 0
    || !Number.isSafeInteger(fundingTarget)
    || fundingTarget <= amount
    || !Number.isSafeInteger(transactionIndex)
    || transactionIndex < 2
    || new Set(authorityAddresses).size !== authorityAddresses.length
    || authorityAddresses.includes(contract.recipient)
    || contract.recipient === contract.vault
    || contract.recipient === contract.multisig
  ) throw new Error('squads_grant_payout_contract_invalid');
}

async function readSquadsCurrentTransactionIndex(
  connection: Connection,
  contract: SquadsGrantPayoutContract,
): Promise<bigint> {
  const programId = new PublicKey(contract.programId);
  const multisigKey = new PublicKey(contract.multisig);
  const account = await connection.getAccountInfo(multisigKey, 'finalized');
  if (!account || !account.owner.equals(programId)) {
    throw new Error('squads_grant_payout_multisig_owner_mismatch');
  }
  const [multisig] = squads.generated.Multisig.fromAccountInfo(account);
  const actualMembers = new Map(multisig.members.map((member) => [
    member.key.toBase58(), member.permissions.mask,
  ]));
  const expectedMembers = [
    contract.authorities.proposer_member,
    contract.authorities.approver_member,
    contract.authorities.executor_member,
  ];
  const derivedVault = squads.getVaultPda({
    multisigPda: multisigKey,
    index: 0,
    programId,
  })[0].toBase58();
  if (
    multisig.threshold !== 2
    || multisig.timeLock !== 0
    || multisig.members.length !== 3
    || multisig.configAuthority.toBase58() !== contract.authorities.config_authority.publicKey
    || expectedMembers.some((member) => actualMembers.get(member.publicKey) !== member.permissionMask)
    || derivedVault !== contract.vault
  ) throw new Error('squads_grant_payout_multisig_state_mismatch');
  return BigInt(multisig.transactionIndex.toString());
}

function deriveSquadsGrantPayoutAddresses(contract: SquadsGrantPayoutContract): {
  proposal: string;
  vaultTransaction: string;
} {
  const programId = new PublicKey(contract.programId);
  const multisigPda = new PublicKey(contract.multisig);
  const transactionIndex = BigInt(contract.transactionIndex);
  return {
    proposal: squads.getProposalPda({ multisigPda, transactionIndex, programId })[0].toBase58(),
    vaultTransaction: squads.getTransactionPda({
      multisigPda,
      index: transactionIndex,
      programId,
    })[0].toBase58(),
  };
}

function buildGrantPayoutSteps(
  contract: SquadsGrantPayoutContract,
  connection: Connection,
  _addresses: ReturnType<typeof deriveSquadsGrantPayoutAddresses>,
): Array<SquadsStep<SquadsGrantPayoutStepId>> {
  const programId = new PublicKey(contract.programId);
  const feePayer = authorityKey(contract, 'fee_payer');
  const proposer = authorityKey(contract, 'proposer_member');
  const approver = authorityKey(contract, 'approver_member');
  const executor = authorityKey(contract, 'executor_member');
  const multisigPda = new PublicKey(contract.multisig);
  const vault = new PublicKey(contract.vault);
  const recipient = new PublicKey(contract.recipient);
  const transactionIndex = BigInt(contract.transactionIndex);
  const transferInstruction = SystemProgram.transfer({
    fromPubkey: vault,
    toPubkey: recipient,
    lamports: Number(contract.amountLamports),
  });
  return [
    step('payout_create_vault_transaction', ['fee_payer', 'proposer_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      proposer_member: 'create_vault_transaction',
    }, async (blockhash) => squads.transactions.vaultTransactionCreate({
      blockhash,
      feePayer,
      multisigPda,
      transactionIndex,
      creator: proposer,
      rentPayer: feePayer,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: new TransactionMessage({
        payerKey: vault,
        recentBlockhash: blockhash,
        instructions: [transferInstruction],
      }),
      memo: `Alcheme grant payout ${contract.requestId}`,
      programId,
    })),
    step('payout_create_proposal', ['fee_payer', 'proposer_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      proposer_member: 'create_proposal',
    }, async (blockhash) => squads.transactions.proposalCreate({
      blockhash, feePayer, multisigPda, transactionIndex, creator: proposer,
      rentPayer: feePayer, isDraft: false, programId,
    })),
    step('payout_approve_by_proposer', ['fee_payer', 'proposer_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      proposer_member: 'approve_proposal',
    }, async (blockhash) => squads.transactions.proposalApprove({
      blockhash, feePayer, multisigPda, transactionIndex, member: proposer, programId,
    })),
    step('payout_approve_by_approver', ['fee_payer', 'approver_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      approver_member: 'approve_proposal',
    }, async (blockhash) => squads.transactions.proposalApprove({
      blockhash, feePayer, multisigPda, transactionIndex, member: approver, programId,
    })),
    step('payout_execute_vault_transaction', ['fee_payer', 'executor_member'], {
      fee_payer: 'pay_approved_devnet_fee_and_rent',
      executor_member: 'execute_vault_transaction',
    }, async (blockhash) => squads.transactions.vaultTransactionExecute({
      connection, blockhash, feePayer, multisigPda, transactionIndex, member: executor, programId,
    })),
  ];
}

async function readSquadsGrantPayoutFinalizedState(
  connection: Connection,
  contract: SquadsGrantPayoutContract,
  addresses: ReturnType<typeof deriveSquadsGrantPayoutAddresses>,
  last: SquadsDevnetStepCheckpoint<SquadsGrantPayoutStepId>,
): Promise<number> {
  const programId = new PublicKey(contract.programId);
  const keys = [addresses.proposal, addresses.vaultTransaction].map((value) => new PublicKey(value));
  const readback = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'finalized' });
  if (
    readback.value.length !== 2
    || readback.value.some((account) => !account || !account.owner.equals(programId))
  ) throw new Error('squads_grant_payout_account_owner_mismatch');
  const [proposal] = squads.generated.Proposal.fromAccountInfo(readback.value[0]!);
  const [vaultTransaction] = squads.generated.VaultTransaction.fromAccountInfo(readback.value[1]!);
  const instruction = vaultTransaction.message.instructions[0];
  const instructionProgram = instruction
    ? vaultTransaction.message.accountKeys[instruction.programIdIndex]?.toBase58()
    : null;
  const instructionAccounts = instruction
    ? Array.from(
      instruction.accountIndexes,
      (index) => vaultTransaction.message.accountKeys[index]?.toBase58(),
    )
    : [];
  const expectedTransfer = SystemProgram.transfer({
    fromPubkey: new PublicKey(contract.vault),
    toPubkey: new PublicKey(contract.recipient),
    lamports: Number(contract.amountLamports),
  });
  const expectedApproved = new Set([
    contract.authorities.proposer_member.publicKey,
    contract.authorities.approver_member.publicKey,
  ]);
  const execution = last.signature ? await connection.getTransaction(last.signature, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  }) : null;
  if (
    proposal.multisig.toBase58() !== contract.multisig
    || proposal.transactionIndex.toString() !== contract.transactionIndex
    || proposal.status.__kind !== 'Executed'
    || proposal.approved.length !== 2
    || proposal.approved.some((member) => !expectedApproved.has(member.toBase58()))
    || proposal.rejected.length !== 0
    || proposal.cancelled.length !== 0
    || vaultTransaction.multisig.toBase58() !== contract.multisig
    || vaultTransaction.creator.toBase58() !== contract.authorities.proposer_member.publicKey
    || vaultTransaction.index.toString() !== contract.transactionIndex
    || vaultTransaction.vaultIndex !== 0
    || vaultTransaction.message.instructions.length !== 1
    || instructionProgram !== SystemProgram.programId.toBase58()
    || instructionAccounts.length !== 2
    || instructionAccounts[0] !== contract.vault
    || instructionAccounts[1] !== contract.recipient
    || !Buffer.from(instruction?.data ?? []).equals(expectedTransfer.data)
    || !execution
    || execution.meta?.err
    || execution.slot !== last.slot
    || readback.context.slot < last.slot!
  ) throw new Error('squads_grant_payout_finalized_state_mismatch');
  return last.slot!;
}

function assertContract(contract: SquadsDevnetContract): void {
  const roles: SquadsDevnetRole[] = [
    'config_authority',
    'proposer_member',
    'approver_member',
    'executor_member',
    'fee_payer',
  ];
  if (
    contract.chainId !== 'solana:devnet'
    || contract.profileVersion !== 1
    || contract.threshold !== 2
    || contract.timeLockSeconds !== 0
    || contract.vaultIndex !== 0
    || !contract.memoText
    || Buffer.byteLength(contract.memoText, 'utf8') > 256
    || !/^[a-f0-9]{64}$/.test(contract.decisionDigest)
    || !/^[a-f0-9]{64}$/.test(contract.actionIntentDigest)
    || new Set(roles.map((role) => contract.authorities[role]?.publicKey)).size !== roles.length
    || contract.authorities.proposer_member.permissionMask !== 3
    || contract.authorities.approver_member.permissionMask !== 2
    || contract.authorities.executor_member.permissionMask !== 4
    || contract.authorities.config_authority.permissionMask !== null
    || contract.authorities.fee_payer.permissionMask !== null
  ) throw new Error('squads_provider_contract_invalid');
  for (const role of roles) {
    new PublicKey(contract.authorities[role].publicKey);
  }
}

function assertLimits(limits: SquadsDevnetLimits): void {
  if (
    !Number.isSafeInteger(limits.singleTransactionLimitLamports)
    || !Number.isSafeInteger(limits.totalVerticalLimitLamports)
    || !Number.isSafeInteger(limits.maximumWalletBalanceLamports)
    || !Number.isSafeInteger(limits.fundingTargetLamports)
    || limits.singleTransactionLimitLamports <= 0
    || limits.totalVerticalLimitLamports < limits.singleTransactionLimitLamports
    || limits.maximumWalletBalanceLamports !== 1_000_000_000
    || limits.fundingTargetLamports <= 0
    || limits.fundingTargetLamports > limits.totalVerticalLimitLamports
  ) throw new Error('squads_provider_limits_invalid');
}

function assertSpend(
  actualSpendLamports: number,
  totalSpendLamports: number,
  limits: Pick<SquadsDevnetLimits, 'singleTransactionLimitLamports' | 'totalVerticalLimitLamports'>,
): void {
  if (
    actualSpendLamports > limits.singleTransactionLimitLamports
    || totalSpendLamports > limits.totalVerticalLimitLamports
  ) throw new Error('squads_provider_actual_cost_cap_exceeded');
}
