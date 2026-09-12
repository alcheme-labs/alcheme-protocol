import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { GOVERNANCE_PROVIDER_EXECUTION_FUNDING_AMEND_ACTION_TYPE } from './actionRegistry';
import {
  resolveActiveCircleGovernanceBinding,
  type FrozenGovernanceCaseAuthorityReference,
} from './circleGovernanceBindings';
import { createGovernanceCaseIntake } from './governanceCase';

export type GovernanceFundingAmendmentPayload = {
  kind: 'provider_execution_funding_amendment';
  originalCaseId: string;
  originalRequestId: string;
  originalDecisionDigest: string;
  blockerId: string;
  failedReceiptId: string;
  baselinePayerPolicyId: string;
  baselinePayerPolicyDigest: string;
  baselinePayerPolicyVersion: number;
  baselineCostPreflightId: string;
  baselineCostPreflightDigest: string;
  actionIntentDigest: string;
  proposedEconomicBearer: string;
  proposedSingleLimit: Record<string, unknown>;
  proposedPeriodLimit: Record<string, unknown>;
  directProviderRetryAllowed: false;
  reason: string;
};

export type GovernanceFundingAmendmentResolutionReadback = {
  state: 'accepted_pending_manual_same_intent_retry';
  automaticRetry: false;
  baseline: {
    payerPolicyId: string;
    payerPolicyDigest: string;
    costPreflightId: string;
    costPreflightDigest: string;
  };
  amendment: {
    requestId: string;
    decisionDigest: string;
    payerPolicyId: string;
    payerPolicyDigest: string;
    payerPolicyVersion: number;
    costPreflightId: string;
    costPreflightDigest: string;
  };
  blocker: { id: string; state: 'resolved' };
  retryEligibility: 'manual_same_intent_retry_ready';
};

export function assertGovernanceFundingAmendmentManualRetryConfirmation(input: {
  blockers: Array<{ status?: unknown; closedAt?: unknown }> | null | undefined;
  confirmation: unknown;
}): boolean {
  const resolved = Array.isArray(input.blockers) && input.blockers.some(
    (blocker) => blocker?.status === 'resolved' && blocker?.closedAt != null,
  );
  if (!resolved) return false;
  if (input.confirmation !== 'retry_same_intent_with_accepted_funding_amendment') {
    throw new Error('governance_funding_amendment_retry_confirmation_required');
  }
  return true;
}

