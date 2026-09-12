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
import {
  assertExternalGovernedActionRecurrenceAvailable,
  buildExternalGovernedActionIntentDigest,
  buildExternalGovernedActionRecurrenceKey,
  ExternalGovernedActionRecurrenceError,
  resolveExternalGovernedActionRecurrenceEpoch,
} from '../governance/externalGovernedActionRecurrence';
import { hashCanonicalGovernanceValue } from '../governance/canonicalCodec';
import { solanaPublicKeysEqual } from '../identity/solanaPublicKey';

export const EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION =
  'external_app_primary_circle_change';
export const EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION =
  'external_app_attached_circle_bind';
export const EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION =
  'external_app_attached_circle_revoke';

export const CIRCLE_BINDING_OWNER_APPLICATION_SOURCE =
  'app_owner_circle_binding_request';
export const CIRCLE_BINDING_OWNER_APPLICATION_KIND =
  'circle_binding_owner_application_v1';

const PRIMARY_BIND_APPLICATION_SOURCE = 'app_owner_primary_bind_request';
const PRIMARY_BIND_APPLICATION_KIND = 'primary_circle_bind_application_v1';

export type ExternalAppCircleBindingOwnerAction =
  | typeof EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
  | typeof EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
  | typeof EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION;

type AttachedOwnerAction = Exclude<
  ExternalAppCircleBindingOwnerAction,
  typeof EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
>;

type OwnerApplication = {
  kind: typeof CIRCLE_BINDING_OWNER_APPLICATION_KIND;
  actionType: AttachedOwnerAction;
  applicationEpoch: number;
  requestedByPubkey: string;
  requestedAt: string;
  rationaleDigest: string;
  candidateRef: string;
  snapshotVersion: string;
  snapshotDigest: string;
  environment: string;
  frozen: boolean;
};

