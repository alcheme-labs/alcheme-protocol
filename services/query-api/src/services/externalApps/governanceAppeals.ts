import type { PrismaClient } from '@prisma/client';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { hashCanonicalGovernanceValue } from '../governance/canonicalCodec';
import type { GovernanceEligibleActor } from '../governance/policyEngine';
import {
  assertActiveExternalAppReviewBinding,
  EXTERNAL_APP_APPEAL_ROLE,
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  type ExternalAppGovernanceRoleKey,
  type SystemGovernanceRoleBindingPrisma,
} from '../governance/systemRoleBindings';
import { openExternalAppGovernedRequest } from './productionRegistry';
import {
  normalizeExternalAppDiscoveryStatus,
  normalizeExternalAppId,
} from './validation';

const EXTERNAL_APP_APPEAL_FILING_WINDOW_SECONDS = 72 * 60 * 60;
const EXTERNAL_APP_APPEAL_DECISION_TTL_SECONDS = 72 * 60 * 60;

const DISCOVERY_RESTRICTION_RANK = new Map([
  ['listed', 0],
  ['unlisted', 1],
  ['limited', 2],
  ['hidden', 3],
  ['delisted', 4],
]);

export async function openSandboxExternalAppDiscoveryDowngradeRequest(
  prisma: PrismaClient,
  input: {
    externalAppId: string;
    actorPubkey: string;
    discoveryStatus: unknown;
    reasonCode: unknown;
    idempotencyKey: unknown;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  const actorPubkey = requiredCanonicalPubkey(input.actorPubkey);
  const app = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: {
      id: true,
      environment: true,
      discoveryStatus: true,
    },
  });
  if (!app) throw new Error('external_app_not_found');
  if (app.environment !== 'sandbox') {
    throw new Error('external_app_governance_sandbox_only');
  }
  const discoveryStatus = normalizeExternalAppDiscoveryStatus(input.discoveryStatus);
  const currentRank = DISCOVERY_RESTRICTION_RANK.get(app.discoveryStatus);
  const nextRank = DISCOVERY_RESTRICTION_RANK.get(discoveryStatus);
  if (currentRank === undefined || nextRank === undefined || nextRank <= currentRank) {
    throw new Error('external_app_discovery_downgrade_required');
  }
  const reasonCode = requiredReasonCode(input.reasonCode);
  const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
  const context = await resolveSandboxRoleContext(
    prisma,
    EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  );
  if (!context.eligibleActors.some((actor) => actor.pubkey === actorPubkey)) {
    throw new Error('external_app_review_proposer_not_authorized');
  }
  return openExternalAppGovernedRequest(prisma, context.binding, {
    policyId: context.binding.policyId,
    policyVersionId: context.binding.policyVersionId,
    policyVersion: context.binding.policyVersion,
    ruleId: 'downgrade_discovery_status',
    scope: {
      type: 'external_app_review_circle',
      ref: String(context.binding.circleId),
    },
    action: {
      type: 'downgrade_discovery_status',
      targetType: 'external_app',
      targetRef: externalAppId,
      payload: {
        environment: 'sandbox',
        previousDiscoveryStatus: app.discoveryStatus,
        discoveryStatus,
        reasonCode,
      },
      idempotencyKey,
    },
    proposerPubkey: actorPubkey,
    eligibleActors: context.eligibleActors,
    openedAt: now,
  });
}

