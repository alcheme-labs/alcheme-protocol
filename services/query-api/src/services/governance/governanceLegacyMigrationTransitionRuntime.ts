import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  LEGACY_GOVERNANCE_ACTIONS,
  type LegacyGovernanceAction,
} from './governanceLegacyCompatibilityBundle';
import type { GovernanceLegacyCompatibilityBundleRecord } from './governanceLegacyCompatibilityBundleStore';
import type { GovernanceLegacyActionCutoverStore } from './governanceLegacyActionCutoverRuntime';

const OPEN_PROPOSAL_DISPOSITION_DOMAIN =
  'alcheme.governance.legacy-open-proposal-disposition' as const;

const ACTION_BITS: Record<LegacyGovernanceAction, number> = {
  propose_transfer: 1 << 0,
  vote: 1 << 1,
  submit_ai_evaluation: 1 << 2,
  execute_transfer: 1 << 3,
  update_decision_engine: 1 << 4,
};

export interface GovernanceLegacyMigrationTransitionPreview {
  network: 'solana:localnet';
  compatibilityBundleId: string;
  compatibilityBundleDigest: string;
  homeIdentityBindingId: string;
  circleId: number;
  circleAccountRef: string;
  expectedOwnerPubkey: string;
  actions: LegacyGovernanceAction[];
  actionMask: number;
  openProposalDispositionDigest: string;
}

export interface GovernanceLegacyMigrationOwnerLockReadback {
  circleAccountRef: string;
  migrationRecordRef: string;
  preMigrationOwner: string;
  compatibilityBundleDigest: string;
  openProposalDispositionDigest: string;
  lockedActionMask: number;
  circleLockedActionMask: number;
}

export interface GovernanceLegacyMigrationExecutor {
  signerPubkey: string;
  readOwnerLock(
    preview: GovernanceLegacyMigrationTransitionPreview,
  ): Promise<GovernanceLegacyMigrationOwnerLockReadback | null>;
  executeOwnerLock(preview: GovernanceLegacyMigrationTransitionPreview): Promise<{
    transactionSignature: string;
    readback: GovernanceLegacyMigrationOwnerLockReadback;
  }>;
}

export function prepareGovernanceLegacyMigrationTransition(
  record: GovernanceLegacyCompatibilityBundleRecord,
  input: { actions: LegacyGovernanceAction[] },
): GovernanceLegacyMigrationTransitionPreview {
  if (
    record.network !== 'solana:localnet'
    || record.bundle.network !== 'solana:localnet'
  ) {
    throw new Error('governance_migration_transition_devnet_not_enabled');
  }
  if (
    record.id.length === 0
    || record.bundleDigest.length !== 64
    || record.homeIdentityBindingId !== record.bundle.homeIdentity.ref
    || record.circleId !== record.bundle.circleProjection.circleId
    || record.circleId !== record.bundle.chainReadback.circleId
    || record.bundle.circleProjection.onChainAddress !== record.bundle.chainReadback.accountRef
  ) {
    throw new Error('governance_migration_transition_bundle_subject_mismatch');
  }
  const unsupportedBlockers = record.bundle.blockers.filter(
    (blocker) => blocker !== 'legacy_program_incomplete',
  );
  if (unsupportedBlockers.length > 0) {
    throw new Error('governance_migration_transition_bundle_blocked');
  }
  const expectedOwnerPubkey = record.bundle.chainReadback.curators[0];
  if (!expectedOwnerPubkey) {
    throw new Error('governance_migration_transition_owner_missing');
  }
  const requested = new Set(input.actions);
  if (
    requested.size !== input.actions.length
    || requested.size !== LEGACY_GOVERNANCE_ACTIONS.length
    || [...requested].some((action) => !LEGACY_GOVERNANCE_ACTIONS.includes(action))
  ) {
    throw new Error('invalid_governance_migration_transition_actions');
  }
  const actions = LEGACY_GOVERNANCE_ACTIONS.filter((action) => requested.has(action));
  const actionMask = actions.reduce((mask, action) => mask | ACTION_BITS[action], 0);
  const openProposalDispositionDigest = hashCanonicalGovernanceValue(
    OPEN_PROPOSAL_DISPOSITION_DOMAIN,
    {
      schemaVersion: 1,
      network: record.bundle.network,
      circleId: record.circleId,
      compatibilityBundleDigest: record.bundleDigest,
      proposals: record.bundle.openTransferProposals,
    },
  );
  return deepFreeze({
    network: 'solana:localnet',
    compatibilityBundleId: record.id,
    compatibilityBundleDigest: record.bundleDigest,
    homeIdentityBindingId: record.homeIdentityBindingId,
    circleId: record.circleId,
    circleAccountRef: record.bundle.chainReadback.accountRef,
    expectedOwnerPubkey,
    actions,
    actionMask,
    openProposalDispositionDigest,
  });
}