export async function requestExternalAppCircleBindingOwnerApplication(
  prisma: any,
  input: {
    externalAppId: string;
    circleId: number;
    actionType: AttachedOwnerAction;
    bindingId?: string | null;
    rationale: string;
    requestedByPubkey: string;
    now?: Date;
  },
): Promise<{ binding: any; replayed: boolean }> {
  const externalAppId = requiredText(input.externalAppId, 'external_app_id_required');
  const rationale = requiredRationale(input.rationale);
  const requestedByPubkey = requiredText(
    input.requestedByPubkey,
    'governance_case_actor_required',
  );
  assertCircleId(input.circleId);
  if (![
    EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION,
    EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION,
  ].includes(input.actionType)) {
    throw new GovernanceCaseIntakeError(
      400,
      'external_app_circle_binding_owner_application_action_invalid',
    );
  }
  if (typeof prisma.$transaction !== 'function') {
    throw new GovernanceCaseIntakeError(
      503,
      'external_app_circle_binding_owner_application_transaction_required',
    );
  }

  try {
    return await prisma.$transaction(async (tx: any) => {
      const { app, authorityNow } = await lockAssertClockExternalProgramRuntimeApp(tx, {
        externalAppId,
        now: input.now,
        registryMode: externalAppRegistryModeFromEnv(),
        expectedOwnerPubkey: requestedByPubkey,
      });
      if (!solanaPublicKeysEqual(app.ownerPubkey, requestedByPubkey)) {
        throw new GovernanceCaseIntakeError(
          403,
          'external_app_circle_binding_owner_required',
        );
      }

      let binding = input.bindingId
        ? await tx.externalAppCircleBinding.findUnique({
          where: { id: String(input.bindingId).trim() },
        })
        : await tx.externalAppCircleBinding.findFirst({
          where: {
            externalAppId,
            circleId: input.circleId,
            bindingKind: 'attached',
          },
          orderBy: { createdAt: 'desc' },
        });

      if (input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION) {
        if (
          !binding
          || String(binding.externalAppId) !== externalAppId
          || Number(binding.circleId) !== input.circleId
          || String(binding.bindingKind) !== 'attached'
          || String(binding.status) !== 'active'
        ) {
          throw new GovernanceCaseIntakeError(
            409,
            'external_app_attached_circle_active_binding_required',
          );
        }
      } else if (binding && String(binding.status) === 'active') {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_attached_circle_binding_already_active',
        );
      }

      if (binding && typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe(
          'SELECT id FROM external_app_circle_bindings WHERE id = $1 FOR UPDATE',
          binding.id,
        );
        binding = await tx.externalAppCircleBinding.findUnique({
          where: { id: binding.id },
        });
      }

      const existingMeta = asRecord(binding?.metadata) ?? {};
      const existingApplication = asRecord(existingMeta.application);
      const linkedCaseId = optionalText(existingMeta.governanceCaseId);
      if (linkedCaseId) {
        const linkedCase = await tx.governanceCase.findUnique({
          where: { id: linkedCaseId },
          select: { id: true, casePhase: true, decisionOutcome: true },
        });
        if (!linkedCase) {
          throw new GovernanceCaseIntakeError(
            409,
            `external_app_circle_binding_dangling_case_requires_repair:${linkedCaseId}`,
          );
        }
        if (!isTerminalCase(linkedCase)) {
          if (
            existingApplication?.kind === CIRCLE_BINDING_OWNER_APPLICATION_KIND
            && existingApplication.actionType === input.actionType
          ) {
            return { binding, replayed: true };
          }
          throw new GovernanceCaseIntakeError(
            409,
            `external_app_circle_binding_application_conflict:${linkedCaseId}`,
          );
        }
      } else if (existingApplication?.frozen === true) {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_circle_binding_frozen_application_requires_repair',
        );
      } else if (
        binding
        && existingApplication
        && isExactUnfrozenAttachedOwnerApplicationReplay({
          binding,
          application: existingApplication,
          actionType: input.actionType,
          ownerPubkey: String(app.ownerPubkey),
          environment: String(app.environment),
          rationaleDigest: sha256(rationale),
        })
      ) {
        return { binding, replayed: true };
      }

      if (!binding) {
        if (input.actionType !== EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION) {
          throw new GovernanceCaseIntakeError(
            409,
            'external_app_attached_circle_active_binding_required',
          );
        }
        const provisionalCandidate = `${externalAppId}:${input.circleId}:attached`;
        const provisional: OwnerApplication = {
          kind: CIRCLE_BINDING_OWNER_APPLICATION_KIND,
          actionType: input.actionType,
          applicationEpoch: 1,
          requestedByPubkey: String(app.ownerPubkey),
          requestedAt: authorityNow.toISOString(),
          rationaleDigest: sha256(rationale),
          candidateRef: provisionalCandidate,
          snapshotVersion: '',
          snapshotDigest: '',
          environment: String(app.environment),
          frozen: false,
        };
        binding = await createExternalAppCircleBinding(tx, {
          externalAppId,
          circleId: input.circleId,
          bindingKind: 'attached',
          environment: String(app.environment),
          status: 'pending',
          createdByPubkey: String(app.ownerPubkey),
          source: CIRCLE_BINDING_OWNER_APPLICATION_SOURCE,
          metadata: {
            requiresGovernance: true,
            application: provisional,
          },
        });
      }

      if (
        !binding
        || String(binding.externalAppId) !== externalAppId
        || Number(binding.circleId) !== input.circleId
        || String(binding.bindingKind) !== 'attached'
      ) {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_attached_circle_binding_mismatch',
        );
      }

      const applicationEpoch = await resolveExternalGovernedActionRecurrenceEpoch(tx, {
        circleId: input.circleId,
        actionType: input.actionType,
        subjectType: 'external_app_circle_binding',
        subjectRef: binding.id,
      });
      const facts = buildExternalAppCircleBindingOwnerApplicationSnapshot({
        actionType: input.actionType,
        binding,
      });
      const application: OwnerApplication = {
        kind: CIRCLE_BINDING_OWNER_APPLICATION_KIND,
        actionType: input.actionType,
        applicationEpoch,
        requestedByPubkey: String(app.ownerPubkey),
        requestedAt: authorityNow.toISOString(),
        rationaleDigest: sha256(rationale),
        candidateRef: facts.candidateRef,
        snapshotVersion: facts.snapshotVersion,
        snapshotDigest: facts.snapshotDigest,
        environment: String(app.environment),
        frozen: false,
      };
      const metadata = {
        ...(asRecord(binding.metadata) ?? {}),
        requiresGovernance: true,
        application,
        governanceCaseId: null,
      };
      const expectedStatus = input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
        ? String(binding.status) === 'revoked' ? 'revoked' : 'pending'
        : 'active';
      const update = await tx.externalAppCircleBinding.updateMany({
        where: {
          id: binding.id,
          externalAppId,
          circleId: input.circleId,
          bindingKind: 'attached',
          status: expectedStatus,
        },
        data: {
          ...(input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
            ? {
              status: 'pending',
              source: CIRCLE_BINDING_OWNER_APPLICATION_SOURCE,
              governanceRequestId: null,
              governanceDecisionDigest: null,
              executionReceiptId: null,
              effectiveAt: null,
              revokedAt: null,
            }
            : {}),
          createdByPubkey: String(app.ownerPubkey),
          metadata,
        },
      });
      if (Number(update?.count) !== 1) {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_circle_binding_application_conflict',
        );
      }
      const saved = await tx.externalAppCircleBinding.findUnique({
        where: { id: binding.id },
      });
      return { binding: saved ?? { ...binding, metadata }, replayed: false };
    });
  } catch (error) {
    throw mapApplicationError(error);
  }
}

