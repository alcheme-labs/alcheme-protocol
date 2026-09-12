import { isDeepStrictEqual } from 'node:util';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  LEGACY_GOVERNANCE_ACTIONS,
  createGovernanceLegacyCompatibilityBundle,
  type GovernanceLegacyCompatibilityBundleInput,
} from './governanceLegacyCompatibilityBundle';
import {
  createPrismaGovernanceLegacyCompatibilityBundleStore,
  type GovernanceLegacyCompatibilityBundleStore,
} from './governanceLegacyCompatibilityBundleStore';
import type { GovernanceLegacyMutationSurfaceSnapshot } from './governanceLegacyMutationSurfaceReader';

const PROJECTION_DIGEST_DOMAIN = 'alcheme.governance.legacy-compatibility-projection';
const BINDING_DIGEST_DOMAIN = 'alcheme.governance.legacy-compatibility-binding';

export interface LegacyCircleProgramReadback {
  circleId: number;
  accountRef: string;
  accountOwnerProgramId: string;
  programVersionRef: string;
  programIdlDigest: string;
  observedSlot: number;
  commitment: 'confirmed' | 'finalized';
  stateDigest: string;
  lifecycleStatus: string;
  flags: string;
  curators: string[];
  decisionEngine: { type: string; configDigest: string } | null;
}

export interface LegacyTransferProposalReadback {
  proposalRef: string;
  status: string;
  decisionEngineDigest: string;
  deadline: number | null;
  votesFor: number;
  votesAgainst: number;
  voters: number;
}

export interface GovernanceLegacyCompatibilityChainReader {
  readCircle(input: {
    network: 'solana:localnet';
    circleId: number;
    accountRef: string;
    commitment: 'confirmed';
  }): Promise<LegacyCircleProgramReadback>;
  listOpenTransferProposals(input: {
    network: 'solana:localnet';
    circleId: number;
    accountRef: string;
    commitment: 'confirmed';
  }): Promise<LegacyTransferProposalReadback[]>;
}