export async function resolveGovernanceFundingAmendmentRetryPreflight(
  prisma: any,
  input: {
    originalCaseId?: string;
    originalRequestId: string;
    originalDecisionDigest: string;
    invocationId: string;
    actionIntentDigest: string;
    baselinePreflight: any;
  },
): Promise<{
  preflight: any;
  payerPolicy: any;
  singleLimit: Record<string, unknown>;
  periodLimit: Record<string, unknown>;
  economicBearer: string;
  amendmentRequestId: string;
  amendmentDecisionDigest: string;
  automaticRetry: false;
} | null> {
  const originalRequestId = text(input.originalRequestId);
  const originalDecisionDigest = digest(input.originalDecisionDigest);
  const invocationId = text(input.invocationId);
  const actionIntentDigest = digest(input.actionIntentDigest);
  const originalCaseId = input.originalCaseId
    ? text(input.originalCaseId)
    : text((await prisma.governanceCase.findUnique({
      where: { primaryRequestId: originalRequestId },
      select: { id: true },
    }))?.id);
  const baseline = input.baselinePreflight;
  if (
    !baseline
    || baseline.invocationId !== invocationId
    || baseline.actionIntentDigest !== actionIntentDigest
    || !baseline.payerPolicy
    || !/^[a-f0-9]{64}$/.test(String(baseline.preflightDigest ?? ''))
  ) throw new Error('governance_funding_amendment_retry_baseline_invalid');
  const candidates = await prisma.costPreflight.findMany({
    where: {
      invocationId,
      actionIntentDigest,
      status: { in: ['pending', 'ready'] },
      NOT: { id: baseline.id },
    },
    orderBy: { checkedAt: 'desc' },
    include: { payerPolicy: true, assetAuthorityPolicy: true },
  });
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length !== 1) {
    throw new Error('governance_funding_amendment_retry_ambiguous');
  }
  const candidate = candidates[0];
  const payer = candidate?.payerPolicy;
  const amendmentEvidence = record(record(candidate?.estimatedCost).fundingAmendment);
  const amendmentRequestId = String(payer?.sourceRequestId ?? '').trim();
  const amendmentDecisionDigest = String(amendmentEvidence.decisionDigest ?? '').trim();
  const amendmentRequest = amendmentRequestId
    ? await prisma.governanceRequest.findUnique({
      where: { id: amendmentRequestId },
      include: {
        decision: true,
        governanceCase: {
          include: { relatedCase: { include: { blockers: true } } },
        },
      },
    })
    : null;
  const amendmentCase = amendmentRequest?.governanceCase;
  const amendment = parseGovernanceFundingAmendmentPayload(
    amendmentCase?.requestedActionPayload,
  );
  const blocker = amendmentCase?.relatedCase?.blockers?.find(
    (item: any) => item.id === amendment?.blockerId,
  );
  const sameJson = (left: unknown, right: unknown) => (
    hashCanonicalGovernanceValue('alcheme.governance.funding-amendment-value', left)
    === hashCanonicalGovernanceValue('alcheme.governance.funding-amendment-value', right)
  );
  if (
    !amendmentRequest
    || amendmentRequest.state !== 'accepted'
    || amendmentRequest.actionType !== GOVERNANCE_PROVIDER_EXECUTION_FUNDING_AMEND_ACTION_TYPE
    || amendmentRequest.decision?.decision !== 'accepted'
    || amendmentRequest.decision.decisionDigest !== amendmentDecisionDigest
    || payer?.sourceDecisionDigest !== amendmentDecisionDigest
    || amendmentCase?.relatedCaseId !== originalCaseId
    || !amendment
    || amendment.originalCaseId !== originalCaseId
    || amendment.originalRequestId !== originalRequestId
    || amendment.originalDecisionDigest !== originalDecisionDigest
    || amendment.baselinePayerPolicyId !== baseline.payerPolicy.id
    || amendment.baselinePayerPolicyDigest !== baseline.payerPolicy.policyDigest
    || amendment.baselinePayerPolicyVersion !== baseline.payerPolicy.version
    || amendment.baselineCostPreflightId !== baseline.id
    || amendment.baselineCostPreflightDigest !== baseline.preflightDigest
    || amendment.actionIntentDigest !== actionIntentDigest
    || amendmentEvidence.baselinePreflightDigest !== baseline.preflightDigest
    || blocker?.status !== 'resolved'
    || !blocker?.closedAt
    || candidate.payerPolicyRef !== payer?.id
    || candidate.actionIntentDigest !== actionIntentDigest
    || payer.version !== baseline.payerPolicy.version + 1
    || payer.homeIdentityBindingId !== baseline.payerPolicy.homeIdentityBindingId
    || payer.network !== baseline.payerPolicy.network
    || payer.actionScopeDigest !== baseline.payerPolicy.actionScopeDigest
    || payer.feePayerSignerRef !== baseline.payerPolicy.feePayerSignerRef
    || payer.rentFundingSourceRef !== baseline.payerPolicy.rentFundingSourceRef
    || payer.refundRecipientRef !== baseline.payerPolicy.refundRecipientRef
    || payer.relayerRef !== baseline.payerPolicy.relayerRef
    || payer.economicBearer !== amendment.proposedEconomicBearer
    || !sameJson(payer.singleLimit, amendment.proposedSingleLimit)
    || !sameJson(payer.periodLimit, amendment.proposedPeriodLimit)
  ) throw new Error('governance_funding_amendment_retry_lineage_invalid');
  return {
    preflight: candidate,
    payerPolicy: payer,
    singleLimit: amendment.proposedSingleLimit,
    periodLimit: amendment.proposedPeriodLimit,
    economicBearer: amendment.proposedEconomicBearer,
    amendmentRequestId,
    amendmentDecisionDigest,
    automaticRetry: false,
  };
}