function isExactUnfrozenAttachedOwnerApplicationReplay(input: {
  binding: any;
  application: Record<string, any>;
  actionType: AttachedOwnerAction;
  ownerPubkey: string;
  environment: string;
  rationaleDigest: string;
}): boolean {
  if (
    input.application.kind !== CIRCLE_BINDING_OWNER_APPLICATION_KIND
    || input.application.actionType !== input.actionType
    || input.application.frozen !== false
    || !solanaPublicKeysEqual(input.application.requestedByPubkey, input.ownerPubkey)
    || String(input.application.environment || '') !== input.environment
    || String(input.application.rationaleDigest || '') !== input.rationaleDigest
    || !Number.isSafeInteger(Number(input.application.applicationEpoch))
    || Number(input.application.applicationEpoch) < 1
    || Number.isNaN(Date.parse(String(input.application.requestedAt || '')))
  ) {
    return false;
  }
  const snapshot = buildExternalAppCircleBindingOwnerApplicationSnapshot({
    actionType: input.actionType,
    binding: input.binding,
  });
  return input.application.candidateRef === snapshot.candidateRef
    && input.application.snapshotVersion === snapshot.snapshotVersion
    && input.application.snapshotDigest === snapshot.snapshotDigest;
}

export async function listPendingExternalAppCircleBindingOwnerApplications(
  prisma: any,
  input: { circleId: number },
): Promise<Array<{
  applicationRef: string;
  actionType: ExternalAppCircleBindingOwnerAction;
  externalAppId: string;
  displayName: string;
  circleId: number;
  bindingKind: 'primary' | 'attached';
  applicationEpoch: number;
  requestedAt: string | null;
  rationaleDigest: string;
  environment: string | null;
}>> {
  assertCircleId(input.circleId);
  const rows = await prisma.externalAppCircleBinding.findMany({
    where: {
      circleId: input.circleId,
      status: { in: ['pending', 'active'] },
    },
    include: {
      externalApp: {
        select: {
          name: true,
          circleBindings: {
            where: { bindingKind: 'primary', status: 'active' },
            select: { id: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.flatMap((binding: any) => {
    const metadata = asRecord(binding.metadata);
    if (optionalText(metadata?.governanceCaseId)) return [];
    const application = asRecord(metadata?.application);
    if (!application || application.frozen === true) return [];
    let actionType: ExternalAppCircleBindingOwnerAction;
    if (
      String(binding.bindingKind) === 'primary'
      && String(binding.source) === PRIMARY_BIND_APPLICATION_SOURCE
      && application.kind === PRIMARY_BIND_APPLICATION_KIND
      && application.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
      && Array.isArray(binding.externalApp?.circleBindings)
      && binding.externalApp.circleBindings.some(
        (item: any) => String(item?.id || '') !== String(binding.id),
      )
    ) {
      actionType = EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION;
    } else if (
      String(binding.bindingKind) === 'attached'
      && application.kind === CIRCLE_BINDING_OWNER_APPLICATION_KIND
      && [
        EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION,
        EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION,
      ].includes(String(application.actionType) as AttachedOwnerAction)
    ) {
      actionType = String(application.actionType) as AttachedOwnerAction;
    } else {
      return [];
    }
    const rationaleDigest = String(application.rationaleDigest || '').trim();
    if (!/^[a-f0-9]{64}$/.test(rationaleDigest)) return [];
    return [{
      applicationRef: String(binding.id),
      actionType,
      externalAppId: String(binding.externalAppId),
      displayName: optionalText(binding.externalApp?.name) ?? String(binding.externalAppId),
      circleId: Number(binding.circleId),
      bindingKind: String(binding.bindingKind) as 'primary' | 'attached',
      applicationEpoch: Number(application.applicationEpoch),
      requestedAt: optionalText(application.requestedAt),
      rationaleDigest,
      environment: optionalText(application.environment),
    }];
  });
}

export async function openExternalAppCircleBindingOwnerApplicationCase(
  prisma: any,
  input: {
    externalAppId: string;
    circleId: number;
    actionType: ExternalAppCircleBindingOwnerAction;
    applicationRef: string;
    ownerRationaleDigest: string;
    confirmOwnerApplication: boolean;
    title: string;
    openedByPubkey: string;
    actorRole: string;
    templateId?: string;
    now?: Date;
  },
): Promise<{ governanceCase: any; binding: any; replayed: boolean }> {
  const externalAppId = requiredText(input.externalAppId, 'external_app_id_required');
  const applicationRef = requiredText(
    input.applicationRef,
    'external_app_circle_binding_application_ref_required',
  );
  assertCircleId(input.circleId);
  if (input.confirmOwnerApplication !== true) {
    throw new GovernanceCaseIntakeError(
      400,
      'external_app_circle_binding_owner_application_confirm_required',
    );
  }
  const binding = await prisma.externalAppCircleBinding.findUnique({
    where: { id: applicationRef },
  });
  if (
    !binding
    || String(binding.externalAppId) !== externalAppId
    || Number(binding.circleId) !== input.circleId
  ) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_circle_binding_owner_application_required',
    );
  }
  const metadata = asRecord(binding.metadata) ?? {};
  const application = asRecord(metadata.application);
  assertSelectedApplication({ binding, application, actionType: input.actionType });
  if (
    input.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
    && !await hasDifferentActivePrimaryBinding(prisma, binding)
  ) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_primary_circle_change_active_primary_required',
    );
  }
  const rationaleDigest = String(application?.rationaleDigest || '').trim();
  const confirmedDigest = String(input.ownerRationaleDigest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(confirmedDigest)) {
    throw new GovernanceCaseIntakeError(
      400,
      'external_app_circle_binding_owner_rationale_digest_required',
    );
  }
  if (confirmedDigest !== rationaleDigest) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_circle_binding_owner_rationale_digest_mismatch',
    );
  }

  const facts = buildCaseFacts({
    actionType: input.actionType,
    binding,
    application: application!,
  });
  const linkedCaseId = optionalText(metadata.governanceCaseId);
  if (linkedCaseId || application?.frozen === true) {
    if (!linkedCaseId || application?.frozen !== true) {
      throw new GovernanceCaseIntakeError(
        409,
        'external_app_circle_binding_owner_application_conflict',
      );
    }
    const replay = await resolveExistingOwnerApplicationCaseReplay(prisma, {
      governanceCaseId: linkedCaseId,
      circleId: input.circleId,
      actionType: input.actionType,
      binding,
      application: application!,
      facts,
      rationaleDigest,
    });
    return { governanceCase: replay, binding, replayed: true };
  }
  const recurrenceEpoch = await resolveExternalGovernedActionRecurrenceEpoch(prisma, {
    circleId: input.circleId,
    actionType: input.actionType,
    subjectType: 'external_app_circle_binding',
    subjectRef: binding.id,
  });
  const intentDigest = buildExternalGovernedActionIntentDigest({
    expectedSnapshotVersion: facts.snapshotVersion,
    expectedSnapshotDigest: facts.snapshotDigest,
    requestedActionPayload: facts.operationPayload,
    statePrecondition: facts.statePrecondition,
    rationaleDigest,
  });
  const recurrenceKey = buildExternalGovernedActionRecurrenceKey({
    circleId: input.circleId,
    actionType: input.actionType,
    candidateRef: facts.candidateRef,
    recurrenceEpoch,
  });
  try {
    await assertExternalGovernedActionRecurrenceAvailable(prisma, {
      circleId: input.circleId,
      actionType: input.actionType,
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
        error.existingCaseId ? `${error.code}:${error.existingCaseId}` : error.code,
      );
    }
    throw error;
  }

  const expectedRequestedAt = String(application?.requestedAt || '');
  const expectedEpoch = String(application?.applicationEpoch ?? '');
  const expectedOwner = String(application?.requestedByPubkey || '');
  const expectedKind = String(application?.kind || '');
  const expectedAction = input.actionType;
  const requestedActionPayload = {
    operationPayload: facts.operationPayload,
    statePrecondition: facts.statePrecondition,
    bindingId: binding.id,
    candidateProvenance: {
      candidateRef: facts.candidateRef,
      snapshotVersion: facts.snapshotVersion,
      snapshotDigest: facts.snapshotDigest,
      applicationRequestedByPubkey: expectedOwner,
      applicationRequestedAt: expectedRequestedAt,
      applicationRationaleDigest: rationaleDigest,
      applicationEpoch: Number(application?.applicationEpoch),
      recurrenceEpoch,
      intentDigest,
      connectorTrustProfile: 'external-app-circle-binding-owner-application-v1',
    },
  };
  const opened = await createGovernanceCaseIntake(prisma, {
    circleId: input.circleId,
    title: input.title,
    requestedDecision: `Confirm Owner application ${rationaleDigest} for ${input.actionType}`,
    requestedActionPayload,
    statePrecondition: facts.statePrecondition,
    caseType: 'policy',
    templateId: input.templateId || 'basic-community',
    actionType: input.actionType,
    subjectType: 'external_app_circle_binding',
    subjectRef: binding.id,
    originKind: 'manual_item',
    idempotencyKey: recurrenceKey,
    openedByPubkey: input.openedByPubkey,
    actorRole: input.actorRole,
    openedAt: input.now ?? new Date(),
    recurrenceReservation: {
      actionType: input.actionType,
      subjectType: 'external_app_circle_binding',
      subjectRef: binding.id,
      recurrenceEpoch,
      intentDigest,
    },
    afterPersist: async (tx, governanceCase) => {
      const { app } = await lockAssertClockExternalProgramRuntimeApp(tx, {
        externalAppId,
        now: input.now,
        registryMode: externalAppRegistryModeFromEnv(),
        expectedOwnerPubkey: expectedOwner,
      });
      if (!solanaPublicKeysEqual(app.ownerPubkey, expectedOwner)) {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_circle_binding_application_owner_mismatch',
        );
      }
      if (
        input.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
        && !await hasDifferentActivePrimaryBinding(tx, binding)
      ) {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_primary_circle_change_active_primary_required',
        );
      }
      const current = await tx.externalAppCircleBinding.findUnique({
        where: { id: binding.id },
      });
      const currentMeta = asRecord(current?.metadata) ?? {};
      const frozenApplication = {
        ...(asRecord(currentMeta.application) ?? {}),
        frozen: true,
      };
      const expectedStatus = input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION
        ? 'active'
        : 'pending';
      const cas = await tx.$executeRawUnsafe?.(
        `UPDATE external_app_circle_bindings
         SET metadata = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2
           AND status = $3
           AND (metadata->>'governanceCaseId' IS NULL OR metadata->>'governanceCaseId' = $4)
           AND COALESCE(metadata->'application'->>'kind', '') = $5
           AND COALESCE(metadata->'application'->>'applicationEpoch', '') = $6
           AND COALESCE(metadata->'application'->>'requestedAt', '') = $7
           AND COALESCE(metadata->'application'->>'rationaleDigest', '') = $8
           AND COALESCE(metadata->'application'->>'requestedByPubkey', '') = $9
           AND COALESCE(metadata->'application'->>'actionType', '') = $10
           AND COALESCE(metadata->'application'->>'candidateRef', '') = $11
           AND COALESCE(metadata->'application'->>'environment', '') = $12
           AND binding_digest = $13
           AND ($14 = '' OR COALESCE(metadata->'application'->>'snapshotVersion', '') = $14)
           AND ($15 = '' OR COALESCE(metadata->'application'->>'snapshotDigest', '') = $15)
           AND COALESCE(metadata->'application'->>'frozen', 'false') <> 'true'`,
        JSON.stringify({
          ...currentMeta,
          requiresGovernance: true,
          application: frozenApplication,
          governanceCaseId: governanceCase.id,
        }),
        binding.id,
        expectedStatus,
        governanceCase.id,
        expectedKind,
        expectedEpoch,
        expectedRequestedAt,
        rationaleDigest,
        expectedOwner,
        expectedAction,
        facts.candidateRef,
        String(application?.environment || ''),
        String(binding.bindingDigest || ''),
        input.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
          ? ''
          : facts.snapshotVersion,
        input.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
          ? ''
          : facts.snapshotDigest,
      );
      if (typeof cas !== 'number') {
        throw new GovernanceCaseIntakeError(
          503,
          'external_app_circle_binding_application_cas_unavailable',
        );
      }
      if (cas !== 1) {
        throw new GovernanceCaseIntakeError(
          409,
          'external_app_circle_binding_owner_application_conflict',
        );
      }
    },
  });
  const linked = await prisma.externalAppCircleBinding.findUnique({
    where: { id: binding.id },
  });
  return {
    governanceCase: opened.governanceCase,
    binding: linked ?? binding,
    replayed: opened.replayed,
  };
}

