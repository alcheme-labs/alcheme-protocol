import { isDeepStrictEqual } from 'node:util';

import { hashCanonicalGovernanceValue } from './canonicalCodec';

const FENCE_ID = 'crystal-asset-job-migration:solana:localnet';
const EVIDENCE_DOMAIN = 'alcheme.governance.crystal-asset-job-migration';
const JOB_TYPE = 'crystal_asset_issue';

export type CrystalAssetJobMigrationDisposition =
  | 'minted_read_only'
  | 'submitted_reconciled'
  | 'quarantine_waiting_opt_in'
  | 'failed_no_auto_retry'
  | 'legacy_inflight_unrecoverable'
  | 'reconciliation_blocked';

export interface CrystalAssetJobMigrationRecord {
  id: string;
  aiJobId: number;
  network: 'solana:localnet';
  observedStatus: string;
  disposition: CrystalAssetJobMigrationDisposition;
  knowledgeRowId: number | null;
  circleId: number | null;
  payerRef: string;
  ownerRef: string;
  notificationDisposition: string;
  mintAddress: string | null;
  transactionSignature: string | null;
  readbackStatus: string;
  evidenceDigest: string;
  createdAt: Date;
}

export interface CrystalAssetJobMigrationChainReader {
  readMintAttempt(input: {
    network: 'solana:localnet';
    transactionSignature: string;
    mintAddress: string;
  }): Promise<{
    signatureStatus: 'finalized' | 'not_found' | 'ambiguous';
    mintInitialized: boolean | null;
  }>;
}

export async function isCrystalAssetJobMigrationFenced(prisma: any): Promise<boolean> {
  if (!prisma?.crystalAssetJobMigrationFence?.findUnique) {
    throw new Error('crystal_asset_job_migration_fence_store_required');
  }
  const fence = await prisma.crystalAssetJobMigrationFence.findUnique({ where: { id: FENCE_ID } });
  return fence?.network === 'solana:localnet' && fence?.state === 'fenced';
}

export async function persistCrystalAssetJobMigrationCutover(
  dependencies: {
    prisma: any;
    chainReader: CrystalAssetJobMigrationChainReader;
    authorizeCutover(input: {
      network: 'solana:localnet';
      reason: string;
    }): Promise<{ authorized: boolean; actorRef: string; evidenceRef: string }>;
  },
  input: {
    network: 'solana:localnet';
    reason: string;
    now: Date;
  },
): Promise<{
  fenceState: 'fenced';
  records: CrystalAssetJobMigrationRecord[];
  counts: Record<CrystalAssetJobMigrationDisposition, number>;
}> {
  if (input.network !== 'solana:localnet') {
    throw new Error('crystal_asset_job_migration_devnet_not_enabled');
  }
  if (!input.reason || input.reason !== input.reason.trim()) {
    throw new Error('crystal_asset_job_migration_reason_required');
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new Error('crystal_asset_job_migration_time_invalid');
  }
  const { prisma } = dependencies;
  const authorization = await dependencies.authorizeCutover({
    network: input.network,
    reason: input.reason,
  });
  if (
    !authorization.authorized
    || !isCanonicalText(authorization.actorRef)
    || !isCanonicalText(authorization.evidenceRef)
  ) {
    throw new Error('crystal_asset_job_migration_authorization_required');
  }
  await activateMigrationFence(prisma, {
    network: input.network,
    reason: input.reason,
    actorRef: authorization.actorRef,
    evidenceRef: authorization.evidenceRef,
    now: input.now,
  });
  const jobs = await prisma.aiJob.findMany({
    where: { jobType: JOB_TYPE },
    orderBy: { id: 'asc' },
  });
  const desired: CrystalAssetJobMigrationRecord[] = [];
  for (const job of jobs) {
    const existing = await prisma.crystalAssetJobMigrationRecord.findUnique({
      where: { aiJobId: Number(job.id) },
    });
    desired.push(existing ? pickRecord(existing) : await classifyJob(dependencies, job, input));
  }

  const records: CrystalAssetJobMigrationRecord[] = await prisma.$transaction(async (tx: any) => {
    const fence = await tx.crystalAssetJobMigrationFence.findUnique({ where: { id: FENCE_ID } });
    if (!isExactFence(fence, {
      network: input.network,
      reason: input.reason,
      actorRef: authorization.actorRef,
      evidenceRef: authorization.evidenceRef,
      now: input.now,
    })) throw new Error('crystal_asset_job_migration_fence_drift');
    const persisted: CrystalAssetJobMigrationRecord[] = [];
    for (const record of desired) {
      const existing = await tx.crystalAssetJobMigrationRecord.findUnique({
        where: { aiJobId: record.aiJobId },
      });
      if (existing) {
        const picked = pickRecord(existing);
        if (!isDeepStrictEqual(picked, record)) {
          throw new Error('crystal_asset_job_migration_immutable_mismatch');
        }
        persisted.push(picked);
      } else {
        await applyJobDisposition(tx, record, input.now);
        persisted.push(pickRecord(await tx.crystalAssetJobMigrationRecord.create({ data: record })));
      }
    }
    return persisted;
  });

  const counts = emptyCounts();
  for (const record of records) counts[record.disposition] += 1;
  return deepFreeze({ fenceState: 'fenced', records, counts });
}

