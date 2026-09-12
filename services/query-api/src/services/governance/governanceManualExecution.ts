import { createHash } from 'node:crypto';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { GovernanceCaseWorkflowError } from './governanceCaseWorkflow';
import {
  createPrismaGovernanceEngineStore,
  recordExecutionReceipt,
} from './policyEngine';
import { projectDecisionOutputArtifact } from './decisionOutputArtifact';
import { persistGovernanceCaseActionRequiredNotifications } from './governanceCaseActionNotifications';
import { readRouteAProviderAdmissionCredential } from './routeAProviderAdmissionCredential';
import {
  normalizeVerifiedStorageFabricProviderAdmissionBinding,
  STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
  type StorageFabricReceiptVerifier,
  type VerifiedStorageFabricProviderAdmissionBinding,
} from './storageFabricReceiptVerifier';

const AUTOMATIC_ONLY_CIRCLE_BINDING_ACTIONS = new Set([
  'external_app_primary_circle_bind',
  'external_app_primary_circle_change',
  'external_app_attached_circle_bind',
  'external_app_attached_circle_revoke',
]);

export type GovernanceManualExecutionEvidenceKind =
  | 'external_receipt'
  | 'verification_record'
  | 'artifact';

export interface GovernanceManualExecutionEvidenceItem {
  kind: GovernanceManualExecutionEvidenceKind;
  ref: string;
  digest: string;
}

type ManualExecutionReviewDecision = 'approve' | 'reject';

