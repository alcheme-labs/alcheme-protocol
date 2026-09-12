import { Prisma } from '@prisma/client';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  resolveActiveCircleGovernanceBinding,
  type CircleGovernanceBindingResolution,
} from './circleGovernanceBindings';
import { GovernanceCaseWorkflowError } from './governanceCaseWorkflow';

const SHAREABLE_SOURCE_STATUSES = new Set([
  'accepted_to_plaza',
  'used_in_draft',
  'crystallized',
]);
const BLOCKED_SOURCE_PRIVACY = new Set(['sealed', 'redacted']);
const MODERATION_MINIMUM_PURPOSE = 'moderation_case_review_only';
const MODERATION_REASON_CODES = new Set([
  'spam',
  'harassment',
  'credible_safety_risk',
  'impersonation',
  'other',
]);

export type GovernanceEvidenceShareStatus = 'requested' | 'authorized' | 'denied' | 'revoked';
export type GovernanceEvidenceShareAccessAction = 'read' | 'export';

export interface GovernanceEvidenceSourceRef {
  sourceMaterialId: number;
  contentDigest: string;
}

export interface GovernanceModerationMinimumDisclosure {
  schemaVersion: 1;
  kind: 'moderation_report_minimum_disclosure';
  reportId: string;
  targetCircleId: number;
  recipientCircleId: number;
  redactedAllegation: {
    format: 'reason_code_only';
    reasonCode: string;
  };
  subject: {
    type: 'communication_room_member';
    ref: string;
    snapshotDigest: string;
  };
  sealedEvidenceDigest: string;
  submissionDigest: string;
  includedFields: ['redacted_allegation', 'necessary_subject_ref', 'evidence_digest'];
  excludedFields: ['sealed_report_statement', 'reporter_identity_and_pii', 'offsite_evidence'];
  permittedUse: 'moderation_case_review_only';
  prohibitedUses: ['delegate_training', 'delegate_performance_evaluation', 'other_target'];
  additionalDisclosure: 'separate_item_assignment_required';
}

export interface GovernanceEvidenceShareAuthority {
  caseId: string;
  targetCircleId: number;
  actionType: string;
  binding: CircleGovernanceBindingResolution;
}

export interface GovernanceEvidenceShareProjection {
  id: string;
  caseId: string;
  bindingId: string;
  targetCircleId: number;
  recipientCircleId: number;
  requestedByPubkey: string;
  purpose: string;
  requestNote: string | null;
  safeSummary: string | null;
  sourceRefs: GovernanceEvidenceSourceRef[];
  moderationReportId: string | null;
  minimumDisclosure: GovernanceModerationMinimumDisclosure | null;
  status: GovernanceEvidenceShareStatus;
  effectiveStatus: GovernanceEvidenceShareStatus | 'expired' | 'source_unavailable';
  version: number;
  digest: string;
  decidedByPubkey: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  expiresAt: string | null;
  revokedByPubkey: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events?: GovernanceEvidenceShareEventProjection[];
}

export function buildGovernanceModerationMinimumDisclosure(input: {
  reportId: string;
  targetCircleId: number;
  recipientCircleId: number;
  subjectType: string;
  subjectRef: string;
  subjectSnapshotDigest: string;
  reasonCode: string;
  sealedEvidenceDigest: string;
  submissionDigest: string;
}): GovernanceModerationMinimumDisclosure {
  const reportId = requiredText(input.reportId, 1, 96, 'governance_moderation_disclosure_report_required');
  if (!Number.isSafeInteger(input.targetCircleId) || input.targetCircleId <= 0) {
    throw new GovernanceCaseWorkflowError(400, 'governance_moderation_disclosure_target_required');
  }
  if (!Number.isSafeInteger(input.recipientCircleId) || input.recipientCircleId <= 0) {
    throw new GovernanceCaseWorkflowError(400, 'governance_moderation_disclosure_recipient_required');
  }
  if (input.recipientCircleId === input.targetCircleId) {
    throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_cross_circle_required');
  }
  if (input.subjectType !== 'communication_room_member') {
    throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_subject_invalid');
  }
  const subjectRef = requiredText(input.subjectRef, 3, 128, 'governance_moderation_disclosure_subject_invalid');
  if (!subjectRef.startsWith(`${input.targetCircleId}:`)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_subject_invalid');
  }
  const reasonCode = requiredText(input.reasonCode, 3, 64, 'governance_moderation_disclosure_reason_invalid');
  if (!MODERATION_REASON_CODES.has(reasonCode)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_reason_invalid');
  }
  const subjectSnapshotDigest = requiredDigest(
    input.subjectSnapshotDigest,
    'governance_moderation_disclosure_subject_digest_invalid',
  );
  const sealedEvidenceDigest = requiredDigest(
    input.sealedEvidenceDigest,
    'governance_moderation_disclosure_evidence_digest_invalid',
  );
  const submissionDigest = requiredDigest(
    input.submissionDigest,
    'governance_moderation_disclosure_submission_digest_invalid',
  );
  return {
    schemaVersion: 1,
    kind: 'moderation_report_minimum_disclosure',
    reportId,
    targetCircleId: input.targetCircleId,
    recipientCircleId: input.recipientCircleId,
    redactedAllegation: { format: 'reason_code_only', reasonCode },
    subject: {
      type: 'communication_room_member',
      ref: subjectRef,
      snapshotDigest: subjectSnapshotDigest,
    },
    sealedEvidenceDigest,
    submissionDigest,
    includedFields: ['redacted_allegation', 'necessary_subject_ref', 'evidence_digest'],
    excludedFields: ['sealed_report_statement', 'reporter_identity_and_pii', 'offsite_evidence'],
    permittedUse: MODERATION_MINIMUM_PURPOSE,
    prohibitedUses: ['delegate_training', 'delegate_performance_evaluation', 'other_target'],
    additionalDisclosure: 'separate_item_assignment_required',
  };
}

