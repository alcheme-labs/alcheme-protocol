import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';

import {
  expireGovernanceRequestAtomically,
  type GovernanceEligibleActor,
  type GovernanceSignalRecord,
} from './policyEngine';
import { applyGovernanceCaseDecisionResolution } from './governanceCaseDecisionStage';
import { recordCircleGovernanceBindingRejectedDecision } from './circleGovernanceBindingExecution';
import {
  evaluateCommitteeMemberThreshold,
  resolveCommitteeMemberThresholdConfig,
} from './strategies/committeeMemberThreshold';
import { GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE } from './actionRegistry';
import {
  createDefaultGovernanceExecutionRegistry,
  executeAcceptedGovernanceRequest,
} from './requestExecution';
import { retireExpiredSquadsGrantPayoutAttempt } from './squadsProviderBinding';

export interface GovernanceRequestReconcileResult {
  scannedRequestIds: string[];
  terminalized: Array<{ requestId: string; reason: string }>;
  skippedRequestIds: string[];
  failures: Array<{ requestId: string; error: string }>;
}

interface GovernanceProviderExecutionRetryResult {
  scannedRequestIds: string[];
  attempted: Array<{
    requestId: string;
    status: string;
    errorCode: string | null;
  }>;
  retired: Array<{
    requestId: string;
    resourceBindingId: string;
    retirementDigest: string;
  }>;
  skippedRequestIds: string[];
  failures: Array<{ requestId: string; error: string }>;
}

