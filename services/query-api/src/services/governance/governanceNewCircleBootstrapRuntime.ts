import { BorshAccountsCoder } from '@coral-xyz/anchor';
import { Connection, PublicKey, type Commitment } from '@solana/web3.js';

import circleManagerIdl from '../../../../../sdk/src/idl/circle_manager.json';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  createPrismaGovernanceHomeFoundationStore,
  type GovernanceActivationStateWrite,
  type GovernanceHomeIdentityBindingWrite,
} from './governanceHomeStore';
import { CIRCLE_GOVERNANCE_PROFILE_V1 } from './governanceProfile';
import { prepareBootstrapGovernanceProfileBinding } from './governanceProfileLifecycle';

const NEW_CIRCLE_BINDING_DOMAIN = 'alcheme.governance.new-circle-home-binding';
const NEW_CIRCLE_STATE_DOMAIN = 'alcheme.governance.new-circle-safe-default';
const CIRCLE_MANAGER_VERSION = '0.3.0' as const;
const LEGACY_GOVERNANCE_GUARD_VERSION_SHIFT = 18n;
const LEGACY_GOVERNANCE_ACTION_LOCK_SHIFT = 22n;
const LEGACY_GOVERNANCE_ALL_ACTIONS_MASK = 31;

export interface NewCircleSafeDefaultReadback {
  circleId: number;
  accountRef: string;
  ownerProgramId: string;
  ownerPubkey: string;
  decisionEngine: 'LegacyDisabled';
  guardVersion: 1;
  lockedActionMask: 31;
  observedSlot: number;
  stateDigest: string;
  programVersion: typeof CIRCLE_MANAGER_VERSION;
}

export interface NewCircleSafeDefaultReader {
  read(circleId: number, accountRef: string): Promise<NewCircleSafeDefaultReadback>;
}

export function newCircleSafeDefaultStateDigest(
  facts: Omit<NewCircleSafeDefaultReadback, 'observedSlot' | 'stateDigest'>,
): string {
  return hashCanonicalGovernanceValue(NEW_CIRCLE_STATE_DOMAIN, facts);
}

interface NewCircleBootstrapPrisma {
  circle: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
  };
  governanceActivationState: {
    create(input: unknown): Promise<any>;
  };
  $transaction<T>(operation: (tx: any) => Promise<T>): Promise<T>;
}

async function lockGovernanceFoundation(tx: any, homeIdentityBindingId: string): Promise<void> {
  if (typeof tx.$executeRawUnsafe !== 'function') {
    throw new Error('new_circle_governance_foundation_transaction_lock_required');
  }
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `governance-profile-definition:${CIRCLE_GOVERNANCE_PROFILE_V1.versionRef}`,
  );
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `governance-home-stage:${homeIdentityBindingId}`,
  );
}

export async function bootstrapNewCircleGovernanceHome(
  dependencies: {
    prisma: NewCircleBootstrapPrisma;
    chainReader: NewCircleSafeDefaultReader;
  },
  input: {
    circleId: number;
    actorPubkey: string;
    creationTxSignature: string;
  },
): Promise<{
  identity: GovernanceHomeIdentityBindingWrite;
  activation: GovernanceActivationStateWrite;
  profileBinding: any;
  readback: NewCircleSafeDefaultReadback;
}> {
  return openInactiveCircleGovernanceHome(dependencies, input, {
    sourceVersionSuffix: null,
    bindingFacts: { creationTxSignature: input.creationTxSignature },
  });
}

/**
 * Reconstructs only a missing, inactive Circle Governance Home from the
 * current finalized Circle account. This is deliberately distinct from the
 * new-Circle creation-evidence flow: no historical transaction is inferred
 * or accepted here.
 */
export async function reenterExistingCircleGovernanceHome(
  dependencies: {
    prisma: NewCircleBootstrapPrisma;
    chainReader: NewCircleSafeDefaultReader;
  },
  input: {
    circleId: number;
    actorPubkey: string;
  },
): Promise<{
  identity: GovernanceHomeIdentityBindingWrite;
  activation: GovernanceActivationStateWrite;
  profileBinding: any;
  readback: NewCircleSafeDefaultReadback;
}> {
  return openInactiveCircleGovernanceHome(dependencies, input, {
    sourceVersionSuffix: 'authoritative-chain-reentry',
    bindingFacts: { mode: 'authoritative-chain-reentry' },
  });
}