async function resolveExistingOwnerApplicationCaseReplay(
  prisma: any,
  input: {
    governanceCaseId: string;
    circleId: number;
    actionType: ExternalAppCircleBindingOwnerAction;
    binding: any;
    application: Record<string, any>;
    facts: ReturnType<typeof buildCaseFacts>;
    rationaleDigest: string;
  },
): Promise<any> {
  if (typeof prisma.governanceCase?.findUnique !== 'function') {
    throw new GovernanceCaseIntakeError(
      503,
      'external_app_circle_binding_governance_case_lookup_unavailable',
    );
  }
  const governanceCase = await prisma.governanceCase.findUnique({
    where: { id: input.governanceCaseId },
    include: {
      homeIdentityBinding: {
        select: { homeType: true, homeRef: true },
      },
    },
  });
  const payload = asRecord(governanceCase?.requestedActionPayload);
  const provenance = asRecord(payload?.candidateProvenance);
  const recurrenceEpoch = Number(provenance?.recurrenceEpoch);
  const expectedIntentDigest = Number.isSafeInteger(recurrenceEpoch)
    && recurrenceEpoch > 0
    ? buildExternalGovernedActionIntentDigest({
      expectedSnapshotVersion: input.facts.snapshotVersion,
      expectedSnapshotDigest: input.facts.snapshotDigest,
      requestedActionPayload: input.facts.operationPayload,
      statePrecondition: input.facts.statePrecondition,
      rationaleDigest: input.rationaleDigest,
    })
    : '';
  const expectedPayload = {
    operationPayload: input.facts.operationPayload,
    statePrecondition: input.facts.statePrecondition,
    bindingId: input.binding.id,
    candidateProvenance: {
      candidateRef: input.facts.candidateRef,
      snapshotVersion: input.facts.snapshotVersion,
      snapshotDigest: input.facts.snapshotDigest,
      applicationRequestedByPubkey: String(input.application.requestedByPubkey || ''),
      applicationRequestedAt: String(input.application.requestedAt || ''),
      applicationRationaleDigest: input.rationaleDigest,
      applicationEpoch: Number(input.application.applicationEpoch),
      recurrenceEpoch,
      intentDigest: expectedIntentDigest,
      connectorTrustProfile: 'external-app-circle-binding-owner-application-v1',
    },
  };
  const templateSelection = asRecord(governanceCase?.templateSelection);
  const templateAction = asRecord(templateSelection?.action);
  const frozenMatches = payload
    && hashCanonicalGovernanceValue(
      'alcheme.external-app.circle-binding-owner-case-payload',
      payload,
    ) === hashCanonicalGovernanceValue(
      'alcheme.external-app.circle-binding-owner-case-payload',
      expectedPayload,
    );
  if (
    !governanceCase
    || governanceCase.subjectType !== 'external_app_circle_binding'
    || String(governanceCase.subjectRef || '') !== String(input.binding.id)
    || governanceCase.homeIdentityBinding?.homeType !== 'circle'
    || String(governanceCase.homeIdentityBinding?.homeRef || '') !== String(input.circleId)
    || String(templateAction?.type || templateSelection?.actionType || '') !== input.actionType
    || !frozenMatches
    || !/^[a-f0-9]{64}$/.test(expectedIntentDigest)
    || provenance?.intentDigest !== expectedIntentDigest
  ) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_circle_binding_owner_application_conflict',
    );
  }
  return governanceCase;
}

