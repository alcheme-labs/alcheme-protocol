import { createHash } from 'node:crypto';

import { createExternalAppCircleBinding } from './circleBindings';
import { externalAppRegistryModeFromEnv } from './chainRegistryProjection';
import {
  lockAssertClockExternalProgramRuntimeApp,
  ExternalProgramRuntimeAuthorizationError,
} from './runtimeAuthorizationGate';
import {
  createGovernanceCaseIntake,
  GovernanceCaseIntakeError,
} from '../governance/governanceCase';
import { EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE } from '../governance/governanceCaseActionComposition';
import { isExternalActionIntakeEnabled } from '../governance/externalGovernedActionFlags';
import {
  createExternalGovernedActionIntake,
  ExternalGovernedActionIntakeError,
} from '../governance/externalGovernedActionIntake';
import {
  assertExternalGovernedActionRecurrenceAvailable,
  buildExternalGovernedActionIntentDigest,
  buildExternalGovernedActionRecurrenceKey,
  ExternalGovernedActionRecurrenceError,
  resolveExternalGovernedActionRecurrenceEpoch,
} from '../governance/externalGovernedActionRecurrence';
import { solanaPublicKeysEqual } from '../identity/solanaPublicKey';

const APPLICATION_SOURCE = 'app_owner_primary_bind_request';
const PRIMARY_BIND_ACTION = EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE;
const PRIMARY_CHANGE_ACTION = 'external_app_primary_circle_change';
type PrimaryCircleBindingOwnerAction =
  | typeof PRIMARY_BIND_ACTION
  | typeof PRIMARY_CHANGE_ACTION;

