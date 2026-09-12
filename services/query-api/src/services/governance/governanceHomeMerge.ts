import {
  CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
  CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildDispositionSnapshot,
  parseGovernanceHomeLifecyclePlan,
  updateReceiptWithPlan,
  type GovernanceHomeLifecyclePlan,
} from './governanceHomeLifecyclePlan';

export type CircleMergeMembershipDisposition = 'reconsent' | 'reapply' | 'not_migrated';
export type CircleMergeContentDisposition = 'copy_authorized' | 'reference_only' | 'not_migrated';

export interface CircleMergeSourceApprovalEvidence {
  schemaVersion: 1;
  kind: 'governance_home_merge_source_approval';
  id: string;
  sourceHomeIdentityBindingId: string;
  sourceCircleId: number;
  successorCircleId: number;
  sourceApprovalRequestId: string;
  sourceApprovalDecisionDigest: string;
  sourceApprovalReceiptId: string;
  recordedByPubkey: string;
  disposition: Record<string, unknown>;
  approvalDigest: string;
  createdAt: string;
}

interface MergePrisma {
  circle: {
    findUnique(input: unknown): Promise<any>;
    findMany(input: unknown): Promise<any[]>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  governanceHomeIdentityBinding: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceRequest: {
    findUnique(input: unknown): Promise<any>;
  };
  governanceExecutionReceipt: {
    findFirst(input: unknown): Promise<any>;
    findUnique(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  circleMergeLineage: {
    findFirst(input: unknown): Promise<any>;
    findMany(input: unknown): Promise<any[]>;
    create(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
  $transaction<T>(operation: (tx: MergePrisma) => Promise<T>): Promise<T>;
}

export function normalizeCircleMergeDisposition(
  value: unknown,
  input?: { now?: Date },
): Record<string, unknown> {
  const record = asRecord(value);
  const successorCircleId = positiveInteger(record.successorCircleId);
  const membershipDisposition = oneOf(record.membershipDisposition, [
    'reconsent', 'reapply', 'not_migrated',
  ] as const);
  const contentDisposition = oneOf(record.contentDisposition, [
    'copy_authorized', 'reference_only', 'not_migrated',
  ] as const);
  if (!successorCircleId || !membershipDisposition || !contentDisposition) {
    throw new Error('circle_merge_disposition_invalid');
  }
  const now = input?.now ?? new Date();
  const exitWindowEndsAt = futureIso(record.exitWindowEndsAt, now, 'circle_merge_exit_window_required');
  const exportWindowEndsAt = futureIso(record.exportWindowEndsAt, now, 'circle_merge_export_window_required');
  const crossInstitutionDisclosureImpact = normalizeDisclosureImpact(
    record.crossInstitutionDisclosureImpact,
  );
  const conflicts = asRecord(record.conflicts);
  const normalizedConflicts = {
    identity: normalizeConflict(conflicts.identity, ['no_conflict', 'resolved'], 'circle_merge_identity_conflict_unresolved'),
    resource: normalizeConflict(conflicts.resource, ['no_resources', 'resolved_by_p06'], 'circle_merge_resource_conflict_unresolved'),
    mandate: normalizeConflict(conflicts.mandate, ['no_conflict', 'resolved'], 'circle_merge_mandate_conflict_unresolved'),
    privacy: normalizeConflict(conflicts.privacy, ['no_conflict', 'resolved'], 'circle_merge_privacy_conflict_unresolved'),
  };
  return {
    schemaVersion: 1,
    successorCircleId,
    membershipDisposition,
    contentDisposition,
    crossInstitutionDisclosureImpact,
    exitWindowEndsAt,
    exportWindowEndsAt,
    conflicts: normalizedConflicts,
    automaticInheritance: {
      membership: 'none',
      visibility: 'none',
      mandate: 'none',
      grant: 'none',
      votingPower: 'none',
      knowledgeRuntime: 'p04_not_executed_by_p03',
      externalResources: 'p06_not_executed_by_p03',
    },
  };
}

export async function recordCircleMergeSourceApproval(
  prisma: MergePrisma,
  input: {
    requestId: string;
    sourceCircleId: number;
    actorPubkey: string;
    now?: Date;
  },
): Promise<CircleMergeSourceApprovalEvidence> {
  const request = await requireAcceptedRequest(prisma, {
    requestId: input.requestId,
    actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
    circleId: input.sourceCircleId,
  });
  const receipt = await requireSkippedReceipt(prisma, request.id, [
    'merge_source_approval_recording_required',
    'merge_source_approved',
  ]);
  const existing = parseCircleMergeSourceApprovalEvidence(receipt.executionEvidence);
  if (existing) {
    assertEvidenceDigest(receipt, existing);
    return existing;
  }
  if (receipt.executionEvidence != null) {
    throw new Error('circle_merge_source_approval_receipt_conflict');
  }
  const sourceHome = await requireActiveCircleHome(
    prisma,
    input.sourceCircleId,
    request.homeIdentityBindingId,
  );
  const sourceCircle = await prisma.circle.findUnique({
    where: { id: input.sourceCircleId },
    select: { id: true, lifecycleStatus: true },
  });
  if (!sourceCircle || sourceCircle.lifecycleStatus !== 'Active') {
    throw new Error('circle_merge_source_not_active');
  }
  const disposition = normalizeCircleMergeDisposition(
    asRecord(request.payload).mergeDisposition,
    { now: input.now },
  );
  const successorCircleId = Number(disposition.successorCircleId);
  if (successorCircleId === input.sourceCircleId) {
    throw new Error('circle_merge_successor_must_differ');
  }
  await requireActiveCircleHome(prisma, successorCircleId, null);
  const successorCircle = await prisma.circle.findUnique({
    where: { id: successorCircleId },
    select: { id: true, lifecycleStatus: true },
  });
  if (!successorCircle || successorCircle.lifecycleStatus !== 'Active') {
    throw new Error('circle_merge_successor_not_active');
  }
  const immutable = {
    schemaVersion: 1 as const,
    sourceHomeIdentityBindingId: sourceHome.id,
    sourceCircleId: input.sourceCircleId,
    successorCircleId,
    sourceApprovalRequestId: request.id,
    sourceApprovalDecisionDigest: requiredDigest(receipt.decisionDigest),
    sourceApprovalReceiptId: receipt.id,
    recordedByPubkey: input.actorPubkey,
    disposition,
  };
  const approvalDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.home-merge-source-approval',
    immutable,
  );
  const evidence: CircleMergeSourceApprovalEvidence = {
    ...immutable,
    kind: 'governance_home_merge_source_approval',
    id: `gov_merge_source_${approvalDigest.slice(0, 64)}`,
    approvalDigest,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const executionEvidenceDigest = receiptEvidenceDigest(evidence);
  const updated = await prisma.governanceExecutionReceipt.updateMany({
    where: {
      id: receipt.id,
      requestId: request.id,
      executorModule: 'circle_lifecycle',
      executionStatus: 'skipped',
      executionEvidenceDigest: receipt.executionEvidenceDigest ?? null,
    },
    data: {
      executionRef: evidence.id,
      errorCode: 'merge_source_approved',
      executionEvidence: evidence,
      executionEvidenceDigest,
    },
  });
  if (updated.count !== 1) throw new Error('circle_merge_source_approval_receipt_cas_failed');
  return evidence;
}

export async function validateCircleMergeSourceApprovalRefs(
  prisma: MergePrisma,
  input: {
    successorCircleId: number;
    sourceApprovalRequestIds: string[];
    now?: Date;
  },
): Promise<CircleMergeSourceApprovalEvidence[]> {
  if (input.sourceApprovalRequestIds.length === 0) {
    throw new Error('circle_merge_source_approvals_required');
  }
  const approvals: CircleMergeSourceApprovalEvidence[] = [];
  for (const requestId of [...new Set(input.sourceApprovalRequestIds)].sort()) {
    const approvalRequest = await requireAcceptedRequestById(prisma, requestId);
    if (approvalRequest.actionType !== CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE) {
      throw new Error('circle_merge_source_approval_action_mismatch');
    }
    const sourceCircleId = positiveInteger(approvalRequest.targetRef);
    if (!sourceCircleId || sourceCircleId === input.successorCircleId) {
      throw new Error('circle_merge_source_approval_target_invalid');
    }
    const approvalReceipt = await requireSkippedReceipt(prisma, approvalRequest.id, [
      'merge_source_approved',
    ]);
    const approval = parseCircleMergeSourceApprovalEvidence(approvalReceipt.executionEvidence);
    if (!approval) throw new Error('circle_merge_source_approval_evidence_missing');
    assertEvidenceDigest(approvalReceipt, approval);
    normalizeCircleMergeDisposition(approval.disposition, { now: input.now });
    if (
      approval.sourceCircleId !== sourceCircleId
      || approval.successorCircleId !== input.successorCircleId
      || approval.sourceApprovalRequestId !== approvalRequest.id
      || approval.sourceApprovalReceiptId !== approvalReceipt.id
      || approval.sourceHomeIdentityBindingId !== approvalRequest.homeIdentityBindingId
    ) {
      throw new Error('circle_merge_source_approval_evidence_mismatch');
    }
    await requireActiveCircleHome(prisma, sourceCircleId, approval.sourceHomeIdentityBindingId);
    approvals.push(approval);
  }
  const sourceCircleIds = approvals.map((item) => item.sourceCircleId);
  if (
    approvals.length !== input.sourceApprovalRequestIds.length
    || new Set(sourceCircleIds).size !== sourceCircleIds.length
  ) throw new Error('circle_merge_source_approval_duplicate');
  return approvals;
}

export async function prepareGovernanceHomeMergePlan(
  prisma: MergePrisma,
  input: {
    successorCircleId: number;
    requestId: string;
    actorPubkey: string;
    reason?: string | null;
    now?: Date;
  },
): Promise<GovernanceHomeLifecyclePlan> {
  const request = await requireAcceptedRequest(prisma, {
    requestId: input.requestId,
    actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
    circleId: input.successorCircleId,
  });
  const receipt = await requireSkippedReceipt(prisma, request.id, [
    'merge_successor_acceptance_pending',
    'merge_pending',
    'merge_completed',
  ]);
  const existing = parseGovernanceHomeLifecyclePlan(receipt.executionEvidence);
  if (existing) {
    assertEvidenceDigest(receipt, existing);
    return existing;
  }
  if (receipt.executionEvidence != null) {
    throw new Error('circle_merge_successor_receipt_conflict');
  }
  const successorHome = await requireActiveCircleHome(
    prisma,
    input.successorCircleId,
    request.homeIdentityBindingId,
  );
  const successor = await prisma.circle.findUnique({
    where: { id: input.successorCircleId },
    select: { id: true, lifecycleStatus: true },
  });
  if (!successor || successor.lifecycleStatus !== 'Active') {
    throw new Error('circle_merge_successor_not_active');
  }
  const sourceApprovalRequestIds = uniqueStrings(
    asRecord(request.payload).sourceApprovalRequestIds,
  );
  if (sourceApprovalRequestIds.length === 0) {
    throw new Error('circle_merge_source_approvals_required');
  }
  const approvals = await validateCircleMergeSourceApprovalRefs(prisma, {
    successorCircleId: input.successorCircleId,
    sourceApprovalRequestIds,
    now: input.now,
  });
  const sourceCircleIds = approvals.map((item) => item.sourceCircleId);
  const sourceCircles = await prisma.circle.findMany({
    where: { id: { in: sourceCircleIds } },
    select: { id: true, lifecycleStatus: true },
    orderBy: { id: 'asc' },
  });
  if (
    sourceCircles.length !== sourceCircleIds.length
    || sourceCircles.some((circle) => circle.lifecycleStatus !== 'Active')
  ) throw new Error('circle_merge_source_not_active');
  for (const sourceCircleId of sourceCircleIds) {
    const prior = await prisma.circleMergeLineage.findFirst({
      where: { sourceCircleId },
    });
    if (prior) throw new Error('circle_merge_source_already_linked');
  }
  const now = input.now ?? new Date();
  const sourceApprovalRefs = approvals
    .map((approval) => ({
      sourceCircleId: approval.sourceCircleId,
      sourceHomeIdentityBindingId: approval.sourceHomeIdentityBindingId,
      requestId: approval.sourceApprovalRequestId,
      decisionDigest: approval.sourceApprovalDecisionDigest,
      receiptId: approval.sourceApprovalReceiptId,
      approvalDigest: approval.approvalDigest,
    }))
    .sort((left, right) => left.sourceCircleId - right.sourceCircleId);
  const successorAcceptanceRef = {
    successorCircleId: input.successorCircleId,
    successorHomeIdentityBindingId: successorHome.id,
    requestId: request.id,
    decisionDigest: requiredDigest(receipt.decisionDigest),
    receiptId: receipt.id,
  };
  const sourceOwnerInventories = new Map<number, Record<string, unknown>>();
  for (const approval of approvals) {
    sourceOwnerInventories.set(approval.sourceCircleId, await buildDispositionSnapshot(
      prisma as any,
      approval.sourceHomeIdentityBindingId,
      approval.sourceCircleId,
      'merge',
    ));
  }
  const dispositionSnapshot = {
    schemaVersion: 1,
    scope: 'merge_current_producer',
    inventoryComplete: true,
    entries: approvals.flatMap((approval) => {
      const inventory = asRecord(sourceOwnerInventories.get(approval.sourceCircleId));
      return Array.isArray(inventory.entries)
        ? inventory.entries.map((entry) => ({
            sourceCircleId: approval.sourceCircleId,
            ...asRecord(entry),
          }))
        : [];
    }),
    sourceDispositions: approvals
      .map((approval) => ({
        sourceCircleId: approval.sourceCircleId,
        ...approval.disposition,
        ownerInventory: sourceOwnerInventories.get(approval.sourceCircleId),
      }))
      .sort((left, right) => left.sourceCircleId - right.sourceCircleId),
    canonicalOwnership: {
      case: 'source_preserved',
      receipt: 'source_preserved',
      knowledge: 'source_preserved_p04_owner',
      contribution: 'source_preserved',
    },
    automaticMigration: 'none',
    externalResources: {
      disposition: 'manual_resolution',
      status: 'per_source_no_resources_or_p06_resolution_ref_verified',
      ownerPackage: 'P06',
    },
  };
  const immutablePlan = {
    schemaVersion: 1 as const,
    homeIdentityBindingId: successorHome.id,
    circleId: input.successorCircleId,
    action: 'merge' as const,
    fromLifecycleState: 'active' as const,
    targetLifecycleState: 'merged' as const,
    governingRequestId: request.id,
    governingDecisionDigest: requiredDigest(receipt.decisionDigest),
    governanceExecutionReceiptId: receipt.id,
    actorPubkey: input.actorPubkey,
    reason: optionalString(input.reason),
    sourceCircleIds: [...sourceCircleIds].sort((left, right) => left - right),
    dispositionSnapshot,
    mergePolicy: {
      schemaVersion: 1,
      sourceApprovalRefs,
      successorAcceptanceRef,
      conflictGate: 'all_resolved_before_merge_pending',
      authorityInheritance: 'none',
      providerBoundary: {
        ownerPackage: 'P06',
        status: 'no_resources_or_p06_resolution_ref_required_per_source',
      },
    },
  };
  const planDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.home-lifecycle-plan',
    immutablePlan,
  );
  const reconciliation = {
    schemaVersion: 1,
    status: 'merge_pending',
    sourceCanonicalOwners: 'preserved',
    sourceLifecycle: 'merge_pending',
    successorLifecycle: 'active',
    finalState: {
      status: 'not_written',
      target: 'merged',
      reason: 'explicit_finalize_against_same_accepted_plan_required',
    },
  };
  const plan: GovernanceHomeLifecyclePlan = {
    ...immutablePlan,
    kind: 'governance_home_lifecycle_plan',
    id: `gov_lifecycle_${planDigest.slice(0, 64)}`,
    status: 'merge_pending',
    stateVersion: 0,
    reconciliation,
    blockerCodes: [
      'merge_exit_window_pending',
      'merge_export_window_pending',
    ],
    planDigest,
    reconciliationDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.home-lifecycle-reconciliation',
      reconciliation,
    ),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await prisma.$transaction(async (tx) => {
    await updateReceiptWithPlan(tx as any, receipt, plan, {
      errorCode: 'merge_pending',
      executionRef: plan.id,
    });
    const pending = await tx.circle.updateMany({
      where: { id: { in: sourceCircleIds }, lifecycleStatus: 'Active' },
      data: { lifecycleStatus: 'MergePending' },
    });
    if (pending.count !== sourceCircleIds.length) {
      throw new Error('circle_merge_pending_projection_cas_failed');
    }
    for (const approval of approvals) {
      const lineageImmutable = {
        sourceCircleId: approval.sourceCircleId,
        successorCircleId: input.successorCircleId,
        lifecyclePlanId: plan.id,
        governanceExecutionReceiptId: receipt.id,
        sourceApprovalRequestId: approval.sourceApprovalRequestId,
        successorAcceptanceRequestId: request.id,
      };
      const lineageDigest = hashCanonicalGovernanceValue(
        'alcheme.governance.circle-merge-lineage',
        lineageImmutable,
      );
      await tx.circleMergeLineage.create({
        data: {
          lineageId: `circle_merge_${lineageDigest.slice(0, 64)}`,
          ...lineageImmutable,
          status: 'merge_pending',
          lineageDigest,
        },
      });
    }
  });
  return plan;
}

export async function finalizeGovernanceHomeMergePlan(
  prisma: MergePrisma,
  input: { successorCircleId: number; requestId: string; now?: Date },
): Promise<GovernanceHomeLifecyclePlan> {
  const request = await requireAcceptedRequest(prisma, {
    requestId: input.requestId,
    actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
    circleId: input.successorCircleId,
  });
  const receipt = await requireSkippedReceipt(prisma, request.id, [
    'merge_pending', 'merge_completed',
  ]);
  const plan = parseGovernanceHomeLifecyclePlan(receipt.executionEvidence);
  if (!plan || plan.action !== 'merge') throw new Error('circle_merge_plan_missing');
  assertEvidenceDigest(receipt, plan);
  if (plan.status === 'merged') return plan;
  if (
    plan.status !== 'merge_pending'
    || plan.circleId !== input.successorCircleId
    || plan.governingRequestId !== request.id
  ) throw new Error('circle_merge_plan_state_invalid');
  const sourceCircleIds = plan.sourceCircleIds ?? [];
  if (sourceCircleIds.length === 0) throw new Error('circle_merge_plan_sources_missing');
  assertMergeWindowsClosed(plan, input.now ?? new Date());
  const lineages = await prisma.circleMergeLineage.findMany({
    where: { lifecyclePlanId: plan.id },
    orderBy: { sourceCircleId: 'asc' },
  });
  if (
    lineages.length !== sourceCircleIds.length
    || lineages.some((lineage) => lineage.status !== 'merge_pending')
  ) throw new Error('circle_merge_lineage_state_mismatch');
  const successor = await prisma.circle.findUnique({
    where: { id: input.successorCircleId },
    select: { id: true, lifecycleStatus: true },
  });
  if (!successor || successor.lifecycleStatus !== 'Active') {
    throw new Error('circle_merge_successor_not_active');
  }
  const now = input.now ?? new Date();
  const reconciliation = {
    ...asRecord(plan.reconciliation),
    status: 'merged',
    sourceLifecycle: 'merged',
    finalState: {
      status: 'written',
      target: 'merged',
      sourceCircleIds,
      successorCircleId: input.successorCircleId,
      sourceCanonicalOwners: 'preserved_with_merged_into_link',
      authorityInheritance: 'none',
    },
  };
  const completedPlan: GovernanceHomeLifecyclePlan = {
    ...plan,
    status: 'merged',
    stateVersion: plan.stateVersion + 1,
    reconciliation,
    blockerCodes: [],
    reconciliationDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.home-lifecycle-reconciliation',
      reconciliation,
    ),
    updatedAt: now.toISOString(),
  };
  await prisma.$transaction(async (tx) => {
    const merged = await tx.circle.updateMany({
      where: { id: { in: sourceCircleIds }, lifecycleStatus: 'MergePending' },
      data: { lifecycleStatus: 'Merged' },
    });
    if (merged.count !== sourceCircleIds.length) {
      throw new Error('circle_merge_final_projection_cas_failed');
    }
    const updatedLineages = await tx.circleMergeLineage.updateMany({
      where: { lifecyclePlanId: plan.id, status: 'merge_pending' },
      data: { status: 'merged', mergedAt: now },
    });
    if (updatedLineages.count !== sourceCircleIds.length) {
      throw new Error('circle_merge_lineage_finalize_cas_failed');
    }
    await updateReceiptWithPlan(tx as any, receipt, completedPlan, {
      errorCode: 'merge_completed',
      executionRef: plan.id,
    });
  });
  return completedPlan;
}

export function parseCircleMergeSourceApprovalEvidence(
  value: unknown,
): CircleMergeSourceApprovalEvidence | null {
  const record = asRecord(value);
  if (!Object.keys(record).length) return null;
  if (
    record.kind !== 'governance_home_merge_source_approval'
    || record.schemaVersion !== 1
    || !positiveInteger(record.sourceCircleId)
    || !positiveInteger(record.successorCircleId)
    || !requiredString(record.sourceApprovalRequestId)
    || !requiredString(record.sourceApprovalReceiptId)
    || !requiredString(record.approvalDigest)
  ) throw new Error('circle_merge_source_approval_evidence_invalid');
  return record as unknown as CircleMergeSourceApprovalEvidence;
}

async function requireAcceptedRequest(
  prisma: MergePrisma,
  input: { requestId: string; actionType: string; circleId: number },
): Promise<any> {
  const request = await requireAcceptedRequestById(prisma, input.requestId);
  if (
    request.actionType !== input.actionType
    || request.targetType !== 'circle'
    || request.targetRef !== String(input.circleId)
  ) throw new Error('circle_merge_governance_request_target_mismatch');
  return request;
}

async function requireAcceptedRequestById(prisma: MergePrisma, requestId: string): Promise<any> {
  const request = await prisma.governanceRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('circle_merge_governance_request_missing');
  if (request.state !== 'accepted') throw new Error('circle_merge_governance_decision_not_accepted');
  return request;
}

async function requireSkippedReceipt(
  prisma: MergePrisma,
  requestId: string,
  errorCodes: string[],
): Promise<any> {
  const receipt = await prisma.governanceExecutionReceipt.findFirst({
    where: {
      requestId,
      executorModule: 'circle_lifecycle',
      executionStatus: 'skipped',
      errorCode: { in: errorCodes },
    },
    orderBy: { executedAt: 'desc' },
  });
  if (!receipt) throw new Error('circle_merge_governance_receipt_missing');
  return receipt;
}

async function requireActiveCircleHome(
  prisma: MergePrisma,
  circleId: number,
  expectedId: string | null,
): Promise<any> {
  const home = expectedId
    ? await prisma.governanceHomeIdentityBinding.findUnique({ where: { id: expectedId } })
    : await prisma.governanceHomeIdentityBinding.findUnique({
        where: {
          homeType_homeRef_identityVersion: {
            homeType: 'circle', homeRef: String(circleId), identityVersion: 1,
          },
        },
      });
  if (
    !home
    || home.id !== (expectedId ?? home.id)
    || home.homeType !== 'circle'
    || home.homeRef !== String(circleId)
    || home.status !== 'active'
  ) throw new Error('circle_merge_governance_home_missing_or_inactive');
  return home;
}

function normalizeDisclosureImpact(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const status = oneOf(record.status, ['none', 'notice_required'] as const);
  if (!status) throw new Error('circle_merge_disclosure_impact_required');
  const noticeRef = optionalString(record.noticeRef);
  if (status === 'notice_required' && !noticeRef) {
    throw new Error('circle_merge_disclosure_notice_required');
  }
  return { status, noticeRef };
}

function normalizeConflict(
  value: unknown,
  allowed: readonly string[],
  errorCode: string,
): Record<string, unknown> {
  const record = asRecord(value);
  const status = typeof record.status === 'string' && allowed.includes(record.status)
    ? record.status
    : null;
  if (!status) throw new Error(errorCode);
  const evidenceRef = optionalString(record.evidenceRef);
  const resolved = status === 'resolved' || status === 'resolved_by_p06';
  if (resolved && !evidenceRef) throw new Error(errorCode);
  return { status, evidenceRef };
}

function assertEvidenceDigest(receipt: any, evidence: unknown): void {
  if (receipt.executionEvidenceDigest !== receiptEvidenceDigest(evidence)) {
    throw new Error('circle_merge_receipt_evidence_integrity_mismatch');
  }
}

function receiptEvidenceDigest(evidence: unknown): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.execution-receipt-evidence',
    evidence,
  );
}

function requiredDigest(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('circle_merge_governing_decision_digest_invalid');
  }
  return normalized;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('circle_merge_source_approvals_required');
  const normalized = value.map(requiredString);
  if (normalized.some((item) => !item)) throw new Error('circle_merge_source_approvals_required');
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('circle_merge_source_approval_duplicate');
  }
  return [...normalized].sort();
}

