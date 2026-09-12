import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type {
  CircleLifecycleChainEvidence,
  GovernanceCircleLifecycleAction,
} from './governanceCircleLifecycleRuntime';

const RETENTION_DESTRUCTION_COORDINATION_POLICY = {
  ref: 'DEC-RETENTION-DESTRUCTION-P03-COORDINATION',
  version: 'v1',
  effectiveDate: '2026-07-15',
} as const;

export type GovernanceHomeLifecyclePlanStatus =
  | 'awaiting_wallet'
  | 'reconciliation_pending'
  | 'converged'
  | 'dissolution_pending'
  | 'merge_pending'
  | 'merged'
  | 'blocked';

export interface LifecycleAuthoritativeIndexerReceipt {
  programId: string;
  checkpointSlot: number;
  lastSuccessfulSync: string | null;
  runtimePhase: string | null;
  unresolvedFailureSlot: number | null;
  /**
   * Optional indexer-owned circle observation. Must not be filled from the
   * query-api Circle row written by reconcileCircleLifecycleFromChain.
   */
  circleProjectionSlot: number | null;
  circleProjectionLifecycleStatus: string | null;
}

export type GovernanceHomeLifecyclePlanAction =
  | GovernanceCircleLifecycleAction
  | 'dissolve'
  | 'merge';

