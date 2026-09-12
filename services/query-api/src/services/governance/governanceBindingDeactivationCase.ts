import {
  computeCircleGovernanceBindingControlDigest,
  CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE,
} from './circleGovernanceBindingExecution';
import { resolveActiveCircleGovernanceBinding } from './circleGovernanceBindings';
import { createGovernanceCaseIntake } from './governanceCase';

export async function createActiveGovernanceBindingDeactivationCase(
  prisma: any,
  input: {
    targetCircleId: number;
    bindingId: string;
    actorPubkey: string;
    actorRole: string;
    reason?: string | null;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ governanceCase: any; replayed: boolean }> {
  const existingCase = await prisma.governanceCase.findFirst({
    where: {
      idempotencyKey: input.idempotencyKey,
      subjectType: 'circle_governance_binding',
      subjectRef: input.bindingId,
    },
    include: {
      homeIdentityBinding: { select: { homeType: true, homeRef: true } },
      primaryRequest: true,
      responsibilities: true,
      timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    },
  });
  if (existingCase) {
    const payload = asRecord(existingCase.requestedActionPayload);
    if (
      existingCase.openedByPubkey !== input.actorPubkey
      || payload.bindingId !== input.bindingId
      || payload.targetCircleId !== input.targetCircleId
      || (payload.reason ?? null) !== (input.reason ?? null)
    ) {
      throw new Error('governance_binding_deactivation_idempotency_conflict');
    }
    return { governanceCase: existingCase, replayed: true };
  }

  const binding = await prisma.circleGovernanceBinding.findUnique({
    where: { id: input.bindingId },
  });
  if (
    !binding
    || binding.targetCircleId !== input.targetCircleId
    || binding.status !== 'active'
  ) {
    throw new Error('circle_governance_binding_not_active');
  }
  const authority = await resolveActiveCircleGovernanceBinding(prisma, {
    targetCircleId: input.targetCircleId,
    actionType: CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE,
    authorityBindingId: input.bindingId,
    subjectType: 'circle_governance_binding',
    subjectRef: input.bindingId,
    now: input.now,
  });
  if (!authority || authority.binding.id !== input.bindingId) {
    throw new Error('governance_binding_deactivation_authority_unavailable');
  }
  const requestedActionPayload = {
    bindingId: input.bindingId,
    targetCircleId: input.targetCircleId,
    mandateId: binding.mandateId ?? null,
    bindingScope: {
      actionType: binding.actionType ?? null,
      actionPrefix: binding.actionPrefix ?? null,
    },
    policyVersionId: binding.policyVersionId,
    policyVersion: binding.policyVersion,
    bindingControlDigest: computeCircleGovernanceBindingControlDigest(binding),
    reason: input.reason ?? null,
  };
  return createGovernanceCaseIntake(prisma, {
    circleId: input.targetCircleId,
    title: binding.mandateId
      ? 'Deactivate active governance Mandate'
      : 'Deactivate active governance binding',
    requestedDecision: 'Should this active governance authority be deactivated prospectively?',
    requestedActionPayload,
    caseType: 'policy',
    templateId: 'basic-community',
    actionType: CIRCLE_GOVERNANCE_BINDING_DEACTIVATE_ACTION_TYPE,
    subjectType: 'circle_governance_binding',
    subjectRef: input.bindingId,
    authorityBindingId: input.bindingId,
    decisionMechanismKind: 'equal_weight_threshold',
    originKind: 'manual_item',
    sourceMessageIds: [],
    idempotencyKey: input.idempotencyKey,
    openedByPubkey: input.actorPubkey,
    actorRole: input.actorRole,
    openedAt: input.now,
  });
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
