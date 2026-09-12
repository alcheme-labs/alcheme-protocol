import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { resolveActiveCircleGovernanceBinding } from './circleGovernanceBindings';
import { listCommitteeEligibleActors } from './circleCommitteeActors';
import { createGovernanceCaseIntake } from './governanceCase';
import {
  OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
} from './actionRegistry';
import { operatorCapabilitySuspensionSubjectRef } from './operatorCapabilitySuspensionAdmission';
import {
  buildGovernanceModerationMinimumDisclosure,
  decideGovernanceEvidenceShare,
  requestGovernanceEvidenceShare,
  resolveGovernanceEvidenceShareAuthority,
} from './governanceEvidenceShare';

const TRIAGE_SLA_SECONDS = 24 * 60 * 60;
const REASON_CODES = new Set(['spam', 'harassment', 'credible_safety_risk', 'impersonation', 'other']);
const REPORTER_VISIBILITIES = new Set(['withheld_from_subject', 'institutional_actor']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const ABUSE_SIGNALS = new Set(['none', 'suspected', 'confirmed']);
const RESOLUTION_KINDS = new Set(['action_taken', 'no_violation', 'transferred', 'closed']);
const MODERATION_MINIMUM_SHARE_PURPOSE = 'moderation_case_review_only';
const MODERATION_MINIMUM_SHARE_TTL_SECONDS = 24 * 60 * 60;

export class ModerationReportError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) {
    super(code);
  }
}