function assertMergeWindowsClosed(plan: GovernanceHomeLifecyclePlan, now: Date): void {
  const sourceDispositions = asRecord(plan.dispositionSnapshot).sourceDispositions;
  if (!Array.isArray(sourceDispositions) || sourceDispositions.length === 0) {
    throw new Error('circle_merge_disposition_snapshot_missing');
  }
  for (const value of sourceDispositions) {
    const disposition = asRecord(value);
    const exitWindowEndsAt = timestamp(disposition.exitWindowEndsAt);
    const exportWindowEndsAt = timestamp(disposition.exportWindowEndsAt);
    if (!exitWindowEndsAt || !exportWindowEndsAt) {
      throw new Error('circle_merge_disposition_window_invalid');
    }
    if (exitWindowEndsAt > now.getTime()) throw new Error('circle_merge_exit_window_pending');
    if (exportWindowEndsAt > now.getTime()) throw new Error('circle_merge_export_window_pending');
  }
}

function timestamp(value: unknown): number {
  const parsed = new Date(requiredString(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function futureIso(value: unknown, now: Date, errorCode: string): string {
  const normalized = requiredString(value);
  const date = normalized ? new Date(normalized) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) {
    throw new Error(errorCode);
  }
  return date.toISOString();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | null {
  const normalized = requiredString(value);
  return normalized || null;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
