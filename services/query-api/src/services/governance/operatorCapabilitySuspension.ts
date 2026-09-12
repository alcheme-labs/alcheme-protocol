import type { PrismaClient } from '@prisma/client';

import {
  createGovernedActionRegistry,
  OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
} from './actionRegistry';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import { GovernedActionGateway } from './governedActionGateway';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import { createGovernanceCaseIntake } from './governanceCase';
import {
  operatorCapabilitySuspensionSubjectRef,
  reconcileExpiredOperatorCapabilitySuspensions,
  resolveOperatorCapabilitySuspensionContract,
} from './operatorCapabilitySuspensionAdmission';

export {
  assertOperatorCapabilityAvailable,
  operatorCapabilitySuspensionSubjectRef,
  reconcileExpiredOperatorCapabilitySuspensions,
  resolveOperatorCapabilitySuspensionContract,
} from './operatorCapabilitySuspensionAdmission';

export async function suspendOperatorCapability(prisma: PrismaClient, input: {
  circleId: number;
  actorPubkey: string;
  targetOperatorPubkey: string;
  targetActionType: string;
  targetSubjectType: string;
  targetSubjectRef: string;
  durationSeconds: number;
  reasonCode: string;
  idempotencyKey: string;
  sourceReportId?: string | null;
  ratificationCaseId?: string | null;
}) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const targetOperatorPubkey = canonicalSolanaPublicKeyString(input.targetOperatorPubkey);
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!actorPubkey || actorPubkey !== input.actorPubkey
    || !targetOperatorPubkey || targetOperatorPubkey !== input.targetOperatorPubkey
    || actorPubkey === targetOperatorPubkey) {
    throw suspensionError(400, 'operator_capability_suspension_actor_invalid');
  }
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw suspensionError(400, 'operator_capability_suspension_input_invalid');
  }
  return (prisma as any).$transaction(async (tx: any) => {
    const now = new Date();
    const sourceReportId = input.sourceReportId?.trim() || null;
    const report = sourceReportId
      ? await tx.governanceModerationReport.findFirst({
        where: { id: sourceReportId, circleId: input.circleId },
        select: {
          id: true, circleId: true, subjectType: true, subjectRef: true,
          submissionDigest: true, status: true,
        },
      })
      : null;
    if (sourceReportId && (!report
      || report.status === 'closed'
      || report.subjectType !== 'communication_room_member'
      || !String(report.subjectRef).endsWith(`:${targetOperatorPubkey}`))) {
      throw suspensionError(409, 'operator_capability_suspension_report_mismatch');
    }
    const contract = resolveOperatorCapabilitySuspensionContract({
      targetCircleId: input.circleId,
      targetOperatorPubkey,
      targetActionType: input.targetActionType,
      targetSubjectType: input.targetSubjectType,
      targetSubjectRef: input.targetSubjectRef,
      durationSeconds: input.durationSeconds,
      now,
      sourceReportId,
      sourceReportDigest: report?.submissionDigest ?? null,
      ratificationCaseId: input.ratificationCaseId,
    });
    const subjectRef = operatorCapabilitySuspensionSubjectRef({
      targetCircleId: input.circleId,
      targetOperatorPubkey,
      targetActionType: contract.targetActionType,
      targetSubjectType: contract.targetSubjectType,
      targetSubjectRef: contract.targetSubjectRef,
    });
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `operator-capability-suspension:${subjectRef}`,
    );
    const prior = await tx.operationEffect.findFirst({
      where: {
        invocation: {
          governanceHomeType: 'circle',
          governanceHomeRef: String(input.circleId),
          subjectType: 'governed_operator_capability',
          subjectRef,
          contractVersion: { actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE },
        },
      },
      include: { invocation: { include: { contractVersion: true } } },
      orderBy: { activatedAt: 'desc' },
    });
    const replay = prior
      && prior.invocation?.actorPubkey === actorPubkey
      && prior.invocation?.idempotencyKey === idempotencyKey;
    if (prior && !replay) {
      const priorContract = prior.invocation?.requestedEffect;
      const priorExpiry = new Date(String(priorContract?.expiresAt ?? ''));
      if (!Number.isFinite(priorExpiry.getTime())) {
        throw suspensionError(409, 'operator_capability_suspension_prior_contract_invalid');
      }
      if (['active', 'ratification_required'].includes(prior.state)
        && priorExpiry.getTime() > now.getTime()) {
        throw suspensionError(409, 'operator_capability_suspension_overlap');
      }
      await assertAcceptedSuspensionRatificationCase(tx, {
        circleId: input.circleId,
        ratificationCaseId: contract.ratificationCaseId,
        priorEffectId: prior.id,
        subjectRef,
        targetOperatorPubkey,
        targetActionType: contract.targetActionType,
        targetSubjectType: contract.targetSubjectType,
        targetSubjectRef: contract.targetSubjectRef,
      });
    } else if (!prior && contract.ratificationCaseId) {
      throw suspensionError(409, 'operator_capability_suspension_ratification_without_prior');
    }
    const gateway = new GovernedActionGateway({
      registry: createGovernedActionRegistry({
        includePhase1Defaults: true,
        includeCommunicationActions: true,
      }),
      resolveBinding: (bindingInput) => resolveActiveCircleGovernanceBinding(tx, bindingInput),
      listCommitteeEligibleActors: (eligibleInput) => listCommitteeEligibleActors(tx, eligibleInput),
      requestStore: createPrismaGovernanceRequestStore(tx),
      runtimePrisma: tx,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'governed_operator_capability',
      targetRef: subjectRef,
      actorPubkey,
      payload: { ...contract },
      reasonCode,
      idempotencyKey,
      execute: async () => ({
        result: {
          state: 'ratification_required',
          expiresAt: contract.expiresAt,
          targetActionType: contract.targetActionType,
          targetSubjectType: contract.targetSubjectType,
          targetSubjectRef: contract.targetSubjectRef,
        },
        executionRef: `operator-capability-suspension:${subjectRef}`,
      }),
    });
    const effect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
      include: { invocation: true, events: { orderBy: { sequence: 'asc' } } },
    });
    if (!effect || effect.initialReceiptId !== outcome.receipt.id) {
      throw suspensionError(409, 'operator_capability_suspension_effect_missing');
    }
    if (effect.state === 'active') {
      await transitionOperationEffectInTransaction(tx, {
        effectId: effect.id,
        nextState: 'ratification_required',
        reasonCode: 'operator_capability_ratification_required',
        actorPubkey: null,
        sourceReceiptId: outcome.receipt.id,
        occurredAt: now,
      });
    } else if (effect.state !== 'ratification_required') {
      throw suspensionError(409, 'operator_capability_suspension_terminal');
    }
    return {
      replayed: outcome.replayed,
      receipt: outcome.receipt,
      suspension: {
        effectId: effect.id,
        subjectRef,
        state: 'ratification_required' as const,
        ...contract,
      },
    };
  });
}