export async function openGovernanceFundingAmendmentCase(
  prisma: any,
  input: {
    caseId: string;
    proposedEconomicBearer: string;
    proposedSingleLimit: Record<string, unknown>;
    proposedPeriodLimit: Record<string, unknown>;
    reason: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; governanceCase: any }> {
  const caseId = text(input.caseId);
  const proposedEconomicBearer = text(input.proposedEconomicBearer);
  const proposedSingleLimit = record(input.proposedSingleLimit);
  const proposedPeriodLimit = record(input.proposedPeriodLimit);
  const reason = text(input.reason);
  const actorPubkey = text(input.actorPubkey);
  const idempotencyKey = text(input.idempotencyKey);
  if (
    idempotencyKey.length < 8
    || reason.length > 2000
    || Object.keys(proposedSingleLimit).length === 0
    || Object.keys(proposedPeriodLimit).length === 0
  ) throw new Error('governance_funding_amendment_input_invalid');
  const now = input.now ?? new Date();
  const run = async (tx: any) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: {
        blockers: { where: { code: 'funding_amendment_required' }, orderBy: { openedAt: 'desc' } },
        primaryRequest: {
          include: {
            decision: true,
            receipts: { orderBy: { executedAt: 'desc' } },
            invocation: {
              include: {
                costPreflights: {
                  orderBy: { checkedAt: 'desc' },
                  include: { payerPolicy: true },
                },
              },
            },
          },
        },
      },
    });
    const circleId = governanceCase?.subjectType === 'circle'
      ? Number(governanceCase.subjectRef) : NaN;
    const request = governanceCase?.primaryRequest;
    const blocker = governanceCase?.blockers?.find(
      (candidate: any) => candidate.status === 'open' && !candidate.closedAt,
    );
    const preflight = request?.invocation?.costPreflights?.find(
      (candidate: any) => ['failed', 'blocked', 'expired'].includes(candidate.status),
    );
    const payer = preflight?.payerPolicy;
    const failedReceipt = request?.receipts?.find(
      (candidate: any) => candidate.id === blocker?.evidenceReceiptId
        && candidate.executionStatus === 'failed',
    );
    if (
      !governanceCase
      || !Number.isSafeInteger(circleId)
      || circleId <= 0
      || request?.state !== 'accepted'
      || request?.decision?.decision !== 'accepted'
      || !blocker
      || blocker.scopeRef !== `execution-receipt:${blocker.evidenceReceiptId}`
      || !failedReceipt
      || failedReceipt.decisionDigest !== request.decision.decisionDigest
      || !payer
      || preflight.payerPolicyRef !== payer.id
      || (payer.sourceRequestId && payer.sourceRequestId !== request.id)
      || payer.sourceDecisionDigest !== request.decision.decisionDigest
    ) throw new Error('governance_funding_amendment_source_invalid');

    const frozenAuthority = frozenCaseAuthority(governanceCase);
    const authorityResolution = await resolveActiveCircleGovernanceBinding(tx, {
      targetCircleId: circleId,
      actionType: GOVERNANCE_PROVIDER_EXECUTION_FUNDING_AMEND_ACTION_TYPE,
      purpose: 'collective_decision',
      now,
      frozenCaseAuthority: frozenAuthority,
    });
    if (!authorityResolution
      || authorityResolution.binding.id !== frozenAuthority.projectionBindingId) {
      throw new Error('governance_funding_amendment_authority_unavailable');
    }
    const requestedActionPayload: GovernanceFundingAmendmentPayload = {
      kind: 'provider_execution_funding_amendment',
      originalCaseId: governanceCase.id,
      originalRequestId: request.id,
      originalDecisionDigest: request.decision.decisionDigest,
      blockerId: blocker.id,
      failedReceiptId: failedReceipt.id,
      baselinePayerPolicyId: payer.id,
      baselinePayerPolicyDigest: payer.policyDigest,
      baselinePayerPolicyVersion: payer.version,
      baselineCostPreflightId: preflight.id,
      baselineCostPreflightDigest: preflight.preflightDigest,
      actionIntentDigest: preflight.actionIntentDigest,
      proposedEconomicBearer,
      proposedSingleLimit,
      proposedPeriodLimit,
      directProviderRetryAllowed: false,
      reason,
    };
    parseGovernanceFundingAmendmentPayload(requestedActionPayload);
    return createGovernanceCaseIntake(tx, {
      circleId,
      title: `Amend Provider execution funding for ${request.id}`,
      requestedDecision: `Should the original Decision authority accept the versioned Provider funding amendment? ${reason}`,
      requestedActionPayload,
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: GOVERNANCE_PROVIDER_EXECUTION_FUNDING_AMEND_ACTION_TYPE,
      subjectType: 'circle',
      subjectRef: String(circleId),
      authorityBindingId: authorityResolution.binding.id,
      authorityResolution,
      decisionMechanismKind: 'equal_weight_threshold',
      originKind: 'manual_item',
      sourceMessageIds: [],
      idempotencyKey,
      openedByPubkey: actorPubkey,
      actorRole: input.actorRole,
      relationshipKind: 'supersedes',
      relatedCaseId: governanceCase.id,
      relationshipReason: reason,
      openedAt: now,
    });
  };
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => run(tx))
    : run(prisma);
}