export async function reconcileRecoverableProviderExecutions(
  prisma: PrismaClient,
  input: { redis?: Redis | null; now?: Date; limit?: number } = {},
  dependencies?: {
    executeRequest?: typeof executeAcceptedGovernanceRequest;
    retireAttempt?: typeof retireExpiredSquadsGrantPayoutAttempt;
  },
): Promise<GovernanceProviderExecutionRetryResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const resources = await prisma.governedResourceBinding.findMany({
    where: { capability: 'grant_settlement', status: 'hold' },
    select: {
      id: true,
      sourceRequestId: true,
      sourceDecisionDigest: true,
      verification: true,
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  const result: GovernanceProviderExecutionRetryResult = {
    scannedRequestIds: [],
    attempted: [],
    retired: [],
    skippedRequestIds: [],
    failures: [],
  };
  const executeRequest = dependencies?.executeRequest ?? executeAcceptedGovernanceRequest;
  const retireAttempt = dependencies?.retireAttempt ?? retireExpiredSquadsGrantPayoutAttempt;

  for (const resource of resources) {
    const verification = jsonRecord(resource.verification);
    const retry = jsonRecord(verification.retry);
    const requestId = String(resource.sourceRequestId ?? '');
    if (!requestId) continue;
    result.scannedRequestIds.push(requestId);
    const nextRetryAt = Date.parse(String(retry.nextRetryAt ?? ''));
    if (
      retry.mode !== 'same_request_only'
      || retry.requestId !== requestId
      || !Number.isSafeInteger(Number(retry.attemptCount))
      || Number(retry.attemptCount) <= 0
      || !Number.isFinite(nextRetryAt)
      || nextRetryAt > now.getTime()
    ) {
      result.skippedRequestIds.push(requestId);
      continue;
    }
    try {
      const request = await prisma.governanceRequest.findUnique({
        where: { id: requestId },
        include: { decision: { select: { decisionDigest: true } } },
      });
      const payload = jsonRecord(request?.payload);
      const activation = jsonRecord(payload.activation);
      const activationExpiresAt = Date.parse(String(activation.expiresAt ?? ''));
      if (
        !request
        || request.state !== 'accepted'
        || request.actionType !== GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE
        || request.executionMode !== 'provider_bound_action'
        || request.compatibilityBundleVersion !== null
        || request.executionAuthorizationStatus !== 'authorized'
        || request.decision?.decisionDigest !== resource.sourceDecisionDigest
        || !Number.isFinite(activationExpiresAt)
      ) {
        result.skippedRequestIds.push(requestId);
        continue;
      }
      if (activationExpiresAt <= now.getTime()) {
        const retirement = await retireAttempt(prisma, {
          resourceBindingId: resource.id,
          requestId,
          now,
        });
        result.retired.push({
          requestId,
          resourceBindingId: retirement.resourceBindingId,
          retirementDigest: retirement.retirementDigest,
        });
        continue;
      }
      const execution = await executeRequest({
        prisma,
        redis: input.redis ?? null,
        registry: createDefaultGovernanceExecutionRegistry(),
        request: {
          id: request.id,
          actionType: request.actionType,
          targetType: request.targetType,
          targetRef: String(request.targetRef ?? ''),
          payload,
          proposerPubkey: request.proposerPubkey ?? 'governance',
          homeIdentityBindingId: request.homeIdentityBindingId ?? null,
          invocationId: request.invocationId ?? null,
          idempotencyKey: request.idempotencyKey ?? null,
          state: request.state,
          executionMode: request.executionMode,
          executionModeDigest: request.executionModeDigest ?? null,
          compatibilityBundleVersion: request.compatibilityBundleVersion,
          executionAuthorizationStatus: request.executionAuthorizationStatus,
        },
        source: 'reconciler_retry',
        decisionDigest: request.decision.decisionDigest,
        now,
      });
      result.attempted.push({
        requestId,
        status: execution.status,
        errorCode: execution.errorCode,
      });
    } catch (error) {
      result.failures.push({
        requestId,
        error: error instanceof Error ? error.message : 'provider_execution_retry_failed',
      });
    }
  }
  return result;
}

export async function reconcileActiveGovernanceRequests(
  prisma: PrismaClient,
  input: { now?: Date; limit?: number } = {},
): Promise<GovernanceRequestReconcileResult> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates = await prisma.governanceRequest.findMany({
    where: {
      state: 'active',
      expiresAt: { not: null },
      OR: [
        { expiresAt: { lte: now } },
        { signals: { some: {} } },
      ],
    },
    select: { id: true },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
  const result: GovernanceRequestReconcileResult = {
    scannedRequestIds: candidates.map((item) => item.id),
    terminalized: [],
    skippedRequestIds: [],
    failures: [],
  };

  for (const candidate of candidates) {
    try {
      const terminal = await expireGovernanceRequestAtomically(prisma as any, {
        requestId: candidate.id,
        now,
        allowAllEligibleTerminal: true,
        evaluate: evaluateLegacyGovernanceRequest,
        onTerminal: applyGovernanceRequestTerminalEffects,
      });
      result.terminalized.push({
        requestId: candidate.id,
        reason: terminal.decision.reason,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'governance_request_reconcile_failed';
      if ([
        'governance_request_not_expired',
        'governance_request_not_active',
        'governance_request_terminal_transition_conflict',
      ].includes(message)) {
        result.skippedRequestIds.push(candidate.id);
      } else {
        result.failures.push({ requestId: candidate.id, error: message });
      }
    }
  }
  return result;
}

export async function applyGovernanceRequestTerminalEffects(input: {
  tx: any;
  request: any;
  decision: any;
  now: Date;
}): Promise<void> {
  await applyGovernanceCaseDecisionResolution(input.tx, {
    request: input.request,
    decision: input.decision,
    now: input.now,
  });
  if (input.decision.decision !== 'expired') return;
  await recordCircleGovernanceBindingRejectedDecision(
    transactionScopedCircleBindingPrisma(input.tx),
    input.request,
    { decisionDigest: input.decision.decisionDigest },
  );
}

function transactionScopedCircleBindingPrisma(tx: any): any {
  let scoped: any;
  scoped = {
    circleGovernanceBinding: tx.circleGovernanceBinding,
    governanceMandate: tx.governanceMandate,
    governanceMandateVersion: tx.governanceMandateVersion,
    governancePolicy: tx.governancePolicy,
    governancePolicyVersion: tx.governancePolicyVersion,
    circleMember: tx.circleMember,
    $transaction: (operation: (client: any) => Promise<unknown>) => operation(scoped),
  };
  return scoped;
}

function evaluateLegacyGovernanceRequest(input: {
  request: any;
  eligibleActors: GovernanceEligibleActor[];
  signals: GovernanceSignalRecord[];
}) {
  return evaluateCommitteeMemberThreshold({
    config: resolveCommitteeMemberThresholdConfig(
      input.request.policyVersionRecord?.rules,
      input.request.ruleId,
    ),
    eligibleActors: input.eligibleActors,
    signals: input.signals,
  });
}

function jsonRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