async function applyJobDisposition(
  tx: any,
  record: CrystalAssetJobMigrationRecord,
  now: Date,
): Promise<void> {
  if (record.disposition === 'failed_no_auto_retry' || record.disposition === 'minted_read_only') {
    return;
  }
  const terminalSuccess = record.disposition === 'submitted_reconciled';
  const errorCode = record.disposition === 'quarantine_waiting_opt_in'
    ? 'crystal_asset_job_quarantined_waiting_opt_in'
    : record.disposition === 'legacy_inflight_unrecoverable'
      ? 'crystal_asset_job_legacy_inflight_unrecoverable'
      : 'crystal_asset_job_reconciliation_blocked';
  const updated = await tx.aiJob.updateMany({
    where: {
      id: record.aiJobId,
      status: record.observedStatus,
      jobType: JOB_TYPE,
    },
    data: {
      status: terminalSuccess ? 'succeeded' : 'failed',
      completedAt: now,
      claimedAt: null,
      workerId: null,
      claimToken: null,
      lastErrorCode: terminalSuccess ? null : errorCode,
      lastErrorMessage: terminalSuccess
        ? null
        : `P01-M6 migration disposition: ${record.disposition}`,
      updatedAt: now,
    },
  });
  if (Number(updated?.count || 0) !== 1) {
    throw new Error('crystal_asset_job_migration_job_state_drift');
  }
}