export async function persistGovernanceLegacyCompatibilityFromReadback(
  dependencies: {
    prisma: any;
    chainReader: GovernanceLegacyCompatibilityChainReader;
    mutationSurfaceReader: {
      readCircleMutationSurfaces():
        GovernanceLegacyMutationSurfaceSnapshot | Promise<GovernanceLegacyMutationSurfaceSnapshot>;
    };
    store?: GovernanceLegacyCompatibilityBundleStore;
  },
  input: {
    id: string;
    homeIdentityBindingId: string;
    circleId: number;
    expectedOwnerPubkey: string;
    expectedPostLockActionMask?: number;
    version: number;
    createdAt: Date;
  },
) {
  const { prisma, chainReader } = dependencies;
  const [existingBundle, homeIdentity, activation, circle, bindings, requests, assets, receipts] = await Promise.all([
    prisma.governanceCompatibilityBundle.findUnique({ where: { id: input.id } }),
    prisma.governanceHomeIdentityBinding.findUnique({ where: { id: input.homeIdentityBindingId } }),
    prisma.governanceActivationState.findUnique({
      where: { homeIdentityBindingId: input.homeIdentityBindingId },
    }),
    prisma.circle.findUnique({
      where: { id: input.circleId },
      include: {
        creator: { select: { pubkey: true } },
        members: {
          include: { user: { select: { pubkey: true } } },
          orderBy: { id: 'asc' },
        },
      },
    }),
    prisma.circleGovernanceBinding.findMany({
      where: { targetCircleId: input.circleId },
      orderBy: { id: 'asc' },
    }),
    prisma.governanceRequest.findMany({
      where: {
        OR: [
          { scopeType: 'circle', scopeRef: String(input.circleId) },
          { targetType: 'circle', targetRef: String(input.circleId) },
        ],
      },
      orderBy: { id: 'asc' },
    }),
    prisma.crystalAsset.findMany({ where: { circleId: input.circleId }, orderBy: { id: 'asc' } }),
    prisma.crystalReceipt.findMany({ where: { circleId: input.circleId }, orderBy: { id: 'asc' } }),
  ]);

  if (!homeIdentity) throw new Error('governance_compatibility_home_identity_missing');
  if (
    homeIdentity.homeType !== 'circle'
    || homeIdentity.homeRef !== String(input.circleId)
    || !homeIdentity.chainAccountRef
  ) {
    throw new Error('governance_compatibility_home_identity_mismatch');
  }
  if (homeIdentity.status !== 'inactive') {
    throw new Error('governance_compatibility_requires_inactive_home');
  }
  if (!activation || activation.state !== 'legacy_unmigrated') {
    throw new Error('governance_compatibility_requires_legacy_unmigrated');
  }
  if (!circle) throw new Error('governance_compatibility_circle_missing');
  if (circle.onChainAddress !== homeIdentity.chainAccountRef) {
    throw new Error('governance_compatibility_circle_projection_mismatch');
  }

  const chainInput = {
    network: 'solana:localnet' as const,
    circleId: input.circleId,
    accountRef: circle.onChainAddress,
    commitment: 'confirmed' as const,
  };
  const [chainReadback, openProposals, mutationSurfaces] = await Promise.all([
    chainReader.readCircle(chainInput),
    chainReader.listOpenTransferProposals(chainInput),
    dependencies.mutationSurfaceReader.readCircleMutationSurfaces(),
  ]);
  if (
    !input.expectedOwnerPubkey
    || input.expectedOwnerPubkey !== input.expectedOwnerPubkey.trim()
    || chainReadback.curators[0] !== input.expectedOwnerPubkey
  ) {
    throw new Error('governance_compatibility_chain_owner_required');
  }

  const verifiedChainReadback = normalizeExpectedPostLockReadback(
    chainReadback,
    existingBundle?.bundle?.chainReadback ?? null,
    input.expectedPostLockActionMask,
  );
  const projectionSlot = safeProjectionSlot(circle.lastSyncedSlot);
  const projectionFacts = {
    circleId: circle.id,
    onChainAddress: circle.onChainAddress,
    creatorPubkey: circle.creator?.pubkey ?? null,
    lifecycleStatus: String(circle.lifecycleStatus),
    kind: circle.kind,
    mode: circle.mode,
    minCrystals: circle.minCrystals,
    lastSyncedSlot: projectionSlot,
  };
  const blockers = ['legacy_program_incomplete'];
  if (!verifiedChainReadback.decisionEngine) blockers.push('decision_engine_unresolved');
  if (String(circle.lifecycleStatus) !== verifiedChainReadback.lifecycleStatus) {
    blockers.push('circle_lifecycle_projection_mismatch');
  }
  if (projectionSlot > verifiedChainReadback.observedSlot) {
    blockers.push('circle_projection_slot_ahead_of_chain_readback');
  }
  const activeDbOwners = (circle.members ?? [])
    .filter((member: any) => member.role === 'Owner' && member.status === 'Active')
    .map((member: any) => member.user.pubkey);
  if (
    activeDbOwners.length !== 1
    || !verifiedChainReadback.curators[0]
    || activeDbOwners[0] !== verifiedChainReadback.curators[0]
  ) {
    blockers.push('circle_owner_projection_mismatch');
  }

  const bundleInput: GovernanceLegacyCompatibilityBundleInput = {
    network: 'solana:localnet',
    homeIdentity: {
      ref: homeIdentity.id,
      version: homeIdentity.identityVersion,
      digest: homeIdentity.bindingDigest,
    },
    circleProjection: {
      ...projectionFacts,
      stateDigest: hashCanonicalGovernanceValue(PROJECTION_DIGEST_DOMAIN, projectionFacts),
    },
    chainReadback: {
      ...verifiedChainReadback,
      observedSlot: existingBundle
        ? safeProjectionSlot(existingBundle.sourceSlot)
        : verifiedChainReadback.observedSlot,
    },
    roles: [
      ...verifiedChainReadback.curators.map((actorRef, index) => ({
        actorRef,
        role: index === 0 ? 'ChainOwner' : 'ChainCurator',
        status: 'Active',
        evidenceRef: `program:circle.curators:${index}`,
      })),
      ...(circle.members ?? []).map((member: any) => ({
        actorRef: member.user.pubkey,
        role: String(member.role),
        status: String(member.status),
        evidenceRef: `db:circle-member:${member.onChainAddress}`,
      })),
    ],
    routes: mutationSurfaces.routes,
    bindings: bindings.map((binding: any) => ({
      bindingRef: binding.id,
      actionType: binding.actionType ?? binding.actionPrefix ?? null,
      status: binding.status,
      evidenceDigest: hashCanonicalGovernanceValue(BINDING_DIGEST_DOMAIN, {
        id: binding.id,
        bindingType: binding.bindingType,
        actionType: binding.actionType ?? null,
        actionPrefix: binding.actionPrefix ?? null,
        committeeCircleId: binding.committeeCircleId,
        policyVersionId: binding.policyVersionId,
        ruleId: binding.ruleId,
        status: binding.status,
      }),
    })),
    assetJobs: [
      ...assets.map((asset: any) => ({
        jobRef: `crystal-asset:${asset.id}`,
        jobType: 'master_asset',
        status: asset.mintStatus,
        disposition: terminalAssetStatus(asset.mintStatus) ? 'read_only' as const : 'blocked' as const,
      })),
      ...receipts.map((receipt: any) => ({
        jobRef: `crystal-receipt:${receipt.id}`,
        jobType: 'personal_receipt',
        status: receipt.mintStatus,
        disposition: terminalAssetStatus(receipt.mintStatus) ? 'read_only' as const : 'blocked' as const,
      })),
    ],
    providerRefs: [
      {
        providerType: 'circle_program',
        providerRef: verifiedChainReadback.accountOwnerProgramId,
        versionRef: verifiedChainReadback.programVersionRef,
      },
      {
        providerType: 'mutation_surface_ledger',
        providerRef: mutationSurfaces.sourceInputDigest,
        versionRef: mutationSurfaces.gitHead,
      },
    ],
    governanceRequests: requests.map((request: any) => ({
      requestRef: request.id,
      actionType: request.actionType,
      state: request.state,
      disposition: terminalRequestState(request.state) ? 'read_only' as const : 'blocked' as const,
    })),
    openTransferProposals: openProposals.map((proposal) => ({
      ...proposal,
      disposition: 'read_only' as const,
    })),
    actionMatrix: LEGACY_GOVERNANCE_ACTIONS.map((actionType) => ({
      actionType,
      currentPath: `program:${actionType}`,
      authority: 'legacy_program_instruction_rule',
      disposition: 'continue_legacy_direct' as const,
      inFlightRefs: openProposals.map((proposal) => proposal.proposalRef),
      rollback: 'keep_legacy_unmigrated',
      risk: 'legacy_program_incomplete',
    })),
    blockers,
  };

  createGovernanceLegacyCompatibilityBundle(bundleInput);
  const store = dependencies.store
    ?? createPrismaGovernanceLegacyCompatibilityBundleStore(prisma);
  return store.persistGovernanceLegacyCompatibilityBundle({
    ...input,
    bundle: bundleInput,
  });
}