export interface GovernanceEvidenceShareEventProjection {
  id: string;
  eventType: 'requested' | 'authorized' | 'denied' | 'revoked' | 'read' | 'export';
  actorPubkey: string;
  purpose: string;
  result: 'allowed' | 'denied';
  reason: string | null;
  packageVersion: number;
  packageDigest: string;
  createdAt: string;
}

export interface GovernanceCaseFrozenEvidencePolicy {
  mode: 'continue_from_frozen_package_digests';
  postFreezeAccess: 'live_visibility_gate';
  revocationEffect: 'deny_future_access_without_rewriting_stage';
  packages: Array<{
    id: string;
    version: number;
    digest: string;
    authorizedAt: string;
    expiresAt: string | null;
  }>;
}

export function isCurrentGovernanceCaseFrozenEvidencePolicy(
  value: any,
): value is GovernanceCaseFrozenEvidencePolicy {
  return value?.mode === 'continue_from_frozen_package_digests'
    && value?.postFreezeAccess === 'live_visibility_gate'
    && value?.revocationEffect === 'deny_future_access_without_rewriting_stage'
    && Array.isArray(value?.packages)
    && value.packages.every((item: any) => (
      typeof item?.id === 'string'
      && item.id.length > 0
      && Number.isInteger(item.version)
      && item.version > 0
      && /^[a-f0-9]{64}$/.test(String(item.digest || ''))
      && typeof item.authorizedAt === 'string'
      && !Number.isNaN(Date.parse(item.authorizedAt))
      && (item.expiresAt === null || (
        typeof item.expiresAt === 'string'
        && !Number.isNaN(Date.parse(item.expiresAt))
      ))
    ));
}

export async function resolveGovernanceEvidenceShareAuthority(
  prisma: any,
  caseId: string,
): Promise<GovernanceEvidenceShareAuthority> {
  const normalizedCaseId = requiredText(caseId, 1, 128, 'governance_case_id_required');
  const governanceCase = await prisma.governanceCase.findUnique({
    where: { id: normalizedCaseId },
    select: {
      id: true,
      homeIdentityBinding: { select: { homeType: true, homeRef: true } },
      primaryRequest: { select: { actionType: true } },
      actionContractVersion: { select: { actionType: true } },
    },
  });
  if (!governanceCase) throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
  const targetCircleId = governanceCase.homeIdentityBinding?.homeType === 'circle'
    ? Number(governanceCase.homeIdentityBinding.homeRef)
    : 0;
  if (!Number.isInteger(targetCircleId) || targetCircleId <= 0) {
    throw new GovernanceCaseWorkflowError(409, 'governance_case_circle_home_required');
  }
  const actionType = String(
    governanceCase.primaryRequest?.actionType
    ?? governanceCase.actionContractVersion?.actionType
    ?? '',
  ).trim();
  if (!actionType) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_action_contract_required');
  }
  const binding = await resolveActiveCircleGovernanceBinding(prisma, {
    targetCircleId,
    actionType,
    purpose: 'collective_decision',
  });
  if (!binding) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_active_binding_required');
  }
  if (binding.binding.committeeCircleId === targetCircleId) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_cross_circle_required');
  }
  return { caseId: normalizedCaseId, targetCircleId, actionType, binding };
}