export async function submitModerationReport(
  prisma: PrismaClient,
  input: {
    circleId: number;
    reporterPubkey: string;
    targetMemberPubkey: string;
    reporterVisibility: unknown;
    reasonCode: unknown;
    evidenceStatement: unknown;
    idempotencyKey: unknown;
    now?: Date;
  },
) {
  const reporterPubkey = canonicalSolanaPublicKeyString(input.reporterPubkey);
  const targetMemberPubkey = canonicalSolanaPublicKeyString(input.targetMemberPubkey);
  const reporterVisibility = String(input.reporterVisibility ?? '').trim();
  const reasonCode = String(input.reasonCode ?? '').trim();
  const evidenceStatement = String(input.evidenceStatement ?? '').trim();
  const idempotencyKey = String(input.idempotencyKey ?? '').trim();
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) fail(400, 'invalid_moderation_report_circle');
  if (!reporterPubkey || !targetMemberPubkey) fail(400, 'invalid_moderation_report_actor');
  if (!REPORTER_VISIBILITIES.has(reporterVisibility)) fail(400, 'invalid_moderation_report_visibility');
  if (!REASON_CODES.has(reasonCode)) fail(400, 'invalid_moderation_report_reason');
  if (evidenceStatement.length < 10 || evidenceStatement.length > 2_000) fail(400, 'invalid_moderation_report_evidence');
  if (!idempotencyKey || idempotencyKey.length > 128 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    fail(400, 'invalid_moderation_report_idempotency_key');
  }

  const roomKey = `circle:${input.circleId}`;
  const room = await (prisma as any).communicationRoom.findUnique({ where: { roomKey } });
  if (!room || room.roomType !== 'circle' || room.parentCircleId !== input.circleId || room.lifecycleStatus !== 'active') {
    fail(404, 'moderation_report_room_not_found');
  }
  const target = await (prisma as any).communicationRoomMember.findUnique({
    where: { roomKey_walletPubkey: { roomKey, walletPubkey: targetMemberPubkey } },
  });
  if (!target || target.leftAt != null) fail(404, 'moderation_report_subject_not_found');

  const subjectRef = `${input.circleId}:${targetMemberPubkey}`;
  const subjectSnapshotDigest = hashCanonicalGovernanceValue('alcheme.governance.moderation-report-subject', {
    roomKey,
    targetMemberPubkey,
    role: String(target.role),
    canSpeak: target.canSpeak === true,
    muted: target.muted === true,
    banned: target.banned === true,
    joinedAt: toIso(target.joinedAt),
    leftAt: null,
  });
  const sealedEvidence = {
    schemaVersion: 1,
    statement: evidenceStatement,
    source: 'authenticated_circle_member_statement',
  };
  const sealedEvidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.moderation-report-sealed-evidence',
    sealedEvidence,
  );
  const submissionFacts = {
    circleId: input.circleId,
    roomKey,
    reporterPubkey,
    reporterVisibility,
    subjectType: 'communication_room_member',
    subjectRef,
    subjectSnapshotDigest,
    reasonCode,
    sealedEvidenceDigest,
  };
  const submissionDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.moderation-report-submission',
    submissionFacts,
  );
  const id = `mod-report:${createHash('sha256')
    .update(`${input.circleId}:${reporterPubkey}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 48)}`;
  const now = input.now ?? new Date();
  try {
    const created = await (prisma as any).governanceModerationReport.create({
      data: {
        id,
        ...submissionFacts,
        sealedEvidence,
        submissionDigest,
        triageSlaAt: new Date(now.getTime() + TRIAGE_SLA_SECONDS * 1_000),
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
      },
    });
    return { replayed: false, report: projectModerationReport(created, 'reporter') };
  } catch (error) {
    if (prismaErrorCode(error) !== 'P2002') throw error;
    const existing = await (prisma as any).governanceModerationReport.findUnique({ where: { id } });
    if (!existing || existing.submissionDigest !== submissionDigest) {
      fail(409, 'moderation_report_idempotency_conflict');
    }
    return { replayed: true, report: projectModerationReport(existing, 'reporter') };
  }
}

export async function submitOperatorMisconductReport(
  prisma: PrismaClient,
  input: {
    circleId: number;
    reporterPubkey: string;
    targetOperatorPubkey: string;
    targetActionType: unknown;
    targetSubjectType: unknown;
    targetSubjectRef: unknown;
    reasonCode: unknown;
    evidenceStatement: unknown;
    idempotencyKey: unknown;
    now?: Date;
  },
) {
  const reporterPubkey = canonicalSolanaPublicKeyString(input.reporterPubkey);
  const targetOperatorPubkey = canonicalSolanaPublicKeyString(input.targetOperatorPubkey);
  const targetActionType = String(input.targetActionType ?? '').trim();
  const targetSubjectType = String(input.targetSubjectType ?? '').trim();
  const targetSubjectRef = String(input.targetSubjectRef ?? '').trim();
  const reasonCode = String(input.reasonCode ?? '').trim();
  const evidenceStatement = String(input.evidenceStatement ?? '').trim();
  const idempotencyKey = String(input.idempotencyKey ?? '').trim();
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) fail(400, 'invalid_operator_misconduct_circle');
  if (!reporterPubkey || !targetOperatorPubkey || reporterPubkey === targetOperatorPubkey) {
    fail(400, 'invalid_operator_misconduct_actor');
  }
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(targetActionType)
    || !/^[a-z][a-z0-9._-]{2,63}$/.test(targetSubjectType)
    || !targetSubjectRef || targetSubjectRef.length > 191
    || !REASON_CODES.has(reasonCode)
    || evidenceStatement.length < 10 || evidenceStatement.length > 2_000
    || idempotencyKey.length < 8 || idempotencyKey.length > 128
    || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    fail(400, 'invalid_operator_misconduct_report');
  }
  const roomKey = `circle:${input.circleId}`;
  const room = await (prisma as any).communicationRoom.findUnique({ where: { roomKey } });
  if (!room || room.roomType !== 'circle' || room.parentCircleId !== input.circleId || room.lifecycleStatus !== 'active') {
    fail(404, 'operator_misconduct_room_not_found');
  }
  const binding = await resolveActiveCircleGovernanceBinding(prisma as any, {
    targetCircleId: input.circleId,
    actionType: targetActionType,
    purpose: 'operational_execution',
  });
  if (!binding || binding.binding.committeeCircleId === input.circleId) {
    fail(409, 'operator_misconduct_active_operator_binding_required');
  }
  const eligibleActors = await listCommitteeEligibleActors(prisma as any, {
    committeeCircleId: binding.binding.committeeCircleId,
  });
  if (!eligibleActors.some((actor) => actor.pubkey === targetOperatorPubkey)) {
    fail(409, 'operator_misconduct_target_not_current_operator');
  }
  const subjectRef = operatorCapabilitySuspensionSubjectRef({
    targetCircleId: input.circleId,
    targetOperatorPubkey,
    targetActionType,
    targetSubjectType,
    targetSubjectRef,
  });
  const subjectSnapshotDigest = hashCanonicalGovernanceValue('alcheme.governance.operator-misconduct-subject', {
    targetCircleId: input.circleId,
    targetOperatorPubkey,
    targetActionType,
    targetSubjectType,
    targetSubjectRef,
    operatorBindingId: binding.binding.id,
    operatorCommitteeCircleId: binding.binding.committeeCircleId,
  });
  const sealedEvidence = {
    schemaVersion: 1,
    statement: evidenceStatement,
    source: 'authenticated_operator_misconduct_statement',
    operatorCapability: {
      targetOperatorPubkey, targetActionType, targetSubjectType, targetSubjectRef,
    },
  };
  const sealedEvidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.moderation-report-sealed-evidence', sealedEvidence,
  );
  const submissionFacts = {
    circleId: input.circleId,
    roomKey,
    reporterPubkey,
    reporterVisibility: 'withheld_from_subject',
    subjectType: 'governed_operator_capability',
    subjectRef,
    subjectSnapshotDigest,
    reasonCode,
    sealedEvidenceDigest,
  };
  const submissionDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.operator-misconduct-report-submission', submissionFacts,
  );
  const id = `mod-report:${createHash('sha256')
    .update(`${input.circleId}:${reporterPubkey}:${idempotencyKey}`)
    .digest('hex').slice(0, 48)}`;
  const now = input.now ?? new Date();
  try {
    const created = await (prisma as any).governanceModerationReport.create({
      data: {
        id, ...submissionFacts, sealedEvidence, submissionDigest,
        triageSlaAt: new Date(now.getTime() + TRIAGE_SLA_SECONDS * 1_000),
        idempotencyKey, createdAt: now, updatedAt: now,
      },
    });
    return { replayed: false, report: projectModerationReport(created, 'reporter') };
  } catch (error) {
    if (prismaErrorCode(error) !== 'P2002') throw error;
    const existing = await (prisma as any).governanceModerationReport.findUnique({ where: { id } });
    if (!existing || existing.submissionDigest !== submissionDigest) {
      fail(409, 'operator_misconduct_idempotency_conflict');
    }
    return { replayed: true, report: projectModerationReport(existing, 'reporter') };
  }
}

export async function listModerationReports(
  prisma: PrismaClient,
  input: { circleId: number; actorPubkey: string; canTriage: boolean },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actorPubkey) fail(400, 'invalid_moderation_report_actor');
  const reports = await (prisma as any).governanceModerationReport.findMany({
    where: {
      circleId: input.circleId,
      ...(input.canTriage ? {
        OR: [
          { subjectType: { not: 'governed_operator_capability' } },
          { subjectType: 'governed_operator_capability', reporterPubkey: actorPubkey },
        ],
      } : { reporterPubkey: actorPubkey }),
    },
    include: {
      evidenceSharePackages: {
        where: { minimumDisclosure: { not: Prisma.JsonNull } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
      },
    },
    orderBy: [{ status: 'asc' }, { triageSlaAt: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return reports.flatMap((report: any) => {
    const operatorMisconduct = report.subjectType === 'governed_operator_capability';
    if (operatorMisconduct && report.reporterPubkey !== actorPubkey) return [];
    return [projectModerationReport(report, operatorMisconduct ? 'reporter' : input.canTriage ? 'triage' : 'reporter')];
  });
}

export async function delegateModerationReportMinimumShare(
  prisma: PrismaClient,
  input: {
    circleId: number;
    reportId: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: unknown;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const reportId = String(input.reportId ?? '').trim();
  const actorRole = String(input.actorRole ?? '').trim();
  const idempotencyKey = String(input.idempotencyKey ?? '').trim();
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) fail(400, 'invalid_moderation_report_circle');
  if (!actorPubkey || !['Owner', 'Admin', 'Moderator'].includes(actorRole)) {
    fail(403, 'moderation_report_minimum_share_manager_required');
  }
  if (!reportId || reportId.length > 96) fail(400, 'invalid_moderation_report_id');
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128 || /[\u0000-\u001f\u007f]/.test(idempotencyKey)) {
    fail(400, 'invalid_moderation_report_minimum_share_idempotency_key');
  }

  const execute = async (tx: any) => {
    const report = await tx.governanceModerationReport.findFirst({
      where: { id: reportId, circleId: input.circleId },
      select: {
        id: true,
        circleId: true,
        status: true,
        subjectType: true,
        subjectRef: true,
        subjectSnapshotDigest: true,
        reasonCode: true,
        sealedEvidenceDigest: true,
        submissionDigest: true,
      },
    });
    if (!report) fail(404, 'moderation_report_not_found');
    if (report.subjectType === 'governed_operator_capability') {
      fail(404, 'moderation_report_not_found');
    }
    if (report.status === 'closed') fail(409, 'moderation_report_minimum_share_closed');
    let binding;
    try {
      binding = await resolveActiveCircleGovernanceBinding(tx, {
        targetCircleId: input.circleId,
        actionType: 'communication.member.mute',
        purpose: 'collective_decision',
      });
    } catch {
      fail(409, 'moderation_report_minimum_share_active_committee_required');
    }
    if (!binding || binding.binding.committeeCircleId === input.circleId) {
      fail(409, 'moderation_report_minimum_share_active_committee_required');
    }
    const disclosure = buildGovernanceModerationMinimumDisclosure({
      reportId: report.id,
      targetCircleId: input.circleId,
      recipientCircleId: binding.binding.committeeCircleId,
      subjectType: report.subjectType,
      subjectRef: report.subjectRef,
      subjectSnapshotDigest: report.subjectSnapshotDigest,
      reasonCode: report.reasonCode,
      sealedEvidenceDigest: report.sealedEvidenceDigest,
      submissionDigest: report.submissionDigest,
    });
    const idempotencyDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.moderation-report-minimum-share-idempotency',
      { circleId: input.circleId, reportId, actorPubkey, idempotencyKey },
    );
    const now = input.now ?? new Date();
    const caseResult = await createGovernanceCaseIntake(tx, {
      circleId: input.circleId,
      title: 'Review a private moderation allegation',
      requestedDecision: 'Should the Committee approve a governed response using only the minimum disclosed moderation facts?',
      requestedActionPayload: {
        kind: 'private_moderation_case',
        evidenceDisclosureOwner: 'governance_evidence_share_package',
        automaticExecution: 'forbidden',
      },
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: 'communication.member.mute',
      subjectType: 'communication_room_member',
      subjectRef: report.subjectRef,
      authorityBindingId: binding.binding.id,
      originKind: 'manual_item',
      idempotencyKey: `moderation-minimum-case:${idempotencyDigest.slice(0, 64)}`,
      openedByPubkey: actorPubkey,
      actorRole,
      openedAt: now,
    });
    const authority = await resolveGovernanceEvidenceShareAuthority(tx, caseResult.governanceCase.id);
    if (
      authority.binding.binding.id !== binding.binding.id
      || authority.binding.binding.committeeCircleId !== disclosure.recipientCircleId
    ) fail(409, 'moderation_report_minimum_share_authority_changed');
    const requested = await requestGovernanceEvidenceShare(tx, {
      authority,
      actorPubkey,
      purpose: MODERATION_MINIMUM_SHARE_PURPOSE,
      requestNote: 'Delegate the minimum necessary moderation facts only.',
      idempotencyKey: `moderation-minimum-request:${idempotencyDigest.slice(0, 64)}`,
      moderationMinimumDisclosure: disclosure,
      now,
    });
    const authorized = await decideGovernanceEvidenceShare(tx, {
      packageId: requested.package.id,
      action: 'authorize',
      actorPubkey,
      expectedVersion: 1,
      expiresAt: new Date(now.getTime() + MODERATION_MINIMUM_SHARE_TTL_SECONDS * 1_000),
      reason: 'Minimum report facts delegated for this Case only.',
      idempotencyKey: `moderation-minimum-authorize:${idempotencyDigest.slice(0, 64)}`,
      now,
    });
    return {
      replayed: caseResult.replayed && requested.replayed && authorized.replayed,
      caseId: String(caseResult.governanceCase.id),
      caseUrl: `/governance/cases/${encodeURIComponent(String(caseResult.governanceCase.id))}`,
      package: authorized.package,
    };
  };

  return typeof (prisma as any).$transaction === 'function'
    ? (prisma as any).$transaction((tx: any) => execute(tx))
    : execute(prisma);
}

export async function triageModerationReport(
  prisma: PrismaClient,
  input: {
    circleId: number;
    reportId: string;
    actorPubkey: string;
    expectedVersion: unknown;
    transition: unknown;
    priority?: unknown;
    abuseSignal?: unknown;
    duplicateOfReportId?: unknown;
    resolutionKind?: unknown;
    actionReceiptId?: unknown;
    now?: Date;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const reportId = String(input.reportId ?? '').trim();
  const expectedVersion = Number(input.expectedVersion);
  const transition = String(input.transition ?? '').trim();
  const priority = String(input.priority ?? 'normal').trim();
  const abuseSignal = String(input.abuseSignal ?? 'none').trim();
  const duplicateOfReportId = input.duplicateOfReportId == null
    ? null
    : String(input.duplicateOfReportId).trim() || null;
  const resolutionKind = input.resolutionKind == null ? null : String(input.resolutionKind).trim() || null;
  const actionReceiptId = input.actionReceiptId == null ? null : String(input.actionReceiptId).trim() || null;
  if (!actorPubkey || !reportId || reportId.length > 96) fail(400, 'invalid_moderation_report_triage_actor');
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) fail(400, 'invalid_moderation_report_version');
  if (!['triage', 'resolve'].includes(transition)) fail(400, 'invalid_moderation_report_transition');
  if (!PRIORITIES.has(priority) || !ABUSE_SIGNALS.has(abuseSignal)) fail(400, 'invalid_moderation_report_triage');
  if (transition === 'resolve' && (!resolutionKind || !RESOLUTION_KINDS.has(resolutionKind))) {
    fail(400, 'moderation_report_resolution_kind_required');
  }
  if (transition === 'triage' && (resolutionKind || actionReceiptId)) {
    fail(400, 'moderation_report_resolution_forbidden_while_open');
  }
  if (resolutionKind === 'action_taken') {
    if (!actionReceiptId || actionReceiptId.length > 96) {
      fail(400, 'moderation_report_action_receipt_required');
    }
  } else if (actionReceiptId) {
    fail(400, 'moderation_report_action_receipt_forbidden');
  }
  if (duplicateOfReportId === reportId) fail(400, 'moderation_report_self_duplicate_forbidden');
  const now = input.now ?? new Date();

  return (prisma as any).$transaction(async (tx: any) => {
    const current = await tx.governanceModerationReport.findFirst({
      where: { id: reportId, circleId: input.circleId },
    });
    if (!current) fail(404, 'moderation_report_not_found');
    if (current.subjectType === 'governed_operator_capability') {
      fail(404, 'moderation_report_not_found');
    }
    if (current.status === 'closed') fail(409, 'moderation_report_already_closed');
    if (duplicateOfReportId) {
      const duplicate = await tx.governanceModerationReport.findFirst({
        where: { id: duplicateOfReportId, circleId: input.circleId },
      });
      if (!duplicate) fail(400, 'moderation_report_duplicate_not_found');
    }
    if (resolutionKind === 'action_taken') {
      const receipt = await tx.operationReceipt.findUnique({
        where: { id: actionReceiptId },
        include: {
          invocation: { include: { contractVersion: true } },
          initialEffect: true,
        },
      });
      if (!receipt
        || receipt.executionStatus !== 'succeeded'
        || receipt.invocation?.governanceHomeType !== 'circle'
        || receipt.invocation?.governanceHomeRef !== String(input.circleId)
        || receipt.invocation?.subjectType !== current.subjectType
        || receipt.invocation?.subjectRef !== current.subjectRef
        || receipt.invocation?.contractVersion?.actionType !== 'communication.member.mute'
        || !receipt.initialEffect
        || receipt.initialEffect.initialReceiptId !== receipt.id
        || receipt.initialEffect.invocationId !== receipt.invocationId) {
        fail(409, 'moderation_report_action_receipt_owner_mismatch');
      }
    }
    const updated = await tx.governanceModerationReport.updateMany({
      where: { id: reportId, circleId: input.circleId, version: expectedVersion, status: { not: 'closed' } },
      data: {
        priority,
        abuseSignal,
        duplicateOfReportId,
        triageOwnerPubkey: actorPubkey,
        status: transition === 'resolve' ? 'closed' : 'triaged',
        closureReason: transition === 'resolve' ? resolutionKind : null,
        resolutionReceiptId: transition === 'resolve' ? actionReceiptId : null,
        closedAt: transition === 'resolve' ? now : null,
        version: { increment: 1 },
        updatedAt: now,
      },
    });
    if (updated.count !== 1) fail(409, 'moderation_report_version_conflict');
    const readback = await tx.governanceModerationReport.findUnique({ where: { id: reportId } });
    if (!readback || readback.version !== expectedVersion + 1) fail(409, 'moderation_report_readback_mismatch');
    return projectModerationReport(readback, 'triage');
  });
}

function projectModerationReport(report: any, audience: 'reporter' | 'triage') {
  const sealedEvidence = report.sealedEvidence && typeof report.sealedEvidence === 'object'
    ? report.sealedEvidence as Record<string, unknown>
    : {};
  const operatorMisconduct = report.subjectType === 'governed_operator_capability';
  const operatorCapability = sealedEvidence.operatorCapability
    && typeof sealedEvidence.operatorCapability === 'object'
    ? sealedEvidence.operatorCapability as Record<string, unknown>
    : {};
  return {
    schemaVersion: 1,
    reportKind: operatorMisconduct ? 'operator_misconduct' : 'member_moderation',
    id: String(report.id),
    circleId: Number(report.circleId),
    roomKey: String(report.roomKey),
    reporter: {
      visibility: String(report.reporterVisibility),
      pubkey: audience === 'triage' || audience === 'reporter' ? String(report.reporterPubkey) : null,
    },
    subject: {
      type: String(report.subjectType),
      ref: String(report.subjectRef),
      snapshotDigest: String(report.subjectSnapshotDigest),
    },
    reasonCode: String(report.reasonCode),
    sealedEvidence: {
      statement: String(sealedEvidence.statement ?? ''),
      digest: String(report.sealedEvidenceDigest),
      visibility: 'reporter_and_authorized_triage_only',
    },
    reporterStatus: {
      state: reporterSafeStatus(report),
      updatedAt: toIso(report.updatedAt),
      closedAt: toIso(report.closedAt),
      detailVisibility: 'status_only_subject_private_outcome_withheld',
      reporterRightsImpact: 'none_report_triage_is_not_governed_action',
    },
    triage: audience === 'triage' ? {
      ownerPubkey: report.triageOwnerPubkey == null ? null : String(report.triageOwnerPubkey),
      slaAt: toIso(report.triageSlaAt),
      status: String(report.status),
      priority: String(report.priority),
      duplicateOfReportId: report.duplicateOfReportId == null ? null : String(report.duplicateOfReportId),
      abuseSignal: String(report.abuseSignal),
      resolutionKind: report.closureReason == null ? null : String(report.closureReason),
      resolutionReceiptId: report.resolutionReceiptId == null ? null : String(report.resolutionReceiptId),
      closedAt: toIso(report.closedAt),
    } : null,
    actionPreflight: {
      actionType: operatorMisconduct ? OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE : 'communication.member.mute',
      subjectType: operatorMisconduct ? 'governed_operator_capability' : 'communication_room_member',
      subjectRef: String(report.subjectRef),
      scope: String(report.roomKey),
      reasonCode: String(report.reasonCode),
      maximumDurationSeconds: 24 * 60 * 60,
      expiry: 'scheduler_and_read_reconciliation',
      notification: 'subject_notification_and_canonical_state_readback',
      appeal: 'canonical_operation_receipt_window',
      automaticExecution: 'forbidden',
      availability: operatorMisconduct
        ? 'available_separate_temporary_governed_action'
        : 'available_separate_manual_action',
      authority: 'separate_exact_governed_invocation_required',
    },
    operatorMisconduct: operatorMisconduct ? {
      targetOperatorPubkey: String(operatorCapability.targetOperatorPubkey ?? ''),
      targetActionType: String(operatorCapability.targetActionType ?? ''),
      targetSubjectType: String(operatorCapability.targetSubjectType ?? ''),
      targetSubjectRef: String(operatorCapability.targetSubjectRef ?? ''),
      triageStatus: 'blocked_no_independent_authority',
      reportedOperatorAccess: 'forbidden',
      reportedCommitteeAccess: 'forbidden',
      automaticSuspension: 'forbidden',
    } : null,
    minimumShare: audience === 'triage' && Array.isArray(report.evidenceSharePackages)
      && report.evidenceSharePackages[0]
      ? {
        caseId: String(report.evidenceSharePackages[0].caseId),
        packageId: String(report.evidenceSharePackages[0].id),
        status: String(report.evidenceSharePackages[0].status),
        purpose: String(report.evidenceSharePackages[0].purpose),
        digest: String(report.evidenceSharePackages[0].digest),
        expiresAt: toIso(report.evidenceSharePackages[0].expiresAt),
      }
      : null,
    version: Number(report.version),
    createdAt: toIso(report.createdAt),
    updatedAt: toIso(report.updatedAt),
  };
}

function reporterSafeStatus(report: any) {
  const status = String(report.status ?? '');
  const resolutionKind = report.closureReason == null ? null : String(report.closureReason);
  if (status === 'submitted' && resolutionKind == null && report.closedAt == null) return 'received';
  if (status === 'triaged' && resolutionKind == null && report.closedAt == null) return 'triaged';
  if (status === 'closed' && resolutionKind && RESOLUTION_KINDS.has(resolutionKind) && report.closedAt != null) {
    return resolutionKind;
  }
  fail(409, 'moderation_report_reporter_status_owner_mismatch');
}

function prismaErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '') || null
    : null;
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function fail(statusCode: number, code: string): never {
  throw new ModerationReportError(statusCode, code);
}