export async function requestPrimaryCircleBindApplication(
  prisma: any,
  input: {
    externalAppId: string;
    circleId: number;
    rationale: string;
    requestedByPubkey: string;
    environment?: string;
    now?: Date;
  },
): Promise<{ binding: any; replayed: boolean }> {
  if (!isExternalActionIntakeEnabled()) {
    throw new GovernanceCaseIntakeError(404, 'external_action_intake_disabled');
  }
  const externalAppId = String(input.externalAppId || '').trim();
  if (!externalAppId) {
    throw new GovernanceCaseIntakeError(400, 'external_app_id_required');
  }
  const rationale = String(input.rationale || '').trim();
  if (rationale.length < 10 || rationale.length > 2000) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_requested_decision_required');
  }
  const candidateRef = `${externalAppId}:${input.circleId}:primary`;
  const rationaleDigest = createHash('sha256').update(rationale, 'utf8').digest('hex');

  if (typeof prisma.$transaction !== 'function') {
    throw new GovernanceCaseIntakeError(500, 'primary_circle_bind_application_transaction_required');
  }

  try {
    return await prisma.$transaction(async (tx: any) => {
      const { app, authorityNow } = await lockAssertClockExternalProgramRuntimeApp(tx, {
        externalAppId,
        now: input.now,
        registryMode: externalAppRegistryModeFromEnv(),
        expectedOwnerPubkey: input.requestedByPubkey,
      });
      const active = await tx.externalAppCircleBinding.findFirst({
        where: {
          externalAppId,
          bindingKind: 'primary',
          status: 'active',
        },
      });
      if (active && active.circleId === input.circleId) {
        throw new GovernanceCaseIntakeError(409, 'external_app_active_primary_circle_binding_exists');
      }
      const applicationActionType: PrimaryCircleBindingOwnerAction = active
        ? PRIMARY_CHANGE_ACTION
        : PRIMARY_BIND_ACTION;
      const existing = await tx.externalAppCircleBinding.findFirst({
        where: {
          externalAppId,
          circleId: input.circleId,
          bindingKind: 'primary',
          status: 'pending',
          source: APPLICATION_SOURCE,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!existing) {
        const canonicalEnvironment = String(app.environment || 'local_development');
        const application = {
          kind: 'primary_circle_bind_application_v1',
          actionType: applicationActionType,
          applicationEpoch: 1,
          requestedByPubkey: app.ownerPubkey,
          requestedAt: authorityNow.toISOString(),
          rationaleDigest,
          candidateRef,
          environment: canonicalEnvironment,
          frozen: false,
        };
        const binding = await createExternalAppCircleBinding(tx, {
          externalAppId,
          circleId: input.circleId,
          bindingKind: 'primary',
          environment: canonicalEnvironment,
          status: 'pending',
          createdByPubkey: String(app.ownerPubkey || input.requestedByPubkey),
          source: APPLICATION_SOURCE,
          metadata: {
            requiresGovernance: true,
            candidateRef,
            application,
          },
        });
        return { binding, replayed: false };
      }

      const metadata = asRecord(existing.metadata) ?? {};
      const application = asRecord(metadata.application);
      const linkedCaseId = typeof metadata.governanceCaseId === 'string'
        ? metadata.governanceCaseId
        : null;
      if (linkedCaseId) {
        const linkedCase = await tx.governanceCase.findUnique({
          where: { id: linkedCaseId },
          select: { id: true, casePhase: true, decisionOutcome: true },
        });
        if (!linkedCase) {
          // Fail closed: missing Case must go through audited repair, not silent re-link.
          throw new GovernanceCaseIntakeError(
            409,
            `primary_circle_bind_dangling_case_requires_repair:${linkedCaseId}`,
          );
        }
        const terminal = ['closed', 'cancelled', 'archived'].includes(String(linkedCase.casePhase || ''))
          || ['rejected', 'expired', 'cancelled'].includes(String(linkedCase.decisionOutcome || ''));
        if (!terminal) {
          if (application?.actionType !== applicationActionType) {
            throw new GovernanceCaseIntakeError(
              409,
              'primary_circle_bind_application_action_state_mismatch',
            );
          }
          return { binding: existing, replayed: true };
        }
      } else if (application?.frozen === true) {
        return { binding: existing, replayed: true };
      }

      const applicationEpoch = linkedCaseId
        ? await resolveExternalGovernedActionRecurrenceEpoch(tx, {
          circleId: input.circleId,
          actionType: applicationActionType,
          subjectType: 'external_app_circle_binding',
          subjectRef: existing.id,
        })
        : Number(application?.applicationEpoch || 1);
      const canonicalEnvironment = String(app.environment || 'local_development');
      const nextApplication = {
        kind: 'primary_circle_bind_application_v1',
        actionType: applicationActionType,
        applicationEpoch,
        requestedByPubkey: app.ownerPubkey,
        requestedAt: authorityNow.toISOString(),
        rationaleDigest,
        candidateRef,
        environment: canonicalEnvironment,
        frozen: false,
      };
      const expectedRequestedAt = typeof application?.requestedAt === 'string'
        ? application.requestedAt
        : '';
      // Terminal linked Case may leave application.frozen=true; allow new-epoch rewrite for that Case id.
      const nextMetadata: Record<string, unknown> = {
        ...metadata,
        requiresGovernance: true,
        candidateRef,
        application: nextApplication,
        governanceCaseId: null,
      };
      const updatedRows = await tx.$executeRawUnsafe?.(
        `UPDATE external_app_circle_bindings
         SET metadata = $1::jsonb,
             created_by_pubkey = $2,
             environment = $6,
             updated_at = NOW()
         WHERE id = $3
           AND status = 'pending'
           AND (
             metadata->>'governanceCaseId' IS NULL
             OR metadata->>'governanceCaseId' = $4
           )
           AND (
             COALESCE(metadata->'application'->>'frozen', 'false') <> 'true'
             OR (
               $4 <> ''
               AND metadata->>'governanceCaseId' = $4
             )
           )
           AND COALESCE(metadata->'application'->>'requestedAt', '') = $5`,
        JSON.stringify(nextMetadata),
        String(app.ownerPubkey || input.requestedByPubkey),
        existing.id,
        linkedCaseId ?? '',
        expectedRequestedAt,
        canonicalEnvironment,
      );
      if (typeof updatedRows === 'number' && updatedRows !== 1) {
        const latest = await tx.externalAppCircleBinding.findUnique({ where: { id: existing.id } });
        return { binding: latest ?? existing, replayed: true };
      }
      if (typeof updatedRows !== 'number') {
        // Refuse check-then-act rewrite without SQL rowcount CAS (would clobber concurrent activate).
        if (typeof tx.$executeRawUnsafe !== 'function') {
          throw new GovernanceCaseIntakeError(503, 'primary_circle_bind_rewrite_cas_unavailable');
        }
        const latest = await tx.externalAppCircleBinding.findUnique({ where: { id: existing.id } });
        return { binding: latest ?? existing, replayed: true };
      }
      const updated = await tx.externalAppCircleBinding.findUnique({ where: { id: existing.id } });
      return { binding: updated ?? existing, replayed: true };
    });
  } catch (error) {
    throw mapRuntimeAuthError(error);
  }
}

export async function listPendingPrimaryCircleBindApplications(
  prisma: any,
  input: { circleId: number },
): Promise<Array<{
  applicationRef: string;
  externalAppId: string;
  displayName: string;
  circleId: number;
  applicationEpoch: number;
  requestedAt: string | null;
  rationaleDigest: string;
  environment: string | null;
}>> {
  const rows = await prisma.externalAppCircleBinding.findMany({
    where: {
      circleId: input.circleId,
      bindingKind: 'primary',
      status: 'pending',
      source: APPLICATION_SOURCE,
    },
    include: { externalApp: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.flatMap((binding: any) => {
    const application = asRecord(asRecord(binding.metadata)?.application);
    const rationaleDigest = typeof application?.rationaleDigest === 'string'
      ? application.rationaleDigest.trim().toLowerCase()
      : '';
    if (
      !application
      || application.kind !== 'primary_circle_bind_application_v1'
      || application.actionType !== PRIMARY_BIND_ACTION
    ) return [];
    if (!/^[a-f0-9]{64}$/.test(rationaleDigest)) return [];
    if (asRecord(binding.metadata)?.governanceCaseId) return [];
    return [{
      applicationRef: String(binding.id),
      externalAppId: String(binding.externalAppId),
      displayName: typeof binding.externalApp?.name === 'string'
        && binding.externalApp.name.trim()
        ? binding.externalApp.name.trim()
        : String(binding.externalAppId),
      circleId: Number(binding.circleId),
      applicationEpoch: Number(application.applicationEpoch || 1),
      requestedAt: typeof application.requestedAt === 'string' ? application.requestedAt : null,
      rationaleDigest,
      environment: typeof application.environment === 'string' ? application.environment : null,
    }];
  });
}

export async function openPrimaryCircleBindGovernanceCase(
  prisma: any,
  input: {
    externalAppId: string;
    circleId: number;
    title: string;
    /** Manager selects Owner application; free-form rationale is rejected. */
    applicationRef?: string | null;
    /** Digest Manager reviewed; must match live Owner application. */
    ownerRationaleDigest?: string | null;
    /** @deprecated */
    rationale?: string;
    confirmOwnerApplication?: boolean;
    idempotencyKey?: string | null;
    openedByPubkey: string;
    actorRole: string;
    templateId?: string;
    environment?: string;
    now?: Date;
  },
): Promise<{ governanceCase: any; binding: any; replayed: boolean }> {
  if (!isExternalActionIntakeEnabled()) {
    throw new GovernanceCaseIntakeError(404, 'external_action_intake_disabled');
  }
  const externalAppId = String(input.externalAppId || '').trim();
  if (!externalAppId) {
    throw new GovernanceCaseIntakeError(400, 'external_app_id_required');
  }
  if (input.confirmOwnerApplication !== true) {
    throw new GovernanceCaseIntakeError(400, 'primary_circle_bind_owner_application_confirm_required');
  }
  const applicationRef = String(input.applicationRef || '').trim();
  if (!applicationRef) {
    throw new GovernanceCaseIntakeError(400, 'primary_circle_bind_application_ref_required');
  }
  // Manager may not author a replacement rationale.
  if (String(input.rationale || '').trim()) {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_manager_rationale_forbidden');
  }
  const binding = await prisma.externalAppCircleBinding.findUnique({
    where: { id: applicationRef },
  });
  if (
    !binding
    || String(binding.externalAppId) !== externalAppId
    || Number(binding.circleId) !== input.circleId
    || String(binding.bindingKind) !== 'primary'
    || String(binding.status) !== 'pending'
    || String(binding.source) !== APPLICATION_SOURCE
  ) {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_required');
  }
  const application = asRecord(asRecord(binding.metadata)?.application);
  if (!application || application.kind !== 'primary_circle_bind_application_v1') {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_required');
  }
  if (application.actionType !== PRIMARY_BIND_ACTION) {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_action_mismatch');
  }
  const ownerRationaleDigest = typeof application.rationaleDigest === 'string'
    ? application.rationaleDigest.trim().toLowerCase()
    : '';
  if (!/^[a-f0-9]{64}$/.test(ownerRationaleDigest)) {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_required');
  }
  const confirmedDigest = String(input.ownerRationaleDigest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(confirmedDigest)) {
    throw new GovernanceCaseIntakeError(400, 'primary_circle_bind_owner_rationale_digest_required');
  }
  if (confirmedDigest !== ownerRationaleDigest) {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_owner_rationale_digest_mismatch');
  }

  const candidateRef = `${externalAppId}:${input.circleId}:primary`;
  const expectedSnapshotVersion = `primary-circle-bind:v1:${candidateRef}`;
  const expectedSnapshotDigest = createHash('sha256')
    .update(candidateRef, 'utf8')
    .digest('hex');
  // Confirmation text references Owner digest only — never a second application reason.
  const confirmationDecision =
    `Confirm owner primary-circle-bind application ${ownerRationaleDigest}`;

  const intake = createExternalGovernedActionIntake();
  let prepared;
  try {
    prepared = await intake.prepareIntent({
      confirmingActorSession: {
        actorPubkey: input.openedByPubkey,
        actorRole: input.actorRole,
      },
      verifiedProducerContext: {
        kind: 'native_user',
        actorPubkey: input.openedByPubkey,
        actorRole: input.actorRole,
      },
      externalAppId,
      circleId: input.circleId,
      actionType: EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
      candidateRef,
      expectedSnapshotVersion,
      expectedSnapshotDigest,
      rationale: confirmationDecision,
    });
  } catch (error) {
    if (error instanceof ExternalGovernedActionIntakeError) {
      throw new GovernanceCaseIntakeError(error.statusCode, error.code);
    }
    throw error;
  }

  const intentDigest = buildExternalGovernedActionIntentDigest({
    expectedSnapshotVersion,
    expectedSnapshotDigest,
    requestedActionPayload: prepared.operationPayload,
    statePrecondition: prepared.statePrecondition,
    rationaleDigest: ownerRationaleDigest,
  });
  const recurrenceEpoch = await resolveExternalGovernedActionRecurrenceEpoch(prisma, {
    circleId: input.circleId,
    actionType: EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
    subjectType: 'external_app_circle_binding',
    subjectRef: binding.id,
  });
  if (Number(application.applicationEpoch || 0) !== recurrenceEpoch) {
    throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_epoch_mismatch');
  }
  let recurrenceKey: string;
  try {
    recurrenceKey = buildExternalGovernedActionRecurrenceKey({
      circleId: input.circleId,
      actionType: EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
      candidateRef,
      recurrenceEpoch,
    });
    await assertExternalGovernedActionRecurrenceAvailable(prisma, {
      circleId: input.circleId,
      actionType: EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
      subjectType: 'external_app_circle_binding',
      subjectRef: binding.id,
      recurrenceKey,
      intentDigest,
      recurrenceEpoch,
    });
  } catch (error) {
    if (error instanceof ExternalGovernedActionRecurrenceError) {
      throw new GovernanceCaseIntakeError(
        error.statusCode,
        error.existingCaseId
          ? `${error.code}:${error.existingCaseId}`
          : error.code,
      );
    }
    throw error;
  }

  const opened = await intake.confirmAndOpenCase({
    confirmingActorSession: {
      actorPubkey: input.openedByPubkey,
      actorRole: input.actorRole,
    },
    verifiedProducerContext: {
      kind: 'native_user',
      actorPubkey: input.openedByPubkey,
      actorRole: input.actorRole,
    },
    preparation: prepared,
    confirmedPreviewDigest: prepared.preparationDigest,
    idempotencyKey: recurrenceKey,
    openCase: async (facts) => {
      const frozenApplication = {
        ...application,
        frozen: true,
        applicationEpoch: recurrenceEpoch,
      };
      const expectedApplicationEpoch = String(application.applicationEpoch ?? '');
      const expectedRequestedAt = typeof application.requestedAt === 'string'
        ? application.requestedAt
        : '';
      const expectedRationaleDigest = typeof application.rationaleDigest === 'string'
        ? application.rationaleDigest.trim().toLowerCase()
        : '';
      const expectedRequestedByPubkey = typeof application.requestedByPubkey === 'string'
        ? application.requestedByPubkey
        : '';
      const result = await createGovernanceCaseIntake(prisma, {
        circleId: input.circleId,
        title: input.title,
        requestedDecision: facts.requestedDecision,
        caseType: 'policy',
        templateId: input.templateId || 'basic-community',
        actionType: facts.actionType,
        subjectType: 'external_app_circle_binding',
        subjectRef: binding.id,
        requestedActionPayload: {
          operationPayload: facts.requestedActionPayload,
          statePrecondition: facts.statePrecondition,
          bindingId: binding.id,
          candidateProvenance: {
            ...facts.candidateProvenance,
            applicationRequestedByPubkey: expectedRequestedByPubkey,
            applicationRequestedAt: expectedRequestedAt,
            applicationRationaleDigest: expectedRationaleDigest,
            applicationEpoch: frozenApplication.applicationEpoch,
            candidateRef,
            recurrenceEpoch,
            intentDigest,
            connectorTrustProfile: facts.candidateProvenance.connectorTrustProfile
              || 'external-app-primary-circle-bind-v1',
          },
        },
        statePrecondition: facts.statePrecondition,
        originKind: 'manual_item',
        idempotencyKey: facts.idempotencyKey,
        openedByPubkey: input.openedByPubkey,
        actorRole: input.actorRole,
        openedAt: input.now ?? new Date(),
        recurrenceReservation: {
          actionType: EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
          subjectType: 'external_app_circle_binding',
          subjectRef: binding.id,
          recurrenceEpoch,
          intentDigest,
        },
        afterPersist: async (tx, governanceCase) => {
          const { app: appInTxn } = await lockAssertClockExternalProgramRuntimeApp(tx, {
            externalAppId,
            now: input.now,
            registryMode: externalAppRegistryModeFromEnv(),
            expectedOwnerPubkey: expectedRequestedByPubkey,
          });
          if (!solanaPublicKeysEqual(appInTxn.ownerPubkey, expectedRequestedByPubkey)) {
            throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_owner_mismatch');
          }
          const current = await tx.externalAppCircleBinding.findUnique({
            where: { id: binding.id },
          });
          if (!current || String(current.status) !== 'pending') {
            throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_required');
          }
          const competingPrimary = await tx.externalAppCircleBinding.findFirst({
            where: {
              externalAppId,
              bindingKind: 'primary',
              status: 'active',
              id: { not: binding.id },
            },
            select: { id: true },
          });
          if (competingPrimary) {
            throw new GovernanceCaseIntakeError(
              409,
              'primary_circle_bind_application_action_state_mismatch',
            );
          }
          const currentMeta = asRecord(current.metadata) ?? {};
          if (
            typeof currentMeta.governanceCaseId === 'string'
            && currentMeta.governanceCaseId
            && currentMeta.governanceCaseId !== governanceCase.id
          ) {
            throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_conflict');
          }
          const cas = await tx.$executeRawUnsafe?.(
            `UPDATE external_app_circle_bindings
             SET metadata = $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2
               AND status = 'pending'
               AND (
                 metadata->>'governanceCaseId' IS NULL
                 OR metadata->>'governanceCaseId' = $3
               )
               AND COALESCE(metadata->'application'->>'applicationEpoch', '') = $4
               AND COALESCE(metadata->'application'->>'requestedAt', '') = $5
               AND COALESCE(metadata->'application'->>'rationaleDigest', '') = $6
               AND COALESCE(metadata->'application'->>'requestedByPubkey', '') = $7
               AND COALESCE(metadata->'application'->>'actionType', '') = $8
               AND COALESCE(metadata->'application'->>'frozen', 'false') <> 'true'`,
            JSON.stringify({
              ...currentMeta,
              requiresGovernance: true,
              candidateRef,
              application: {
                ...frozenApplication,
                requestedByPubkey: appInTxn.ownerPubkey,
              },
              governanceCaseId: governanceCase.id,
            }),
            binding.id,
            governanceCase.id,
            expectedApplicationEpoch,
            expectedRequestedAt,
            expectedRationaleDigest,
            expectedRequestedByPubkey,
            PRIMARY_BIND_ACTION,
          );
          if (typeof cas === 'number' && cas !== 1) {
            throw new GovernanceCaseIntakeError(409, 'primary_circle_bind_application_conflict');
          }
          if (typeof cas !== 'number') {
            throw new GovernanceCaseIntakeError(503, 'primary_circle_bind_rewrite_cas_unavailable');
          }
        },
      });
      return {
        caseId: result.governanceCase.id,
        replayed: result.replayed,
        governanceCase: result.governanceCase,
      };
    },
  }).catch((error) => {
    if (error instanceof ExternalGovernedActionIntakeError) {
      throw new GovernanceCaseIntakeError(error.statusCode, error.code);
    }
    if (error instanceof ExternalProgramRuntimeAuthorizationError) {
      throw new GovernanceCaseIntakeError(error.statusCode, error.code);
    }
    throw error;
  });

  const linked = await prisma.externalAppCircleBinding.findUnique({
    where: { id: binding.id },
  });
  return {
    governanceCase: (opened as any).governanceCase
      ?? { id: opened.caseId },
    binding: linked ?? binding,
    replayed: opened.replayed,
  };
}

function mapRuntimeAuthError(error: unknown): never {
  if (error instanceof ExternalProgramRuntimeAuthorizationError) {
    throw new GovernanceCaseIntakeError(error.statusCode, error.code);
  }
  if (error instanceof GovernanceCaseIntakeError) throw error;
  throw error;
}

function asRecord(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, any>;
}
