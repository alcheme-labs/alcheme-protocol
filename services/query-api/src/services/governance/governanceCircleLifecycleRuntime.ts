import { createHash } from 'node:crypto';

import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

import circleManagerIdl from '../../../../../sdk/src/idl/circle_manager.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';

export type GovernanceCircleLifecycleAction = 'archive' | 'restore';
export type GovernanceCircleLifecycleStatus = 'Active' | 'Archived';

export type CircleLifecycleChainCommitment = 'confirmed' | 'finalized';

export interface CircleLifecycleChainEvidence {
  network: 'solana:localnet';
  transactionSignature: string;
  transactionSlot: number;
  observedSlot: number;
  circleId: number;
  circleAccountRef: string;
  actorPubkey: string;
  action: GovernanceCircleLifecycleAction;
  lifecycleStatus: GovernanceCircleLifecycleStatus;
  stateDigest: string;
  commitment: CircleLifecycleChainCommitment;
}

export interface CircleLifecycleChainReader {
  verifyAndRead(input: {
    network: 'solana:localnet';
    transactionSignature: string;
    circleId: number;
    circleAccountRef: string;
    actorPubkey: string;
    action: GovernanceCircleLifecycleAction;
    commitment?: CircleLifecycleChainCommitment;
  }): Promise<CircleLifecycleChainEvidence>;
}