async function hasDifferentActivePrimaryBinding(
  prisma: any,
  binding: any,
): Promise<boolean> {
  if (typeof prisma.externalAppCircleBinding?.findFirst !== 'function') {
    throw new GovernanceCaseIntakeError(
      503,
      'external_app_primary_circle_change_lookup_unavailable',
    );
  }
  return Boolean(await prisma.externalAppCircleBinding.findFirst({
    where: {
      externalAppId: String(binding.externalAppId),
      bindingKind: 'primary',
      status: 'active',
      id: { not: String(binding.id) },
    },
    select: { id: true },
  }));
}

function assertSelectedApplication(input: {
  binding: any;
  application: Record<string, any> | null;
  actionType: ExternalAppCircleBindingOwnerAction;
}): void {
  const { binding, application, actionType } = input;
  if (!application) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_circle_binding_owner_application_required',
    );
  }
  if (actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION) {
    if (
      String(binding.bindingKind) !== 'primary'
      || String(binding.status) !== 'pending'
      || String(binding.source) !== PRIMARY_BIND_APPLICATION_SOURCE
      || application.kind !== PRIMARY_BIND_APPLICATION_KIND
      || application.actionType !== EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
    ) {
      throw new GovernanceCaseIntakeError(
        409,
        'external_app_primary_circle_change_canonical_application_required',
      );
    }
    return;
  }
  const expectedStatus = actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION
    ? 'active'
    : 'pending';
  if (
    String(binding.bindingKind) !== 'attached'
    || String(binding.status) !== expectedStatus
    || application.kind !== CIRCLE_BINDING_OWNER_APPLICATION_KIND
    || application.actionType !== actionType
  ) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_circle_binding_owner_application_required',
    );
  }
}