export async function requestGovernanceEvidenceShare(
  prisma: any,
  input: {
    authority: GovernanceEvidenceShareAuthority;
    actorPubkey: string;
    purpose: string;
    requestNote?: string | null;
    idempotencyKey: string;
    moderationMinimumDisclosure?: GovernanceModerationMinimumDisclosure | null;
    now?: Date;
  },
): Promise<{ package: GovernanceEvidenceShareProjection; replayed: boolean }> {
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const purpose = requiredText(input.purpose, 3, 500, 'governance_evidence_share_purpose_required');
  const requestNote = optionalText(input.requestNote, 3, 1000, 'governance_evidence_share_request_note_invalid');
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_evidence_share_idempotency_key_required');
  const moderationMinimumDisclosure = input.moderationMinimumDisclosure == null
    ? null
    : normalizeModerationMinimumDisclosure(input.moderationMinimumDisclosure);
  if (moderationMinimumDisclosure && (
    purpose !== MODERATION_MINIMUM_PURPOSE
    || moderationMinimumDisclosure.targetCircleId !== input.authority.targetCircleId
    || moderationMinimumDisclosure.recipientCircleId !== input.authority.binding.binding.committeeCircleId
  )) throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_authority_mismatch');
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const replay = await tx.governanceEvidenceSharePackage.findUnique({
      where: {
        caseId_requestIdempotencyKey: {
          caseId: input.authority.caseId,
          requestIdempotencyKey: idempotencyKey,
        },
      },
      include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (replay) {
      if (
        replay.requestedByPubkey !== actorPubkey
        || replay.purpose !== purpose
        || (replay.requestNote ?? null) !== requestNote
        || replay.bindingId !== input.authority.binding.binding.id
        || (replay.moderationReportId ?? null) !== (moderationMinimumDisclosure?.reportId ?? null)
        || hashOptionalMinimumDisclosure(replay.minimumDisclosure)
          !== hashOptionalMinimumDisclosure(moderationMinimumDisclosure)
      ) throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_idempotency_conflict');
      return { package: projectPackage(replay), replayed: true };
    }
    await assertBindingStillActive(tx, input.authority);
    const id = packageId(input.authority.caseId, idempotencyKey);
    const version = 1;
    const digest = packageDigest({
      id,
      caseId: input.authority.caseId,
      bindingId: input.authority.binding.binding.id,
      targetCircleId: input.authority.targetCircleId,
      recipientCircleId: input.authority.binding.binding.committeeCircleId,
      requestedByPubkey: actorPubkey,
      purpose,
      requestNote,
      safeSummary: null,
      sourceRefs: [],
      moderationReportId: moderationMinimumDisclosure?.reportId ?? null,
      minimumDisclosure: moderationMinimumDisclosure,
      status: 'requested',
      version,
      decidedByPubkey: null,
      decidedAt: null,
      decisionReason: null,
      expiresAt: null,
      revokedByPubkey: null,
      revokedAt: null,
    });
    const created = await tx.governanceEvidenceSharePackage.create({
      data: {
        id,
        caseId: input.authority.caseId,
        bindingId: input.authority.binding.binding.id,
        targetCircleId: input.authority.targetCircleId,
        recipientCircleId: input.authority.binding.binding.committeeCircleId,
        requestedByPubkey: actorPubkey,
        purpose,
        requestNote,
        safeSummary: null,
        sourceRefs: [] as Prisma.InputJsonValue,
        ...(moderationMinimumDisclosure == null ? {} : {
          moderationReportId: moderationMinimumDisclosure.reportId,
          minimumDisclosure: moderationMinimumDisclosure as unknown as Prisma.InputJsonValue,
        }),
        status: 'requested',
        version,
        digest,
        requestIdempotencyKey: idempotencyKey,
        createdAt: now,
        updatedAt: now,
      },
    });
    const event = await createEvent(tx, {
      packageId: id,
      eventType: 'requested',
      actorPubkey,
      purpose,
      result: 'allowed',
      reason: requestNote,
      packageVersion: version,
      packageDigest: digest,
      idempotencyKey,
      now,
    });
    return { package: projectPackage({ ...created, events: [event] }), replayed: false };
  });
}

