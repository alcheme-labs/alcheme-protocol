import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  createGovernedActionRegistry,
  OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
} from './actionRegistry';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';

const MIN_DURATION_SECONDS = 5 * 60;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

export interface OperatorCapabilitySuspensionContract {
  contractVersion: 'operator-capability-suspension-current';
  targetCircleId: number;
  targetOperatorPubkey: string;
  targetActionType: string;
  targetSubjectType: string;
  targetSubjectRef: string;
  durationSeconds: number;
  suspendedAt: string;
  expiresAt: string;
  sourceReportId: string | null;
  sourceReportDigest: string | null;
  ratificationCaseId: string | null;
  effectState: 'ratification_required';
  ratification: 'high_risk_case_required_for_continuation';
  complaintAutomaticExecution: false;
  permanentRevoke: false;
  roleChange: false;
}

export function resolveOperatorCapabilitySuspensionContract(input: {
  targetCircleId: number;
  targetOperatorPubkey: string;
  targetActionType: string;
  targetSubjectType: string;
  targetSubjectRef: string;
  durationSeconds: number;
  now: Date;
  expiresAt?: Date;
  sourceReportId?: string | null;
  sourceReportDigest?: string | null;
  ratificationCaseId?: string | null;
}): OperatorCapabilitySuspensionContract {
  const operator = canonicalSolanaPublicKeyString(input.targetOperatorPubkey);
  const actionType = input.targetActionType.trim();
  const subjectType = input.targetSubjectType.trim();
  const subjectRef = input.targetSubjectRef.trim();
  const sourceReportId = input.sourceReportId?.trim() || null;
  const sourceReportDigest = input.sourceReportDigest?.trim() || null;
  const ratificationCaseId = input.ratificationCaseId?.trim() || null;
  if (!Number.isSafeInteger(input.targetCircleId) || input.targetCircleId <= 0) {
    throw new Error('operator_capability_suspension_circle_invalid');
  }
  if (!operator || operator !== input.targetOperatorPubkey) {
    throw new Error('operator_capability_suspension_operator_invalid');
  }
  const targetDefinition = createGovernedActionRegistry({
    includeCommunicationActions: true,
    includeFeedGovernanceActions: true,
  }).get(actionType);
  if (!targetDefinition
    || actionType.length > 96
    || actionType === OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE) {
    throw new Error('operator_capability_suspension_target_action_forbidden');
  }
  if (subjectType !== targetDefinition.targetType
    || subjectType.length > 64 || !subjectRef || subjectRef.length > 128) {
    throw new Error('operator_capability_suspension_target_subject_invalid');
  }
  if (!Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < MIN_DURATION_SECONDS
    || input.durationSeconds > MAX_DURATION_SECONDS
    || !Number.isFinite(input.now.getTime())) {
    throw new Error('operator_capability_suspension_duration_invalid');
  }
  if ((sourceReportId === null) !== (sourceReportDigest === null)
    || (sourceReportId && sourceReportId.length > 96)
    || (sourceReportDigest && !/^[a-f0-9]{64}$/.test(sourceReportDigest))) {
    throw new Error('operator_capability_suspension_report_evidence_invalid');
  }
  if (ratificationCaseId && (ratificationCaseId.length > 128
    || !ratificationCaseId.startsWith('governance_case:'))) {
    throw new Error('operator_capability_suspension_ratification_case_invalid');
  }
  const expiresAt = input.expiresAt
    ?? new Date(input.now.getTime() + input.durationSeconds * 1_000);
  if (!Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() - input.now.getTime() !== input.durationSeconds * 1_000) {
    throw new Error('operator_capability_suspension_expiry_invalid');
  }
  return {
    contractVersion: 'operator-capability-suspension-current',
    targetCircleId: input.targetCircleId,
    targetOperatorPubkey: operator,
    targetActionType: actionType,
    targetSubjectType: subjectType,
    targetSubjectRef: subjectRef,
    durationSeconds: input.durationSeconds,
    suspendedAt: input.now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sourceReportId,
    sourceReportDigest,
    ratificationCaseId,
    effectState: 'ratification_required',
    ratification: 'high_risk_case_required_for_continuation',
    complaintAutomaticExecution: false,
    permanentRevoke: false,
    roleChange: false,
  };
}

export function operatorCapabilitySuspensionSubjectRef(input: {
  targetCircleId: number;
  targetOperatorPubkey: string;
  targetActionType: string;
  targetSubjectType: string;
  targetSubjectRef: string;
}): string {
  const digest = hashCanonicalGovernanceValue(
    'alcheme.governance.operator-capability-suspension-subject',
    input,
  );
  return `${input.targetCircleId}:operator-capability:${digest.slice(0, 64)}`;
}

