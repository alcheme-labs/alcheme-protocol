import { isDeepStrictEqual } from 'node:util';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_DOMAIN,
  LEGACY_GOVERNANCE_ACTIONS,
  type LegacyDisposition,
  type LegacyGovernanceAction,
} from './governanceLegacyCompatibilityBundle';
import type { GovernanceLegacyCompatibilityBundleRecord } from './governanceLegacyCompatibilityBundleStore';
import type {
  GovernanceLegacyMigrationTransitionPreview,
} from './governanceLegacyMigrationTransitionRuntime';

const ACTION_CUTOVER_DOMAIN = 'alcheme.governance.legacy-action-cutover' as const;
const FULL_LEGACY_ACTION_MASK = 31;

export type GovernanceLegacyActionCutoverState =
  | 'cutover_active'
  | 'rolled_back'
  | 'recovery_required';

export interface GovernanceLegacyActionCutoverEntry {
  actionType: LegacyGovernanceAction;
  disposition: LegacyDisposition;
  cutover: 'owner_lock_readback_verified';
  inFlightDisposition: 'preserve_read_only' | 'block_and_reconcile';
  rollback: 'program_upgrade_or_new_circle_required';
}

export interface GovernanceLegacyActionCutoverRecord {
  id: string;
  compatibilityBundleId: string;
  homeIdentityBindingId: string;
  circleId: number;
  network: 'solana:localnet';
  bundleDigest: string;
  migrationRecordRef: string;
  transactionSignature: string | null;
  lockedActionMask: number;
  state: GovernanceLegacyActionCutoverState;
  actionMatrix: GovernanceLegacyActionCutoverEntry[];
  actionMatrixDigest: string;
  recoveryActionType: LegacyGovernanceAction | null;
  recoveryCode: GovernanceLegacyActionRecoveryCode | null;
  recoveryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CutoverPersistenceClient {
  governanceCompatibilityBundle: { findUnique(input: unknown): Promise<any> };
  governanceLegacyActionCutover: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
}

type CutoverPrisma = CutoverPersistenceClient & {
  $transaction<T>(operation: (tx: CutoverPersistenceClient) => Promise<T>): Promise<T>;
};

export interface GovernanceLegacyActionCutoverStore {
  persistVerifiedCutover(input: {
    compatibilityBundle: GovernanceLegacyCompatibilityBundleRecord;
    preview: GovernanceLegacyMigrationTransitionPreview;
    migrationRecordRef: string;
    transactionSignature: string | null;
    lockedActionMask: number;
    createdAt: Date;
  }): Promise<GovernanceLegacyActionCutoverRecord>;
  markRecoveryRequired(input: {
    record: GovernanceLegacyActionCutoverRecord;
    actionType: LegacyGovernanceAction;
    recoveryCode: GovernanceLegacyActionRecoveryCode;
    recoveryAt: Date;
  }): Promise<GovernanceLegacyActionCutoverRecord>;
  restoreVerifiedActive(input: {
    record: GovernanceLegacyActionCutoverRecord;
    readback: GovernanceLegacyActionRecoveryReadback;
    gatewayReady: boolean;
    providerReady: boolean;
  }): Promise<GovernanceLegacyActionCutoverRecord>;
}

export type GovernanceLegacyActionRecoveryCode =
  | 'gateway_unavailable'
  | 'provider_unavailable';

export interface GovernanceLegacyActionRecoveryReadback {
  migrationRecordRef: string;
  compatibilityBundleDigest: string;
  lockedActionMask: number;
  circleLockedActionMask: number;
}

export type GovernanceLegacyActionBoundaryResult =
  | {
      status: 'read_only';
      actionType: LegacyGovernanceAction;
      route: null;
      fallbackAllowed: false;
      recovery: null;
    }
  | {
      status: 'routed';
      actionType: LegacyGovernanceAction;
      route: 'governance_case' | 'governed_invocation';
      fallbackAllowed: false;
      recovery: null;
    }
  | {
      status: 'recovery_required';
      actionType: LegacyGovernanceAction;
      route: null;
      fallbackAllowed: false;
      recovery: GovernanceLegacyActionCutoverRecord;
    };

export function createPrismaGovernanceLegacyActionCutoverStore(
  prisma: CutoverPrisma,
): GovernanceLegacyActionCutoverStore {
  return {
    async persistVerifiedCutover(input) {
      const desired = createVerifiedCutoverRecord(input);
      try {
        return await prisma.$transaction(async (tx) => {
          const bundle = await tx.governanceCompatibilityBundle.findUnique({
            where: { id: desired.compatibilityBundleId },
          });
          if (
            !bundle
            || bundle.bundleDigest !== desired.bundleDigest
            || bundle.homeIdentityBindingId !== desired.homeIdentityBindingId
            || bundle.circleId !== desired.circleId
            || bundle.network !== desired.network
            || !isDeepStrictEqual(
              JSON.parse(JSON.stringify(bundle.bundle)),
              JSON.parse(JSON.stringify(input.compatibilityBundle.bundle)),
            )
          ) {
            throw new Error('governance_action_cutover_bundle_mismatch');
          }
          const existing = await tx.governanceLegacyActionCutover.findUnique({
            where: { compatibilityBundleId: desired.compatibilityBundleId },
          });
          if (existing) return exactExisting(existing, desired);
          return pickRecord(await tx.governanceLegacyActionCutover.create({ data: desired }));
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await prisma.governanceLegacyActionCutover.findUnique({
          where: { compatibilityBundleId: desired.compatibilityBundleId },
        });
        if (!raced) throw error;
        return exactExisting(raced, desired);
      }
    },
    async markRecoveryRequired(input) {
      requireRecoveryTransition(input.record, input.actionType, input.recoveryCode, input.recoveryAt);
      const update = await prisma.governanceLegacyActionCutover.updateMany({
        where: {
          id: input.record.id,
          state: 'cutover_active',
          actionMatrixDigest: input.record.actionMatrixDigest,
        },
        data: {
          state: 'recovery_required',
          recoveryActionType: input.actionType,
          recoveryCode: input.recoveryCode,
          recoveryAt: input.recoveryAt,
        },
      });
      const current = await prisma.governanceLegacyActionCutover.findUnique({
        where: { id: input.record.id },
      });
      if (!current) throw new Error('governance_action_cutover_missing');
      const record = pickRecord(current);
      if (update.count === 0) {
        if (
          record.state !== 'recovery_required'
          || record.recoveryActionType !== input.actionType
          || record.recoveryCode !== input.recoveryCode
        ) {
          throw new Error('governance_action_cutover_recovery_conflict');
        }
      }
      return record;
    },
    async restoreVerifiedActive(input) {
      verifyRecoveryReadback(input.record, input.readback);
      if (!input.gatewayReady || !input.providerReady) {
        throw new Error('governance_action_cutover_recovery_dependency_unavailable');
      }
      const update = await prisma.governanceLegacyActionCutover.updateMany({
        where: {
          id: input.record.id,
          state: 'recovery_required',
          actionMatrixDigest: input.record.actionMatrixDigest,
          recoveryActionType: input.record.recoveryActionType,
          recoveryCode: input.record.recoveryCode,
        },
        data: {
          state: 'cutover_active',
          recoveryActionType: null,
          recoveryCode: null,
          recoveryAt: null,
        },
      });
      const current = await prisma.governanceLegacyActionCutover.findUnique({
        where: { id: input.record.id },
      });
      if (!current) throw new Error('governance_action_cutover_missing');
      const record = pickRecord(current);
      if (update.count === 0 && record.state !== 'cutover_active') {
        throw new Error('governance_action_cutover_recovery_conflict');
      }
      return record;
    },
  };
}

export function createVerifiedCutoverRecord(input: {
  compatibilityBundle: GovernanceLegacyCompatibilityBundleRecord;
  preview: GovernanceLegacyMigrationTransitionPreview;
  migrationRecordRef: string;
  transactionSignature: string | null;
  lockedActionMask: number;
  createdAt: Date;
}): GovernanceLegacyActionCutoverRecord {
  const { compatibilityBundle: bundle, preview } = input;
  if (
    hashCanonicalGovernanceValue(
      GOVERNANCE_LEGACY_COMPATIBILITY_BUNDLE_DOMAIN,
      bundle.bundle,
    ) !== bundle.bundleDigest
  ) {
    throw new Error('governance_action_cutover_bundle_digest_mismatch');
  }
  if (
    bundle.network !== 'solana:localnet'
    || preview.network !== 'solana:localnet'
    || bundle.id !== preview.compatibilityBundleId
    || bundle.bundleDigest !== preview.compatibilityBundleDigest
    || bundle.homeIdentityBindingId !== preview.homeIdentityBindingId
    || bundle.circleId !== preview.circleId
  ) {
    throw new Error('governance_action_cutover_bundle_mismatch');
  }
  if (
    preview.actions.length !== LEGACY_GOVERNANCE_ACTIONS.length
    || LEGACY_GOVERNANCE_ACTIONS.some((action) => !preview.actions.includes(action))
    || preview.actionMask !== FULL_LEGACY_ACTION_MASK
    || input.lockedActionMask !== FULL_LEGACY_ACTION_MASK
  ) {
    throw new Error('governance_action_cutover_incomplete_lock');
  }
  if (!input.migrationRecordRef || input.migrationRecordRef !== input.migrationRecordRef.trim()) {
    throw new Error('governance_action_cutover_migration_record_required');
  }
  if (
    input.transactionSignature !== null
    && (!input.transactionSignature || input.transactionSignature !== input.transactionSignature.trim())
  ) {
    throw new Error('governance_action_cutover_invalid_signature');
  }
  const baseline = new Map(bundle.bundle.actionMatrix.map((entry) => [entry.actionType, entry]));
  if (
    baseline.size !== LEGACY_GOVERNANCE_ACTIONS.length
    || LEGACY_GOVERNANCE_ACTIONS.some((action) => baseline.get(action)?.disposition !== 'continue_legacy_direct')
  ) {
    throw new Error('governance_action_cutover_baseline_mismatch');
  }
  const actionMatrix = LEGACY_GOVERNANCE_ACTIONS.map(actionCutoverEntry);
  const actionMatrixDigest = hashCanonicalGovernanceValue(ACTION_CUTOVER_DOMAIN, {
    schemaVersion: 1,
    network: 'solana:localnet',
    compatibilityBundleDigest: bundle.bundleDigest,
    migrationRecordRef: input.migrationRecordRef,
    lockedActionMask: input.lockedActionMask,
    actionMatrix,
  });
  return deepFreeze({
    id: `legacy-action-cutover:${bundle.id}`,
    compatibilityBundleId: bundle.id,
    homeIdentityBindingId: bundle.homeIdentityBindingId,
    circleId: bundle.circleId,
    network: 'solana:localnet',
    bundleDigest: bundle.bundleDigest,
    migrationRecordRef: input.migrationRecordRef,
    transactionSignature: input.transactionSignature,
    lockedActionMask: input.lockedActionMask,
    state: 'cutover_active',
    actionMatrix,
    actionMatrixDigest,
    recoveryActionType: null,
    recoveryCode: null,
    recoveryAt: null,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
  });
}

export function assertGovernanceLegacyActionCutoverRecordIntegrity(
  record: GovernanceLegacyActionCutoverRecord,
  compatibilityBundle: GovernanceLegacyCompatibilityBundleRecord,
): void {
  try {
    if (
      !record
      || record.id !== `legacy-action-cutover:${compatibilityBundle.id}`
      || record.compatibilityBundleId !== compatibilityBundle.id
      || record.homeIdentityBindingId !== compatibilityBundle.homeIdentityBindingId
      || record.circleId !== compatibilityBundle.circleId
      || record.network !== compatibilityBundle.network
      || record.bundleDigest !== compatibilityBundle.bundleDigest
      || record.lockedActionMask !== FULL_LEGACY_ACTION_MASK
      || !['cutover_active', 'recovery_required', 'rolled_back'].includes(record.state)
      || !isCanonicalCutoverText(record.migrationRecordRef)
      || (record.transactionSignature !== null
        && !isCanonicalCutoverText(record.transactionSignature))
      || !isGovernanceDigest(record.actionMatrixDigest)
      || !isValidDate(record.createdAt)
      || !isValidDate(record.updatedAt)
      || record.updatedAt.getTime() < record.createdAt.getTime()
    ) {
      throw new Error('invalid_cutover_record');
    }
    verifyCutoverMatrix(record);
    if (record.state === 'recovery_required') {
      if (
        !LEGACY_GOVERNANCE_ACTIONS.includes(record.recoveryActionType as LegacyGovernanceAction)
        || !['gateway_unavailable', 'provider_unavailable'].includes(String(record.recoveryCode))
        || !isValidDate(record.recoveryAt)
        || record.recoveryAt!.getTime() < record.createdAt.getTime()
        || record.recoveryAt!.getTime() > record.updatedAt.getTime()
      ) {
        throw new Error('invalid_cutover_recovery');
      }
    } else if (
      record.recoveryActionType !== null
      || record.recoveryCode !== null
      || record.recoveryAt !== null
    ) {
      throw new Error('unexpected_cutover_recovery');
    }
  } catch {
    throw new Error('governance_action_cutover_record_invalid');
  }
}

export async function resolveLegacyActionAfterCutover(
  store: GovernanceLegacyActionCutoverStore,
  input: {
    record: GovernanceLegacyActionCutoverRecord;
    actionType: string;
    gatewayReady: boolean;
    providerReady: boolean;
    now: Date;
  },
): Promise<GovernanceLegacyActionBoundaryResult> {
  const entry = evaluateLegacyActionAfterCutover(input.record, input.actionType);
  if (entry.disposition === 'read_only') {
    return deepFreeze({
      status: 'read_only', actionType: entry.actionType, route: null,
      fallbackAllowed: false, recovery: null,
    });
  }
  const recoveryCode: GovernanceLegacyActionRecoveryCode | null = !input.gatewayReady
    ? 'gateway_unavailable'
    : !input.providerReady
      ? 'provider_unavailable'
      : null;
  if (recoveryCode) {
    const recovery = await store.markRecoveryRequired({
      record: input.record,
      actionType: entry.actionType,
      recoveryCode,
      recoveryAt: input.now,
    });
    return deepFreeze({
      status: 'recovery_required', actionType: entry.actionType, route: null,
      fallbackAllowed: false, recovery,
    });
  }
  return deepFreeze({
    status: 'routed',
    actionType: entry.actionType,
    route: entry.disposition === 'migrate_to_case'
      ? 'governance_case'
      : 'governed_invocation',
    fallbackAllowed: false,
    recovery: null,
  });
}

export function evaluateLegacyActionAfterCutover(
  record: GovernanceLegacyActionCutoverRecord,
  actionType: string,
): GovernanceLegacyActionCutoverEntry {
  if (!LEGACY_GOVERNANCE_ACTIONS.includes(actionType as LegacyGovernanceAction)) {
    throw new Error('unknown_governance_legacy_mutation_blocked');
  }
  if (record.state !== 'cutover_active' || record.lockedActionMask !== FULL_LEGACY_ACTION_MASK) {
    throw new Error('governance_action_cutover_not_active');
  }
  verifyCutoverMatrix(record);
  const entry = record.actionMatrix.find((candidate) => candidate.actionType === actionType);
  if (!entry) throw new Error('unknown_governance_legacy_mutation_blocked');
  return deepFreeze({ ...entry });
}

function verifyCutoverMatrix(record: GovernanceLegacyActionCutoverRecord): void {
  const matrixDigest = hashCanonicalGovernanceValue(ACTION_CUTOVER_DOMAIN, {
    schemaVersion: 1,
    network: record.network,
    compatibilityBundleDigest: record.bundleDigest,
    migrationRecordRef: record.migrationRecordRef,
    lockedActionMask: record.lockedActionMask,
    actionMatrix: record.actionMatrix,
  });
  if (matrixDigest !== record.actionMatrixDigest) {
    throw new Error('governance_action_cutover_matrix_digest_mismatch');
  }
  const expectedMatrix = LEGACY_GOVERNANCE_ACTIONS.map(actionCutoverEntry);
  if (
    record.actionMatrix.length !== LEGACY_GOVERNANCE_ACTIONS.length
    || !isDeepStrictEqual(record.actionMatrix, expectedMatrix)
  ) {
    throw new Error('unknown_governance_legacy_mutation_blocked');
  }
}

function actionCutoverEntry(actionType: LegacyGovernanceAction): GovernanceLegacyActionCutoverEntry {
  if (actionType === 'propose_transfer') {
    return {
      actionType,
      disposition: 'migrate_to_case',
      cutover: 'owner_lock_readback_verified',
      inFlightDisposition: 'preserve_read_only',
      rollback: 'program_upgrade_or_new_circle_required',
    };
  }
  if (actionType === 'update_decision_engine') {
    return {
      actionType,
      disposition: 'migrate_to_invocation',
      cutover: 'owner_lock_readback_verified',
      inFlightDisposition: 'block_and_reconcile',
      rollback: 'program_upgrade_or_new_circle_required',
    };
  }
  return {
    actionType,
    disposition: 'read_only',
    cutover: 'owner_lock_readback_verified',
    inFlightDisposition: 'preserve_read_only',
    rollback: 'program_upgrade_or_new_circle_required',
  };
}

function exactExisting(existing: any, desired: GovernanceLegacyActionCutoverRecord) {
  const record = pickRecord(existing);
  const immutableExisting = immutableCutoverFacts(record);
  const immutableDesired = immutableCutoverFacts(desired);
  if (
    !isDeepStrictEqual(immutableExisting, immutableDesired)
    || (
      desired.transactionSignature !== null
      && record.transactionSignature !== desired.transactionSignature
    )
  ) {
    throw new Error('governance_action_cutover_immutable_mismatch');
  }
  return record;
}

function immutableCutoverFacts(record: GovernanceLegacyActionCutoverRecord) {
  return {
    id: record.id,
    compatibilityBundleId: record.compatibilityBundleId,
    homeIdentityBindingId: record.homeIdentityBindingId,
    circleId: record.circleId,
    network: record.network,
    bundleDigest: record.bundleDigest,
    migrationRecordRef: record.migrationRecordRef,
    lockedActionMask: record.lockedActionMask,
    state: record.state,
    actionMatrix: record.actionMatrix,
    actionMatrixDigest: record.actionMatrixDigest,
  };
}

function requireRecoveryTransition(
  record: GovernanceLegacyActionCutoverRecord,
  actionType: LegacyGovernanceAction,
  recoveryCode: GovernanceLegacyActionRecoveryCode,
  recoveryAt: Date,
): void {
  evaluateLegacyActionAfterCutover(record, actionType);
  if (!['gateway_unavailable', 'provider_unavailable'].includes(recoveryCode)) {
    throw new Error('governance_action_cutover_invalid_recovery_code');
  }
  if (!(recoveryAt instanceof Date) || !Number.isFinite(recoveryAt.getTime())) {
    throw new Error('governance_action_cutover_invalid_recovery_time');
  }
}

function verifyRecoveryReadback(
  record: GovernanceLegacyActionCutoverRecord,
  readback: GovernanceLegacyActionRecoveryReadback,
): void {
  if (record.state !== 'recovery_required') {
    throw new Error('governance_action_cutover_recovery_not_required');
  }
  verifyCutoverMatrix(record);
  if (
    readback.migrationRecordRef !== record.migrationRecordRef
    || readback.compatibilityBundleDigest !== record.bundleDigest
    || readback.lockedActionMask !== FULL_LEGACY_ACTION_MASK
    || readback.circleLockedActionMask !== FULL_LEGACY_ACTION_MASK
  ) {
    throw new Error('governance_action_cutover_recovery_readback_mismatch');
  }
}

function pickRecord(value: any): GovernanceLegacyActionCutoverRecord {
  return deepFreeze({
    ...value,
    network: value.network as 'solana:localnet',
    state: value.state as GovernanceLegacyActionCutoverState,
    actionMatrix: JSON.parse(JSON.stringify(value.actionMatrix)),
    recoveryActionType: value.recoveryActionType ?? null,
    recoveryCode: value.recoveryCode ?? null,
    recoveryAt: value.recoveryAt ? new Date(value.recoveryAt) : null,
    createdAt: new Date(value.createdAt),
    updatedAt: new Date(value.updatedAt),
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002');
}

function isCanonicalCutoverText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isGovernanceDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