export async function openSandboxExternalAppAppealRequest(
  prisma: PrismaClient,
  input: {
    externalAppId: string;
    actorPubkey: string;
    originalExecutionReceiptId: string;
    reasonCode: unknown;
    evidence: unknown;
    requestedOutcome: unknown;
    modifiedDiscoveryStatus?: unknown;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const externalAppId = normalizeExternalAppId(input.externalAppId);
  const actorPubkey = requiredCanonicalPubkey(input.actorPubkey);
  const app = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: {
      id: true,
      ownerPubkey: true,
      environment: true,
      discoveryStatus: true,
    },
  });
  if (!app) throw new Error('external_app_not_found');
  if (app.environment !== 'sandbox') {
    throw new Error('external_app_governance_sandbox_only');
  }
  if (app.ownerPubkey !== actorPubkey) {
    throw new Error('external_app_appeal_owner_required');
  }
  const originalExecutionReceiptId = requiredText(
    input.originalExecutionReceiptId,
    'external_app_appeal_original_receipt_required',
    96,
  );
  const originalReceipt = await prisma.governanceExecutionReceipt.findUnique({
    where: { id: originalExecutionReceiptId },
    include: {
      request: {
        include: {
          homeIdentityBinding: true,
          decision: true,
        },
      },
    },
  });
  if (
    !originalReceipt
    || originalReceipt.executionStatus !== 'executed'
    || originalReceipt.executorModule !== 'external_app'
    || originalReceipt.actionType !== 'downgrade_discovery_status'
    || originalReceipt.executionRef !== externalAppId
    || originalReceipt.request?.targetType !== 'external_app'
    || originalReceipt.request?.targetRef !== externalAppId
    || originalReceipt.request?.homeIdentityBinding?.homeType !== 'external_app_system_role'
    || originalReceipt.request?.homeIdentityBinding?.homeRef !== 'external_app:sandbox'
    || originalReceipt.request?.decision?.decision !== 'accepted'
    || originalReceipt.request?.decision?.decisionDigest !== originalReceipt.decisionDigest
  ) {
    throw new Error('external_app_appeal_original_receipt_ineligible');
  }
  const originalPayload = record(originalReceipt.request.payload);
  const previousDiscoveryStatus = normalizeExternalAppDiscoveryStatus(
    originalPayload.previousDiscoveryStatus,
  );
  const discoveryStatus = normalizeExternalAppDiscoveryStatus(
    originalPayload.discoveryStatus,
  );
  if (
    originalPayload.environment !== 'sandbox'
    || app.discoveryStatus !== discoveryStatus
    || previousDiscoveryStatus === discoveryStatus
  ) {
    throw new Error('external_app_appeal_original_state_mismatch');
  }
  const filingDeadline = new Date(
    originalReceipt.executedAt.getTime()
      + EXTERNAL_APP_APPEAL_FILING_WINDOW_SECONDS * 1_000,
  );
  if (now.getTime() < originalReceipt.executedAt.getTime() || now > filingDeadline) {
    throw new Error('external_app_appeal_window_expired');
  }
  const reasonCode = requiredReasonCode(input.reasonCode);
  const evidence = normalizeEvidence(input.evidence);
  const evidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.external-app-appeal-evidence',
    evidence,
  );
  const context = await resolveSandboxRoleContext(prisma, EXTERNAL_APP_APPEAL_ROLE);
  const requestedOutcome = normalizeAppealRequestedOutcome(input.requestedOutcome);
  const modifiedDiscoveryStatus = requestedOutcome === 'modify'
    ? normalizeExternalAppDiscoveryStatus(input.modifiedDiscoveryStatus)
    : null;
  if (requestedOutcome === 'modify') {
    const previousRank = DISCOVERY_RESTRICTION_RANK.get(previousDiscoveryStatus);
    const currentRank = DISCOVERY_RESTRICTION_RANK.get(discoveryStatus);
    const modifiedRank = DISCOVERY_RESTRICTION_RANK.get(modifiedDiscoveryStatus!);
    if (
      previousRank === undefined
      || currentRank === undefined
      || modifiedRank === undefined
      || modifiedRank <= previousRank
      || modifiedRank >= currentRank
    ) {
      throw new Error('external_app_appeal_modified_status_invalid');
    }
  }
  const originalInvocationId = requiredText(
    originalReceipt.request.invocationId,
    'external_app_appeal_original_invocation_required',
    96,
  );
  const originalEffectDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.external-app-appeal-original-effect',
    {
      originalInvocationId,
      originalRequestId: originalReceipt.requestId,
      originalExecutionReceiptId: originalReceipt.id,
      originalDecisionDigest: originalReceipt.decisionDigest,
      externalAppId,
      previousDiscoveryStatus,
      discoveryStatus,
    },
  );
  const independentEligibleActors = context.eligibleActors.filter((actor) => (
    actor.pubkey !== actorPubkey
    && actor.pubkey !== originalReceipt.request.proposerPubkey
  ));
  if (independentEligibleActors.length === 0) {
    throw new Error('external_app_appeal_independent_reviewer_required');
  }
  const idempotencyKey = `external-app-appeal:${originalReceipt.id}:${actorPubkey}`;
  return openExternalAppGovernedRequest(prisma, context.binding, {
    policyId: context.binding.policyId,
    policyVersionId: context.binding.policyVersionId,
    policyVersion: context.binding.policyVersion,
    ruleId: 'external_app_appeal_resolution',
    scope: {
      type: 'external_app_review_circle',
      ref: String(context.binding.circleId),
    },
    action: {
      type: 'external_app_appeal_resolution',
      targetType: 'external_app',
      targetRef: externalAppId,
      payload: {
        kind: 'external_app_appeal_resolution',
        environment: 'sandbox',
        originalInvocationId,
        originalRequestId: originalReceipt.requestId,
        originalDecisionDigest: originalReceipt.decisionDigest,
        originalExecutionReceiptId: originalReceipt.id,
        originalActionType: originalReceipt.actionType,
        originalEffectDigest,
        previousDiscoveryStatus,
        discoveryStatus,
        appellantPubkey: actorPubkey,
        filingDeadline: filingDeadline.toISOString(),
        reasonCode,
        evidence,
        evidenceDigest,
        requestedResolution: 'independent_review',
        requestedOutcome,
        modifiedDiscoveryStatus,
      },
      idempotencyKey,
    },
    proposerPubkey: actorPubkey,
    eligibleActors: independentEligibleActors,
    openedAt: now,
    expiresAt: new Date(now.getTime() + EXTERNAL_APP_APPEAL_DECISION_TTL_SECONDS * 1_000),
  });
}

