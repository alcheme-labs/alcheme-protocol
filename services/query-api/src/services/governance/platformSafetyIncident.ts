import type { PrismaClient } from '@prisma/client';

import {
  createGovernedActionRegistry,
  PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
  PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_ACTIVATION_RESOLVE_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_CLOSE_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_DECLARE_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_EXTEND_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_MERGE_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_REVIEW_ACTION_TYPE,
  PLATFORM_SAFETY_INCIDENT_UPGRADE_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { GovernedActionGateway } from './governedActionGateway';
import {
  resolveGovernedSystemRoleOperationRuntime,
  type GovernedActionGatewayRuntimeBinding,
} from './governedActionGatewayRuntime';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import {
  openGovernedActionAppeal,
  resolveGovernedActionAppeal,
  type GovernedActionAppealResolutionOutcome,
} from './governedActionAppeal';
import {
  PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE,
  PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
  PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
  PLATFORM_SAFETY_INCIDENT_POLICY_ID,
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES,
  PLATFORM_SAFETY_INCIDENT_POLICY_VERSION,
  PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
  PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE,
  PLATFORM_SAFETY_POLICY_ADMIN_ROLE,
  PLATFORM_SAFETY_POLICY_DIGEST,
  PLATFORM_SAFETY_POLICY_VERSION_ID,
  PlatformSafetyError,
  assertActorInRole,
  assertIndependentRoleSeparation,
  ensurePlatformSafetySystemGovernanceHome,
  resolvePlatformSafetyRole,
  type PlatformSafetyRoleKey,
  type PlatformSafetyRoleResolution,
} from './platformSafety';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';

const ACTIVATION_WINDOW_SECONDS =
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES.declaration.activationWindowSeconds;
const MIN_DURATION_SECONDS =
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES.declaration.minimumDurationSeconds;
const MAX_DURATION_SECONDS =
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES.declaration.maximumDurationSeconds;
const REVIEW_DUE_SECONDS =
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES.review.dueSecondsAfterEnd;
const INCIDENT_CATEGORIES = new Set<string>(
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES.declaration.categories,
);
const INCIDENT_SEVERITIES = new Set<string>(
  PLATFORM_SAFETY_INCIDENT_POLICY_RULES.declaration.severities,
);

type IncidentActionInput = {
  actorPubkey: string;
  actionType: string;
  incidentId: string;
  targetCircleId: number;
  role: PlatformSafetyRoleResolution;
  expectedRoleKey: PlatformSafetyRoleKey;
  payload: Record<string, unknown>;
  reasonCode: string;
  idempotencyKey: string;
  now: Date;
  home: any;
};

export async function declarePlatformSafetyIncident(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    targetCircleId: number;
    category: string;
    severity: 'sev2' | 'sev1';
    maxDurationSeconds: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actorPubkey = exactActor(input.actorPubkey);
  const category = input.category.trim();
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  if (
    !Number.isSafeInteger(input.targetCircleId)
    || input.targetCircleId <= 0
    || !INCIDENT_CATEGORIES.has(category)
    || !INCIDENT_SEVERITIES.has(input.severity)
    || !Number.isSafeInteger(input.maxDurationSeconds)
    || input.maxDurationSeconds < MIN_DURATION_SECONDS
    || input.maxDurationSeconds > MAX_DURATION_SECONDS
  ) {
    throw incidentError(400, 'platform_safety_incident_declaration_invalid');
  }
  const now = input.now ?? new Date();
  const identity = {
    actorPubkey,
    targetCircleId: input.targetCircleId,
    idempotencyKey,
  };
  const incidentId = `platform-safety-incident:${hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-incident-id',
    identity,
  ).slice(0, 63)}`;
  const intent = {
    incidentId,
    targetCircleId: input.targetCircleId,
    category,
    severity: input.severity,
    maxDurationSeconds: input.maxDurationSeconds,
    reasonCode,
    evidenceDigest,
  };
  const intentDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-incident-declare-intent',
    intent,
  );
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, `declare:${input.targetCircleId}`);
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const existing = await tx.platformSafetyIncident.findUnique({
      where: { id: incidentId },
      include: { events: { orderBy: { sequence: 'asc' } } },
    });
    if (existing) {
      const declarationEvent = existing.events[0];
      if (
        existing.commanderPubkey !== actorPubkey
        || existing.targetCircleId !== input.targetCircleId
        || existing.category !== category
        || existing.severity !== input.severity
        || existing.maxDurationSeconds !== input.maxDurationSeconds
        || existing.evidenceDigest !== evidenceDigest
        || declarationEvent?.reasonCode !== reasonCode
      ) {
        throw incidentError(
          409,
          'platform_safety_incident_declaration_idempotency_conflict',
        );
      }
      return { replayed: true, incident: projectIncident(existing) };
    }
    const overlapping = await tx.platformSafetyIncident.findFirst({
      where: {
        targetCircleId: input.targetCircleId,
        category,
        state: { in: ['pending_approval', 'active', 'review_required'] },
      },
      select: { id: true, state: true },
    });
    if (overlapping) {
      throw incidentError(409, 'platform_safety_incident_overlap');
    }
    const circle = await tx.circle.findUnique({
      where: { id: input.targetCircleId },
      select: { id: true, kind: true, mode: true },
    });
    if (!circle || circle.kind !== 'main' || circle.mode !== 'social') {
      throw incidentError(404, 'platform_safety_incident_target_not_found');
    }
    const [responder, reviewer] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE),
    ]);
    assertActorInRole(responder, actorPubkey);
    assertIndependentRoleSeparation(responder, reviewer);
    await assertIncidentPolicy(tx);
    const activationDeadline = new Date(
      now.getTime() + ACTIVATION_WINDOW_SECONDS * 1_000,
    );
    const scope = {
      targetType: 'single_circle',
      targetCircleId: input.targetCircleId,
      category,
      severity: input.severity,
    };
    const allowedEmergencyActions = [
      PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
      PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
    ];
    const restoreConditions = {
      automaticMaxDurationExpiry: true,
      governedCommanderClose: true,
      existingEffectsKeepOwnExpiryOrRelease: true,
      noNewActionsAfterEnd: true,
    };
    const payload = {
      contractVersion: 'platform-safety-incident-declare-current',
      intentDigest,
      ...intent,
      scope,
      allowedEmergencyActions,
      restoreConditions,
      activationDeadline: activationDeadline.toISOString(),
      authority: frozenIncidentAuthority(responder, reviewer),
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
      requiresDistinctActivationReviewer: true,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_DECLARE_ACTION_TYPE,
      incidentId,
      targetCircleId: input.targetCircleId,
      role: responder,
      expectedRoleKey: PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    if (action.replayed) {
      throw incidentError(409, 'platform_safety_incident_replay_state_mismatch');
    }
    await transitionOperationEffectInTransaction(tx, {
      effectId: action.effect.id,
      nextState: 'ratification_required',
      reasonCode: 'platform_safety_incident_activation_review_required',
      actorPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    const incident = await tx.platformSafetyIncident.create({
      data: {
        id: incidentId,
        policyVersionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
        policyDigest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
        targetCircleId: input.targetCircleId,
        category,
        severity: input.severity,
        commanderPubkey: actorPubkey,
        scope,
        allowedEmergencyActions,
        restoreConditions,
        maxDurationSeconds: input.maxDurationSeconds,
        state: 'pending_approval',
        stateVersion: 0,
        evidenceDigest,
        declarationReceiptId: action.receipt.id,
        declarationEffectId: action.effect.id,
        activationDeadline,
      },
    });
    await createIncidentEvent(tx, incident, {
      kind: 'declare',
      actorPubkey,
      fromState: null,
      toState: 'pending_approval',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

export async function resolvePlatformSafetyIncidentActivation(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    incidentId: string;
    outcome: 'approve' | 'reject';
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const reviewerPubkey = exactActor(input.reviewerPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  if (!['approve', 'reject'].includes(input.outcome)) {
    throw incidentError(400, 'platform_safety_incident_activation_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, incidentId);
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const incident = await loadIncident(tx, incidentId);
    const existing = await findExistingAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_ACTIVATION_RESOLVE_ACTION_TYPE,
      incidentId,
      idempotencyKey,
    });
    const intentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-activation-intent',
      {
        incidentId,
        outcome: input.outcome,
        reasonCode,
        evidenceDigest,
      },
    );
    if (existing) {
      assertExistingIntent(existing, intentDigest);
      return { replayed: true, incident: projectIncident(incident) };
    }
    if (
      incident.state !== 'pending_approval'
      || date(incident.activationDeadline).getTime() < now.getTime()
    ) {
      throw incidentError(
        409,
        'platform_safety_incident_activation_state_invalid',
      );
    }
    const [responder, reviewer, activationAppealReviewer] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_POLICY_ADMIN_ROLE),
    ]);
    assertActorInRole(reviewer, reviewerPubkey);
    assertIndependentRoleSeparation(responder, reviewer);
    assertIndependentRoleSeparation(responder, activationAppealReviewer);
    assertIndependentRoleSeparation(reviewer, activationAppealReviewer);
    if (reviewerPubkey === incident.commanderPubkey) {
      throw incidentError(
        409,
        'platform_safety_incident_activation_reviewer_conflict',
      );
    }
    assertFrozenIncidentAuthority(incident, responder, reviewer);
    await assertIncidentPolicy(tx);
    const payload = {
      contractVersion: 'platform-safety-incident-activation-resolve-current',
      intentDigest,
      incidentId,
      outcome: input.outcome,
      reasonCode,
      evidenceDigest,
      commanderPubkey: incident.commanderPubkey,
      declarationReceiptId: incident.declarationReceiptId,
      declarationEffectId: incident.declarationEffectId,
      authority: frozenIncidentAuthority(
        responder,
        reviewer,
        activationAppealReviewer,
      ),
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_ACTIVATION_RESOLVE_ACTION_TYPE,
      incidentId,
      targetCircleId: incident.targetCircleId,
      role: reviewer,
      expectedRoleKey: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    const approved = input.outcome === 'approve';
    await transitionOperationEffectInTransaction(tx, {
      effectId: incident.declarationEffectId,
      nextState: approved ? 'active' : 'revoked',
      reasonCode: approved
        ? 'platform_safety_incident_activation_approved'
        : 'platform_safety_incident_activation_rejected',
      actorPubkey: reviewerPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    await transitionOperationEffectInTransaction(tx, {
      effectId: action.effect.id,
      nextState: 'expired',
      reasonCode: 'platform_safety_incident_activation_decision_completed',
      actorPubkey: reviewerPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    const expiresAt = approved
      ? new Date(now.getTime() + incident.maxDurationSeconds * 1_000)
      : null;
    await updateIncidentState(tx, incident, {
      state: approved ? 'active' : 'rejected',
      data: {
        activatedAt: approved ? now : null,
        expiresAt,
        endedAt: approved ? null : now,
      },
    });
    await createIncidentEvent(tx, incident, {
      kind: approved ? 'activate' : 'reject',
      actorPubkey: reviewerPubkey,
      fromState: 'pending_approval',
      toState: approved ? 'active' : 'rejected',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

export async function closePlatformSafetyIncident(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    incidentId: string;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  return endPlatformSafetyIncident(prisma, input);
}

export async function upgradePlatformSafetyIncident(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    incidentId: string;
    severity: 'sev1';
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const reviewerPubkey = exactActor(input.reviewerPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  if (input.severity !== 'sev1') {
    throw incidentError(400, 'platform_safety_incident_upgrade_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, incidentId);
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const incident = await loadIncident(tx, incidentId);
    const intentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-upgrade-intent',
      { incidentId, severity: input.severity, reasonCode, evidenceDigest },
    );
    const existing = await findExistingAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_UPGRADE_ACTION_TYPE,
      incidentId,
      idempotencyKey,
    });
    if (existing) {
      assertExistingIntent(existing, intentDigest);
      return { replayed: true, incident: projectIncident(incident) };
    }
    if (incident.state !== 'active' || incident.severity !== 'sev2') {
      throw incidentError(409, 'platform_safety_incident_upgrade_state_invalid');
    }
    const { responder, reviewer } = await assertIndependentLifecycleReviewer(
      tx,
      incident,
      reviewerPubkey,
    );
    const scope = {
      ...record(incident.scope),
      severity: input.severity,
    };
    const payload = {
      contractVersion: 'platform-safety-incident-upgrade-current',
      intentDigest,
      incidentId,
      fromSeverity: incident.severity,
      toSeverity: input.severity,
      reasonCode,
      evidenceDigest,
      scope,
      authority: frozenIncidentAuthority(responder, reviewer),
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_UPGRADE_ACTION_TYPE,
      incidentId,
      targetCircleId: incident.targetCircleId,
      role: reviewer,
      expectedRoleKey: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    await completeLifecycleMutationEffect(
      tx,
      action,
      reviewerPubkey,
      'platform_safety_incident_upgrade_completed',
      now,
    );
    await updateIncidentState(tx, incident, {
      state: 'active',
      data: { severity: input.severity, scope },
    });
    await createIncidentEvent(tx, incident, {
      kind: 'upgrade',
      actorPubkey: reviewerPubkey,
      fromState: 'active',
      toState: 'active',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

export async function extendPlatformSafetyIncident(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    incidentId: string;
    additionalDurationSeconds: number;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const reviewerPubkey = exactActor(input.reviewerPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  if (
    !Number.isSafeInteger(input.additionalDurationSeconds)
    || input.additionalDurationSeconds < MIN_DURATION_SECONDS
    || input.additionalDurationSeconds > MAX_DURATION_SECONDS
  ) {
    throw incidentError(400, 'platform_safety_incident_extension_invalid');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, incidentId);
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const incident = await loadIncident(tx, incidentId);
    const intentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-extend-intent',
      {
        incidentId,
        additionalDurationSeconds: input.additionalDurationSeconds,
        reasonCode,
        evidenceDigest,
      },
    );
    const existing = await findExistingAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_EXTEND_ACTION_TYPE,
      incidentId,
      idempotencyKey,
    });
    if (existing) {
      assertExistingIntent(existing, intentDigest);
      return { replayed: true, incident: projectIncident(incident) };
    }
    if (!incident.activatedAt || !incident.expiresAt || incident.state !== 'active') {
      throw incidentError(409, 'platform_safety_incident_extension_state_invalid');
    }
    const activatedAt = date(incident.activatedAt);
    const previousExpiresAt = date(incident.expiresAt);
    const maximumExpiresAt = new Date(
      activatedAt.getTime() + MAX_DURATION_SECONDS * 1_000,
    );
    const expiresAt = new Date(
      previousExpiresAt.getTime() + input.additionalDurationSeconds * 1_000,
    );
    const maxDurationSeconds = Math.floor(
      (expiresAt.getTime() - activatedAt.getTime()) / 1_000,
    );
    if (
      previousExpiresAt.getTime() <= now.getTime()
      || expiresAt.getTime() > maximumExpiresAt.getTime()
    ) {
      throw incidentError(409, 'platform_safety_incident_extension_limit');
    }
    const { reviewer } = await assertIndependentLifecycleReviewer(
      tx,
      incident,
      reviewerPubkey,
    );
    const payload = {
      contractVersion: 'platform-safety-incident-extend-current',
      intentDigest,
      incidentId,
      additionalDurationSeconds: input.additionalDurationSeconds,
      previousExpiresAt: previousExpiresAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      maximumExpiresAt: maximumExpiresAt.toISOString(),
      maxDurationSeconds,
      reasonCode,
      evidenceDigest,
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_EXTEND_ACTION_TYPE,
      incidentId,
      targetCircleId: incident.targetCircleId,
      role: reviewer,
      expectedRoleKey: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    await completeLifecycleMutationEffect(
      tx,
      action,
      reviewerPubkey,
      'platform_safety_incident_extension_completed',
      now,
    );
    await updateIncidentState(tx, incident, {
      state: 'active',
      data: { expiresAt, maxDurationSeconds },
    });
    await createIncidentEvent(tx, incident, {
      kind: 'extend',
      actorPubkey: reviewerPubkey,
      fromState: 'active',
      toState: 'active',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

export async function mergePlatformSafetyIncidents(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    incidentId: string;
    sourceIncidentId: string;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const reviewerPubkey = exactActor(input.reviewerPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const sourceIncidentId = exactIncidentId(input.sourceIncidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  if (sourceIncidentId === incidentId) {
    throw incidentError(400, 'platform_safety_incident_merge_self');
  }
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    for (const id of [incidentId, sourceIncidentId].sort()) {
      await incidentLock(tx, id);
    }
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const [incident, source] = await Promise.all([
      loadIncident(tx, incidentId),
      loadIncident(tx, sourceIncidentId),
    ]);
    const intentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-merge-intent',
      { incidentId, sourceIncidentId, reasonCode, evidenceDigest },
    );
    const existing = await findExistingAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_MERGE_ACTION_TYPE,
      incidentId,
      idempotencyKey,
    });
    if (existing) {
      assertExistingIntent(existing, intentDigest);
      return {
        replayed: true,
        incident: projectIncident(incident),
        mergedIncident: projectIncident(source),
      };
    }
    if (
      incident.state !== 'active'
      || source.state !== 'active'
      || incident.targetCircleId !== source.targetCircleId
      || !incident.expiresAt
      || !source.expiresAt
    ) {
      throw incidentError(409, 'platform_safety_incident_merge_scope_invalid');
    }
    const { reviewer } = await assertIndependentLifecycleReviewer(
      tx,
      incident,
      reviewerPubkey,
    );
    await assertIndependentLifecycleReviewer(tx, source, reviewerPubkey);
    const categories = [...new Set([
      ...incidentCategories(incident),
      ...incidentCategories(source),
    ])].sort();
    const severity =
      incident.severity === 'sev1' || source.severity === 'sev1'
        ? 'sev1'
        : 'sev2';
    const expiresAt = new Date(Math.min(
      date(incident.expiresAt).getTime(),
      date(source.expiresAt).getTime(),
    ));
    const maxDurationSeconds = Math.floor(
      (
        expiresAt.getTime()
        - date(incident.activatedAt).getTime()
      ) / 1_000,
    );
    const scope = {
      ...record(incident.scope),
      categories,
      severity,
      mergedIncidentIds: [...new Set([
        ...stringArray(record(incident.scope).mergedIncidentIds),
        source.id,
      ])].sort(),
    };
    const payload = {
      contractVersion: 'platform-safety-incident-merge-current',
      intentDigest,
      incidentId,
      sourceIncidentId,
      targetCircleId: incident.targetCircleId,
      categories,
      severity,
      expiresAt: expiresAt.toISOString(),
      maxDurationSeconds,
      mergeMayExtendExpiry: false,
      reasonCode,
      evidenceDigest,
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
      sourceRequiresAfterActionReview: true,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_MERGE_ACTION_TYPE,
      incidentId,
      targetCircleId: incident.targetCircleId,
      role: reviewer,
      expectedRoleKey: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    await transitionOperationEffectInTransaction(tx, {
      effectId: source.declarationEffectId,
      nextState: 'revoked',
      reasonCode: 'platform_safety_incident_merged_into_active_incident',
      actorPubkey: reviewerPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    await completeLifecycleMutationEffect(
      tx,
      action,
      reviewerPubkey,
      'platform_safety_incident_merge_completed',
      now,
    );
    const reviewDueAt = new Date(now.getTime() + REVIEW_DUE_SECONDS * 1_000);
    await updateIncidentState(tx, incident, {
      state: 'active',
      data: { severity, scope, expiresAt, maxDurationSeconds },
    });
    await updateIncidentState(tx, source, {
      state: 'review_required',
      data: { endedAt: now, reviewDueAt },
    });
    await createIncidentEvent(tx, incident, {
      kind: 'merge',
      actorPubkey: reviewerPubkey,
      fromState: 'active',
      toState: 'active',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    await createIncidentEvent(tx, source, {
      kind: 'merge_source',
      actorPubkey: reviewerPubkey,
      fromState: 'active',
      toState: 'review_required',
      receiptId: action.receipt.id,
      effectId: source.declarationEffectId,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
      mergedIncident: projectIncident(
        await loadIncident(tx, sourceIncidentId),
      ),
    };
  });
}

export async function openPlatformSafetyIncidentActivationAppeal(
  prisma: PrismaClient,
  input: {
    appellantPubkey: string;
    incidentId: string;
    reasonCode: string;
    evidenceDigest: string;
    now?: Date;
  },
) {
  const appellantPubkey = exactActor(input.appellantPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const incident = await loadIncident(prisma as any, incidentId);
  const activationEvent = incident.events.find(
    (event: any) => event.kind === 'activate',
  );
  if (
    incident.commanderPubkey !== appellantPubkey
    || incident.state !== 'active'
    || !activationEvent?.receiptId
  ) {
    throw incidentError(
      404,
      'platform_safety_incident_activation_appeal_not_found',
    );
  }
  try {
    const result = await openGovernedActionAppeal(prisma as any, {
      originalReceiptId: activationEvent.receiptId,
      appellantPubkey,
      reasonCode,
      evidence: {
        contractVersion:
          'platform-safety-incident-activation-appeal-evidence-v1',
        evidenceDigest,
      },
      now: input.now,
    });
    return {
      ...result,
      incident: projectIncident(incident),
    };
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith('governed_action_appeal_')
    ) {
      throw incidentError(409, error.message);
    }
    throw error;
  }
}

export async function resolvePlatformSafetyIncidentActivationAppeal(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    appealId: string;
    outcome: Extract<GovernedActionAppealResolutionOutcome, 'uphold' | 'revoke'>;
    reasonCode: string;
    evidenceDigest: string;
    now?: Date;
  },
) {
  const reviewerPubkey = exactActor(input.reviewerPubkey);
  const appealId = input.appealId.trim();
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  if (!appealId || !['uphold', 'revoke'].includes(input.outcome)) {
    throw incidentError(
      400,
      'platform_safety_incident_activation_appeal_resolution_invalid',
    );
  }
  const now = input.now ?? new Date();
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, `activation-appeal:${appealId}`);
    const appeal = await tx.governedActionAppeal.findUnique({
      where: { id: appealId },
      include: {
        originalReceipt: {
          include: {
            invocation: { include: { contractVersion: true } },
          },
        },
      },
    });
    const originalInvocation = appeal?.originalReceipt?.invocation;
    const payload = record(originalInvocation?.requestedEffect);
    const incidentId = exactIncidentId(String(payload.incidentId || ''));
    if (
      !appeal
      || originalInvocation?.contractVersion?.actionType
        !== PLATFORM_SAFETY_INCIDENT_ACTIVATION_RESOLVE_ACTION_TYPE
      || payload.outcome !== 'approve'
    ) {
      throw incidentError(
        404,
        'platform_safety_incident_activation_appeal_not_found',
      );
    }
    const incident = await loadIncident(tx, incidentId);
    const reviewRole = await resolvePlatformSafetyRole(
      tx,
      PLATFORM_SAFETY_POLICY_ADMIN_ROLE,
    );
    assertActorInRole(reviewRole, reviewerPubkey);
    if (
      reviewerPubkey === appeal.originalReceipt.actorPubkey
      || reviewerPubkey === appeal.appellantPubkey
    ) {
      throw incidentError(
        409,
        'platform_safety_incident_activation_appeal_reviewer_conflict',
      );
    }
    const appealPayload = record(
      (
        await tx.governedActionInvocation.findUnique({
          where: { id: appeal.appealInvocationId },
        })
      )?.requestedEffect,
    );
    const frozenAuthority = record(
      appealPayload.independentReviewAuthority,
    );
    const actorSetDigest = roleActorSetDigest(reviewRole);
    const eligibleActors = reviewRole.actorPubkeys.filter(
      (actor) =>
        actor !== appeal.originalReceipt.actorPubkey
        && actor !== appeal.appellantPubkey,
    );
    const eligibleActorSetDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-appeal-eligible-actors',
      eligibleActors,
    );
    if (
      frozenAuthority.bindingId !== reviewRole.binding.id
      || frozenAuthority.policyVersionId
        !== reviewRole.binding.policyVersionId
      || frozenAuthority.policyDigest !== PLATFORM_SAFETY_POLICY_DIGEST
      || frozenAuthority.actorSetDigest !== actorSetDigest
      || frozenAuthority.eligibleActorSetDigest !== eligibleActorSetDigest
      || !eligibleActors.includes(reviewerPubkey)
    ) {
      throw incidentError(
        409,
        'platform_safety_incident_activation_appeal_authority_drift',
      );
    }
    const reviewerAuthorityDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-activation-appeal-authority',
      {
        appealId,
        reviewerPubkey,
        bindingId: reviewRole.binding.id,
        policyVersionId: reviewRole.binding.policyVersionId,
        actorSetDigest,
        eligibleActorSetDigest,
      },
    );
    const result = await resolveGovernedActionAppeal(tx, {
      appealId,
      reviewerPubkey,
      reviewerAuthorityDigest,
      outcome: input.outcome,
      reasonCode,
      evidence: {
        contractVersion:
          'platform-safety-incident-activation-appeal-resolution-v1',
        evidenceDigest,
      },
      now,
    });
    if (
      !result.replayed
      && input.outcome === 'revoke'
      && incident.state === 'active'
    ) {
      await transitionOperationEffectInTransaction(tx, {
        effectId: incident.declarationEffectId,
        nextState: 'revoked',
        reasonCode: 'platform_safety_incident_wrong_activation_revoked',
        actorPubkey: reviewerPubkey,
        sourceReceiptId: null,
        occurredAt: now,
      });
      const reviewDueAt = new Date(now.getTime() + REVIEW_DUE_SECONDS * 1_000);
      await updateIncidentState(tx, incident, {
        state: 'review_required',
        data: { endedAt: now, reviewDueAt },
      });
      await createIncidentEvent(tx, incident, {
        kind: 'activation_appeal_revoke',
        actorPubkey: reviewerPubkey,
        fromState: 'active',
        toState: 'review_required',
        receiptId: result.resolutionReceipt.id,
        effectId: incident.declarationEffectId,
        reasonCode,
        evidenceDigest,
        occurredAt: now,
      });
    }
    return {
      ...result,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

export async function reviewPlatformSafetyIncident(
  prisma: PrismaClient,
  input: {
    reviewerPubkey: string;
    incidentId: string;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const reviewerPubkey = exactActor(input.reviewerPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, incidentId);
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const incident = await loadIncident(tx, incidentId);
    const existing = await findExistingAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_REVIEW_ACTION_TYPE,
      incidentId,
      idempotencyKey,
    });
    const intentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-review-intent',
      { incidentId, reasonCode, evidenceDigest },
    );
    if (existing) {
      assertExistingIntent(existing, intentDigest);
      return { replayed: true, incident: projectIncident(incident) };
    }
    if (incident.state !== 'review_required' || !incident.endedAt) {
      throw incidentError(409, 'platform_safety_incident_review_state_invalid');
    }
    const [responder, reviewer] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE),
    ]);
    assertActorInRole(reviewer, reviewerPubkey);
    assertIndependentRoleSeparation(responder, reviewer);
    if (reviewerPubkey === incident.commanderPubkey) {
      throw incidentError(409, 'platform_safety_incident_reviewer_conflict');
    }
    assertFrozenIncidentAuthority(incident, responder, reviewer);
    await assertIncidentPolicy(tx);
    const payload = {
      contractVersion: 'platform-safety-incident-review-current',
      intentDigest,
      incidentId,
      reasonCode,
      evidenceDigest,
      endedAt: date(incident.endedAt).toISOString(),
      reviewDueAt: date(incident.reviewDueAt).toISOString(),
      authority: frozenIncidentAuthority(responder, reviewer),
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey: reviewerPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_REVIEW_ACTION_TYPE,
      incidentId,
      targetCircleId: incident.targetCircleId,
      role: reviewer,
      expectedRoleKey: PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    await transitionOperationEffectInTransaction(tx, {
      effectId: action.effect.id,
      nextState: 'expired',
      reasonCode: 'platform_safety_incident_review_completed',
      actorPubkey: reviewerPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    await updateIncidentState(tx, incident, {
      state: 'closed',
      data: { reviewedAt: now },
    });
    await createIncidentEvent(tx, incident, {
      kind: 'review',
      actorPubkey: reviewerPubkey,
      fromState: 'review_required',
      toState: 'closed',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

export async function readPlatformSafetyIncidents(
  prisma: PrismaClient,
  input: { actorPubkey: string },
) {
  const actorPubkey = exactActor(input.actorPubkey);
  const roles = await Promise.all([
    resolvePlatformSafetyRole(
      prisma as any,
      PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE,
    ),
    resolvePlatformSafetyRole(
      prisma as any,
      PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE,
    ),
    resolvePlatformSafetyRole(
      prisma as any,
      PLATFORM_SAFETY_APPEAL_REVIEWER_ROLE,
    ),
  ]);
  if (!roles.some((role) => role.actorPubkeys.includes(actorPubkey))) {
    throw incidentError(403, 'platform_safety_role_actor_required');
  }
  await reconcilePlatformSafetyIncidents(prisma, { now: new Date() });
  const incidents = await (prisma as any).platformSafetyIncident.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { events: { orderBy: { sequence: 'asc' } } },
  });
  return Promise.all(
    incidents.map((incident: any) =>
      loadIncident(prisma as any, incident.id).then(projectIncident)),
  );
}

export async function reconcilePlatformSafetyIncidents(
  prisma: PrismaClient,
  input?: { now?: Date },
) {
  const now = input?.now ?? new Date();
  return (prisma as any).$transaction((tx: any) =>
    reconcilePlatformSafetyIncidentsInTransaction(tx, now));
}

async function endPlatformSafetyIncident(
  prisma: PrismaClient,
  input: {
    actorPubkey: string;
    incidentId: string;
    reasonCode: string;
    evidenceDigest: string;
    idempotencyKey: string;
    now?: Date;
  },
) {
  const actorPubkey = exactActor(input.actorPubkey);
  const incidentId = exactIncidentId(input.incidentId);
  const reasonCode = exactReason(input.reasonCode);
  const evidenceDigest = exactDigest(input.evidenceDigest);
  const idempotencyKey = exactIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  const { home } = await ensurePlatformSafetySystemGovernanceHome(
    prisma as any,
    now,
  );
  return (prisma as any).$transaction(async (tx: any) => {
    await incidentLock(tx, incidentId);
    await reconcilePlatformSafetyIncidentsInTransaction(tx, now);
    const incident = await loadIncident(tx, incidentId);
    const existing = await findExistingAction(tx, {
      actorPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_CLOSE_ACTION_TYPE,
      incidentId,
      idempotencyKey,
    });
    const intentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-close-intent',
      { incidentId, reasonCode, evidenceDigest },
    );
    if (existing) {
      assertExistingIntent(existing, intentDigest);
      return { replayed: true, incident: projectIncident(incident) };
    }
    if (incident.state !== 'active') {
      throw incidentError(409, 'platform_safety_incident_close_state_invalid');
    }
    const [responder, reviewer] = await Promise.all([
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE),
      resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE),
    ]);
    assertActorInRole(responder, actorPubkey);
    assertIndependentRoleSeparation(responder, reviewer);
    if (actorPubkey !== incident.commanderPubkey) {
      throw incidentError(403, 'platform_safety_incident_commander_required');
    }
    assertFrozenIncidentAuthority(incident, responder, reviewer);
    await assertIncidentPolicy(tx);
    const payload = {
      contractVersion: 'platform-safety-incident-close-current',
      intentDigest,
      incidentId,
      reasonCode,
      evidenceDigest,
      activatedAt: date(incident.activatedAt).toISOString(),
      expiresAt: date(incident.expiresAt).toISOString(),
      authority: frozenIncidentAuthority(responder, reviewer),
      policy: frozenIncidentPolicy(),
      createsNewAuthority: false,
    };
    const action = await executeIncidentAction(tx, {
      actorPubkey,
      actionType: PLATFORM_SAFETY_INCIDENT_CLOSE_ACTION_TYPE,
      incidentId,
      targetCircleId: incident.targetCircleId,
      role: responder,
      expectedRoleKey: PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE,
      payload,
      reasonCode,
      idempotencyKey,
      now,
      home,
    });
    await transitionOperationEffectInTransaction(tx, {
      effectId: incident.declarationEffectId,
      nextState: 'revoked',
      reasonCode: 'platform_safety_incident_governed_close',
      actorPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    await transitionOperationEffectInTransaction(tx, {
      effectId: action.effect.id,
      nextState: 'expired',
      reasonCode: 'platform_safety_incident_close_completed',
      actorPubkey,
      sourceReceiptId: action.receipt.id,
      occurredAt: now,
    });
    const reviewDueAt = new Date(now.getTime() + REVIEW_DUE_SECONDS * 1_000);
    await updateIncidentState(tx, incident, {
      state: 'review_required',
      data: { endedAt: now, reviewDueAt },
    });
    await createIncidentEvent(tx, incident, {
      kind: 'close',
      actorPubkey,
      fromState: 'active',
      toState: 'review_required',
      receiptId: action.receipt.id,
      effectId: action.effect.id,
      reasonCode,
      evidenceDigest,
      occurredAt: now,
    });
    return {
      replayed: false,
      incident: projectIncident(await loadIncident(tx, incidentId)),
    };
  });
}

async function executeIncidentAction(tx: any, input: IncidentActionInput) {
  const registry = createGovernedActionRegistry({
    includePlatformSafetyActions: true,
  });
  const definition = registry.get(input.actionType);
  if (!definition) {
    throw incidentError(500, 'platform_safety_incident_contract_missing');
  }
  const actorSetDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-role-actors',
    input.role.actorPubkeys,
  );
  const runtimeBinding: GovernedActionGatewayRuntimeBinding = {
    id: input.role.binding.id,
    policyId: input.role.binding.policyId,
    policyVersionId: input.role.binding.policyVersionId,
    policyVersion: input.role.binding.policyVersion,
    ruleId: input.actionType.replaceAll('.', '_'),
    committeeCircleId: input.role.binding.circleId,
    authoritySourceType: 'system_governance_role_binding',
    authoritySourceRef: input.role.binding.id,
    authoritySourceVersion:
      `${input.role.binding.policyVersionId}:${input.role.binding.roleKey}`,
    authorityPurpose: 'operational_execution',
    authoritySelector: {
      actorPubkey: input.actorPubkey,
      roleKey: input.role.binding.roleKey,
      subjectType: 'platform_safety_incident',
      subjectRef: input.incidentId,
      actorSetDigest,
      environment: 'local_development',
      network: 'solana:localnet',
    },
    authorityLimits: {
      platformSafetyPolicy: {
        versionId: PLATFORM_SAFETY_POLICY_VERSION_ID,
        digest: PLATFORM_SAFETY_POLICY_DIGEST,
        incidentPolicyVersionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
        incidentPolicyDigest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
        actorSetDigest,
        createsNewAuthority: false,
      },
      executionAuthority: {
        type: 'registered_adapter',
        ref: 'platform_safety',
      },
      riskFloor: definition.impact,
    },
  };
  const runtime = await resolveGovernedSystemRoleOperationRuntime(
    { prisma: tx, transactionClient: true },
    {
      definition,
      home: input.home,
      binding: runtimeBinding,
      actorPubkey: input.actorPubkey,
      targetType: 'platform_safety_incident',
      targetRef: input.incidentId,
      payload: input.payload,
      reasonCode: input.reasonCode,
      expectedRoleKey: input.expectedRoleKey,
      now: input.now,
    },
  );
  const gateway = new GovernedActionGateway({
    registry,
    resolveBinding: async () => null,
    listCommitteeEligibleActors: async () => [],
    requestStore: createPrismaGovernanceRequestStore(tx),
    runtimePrisma: tx,
    runtimeTransactionClient: true,
    now: () => input.now,
  });
  const outcome = await gateway.executeSystemRoleOperation({
    actionType: input.actionType,
    targetCircleId: input.targetCircleId,
    targetType: 'platform_safety_incident',
    targetRef: input.incidentId,
    actorPubkey: input.actorPubkey,
    payload: input.payload,
    reasonCode: input.reasonCode,
    idempotencyKey: input.idempotencyKey,
    runtime,
    execute: async () => ({
      result: {
        incidentId: input.incidentId,
        state: 'action_recorded',
        createsNewAuthority: false,
      },
      executionRef: `platform-safety-incident-action:${hashCanonicalGovernanceValue(
        'alcheme.governance.platform-safety-incident-execution-ref',
        {
          incidentId: input.incidentId,
          actionType: input.actionType,
          idempotencyKey: input.idempotencyKey,
        },
      ).slice(0, 63)}`,
    }),
  });
  const effect = await tx.operationEffect.findUnique({
    where: { invocationId: outcome.receipt.invocationId },
  });
  if (!effect) {
    throw incidentError(409, 'platform_safety_incident_effect_missing');
  }
  return {
    replayed: outcome.replayed,
    receipt: outcome.receipt,
    effect,
  };
}

async function assertIndependentLifecycleReviewer(
  tx: any,
  incident: any,
  reviewerPubkey: string,
) {
  const [responder, reviewer] = await Promise.all([
    resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_INCIDENT_RESPONDER_ROLE),
    resolvePlatformSafetyRole(tx, PLATFORM_SAFETY_AUDIT_REVIEWER_ROLE),
  ]);
  assertActorInRole(reviewer, reviewerPubkey);
  assertIndependentRoleSeparation(responder, reviewer);
  if (reviewerPubkey === incident.commanderPubkey) {
    throw incidentError(
      409,
      'platform_safety_incident_lifecycle_reviewer_conflict',
    );
  }
  assertFrozenIncidentAuthority(incident, responder, reviewer);
  await assertIncidentPolicy(tx);
  return { responder, reviewer };
}

async function completeLifecycleMutationEffect(
  tx: any,
  action: { receipt: any; effect: any },
  actorPubkey: string,
  reasonCode: string,
  now: Date,
) {
  await transitionOperationEffectInTransaction(tx, {
    effectId: action.effect.id,
    nextState: 'expired',
    reasonCode,
    actorPubkey,
    sourceReceiptId: action.receipt.id,
    occurredAt: now,
  });
}

async function reconcilePlatformSafetyIncidentsInTransaction(
  tx: any,
  now: Date,
) {
  const candidates = await tx.platformSafetyIncident.findMany({
    where: {
      OR: [
        { state: 'pending_approval', activationDeadline: { lte: now } },
        { state: 'active', expiresAt: { lte: now } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const reconciled: string[] = [];
  for (const candidate of candidates) {
    await incidentLock(tx, candidate.id);
    const current = await tx.platformSafetyIncident.findUnique({
      where: { id: candidate.id },
    });
    if (!current) continue;
    if (
      current.state === 'pending_approval'
      && date(current.activationDeadline).getTime() <= now.getTime()
    ) {
      await transitionOperationEffectInTransaction(tx, {
        effectId: current.declarationEffectId,
        nextState: 'expired',
        reasonCode: 'platform_safety_incident_activation_window_expired',
        actorPubkey: null,
        sourceReceiptId: null,
        occurredAt: now,
      });
      await updateIncidentState(tx, current, {
        state: 'expired',
        data: { endedAt: now },
      });
      await createIncidentEvent(tx, current, {
        kind: 'activation_expire',
        actorPubkey: null,
        fromState: 'pending_approval',
        toState: 'expired',
        receiptId: null,
        effectId: current.declarationEffectId,
        reasonCode: 'platform_safety_incident_activation_window_expired',
        evidenceDigest: current.evidenceDigest,
        occurredAt: now,
      });
      reconciled.push(current.id);
    } else if (
      current.state === 'active'
      && current.expiresAt
      && date(current.expiresAt).getTime() <= now.getTime()
    ) {
      await transitionOperationEffectInTransaction(tx, {
        effectId: current.declarationEffectId,
        nextState: 'expired',
        reasonCode: 'platform_safety_incident_max_duration_expired',
        actorPubkey: null,
        sourceReceiptId: null,
        occurredAt: now,
      });
      const reviewDueAt = new Date(
        now.getTime() + REVIEW_DUE_SECONDS * 1_000,
      );
      await updateIncidentState(tx, current, {
        state: 'review_required',
        data: { endedAt: now, reviewDueAt },
      });
      await createIncidentEvent(tx, current, {
        kind: 'expire',
        actorPubkey: null,
        fromState: 'active',
        toState: 'review_required',
        receiptId: null,
        effectId: current.declarationEffectId,
        reasonCode: 'platform_safety_incident_max_duration_expired',
        evidenceDigest: current.evidenceDigest,
        occurredAt: now,
      });
      reconciled.push(current.id);
    }
  }
  return { reconciled };
}

async function assertIncidentPolicy(tx: any) {
  const policy = await tx.governancePolicy.findUnique({
    where: { id: PLATFORM_SAFETY_INCIDENT_POLICY_ID },
  });
  const version = await tx.governancePolicyVersion.findUnique({
    where: { id: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID },
  });
  if (
    !policy
    || policy.status !== 'active'
    || policy.activeVersion !== PLATFORM_SAFETY_INCIDENT_POLICY_VERSION
    || policy.scopeType !== 'platform_safety_incident'
    || !version
    || version.status !== 'active'
    || version.policyId !== policy.id
    || version.configDigest !== PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
    || hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-incident-activation-policy',
      version.rules,
    ) !== PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST
  ) {
    throw incidentError(409, 'platform_safety_incident_policy_drift');
  }
}

function frozenIncidentAuthority(
  responder: PlatformSafetyRoleResolution,
  reviewer: PlatformSafetyRoleResolution,
  activationAppealReviewer?: PlatformSafetyRoleResolution,
) {
  return {
    commanderBindingId: responder.binding.id,
    commanderActorSetDigest: roleActorSetDigest(responder),
    reviewerBindingId: reviewer.binding.id,
    reviewerActorSetDigest: roleActorSetDigest(reviewer),
    distinctActorThreshold: 2,
    ...(activationAppealReviewer ? {
      activationAppealBindingId: activationAppealReviewer.binding.id,
      activationAppealPolicyVersionId:
        activationAppealReviewer.binding.policyVersionId,
      activationAppealActorSetDigest:
        roleActorSetDigest(activationAppealReviewer),
    } : {}),
  };
}

function frozenIncidentPolicy() {
  return {
    id: PLATFORM_SAFETY_INCIDENT_POLICY_ID,
    versionId: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION_ID,
    version: PLATFORM_SAFETY_INCIDENT_POLICY_VERSION,
    digest: PLATFORM_SAFETY_INCIDENT_POLICY_DIGEST,
  };
}

function assertFrozenIncidentAuthority(
  incident: any,
  responder: PlatformSafetyRoleResolution,
  reviewer: PlatformSafetyRoleResolution,
) {
  const declarationEvent = incident.events?.[0];
  const invocationPayload = record(
    declarationEvent?.receiptId
      ? incident.declarationPayload
      : null,
  );
  const frozen = record(invocationPayload.authority);
  if (
    frozen.commanderBindingId !== responder.binding.id
    || frozen.commanderActorSetDigest !== roleActorSetDigest(responder)
    || frozen.reviewerBindingId !== reviewer.binding.id
    || frozen.reviewerActorSetDigest !== roleActorSetDigest(reviewer)
  ) {
    throw incidentError(409, 'platform_safety_incident_authority_drift');
  }
}

async function loadIncident(tx: any, incidentId: string) {
  const incident = await tx.platformSafetyIncident.findUnique({
    where: { id: incidentId },
    include: { events: { orderBy: { sequence: 'asc' } } },
  });
  if (!incident) throw incidentError(404, 'platform_safety_incident_not_found');
  const declaration = await tx.operationReceipt.findUnique({
    where: { id: incident.declarationReceiptId },
    include: { invocation: true },
  });
  if (!declaration?.invocation) {
    throw incidentError(409, 'platform_safety_incident_declaration_missing');
  }
  const activationReceiptId = incident.events.find(
    (event: any) => event.kind === 'activate',
  )?.receiptId;
  const activationAppeal = activationReceiptId
    ? await tx.governedActionAppeal.findFirst({
        where: { originalReceiptId: activationReceiptId },
        include: { resolutionReceipt: true },
        orderBy: { openedAt: 'desc' },
      })
    : null;
  return {
    ...incident,
    declarationPayload: declaration.invocation.requestedEffect,
    activationAppeal,
  };
}

async function updateIncidentState(
  tx: any,
  incident: any,
  input: { state: string; data: Record<string, unknown> },
) {
  const updated = await tx.platformSafetyIncident.updateMany({
    where: {
      id: incident.id,
      state: incident.state,
      stateVersion: incident.stateVersion,
    },
    data: {
      ...input.data,
      state: input.state,
      stateVersion: incident.stateVersion + 1,
    },
  });
  if (updated.count !== 1) {
    throw incidentError(409, 'platform_safety_incident_state_cas_failed');
  }
}

async function createIncidentEvent(
  tx: any,
  incident: any,
  input: {
    kind: string;
    actorPubkey: string | null;
    fromState: string | null;
    toState: string;
    receiptId: string | null;
    effectId: string | null;
    reasonCode: string;
    evidenceDigest: string;
    occurredAt: Date;
  },
) {
  const sequence = input.fromState === null ? 0 : incident.stateVersion + 1;
  const facts = {
    incidentId: incident.id,
    sequence,
    ...input,
    occurredAt: input.occurredAt.toISOString(),
  };
  const eventDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-incident-event',
    facts,
  );
  return tx.platformSafetyIncidentEvent.create({
    data: {
      id: `platform-safety-incident-event:${eventDigest.slice(0, 56)}`,
      incidentId: incident.id,
      sequence,
      kind: input.kind,
      actorPubkey: input.actorPubkey,
      fromState: input.fromState,
      toState: input.toState,
      receiptId: input.receiptId,
      effectId: input.effectId,
      reasonCode: input.reasonCode,
      evidenceDigest: input.evidenceDigest,
      occurredAt: input.occurredAt,
      eventDigest,
    },
  });
}

async function findExistingAction(
  tx: any,
  input: {
    actorPubkey: string;
    actionType: string;
    incidentId: string;
    idempotencyKey: string;
  },
) {
  return tx.governedActionInvocation.findFirst({
    where: {
      actorPubkey: input.actorPubkey,
      subjectType: 'platform_safety_incident',
      subjectRef: input.incidentId,
      idempotencyKey: input.idempotencyKey,
      contractVersion: { actionType: input.actionType },
    },
    include: {
      operationReceipts: { orderBy: { completedAt: 'desc' }, take: 1 },
      operationEffect: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

function assertExistingIntent(existing: any, intentDigest: string) {
  const payload = record(existing.requestedEffect);
  if (
    payload.intentDigest !== intentDigest
    || existing.operationReceipts?.[0]?.executionStatus !== 'succeeded'
    || !existing.operationEffect
  ) {
    throw incidentError(
      409,
      'platform_safety_incident_action_idempotency_conflict',
    );
  }
}

function projectIncident(value: any) {
  return {
    id: value.id,
    policyVersionId: value.policyVersionId,
    policyDigest: value.policyDigest,
    targetCircleId: value.targetCircleId,
    category: value.category,
    severity: value.severity,
    commanderPubkey: value.commanderPubkey,
    scope: value.scope,
    allowedEmergencyActions: value.allowedEmergencyActions,
    restoreConditions: value.restoreConditions,
    maxDurationSeconds: value.maxDurationSeconds,
    state: value.state,
    evidenceDigest: value.evidenceDigest,
    declarationReceiptId: value.declarationReceiptId,
    declarationEffectId: value.declarationEffectId,
    activationDeadline: date(value.activationDeadline).toISOString(),
    activatedAt: value.activatedAt ? date(value.activatedAt).toISOString() : null,
    expiresAt: value.expiresAt ? date(value.expiresAt).toISOString() : null,
    endedAt: value.endedAt ? date(value.endedAt).toISOString() : null,
    reviewDueAt: value.reviewDueAt
      ? date(value.reviewDueAt).toISOString()
      : null,
    reviewedAt: value.reviewedAt ? date(value.reviewedAt).toISOString() : null,
    reviewOverdue:
      value.state === 'review_required'
      && value.reviewDueAt
      && date(value.reviewDueAt).getTime() < Date.now(),
    createsNewAuthority: false,
    activationAppeal: value.activationAppeal ? {
      id: value.activationAppeal.id,
      state: value.activationAppeal.state,
      appellantPubkey: value.activationAppeal.appellantPubkey,
      openedAt: date(value.activationAppeal.openedAt).toISOString(),
      resolution: value.activationAppeal.resolutionReceipt ? {
        outcome: value.activationAppeal.resolutionReceipt.outcome,
        reviewerPubkey:
          value.activationAppeal.resolutionReceipt.reviewerPubkey,
        resolvedAt: date(
          value.activationAppeal.resolutionReceipt.resolvedAt,
        ).toISOString(),
      } : null,
    } : null,
    events: Array.isArray(value.events)
      ? value.events.map((event: any) => ({
          id: event.id,
          sequence: event.sequence,
          kind: event.kind,
          actorPubkey: event.actorPubkey,
          fromState: event.fromState,
          toState: event.toState,
          receiptId: event.receiptId,
          effectId: event.effectId,
          reasonCode: event.reasonCode,
          evidenceDigest: event.evidenceDigest,
          occurredAt: date(event.occurredAt).toISOString(),
          eventDigest: event.eventDigest,
        }))
      : [],
  };
}

async function incidentLock(tx: any, value: string) {
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    `platform-safety-incident:${value}`,
  );
}

function exactActor(value: string): string {
  const canonical = canonicalSolanaPublicKeyString(value);
  if (!canonical || canonical !== value) {
    throw incidentError(400, 'platform_safety_incident_actor_invalid');
  }
  return canonical;
}

function exactIncidentId(value: string): string {
  const trimmed = value.trim();
  if (!/^platform-safety-incident:[a-f0-9]{63}$/.test(trimmed)) {
    throw incidentError(400, 'platform_safety_incident_id_invalid');
  }
  return trimmed;
}

function exactReason(value: string): string {
  const trimmed = value.trim();
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(trimmed)) {
    throw incidentError(400, 'platform_safety_incident_reason_invalid');
  }
  return trimmed;
}

function exactDigest(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    throw incidentError(400, 'platform_safety_incident_evidence_invalid');
  }
  return trimmed;
}

function exactIdempotencyKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 128) {
    throw incidentError(400, 'platform_safety_incident_idempotency_invalid');
  }
  return trimmed;
}

function roleActorSetDigest(role: PlatformSafetyRoleResolution): string {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.platform-safety-role-actors',
    role.actorPubkeys,
  );
}

function incidentError(statusCode: number, code: string): PlatformSafetyError {
  return new PlatformSafetyError(statusCode, code);
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function incidentCategories(incident: any): string[] {
  const scopeCategories = stringArray(record(incident.scope).categories);
  return scopeCategories.length > 0
    ? scopeCategories
    : [String(incident.category)];
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw incidentError(409, 'platform_safety_incident_time_invalid');
  }
  return parsed;
}