export function parseGovernanceFundingAmendmentPayload(
  value: unknown,
): GovernanceFundingAmendmentPayload | null {
  const payload = record(value);
  if (payload.kind !== 'provider_execution_funding_amendment') return null;
  const proposedSingleLimit = record(payload.proposedSingleLimit);
  const proposedPeriodLimit = record(payload.proposedPeriodLimit);
  const parsed: GovernanceFundingAmendmentPayload = {
    kind: 'provider_execution_funding_amendment',
    originalCaseId: text(payload.originalCaseId),
    originalRequestId: text(payload.originalRequestId),
    originalDecisionDigest: digest(payload.originalDecisionDigest),
    blockerId: text(payload.blockerId),
    failedReceiptId: text(payload.failedReceiptId),
    baselinePayerPolicyId: text(payload.baselinePayerPolicyId),
    baselinePayerPolicyDigest: digest(payload.baselinePayerPolicyDigest),
    baselinePayerPolicyVersion: Number(payload.baselinePayerPolicyVersion),
    baselineCostPreflightId: text(payload.baselineCostPreflightId),
    baselineCostPreflightDigest: digest(payload.baselineCostPreflightDigest),
    actionIntentDigest: digest(payload.actionIntentDigest),
    proposedEconomicBearer: text(payload.proposedEconomicBearer),
    proposedSingleLimit,
    proposedPeriodLimit,
    directProviderRetryAllowed: false,
    reason: text(payload.reason),
  };
  if (
    payload.directProviderRetryAllowed !== false
    || !Number.isSafeInteger(parsed.baselinePayerPolicyVersion)
    || parsed.baselinePayerPolicyVersion < 1
    || Object.keys(proposedSingleLimit).length === 0
    || Object.keys(proposedPeriodLimit).length === 0
  ) throw new Error('governance_funding_amendment_payload_invalid');
  return parsed;
}