export async function assertOperatorCapabilityAvailable(prisma: any, input: {
  targetCircleId: number;
  actorPubkey: string;
  actionType: string;
  subjectType: string;
  subjectRef: string;
  now: Date;
}): Promise<void> {
  if (input.actionType === OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE) return;
  const subjectRef = operatorCapabilitySuspensionSubjectRef({
    targetCircleId: input.targetCircleId,
    targetOperatorPubkey: input.actorPubkey,
    targetActionType: input.actionType,
    targetSubjectType: input.subjectType,
    targetSubjectRef: input.subjectRef,
  });
  const effect = await prisma.operationEffect.findFirst({
    where: {
      state: { in: ['active', 'ratification_required'] },
      invocation: {
        governanceHomeType: 'circle',
        governanceHomeRef: String(input.targetCircleId),
        subjectType: 'governed_operator_capability',
        subjectRef,
        contractVersion: { actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE },
      },
    },
    include: { invocation: { include: { contractVersion: true } } },
    orderBy: { activatedAt: 'desc' },
  });
  if (!effect) return;
  const contract = exactStoredContract(effect.invocation?.requestedEffect, input);
  const expiresAt = new Date(contract.expiresAt);
  if (expiresAt.getTime() <= input.now.getTime()) {
    try {
      await transitionOperationEffectInTransaction(prisma, {
        effectId: effect.id,
        nextState: 'expired',
        reasonCode: 'operator_capability_suspension_expired',
        actorPubkey: null,
        sourceReceiptId: null,
        occurredAt: input.now,
      });
    } catch (error) {
      const readback = await prisma.operationEffect.findUnique({ where: { id: effect.id } });
      if (readback?.state !== 'expired') throw error;
    }
    return;
  }
  throw new Error('operator_exact_capability_suspended');
}

export async function reconcileExpiredOperatorCapabilitySuspensions(
  prisma: any,
  input: { now?: Date; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates = await prisma.operationEffect.findMany({
    where: {
      state: { in: ['active', 'ratification_required'] },
      invocation: { contractVersion: { actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE } },
    },
    include: { invocation: true },
    orderBy: { activatedAt: 'asc' },
    take: limit,
  });
  const expired: string[] = [];
  const failures: Array<{ effectId: string; error: string }> = [];
  for (const candidate of candidates) {
    try {
      const expiresAt = new Date(String(candidate.invocation?.requestedEffect?.expiresAt ?? ''));
      if (!Number.isFinite(expiresAt.getTime())) {
        throw new Error('operator_capability_suspension_stored_contract_invalid');
      }
      if (expiresAt.getTime() > now.getTime()) continue;
      const result = await prisma.$transaction(async (tx: any) => {
        const current = await tx.operationEffect.findUnique({ where: { id: candidate.id } });
        if (!current || !['active', 'ratification_required'].includes(current.state)) return 'stale';
        try {
          await transitionOperationEffectInTransaction(tx, {
            effectId: candidate.id,
            nextState: 'expired',
            reasonCode: 'operator_capability_suspension_expired',
            actorPubkey: null,
            sourceReceiptId: null,
            occurredAt: now,
          });
        } catch (error) {
          if (!(error instanceof Error)
            || error.message !== 'operation_effect_transition_cas_failed') throw error;
          const concurrentEffect = await tx.operationEffect.findUnique({
            where: { id: candidate.id },
          });
          if (!concurrentEffect
            || !['expired', 'revoked'].includes(concurrentEffect.state)) throw error;
          return 'stale';
        }
        return 'expired';
      });
      if (result === 'expired') expired.push(candidate.id);
    } catch (error) {
      failures.push({
        effectId: candidate.id,
        error: error instanceof Error ? error.message : 'operator_capability_suspension_expiry_failed',
      });
    }
  }
  return { expired, failures };
}

function exactStoredContract(value: any, input: {
  targetCircleId: number;
  actorPubkey: string;
  actionType: string;
  subjectType: string;
  subjectRef: string;
}): OperatorCapabilitySuspensionContract {
  const contract = value as OperatorCapabilitySuspensionContract;
  if (!contract || contract.contractVersion !== 'operator-capability-suspension-current'
    || contract.targetCircleId !== input.targetCircleId
    || contract.targetOperatorPubkey !== input.actorPubkey
    || contract.targetActionType !== input.actionType
    || contract.targetSubjectType !== input.subjectType
    || contract.targetSubjectRef !== input.subjectRef
    || contract.effectState !== 'ratification_required'
    || contract.ratification !== 'high_risk_case_required_for_continuation'
    || contract.complaintAutomaticExecution !== false
    || contract.permanentRevoke !== false
    || contract.roleChange !== false
    || !Number.isFinite(new Date(contract.expiresAt).getTime())) {
    throw new Error('operator_capability_suspension_stored_contract_invalid');
  }
  return contract;
}