async function activateMigrationFence(
  prisma: any,
  input: {
    network: 'solana:localnet';
    reason: string;
    actorRef: string;
    evidenceRef: string;
    now: Date;
  },
): Promise<void> {
  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await tx.crystalAssetJobMigrationFence.findUnique({ where: { id: FENCE_ID } });
      if (existing) {
        if (!isExactFence(existing, input)) {
          throw new Error('crystal_asset_job_migration_fence_immutable_mismatch');
        }
        return;
      }
      await tx.crystalAssetJobMigrationFence.create({
        data: {
          id: FENCE_ID,
          network: input.network,
          state: 'fenced',
          reason: input.reason,
          activatedByRef: input.actorRef,
          authorizationEvidenceRef: input.evidenceRef,
          activatedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.crystalAssetJobMigrationFence.findUnique({ where: { id: FENCE_ID } });
    if (!isExactFence(raced, input)) {
      throw new Error('crystal_asset_job_migration_fence_immutable_mismatch');
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002');
}

function isExactFence(fence: any, input: {
  network: 'solana:localnet'; reason: string; actorRef: string; evidenceRef: string; now: Date;
}): boolean {
  return !!fence
    && fence.network === input.network
    && fence.state === 'fenced'
    && fence.reason === input.reason
    && fence.activatedByRef === input.actorRef
    && fence.authorizationEvidenceRef === input.evidenceRef
    && new Date(fence.activatedAt).getTime() === input.now.getTime();
}

async function classifyJob(
  dependencies: { prisma: any; chainReader: CrystalAssetJobMigrationChainReader },
  job: any,
  input: { network: 'solana:localnet'; reason: string; now: Date },
): Promise<CrystalAssetJobMigrationRecord> {
  const payload = plainObject(job.payloadJson);
  const knowledgeRowId = positiveIntegerOrNull(payload.knowledgeRowId);
  const asset = knowledgeRowId
    ? await dependencies.prisma.crystalAsset.findUnique({ where: { knowledgeRowId } })
    : null;
  const transactionSignature = canonicalOptionalText(payload.transactionSignature);
  const mintAddress = canonicalOptionalText(payload.mintAddress) ?? canonicalOptionalText(asset?.masterAssetAddress);
  const observedStatus = String(job.status || '').trim().toLowerCase();
  let disposition: CrystalAssetJobMigrationDisposition;
  let readbackStatus: string;

  if (observedStatus === 'succeeded' && asset?.mintStatus === 'minted' && mintAddress) {
    disposition = 'minted_read_only';
    readbackStatus = 'db_minted_projection_requires_release_revalidation';
  } else if (observedStatus === 'queued') {
    disposition = 'quarantine_waiting_opt_in';
    readbackStatus = 'not_sent';
  } else if (observedStatus === 'failed') {
    disposition = 'failed_no_auto_retry';
    readbackStatus = 'failed_terminal_no_retry';
  } else if (observedStatus === 'running' && (!transactionSignature || !mintAddress)) {
    disposition = 'legacy_inflight_unrecoverable';
    readbackStatus = 'missing_persisted_intent_or_signature';
  } else if (observedStatus === 'running' && transactionSignature && mintAddress) {
    const readback = await dependencies.chainReader.readMintAttempt({
      network: input.network,
      transactionSignature,
      mintAddress,
    });
    if (readback.signatureStatus === 'finalized' && readback.mintInitialized === true) {
      disposition = 'submitted_reconciled';
      readbackStatus = 'finalized_mint_initialized';
    } else {
      disposition = 'reconciliation_blocked';
      readbackStatus = `${readback.signatureStatus}:${String(readback.mintInitialized)}`;
    }
  } else {
    disposition = 'reconciliation_blocked';
    readbackStatus = 'unknown_legacy_job_state';
  }

  const facts = {
    schemaVersion: 1,
    network: input.network,
    aiJobId: Number(job.id),
    observedStatus,
    disposition,
    knowledgeRowId,
    circleId: positiveIntegerOrNull(job.scopeCircleId),
    payerRef: job.requestedByUserId ? `user:${job.requestedByUserId}` : 'legacy_runtime_config',
    ownerRef: asset?.ownerPubkey ? `wallet:${asset.ownerPubkey}` : 'owner_unresolved',
    notificationDisposition: ['minted_read_only', 'submitted_reconciled'].includes(disposition)
      ? 'historical_status_only'
      : 'manual_audit_required',
    mintAddress,
    transactionSignature,
    readbackStatus,
  };
  const { schemaVersion: _schemaVersion, ...recordFacts } = facts;
  return deepFreeze({
    id: `crystal-asset-job-migration:${job.id}`,
    ...recordFacts,
    evidenceDigest: hashCanonicalGovernanceValue(EVIDENCE_DOMAIN, facts),
    createdAt: new Date(input.now),
  });
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveIntegerOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function canonicalOptionalText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) {
    throw new Error('crystal_asset_job_migration_non_canonical_evidence');
  }
  return value;
}

function isCanonicalText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function pickRecord(value: any): CrystalAssetJobMigrationRecord {
  return deepFreeze({
    id: value.id,
    aiJobId: Number(value.aiJobId),
    network: value.network,
    observedStatus: value.observedStatus,
    disposition: value.disposition,
    knowledgeRowId: value.knowledgeRowId ?? null,
    circleId: value.circleId ?? null,
    payerRef: value.payerRef,
    ownerRef: value.ownerRef,
    notificationDisposition: value.notificationDisposition,
    mintAddress: value.mintAddress ?? null,
    transactionSignature: value.transactionSignature ?? null,
    readbackStatus: value.readbackStatus,
    evidenceDigest: value.evidenceDigest,
    createdAt: new Date(value.createdAt),
  });
}

function emptyCounts(): Record<CrystalAssetJobMigrationDisposition, number> {
  return {
    minted_read_only: 0,
    submitted_reconciled: 0,
    quarantine_waiting_opt_in: 0,
    failed_no_auto_retry: 0,
    legacy_inflight_unrecoverable: 0,
    reconciliation_blocked: 0,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