export async function resolveGovernanceFundingAmendmentInTransaction(
  tx: any,
  input: {
    amendmentRequestId: string;
    amendmentDecision: string;
    amendmentDecisionDigest: string;
    requestedActionPayload: unknown;
    now: Date;
  },
): Promise<GovernanceFundingAmendmentResolutionReadback | null> {
  const amendment = parseGovernanceFundingAmendmentPayload(input.requestedActionPayload);
  if (!amendment) return null;
  if (input.amendmentDecision !== 'accepted') return null;
  const amendmentRequestId = text(input.amendmentRequestId);
  const amendmentDecisionDigest = digest(input.amendmentDecisionDigest);
  if (!Number.isFinite(input.now.getTime())) {
    throw new Error('governance_funding_amendment_time_invalid');
  }

  const [blocker, payer, preflight] = await Promise.all([
    tx.governanceCaseBlocker.findUnique({ where: { id: amendment.blockerId } }),
    tx.payerPolicy.findUnique({ where: { id: amendment.baselinePayerPolicyId } }),
    tx.costPreflight.findUnique({
      where: { id: amendment.baselineCostPreflightId },
      include: { payerPolicy: true },
    }),
  ]);
  if (
    !blocker
    || blocker.caseId !== amendment.originalCaseId
    || blocker.scopeRef !== `execution-receipt:${amendment.failedReceiptId}`
    || blocker.code !== 'funding_amendment_required'
    || blocker.status !== 'open'
    || blocker.closedAt
    || blocker.evidenceReceiptId !== amendment.failedReceiptId
  ) throw new Error('governance_funding_amendment_blocker_mismatch');
  if (
    !payer
    || payer.id !== amendment.baselinePayerPolicyId
    || payer.policyDigest !== amendment.baselinePayerPolicyDigest
    || payer.version !== amendment.baselinePayerPolicyVersion
    || payer.sourceRequestId !== amendment.originalRequestId
    || payer.sourceDecisionDigest !== amendment.originalDecisionDigest
    || payer.status !== 'active'
    || payer.supersededAt
  ) throw new Error('governance_funding_amendment_baseline_policy_mismatch');
  if (
    !preflight
    || preflight.payerPolicyRef !== payer.id
    || preflight.preflightDigest !== amendment.baselineCostPreflightDigest
    || preflight.actionIntentDigest !== amendment.actionIntentDigest
    || !['failed', 'blocked', 'expired'].includes(preflight.status)
  ) throw new Error('governance_funding_amendment_baseline_preflight_mismatch');

  const nextVersion = payer.version + 1;
  const suffix = amendmentDecisionDigest.slice(0, 32);
  const payerPolicyId = `payer-policy:funding-amendment:${suffix}`;
  const costPreflightId = `cost-preflight:funding-amendment:${suffix}`;
  const attemptKey = `${preflight.attemptKey}:funding-amendment:${suffix.slice(0, 12)}`;
  const policyFacts = {
    id: payerPolicyId,
    homeIdentityBindingId: payer.homeIdentityBindingId,
    version: nextVersion,
    network: payer.network,
    actionScope: payer.actionScope,
    economicBearer: amendment.proposedEconomicBearer,
    feePayerSignerRef: payer.feePayerSignerRef,
    singleLimit: amendment.proposedSingleLimit,
    periodLimit: amendment.proposedPeriodLimit,
    sourceRequestId: amendmentRequestId,
    sourceDecisionDigest: amendmentDecisionDigest,
    status: 'active',
  };
  const policyDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.payer-policy',
    policyFacts,
  );
  const preflightFacts = {
    id: costPreflightId,
    invocationId: preflight.invocationId,
    payerPolicyRef: payerPolicyId,
    attemptKey,
    actionIntentDigest: preflight.actionIntentDigest,
    baselinePreflightDigest: preflight.preflightDigest,
    amendmentDecisionDigest,
    status: 'pending',
    checkedAt: input.now.toISOString(),
  };
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.cost-preflight',
    preflightFacts,
  );
  const existing = await tx.payerPolicy.findFirst({
    where: { sourceRequestId: amendmentRequestId },
  });
  if (existing) {
    throw new Error('governance_funding_amendment_already_applied');
  }

  const superseded = await tx.payerPolicy.updateMany({
    where: { id: payer.id, policyDigest: payer.policyDigest, status: 'active', supersededAt: null },
    data: { status: 'superseded', supersededAt: input.now },
  });
  if (superseded.count !== 1) {
    throw new Error('governance_funding_amendment_policy_conflict');
  }
  await tx.payerPolicy.create({ data: {
    id: payerPolicyId,
    homeIdentityBindingId: payer.homeIdentityBindingId,
    version: nextVersion,
    network: payer.network,
    actionScope: payer.actionScope,
    actionScopeDigest: payer.actionScopeDigest,
    economicBearer: amendment.proposedEconomicBearer,
    feePayerSignerRef: payer.feePayerSignerRef,
    rentFundingSourceRef: payer.rentFundingSourceRef,
    refundRecipientRef: payer.refundRecipientRef,
    relayerRef: payer.relayerRef,
    reimbursementPolicy: payer.reimbursementPolicy,
    singleLimit: amendment.proposedSingleLimit,
    periodLimit: amendment.proposedPeriodLimit,
    expiry: payer.expiry,
    fundingBlockerCode: null,
    sourceRequestId: amendmentRequestId,
    sourceDecisionDigest: amendmentDecisionDigest,
    policyDigest,
    status: 'active',
    effectiveFrom: input.now,
    supersededAt: null,
  } });
  await tx.costPreflight.create({ data: {
    id: costPreflightId,
    invocationId: preflight.invocationId,
    payerPolicyRef: payerPolicyId,
    assetAuthorityPolicyRef: preflight.assetAuthorityPolicyRef,
    attemptKey,
    estimatedCost: {
      ...(record(preflight.estimatedCost)),
      fundingAmendment: {
        decisionDigest: amendmentDecisionDigest,
        baselinePreflightDigest: preflight.preflightDigest,
      },
    },
    balanceReadback: preflight.balanceReadback,
    reservationRef: preflight.reservationRef,
    quoteContext: preflight.quoteContext,
    status: 'pending',
    checkedAt: input.now,
    expiresAt: null,
    actionIntentDigest: preflight.actionIntentDigest,
    transactionAttemptDigest: null,
    preflightDigest,
  } });
  const resolved = await tx.governanceCaseBlocker.updateMany({
    where: { id: blocker.id, status: 'open', closedAt: null },
    data: { status: 'resolved', closedAt: input.now },
  });
  if (resolved.count !== 1) {
    throw new Error('governance_funding_amendment_blocker_conflict');
  }
  return {
    state: 'accepted_pending_manual_same_intent_retry',
    automaticRetry: false,
    baseline: {
      payerPolicyId: payer.id,
      payerPolicyDigest: payer.policyDigest,
      costPreflightId: preflight.id,
      costPreflightDigest: preflight.preflightDigest,
    },
    amendment: {
      requestId: amendmentRequestId,
      decisionDigest: amendmentDecisionDigest,
      payerPolicyId,
      payerPolicyDigest: policyDigest,
      payerPolicyVersion: nextVersion,
      costPreflightId,
      costPreflightDigest: preflightDigest,
    },
    blocker: { id: blocker.id, state: 'resolved' },
    retryEligibility: 'manual_same_intent_retry_ready',
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error('governance_funding_amendment_payload_invalid');
  return normalized;
}