export async function openOperatorCapabilitySuspensionRatificationCase(
  prisma: PrismaClient,
  input: {
    circleId: number;
    effectId: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const effectId = input.effectId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!actorPubkey || actorPubkey !== input.actorPubkey
    || !effectId || effectId.length > 96
    || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw suspensionError(400, 'operator_capability_ratification_case_input_invalid');
  }
  return (prisma as any).$transaction(async (tx: any) => {
    const effect = await tx.operationEffect.findUnique({
      where: { id: effectId },
      include: {
        invocation: { include: { contractVersion: true } },
        initialReceipt: true,
      },
    });
    const contract = effect?.invocation?.requestedEffect;
    if (!effect
      || !['ratification_required', 'expired'].includes(effect.state)
      || effect.invocation?.governanceHomeType !== 'circle'
      || effect.invocation?.governanceHomeRef !== String(input.circleId)
      || effect.invocation?.contractVersion?.actionType !== OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE
      || contract?.contractVersion !== 'operator-capability-suspension-current'
      || contract.targetCircleId !== input.circleId
      || effect.invocation?.subjectType !== 'governed_operator_capability'
      || effect.invocation?.subjectRef !== operatorCapabilitySuspensionSubjectRef({
        targetCircleId: input.circleId,
        targetOperatorPubkey: String(contract?.targetOperatorPubkey ?? ''),
        targetActionType: String(contract?.targetActionType ?? ''),
        targetSubjectType: String(contract?.targetSubjectType ?? ''),
        targetSubjectRef: String(contract?.targetSubjectRef ?? ''),
      })) {
      throw suspensionError(409, 'operator_capability_ratification_case_effect_mismatch');
    }
    const authorityContext = await loadOperatorCapabilityRatificationAuthority(tx, input.circleId);
    const authorityAssessment = assessOperatorCapabilityRatificationAuthority(
      authorityContext,
      String(contract.targetOperatorPubkey),
    );
    if (authorityAssessment.reason === 'subject_conflict') {
      throw suspensionError(409, 'operator_capability_ratification_subject_conflict');
    }
    if (authorityAssessment.status !== 'available' || !authorityContext.authority) {
      throw suspensionError(409, 'operator_capability_ratification_independent_committee_required');
    }
    return createGovernanceCaseIntake(tx, {
      circleId: input.circleId,
      title: 'Ratify continued operator capability suspension',
      requestedDecision: 'Should an independent Committee authorize another temporary suspension of this exact operator action and subject capability?',
      requestedActionPayload: {
        kind: 'operator_capability_suspension_ratification',
        priorEffectId: effect.id,
        targetOperatorPubkey: contract.targetOperatorPubkey,
        targetActionType: contract.targetActionType,
        targetSubjectType: contract.targetSubjectType,
        targetSubjectRef: contract.targetSubjectRef,
        automaticExecution: false,
        permanentRevoke: false,
        roleChange: false,
      },
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
      subjectType: 'governed_operator_capability',
      subjectRef: effect.invocation.subjectRef,
      authorityBindingId: authorityContext.authority.binding.id,
      originKind: 'native_invocation',
      sourceInvocationId: effect.invocationId,
      sourceReceiptId: effect.initialReceiptId,
      idempotencyKey,
      openedByPubkey: actorPubkey,
      actorRole: input.actorRole,
    });
  });
}