export async function decideGovernanceEvidenceShare(
  prisma: any,
  input: {
    packageId: string;
    action: 'authorize' | 'deny';
    actorPubkey: string;
    expectedVersion: number;
    idempotencyKey: string;
    sourceMaterialIds?: number[];
    safeSummary?: string | null;
    expiresAt?: Date | null;
    reason?: string | null;
    now?: Date;
  },
): Promise<{ package: GovernanceEvidenceShareProjection; replayed: boolean }> {
  const normalizedPackageId = requiredText(input.packageId, 1, 128, 'governance_evidence_share_id_required');
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_evidence_share_idempotency_key_required');
  const reason = optionalText(input.reason, 3, 1000, 'governance_evidence_share_reason_invalid');
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new GovernanceCaseWorkflowError(400, 'governance_evidence_share_expected_version_required');
  }
  return inTransaction(prisma, async (tx) => {
    const current = await tx.governanceEvidenceSharePackage.findUnique({
      where: { id: normalizedPackageId },
      include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!current) throw new GovernanceCaseWorkflowError(404, 'governance_evidence_share_not_found');
    const replay = current.events.find((event: any) => event.idempotencyKey === idempotencyKey);
    if (replay) {
      const expectedEventType = input.action === 'authorize' ? 'authorized' : 'denied';
      if (replay.eventType !== expectedEventType || replay.actorPubkey !== actorPubkey) {
        throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_idempotency_conflict');
      }
      return { package: projectPackage(current), replayed: true };
    }
    if (current.version !== input.expectedVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_version_conflict');
    }
    if (current.status !== 'requested') {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_decision_unavailable');
    }
    await assertStoredBindingStillActive(tx, current);
    const nextVersion = current.version + 1;
    let sourceRefs: GovernanceEvidenceSourceRef[] = [];
    let safeSummary: string | null = null;
    let expiresAt: Date | null = null;
    if (input.action === 'authorize') {
      expiresAt = input.expiresAt instanceof Date && !Number.isNaN(input.expiresAt.getTime())
        ? input.expiresAt
        : null;
      if (!expiresAt || expiresAt <= now) {
        throw new GovernanceCaseWorkflowError(400, 'governance_evidence_share_future_expiry_required');
      }
      const minimumDisclosure = normalizeStoredModerationMinimumDisclosure(current.minimumDisclosure);
      if (minimumDisclosure) {
        if (
          current.moderationReportId !== minimumDisclosure.reportId
          || current.purpose !== MODERATION_MINIMUM_PURPOSE
          || (Array.isArray(input.sourceMaterialIds) && input.sourceMaterialIds.length > 0)
        ) throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_scope_mismatch');
        await assertModerationMinimumDisclosureAvailable(tx, current, minimumDisclosure);
        safeSummary = moderationMinimumSafeSummary(minimumDisclosure);
      } else {
        if (current.moderationReportId != null || current.minimumDisclosure != null) {
          throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_invalid');
        }
        const sourceMaterialIds = normalizedSourceMaterialIds(input.sourceMaterialIds);
        safeSummary = requiredText(input.safeSummary, 10, 2000, 'governance_evidence_share_safe_summary_required');
        const materials = await tx.sourceMaterial.findMany({
          where: { id: { in: sourceMaterialIds }, circleId: current.targetCircleId },
          select: {
            id: true,
            contentDigest: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            expiresAt: true,
          },
        });
        if (materials.length !== sourceMaterialIds.length) {
          throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_source_not_found');
        }
        sourceRefs = sourceMaterialIds.map((sourceMaterialId) => {
          const material = materials.find((item: any) => item.id === sourceMaterialId);
          assertSourceShareable(material, now);
          return { sourceMaterialId, contentDigest: String(material.contentDigest) };
        });
      }
    } else if (!reason) {
      throw new GovernanceCaseWorkflowError(400, 'governance_evidence_share_denial_reason_required');
    }
    const status = input.action === 'authorize' ? 'authorized' : 'denied';
    const digest = packageDigest({
      ...current,
      sourceRefs,
      safeSummary,
      status,
      version: nextVersion,
      decidedByPubkey: actorPubkey,
      decidedAt: now,
      decisionReason: reason,
      expiresAt,
    });
    const updated = await tx.governanceEvidenceSharePackage.updateMany({
      where: { id: normalizedPackageId, version: input.expectedVersion, status: 'requested' },
      data: {
        sourceRefs: sourceRefs as unknown as Prisma.InputJsonValue,
        safeSummary,
        status,
        version: nextVersion,
        digest,
        decidedByPubkey: actorPubkey,
        decidedAt: now,
        decisionReason: reason,
        expiresAt,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_version_conflict');
    }
    const event = await createEvent(tx, {
      packageId: normalizedPackageId,
      eventType: input.action === 'authorize' ? 'authorized' : 'denied',
      actorPubkey,
      purpose: current.purpose,
      result: 'allowed',
      reason,
      packageVersion: nextVersion,
      packageDigest: digest,
      idempotencyKey,
      now,
    });
    return {
      package: projectPackage({
        ...current,
        sourceRefs,
        safeSummary,
        status,
        version: nextVersion,
        digest,
        decidedByPubkey: actorPubkey,
        decidedAt: now,
        decisionReason: reason,
        expiresAt,
        updatedAt: now,
        events: [...current.events, event],
      }),
      replayed: false,
    };
  });
}

export async function revokeGovernanceEvidenceShare(
  prisma: any,
  input: {
    packageId: string;
    actorPubkey: string;
    expectedVersion: number;
    reason: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ package: GovernanceEvidenceShareProjection; replayed: boolean }> {
  const packageIdValue = requiredText(input.packageId, 1, 128, 'governance_evidence_share_id_required');
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const reason = requiredText(input.reason, 3, 1000, 'governance_evidence_share_revocation_reason_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_evidence_share_idempotency_key_required');
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new GovernanceCaseWorkflowError(400, 'governance_evidence_share_expected_version_required');
  }
  return inTransaction(prisma, async (tx) => {
    const current = await tx.governanceEvidenceSharePackage.findUnique({
      where: { id: packageIdValue },
      include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!current) throw new GovernanceCaseWorkflowError(404, 'governance_evidence_share_not_found');
    const replay = current.events.find((event: any) => event.idempotencyKey === idempotencyKey);
    if (replay) {
      if (replay.eventType !== 'revoked' || replay.actorPubkey !== actorPubkey) {
        throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_idempotency_conflict');
      }
      return { package: projectPackage(current), replayed: true };
    }
    if (current.version !== input.expectedVersion) {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_version_conflict');
    }
    if (current.status !== 'authorized') {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_revocation_unavailable');
    }
    const nextVersion = current.version + 1;
    const digest = packageDigest({
      ...current,
      status: 'revoked',
      version: nextVersion,
      revokedByPubkey: actorPubkey,
      revokedAt: now,
    });
    const updated = await tx.governanceEvidenceSharePackage.updateMany({
      where: { id: packageIdValue, version: input.expectedVersion, status: 'authorized' },
      data: {
        status: 'revoked',
        version: nextVersion,
        digest,
        revokedByPubkey: actorPubkey,
        revokedAt: now,
        updatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_version_conflict');
    }
    const event = await createEvent(tx, {
      packageId: packageIdValue,
      eventType: 'revoked',
      actorPubkey,
      purpose: current.purpose,
      result: 'allowed',
      reason,
      packageVersion: nextVersion,
      packageDigest: digest,
      idempotencyKey,
      now,
    });
    return {
      package: projectPackage({
        ...current,
        status: 'revoked',
        version: nextVersion,
        digest,
        revokedByPubkey: actorPubkey,
        revokedAt: now,
        updatedAt: now,
        events: [...current.events, event],
      }),
      replayed: false,
    };
  });
}

export async function listGovernanceCaseEvidenceShares(
  prisma: any,
  caseId: string,
): Promise<GovernanceEvidenceShareProjection[]> {
  const normalizedCaseId = requiredText(caseId, 1, 128, 'governance_case_id_required');
  const packages = await prisma.governanceEvidenceSharePackage.findMany({
    where: { caseId: normalizedCaseId },
    include: { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return packages.map(projectPackage);
}

export async function accessGovernanceEvidenceShare(
  prisma: any,
  input: {
    packageId: string;
    actorPubkey: string;
    purpose: string;
    action: GovernanceEvidenceShareAccessAction;
    recipientAuthorized: boolean;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{
  allowed: boolean;
  reason: string;
  package: GovernanceEvidenceShareProjection | null;
  replayed: boolean;
}> {
  const packageIdValue = requiredText(input.packageId, 1, 128, 'governance_evidence_share_id_required');
  const actorPubkey = requiredPubkey(input.actorPubkey);
  const purpose = requiredText(input.purpose, 3, 500, 'governance_evidence_share_access_purpose_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 8, 128, 'governance_evidence_share_idempotency_key_required');
  const now = input.now ?? new Date();
  return inTransaction(prisma, async (tx) => {
    const current = await tx.governanceEvidenceSharePackage.findUnique({
      where: { id: packageIdValue },
      include: {
        binding: { select: { status: true, targetAuthorizationStatus: true, committeeMandateStatus: true } },
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!current) throw new GovernanceCaseWorkflowError(404, 'governance_evidence_share_not_found');
    const existing = current.events.find((event: any) => event.idempotencyKey === idempotencyKey);
    if (existing && (existing.eventType !== input.action || existing.actorPubkey !== actorPubkey || existing.purpose !== purpose)) {
      throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_idempotency_conflict');
    }
    const sourceState = await resolveSourceState(tx, current, now);
    const reason = accessDenialReason(current, input.recipientAuthorized, sourceState, purpose, now);
    const allowed = reason === 'allowed';
    if (!existing) {
      await createEvent(tx, {
        packageId: packageIdValue,
        eventType: input.action,
        actorPubkey,
        purpose,
        result: allowed ? 'allowed' : 'denied',
        reason: allowed ? null : reason,
        packageVersion: current.version,
        packageDigest: current.digest,
        idempotencyKey,
        now,
      });
    }
    const { events: _events, binding: _binding, ...recipientPackage } = current;
    return {
      allowed,
      reason,
      package: allowed
        ? projectPackage(recipientPackage)
        : null,
      replayed: Boolean(existing),
    };
  });
}

export async function findGovernanceEvidenceShareRecipientCircle(
  prisma: any,
  packageId: string,
): Promise<number> {
  const found = await prisma.governanceEvidenceSharePackage.findUnique({
    where: { id: requiredText(packageId, 1, 128, 'governance_evidence_share_id_required') },
    select: { recipientCircleId: true },
  });
  if (!found) throw new GovernanceCaseWorkflowError(404, 'governance_evidence_share_not_found');
  return Number(found.recipientCircleId);
}

export async function findGovernanceEvidenceShareTargetCircle(
  prisma: any,
  packageId: string,
): Promise<number> {
  const found = await prisma.governanceEvidenceSharePackage.findUnique({
    where: { id: requiredText(packageId, 1, 128, 'governance_evidence_share_id_required') },
    select: { targetCircleId: true },
  });
  if (!found) throw new GovernanceCaseWorkflowError(404, 'governance_evidence_share_not_found');
  return Number(found.targetCircleId);
}

function accessDenialReason(
  current: any,
  recipientAuthorized: boolean,
  sourceState: 'available' | 'unavailable',
  purpose: string,
  now: Date,
): string {
  if (!recipientAuthorized) return 'recipient_circle_membership_required';
  if (purpose !== current.purpose) return 'access_purpose_mismatch';
  if (
    current.binding?.status !== 'active'
    || current.binding?.targetAuthorizationStatus !== 'accepted'
    || current.binding?.committeeMandateStatus !== 'accepted'
  ) return 'governance_binding_inactive';
  if (current.status === 'revoked') return 'package_revoked';
  if (current.status !== 'authorized') return `package_${current.status}`;
  if (!(current.expiresAt instanceof Date) || current.expiresAt <= now) return 'package_expired';
  if (sourceState !== 'available') return 'source_unavailable';
  return 'allowed';
}

async function resolveSourceState(tx: any, current: any, now: Date): Promise<'available' | 'unavailable'> {
  if (current.status !== 'authorized') return 'unavailable';
  let minimumDisclosure: GovernanceModerationMinimumDisclosure | null;
  try {
    minimumDisclosure = normalizeStoredModerationMinimumDisclosure(current.minimumDisclosure);
  } catch {
    return 'unavailable';
  }
  if (minimumDisclosure) {
    if (normalizeStoredSourceRefs(current.sourceRefs).length !== 0) return 'unavailable';
    try {
      await assertModerationMinimumDisclosureAvailable(tx, current, minimumDisclosure);
      return 'available';
    } catch {
      return 'unavailable';
    }
  }
  if (current.moderationReportId != null || current.minimumDisclosure != null) return 'unavailable';
  const sourceRefs = normalizeStoredSourceRefs(current.sourceRefs);
  if (sourceRefs.length === 0) return 'unavailable';
  const materials = await tx.sourceMaterial.findMany({
    where: { id: { in: sourceRefs.map((item) => item.sourceMaterialId) }, circleId: current.targetCircleId },
    select: {
      id: true,
      contentDigest: true,
      lifecycleStatus: true,
      evidencePrivacyClass: true,
      expiresAt: true,
    },
  });
  if (materials.length !== sourceRefs.length) return 'unavailable';
  return sourceRefs.every((sourceRef) => {
    const material = materials.find((item: any) => item.id === sourceRef.sourceMaterialId);
    try {
      assertSourceShareable(material, now);
      return material.contentDigest === sourceRef.contentDigest;
    } catch {
      return false;
    }
  }) ? 'available' : 'unavailable';
}

function assertSourceShareable(material: any, now: Date): void {
  if (!material || !isDigest(material.contentDigest)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_source_unavailable');
  }
  if (!SHAREABLE_SOURCE_STATUSES.has(String(material.lifecycleStatus))) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_source_unavailable');
  }
  if (BLOCKED_SOURCE_PRIVACY.has(String(material.evidencePrivacyClass))) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_source_unavailable');
  }
  if (material.expiresAt instanceof Date && material.expiresAt <= now) {
    throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_source_unavailable');
  }
}

async function assertBindingStillActive(tx: any, authority: GovernanceEvidenceShareAuthority): Promise<void> {
  const current = await tx.circleGovernanceBinding.findUnique({ where: { id: authority.binding.binding.id } });
  if (
    !current
    || current.targetCircleId !== authority.targetCircleId
    || current.committeeCircleId !== authority.binding.binding.committeeCircleId
  ) throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_binding_mismatch');
  await assertStoredBindingStillActive(tx, current);
}

async function assertStoredBindingStillActive(tx: any, value: any): Promise<void> {
  const binding = value.bindingId
    ? await tx.circleGovernanceBinding.findUnique({ where: { id: value.bindingId } })
    : value;
  if (
    !binding
    || binding.status !== 'active'
    || binding.targetAuthorizationStatus !== 'accepted'
    || binding.committeeMandateStatus !== 'accepted'
  ) throw new GovernanceCaseWorkflowError(409, 'governance_evidence_share_active_binding_required');
}

function projectPackage(value: any): GovernanceEvidenceShareProjection {
  const sourceRefs = normalizeStoredSourceRefs(value.sourceRefs);
  const now = new Date();
  const effectiveStatus = value.status === 'authorized' && value.expiresAt instanceof Date && value.expiresAt <= now
    ? 'expired'
    : value.status;
  return {
    id: String(value.id),
    caseId: String(value.caseId),
    bindingId: String(value.bindingId),
    targetCircleId: Number(value.targetCircleId),
    recipientCircleId: Number(value.recipientCircleId),
    requestedByPubkey: String(value.requestedByPubkey),
    purpose: String(value.purpose),
    requestNote: value.requestNote == null ? null : String(value.requestNote),
    safeSummary: value.safeSummary == null ? null : String(value.safeSummary),
    sourceRefs,
    moderationReportId: value.moderationReportId == null ? null : String(value.moderationReportId),
    minimumDisclosure: normalizeStoredModerationMinimumDisclosure(value.minimumDisclosure),
    status: value.status as GovernanceEvidenceShareStatus,
    effectiveStatus,
    version: Number(value.version),
    digest: String(value.digest),
    decidedByPubkey: value.decidedByPubkey == null ? null : String(value.decidedByPubkey),
    decidedAt: iso(value.decidedAt),
    decisionReason: value.decisionReason == null ? null : String(value.decisionReason),
    expiresAt: iso(value.expiresAt),
    revokedByPubkey: value.revokedByPubkey == null ? null : String(value.revokedByPubkey),
    revokedAt: iso(value.revokedAt),
    createdAt: iso(value.createdAt) ?? '',
    updatedAt: iso(value.updatedAt) ?? '',
    ...(Array.isArray(value.events) ? { events: value.events.map(projectEvent) } : {}),
  };
}

function projectEvent(value: any): GovernanceEvidenceShareEventProjection {
  return {
    id: String(value.id),
    eventType: value.eventType,
    actorPubkey: String(value.actorPubkey),
    purpose: String(value.purpose),
    result: value.result,
    reason: value.reason == null ? null : String(value.reason),
    packageVersion: Number(value.packageVersion),
    packageDigest: String(value.packageDigest),
    createdAt: iso(value.createdAt) ?? '',
  };
}

async function createEvent(tx: any, input: {
  packageId: string;
  eventType: GovernanceEvidenceShareEventProjection['eventType'];
  actorPubkey: string;
  purpose: string;
  result: 'allowed' | 'denied';
  reason: string | null;
  packageVersion: number;
  packageDigest: string;
  idempotencyKey: string;
  now: Date;
}): Promise<any> {
  return tx.governanceEvidenceShareEvent.create({
    data: {
      id: eventId(input.packageId, input.idempotencyKey),
      packageId: input.packageId,
      eventType: input.eventType,
      actorPubkey: input.actorPubkey,
      purpose: input.purpose,
      result: input.result,
      reason: input.reason,
      packageVersion: input.packageVersion,
      packageDigest: input.packageDigest,
      idempotencyKey: input.idempotencyKey,
      createdAt: input.now,
    },
  });
}

function packageDigest(value: any): string {
  return hashCanonicalGovernanceValue('alcheme.governance.evidence-share-package', {
    id: String(value.id),
    caseId: String(value.caseId),
    bindingId: String(value.bindingId),
    targetCircleId: Number(value.targetCircleId),
    recipientCircleId: Number(value.recipientCircleId),
    requestedByPubkey: String(value.requestedByPubkey),
    purpose: String(value.purpose),
    requestNote: value.requestNote == null ? null : String(value.requestNote),
    safeSummary: value.safeSummary == null ? null : String(value.safeSummary),
    sourceRefs: normalizeStoredSourceRefs(value.sourceRefs),
    moderationReportId: value.moderationReportId == null ? null : String(value.moderationReportId),
    minimumDisclosure: normalizeStoredModerationMinimumDisclosure(value.minimumDisclosure),
    status: String(value.status),
    version: Number(value.version),
    decidedByPubkey: value.decidedByPubkey == null ? null : String(value.decidedByPubkey),
    decidedAt: iso(value.decidedAt),
    decisionReason: value.decisionReason == null ? null : String(value.decisionReason),
    expiresAt: iso(value.expiresAt),
    revokedByPubkey: value.revokedByPubkey == null ? null : String(value.revokedByPubkey),
    revokedAt: iso(value.revokedAt),
  });
}

function packageId(caseId: string, idempotencyKey: string): string {
  return `governance_evidence_share:${hashCanonicalGovernanceValue(
    'alcheme.governance.evidence-share-package-id',
    { caseId, idempotencyKey },
  ).slice(0, 64)}`;
}

function eventId(packageIdValue: string, idempotencyKey: string): string {
  return `governance_evidence_share_event:${hashCanonicalGovernanceValue(
    'alcheme.governance.evidence-share-event-id',
    { packageId: packageIdValue, idempotencyKey },
  ).slice(0, 64)}`;
}

function normalizedSourceMaterialIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_evidence_share_sources_required');
  }
  const ids = [...new Set(value.map(Number))];
  if (ids.length === 0 || ids.length > 20 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new GovernanceCaseWorkflowError(400, 'governance_evidence_share_sources_invalid');
  }
  return ids.sort((left, right) => left - right);
}

function normalizeStoredSourceRefs(value: unknown): GovernanceEvidenceSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: any) => (
    Number.isSafeInteger(item?.sourceMaterialId)
    && item.sourceMaterialId > 0
    && isDigest(item?.contentDigest)
      ? [{ sourceMaterialId: item.sourceMaterialId, contentDigest: String(item.contentDigest) }]
      : []
  )).sort((left, right) => left.sourceMaterialId - right.sourceMaterialId);
}

function normalizeModerationMinimumDisclosure(value: unknown): GovernanceModerationMinimumDisclosure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_invalid');
  }
  const candidate = value as Record<string, any>;
  const normalized = buildGovernanceModerationMinimumDisclosure({
    reportId: candidate.reportId,
    targetCircleId: Number(candidate.targetCircleId),
    recipientCircleId: Number(candidate.recipientCircleId),
    subjectType: candidate.subject?.type,
    subjectRef: candidate.subject?.ref,
    subjectSnapshotDigest: candidate.subject?.snapshotDigest,
    reasonCode: candidate.redactedAllegation?.reasonCode,
    sealedEvidenceDigest: candidate.sealedEvidenceDigest,
    submissionDigest: candidate.submissionDigest,
  });
  const suppliedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.moderation-minimum-disclosure',
    candidate,
  );
  const normalizedDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.moderation-minimum-disclosure',
    normalized,
  );
  if (suppliedDigest !== normalizedDigest) {
    throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_invalid');
  }
  return normalized;
}

function normalizeStoredModerationMinimumDisclosure(
  value: unknown,
): GovernanceModerationMinimumDisclosure | null {
  if (value == null) return null;
  return normalizeModerationMinimumDisclosure(value);
}

function hashOptionalMinimumDisclosure(value: unknown): string | null {
  if (value == null) return null;
  return hashCanonicalGovernanceValue(
    'alcheme.governance.moderation-minimum-disclosure',
    normalizeModerationMinimumDisclosure(value),
  );
}

async function assertModerationMinimumDisclosureAvailable(
  tx: any,
  current: any,
  disclosure: GovernanceModerationMinimumDisclosure,
): Promise<void> {
  if (
    current.moderationReportId !== disclosure.reportId
    || current.targetCircleId !== disclosure.targetCircleId
    || current.recipientCircleId !== disclosure.recipientCircleId
    || current.purpose !== disclosure.permittedUse
  ) throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_scope_mismatch');
  const report = await tx.governanceModerationReport.findUnique({
    where: { id: disclosure.reportId },
    select: {
      id: true,
      circleId: true,
      subjectType: true,
      subjectRef: true,
      subjectSnapshotDigest: true,
      reasonCode: true,
      sealedEvidenceDigest: true,
      submissionDigest: true,
    },
  });
  if (
    !report
    || report.circleId !== disclosure.targetCircleId
    || report.subjectType !== disclosure.subject.type
    || report.subjectRef !== disclosure.subject.ref
    || report.subjectSnapshotDigest !== disclosure.subject.snapshotDigest
    || report.reasonCode !== disclosure.redactedAllegation.reasonCode
    || report.sealedEvidenceDigest !== disclosure.sealedEvidenceDigest
    || report.submissionDigest !== disclosure.submissionDigest
  ) throw new GovernanceCaseWorkflowError(409, 'governance_moderation_disclosure_source_unavailable');
}

function moderationMinimumSafeSummary(disclosure: GovernanceModerationMinimumDisclosure): string {
  return `Redacted allegation category ${disclosure.redactedAllegation.reasonCode}; `
    + `subject ${disclosure.subject.ref}; evidence digest ${disclosure.sealedEvidenceDigest}. `
    + 'Raw report, reporter identity/PII, and offsite evidence are not assigned.';
}

function requiredPubkey(value: unknown): string {
  return requiredText(value, 1, 44, 'governance_evidence_share_actor_required');
}

function requiredText(value: unknown, min: number, max: number, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < min || normalized.length > max) {
    throw new GovernanceCaseWorkflowError(400, code);
  }
  return normalized;
}

function optionalText(value: unknown, min: number, max: number, code: string): string | null {
  if (value == null || value === '') return null;
  return requiredText(value, min, max, code);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function requiredDigest(value: unknown, code: string): string {
  if (!isDigest(value)) throw new GovernanceCaseWorkflowError(409, code);
  return value;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function inTransaction<T>(prisma: any, operation: (tx: any) => Promise<T>): Promise<T> {
  return typeof prisma.$transaction === 'function' ? prisma.$transaction(operation) : operation(prisma);
}