function digest(value: unknown): string {
  const normalized = text(value);
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('governance_funding_amendment_payload_invalid');
  }
  return normalized;
}

function frozenCaseAuthority(governanceCase: any): FrozenGovernanceCaseAuthorityReference {
  const authority = governanceCase?.templateSelection?.actionAuthority;
  const openedAt = governanceCase?.openedAt instanceof Date
    ? governanceCase.openedAt : new Date(String(governanceCase?.openedAt ?? ''));
  const frozen = {
    openedAt,
    projectionBindingId: String(authority?.projectionBindingId ?? ''),
    mandateId: String(authority?.mandateId ?? ''),
    mandateVersion: Number(authority?.mandateVersion),
    mandateTermsDigest: String(authority?.mandateTermsDigest ?? ''),
    subjectType: String(authority?.subject?.type ?? ''),
    subjectRef: String(authority?.subject?.ref ?? ''),
    policy: {
      id: String(authority?.policy?.id ?? ''),
      versionId: String(authority?.policy?.versionId ?? ''),
      version: Number(authority?.policy?.version),
      ruleId: String(authority?.policy?.ruleId ?? ''),
    },
  };
  if (
    authority?.sourceType !== 'governance_mandate'
    || !Number.isFinite(openedAt.getTime())
    || !frozen.projectionBindingId
    || !frozen.mandateId
    || !Number.isSafeInteger(frozen.mandateVersion)
    || frozen.mandateVersion <= 0
    || !/^[a-f0-9]{64}$/.test(frozen.mandateTermsDigest)
    || !frozen.policy.id
    || !frozen.policy.versionId
    || !Number.isSafeInteger(frozen.policy.version)
    || frozen.policy.version <= 0
    || !frozen.policy.ruleId
  ) throw new Error('governance_funding_amendment_frozen_authority_invalid');
  return frozen;
}