function buildCaseFacts(input: {
  actionType: ExternalAppCircleBindingOwnerAction;
  binding: any;
  application: Record<string, any>;
}): {
  candidateRef: string;
  snapshotVersion: string;
  snapshotDigest: string;
  operationPayload: Record<string, unknown>;
  statePrecondition: Record<string, unknown>;
} {
  if (input.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION) {
    const candidateRef = String(input.application.candidateRef || '');
    return {
      candidateRef,
      snapshotVersion: `primary-circle-bind:v1:${candidateRef}`,
      snapshotDigest: sha256(candidateRef),
      operationPayload: {
        externalAppId: String(input.binding.externalAppId),
        circleId: Number(input.binding.circleId),
        bindingKind: 'primary',
        bindingCandidateRef: candidateRef,
      },
      statePrecondition: {
        bindingStatus: 'pending',
        bindingKind: 'primary',
      },
    };
  }
  const snapshot = buildExternalAppCircleBindingOwnerApplicationSnapshot({
    actionType: input.actionType,
    binding: input.binding,
  });
  if (
    snapshot.candidateRef !== input.application.candidateRef
    || snapshot.snapshotVersion !== input.application.snapshotVersion
    || snapshot.snapshotDigest !== input.application.snapshotDigest
  ) {
    throw new GovernanceCaseIntakeError(
      409,
      'external_app_circle_binding_application_snapshot_stale',
    );
  }
  return {
    ...snapshot,
    operationPayload: {
      externalAppId: String(input.binding.externalAppId),
      circleId: Number(input.binding.circleId),
      bindingKind: 'attached',
      bindingCandidateRef: snapshot.candidateRef,
      operation: input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION
        ? 'revoke'
        : 'activate',
    },
    statePrecondition: {
      bindingStatus: input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION
        ? 'active'
        : 'pending',
      bindingKind: 'attached',
      bindingDigest: String(input.binding.bindingDigest || ''),
    },
  };
}