export interface GovernanceHomeLifecyclePlan {
  schemaVersion: 1;
  kind: 'governance_home_lifecycle_plan';
  id: string;
  homeIdentityBindingId: string;
  circleId: number;
  action: GovernanceHomeLifecyclePlanAction;
  fromLifecycleState: 'active' | 'archived';
  targetLifecycleState: 'active' | 'archived' | 'dissolution_pending' | 'merged';
  status: GovernanceHomeLifecyclePlanStatus;
  stateVersion: number;
  governingRequestId: string;
  governingDecisionDigest: string;
  governanceExecutionReceiptId: string;
  actorPubkey: string;
  reason: string | null;
  dispositionSnapshot: Record<string, unknown>;
  dissolutionPolicy?: Record<string, unknown>;
  mergePolicy?: Record<string, unknown>;
  sourceCircleIds?: number[];
  reconciliation: Record<string, unknown>;
  blockerCodes: string[];
  planDigest: string;
  reconciliationDigest: string;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceHomeLifecycleTimelineExport {
  schemaVersion: 1;
  kind: 'governance_home_lifecycle_timeline_export';
  circleId: number;
  homeIdentityBindingId: string;
  lifecyclePlanId: string;
  planDigest: string;
  events: Array<{
    sequence: number;
    type: 'plan_created' | 'disposition_frozen' | 'consent_and_retention' | 'successor_links' | 'reconciliation' | 'blockers' | 'final_state';
    occurredAt: string;
    facts: Record<string, unknown>;
  }>;
  externalAuthority: {
    status: 'p06_authoritative_readback_required' | 'p06_authoritative_readback_converged';
    authoritative: boolean;
    ownerPackage: 'P06';
  };
  exportedAt: string;
  exportDigest: string;
}

export interface LifecyclePlanPrisma {
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceExecutionReceipt: {
    findUnique(input: unknown): Promise<any>;
    findFirst(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  governanceCase: { findMany(input: unknown): Promise<any[]> };
  governanceRequest: { findMany(input: unknown): Promise<any[]> };
  governedActionInvocation: { findMany(input: unknown): Promise<any[]> };
  governedActionAppeal: { findMany(input: unknown): Promise<any[]> };
  operationEffect: { findMany(input: unknown): Promise<any[]> };
  governanceMandate: { findMany(input: unknown): Promise<any[]> };
  governanceGrantAgreement: { findMany(input: unknown): Promise<any[]> };
  costPreflight: { findMany(input: unknown): Promise<any[]> };
  governanceRecoveryPolicy: { findMany(input: unknown): Promise<any[]> };
  circleForkLineage: { findMany(input: unknown): Promise<any[]> };
  circleMergeLineage?: { findFirst(input: unknown): Promise<any>; findMany(input: unknown): Promise<any[]> };
  circle: {
    findUnique(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  $transaction?<T>(operation: (tx: LifecyclePlanPrisma) => Promise<T>): Promise<T>;
}

export async function prepareGovernanceHomeLifecyclePlan(
  prisma: LifecyclePlanPrisma,
  input: {
    circleId: number;
    action: GovernanceHomeLifecyclePlanAction;
    currentLifecycleStatus: string;
    actorPubkey: string;
    reason: string | null;
    governingRequestId: string;
    governingDecisionDigest: string;
    governanceExecutionReceipt: any;
    requestHomeIdentityBindingId: string | null;
    allowAlreadyProjectedWithChainEvidence?: boolean;
    dissolutionExitWindowEndsAt?: string | null;
    retentionSuccessorHomeIdentityBindingId?: string | null;
    now?: Date;
  },
): Promise<GovernanceHomeLifecyclePlan> {
  assertPrepareInput(input);
  if (input.action === 'merge') {
    throw new Error('circle_merge_requires_merge_producer');
  }
  const identity = await prisma.governanceHomeIdentityBinding.findUnique({
    where: {
      homeType_homeRef_identityVersion: {
        homeType: 'circle',
        homeRef: String(input.circleId),
        identityVersion: 1,
      },
    },
  });
  if (!identity || identity.status !== 'active') {
    throw new Error('circle_lifecycle_governance_home_missing_or_inactive');
  }
  if (input.requestHomeIdentityBindingId !== identity.id) {
    throw new Error('circle_lifecycle_governance_home_request_mismatch');
  }
  if (input.action === 'dissolve' && input.retentionSuccessorHomeIdentityBindingId) {
    const successor = await prisma.governanceHomeIdentityBinding.findUnique({
      where: { id: input.retentionSuccessorHomeIdentityBindingId },
    });
    if (!successor || successor.status !== 'active' || successor.id === identity.id) {
      throw new Error('circle_dissolution_retention_successor_invalid');
    }
  }

  const receipt = input.governanceExecutionReceipt;
  assertReceiptOwnsRequest(receipt, input);
  const existing = parseGovernanceHomeLifecyclePlan(receipt.executionEvidence);
  if (existing) {
    assertReceiptEvidenceIntegrity(receipt, existing);
    assertExistingPlan(existing, identity.id, input);
    return existing;
  }
  if (receipt.executionEvidence != null) {
    throw new Error('circle_lifecycle_receipt_evidence_conflict');
  }

  let fromLifecycleState = normalizeLifecycleState(input.currentLifecycleStatus);
  const targetLifecycleState: 'active' | 'archived' | 'dissolution_pending' =
    input.action === 'restore'
      ? 'active'
      : input.action === 'dissolve'
        ? 'dissolution_pending'
        : 'archived';
  const expectedFrom: 'active' | 'archived' = input.action === 'restore'
    ? 'archived'
    : 'active';
  const permittedDissolutionSource = input.action === 'dissolve'
    && (fromLifecycleState === 'active' || fromLifecycleState === 'archived');
  if (fromLifecycleState !== expectedFrom && !permittedDissolutionSource) {
    if (
      input.allowAlreadyProjectedWithChainEvidence
      && fromLifecycleState === targetLifecycleState
    ) {
      fromLifecycleState = expectedFrom;
    } else {
      throw new Error('circle_lifecycle_plan_state_transition_invalid');
    }
  }

  const reason = normalizeReason(input.reason);
  const dispositionSnapshot = await buildDispositionSnapshot(
    prisma,
    identity.id,
    input.circleId,
    input.action,
  );
  const planNow = input.now ?? new Date();
  const immutablePlan = {
    schemaVersion: 1 as const,
    homeIdentityBindingId: identity.id,
    circleId: input.circleId,
    action: input.action,
    fromLifecycleState,
    targetLifecycleState,
    governingRequestId: input.governingRequestId,
    governingDecisionDigest: input.governingDecisionDigest,
    governanceExecutionReceiptId: receipt.id,
    actorPubkey: input.actorPubkey,
    reason,
    dispositionSnapshot,
    ...(input.action === 'dissolve'
      ? {
          dissolutionPolicy: buildDissolutionPolicy({
            exitWindowEndsAt: input.dissolutionExitWindowEndsAt,
            retentionSuccessorHomeIdentityBindingId:
              input.retentionSuccessorHomeIdentityBindingId,
            dispositionSnapshot,
            now: planNow,
          }),
        }
      : {}),
  };
  const planDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.home-lifecycle-plan',
    immutablePlan,
  );
  const id = `gov_lifecycle_${planDigest.slice(0, 64)}`;
  const reconciliation = input.action === 'dissolve'
    ? buildDissolutionPendingReconciliation({
        planId: id,
        dispositionSnapshot,
        dissolutionPolicy: asRecord((immutablePlan as any).dissolutionPolicy),
      })
    : buildAwaitingWalletReconciliation({
        planId: id,
        action: input.action,
        targetLifecycleState,
      });
  const now = planNow.toISOString();
  const plan: GovernanceHomeLifecyclePlan = {
    ...immutablePlan,
    kind: 'governance_home_lifecycle_plan',
    id,
    status: input.action === 'dissolve' ? 'dissolution_pending' : 'awaiting_wallet',
    stateVersion: 0,
    reconciliation,
    blockerCodes: input.action === 'dissolve'
      ? dissolutionBlockerCodes(dispositionSnapshot, asRecord((immutablePlan as any).dissolutionPolicy))
      : [
          'wallet_transaction_required',
          'p06_authoritative_finality_required',
          'p06_indexer_convergence_required',
        ],
    planDigest,
    reconciliationDigest: hashReconciliation(reconciliation),
    createdAt: now,
    updatedAt: now,
  };
  if (input.action === 'dissolve') {
    await persistDissolutionPending(prisma, receipt, plan);
  } else {
    await updateReceiptWithPlan(prisma, receipt, plan, {
      errorCode: 'wallet_finalization_required',
      executionRef: receipt.executionRef ?? String(input.circleId),
    });
  }
  return plan;
}

export async function recordGovernanceHomeLifecycleReconciliationPending(
  prisma: LifecyclePlanPrisma,
  input: {
    receiptId: string;
    evidence: CircleLifecycleChainEvidence;
    projectedLifecycleStatus: string;
    now?: Date;
  },
): Promise<GovernanceHomeLifecyclePlan> {
  const receipt = await requireReceipt(prisma, input.receiptId);
  const plan = requireReceiptPlan(receipt);
  const projectedLifecycleState = normalizeLifecycleState(input.projectedLifecycleStatus);
  if (
    plan.action === 'dissolve'
    ||
    plan.circleId !== input.evidence.circleId
    || plan.action !== input.evidence.action
    || plan.targetLifecycleState !== projectedLifecycleState
  ) {
    throw new Error('circle_lifecycle_plan_reconciliation_target_mismatch');
  }
  const reconciliation = {
    schemaVersion: 1,
    status: 'reconciliation_pending',
    offChainIntent: {
      status: 'persisted',
      lifecyclePlanId: plan.id,
      planDigest: plan.planDigest,
    },
    localProjection: {
      status: 'confirmed_projection',
      lifecycleStatus: projectedLifecycleState,
      observedSlot: input.evidence.observedSlot,
      selfProvesFinality: false,
    },
    chain: {
      status: 'confirmed_not_finalized',
      network: input.evidence.network,
      transactionSignature: input.evidence.transactionSignature,
      transactionSlot: input.evidence.transactionSlot,
      observedSlot: input.evidence.observedSlot,
      stateDigest: input.evidence.stateDigest,
      commitment: input.evidence.commitment ?? 'confirmed',
      authoritative: false,
      ownerPackage: 'P06',
      selfProvesFinality: false,
    },
    indexer: {
      status: 'p06_readback_required',
      receiptRef: null,
      authoritative: false,
      ownerPackage: 'P06',
      selfProvesConvergence: false,
    },
    finalityPolicy: {
      transactionCommitment: 'finalized',
      indexerState: 'converged',
      satisfied: false,
    },
    pathDiagnostics: {
      dbFirst: true,
      chainFirst: false,
      indexerLag: true,
      partialRestore: false,
      confirmedTransactionSelfProvesSuccess: false,
      databaseProjectionSelfProvesSuccess: false,
      normalizedReceiptSelfProvesSuccess: false,
    },
  };
  const reconciliationDigest = hashReconciliation(reconciliation);
  if (
    plan.status === 'reconciliation_pending'
    && plan.reconciliationDigest === reconciliationDigest
  ) {
    return plan;
  }
  if (plan.status !== 'awaiting_wallet') {
    throw new Error('circle_lifecycle_plan_state_conflict');
  }
  const updatedPlan: GovernanceHomeLifecyclePlan = {
    ...plan,
    status: 'reconciliation_pending',
    stateVersion: plan.stateVersion + 1,
    reconciliation,
    blockerCodes: [
      'p06_authoritative_finality_required',
      'p06_indexer_convergence_required',
    ],
    reconciliationDigest,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  await updateReceiptWithPlan(prisma, receipt, updatedPlan, {
    errorCode: 'external_reconciliation_pending',
    executionRef: input.evidence.transactionSignature,
  });
  return updatedPlan;
}

export async function convergeGovernanceHomeLifecycleAuthoritativeReadback(
  prisma: LifecyclePlanPrisma,
  input: {
    receiptId: string;
    finalizedEvidence: CircleLifecycleChainEvidence;
    indexerReceipt: LifecycleAuthoritativeIndexerReceipt;
    localProjection: {
      lifecycleStatus: string;
      lastSyncedSlot: number;
    };
    now?: Date;
  },
): Promise<GovernanceHomeLifecyclePlan> {
  const receipt = await requireReceipt(prisma, input.receiptId);
  const plan = requireReceiptPlan(receipt);
  if (plan.status === 'converged') {
    return plan;
  }
  if (plan.status !== 'reconciliation_pending') {
    throw new Error('circle_lifecycle_plan_convergence_state_conflict');
  }
  if (plan.action === 'dissolve' || plan.action === 'merge') {
    throw new Error('circle_lifecycle_plan_convergence_action_unsupported');
  }
  if (input.finalizedEvidence.commitment !== 'finalized') {
    throw new Error('circle_lifecycle_transaction_not_finalized');
  }
  const pendingChain = asRecord(asRecord(plan.reconciliation).chain);
  const pendingSignature = String(pendingChain.transactionSignature || '');
  if (
    !pendingSignature
    || pendingSignature !== input.finalizedEvidence.transactionSignature
    || plan.circleId !== input.finalizedEvidence.circleId
    || plan.action !== input.finalizedEvidence.action
  ) {
    throw new Error('circle_lifecycle_plan_convergence_target_mismatch');
  }

  const projectedLifecycleState = normalizeLifecycleState(input.localProjection.lifecycleStatus);
  const chainLifecycleState = normalizeLifecycleState(input.finalizedEvidence.lifecycleStatus);
  const optionalIndexerLifecycleState = input.indexerReceipt.circleProjectionLifecycleStatus == null
    ? null
    : normalizeLifecycleState(input.indexerReceipt.circleProjectionLifecycleStatus);
  const expectedLifecycleState = plan.targetLifecycleState;
  if (expectedLifecycleState !== 'active' && expectedLifecycleState !== 'archived') {
    throw new Error('circle_lifecycle_plan_convergence_target_mismatch');
  }

  const observedSlot = safeNonNegativeInt(input.finalizedEvidence.observedSlot);
  const transactionSlot = safeNonNegativeInt(input.finalizedEvidence.transactionSlot);
  const localProjectionSlot = safeNonNegativeInt(input.localProjection.lastSyncedSlot);
  const programId = String(input.indexerReceipt.programId || '').trim();
  if (!programId) throw new Error('circle_lifecycle_indexer_program_missing');
  const checkpointConfigured = input.indexerReceipt.checkpointSlot != null
    && Number.isSafeInteger(Number(input.indexerReceipt.checkpointSlot))
    && Number(input.indexerReceipt.checkpointSlot) >= 0;
  const checkpointSlot = checkpointConfigured
    ? safeNonNegativeInt(input.indexerReceipt.checkpointSlot)
    : null;
  const circleProjectionConfigured = input.indexerReceipt.circleProjectionSlot != null
    && Number.isSafeInteger(Number(input.indexerReceipt.circleProjectionSlot))
    && Number(input.indexerReceipt.circleProjectionSlot) >= 0;
  const circleProjectionSlot = circleProjectionConfigured
    ? safeNonNegativeInt(input.indexerReceipt.circleProjectionSlot)
    : null;
  const independentCircleProjection = circleProjectionConfigured
    && optionalIndexerLifecycleState != null
    && !(
      optionalIndexerLifecycleState === projectedLifecycleState
      && circleProjectionSlot === localProjectionSlot
    );
  if (
    circleProjectionConfigured
    && !independentCircleProjection
  ) {
    // Reject query-api Circle rows reused as "indexer projection".
    throw new Error('circle_lifecycle_indexer_projection_not_independent');
  }

  const chainMatches = chainLifecycleState === expectedLifecycleState;
  const localMatches = projectedLifecycleState === expectedLifecycleState;
  const indexerCaughtUp = checkpointConfigured
    && (checkpointSlot as number) >= observedSlot
    && input.indexerReceipt.unresolvedFailureSlot == null;
  const indexerCircleMatches = !independentCircleProjection
    || (
      optionalIndexerLifecycleState === expectedLifecycleState
      && (circleProjectionSlot as number) >= transactionSlot
    );
  const partialRestore = plan.action === 'restore'
    && (!chainMatches || !localMatches || !indexerCircleMatches);
  const pathDiagnostics = {
    dbFirst: localMatches && !chainMatches,
    chainFirst: chainMatches && !localMatches,
    indexerLag: chainMatches && localMatches && (!indexerCaughtUp || !checkpointConfigured),
    partialRestore,
    confirmedTransactionSelfProvesSuccess: false,
    databaseProjectionSelfProvesSuccess: false,
    normalizedReceiptSelfProvesSuccess: false,
    circleRowSelfProvesIndexer: false,
  };

  if (!chainMatches || !localMatches || partialRestore) {
    throw new Error(partialRestore
      ? 'circle_lifecycle_partial_restore_divergence'
      : 'circle_lifecycle_authoritative_readback_mismatch');
  }

  const chainReceiptRef = `solana:localnet:tx:${input.finalizedEvidence.transactionSignature}:finalized`;
  const indexerReceiptRef = checkpointConfigured
    ? `indexer:sync_checkpoint:${programId}:${checkpointSlot}`
    : `indexer:sync_checkpoint:${programId}:not_configured`;
  if (!indexerCaughtUp || !indexerCircleMatches) {
    const lagReconciliation = {
      schemaVersion: 1,
      status: 'reconciliation_pending',
      offChainIntent: {
        status: 'persisted',
        lifecyclePlanId: plan.id,
        planDigest: plan.planDigest,
      },
      localProjection: {
        status: 'confirmed_projection',
        lifecycleStatus: projectedLifecycleState,
        observedSlot: localProjectionSlot,
        selfProvesFinality: false,
      },
      chain: {
        status: 'finalized',
        network: input.finalizedEvidence.network,
        transactionSignature: input.finalizedEvidence.transactionSignature,
        transactionSlot,
        observedSlot,
        stateDigest: input.finalizedEvidence.stateDigest,
        commitment: 'finalized',
        authoritative: true,
        ownerPackage: 'P06',
        receiptRef: chainReceiptRef,
        selfProvesFinality: false,
      },
      indexer: {
        status: !checkpointConfigured
          ? 'not_configured'
          : !indexerCaughtUp
            ? 'indexer_lag'
            : 'projection_mismatch',
        receiptRef: indexerReceiptRef,
        programId,
        checkpointSlot,
        lastSuccessfulSync: input.indexerReceipt.lastSuccessfulSync,
        runtimePhase: input.indexerReceipt.runtimePhase,
        unresolvedFailureSlot: input.indexerReceipt.unresolvedFailureSlot,
        circleProjectionSlot,
        circleProjectionLifecycleStatus: optionalIndexerLifecycleState,
        authoritative: false,
        ownerPackage: 'P06',
        selfProvesConvergence: false,
        crossCheck: !checkpointConfigured
          ? 'rpc_finalized_only_indexer_not_configured'
          : !indexerCaughtUp
            ? 'rpc_finalized_indexer_program_checkpoint_behind'
            : 'rpc_finalized_indexer_projection_mismatch',
      },
      finalityPolicy: {
        transactionCommitment: 'finalized',
        indexerState: 'converged',
        satisfied: false,
      },
      pathDiagnostics,
      finalState: {
        status: 'not_written',
        reason: 'indexer_authoritative_convergence_required',
      },
    };
    const reconciliationDigest = hashReconciliation(lagReconciliation);
    if (plan.reconciliationDigest === reconciliationDigest) return plan;
    const updatedPending: GovernanceHomeLifecyclePlan = {
      ...plan,
      status: 'reconciliation_pending',
      stateVersion: plan.stateVersion + 1,
      reconciliation: lagReconciliation,
      blockerCodes: ['p06_indexer_convergence_required'],
      reconciliationDigest,
      updatedAt: (input.now ?? new Date()).toISOString(),
    };
    await updateReceiptWithPlan(prisma, receipt, updatedPending, {
      errorCode: 'external_reconciliation_pending',
      executionRef: input.finalizedEvidence.transactionSignature,
      executionStatus: 'skipped',
    });
    return updatedPending;
  }

  const reconciliation = {
    schemaVersion: 1,
    status: 'converged',
    offChainIntent: {
      status: 'persisted',
      lifecyclePlanId: plan.id,
      planDigest: plan.planDigest,
    },
    localProjection: {
      status: 'confirmed_projection',
      lifecycleStatus: projectedLifecycleState,
      observedSlot: localProjectionSlot,
      selfProvesFinality: false,
    },
    chain: {
      status: 'finalized',
      network: input.finalizedEvidence.network,
      transactionSignature: input.finalizedEvidence.transactionSignature,
      transactionSlot,
      observedSlot,
      stateDigest: input.finalizedEvidence.stateDigest,
      commitment: 'finalized',
      authoritative: true,
      ownerPackage: 'P06',
      receiptRef: chainReceiptRef,
      selfProvesFinality: false,
    },
    indexer: {
      status: 'converged',
      receiptRef: indexerReceiptRef,
      programId,
      checkpointSlot,
      lastSuccessfulSync: input.indexerReceipt.lastSuccessfulSync,
      runtimePhase: input.indexerReceipt.runtimePhase,
      unresolvedFailureSlot: null,
      circleProjectionSlot: independentCircleProjection ? circleProjectionSlot : null,
      circleProjectionLifecycleStatus: independentCircleProjection
        ? optionalIndexerLifecycleState
        : null,
      authoritative: true,
      ownerPackage: 'P06',
      selfProvesConvergence: false,
      crossCheck: 'rpc_finalized_and_indexer_program_checkpoint_converged',
    },
    finalityPolicy: {
      transactionCommitment: 'finalized',
      indexerState: 'converged',
      satisfied: true,
    },
    pathDiagnostics: {
      ...pathDiagnostics,
      dbFirst: false,
      chainFirst: false,
      indexerLag: false,
      partialRestore: false,
    },
    finalState: {
      status: 'written',
      lifecycleStatus: expectedLifecycleState,
      convergenceMode: 'db_chain_indexer_converged',
      governingRequestId: plan.governingRequestId,
      governanceExecutionReceiptId: plan.governanceExecutionReceiptId,
    },
  };
  const reconciliationDigest = hashReconciliation(reconciliation);
  const updatedPlan: GovernanceHomeLifecyclePlan = {
    ...plan,
    status: 'converged',
    stateVersion: plan.stateVersion + 1,
    reconciliation,
    blockerCodes: [],
    reconciliationDigest,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  await updateReceiptWithPlan(prisma, receipt, updatedPlan, {
    errorCode: 'lifecycle_authoritative_convergence_complete',
    executionRef: input.finalizedEvidence.transactionSignature,
    executionStatus: 'executed',
  });
  return updatedPlan;
}

export async function recordGovernanceHomeLifecycleBlocked(
  prisma: LifecyclePlanPrisma,
  input: { receiptId: string; blockerCode: string; now?: Date },
): Promise<GovernanceHomeLifecyclePlan> {
  const receipt = await requireReceipt(prisma, input.receiptId);
  const plan = requireReceiptPlan(receipt);
  if (plan.status !== 'awaiting_wallet') return plan;
  const blockerCode = normalizeBlockerCode(input.blockerCode);
  const reconciliation = {
    ...asRecord(plan.reconciliation),
    status: 'blocked',
    failure: { code: blockerCode },
  };
  const updatedPlan: GovernanceHomeLifecyclePlan = {
    ...plan,
    status: 'blocked',
    stateVersion: plan.stateVersion + 1,
    reconciliation,
    blockerCodes: [blockerCode],
    reconciliationDigest: hashReconciliation(reconciliation),
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
  await updateReceiptWithPlan(prisma, receipt, updatedPlan, {
    errorCode: blockerCode.slice(0, 64),
    executionRef: receipt.executionRef ?? String(plan.circleId),
  });
  return updatedPlan;
}

export async function readLatestGovernanceHomeLifecyclePlan(
  prisma: LifecyclePlanPrisma,
  circleId: number,
): Promise<GovernanceHomeLifecyclePlan | null> {
  const receipt = await prisma.governanceExecutionReceipt.findFirst({
    where: {
      executorModule: 'circle_lifecycle',
      actionType: { in: [
        'circle.lifecycle.archive',
        'circle.lifecycle.restore',
        'circle.lifecycle.dissolve',
        'circle.lifecycle.merge.successor_accept',
      ] },
      request: { targetType: 'circle', targetRef: String(circleId) },
      executionEvidence: {
        path: ['kind'],
        equals: 'governance_home_lifecycle_plan',
      },
    },
    orderBy: [{ executedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const lineage = typeof prisma.circleMergeLineage?.findFirst === 'function'
    ? await prisma.circleMergeLineage.findFirst({
        where: {
          OR: [
            { sourceCircleId: circleId },
            { successorCircleId: circleId },
          ],
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;
  const mergeReceipt = lineage
    ? await prisma.governanceExecutionReceipt.findUnique({
        where: { id: lineage.governanceExecutionReceiptId },
      })
    : null;
  if (!receipt) return mergeReceipt ? requireReceiptPlan(mergeReceipt) : null;
  if (!mergeReceipt) return requireReceiptPlan(receipt);
  const receiptTime = timestamp(receipt.executedAt ?? receipt.createdAt);
  const mergeTime = timestamp(mergeReceipt.executedAt ?? mergeReceipt.createdAt ?? lineage.createdAt);
  return requireReceiptPlan(mergeTime >= receiptTime ? mergeReceipt : receipt);
}

export async function exportLatestGovernanceHomeLifecycleTimeline(
  prisma: LifecyclePlanPrisma,
  input: { circleId: number; exportedAt?: Date },
): Promise<GovernanceHomeLifecycleTimelineExport> {
  const plan = await readLatestGovernanceHomeLifecyclePlan(prisma, input.circleId);
  if (!plan) throw new Error('circle_lifecycle_plan_export_unavailable');
  const forkLineages = await prisma.circleForkLineage.findMany({
    where: {
      OR: [
        { sourceCircleId: input.circleId },
        { targetCircleId: input.circleId },
      ],
    },
    select: {
      lineageId: true,
      sourceCircleId: true,
      targetCircleId: true,
      declarationId: true,
      originAnchorRef: true,
      executionAnchorDigest: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { lineageId: 'asc' }],
  });
  const mergeLineages = typeof prisma.circleMergeLineage?.findMany === 'function'
    ? await prisma.circleMergeLineage.findMany({
        where: {
          OR: [
            { sourceCircleId: input.circleId },
            { successorCircleId: input.circleId },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { lineageId: 'asc' }],
      })
    : [];
  const occurredAt = plan.updatedAt || plan.createdAt;
  const dissolutionPolicy = asRecord(plan.dissolutionPolicy);
  const reconciliation = asRecord(plan.reconciliation);
  const finalState = asRecord(reconciliation.finalState);
  const immutable = {
    schemaVersion: 1 as const,
    kind: 'governance_home_lifecycle_timeline_export' as const,
    circleId: plan.circleId,
    homeIdentityBindingId: plan.homeIdentityBindingId,
    lifecyclePlanId: plan.id,
    planDigest: plan.planDigest,
    events: [
      {
        sequence: 1,
        type: 'plan_created' as const,
        occurredAt: plan.createdAt,
        facts: {
          action: plan.action,
          fromLifecycleState: plan.fromLifecycleState,
          targetLifecycleState: plan.targetLifecycleState,
          governingRequestId: plan.governingRequestId,
          governingDecisionDigest: plan.governingDecisionDigest,
          governanceExecutionReceiptId: plan.governanceExecutionReceiptId,
        },
      },
      {
        sequence: 2,
        type: 'disposition_frozen' as const,
        occurredAt: plan.createdAt,
        facts: {
          dispositionSnapshot: plan.dispositionSnapshot,
          inventoryComplete: asRecord(plan.dispositionSnapshot).inventoryComplete === true,
        },
      },
      {
        sequence: 3,
        type: 'consent_and_retention' as const,
        occurredAt: plan.createdAt,
        facts: {
          memberAndDelegatorNotification: dissolutionPolicy.memberAndDelegatorNotification ?? { status: 'not_applicable' },
          dataExport: dissolutionPolicy.dataExport ?? { status: 'available_from_lifecycle_timeline' },
          retentionSuccessor: dissolutionPolicy.retentionSuccessor ?? { status: 'not_applicable' },
          retentionDestructionCoordination:
            dissolutionPolicy.retentionDestructionCoordination ?? { status: 'not_applicable' },
          exitWindow: dissolutionPolicy.exitWindow ?? { status: 'not_applicable' },
        },
      },
      {
        sequence: 4,
        type: 'successor_links' as const,
        occurredAt,
        facts: {
          forkLineages: forkLineages.map((lineage) => ({
            lineageId: lineage.lineageId,
            sourceCircleId: lineage.sourceCircleId,
            targetCircleId: lineage.targetCircleId,
            relationToCircle: lineage.sourceCircleId === plan.circleId
              ? 'outbound_successor'
              : 'inbound_origin',
            declarationId: lineage.declarationId,
            originAnchorRef: lineage.originAnchorRef ?? null,
            executionAnchorDigest: lineage.executionAnchorDigest ?? null,
            createdAt: lineage.createdAt instanceof Date
              ? lineage.createdAt.toISOString()
              : String(lineage.createdAt),
          })),
          retentionSuccessor: dissolutionPolicy.retentionSuccessor ?? { status: 'not_applicable' },
          mergeLineages: mergeLineages.map((lineage: any) => ({
            lineageId: lineage.lineageId,
            sourceCircleId: lineage.sourceCircleId,
            successorCircleId: lineage.successorCircleId,
            relationToCircle: lineage.sourceCircleId === plan.circleId
              ? 'merged_into_successor'
              : 'accepted_source',
            status: lineage.status,
            lifecyclePlanId: lineage.lifecyclePlanId,
            sourceApprovalRequestId: lineage.sourceApprovalRequestId,
            successorAcceptanceRequestId: lineage.successorAcceptanceRequestId,
            lineageDigest: lineage.lineageDigest,
            mergedAt: dateOrNull(lineage.mergedAt),
          })),
          mergeSuccessor: mergeLineages.length > 0
            ? { status: plan.status, sourceCircleIds: plan.sourceCircleIds ?? [] }
            : { status: 'not_available_no_current_merge_producer' },
        },
      },
      {
        sequence: 5,
        type: 'reconciliation' as const,
        occurredAt,
        facts: {
          status: plan.status,
          reconciliation: plan.reconciliation,
          reconciliationDigest: plan.reconciliationDigest,
        },
      },
      {
        sequence: 6,
        type: 'blockers' as const,
        occurredAt,
        facts: { blockerCodes: [...plan.blockerCodes] },
      },
      {
        sequence: 7,
        type: 'final_state' as const,
        occurredAt,
        facts: Object.keys(finalState).length > 0
          ? finalState
          : {
              status: 'not_finalized',
              currentPlanStatus: plan.status,
              targetLifecycleState: plan.targetLifecycleState,
            },
      },
    ],
    externalAuthority: plan.status === 'converged'
      && asRecord(plan.reconciliation).finalityPolicy
      && asRecord(asRecord(plan.reconciliation).finalityPolicy).satisfied === true
      ? {
          status: 'p06_authoritative_readback_converged' as const,
          authoritative: true as const,
          ownerPackage: 'P06' as const,
        }
      : {
          status: 'p06_authoritative_readback_required' as const,
          authoritative: false as const,
          ownerPackage: 'P06' as const,
        },
  };
  return {
    ...immutable,
    exportedAt: (input.exportedAt ?? new Date()).toISOString(),
    exportDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.home-lifecycle-timeline-export',
      immutable,
    ),
  };
}

export function publicGovernanceHomeLifecyclePlan(
  plan: GovernanceHomeLifecyclePlan | null,
): Record<string, unknown> | null {
  if (!plan) return null;
  return {
    id: plan.id,
    homeIdentityBindingId: plan.homeIdentityBindingId,
    circleId: plan.circleId,
    action: plan.action,
    fromLifecycleState: plan.fromLifecycleState,
    targetLifecycleState: plan.targetLifecycleState,
    status: plan.status,
    stateVersion: plan.stateVersion,
    governingRequestId: plan.governingRequestId,
    governanceExecutionReceiptId: plan.governanceExecutionReceiptId,
    dispositionSnapshot: plan.dispositionSnapshot,
    dissolutionPolicy: plan.dissolutionPolicy ?? null,
    mergePolicy: plan.mergePolicy ?? null,
    sourceCircleIds: plan.sourceCircleIds ?? [],
    reconciliation: plan.reconciliation,
    blockerCodes: plan.blockerCodes,
    planDigest: plan.planDigest,
    reconciliationDigest: plan.reconciliationDigest,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function parseGovernanceHomeLifecyclePlan(
  value: unknown,
): GovernanceHomeLifecyclePlan | null {
  const record = asRecord(value);
  if (record.kind !== 'governance_home_lifecycle_plan' || record.schemaVersion !== 1) {
    return null;
  }
  const action = record.action === 'archive'
    || record.action === 'restore'
    || record.action === 'dissolve'
    || record.action === 'merge'
    ? record.action
    : null;
  const status = record.status === 'awaiting_wallet'
    || record.status === 'reconciliation_pending'
    || record.status === 'converged'
    || record.status === 'dissolution_pending'
    || record.status === 'merge_pending'
    || record.status === 'merged'
    || record.status === 'blocked'
    ? record.status
    : null;
  const fromLifecycleState = normalizeLifecycleStateOrNull(record.fromLifecycleState);
  const targetLifecycleState = record.targetLifecycleState === 'dissolution_pending'
    ? 'dissolution_pending'
    : record.targetLifecycleState === 'merged'
      ? 'merged'
    : normalizeLifecycleStateOrNull(record.targetLifecycleState);
  if (
    !action
    || !status
    || !fromLifecycleState
    || !targetLifecycleState
    || !Number.isInteger(record.circleId)
    || !Number.isInteger(record.stateVersion)
    || !Array.isArray(record.blockerCodes)
  ) {
    throw new Error('circle_lifecycle_plan_evidence_invalid');
  }
  return record as unknown as GovernanceHomeLifecyclePlan;
}

export async function buildDispositionSnapshot(
  prisma: LifecyclePlanPrisma,
  homeIdentityBindingId: string,
  circleId: number,
  action: GovernanceHomeLifecyclePlanAction,
) {
  assertDispositionOwnersAvailable(prisma);
  const homeRef = String(circleId);
  const [cases, requests, invocations, appeals, effects, mandates, grants, costs, recoveryPolicies]
    = await Promise.all([
      prisma.governanceCase.findMany({
        where: {
          homeIdentityBindingId,
          OR: [
            { casePhase: null },
            { casePhase: { notIn: ['closed', 'archived'] } },
          ],
        },
        select: {
          id: true,
          casePhase: true,
          caseType: true,
          primaryRequest: { select: { actionType: true } },
        },
        orderBy: { id: 'asc' },
      }),
      prisma.governanceRequest.findMany({
        where: { homeIdentityBindingId, state: 'active' },
        select: { id: true, state: true, actionType: true },
        orderBy: { id: 'asc' },
      }),
      prisma.governedActionInvocation.findMany({
        where: {
          governanceHomeType: 'circle',
          governanceHomeRef: homeRef,
          state: { in: ['requested', 'preflighted', 'authorized', 'executing', 'blocked'] },
        },
        select: { id: true, state: true, contractVersion: { select: { actionType: true } } },
        orderBy: { id: 'asc' },
      }),
      prisma.governedActionAppeal.findMany({
        where: {
          state: { not: 'resolved' },
          originalInvocation: { governanceHomeType: 'circle', governanceHomeRef: homeRef },
        },
        select: { id: true, state: true, appealWindowEndsAt: true },
        orderBy: { id: 'asc' },
      }),
      prisma.operationEffect.findMany({
        where: {
          state: { in: ['active', 'ratification_required', 'rollback_failed'] },
          invocation: { governanceHomeType: 'circle', governanceHomeRef: homeRef },
        },
        select: { id: true, state: true },
        orderBy: { id: 'asc' },
      }),
      prisma.governanceMandate.findMany({
        where: {
          delegatorGovernanceHomeType: 'circle',
          delegatorGovernanceHomeRef: homeRef,
          status: { in: ['offered', 'countered', 'active', 'suspended'] },
        },
        select: { id: true, status: true, currentVersion: true, currentTermsDigest: true },
        orderBy: { id: 'asc' },
      }),
      prisma.governanceGrantAgreement.findMany({
        where: {
          governanceCase: { homeIdentityBindingId },
          status: { notIn: ['completed', 'terminated'] },
        },
        select: {
          id: true,
          status: true,
          fundingStatus: true,
          terms: true,
          lifecycle: true,
          lifecycleDigest: true,
        },
        orderBy: { id: 'asc' },
      }),
      prisma.costPreflight.findMany({
        where: {
          invocation: { governanceHomeType: 'circle', governanceHomeRef: homeRef },
          status: { in: ['blocked', 'pending', 'ready'] },
        },
        select: { id: true, status: true, expiresAt: true },
        orderBy: { id: 'asc' },
      }),
      prisma.governanceRecoveryPolicy.findMany({
        where: {
          homeIdentityBindingId,
          OR: [
            { status: { in: ['active', 'activated'] } },
            { ratificationStatus: 'pending' },
          ],
        },
        select: { id: true, status: true, ratificationStatus: true, ratificationDeadline: true },
        orderBy: { id: 'asc' },
      }),
    ]);
  const protectedDisposition = (actionType: unknown) => (
    isProtectedArchivedAction(actionType) ? 'continue' : 'suspend'
  );
  return {
    schemaVersion: 1,
    scope: action === 'dissolve'
      ? 'dissolution_current_producer'
      : action === 'merge'
        ? 'merge_current_producer'
      : 'archive_restore_current_producer',
    inventoryComplete: true,
    ordinaryNewGovernance: action === 'restore' ? 'continue' : 'suspend',
    appealRecoveryLegalSafety: action === 'dissolve' ? 'successor_required' : 'continue',
    effectExpiryOrRevoke: 'continue',
    externalReconciliation: 'continue',
    export: 'continue',
    entries: [
      ...cases.map((item) => ({
        kind: 'case', ref: item.id, state: item.casePhase ?? 'legacy_active',
        disposition: action === 'dissolve'
          ? 'manual_resolution'
          : protectedDisposition(item.primaryRequest?.actionType),
      })),
      ...requests.map((item) => ({
        kind: 'request', ref: item.id, state: item.state,
        disposition: action === 'dissolve'
          ? 'manual_resolution'
          : protectedDisposition(item.actionType),
      })),
      ...invocations.map((item) => ({
        kind: 'invocation', ref: item.id, state: item.state,
        disposition: action === 'dissolve'
          ? 'manual_resolution'
          : protectedDisposition(item.contractVersion?.actionType),
      })),
      ...appeals.map((item) => ({
        kind: 'appeal', ref: item.id, state: item.state,
        disposition: action === 'dissolve' ? 'manual_resolution' : 'continue',
        deadline: dateOrNull(item.appealWindowEndsAt),
      })),
      ...effects.map((item) => ({
        kind: 'effect', ref: item.id, state: item.state,
        disposition: action === 'dissolve' ? 'manual_resolution' : 'continue',
      })),
      ...mandates.map((item) => ({
        kind: 'mandate', ref: item.id, state: item.status,
        disposition: action === 'dissolve' ? 'manual_resolution' : 'suspend',
        version: item.currentVersion, digest: item.currentTermsDigest,
      })),
      ...grants.flatMap((item) => [{
        kind: 'grant', ref: item.id, state: item.status, disposition: 'manual_resolution',
        fundingStatus: item.fundingStatus, digest: item.lifecycleDigest,
      }, ...grantMilestoneDispositionEntries(item)]),
      ...costs.map((item) => ({
        kind: 'cost_preflight', ref: item.id, state: item.status, disposition: 'cancel',
        deadline: dateOrNull(item.expiresAt),
      })),
      ...recoveryPolicies.map((item) => ({
        kind: 'recovery_task', ref: item.id,
        state: item.ratificationStatus === 'pending' ? 'ratification_pending' : item.status,
        disposition: action === 'dissolve' ? 'manual_resolution' : 'continue',
        deadline: dateOrNull(item.ratificationDeadline),
      })),
    ],
    externalResources: {
      disposition: 'manual_resolution',
      status: 'p06_authoritative_inventory_required',
      ownerPackage: 'P06',
    },
    ownerCoverage: {
      stage: 'governance_case.decisionStagePlan',
      execution: 'governed_action_invocation',
      pendingReport: 'no_current_governance_report_owner',
      mandateOffer: 'governance_mandate.status',
      grantMilestone: 'governance_grant_agreement.terms_and_lifecycle',
    },
    unresolvedCapabilityObligations: action === 'dissolve'
      ? ['dissolution_completion_requires_p06_and_required_dispositions']
      : ['fork_merge_dissolve_state_matrix_not_closed'],
  };
}

function grantMilestoneDispositionEntries(grant: any): Array<Record<string, unknown>> {
  const milestones = asArray(asRecord(grant.terms).milestones);
  const lifecycle = asRecord(grant.lifecycle);
  const results = asArray(lifecycle.milestoneResults);
  const appeals = asArray(lifecycle.appeals);
  if (milestones.length === 0 || !Array.isArray(lifecycle.milestoneResults) || !Array.isArray(lifecycle.appeals)) {
    throw new Error('circle_lifecycle_grant_milestone_inventory_invalid');
  }
  return milestones.flatMap((milestoneValue) => {
    const milestone = asRecord(milestoneValue);
    const milestoneId = String(milestone.id || '');
    if (!milestoneId) throw new Error('circle_lifecycle_grant_milestone_inventory_invalid');
    const milestoneResults = results
      .map(asRecord)
      .filter((result) => result.milestoneId === milestoneId)
      .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0));
    const openAppeal = appeals
      .map(asRecord)
      .some((appeal) => appeal.milestoneId === milestoneId && appeal.status === 'open');
    const latestOutcome = String(milestoneResults[0]?.outcome || '');
    if (!openAppeal && ['accept', 'reject'].includes(latestOutcome)) return [];
    const state = openAppeal
      ? 'appeal_open'
      : latestOutcome === 'rework'
        ? 'rework_pending'
        : 'pending_review';
    return [{
      kind: 'grant_milestone',
      ref: `${grant.id}:${milestoneId}`,
      state,
      disposition: 'manual_resolution',
      deadline: dateOrNull(milestone.deadline),
      digest: grant.lifecycleDigest,
    }];
  });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function assertDispositionOwnersAvailable(prisma: LifecyclePlanPrisma): void {
  for (const owner of [
    'governanceCase', 'governanceRequest', 'governedActionInvocation',
    'governedActionAppeal', 'operationEffect', 'governanceMandate',
    'governanceGrantAgreement', 'costPreflight', 'governanceRecoveryPolicy',
  ] as const) {
    if (typeof prisma[owner]?.findMany !== 'function') {
      throw new Error('circle_lifecycle_disposition_owner_unavailable');
    }
  }
}

function isProtectedArchivedAction(value: unknown): boolean {
  const actionType = String(value || '').toLowerCase();
  return actionType.includes('appeal')
    || actionType.includes('recovery')
    || actionType.includes('legal')
    || actionType.includes('safety')
    || actionType.includes('reconcile')
    || actionType.includes('export')
    || actionType.endsWith('.revoke');
}

function dateOrNull(value: unknown): string | null {
  if (value == null) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestamp(value: unknown): number {
  if (value == null) return 0;
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildDissolutionPolicy(input: {
  exitWindowEndsAt?: string | null;
  retentionSuccessorHomeIdentityBindingId?: string | null;
  dispositionSnapshot: Record<string, unknown>;
  now: Date;
}): Record<string, unknown> {
  const exitWindowEndsAt = dateOrNull(input.exitWindowEndsAt);
  if (!exitWindowEndsAt) {
    throw new Error('circle_dissolution_exit_window_required');
  }
  const retentionSuccessorHomeIdentityBindingId = String(
    input.retentionSuccessorHomeIdentityBindingId || '',
  ).trim() || null;
  const unexpiredAppealRefs = asArray(input.dispositionSnapshot.entries)
    .map(asRecord)
    .filter((entry) => (
      entry.kind === 'appeal'
      && typeof entry.deadline === 'string'
      && timestamp(entry.deadline) > input.now.getTime()
    ))
    .map((entry) => String(entry.ref))
    .filter(Boolean);
  return {
    schemaVersion: 1,
    riskClass: 'critical',
    authority: 'accepted_circle_lifecycle_dissolve_governance_request',
    irreversibleCutover: 'not_started',
    exitWindow: {
      status: 'open',
      endsAt: exitWindowEndsAt,
    },
    memberAndDelegatorNotification: {
      status: 'required_not_recorded',
      evidenceRef: null,
    },
    dataExport: {
      status: 'required_not_recorded',
      evidenceRef: null,
    },
    retentionSuccessor: {
      status: retentionSuccessorHomeIdentityBindingId ? 'preauthorized' : 'required_not_declared',
      homeIdentityBindingId: retentionSuccessorHomeIdentityBindingId,
      authorization: retentionSuccessorHomeIdentityBindingId
        ? 'accepted_governance_request'
        : 'missing',
      authorityInheritance: 'none',
    },
    retentionDestructionCoordination: {
      schemaVersion: 1,
      status: 'destruction_pending',
      policy: RETENTION_DESTRUCTION_COORDINATION_POLICY,
      publicRecordVisibility: {
        status: 'current_access_control_preserved',
        projection: 'public_safe_lifecycle_metadata_only',
        privateContent: 'existing_visibility_and_access_control',
        contentMutationAuthorized: false,
      },
      legalHold: {
        status: 'p05_authoritative_status_required',
        evidenceRef: null,
        authoritative: false,
        ownerPackage: 'P05',
      },
      unexpiredAppeal: {
        status: unexpiredAppealRefs.length > 0
          ? 'blocked_unexpired_appeal'
          : 'none_observed_in_current_p03_inventory',
        refs: unexpiredAppealRefs,
        observedAt: input.now.toISOString(),
        ownerPackage: 'P03',
      },
      destructionAuthorization: {
        status: 'p05_authoritative_authorization_required',
        evidenceRef: null,
        authoritative: false,
        ownerPackage: 'P05',
      },
      downstreamCompletionEvidence: {
        P04: {
          disposition: 'pending',
          status: 'authoritative_completion_evidence_required',
          evidenceRef: null,
          evidenceDigest: null,
          ownerPackage: 'P04',
        },
        P05: {
          disposition: 'pending',
          status: 'authoritative_completion_evidence_required',
          evidenceRef: null,
          evidenceDigest: null,
          ownerPackage: 'P05',
        },
        P06: {
          disposition: 'pending',
          status: 'authoritative_completion_evidence_required',
          evidenceRef: null,
          evidenceDigest: null,
          ownerPackage: 'P06',
        },
      },
      deletionClaim: 'not_authorized_not_executed',
    },
    externalAuthorityAndResources: {
      status: 'p06_authoritative_inventory_and_disposition_required',
      ownerPackage: 'P06',
    },
    chainReadback: {
      status: 'p06_finalized_readback_required',
      authoritative: false,
      ownerPackage: 'P06',
    },
  };
}

function dissolutionBlockerCodes(
  dispositionSnapshot: Record<string, unknown>,
  dissolutionPolicy: Record<string, unknown>,
): string[] {
  const entries = asArray(dispositionSnapshot.entries);
  const successor = asRecord(dissolutionPolicy.retentionSuccessor);
  const coordination = asRecord(dissolutionPolicy.retentionDestructionCoordination);
  const unexpiredAppeal = asRecord(coordination.unexpiredAppeal);
  const blockers = [
    'dissolution_exit_window_pending',
    'member_and_delegator_notification_required',
    'data_export_evidence_required',
    ...(successor.status === 'preauthorized' ? [] : ['appeal_retention_successor_required']),
    ...(unexpiredAppeal.status === 'blocked_unexpired_appeal'
      ? ['unexpired_appeal_blocks_destruction']
      : []),
    ...(entries.length > 0 ? ['in_flight_obligation_disposition_required'] : []),
    'p04_content_disposition_completion_evidence_required',
    'p05_legal_hold_status_required',
    'p05_destruction_authorization_required',
    'p05_completion_evidence_required',
    'p06_storage_destruction_completion_evidence_required',
    'p06_authoritative_resource_inventory_required',
    'p06_external_authority_disposition_required',
    'p06_finalized_chain_readback_required',
  ];
  return [...new Set(blockers)];
}

function buildDissolutionPendingReconciliation(input: {
  planId: string;
  dispositionSnapshot: Record<string, unknown>;
  dissolutionPolicy: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: 'dissolution_pending',
    offChainIntent: {
      status: 'persisted',
      lifecyclePlanId: input.planId,
      targetLifecycleState: 'dissolution_pending',
    },
    disposition: {
      status: 'required_actions_pending',
      snapshotDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.home-lifecycle-disposition',
        input.dispositionSnapshot,
      ),
    },
    policy: input.dissolutionPolicy,
    finalState: {
      status: 'not_written',
      target: 'dissolved',
      reason: 'all_required_dispositions_legal_authorization_and_p04_p05_p06_authoritative_completion_evidence_required',
    },
  };
}

function buildAwaitingWalletReconciliation(input: {
  planId: string;
  action: GovernanceCircleLifecycleAction;
  targetLifecycleState: string;
}) {
  return {
    schemaVersion: 1,
    status: 'awaiting_wallet',
    offChainIntent: {
      status: 'persisted',
      lifecyclePlanId: input.planId,
      action: input.action,
      targetLifecycleState: input.targetLifecycleState,
    },
    chain: {
      status: 'awaiting_wallet',
      receiptRef: null,
      authoritative: false,
      ownerPackage: 'P06',
    },
    indexer: {
      status: 'awaiting_chain_finality',
      receiptRef: null,
      authoritative: false,
      ownerPackage: 'P06',
    },
    finalityPolicy: {
      transactionCommitment: 'finalized',
      indexerState: 'converged',
      satisfied: false,
    },
  };
}

async function persistDissolutionPending(
  prisma: LifecyclePlanPrisma,
  receipt: any,
  plan: GovernanceHomeLifecyclePlan,
): Promise<void> {
  if (typeof prisma.$transaction !== 'function') {
    throw new Error('circle_dissolution_atomic_owner_unavailable');
  }
  await prisma.$transaction(async (tx) => {
    await updateReceiptWithPlan(tx, receipt, plan, {
      errorCode: 'dissolution_disposition_pending',
      executionRef: plan.id,
    });
    const updated = await tx.circle.updateMany({
      where: {
        id: plan.circleId,
        lifecycleStatus: {
          in: [
            plan.fromLifecycleState === 'archived' ? 'Archived' : 'Active',
          ],
        },
      },
      data: { lifecycleStatus: 'DissolutionPending' },
    });
    if (updated.count !== 1) throw new Error('circle_dissolution_projection_cas_failed');
    const projected = await tx.circle.findUnique({
      where: { id: plan.circleId },
      select: { lifecycleStatus: true },
    });
    if (projected?.lifecycleStatus !== 'DissolutionPending') {
      throw new Error('circle_dissolution_projection_readback_mismatch');
    }
  });
}

export async function updateReceiptWithPlan(
  prisma: LifecyclePlanPrisma,
  receipt: any,
  plan: GovernanceHomeLifecyclePlan,
  input: {
    errorCode: string;
    executionRef: string;
    executionStatus?: 'skipped' | 'executed';
  },
): Promise<void> {
  const executionEvidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-receipt-evidence',
    plan,
  );
  const nextExecutionStatus = input.executionStatus ?? 'skipped';
  const updated = await prisma.governanceExecutionReceipt.updateMany({
    where: {
      id: receipt.id,
      requestId: receipt.requestId,
      decisionDigest: receipt.decisionDigest,
      executorModule: 'circle_lifecycle',
      executionStatus: receipt.executionStatus,
      executionEvidenceDigest: receipt.executionEvidenceDigest ?? null,
    },
    data: {
      executionStatus: nextExecutionStatus,
      executionRef: input.executionRef,
      errorCode: input.errorCode,
      executionEvidence: plan,
      executionEvidenceDigest,
    },
  });
  if (updated.count !== 1) throw new Error('circle_lifecycle_receipt_cas_failed');
  receipt.executionStatus = nextExecutionStatus;
  receipt.executionRef = input.executionRef;
  receipt.errorCode = input.errorCode;
  receipt.executionEvidence = plan;
  receipt.executionEvidenceDigest = executionEvidenceDigest;
}

async function requireReceipt(prisma: LifecyclePlanPrisma, receiptId: string): Promise<any> {
  const receipt = await prisma.governanceExecutionReceipt.findUnique({
    where: { id: receiptId },
  });
  if (!receipt) throw new Error('circle_lifecycle_wallet_finalization_receipt_missing');
  return receipt;
}

function requireReceiptPlan(receipt: any): GovernanceHomeLifecyclePlan {
  const plan = parseGovernanceHomeLifecyclePlan(receipt.executionEvidence);
  if (!plan) throw new Error('circle_lifecycle_plan_missing');
  assertReceiptEvidenceIntegrity(receipt, plan);
  return plan;
}

function assertReceiptEvidenceIntegrity(
  receipt: any,
  plan: GovernanceHomeLifecyclePlan,
): void {
  const expected = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-receipt-evidence',
    plan,
  );
  if (receipt.executionEvidenceDigest !== expected) {
    throw new Error('circle_lifecycle_receipt_evidence_integrity_mismatch');
  }
}

function assertReceiptOwnsRequest(receipt: any, input: {
  action: GovernanceHomeLifecyclePlanAction;
  governingRequestId: string;
  governingDecisionDigest: string;
}): void {
  const existingPlan = parseGovernanceHomeLifecyclePlan(receipt?.executionEvidence);
  const executionStatusAllowed = receipt?.executionStatus === 'skipped'
    || (
      receipt?.executionStatus === 'executed'
      && existingPlan?.status === 'converged'
    );
  if (
    !receipt
    || receipt.requestId !== input.governingRequestId
    || receipt.decisionDigest !== input.governingDecisionDigest
    || receipt.actionType !== `circle.lifecycle.${input.action}`
    || receipt.executorModule !== 'circle_lifecycle'
    || !executionStatusAllowed
  ) {
    throw new Error('circle_lifecycle_receipt_governance_mismatch');
  }
}

function assertExistingPlan(
  plan: GovernanceHomeLifecyclePlan,
  homeIdentityBindingId: string,
  input: {
    circleId: number;
    action: GovernanceHomeLifecyclePlanAction;
    governingRequestId: string;
    governingDecisionDigest: string;
    governanceExecutionReceipt: any;
  },
): void {
  if (
    plan.homeIdentityBindingId !== homeIdentityBindingId
    || plan.circleId !== input.circleId
    || plan.action !== input.action
    || plan.governingRequestId !== input.governingRequestId
    || plan.governingDecisionDigest !== input.governingDecisionDigest
    || plan.governanceExecutionReceiptId !== input.governanceExecutionReceipt.id
  ) {
    throw new Error('circle_lifecycle_plan_idempotency_conflict');
  }
}

function assertPrepareInput(input: {
  circleId: number;
  actorPubkey: string;
  governingRequestId: string;
  governingDecisionDigest: string;
}): void {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('invalid_circle_lifecycle_id');
  }
  if (!input.actorPubkey.trim() || !input.governingRequestId.trim()) {
    throw new Error('circle_lifecycle_governance_evidence_required');
  }
  if (!/^[a-f0-9]{64}$/.test(input.governingDecisionDigest)) {
    throw new Error('circle_lifecycle_governing_decision_digest_invalid');
  }
}

function normalizeLifecycleState(value: unknown): 'active' | 'archived' {
  const normalized = normalizeLifecycleStateOrNull(value);
  if (!normalized) throw new Error('circle_lifecycle_plan_state_invalid');
  return normalized;
}

function normalizeLifecycleStateOrNull(value: unknown): 'active' | 'archived' | null {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'active' || normalized === 'archived' ? normalized : null;
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, 280);
  return normalized || null;
}

function normalizeBlockerCode(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '_')
    .slice(0, 96);
  return normalized || 'circle_lifecycle_reconciliation_failed';
}

function hashReconciliation(value: Record<string, unknown>): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.home-lifecycle-reconciliation',
    value,
  );
}

function safeNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('invalid_circle_lifecycle_slot');
  }
  return parsed;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