async function openInactiveCircleGovernanceHome(
  dependencies: {
    prisma: NewCircleBootstrapPrisma;
    chainReader: NewCircleSafeDefaultReader;
  },
  input: {
    circleId: number;
    actorPubkey: string;
  },
  provenance: {
    sourceVersionSuffix: 'authoritative-chain-reentry' | null;
    bindingFacts: Record<string, string>;
  },
): Promise<{
  identity: GovernanceHomeIdentityBindingWrite;
  activation: GovernanceActivationStateWrite;
  profileBinding: any;
  readback: NewCircleSafeDefaultReadback;
}> {
  if (!Number.isInteger(input.circleId) || input.circleId < 0 || input.circleId > 255) {
    throw new Error('invalid_new_circle_id');
  }
  const circle = await dependencies.prisma.circle.findUnique({
    where: { id: input.circleId },
    select: {
      id: true,
      onChainAddress: true,
      createdAt: true,
      creator: { select: { pubkey: true, onChainAddress: true } },
    },
  });
  if (!circle) throw new Error('new_circle_projection_missing');

  const projectedCreator = String(circle.creator?.pubkey || circle.creator?.onChainAddress || '');
  if (projectedCreator !== input.actorPubkey) {
    throw new Error('new_circle_creator_projection_mismatch');
  }
  const accountRef = String(circle.onChainAddress || '');
  const readback = await dependencies.chainReader.read(input.circleId, accountRef);
  if (readback.ownerPubkey !== input.actorPubkey) {
    throw new Error('new_circle_chain_owner_mismatch');
  }

  const timestamp = new Date(circle.createdAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('new_circle_created_at_invalid');
  const identityId = `governance-home-circle-${input.circleId}-v1`;
  const activationId = `governance-activation-circle-${input.circleId}-v1`;
  const bindingDigest = hashCanonicalGovernanceValue(NEW_CIRCLE_BINDING_DOMAIN, {
    circleId: input.circleId,
    accountRef,
    ownerProgramId: readback.ownerProgramId,
    ownerPubkey: readback.ownerPubkey,
    stateDigest: readback.stateDigest,
    programVersion: readback.programVersion,
    ...provenance.bindingFacts,
  });
  const identity: GovernanceHomeIdentityBindingWrite = {
    id: identityId,
    homeType: 'circle',
    homeRef: String(input.circleId),
    identityVersion: 1,
    chainAccountRef: accountRef,
    sourceType: 'circle_program',
    sourceRef: accountRef,
    sourceVersion: provenance.sourceVersionSuffix
      ? `circle-manager-${readback.programVersion}:${provenance.sourceVersionSuffix}`
      : `circle-manager-${readback.programVersion}`,
    bindingDigest,
    status: 'inactive',
    effectiveFrom: null,
    supersededAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const activation: GovernanceActivationStateWrite = {
    id: activationId,
    homeIdentityBindingId: identityId,
    state: 'bootstrap_pending',
    bootstrapBundleVersion: null,
    bootstrapBundleDigest: null,
    policyBundleDigest: null,
    payerPolicyRef: null,
    assetAuthorityPolicyRef: null,
    bootstrapActorPubkey: null,
    bootstrapBypassStatus: 'disabled',
    bootstrapBypassExpiresAt: null,
    activationRequestId: null,
    activationDecisionDigest: null,
    activationReceiptId: null,
    lastVerifiedAt: null,
    activatedAt: null,
    failureCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const foundation = await dependencies.prisma.$transaction(async (tx) => {
    await lockGovernanceFoundation(tx, identityId);
    const existing = provenance.sourceVersionSuffix === 'authoritative-chain-reentry'
      ? await tx.governanceHomeIdentityBinding.findUnique({
        where: { id: identityId },
        include: { activationState: true },
      })
      : null;
    const pair = existing
      ? assertHistoricalPendingCircleFoundation(existing, {
        circleId: input.circleId,
        identityId,
        activationId,
        accountRef,
        programVersion: readback.programVersion,
      })
      : await createPrismaGovernanceHomeFoundationStore(tx as any, {
        transactionClient: true,
      }).openInactiveHome({ identity, activation });
    const profileBinding = await prepareBootstrapGovernanceProfileBinding(tx as any, {
      homeIdentityBindingId: pair.identity.id,
      homeType: pair.identity.homeType,
      targetProfile: CIRCLE_GOVERNANCE_PROFILE_V1,
      now: timestamp,
    }, { transactionClient: true });
    return { ...pair, profileBinding };
  });
  return { ...foundation, readback };
}

function assertHistoricalPendingCircleFoundation(
  existing: any,
  expected: {
    circleId: number;
    identityId: string;
    activationId: string;
    accountRef: string;
    programVersion: typeof CIRCLE_MANAGER_VERSION;
  },
): {
  identity: GovernanceHomeIdentityBindingWrite;
  activation: GovernanceActivationStateWrite;
} {
  const activationState = existing?.activationState;
  if (
    existing?.id !== expected.identityId
    || existing?.homeType !== 'circle'
    || String(existing?.homeRef) !== String(expected.circleId)
    || existing?.chainAccountRef !== expected.accountRef
    || existing?.sourceType !== 'circle_program'
    || existing?.sourceRef !== expected.accountRef
    || !String(existing?.sourceVersion || '').startsWith(`circle-manager-${expected.programVersion}`)
    || !/^[a-f0-9]{64}$/.test(String(existing?.bindingDigest || ''))
    || existing?.status !== 'inactive'
    || existing?.supersededAt !== null
    || activationState?.id !== expected.activationId
    || activationState?.homeIdentityBindingId !== expected.identityId
    || activationState?.state !== 'bootstrap_pending'
    || activationState?.bootstrapBypassStatus !== 'disabled'
    || activationState?.activatedAt !== null
  ) {
    throw new Error('new_circle_authoritative_reentry_pending_foundation_mismatch');
  }
  const { activationState: _activationState, ...identity } = existing;
  return {
    identity: identity as GovernanceHomeIdentityBindingWrite,
    activation: activationState as GovernanceActivationStateWrite,
  };
}

export function createNewCircleSafeDefaultReader(input: {
  rpcUrl: string;
  programId: string;
  commitment?: Commitment;
}): NewCircleSafeDefaultReader {
  const commitment = input.commitment ?? 'confirmed';
  const connection = new Connection(input.rpcUrl, commitment);
  const programId = new PublicKey(input.programId);
  const coder = new BorshAccountsCoder(circleManagerIdl as any);
  return {
    async read(circleId, accountRef) {
      const accountKey = new PublicKey(accountRef);
      const [expectedAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('circle'), Buffer.from([circleId])],
        programId,
      );
      if (!expectedAccount.equals(accountKey)) throw new Error('new_circle_account_pda_mismatch');
      const response = await connection.getAccountInfoAndContext(accountKey, commitment);
      if (!response.value) throw new Error('new_circle_chain_account_missing');
      if (!response.value.owner.equals(programId)) throw new Error('new_circle_program_owner_mismatch');
      const decoded: any = coder.decode('Circle', response.value.data);
      if (Number(decoded.circle_id) !== circleId) throw new Error('new_circle_chain_id_mismatch');
      const decisionEngineKey = Object.keys(decoded.decision_engine ?? {})[0] ?? '';
      if (decisionEngineKey.replace(/_/g, '').toLowerCase() !== 'legacydisabled') {
        throw new Error('new_circle_legacy_governance_not_disabled');
      }
      const flags = BigInt(decoded.flags.toString(10));
      const guardVersion = Number((flags >> LEGACY_GOVERNANCE_GUARD_VERSION_SHIFT) & 0xfn);
      const lockedActionMask = Number(
        (flags >> LEGACY_GOVERNANCE_ACTION_LOCK_SHIFT) & BigInt(LEGACY_GOVERNANCE_ALL_ACTIONS_MASK),
      );
      if (guardVersion !== 1 || lockedActionMask !== LEGACY_GOVERNANCE_ALL_ACTIONS_MASK) {
        throw new Error('new_circle_legacy_governance_guard_incomplete');
      }
      const ownerPubkey = decoded.curators?.[0]?.toBase58?.() ?? '';
      if (!ownerPubkey) throw new Error('new_circle_chain_owner_missing');
      const semanticFacts = {
        circleId,
        accountRef,
        ownerProgramId: response.value.owner.toBase58(),
        ownerPubkey,
        decisionEngine: 'LegacyDisabled' as const,
        guardVersion: 1 as const,
        lockedActionMask: 31 as const,
        programVersion: CIRCLE_MANAGER_VERSION,
      };
      return {
        ...semanticFacts,
        observedSlot: response.context.slot,
        stateDigest: newCircleSafeDefaultStateDigest(semanticFacts),
      };
    },
  };
}