function normalizeAppealRequestedOutcome(value: unknown): 'modify' | 'revoke' {
  if (value === 'modify' || value === 'revoke') return value;
  throw new Error('external_app_appeal_requested_outcome_invalid');
}

async function resolveSandboxRoleContext(
  prisma: PrismaClient,
  roleKey: ExternalAppGovernanceRoleKey,
): Promise<{
  binding: {
    id: string;
    roleKey: ExternalAppGovernanceRoleKey;
    environment: 'sandbox';
    circleId: number;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
  };
  eligibleActors: GovernanceEligibleActor[];
}> {
  const resolved = await assertActiveExternalAppReviewBinding(
    prisma as unknown as SystemGovernanceRoleBindingPrisma,
    { roleKey, environment: 'sandbox' },
  );
  const members = await prisma.circleMember.findMany({
    where: { circleId: resolved.binding.circleId, status: 'Active' },
    include: { user: { select: { pubkey: true } } },
  });
  const eligibleActors = members.map((member) => ({
    pubkey: member.user.pubkey,
    role: String(member.role),
    weight: '1',
    source: `external_app_system_role:${roleKey}`,
  }));
  if (eligibleActors.length === 0) {
    throw new Error('external_app_review_requires_eligible_actors');
  }
  return {
    binding: resolved.binding as typeof resolved.binding & { environment: 'sandbox' },
    eligibleActors,
  };
}

function requiredCanonicalPubkey(value: string): string {
  const normalized = canonicalSolanaPublicKeyString(value);
  if (!normalized || normalized !== value) {
    throw new Error('external_app_governance_actor_invalid');
  }
  return normalized;
}

function requiredReasonCode(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(normalized)) {
    throw new Error('external_app_governance_reason_invalid');
  }
  return normalized;
}

function requiredIdempotencyKey(value: unknown): string {
  return requiredText(value, 'external_app_governance_idempotency_key_required', 128);
}

function requiredText(value: unknown, errorCode: string, maxLength: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > maxLength) throw new Error(errorCode);
  return normalized;
}

function normalizeEvidence(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('external_app_appeal_evidence_invalid');
  }
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 16_384) {
    throw new Error('external_app_appeal_evidence_invalid');
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