export async function listOperatorCapabilitySuspensions(prisma: PrismaClient, input: {
  circleId: number;
  targetOperatorPubkey?: string | null;
  issuingActorPubkey?: string | null;
}) {
  const targetOperatorPubkey = input.targetOperatorPubkey
    ? canonicalSolanaPublicKeyString(input.targetOperatorPubkey)
    : null;
  const issuingActorPubkey = input.issuingActorPubkey
    ? canonicalSolanaPublicKeyString(input.issuingActorPubkey)
    : null;
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0
    || (input.targetOperatorPubkey && !targetOperatorPubkey)
    || (input.issuingActorPubkey && !issuingActorPubkey)) {
    throw suspensionError(400, 'operator_capability_suspension_query_invalid');
  }
  await reconcileExpiredOperatorCapabilitySuspensions(prisma, { limit: 100 });
  const authorityContext = await loadOperatorCapabilityRatificationAuthority(prisma, input.circleId);
  const effects = await (prisma as any).operationEffect.findMany({
    where: {
      invocation: {
        governanceHomeType: 'circle',
        governanceHomeRef: String(input.circleId),
        ...(issuingActorPubkey ? { actorPubkey: issuingActorPubkey } : {}),
        contractVersion: { actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE },
      },
    },
    include: {
      invocation: true,
      initialReceipt: true,
      events: { orderBy: { sequence: 'asc' } },
    },
    orderBy: { activatedAt: 'desc' },
    take: 100,
  });
  return effects.flatMap((effect: any) => {
    const contract = effect.invocation?.requestedEffect;
    if (!contract || contract.contractVersion !== 'operator-capability-suspension-current'
      || (targetOperatorPubkey && contract.targetOperatorPubkey !== targetOperatorPubkey)) return [];
    const ratificationAuthority = assessOperatorCapabilityRatificationAuthority(
      authorityContext,
      String(contract.targetOperatorPubkey),
    );
    return [{
      effectId: effect.id,
      state: effect.state,
      receiptId: effect.initialReceiptId,
      appealRef: effect.initialReceipt?.appealRef ?? null,
      ...contract,
      ratificationAuthority,
      events: effect.events.map((event: any) => ({
        sequence: event.sequence,
        fromState: event.fromState,
        toState: event.toState,
        reasonCode: event.reasonCode,
        occurredAt: new Date(event.occurredAt).toISOString(),
      })),
    }];
  });
}