function requiredText(value: unknown, min: number, max: number, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < min || normalized.length > max) {
    throw new GovernanceCaseWorkflowError(400, code);
  }
  return normalized;
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function routeAProviderResourceRef(providerId: unknown): string {
  const normalizedProviderId = requiredText(
    providerId,
    1,
    256,
    'governance_manual_execution_route_a_provider_required',
  );
  return `provider_resource:${normalizedProviderId}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002',
  );
}

function assertStorageFabricBindingMatchesRouteA(input: {
  binding: VerifiedStorageFabricProviderAdmissionBinding;
  providerResourceRef: string;
  credentialJwsDigest: string;
  operationPayloadDigest: string;
  statePreconditionDigest: string;
  validFrom: string;
  expiresAt: string;
  reviewedAt: Date;
}): void {
  if (input.binding.providerResourceRef !== input.providerResourceRef) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_provider_mismatch',
    );
  }
  if (input.binding.credentialJwsDigest !== input.credentialJwsDigest) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_credential_mismatch',
    );
  }
  if (input.binding.operationPayloadDigest !== input.operationPayloadDigest) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_operation_payload_mismatch',
    );
  }
  if (input.binding.statePreconditionDigest !== input.statePreconditionDigest) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_state_mismatch',
    );
  }
  const executedAt = Date.parse(input.binding.executedAt);
  const validFrom = Date.parse(input.validFrom);
  const expiresAt = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(validFrom)
    || !Number.isFinite(expiresAt)
    || validFrom >= expiresAt
    || executedAt < validFrom
    || executedAt >= expiresAt
    || executedAt > input.reviewedAt.getTime()
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_execution_time_mismatch',
    );
  }
}

function normalizeEvidence(value: unknown): GovernanceManualExecutionEvidenceItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_evidence_required');
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_evidence_invalid');
    }
    const actualKeys = Object.keys(item).sort();
    if (actualKeys.join(',') !== 'digest,kind,ref') {
      throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_evidence_invalid');
    }
    const kind = String((item as any).kind || '') as GovernanceManualExecutionEvidenceKind;
    if (!['external_receipt', 'verification_record', 'artifact'].includes(kind)) {
      throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_evidence_kind_invalid');
    }
    const ref = requiredText(
      (item as any).ref,
      1,
      256,
      'governance_manual_execution_evidence_ref_invalid',
    );
    const digest = String((item as any).digest || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_evidence_digest_invalid');
    }
    const key = `${kind}:${ref}:${digest}`;
    if (seen.has(key)) {
      throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_evidence_duplicate');
    }
    seen.add(key);
    return { kind, ref, digest };
  });
}

function responsibility(governanceCase: any, kind: 'execution' | 'outcome'): any | null {
  return Array.isArray(governanceCase?.responsibilities)
    ? governanceCase.responsibilities.find((item: any) => item?.kind === kind) ?? null
    : null;
}

function assertManualExecutionCase(governanceCase: any): {
  request: any;
  assignee: any;
  reviewer: any;
} {
  if (!governanceCase) {
    throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
  }
  const request = governanceCase.primaryRequest;
  if (
    !request
    || request.state !== 'accepted'
    || request.executionMode !== 'stage_decision_only'
    || request.decision?.decision !== 'accepted'
    || !/^[a-f0-9]{64}$/.test(String(request.decision?.decisionDigest || ''))
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_not_available');
  }
  if (['closed', 'archived'].includes(String(governanceCase.casePhase || ''))) {
    throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_case_terminal');
  }
  const assignee = responsibility(governanceCase, 'execution');
  const reviewer = responsibility(governanceCase, 'outcome');
  if (
    !assignee
    || assignee.status !== 'accepted'
    || !assignee.deadlineAt
    || !Number.isInteger(assignee.version)
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_assignee_not_ready');
  }
  if (!reviewer || reviewer.status !== 'accepted' || !Number.isInteger(reviewer.version)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_reviewer_not_ready');
  }
  if (assignee.assigneePubkey === reviewer.assigneePubkey) {
    throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_separation_required');
  }
  const artifact = Array.isArray(governanceCase.decisionOutputArtifacts)
    ? governanceCase.decisionOutputArtifacts.find((item: any) => item?.kind === 'manual_execution_plan')
    : null;
  const projected = artifact
    ? projectDecisionOutputArtifact(artifact, { includeSourceRef: true }) as any
    : null;
  const action = projected?.constraints?.executionPlan?.actions?.[0];
  if (
    projected?.integrity !== 'verified'
    || projected?.source?.type !== 'governance_request'
    || projected?.source?.ref !== `request:${request.id}`
    || projected?.decisionDigest !== request.decision.decisionDigest
    || projected?.executionCapability !== 'manual'
    || projected?.constraints?.execution?.adapterRef !== 'manual_case_execution'
    || projected?.constraints?.execution?.assignmentGrantsSignerAuthority !== false
    || projected?.constraints?.executionPlan?.requestId !== request.id
    || projected?.constraints?.executionPlan?.aggregateStatus !== 'awaiting_manual_submission'
    || !action
    || action.actionType !== request.actionType
    || action.subject?.type !== governanceCase.subjectType
    || action.subject?.ref !== governanceCase.subjectRef
    || action.target?.type !== request.targetType
    || action.target?.ref !== request.targetRef
    || action.network !== 'manual:external_or_off_chain'
    || action.program !== null
    || !Array.isArray(action.accountMetas)
    || action.accountMetas.length !== 0
    || action.instruction?.kind !== 'manual_completion'
    || action.instruction?.semantic !== 'exact_accepted_request_action'
    || action.assetChanges?.status !== 'not_inferred_requires_completion_evidence'
    || !Array.isArray(action.dependencies)
    || action.dependencies.length !== 0
    || action.atomicity !== 'manual_single_action_not_assumed_atomic'
    || action.assignee?.pubkey !== assignee.assigneePubkey
    || action.assignee?.responsibilityVersion !== assignee.version
    || action.assignee?.deadlineAt !== assignee.deadlineAt.toISOString()
    || action.reviewer?.pubkey !== reviewer.assigneePubkey
    || action.reviewer?.responsibilityVersion !== reviewer.version
    || action.assignmentGrantsSignerAuthority !== false
    || action.attempt?.state !== 'pending_completion_evidence'
  ) {
    throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_artifact_invalid');
  }
  return { request, assignee, reviewer };
}

function completionId(caseId: string): string {
  return `governance_manual_execution:${hashCanonicalGovernanceValue(
    'alcheme.governance.manual-execution-completion-id',
    { caseId },
  ).slice(0, 64)}`;
}

function eventId(caseId: string, idempotencyKey: string): string {
  return `governance_case_event:${hashCanonicalGovernanceValue(
    'alcheme.governance.case-event-id',
    { caseId, idempotencyKey },
  ).slice(0, 64)}`;
}

function receiptId(caseId: string, version: number, evidenceDigest: string): string {
  return `manual_exec_receipt:${hashCanonicalGovernanceValue(
    'alcheme.governance.manual-execution-receipt-id',
    { caseId, version, evidenceDigest },
  ).slice(0, 64)}`;
}

function storageFabricReceiptId(
  binding: VerifiedStorageFabricProviderAdmissionBinding,
): string {
  return `storage_fabric_receipt:${hashCanonicalGovernanceValue(
    'alcheme.governance.storage-fabric-provider-admission-receipt-id',
    {
      receiptRef: binding.providerAdmissionReceiptRef,
      receiptDigest: binding.providerAdmissionReceiptDigest,
    },
  ).slice(0, 64)}`;
}

async function advanceCaseVersion(
  tx: any,
  governanceCase: any,
  event: {
    eventType: string;
    actorPubkey: string;
    fromState: string | null;
    toState: string;
    reason: string | null;
    idempotencyKey: string;
    responsibilityKind: 'execution' | 'outcome';
    responsibilityVersion: number;
    createdAt: Date;
  },
): Promise<number> {
  const nextVersion = Number(governanceCase.caseVersion) + 1;
  const updated = await tx.governanceCase.updateMany({
    where: {
      id: governanceCase.id,
      caseVersion: governanceCase.caseVersion,
    },
    data: { caseVersion: nextVersion },
  });
  if (updated.count !== 1) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
  }
  await tx.governanceCaseTimelineEvent.create({
    data: {
      id: eventId(governanceCase.id, event.idempotencyKey),
      caseId: governanceCase.id,
      eventType: event.eventType,
      responsibilityKind: event.responsibilityKind,
      actorPubkey: event.actorPubkey,
      subjectPubkey: null,
      fromState: event.fromState,
      toState: event.toState,
      reason: event.reason,
      idempotencyKey: event.idempotencyKey,
      caseVersion: nextVersion,
      responsibilityVersion: event.responsibilityVersion,
      createdAt: event.createdAt,
    },
  });
  return nextVersion;
}

async function inTransaction<T>(prisma: any, action: (tx: any) => Promise<T>): Promise<T> {
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => action(tx))
    : action(prisma);
}

const caseInclude = {
  responsibilities: true,
  decisionOutputArtifacts: true,
  manualExecutionCompletion: true,
  homeIdentityBinding: { select: { homeType: true, homeRef: true } },
  primaryRequest: { include: { decision: true, receipts: true } },
} as const;

function circleHomeId(governanceCase: any): number | null {
  const home = governanceCase?.homeIdentityBinding;
  const circleId = Number(home?.homeRef);
  return home?.homeType === 'circle' && Number.isSafeInteger(circleId) && circleId > 0
    ? circleId
    : null;
}

export async function submitGovernanceManualExecutionCompletion(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    evidence: unknown;
    idempotencyKey: string;
    expectedCaseVersion: number;
    expectedCompletionVersion?: number | null;
    now?: Date;
  },
): Promise<{ completion: any; caseVersion: number; replayed: boolean }> {
  const caseId = requiredText(input.caseId, 1, 128, 'governance_case_id_required');
  const actorPubkey = requiredText(input.actorPubkey, 1, 44, 'governance_case_actor_required');
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    8,
    128,
    'governance_case_idempotency_key_required',
  );
  const evidence = normalizeEvidence(input.evidence);
  const evidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.manual-execution-completion-evidence',
    evidence,
  );
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: caseInclude,
    });
    const { request, assignee, reviewer } = assertManualExecutionCase(governanceCase);
    if (AUTOMATIC_ONLY_CIRCLE_BINDING_ACTIONS.has(String(request.actionType || ''))) {
      throw new GovernanceCaseWorkflowError(
        409,
        'automatic_execution_required',
      );
    }
    const existing = governanceCase.manualExecutionCompletion;
    if (existing?.submissionIdempotencyKey === idempotencyKey) {
      if (existing.evidenceDigest !== evidenceDigest) {
        throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_idempotency_conflict');
      }
      return { completion: existing, caseVersion: governanceCase.caseVersion, replayed: true };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_case_version_conflict');
    }
    if (assignee.assigneePubkey !== actorPubkey) {
      throw new GovernanceCaseWorkflowError(403, 'governance_manual_execution_assignee_required');
    }
    if (new Date(assignee.deadlineAt).getTime() < now.getTime()) {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_deadline_expired');
    }
    if (existing && existing.status !== 'rejected') {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_submission_exists');
    }
    if (
      existing
      && (
        input.expectedCompletionVersion == null
        || existing.version !== input.expectedCompletionVersion
      )
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_version_conflict');
    }
    const nextCompletionVersion = existing ? existing.version + 1 : 1;
    const data = {
      status: 'submitted',
      version: nextCompletionVersion,
      evidence,
      evidenceDigest,
      assigneePubkey: actorPubkey,
      assigneeResponsibilityVersion: assignee.version,
      deadlineAt: new Date(assignee.deadlineAt),
      submittedAt: now,
      submissionIdempotencyKey: idempotencyKey,
      reviewerPubkey: reviewer.assigneePubkey,
      reviewerResponsibilityVersion: reviewer.version,
      reviewedAt: null,
      reviewReason: null,
      reviewIdempotencyKey: null,
      receiptId: null,
    };
    const completion = existing
      ? await tx.governanceManualExecutionCompletion.update({
          where: { id: existing.id },
          data,
        })
      : await tx.governanceManualExecutionCompletion.create({
          data: {
            id: completionId(caseId),
            caseId,
            requestId: request.id,
            ...data,
          },
        });
    const caseVersion = await advanceCaseVersion(tx, governanceCase, {
      eventType: existing ? 'manual_execution_resubmitted' : 'manual_execution_submitted',
      actorPubkey,
      fromState: existing?.status ?? null,
      toState: 'submitted',
      reason: null,
      idempotencyKey,
      responsibilityKind: 'execution',
      responsibilityVersion: assignee.version,
      createdAt: now,
    });
    const circleId = circleHomeId(governanceCase);
    if (circleId !== null) {
      await persistGovernanceCaseActionRequiredNotifications(tx, {
        caseId,
        circleId,
        action: 'review_execution_evidence',
        recipientPubkeys: [reviewer.assigneePubkey],
        sourceVersion: `manual-execution:v${nextCompletionVersion}:submitted`,
        createdAt: now,
      });
    }
    return { completion, caseVersion, replayed: false };
  });
}

export async function reviewGovernanceManualExecutionCompletion(
  prisma: any,
  input: {
    caseId: string;
    actorPubkey: string;
    decision: ManualExecutionReviewDecision;
    reason?: unknown;
    idempotencyKey: string;
    expectedCaseVersion: number;
    expectedCompletionVersion: number;
    now?: Date;
  },
  dependencies: {
    storageFabricReceiptVerifier?: StorageFabricReceiptVerifier;
    readRouteAProviderAdmissionCredential?: typeof readRouteAProviderAdmissionCredential;
  } = {},
): Promise<{
  completion: any;
  receipt: any | null;
  caseVersion: number;
  replayed: boolean;
}> {
  const caseId = requiredText(input.caseId, 1, 128, 'governance_case_id_required');
  const actorPubkey = requiredText(input.actorPubkey, 1, 44, 'governance_case_actor_required');
  if (!['approve', 'reject'].includes(input.decision)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_manual_execution_review_invalid');
  }
  const reason = input.decision === 'reject'
    ? requiredText(input.reason, 1, 1000, 'governance_manual_execution_review_reason_required')
    : input.reason == null
      ? null
      : requiredText(input.reason, 1, 1000, 'governance_manual_execution_review_reason_invalid');
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    8,
    128,
    'governance_case_idempotency_key_required',
  );
  const now = input.now ?? new Date();
  let storageFabricBinding: VerifiedStorageFabricProviderAdmissionBinding | null = null;
  if (input.decision === 'approve') {
    const snapshot = await prisma.governanceCase.findUnique({
      where: { id: caseId },
      include: caseInclude,
    });
    const { request, assignee, reviewer } = assertManualExecutionCase(snapshot);
    if (AUTOMATIC_ONLY_CIRCLE_BINDING_ACTIONS.has(String(request.actionType || ''))) {
      throw new GovernanceCaseWorkflowError(
        409,
        'automatic_execution_required',
      );
    }
    const completion = snapshot.manualExecutionCompletion;
    const isReplay = completion?.reviewIdempotencyKey === idempotencyKey;
    if (!isReplay && request.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE) {
      if (!completion) {
        throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_completion_required');
      }
      if (
        snapshot.caseVersion !== input.expectedCaseVersion
        || completion.version !== input.expectedCompletionVersion
      ) {
        throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_version_conflict');
      }
      if (reviewer.assigneePubkey !== actorPubkey) {
        throw new GovernanceCaseWorkflowError(403, 'governance_manual_execution_reviewer_required');
      }
      if (completion.status !== 'submitted') {
        throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_review_state_invalid');
      }
      if (
        completion.assigneePubkey !== assignee.assigneePubkey
        || completion.assigneeResponsibilityVersion !== assignee.version
        || completion.reviewerPubkey !== reviewer.assigneePubkey
        || completion.reviewerResponsibilityVersion !== reviewer.version
      ) {
        throw new GovernanceCaseWorkflowError(
          409,
          'governance_manual_execution_responsibility_drift',
        );
      }
      const verifier = dependencies.storageFabricReceiptVerifier;
      if (!verifier) {
        throw new GovernanceCaseWorkflowError(
          409,
          'governance_manual_execution_authoritative_readback_required',
        );
      }
      try {
        const readCredential = dependencies.readRouteAProviderAdmissionCredential
          ?? readRouteAProviderAdmissionCredential;
        const credential = await readCredential(prisma, { caseId, now });
        const expectedCredentialJwsDigest = sha256Text(credential.credentialJws);
        const expectedOperationPayloadDigest = String(credential.operationPayloadDigest || '');
        const expectedStatePreconditionDigest = String(credential.statePreconditionDigest || '');
        const expectedProviderResourceRef = routeAProviderResourceRef(
          (credential.operationPayload as any)?.providerId,
        );
        const validFrom = requiredText(
          (credential.governanceDecisionReceipt as any)?.validFrom,
          1,
          64,
          'governance_manual_execution_route_a_window_required',
        );
        const expiresAt = requiredText(
          (credential.governanceDecisionReceipt as any)?.expiresAt,
          1,
          64,
          'governance_manual_execution_route_a_window_required',
        );
        storageFabricBinding = normalizeVerifiedStorageFabricProviderAdmissionBinding(
          await verifier.verifyProviderAdmissionExecution({
            caseId,
            requestId: request.id,
            decisionDigest: request.decision.decisionDigest,
            targetRef: request.targetRef,
            expectedProviderResourceRef,
            expectedCredentialJwsDigest,
            expectedOperationPayloadDigest,
            expectedStatePreconditionDigest,
            expectedExecutionWindow: { validFrom, expiresAt },
            evidence: completion.evidence,
          }),
        );
        assertStorageFabricBindingMatchesRouteA({
          binding: storageFabricBinding,
          providerResourceRef: expectedProviderResourceRef,
          credentialJwsDigest: expectedCredentialJwsDigest,
          operationPayloadDigest: expectedOperationPayloadDigest,
          statePreconditionDigest: expectedStatePreconditionDigest,
          validFrom,
          expiresAt,
          reviewedAt: now,
        });
      } catch (error) {
        if (error instanceof GovernanceCaseWorkflowError) throw error;
        if (
          error
          && typeof error === 'object'
          && typeof (error as { code?: unknown }).code === 'string'
          && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ) {
          throw error;
        }
        if (
          error instanceof TypeError
          && String(error.message || '').includes('JCS-compatible digest')
        ) {
          throw new GovernanceCaseWorkflowError(
            409,
            'governance_manual_execution_route_a_credential_digest_invalid',
          );
        }
        throw new GovernanceCaseWorkflowError(
          503,
          'governance_manual_execution_authoritative_readback_unavailable',
        );
      }
    }
  }
  return inTransaction(prisma, async (tx) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: caseInclude,
    });
    const { request, assignee, reviewer } = assertManualExecutionCase(governanceCase);
    const completion = governanceCase.manualExecutionCompletion;
    if (!completion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_completion_required');
    }
    if (completion.reviewIdempotencyKey === idempotencyKey) {
      const expectedStatus = input.decision === 'approve' ? 'approved' : 'rejected';
      if (completion.status !== expectedStatus || (completion.reviewReason ?? null) !== reason) {
        throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_idempotency_conflict');
      }
      const receipt = completion.receiptId
        ? await tx.governanceExecutionReceipt.findUnique({ where: { id: completion.receiptId } })
        : null;
      return { completion, receipt, caseVersion: governanceCase.caseVersion, replayed: true };
    }
    if (
      governanceCase.caseVersion !== input.expectedCaseVersion
      || completion.version !== input.expectedCompletionVersion
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_version_conflict');
    }
    if (reviewer.assigneePubkey !== actorPubkey) {
      throw new GovernanceCaseWorkflowError(403, 'governance_manual_execution_reviewer_required');
    }
    if (completion.status !== 'submitted') {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_review_state_invalid');
    }
    if (
      completion.assigneePubkey !== assignee.assigneePubkey
      || completion.assigneeResponsibilityVersion !== assignee.version
      || completion.reviewerPubkey !== reviewer.assigneePubkey
      || completion.reviewerResponsibilityVersion !== reviewer.version
    ) {
      throw new GovernanceCaseWorkflowError(409, 'governance_manual_execution_responsibility_drift');
    }
    const nextCompletionVersion = completion.version + 1;
    let receipt: any | null = null;
    if (input.decision === 'approve') {
      if (
        request.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE
        && !storageFabricBinding
      ) {
        throw new GovernanceCaseWorkflowError(
          409,
          'governance_manual_execution_authoritative_readback_required',
        );
      }
      const executionEvidence = {
        schemaVersion: 1,
        mode: 'controlled_manual_execution',
        caseId,
        completionVersion: completion.version,
        assignee: {
          pubkey: completion.assigneePubkey,
          responsibilityVersion: completion.assigneeResponsibilityVersion,
          deadlineAt: new Date(completion.deadlineAt).toISOString(),
          submittedAt: new Date(completion.submittedAt).toISOString(),
        },
        reviewer: {
          pubkey: actorPubkey,
          responsibilityVersion: completion.reviewerResponsibilityVersion,
          reviewedAt: now.toISOString(),
        },
        evidence: completion.evidence,
        evidenceDigest: completion.evidenceDigest,
        ...(storageFabricBinding ? {
          authoritativeReadback: storageFabricBinding,
          authoritativeExecutionProjection: {
            factSource: 'authoritative_external_execution_projection',
            businessExecutionOwner: 'storage_fabric',
          },
        } : {}),
        assignmentGrantsSignerAuthority: false,
      };
      const canonicalReceiptId = storageFabricBinding
        ? storageFabricReceiptId(storageFabricBinding)
        : receiptId(caseId, completion.version, completion.evidenceDigest);
      if (storageFabricBinding) {
        const consumed = await tx.governanceExecutionReceipt.findUnique({
          where: { id: canonicalReceiptId },
        });
        if (consumed && consumed.requestId !== request.id) {
          throw new GovernanceCaseWorkflowError(
            409,
            'governance_manual_execution_external_receipt_already_consumed',
          );
        }
      }
      try {
        receipt = await recordExecutionReceipt(
          createPrismaGovernanceEngineStore(tx),
          {
            id: canonicalReceiptId,
            requestId: request.id,
            actionType: request.actionType,
            executorModule: 'manual_case_execution',
            executionStatus: 'executed',
            executionRef: storageFabricBinding?.providerAdmissionReceiptDigest
              ?? completion.evidenceDigest,
            errorCode: null,
            decisionDigest: request.decision.decisionDigest,
            idempotencyKey: `manual-case:${caseId}:v${completion.version}`,
            executionMode: request.executionMode,
            executionModeDigest: request.executionModeDigest ?? null,
            compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
            executionEvidence,
            executedAt: now,
          },
        );
      } catch (error) {
        if (storageFabricBinding && isUniqueConstraintError(error)) {
          throw new GovernanceCaseWorkflowError(
            409,
            'governance_manual_execution_external_receipt_already_consumed',
          );
        }
        throw error;
      }
    }
    const nextStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    const updatedCompletion = await tx.governanceManualExecutionCompletion.update({
      where: { id: completion.id },
      data: {
        status: nextStatus,
        version: nextCompletionVersion,
        reviewedAt: now,
        reviewReason: reason,
        reviewIdempotencyKey: idempotencyKey,
        receiptId: receipt?.id ?? null,
      },
    });
    const caseVersion = await advanceCaseVersion(tx, governanceCase, {
      eventType: input.decision === 'approve'
        ? 'manual_execution_approved'
        : 'manual_execution_rejected',
      actorPubkey,
      fromState: 'submitted',
      toState: nextStatus,
      reason,
      idempotencyKey,
      responsibilityKind: 'outcome',
      responsibilityVersion: reviewer.version,
      createdAt: now,
    });
    const circleId = circleHomeId(governanceCase);
    if (input.decision === 'reject' && circleId !== null) {
      await persistGovernanceCaseActionRequiredNotifications(tx, {
        caseId,
        circleId,
        action: 'submit_execution_evidence',
        recipientPubkeys: [assignee.assigneePubkey],
        sourceVersion: `manual-execution:v${nextCompletionVersion}:rejected`,
        createdAt: now,
      });
    }
    return { completion: updatedCompletion, receipt, caseVersion, replayed: false };
  });
}