export function buildExternalAppCircleBindingOwnerApplicationSnapshot(input: {
  actionType: AttachedOwnerAction;
  binding: any;
}): { candidateRef: string; snapshotVersion: string; snapshotDigest: string } {
  const candidateRef = `${String(input.binding.id)}:${input.actionType}`;
  const snapshotVersion = `circle-binding-owner-application:v1:${candidateRef}`;
  const snapshotDigest = sha256(JSON.stringify({
    scope: 'external_app_circle_binding_owner_application_snapshot_v1',
    actionType: input.actionType,
    bindingId: String(input.binding.id),
    bindingDigest: String(input.binding.bindingDigest || ''),
    externalAppId: String(input.binding.externalAppId),
    circleId: Number(input.binding.circleId),
    bindingKind: String(input.binding.bindingKind),
    status: input.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
      ? 'pending'
      : String(input.binding.status),
  }));
  return { candidateRef, snapshotVersion, snapshotDigest };
}

function isTerminalCase(value: any): boolean {
  return ['closed', 'cancelled', 'archived'].includes(String(value?.casePhase || ''))
    || ['rejected', 'expired', 'cancelled'].includes(String(value?.decisionOutcome || ''));
}

function assertCircleId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GovernanceCaseIntakeError(400, 'invalid_circle_id');
  }
}

function requiredText(value: unknown, code: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new GovernanceCaseIntakeError(400, code);
  return text;
}

function requiredRationale(value: unknown): string {
  const text = String(value ?? '').trim();
  if (text.length < 10 || text.length > 2000) {
    throw new GovernanceCaseIntakeError(
      400,
      'governance_case_requested_decision_required',
    );
  }
  return text;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function mapApplicationError(error: unknown): never {
  if (error instanceof GovernanceCaseIntakeError) throw error;
  if (error instanceof ExternalProgramRuntimeAuthorizationError) {
    throw new GovernanceCaseIntakeError(error.statusCode, error.code);
  }
  throw error;
}