interface CircleLifecyclePrisma {
  circle: {
    findUnique(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceActivationState: {
    update(input: unknown): Promise<any>;
  };
  $transaction<T>(operation: (tx: CircleLifecyclePrisma) => Promise<T>): Promise<T>;
}

const CANONICAL_ACTIVATION_STATES = new Set([
  'legacy_unmigrated',
  'bootstrap_pending',
  'active',
  'recovery_required',
]);

export async function reconcileCircleLifecycleFromChain(
  dependencies: {
    prisma: CircleLifecyclePrisma;
    chainReader: CircleLifecycleChainReader;
  },
  input: {
    network: 'solana:localnet';
    circleId: number;
    actorPubkey: string;
    action: GovernanceCircleLifecycleAction;
    reason: string | null;
    transactionSignature: string;
    now?: Date;
  },
): Promise<{ circle: any; activation: any; evidence: CircleLifecycleChainEvidence }> {
  assertInput(input);
  const projected = await dependencies.prisma.circle.findUnique({
    where: { id: input.circleId },
    select: { id: true, onChainAddress: true },
  });
  if (!projected) throw new Error('circle_not_found');
  const circleAccountRef = String(projected.onChainAddress || '');
  if (!circleAccountRef) throw new Error('circle_lifecycle_chain_account_missing');

  const evidence = await dependencies.chainReader.verifyAndRead({
    network: input.network,
    transactionSignature: input.transactionSignature,
    circleId: input.circleId,
    circleAccountRef,
    actorPubkey: input.actorPubkey,
    action: input.action,
  });
  assertExactEvidence(evidence, { ...input, circleAccountRef });

  const desiredStatus: GovernanceCircleLifecycleStatus =
    input.action === 'restore' ? 'Active' : 'Archived';
  const now = input.now ?? new Date();
  if (evidence.lifecycleStatus !== desiredStatus) {
    await dependencies.prisma.$transaction(async (tx) => {
      const pair = await readCanonicalPair(tx, input.circleId, circleAccountRef);
      await tx.governanceActivationState.update({
        where: { id: pair.activation.id },
        data: {
          state: 'recovery_required',
          failureCode: 'circle_lifecycle_chain_readback_mismatch',
          lastVerifiedAt: now,
        },
      });
    });
    throw new Error('circle_lifecycle_chain_readback_mismatch');
  }

  return dependencies.prisma.$transaction(async (tx) => {
    const pair = await readCanonicalPair(tx, input.circleId, circleAccountRef);
    const projectionSlot = safeSlot(pair.circle.lastSyncedSlot);
    if (projectionSlot > evidence.observedSlot) {
      throw new Error('circle_lifecycle_projection_slot_ahead');
    }
    const archiveData = input.action === 'restore'
      ? {
          lifecycleStatus: 'Active',
          archivedAt: null,
          archivedByPubkey: null,
          archiveReason: null,
          lastSyncedSlot: BigInt(evidence.observedSlot),
        }
      : {
          lifecycleStatus: 'Archived',
          archivedAt: now,
          archivedByPubkey: input.actorPubkey,
          archiveReason: normalizeReason(input.reason),
          lastSyncedSlot: BigInt(evidence.observedSlot),
        };
    const updated = await tx.circle.updateMany({
      where: {
        id: input.circleId,
        onChainAddress: circleAccountRef,
        lastSyncedSlot: { lte: BigInt(evidence.observedSlot) },
      },
      data: archiveData,
    });
    if (updated.count !== 1) throw new Error('circle_lifecycle_projection_cas_failed');
    const circle = await tx.circle.findUnique({ where: { id: input.circleId } });
    if (!circle || String(circle.lifecycleStatus) !== desiredStatus) {
      throw new Error('circle_lifecycle_projection_readback_mismatch');
    }
    return { circle, activation: pair.activation, evidence };
  });
}

async function readCanonicalPair(
  prisma: CircleLifecyclePrisma,
  circleId: number,
  circleAccountRef: string,
): Promise<{ circle: any; activation: any }> {
  const [circle, home] = await Promise.all([
    prisma.circle.findUnique({ where: { id: circleId } }),
    prisma.governanceHomeIdentityBinding.findUnique({
      where: { homeType_homeRef_identityVersion: {
        homeType: 'circle',
        homeRef: String(circleId),
        identityVersion: 1,
      } },
      include: { activationState: true },
    }),
  ]);
  if (!circle) throw new Error('circle_not_found');
  if (String(circle.onChainAddress || '') !== circleAccountRef) {
    throw new Error('circle_lifecycle_projection_account_mismatch');
  }
  if (!home || home.homeType !== 'circle' || home.homeRef !== String(circleId)) {
    throw new Error('circle_lifecycle_governance_home_missing');
  }
  if (String(home.chainAccountRef || '') !== circleAccountRef) {
    throw new Error('circle_lifecycle_home_chain_account_mismatch');
  }
  const activation = home.activationState;
  if (!activation || !CANONICAL_ACTIVATION_STATES.has(String(activation.state))) {
    throw new Error('circle_lifecycle_activation_state_missing_or_legacy');
  }
  return { circle, activation };
}

export function createCircleLifecycleChainReader(input: {
  rpcUrl: string;
  programId: string;
}): CircleLifecycleChainReader {
  const connection = new Connection(input.rpcUrl, 'confirmed');
  const programId = new PublicKey(input.programId);
  const coder = new BorshAccountsCoder(circleManagerIdl as any);
  return {
    async verifyAndRead(request) {
      if (request.network !== 'solana:localnet') {
        throw new Error('circle_lifecycle_network_not_enabled');
      }
      const commitment: CircleLifecycleChainCommitment =
        request.commitment === 'finalized' ? 'finalized' : 'confirmed';
      const circleAccount = new PublicKey(request.circleAccountRef);
      const actor = new PublicKey(request.actorPubkey);
      const [expectedCircle] = PublicKey.findProgramAddressSync(
        [Buffer.from('circle'), Buffer.from([request.circleId])],
        programId,
      );
      if (!circleAccount.equals(expectedCircle)) {
        throw new Error('circle_lifecycle_circle_pda_mismatch');
      }
      if (commitment === 'finalized') {
        const statuses = await connection.getSignatureStatuses([request.transactionSignature], {
          searchTransactionHistory: true,
        });
        const status = statuses?.value?.[0];
        if (!status) throw new Error('circle_lifecycle_transaction_not_found');
        if (status.err) throw new Error('circle_lifecycle_transaction_failed');
        if (status.confirmationStatus !== 'finalized') {
          throw new Error('circle_lifecycle_transaction_not_finalized');
        }
      }
      const transaction: any = await connection.getTransaction(request.transactionSignature, {
        commitment,
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction) throw new Error('circle_lifecycle_transaction_not_found');
      if (transaction.meta?.err) throw new Error('circle_lifecycle_transaction_failed');
      const keys = transactionAccountKeys(transaction);
      const message: any = transaction.transaction.message;
      const requiredSigners = Number(message.header?.numRequiredSignatures ?? 0);
      if (!keys.slice(0, requiredSigners).some((key) => key.equals(actor))) {
        throw new Error('circle_lifecycle_transaction_signer_mismatch');
      }
      const instructionName = request.action === 'restore' ? 'restore_circle' : 'archive_circle';
      const discriminator = createHash('sha256')
        .update(`global:${instructionName}`)
        .digest()
        .subarray(0, 8);
      const instructions: any[] = message.compiledInstructions ?? message.instructions ?? [];
      const matched = instructions.some((instruction) => {
        const programIndex = Number(instruction.programIdIndex);
        const accounts = Array.from(instruction.accountKeyIndexes ?? instruction.accounts ?? [])
          .map((value) => Number(value));
        const data = Buffer.from(instruction.data ?? []);
        return keys[programIndex]?.equals(programId)
          && data.subarray(0, 8).equals(discriminator)
          && keys[accounts[1]]?.equals(circleAccount)
          && keys[accounts[2]]?.equals(actor);
      });
      if (!matched) throw new Error('circle_lifecycle_transaction_instruction_mismatch');

      const response = await connection.getAccountInfoAndContext(circleAccount, {
        commitment,
        minContextSlot: transaction.slot,
      });
      if (!response.value) throw new Error('circle_lifecycle_chain_account_missing');
      if (!response.value.owner.equals(programId)) {
        throw new Error('circle_lifecycle_program_owner_mismatch');
      }
      const decoded: any = coder.decode('Circle', response.value.data);
      const decodedCircleId = Number(decoded.circle_id);
      if (decodedCircleId !== request.circleId) {
        throw new Error('circle_lifecycle_chain_id_mismatch');
      }
      const statusKey = Object.keys(decoded.status ?? {})[0] ?? '';
      const lifecycleStatus: GovernanceCircleLifecycleStatus | null =
        statusKey.toLowerCase() === 'archived' ? 'Archived' :
          statusKey.toLowerCase() === 'active' ? 'Active' : null;
      if (!lifecycleStatus) throw new Error('circle_lifecycle_chain_status_unknown');
      const semanticFacts = {
        network: request.network,
        transactionSignature: request.transactionSignature,
        transactionSlot: safeSlot(transaction.slot),
        circleId: request.circleId,
        circleAccountRef: request.circleAccountRef,
        actorPubkey: request.actorPubkey,
        action: request.action,
        lifecycleStatus,
        commitment,
      };
      return {
        ...semanticFacts,
        observedSlot: safeSlot(response.context.slot),
        stateDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.circle-lifecycle-readback',
          semanticFacts,
        ),
      };
    },
  };
}

function transactionAccountKeys(transaction: any): PublicKey[] {
  const message: any = transaction.transaction.message;
  const staticKeys: any[] = message.staticAccountKeys ?? message.accountKeys ?? [];
  const loaded = transaction.meta?.loadedAddresses;
  return [
    ...staticKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ].map((key) => new PublicKey(key));
}

function assertInput(input: {
  network: string;
  circleId: number;
  actorPubkey: string;
  transactionSignature: string;
}): void {
  if (input.network !== 'solana:localnet') throw new Error('circle_lifecycle_network_not_enabled');
  if (!Number.isInteger(input.circleId) || input.circleId < 0 || input.circleId > 255) {
    throw new Error('invalid_circle_lifecycle_id');
  }
  if (!input.actorPubkey.trim() || !input.transactionSignature.trim()) {
    throw new Error('circle_lifecycle_transaction_evidence_required');
  }
}

function assertExactEvidence(
  evidence: CircleLifecycleChainEvidence,
  input: {
    network: 'solana:localnet';
    circleId: number;
    circleAccountRef: string;
    actorPubkey: string;
    action: GovernanceCircleLifecycleAction;
    transactionSignature: string;
  },
): void {
  const transactionSlot = safeSlot(evidence.transactionSlot);
  const observedSlot = safeSlot(evidence.observedSlot);
  if (!/^[a-f0-9]{64}$/.test(evidence.stateDigest)) {
    throw new Error('circle_lifecycle_state_digest_invalid');
  }
  if (evidence.network !== input.network) throw new Error('circle_lifecycle_transaction_network_mismatch');
  if (evidence.transactionSignature !== input.transactionSignature) {
    throw new Error('circle_lifecycle_transaction_signature_mismatch');
  }
  if (evidence.circleId !== input.circleId || evidence.circleAccountRef !== input.circleAccountRef) {
    throw new Error('circle_lifecycle_transaction_circle_mismatch');
  }
  if (evidence.actorPubkey !== input.actorPubkey) throw new Error('circle_lifecycle_transaction_actor_mismatch');
  if (evidence.action !== input.action) throw new Error('circle_lifecycle_transaction_action_mismatch');
  if (evidence.commitment !== 'confirmed' && evidence.commitment !== 'finalized') {
    throw new Error('circle_lifecycle_chain_commitment_invalid');
  }
  if (observedSlot < transactionSlot) {
    throw new Error('circle_lifecycle_chain_readback_before_transaction');
  }
}

function safeSlot(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('invalid_circle_lifecycle_slot');
  return parsed;
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, 280);
  return normalized || null;
}