type OperatorCapabilityRatificationAuthorityContext = {
  authority: Awaited<ReturnType<typeof resolveActiveCircleGovernanceBinding>> | null;
  eligibleActorPubkeys: ReadonlySet<string>;
};

async function loadOperatorCapabilityRatificationAuthority(
  prisma: any,
  circleId: number,
): Promise<OperatorCapabilityRatificationAuthorityContext> {
  const authority = await resolveActiveCircleGovernanceBinding(prisma, {
    targetCircleId: circleId,
    actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
    purpose: 'collective_decision',
  });
  if (!authority || authority.binding.committeeCircleId === circleId) {
    return { authority: null, eligibleActorPubkeys: new Set() };
  }
  const eligibleActors = await listCommitteeEligibleActors(prisma, {
    committeeCircleId: authority.binding.committeeCircleId,
  });
  return {
    authority,
    eligibleActorPubkeys: new Set(eligibleActors.map((actor) => actor.pubkey)),
  };
}

function assessOperatorCapabilityRatificationAuthority(
  context: OperatorCapabilityRatificationAuthorityContext,
  targetOperatorPubkey: string,
) {
  if (!context.authority) {
    return {
      status: 'blocked_no_independent_authority' as const,
      reason: 'independent_committee_unavailable' as const,
      authorityBindingId: null,
      committeeCircleId: null,
    };
  }
  if (context.eligibleActorPubkeys.has(targetOperatorPubkey)) {
    return {
      status: 'blocked_no_independent_authority' as const,
      reason: 'subject_conflict' as const,
      authorityBindingId: null,
      committeeCircleId: null,
    };
  }
  return {
    status: 'available' as const,
    reason: null,
    authorityBindingId: String(context.authority.binding.id),
    committeeCircleId: Number(context.authority.binding.committeeCircleId),
  };
}

function suspensionError(statusCode: number, code: string) {
  return Object.assign(new Error(code), { statusCode });
}

async function assertAcceptedSuspensionRatificationCase(tx: any, input: {
  circleId: number;
  ratificationCaseId: string | null;
  priorEffectId: string;
  subjectRef: string;
  targetOperatorPubkey: string;
  targetActionType: string;
  targetSubjectType: string;
  targetSubjectRef: string;
}) {
  if (!input.ratificationCaseId) {
    throw suspensionError(409, 'operator_capability_suspension_ratification_case_required');
  }
  const governanceCase = await tx.governanceCase.findFirst({
    where: {
      id: input.ratificationCaseId,
      homeIdentityBinding: { homeType: 'circle', homeRef: String(input.circleId) },
      subjectType: 'governed_operator_capability',
      subjectRef: input.subjectRef,
      decisionOutcome: 'accepted',
      casePhase: { in: ['outcome_review', 'closed'] },
    },
    include: { actionContractVersion: true },
  });
  const payload = governanceCase?.requestedActionPayload;
  if (!governanceCase
    || governanceCase.actionContractVersion?.actionType !== OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE
    || payload?.kind !== 'operator_capability_suspension_ratification'
    || payload?.priorEffectId !== input.priorEffectId
    || payload?.targetOperatorPubkey !== input.targetOperatorPubkey
    || payload?.targetActionType !== input.targetActionType
    || payload?.targetSubjectType !== input.targetSubjectType
    || payload?.targetSubjectRef !== input.targetSubjectRef
    || payload?.automaticExecution !== false
    || payload?.permanentRevoke !== false
    || payload?.roleChange !== false) {
    throw suspensionError(409, 'operator_capability_suspension_ratification_case_mismatch');
  }
}