export async function executeGovernanceLegacyMigrationTransition(
  dependencies: {
    loadCompatibilityBundle(
      compatibilityBundleId: string,
    ): Promise<GovernanceLegacyCompatibilityBundleRecord>;
    revalidateCompatibilityBundle(
      compatibilityBundleId: string,
    ): Promise<GovernanceLegacyCompatibilityBundleRecord>;
    executor: GovernanceLegacyMigrationExecutor;
    actionCutoverStore: GovernanceLegacyActionCutoverStore;
    now?: () => Date;
  },
  input: {
    compatibilityBundleId: string;
    actions: LegacyGovernanceAction[];
  },
) {
  if (!input.compatibilityBundleId || input.compatibilityBundleId !== input.compatibilityBundleId.trim()) {
    throw new Error('invalid_governance_migration_transition_bundle_id');
  }
  const record = await dependencies.loadCompatibilityBundle(input.compatibilityBundleId);
  if (record.id !== input.compatibilityBundleId) {
    throw new Error('governance_migration_transition_bundle_subject_mismatch');
  }
  const preview = prepareGovernanceLegacyMigrationTransition(record, { actions: input.actions });
  if (dependencies.executor.signerPubkey !== preview.expectedOwnerPubkey) {
    throw new Error('governance_migration_transition_owner_signature_required');
  }

  const existing = await dependencies.executor.readOwnerLock(preview);
  if (existing) {
    verifyOwnerLockReadback(preview, existing);
    const result = transitionResult(preview, existing, null, true);
    const actionCutover = await dependencies.actionCutoverStore.persistVerifiedCutover({
      compatibilityBundle: record,
      preview,
      migrationRecordRef: existing.migrationRecordRef,
      transactionSignature: null,
      lockedActionMask: existing.lockedActionMask,
      createdAt: (dependencies.now ?? (() => new Date()))(),
    });
    return deepFreeze({ ...result, actionCutover });
  }

  const revalidated = await dependencies.revalidateCompatibilityBundle(input.compatibilityBundleId);
  const currentPreview = prepareGovernanceLegacyMigrationTransition(revalidated, {
    actions: input.actions,
  });
  if (!isSamePreview(preview, currentPreview)) {
    throw new Error('governance_migration_transition_bundle_drift');
  }

  const executed = await dependencies.executor.executeOwnerLock(currentPreview);
  if (
    !executed.transactionSignature
    || executed.transactionSignature !== executed.transactionSignature.trim()
  ) {
    throw new Error('governance_migration_transition_signature_missing');
  }
  verifyOwnerLockReadback(preview, executed.readback);
  const result = transitionResult(
    preview,
    executed.readback,
    executed.transactionSignature,
    false,
  );
  const actionCutover = await dependencies.actionCutoverStore.persistVerifiedCutover({
    compatibilityBundle: revalidated,
    preview,
    migrationRecordRef: executed.readback.migrationRecordRef,
    transactionSignature: executed.transactionSignature,
    lockedActionMask: executed.readback.lockedActionMask,
    createdAt: (dependencies.now ?? (() => new Date()))(),
  });
  return deepFreeze({ ...result, actionCutover });
}

function isSamePreview(
  left: GovernanceLegacyMigrationTransitionPreview,
  right: GovernanceLegacyMigrationTransitionPreview,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyOwnerLockReadback(
  preview: GovernanceLegacyMigrationTransitionPreview,
  readback: GovernanceLegacyMigrationOwnerLockReadback,
): void {
  if (
    readback.circleAccountRef !== preview.circleAccountRef
    || !readback.migrationRecordRef
    || readback.preMigrationOwner !== preview.expectedOwnerPubkey
    || readback.compatibilityBundleDigest !== preview.compatibilityBundleDigest
    || readback.openProposalDispositionDigest !== preview.openProposalDispositionDigest
    || readback.lockedActionMask !== preview.actionMask
    || (readback.circleLockedActionMask & preview.actionMask) !== preview.actionMask
  ) {
    throw new Error('governance_migration_transition_readback_mismatch');
  }
}

function transitionResult(
  preview: GovernanceLegacyMigrationTransitionPreview,
  readback: GovernanceLegacyMigrationOwnerLockReadback,
  transactionSignature: string | null,
  recoveredFromExisting: boolean,
) {
  return deepFreeze({
    ...preview,
    migrationRecordRef: readback.migrationRecordRef,
    lockedActionMask: readback.lockedActionMask,
    transactionSignature,
    recoveredFromExisting,
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