function normalizeExpectedPostLockReadback(
  current: LegacyCircleProgramReadback,
  previous: LegacyCircleProgramReadback | null,
  expectedActionMask: number | undefined,
): LegacyCircleProgramReadback {
  if (expectedActionMask === undefined) return current;
  if (!previous || expectedActionMask !== 31) {
    throw new Error('governance_compatibility_post_lock_baseline_missing');
  }
  const previousFlags = BigInt(previous.flags);
  const expectedFlags = (previousFlags & ((1n << 18n) - 1n))
    | (1n << 18n)
    | (BigInt(expectedActionMask) << 22n);
  const comparableCurrent = {
    ...current,
    observedSlot: previous.observedSlot,
    flags: previous.flags,
    stateDigest: previous.stateDigest,
  };
  if (
    BigInt(current.flags) !== expectedFlags
    || current.observedSlot < previous.observedSlot
    || !isDeepStrictEqual(comparableCurrent, previous)
  ) {
    throw new Error('governance_compatibility_post_lock_unexpected_drift');
  }
  return comparableCurrent;
}

function terminalAssetStatus(value: string): boolean {
  return ['minted', 'confirmed', 'cancelled'].includes(String(value).toLowerCase());
}

function terminalRequestState(value: string): boolean {
  return ['executed', 'rejected', 'expired', 'cancelled', 'failed'].includes(String(value).toLowerCase());
}

function safeProjectionSlot(value: unknown): number {
  let numeric: bigint;
  try {
    numeric = typeof value === 'bigint' ? value : BigInt(String(value));
  } catch {
    throw new Error('invalid_governance_compatibility_projection_slot');
  }
  if (numeric < 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('invalid_governance_compatibility_projection_slot');
  }
  return Number(numeric);
}
