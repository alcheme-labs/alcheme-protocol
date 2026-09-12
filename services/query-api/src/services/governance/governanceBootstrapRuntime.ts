import { isDeepStrictEqual } from 'node:util';

import {
  createGovernanceBootstrapBundle,
  evaluateGovernanceBootstrapReadiness,
  type GovernanceBootstrapBundleInput,
  type GovernanceBootstrapReadinessChecks,
} from './governanceBootstrapContract';
import {
  createGovernanceBootstrapCeremonyOpeningV2,
  evaluateGovernanceBootstrapQueueEligibility,
  verifyGovernanceBootstrapCeremonyOpeningV2Signature,
  type GovernanceBootstrapCeremonyOpeningV2Input,
} from './governanceBootstrapCeremonyContract';
import type { GovernanceBootstrapCeremonyNetwork } from './governanceBootstrapCeremonyContract';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { computeGovernanceSnapshotDigest } from './policyEngine';
import { CIRCLE_GOVERNANCE_PROFILE_V1 } from './governanceProfile';
import { governanceBootstrapProfileBindingId } from './governanceProfileLifecycle';
import {
  bootstrapSelfGovernedCircleBindingId,
  createBootstrapSelfGovernedCircleBindingInTransaction,
  createBootstrapSelfGovernedPolicyContract,
} from './circleGovernanceBindings';

const READINESS_DOMAIN = 'alcheme.governance.bootstrap-readiness-runtime';
const OPEN_EVENT_DOMAIN = 'alcheme.governance.bootstrap-ceremony-event';
const DELIVERY_DOMAIN = 'alcheme.governance.bootstrap-delivery-intent';
const EXECUTION_EVENT_DOMAIN = 'alcheme.governance.bootstrap-execution-event';
const ACTIVATION_READBACK_DOMAIN = 'alcheme.governance.bootstrap-activation-readback';

export interface GovernanceBootstrapLocalnetAdapter {
  readonly network: GovernanceBootstrapCeremonyNetwork;
  submit(input: {
    ceremonyId: string;
    homeIdentityBindingId: string;
    operationKey: string;
    idempotencyKey: string;
    payloadDigest: string;
  }): Promise<{
    status: 'submitted' | 'ambiguous' | 'failed';
    providerRef: string;
    providerVersionRef: string;
    externalRef: string | null;
    transactionSignature: string | null;
    errorCode: string | null;
  }>;
  readback(input: {
    ceremonyId: string;
    homeIdentityBindingId: string;
    operationKey: string;
    idempotencyKey: string;
    payloadDigest: string;
    externalRef: string | null;
    transactionSignature: string | null;
  }): Promise<{
    status: 'confirmed' | 'pending' | 'mismatch' | 'unavailable';
    readbackRef: string;
    observedAuthorityRef: string;
    policyReadyForActivation: boolean;
    bootstrapAuthorityRevoked: boolean;
    emergencyAuthorityIndependent: boolean;
    recoveryAuthorityIndependent: boolean;
    supportAuthorityIndependent: boolean;
    effectiveAt: string | null;
    stateDigest: string;
    errorCode: string | null;
  }>;
}

export function createGovernanceBootstrapReadinessRuntimeEvidence(input: {
  bundle: GovernanceBootstrapBundleInput;
  checks: GovernanceBootstrapReadinessChecks;
}) {
  const evaluation = evaluateGovernanceBootstrapReadiness(input);
  const facts = {
    schemaVersion: 1,
    bundleDigest: evaluation.bundleDigest,
    state: evaluation.state,
    blockers: evaluation.blockers,
    checks: input.checks,
  };
  return Object.freeze({
    evaluation,
    facts,
    readinessDigest: hashCanonicalGovernanceValue(READINESS_DOMAIN, facts),
  });
}

export async function openGovernanceBootstrapCeremonyRuntime(
  dependencies: { prisma: any },
  input: {
    configurationBundleId: string;
    configurationBundle: GovernanceBootstrapBundleInput;
    openingInput: GovernanceBootstrapCeremonyOpeningV2Input;
    signatureBase64: string;
    readinessChecks: GovernanceBootstrapReadinessChecks;
    governanceRequestId: string | null;
    now: Date;
  },
) {
  const now = validDate(input.now);
  const canonicalBundle = createGovernanceBootstrapBundle(input.configurationBundle);
  const readiness = createGovernanceBootstrapReadinessRuntimeEvidence({
    bundle: input.configurationBundle,
    checks: input.readinessChecks,
  });
  assertIndependentAuthorityBoundaries(
    canonicalBundle.bundle.emergencyPolicy.ref,
    input.readinessChecks,
    input.openingInput.actorPubkey,
  );
  const opening = createGovernanceBootstrapCeremonyOpeningV2(input.openingInput);
  const signatureEvidence = verifyGovernanceBootstrapCeremonyOpeningV2Signature({
    opening,
    authorityProof: input.openingInput.authorityProof,
    signatureBase64: input.signatureBase64,
    now: now.toISOString(),
  });
  await assertFoundingConfirmationRequest(
    dependencies.prisma,
    input.openingInput.confirmationPolicy,
    input.governanceRequestId,
    input.openingInput.actorPubkey,
    input.openingInput.ceremonyId,
  );
  if (input.configurationBundleId !== opening.opening.configurationBundleId
    || canonicalBundle.digest !== opening.opening.configurationBundleDigest
    || readiness.evaluation.bundleDigest !== canonicalBundle.digest
    || opening.opening.readinessDigest !== readiness.readinessDigest) {
    throw new Error('governance_bootstrap_runtime_opening_bundle_readiness_mismatch');
  }
  const state = readiness.evaluation.state === 'ready' ? 'prepared' : 'readiness_blocked';
  const ceremonyId = opening.opening.ceremonyId;
  const eventFacts = {
    schemaVersion: 1,
    ceremonyId,
    homeIdentityBindingId: opening.opening.homeIdentityBindingId,
    sequence: 1,
    eventType: 'ceremony_opened',
    status: state,
    openingDigest: opening.openingDigest,
    authorityProofDigest: opening.opening.authorityProofDigest,
    signatureEvidenceDigest: signatureEvidence.signatureEvidenceDigest,
    readinessDigest: readiness.readinessDigest,
    occurredAt: now.toISOString(),
  };
  const eventDigest = hashCanonicalGovernanceValue(OPEN_EVENT_DOMAIN, eventFacts);
  const operationKey = `governance-bootstrap:${ceremonyId}:activate`;
  const deliveryFacts = {
    schemaVersion: 1,
    ceremonyId,
    homeIdentityBindingId: opening.opening.homeIdentityBindingId,
    operationKey,
    operationType: 'bootstrap_ceremony_execute',
    attempt: 1,
    openingDigest: opening.openingDigest,
    configurationBundleDigest: canonicalBundle.digest,
    readinessDigest: readiness.readinessDigest,
  };
  const payloadDigest = hashCanonicalGovernanceValue(DELIVERY_DOMAIN, deliveryFacts);
  const desired = {
    ceremony: {
      id: ceremonyId,
      homeIdentityBindingId: opening.opening.homeIdentityBindingId,
      configurationBundleId: input.configurationBundleId,
      configurationBundleDigest: canonicalBundle.digest,
      governanceRequestId: input.governanceRequestId,
      state,
      stateVersion: 1,
      actorPubkey: opening.opening.actorPubkey,
      sourceAuthorityType: opening.opening.authoritySourceType,
      sourceAuthorityRef: opening.opening.authoritySourceRef,
      sourceAuthorityDigest: opening.opening.authorityProofDigest,
      confirmationPolicyVersion: opening.opening.confirmationPolicyVersion,
      confirmationPolicyDigest: opening.opening.confirmationPolicyDigest,
      signatureDomain: opening.opening.domain,
      signatureVersion: opening.opening.signatureVersion,
      signatureNetwork: opening.opening.network,
      signatureNonce: opening.opening.signatureNonce,
      signatureExpiresAt: new Date(opening.opening.signatureExpiresAt),
      signature: input.signatureBase64,
      signatureDigest: signatureEvidence.evidence.signatureDigest,
      waitingPeriodSeconds: opening.opening.waitingPeriodSeconds,
      readinessDigest: readiness.readinessDigest,
      firstExternalEffectAt: null,
      effectiveAt: null,
      failureCode: readiness.evaluation.state === 'ready' ? null : 'governance_bootstrap_readiness_blocked',
      createdAt: now,
      updatedAt: now,
    },
    event: {
      id: `${ceremonyId}:event:1`,
      ceremonyId,
      homeIdentityBindingId: opening.opening.homeIdentityBindingId,
      sequence: 1,
      eventType: 'ceremony_opened',
      status: state,
      schemaVersion: 1,
      operationKey: null,
      attempt: null,
      evidenceRefs: [
        input.openingInput.authorityProof.authoritySourceRef,
        signatureEvidence.signatureEvidenceRef,
        ...readinessEvidenceRefs(input.readinessChecks),
      ],
      evidenceDigest: readiness.readinessDigest,
      providerRef: null,
      providerVersionRef: null,
      transactionIntentDigest: opening.openingDigest,
      transactionSignature: null,
      readbackRef: null,
      readbackDigest: null,
      observedAuthorityRef: input.openingInput.authorityProof.proof.observedOwnerPubkey,
      observedAuthorityDigest: opening.opening.authorityProofDigest,
      eventDigest,
      occurredAt: now,
      createdAt: now,
    },
    delivery: {
      id: `${ceremonyId}:delivery:1`,
      ceremonyId,
      homeIdentityBindingId: opening.opening.homeIdentityBindingId,
      operationKey,
      operationType: 'bootstrap_ceremony_execute',
      attempt: 1,
      payloadSchemaVersion: 'alcheme.governance.bootstrap-delivery.v1',
      payloadDigest,
      idempotencyKey: `${operationKey}:1`,
      status: 'blocked',
      availableAt: null,
      leaseOwner: null,
      leaseToken: null,
      leaseUntil: null,
      providerRef: null,
      providerVersionRef: null,
      externalRef: null,
      transactionSignature: null,
      errorCode: readiness.evaluation.state === 'ready' ? 'confirmation_and_timelock_required' : 'readiness_blocked',
      submittedAt: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  };

  try {
    return await dependencies.prisma.$transaction(async (tx: any) => {
      const existing = await tx.governanceBootstrapCeremony.findUnique({
        where: { id: ceremonyId },
        include: { events: { orderBy: { sequence: 'asc' } }, deliveries: { orderBy: { attempt: 'asc' } } },
      });
      if (existing) return freezeResult({
        ...exactExisting(existing, desired),
        readiness,
        opening,
        signatureEvidence,
      });
      const [identity, activation, bundle] = await Promise.all([
        tx.governanceHomeIdentityBinding.findUnique({ where: { id: desired.ceremony.homeIdentityBindingId } }),
        tx.governanceActivationState.findUnique({ where: { homeIdentityBindingId: desired.ceremony.homeIdentityBindingId } }),
        tx.governanceConfigurationBundle.findUnique({ where: { id: input.configurationBundleId } }),
      ]);
      assertOpenSources(identity, activation, bundle, desired);
      const ceremony = await tx.governanceBootstrapCeremony.create({ data: desired.ceremony });
      const event = await tx.governanceBootstrapCeremonyEvent.create({ data: desired.event });
      const delivery = await tx.governanceBootstrapDelivery.create({ data: desired.delivery });
      const activationUpdate = await tx.governanceActivationState.updateMany({
        where: {
          id: activation.id,
          homeIdentityBindingId: desired.ceremony.homeIdentityBindingId,
          state: activation.state,
          bootstrapCeremonyId: null,
        },
        data: {
          state: readiness.evaluation.state === 'ready' ? 'preparing' : activation.state,
          bootstrapConfigurationBundleId: input.configurationBundleId,
          bootstrapCeremonyId: ceremonyId,
          bootstrapBundleVersion: opening.opening.configurationBundleVersion,
          bootstrapBundleDigest: canonicalBundle.digest,
          payerPolicyRef: canonicalBundle.bundle.payerPolicy.ref,
          bootstrapActorPubkey: opening.opening.actorPubkey,
          bootstrapBypassStatus: 'disabled',
          activationRequestId: input.governanceRequestId,
          failureCode: readiness.evaluation.state === 'ready' ? null : 'governance_bootstrap_readiness_blocked',
          updatedAt: now,
        },
      });
      if (Number(activationUpdate?.count || 0) !== 1) {
        throw new Error('governance_bootstrap_runtime_activation_state_drift');
      }
      return freezeResult({ ceremony, event, delivery, readiness, opening, signatureEvidence });
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const existing = await dependencies.prisma.governanceBootstrapCeremony.findUnique({
      where: { id: ceremonyId },
      include: { events: { orderBy: { sequence: 'asc' } }, deliveries: { orderBy: { attempt: 'asc' } } },
    });
    const exact = exactExisting(existing, desired);
    return freezeResult({ ...exact, readiness, opening, signatureEvidence });
  }
}

export async function queueGovernanceBootstrapCeremonyRuntime(
  dependencies: { prisma: any },
  input: {
    ceremonyId: string;
    opening: ReturnType<typeof createGovernanceBootstrapCeremonyOpeningV2>;
    signatureEvidence: ReturnType<typeof verifyGovernanceBootstrapCeremonyOpeningV2Signature>;
    now: Date;
  },
) {
  const now = validDate(input.now);
  const prisma = dependencies.prisma;
  const ceremony = await prisma.governanceBootstrapCeremony.findUnique({
    where: { id: input.ceremonyId },
    include: { deliveries: { orderBy: { attempt: 'asc' } } },
  });
  if (!ceremony || ceremony.deliveries?.length !== 1) {
    throw new Error('governance_bootstrap_runtime_ceremony_not_found');
  }
  if (ceremony.state !== 'prepared' && ceremony.state !== 'waiting') {
    throw new Error('governance_bootstrap_runtime_queue_state_drift');
  }
  const decision = ceremony.governanceRequestId
    ? await prisma.governanceDecision.findUnique({ where: { requestId: ceremony.governanceRequestId } })
    : null;
  const gate = evaluateGovernanceBootstrapQueueEligibility({
    ceremony: {
      id: ceremony.id,
      state: 'prepared',
      homeIdentityBindingId: ceremony.homeIdentityBindingId,
      configurationBundleId: ceremony.configurationBundleId,
      governanceRequestId: ceremony.governanceRequestId,
      confirmationPolicyDigest: ceremony.confirmationPolicyDigest,
      waitingPeriodSeconds: ceremony.waitingPeriodSeconds,
      readinessDigest: ceremony.readinessDigest,
      createdAt: new Date(ceremony.createdAt).toISOString(),
    },
    opening: {
      openingDigest: input.opening.openingDigest,
      network: input.opening.opening.network,
      homeIdentityBindingId: input.opening.opening.homeIdentityBindingId,
      configurationBundleId: input.opening.opening.configurationBundleId,
      confirmationPolicyDigest: input.opening.opening.confirmationPolicyDigest,
      foundingMemberConfirmation: input.opening.opening.foundingMemberConfirmation,
    },
    signatureEvidence: input.signatureEvidence,
    decision: decision ? {
      requestId: decision.requestId,
      decision: decision.decision,
      reason: decision.reason,
      tally: decision.tally,
      decidedAt: new Date(decision.decidedAt).toISOString(),
      executableFrom: decision.executableFrom ? new Date(decision.executableFrom).toISOString() : null,
      executableUntil: decision.executableUntil ? new Date(decision.executableUntil).toISOString() : null,
      decisionDigest: decision.decisionDigest,
    } : null,
    now: now.toISOString(),
  });
  if (gate.gate.status !== 'eligible') return Object.freeze({ queued: false, gate });
  const delivery = ceremony.deliveries[0];
  const eventFacts = {
    schemaVersion: 1,
    ceremonyId: ceremony.id,
    homeIdentityBindingId: ceremony.homeIdentityBindingId,
    sequence: 2,
    eventType: 'delivery_queued',
    status: 'queued',
    operationKey: delivery.operationKey,
    attempt: delivery.attempt,
    gateDigest: gate.gateDigest,
    occurredAt: now.toISOString(),
  };
  const eventDigest = hashCanonicalGovernanceValue(OPEN_EVENT_DOMAIN, eventFacts);
  return prisma.$transaction(async (tx: any) => {
    const current = await tx.governanceBootstrapCeremony.findUnique({ where: { id: ceremony.id } });
    const currentDelivery = await tx.governanceBootstrapDelivery.findUnique({ where: { id: delivery.id } });
    if (current?.state === 'waiting' && currentDelivery?.status === 'queued') {
      const existingEvent = await tx.governanceBootstrapCeremonyEvent.findUnique({
        where: { ceremonyId_sequence: { ceremonyId: ceremony.id, sequence: 2 } },
      });
      if (!existingEvent || existingEvent.eventDigest !== eventDigest
        || currentDelivery.availableAt?.toISOString?.() !== gate.gate.availableAt) {
        throw new Error('governance_bootstrap_runtime_queue_immutable_mismatch');
      }
      return Object.freeze({ queued: true, gate, ceremony: current, delivery: currentDelivery, event: existingEvent });
    }
    if (current?.state !== 'prepared' || currentDelivery?.status !== 'blocked') {
      throw new Error('governance_bootstrap_runtime_queue_state_drift');
    }
    const ceremonyUpdate = await tx.governanceBootstrapCeremony.updateMany({
      where: { id: ceremony.id, state: 'prepared', stateVersion: ceremony.stateVersion },
      data: { state: 'waiting', stateVersion: ceremony.stateVersion + 1, failureCode: null, updatedAt: now },
    });
    const deliveryUpdate = await tx.governanceBootstrapDelivery.updateMany({
      where: { id: delivery.id, status: 'blocked', payloadDigest: delivery.payloadDigest },
      data: { status: 'queued', availableAt: new Date(gate.gate.availableAt), errorCode: null, updatedAt: now },
    });
    const activation = await tx.governanceActivationState.findUnique({
      where: { homeIdentityBindingId: ceremony.homeIdentityBindingId },
    });
    const activationUpdate = activation ? await tx.governanceActivationState.updateMany({
      where: {
        id: activation.id, homeIdentityBindingId: ceremony.homeIdentityBindingId,
        state: activation.state, bootstrapCeremonyId: ceremony.id,
      },
      data: { activationDecisionDigest: gate.gate.decisionDigest, updatedAt: now },
    }) : { count: 0 };
    if (Number(ceremonyUpdate?.count || 0) !== 1 || Number(deliveryUpdate?.count || 0) !== 1
      || Number(activationUpdate?.count || 0) !== 1) {
      const [convergedCeremony, convergedDelivery, convergedEvent] = await Promise.all([
        tx.governanceBootstrapCeremony.findUnique({ where: { id: ceremony.id } }),
        tx.governanceBootstrapDelivery.findUnique({ where: { id: delivery.id } }),
        tx.governanceBootstrapCeremonyEvent.findUnique({
          where: { ceremonyId_sequence: { ceremonyId: ceremony.id, sequence: 2 } },
        }),
      ]);
      if (convergedCeremony?.state === 'waiting' && convergedDelivery?.status === 'queued'
        && convergedEvent?.eventDigest === eventDigest
        && convergedDelivery.availableAt?.toISOString?.() === gate.gate.availableAt) {
        return Object.freeze({ queued: true, gate, ceremony: convergedCeremony, delivery: convergedDelivery, event: convergedEvent });
      }
      throw new Error('governance_bootstrap_runtime_queue_cas_failed');
    }
    const event = await tx.governanceBootstrapCeremonyEvent.create({ data: {
      id: `${ceremony.id}:event:2`, ceremonyId: ceremony.id,
      homeIdentityBindingId: ceremony.homeIdentityBindingId, sequence: 2,
      eventType: 'delivery_queued', status: 'queued', schemaVersion: 1,
      operationKey: null, attempt: null,
      evidenceRefs: [input.signatureEvidence.signatureEvidenceRef], evidenceDigest: gate.gateDigest,
      providerRef: null, providerVersionRef: null,
      transactionIntentDigest: delivery.payloadDigest, transactionSignature: null,
      readbackRef: null, readbackDigest: null, observedAuthorityRef: null,
      observedAuthorityDigest: null, eventDigest, occurredAt: now, createdAt: now,
    } });
    const [updatedCeremony, updatedDelivery] = await Promise.all([
      tx.governanceBootstrapCeremony.findUnique({ where: { id: ceremony.id } }),
      tx.governanceBootstrapDelivery.findUnique({ where: { id: delivery.id } }),
    ]);
    return Object.freeze({ queued: true, gate, ceremony: updatedCeremony, delivery: updatedDelivery, event });
  });
}

export async function submitGovernanceBootstrapDeliveryRuntime(
  dependencies: { prisma: any; adapter: GovernanceBootstrapLocalnetAdapter },
  input: { ceremonyId: string; leaseOwner: string; leaseToken: string; now: Date },
) {
  if (dependencies.adapter.network !== 'solana:localnet'
    && dependencies.adapter.network !== 'solana:devnet') {
    throw new Error('governance_bootstrap_runtime_network_not_enabled');
  }
  const now = validDate(input.now);
  const leaseOwner = canonicalText(input.leaseOwner, 'governance_bootstrap_runtime_lease_owner_required');
  const leaseToken = canonicalText(input.leaseToken, 'governance_bootstrap_runtime_lease_token_required');
  const leaseUntil = new Date(now.getTime() + 60_000);
  const claimed = await dependencies.prisma.$transaction(async (tx: any) => {
    const ceremony = await tx.governanceBootstrapCeremony.findUnique({
      where: { id: input.ceremonyId }, include: { deliveries: { orderBy: { attempt: 'asc' } } },
    });
    if (!ceremony || ceremony.deliveries?.length !== 1) throw new Error('governance_bootstrap_runtime_ceremony_not_found');
    if (ceremony.signatureNetwork !== dependencies.adapter.network) {
      throw new Error('governance_bootstrap_runtime_adapter_network_mismatch');
    }
    const delivery = ceremony.deliveries[0];
    if (['claimed', 'submitted', 'ambiguous', 'confirmed'].includes(delivery.status)) {
      return { ceremony, delivery, alreadyClaimed: true };
    }
    if (ceremony.state !== 'waiting' || delivery.status !== 'queued'
      || !delivery.availableAt || new Date(delivery.availableAt).getTime() > now.getTime()) {
      throw new Error('governance_bootstrap_runtime_delivery_not_claimable');
    }
    const ceremonyUpdate = await tx.governanceBootstrapCeremony.updateMany({
      where: { id: ceremony.id, state: 'waiting', stateVersion: ceremony.stateVersion },
      data: {
        state: 'executing', stateVersion: ceremony.stateVersion + 1,
        firstExternalEffectAt: ceremony.firstExternalEffectAt ?? now, updatedAt: now,
      },
    });
    const deliveryUpdate = await tx.governanceBootstrapDelivery.updateMany({
      where: { id: delivery.id, status: 'queued', payloadDigest: delivery.payloadDigest },
      data: { status: 'claimed', leaseOwner, leaseToken, leaseUntil, updatedAt: now },
    });
    if (Number(ceremonyUpdate?.count || 0) !== 1 || Number(deliveryUpdate?.count || 0) !== 1) {
      throw new Error('governance_bootstrap_runtime_delivery_claim_cas_failed');
    }
    const [updatedCeremony, updatedDelivery] = await Promise.all([
      tx.governanceBootstrapCeremony.findUnique({ where: { id: ceremony.id } }),
      tx.governanceBootstrapDelivery.findUnique({ where: { id: delivery.id } }),
    ]);
    return { ceremony: updatedCeremony, delivery: updatedDelivery, alreadyClaimed: false };
  });
  if (claimed.alreadyClaimed) {
    return Object.freeze({ submitted: false, reason: 'existing_attempt_requires_readback', ...claimed });
  }
  const outcome = await dependencies.adapter.submit({
    ceremonyId: claimed.ceremony.id,
    homeIdentityBindingId: claimed.ceremony.homeIdentityBindingId,
    operationKey: claimed.delivery.operationKey,
    idempotencyKey: claimed.delivery.idempotencyKey,
    payloadDigest: claimed.delivery.payloadDigest,
  });
  validateSubmissionOutcome(outcome);
  const occurredAt = now;
  const eventFacts = {
    schemaVersion: 1, ceremonyId: claimed.ceremony.id,
    homeIdentityBindingId: claimed.ceremony.homeIdentityBindingId,
    sequence: 3, eventType: 'delivery_submission_recorded', status: outcome.status,
    operationKey: claimed.delivery.operationKey, attempt: claimed.delivery.attempt,
    providerRef: outcome.providerRef, providerVersionRef: outcome.providerVersionRef,
    externalRef: outcome.externalRef, transactionSignature: outcome.transactionSignature,
    payloadDigest: claimed.delivery.payloadDigest, occurredAt: occurredAt.toISOString(),
  };
  const eventDigest = hashCanonicalGovernanceValue(EXECUTION_EVENT_DOMAIN, eventFacts);
  return dependencies.prisma.$transaction(async (tx: any) => {
    const delivery = await tx.governanceBootstrapDelivery.findUnique({ where: { id: claimed.delivery.id } });
    if (delivery?.status !== 'claimed' || delivery.leaseToken !== leaseToken || delivery.leaseOwner !== leaseOwner) {
      throw new Error('governance_bootstrap_runtime_delivery_lease_lost');
    }
    const deliveryUpdate = await tx.governanceBootstrapDelivery.updateMany({
      where: { id: delivery.id, status: 'claimed', leaseToken, leaseOwner },
      data: {
        status: outcome.status, providerRef: outcome.providerRef,
        providerVersionRef: outcome.providerVersionRef, externalRef: outcome.externalRef,
        transactionSignature: outcome.transactionSignature, errorCode: outcome.errorCode,
        submittedAt: outcome.status === 'submitted' || outcome.status === 'ambiguous' ? occurredAt : null,
        leaseOwner: null, leaseToken: null, leaseUntil: null, updatedAt: occurredAt,
      },
    });
    const nextCeremonyState = outcome.status === 'submitted' ? 'verifying' : 'recovery_required';
    const ceremonyUpdate = await tx.governanceBootstrapCeremony.updateMany({
      where: { id: claimed.ceremony.id, state: 'executing' },
      data: {
        state: nextCeremonyState, stateVersion: claimed.ceremony.stateVersion + 1,
        failureCode: outcome.status === 'submitted' ? null : outcome.errorCode ?? `bootstrap_delivery_${outcome.status}`,
        updatedAt: occurredAt,
      },
    });
    if (Number(deliveryUpdate?.count || 0) !== 1 || Number(ceremonyUpdate?.count || 0) !== 1) {
      throw new Error('governance_bootstrap_runtime_submission_cas_failed');
    }
    const event = await tx.governanceBootstrapCeremonyEvent.create({ data: {
      id: `${claimed.ceremony.id}:event:3`, ceremonyId: claimed.ceremony.id,
      homeIdentityBindingId: claimed.ceremony.homeIdentityBindingId, sequence: 3,
      eventType: 'delivery_submission_recorded', status: outcome.status, schemaVersion: 1,
      operationKey: claimed.delivery.operationKey, attempt: claimed.delivery.attempt,
      evidenceRefs: outcome.externalRef ? [outcome.externalRef] : [], evidenceDigest: eventDigest,
      providerRef: outcome.providerRef, providerVersionRef: outcome.providerVersionRef,
      transactionIntentDigest: claimed.delivery.payloadDigest,
      transactionSignature: outcome.transactionSignature, readbackRef: null, readbackDigest: null,
      observedAuthorityRef: null, observedAuthorityDigest: null,
      eventDigest, occurredAt, createdAt: occurredAt,
    } });
    const [persistedCeremony, persistedDelivery] = await Promise.all([
      tx.governanceBootstrapCeremony.findUnique({ where: { id: claimed.ceremony.id } }),
      tx.governanceBootstrapDelivery.findUnique({ where: { id: claimed.delivery.id } }),
    ]);
    return Object.freeze({ submitted: outcome.status === 'submitted', outcome, ceremony: persistedCeremony, delivery: persistedDelivery, event });
  });
}

export async function verifyAndActivateGovernanceBootstrapRuntime(
  dependencies: { prisma: any; adapter: GovernanceBootstrapLocalnetAdapter },
  input: { ceremonyId: string; now: Date },
) {
  if (dependencies.adapter.network !== 'solana:localnet'
    && dependencies.adapter.network !== 'solana:devnet') {
    throw new Error('governance_bootstrap_runtime_network_not_enabled');
  }
  const now = validDate(input.now);
  const ceremony = await dependencies.prisma.governanceBootstrapCeremony.findUnique({
    where: { id: input.ceremonyId }, include: { deliveries: { orderBy: { attempt: 'asc' } } },
  });
  if (!ceremony || ceremony.deliveries?.length !== 1) throw new Error('governance_bootstrap_runtime_ceremony_not_found');
  if (ceremony.signatureNetwork !== dependencies.adapter.network) {
    throw new Error('governance_bootstrap_runtime_adapter_network_mismatch');
  }
  const delivery = ceremony.deliveries[0];
  if (ceremony.state === 'active' && delivery.status === 'confirmed') {
    const identity = await dependencies.prisma.governanceHomeIdentityBinding.findUnique({
      where: { id: ceremony.homeIdentityBindingId },
    });
    const circleId = requireCircleHomeRef(identity);
    const authorityBindingId = bootstrapSelfGovernedCircleBindingId(circleId);
    const [activation, event, profileBinding, authorityBinding, authorityPolicy, authorityPolicyVersion] = await Promise.all([
      dependencies.prisma.governanceActivationState.findUnique({
        where: { homeIdentityBindingId: ceremony.homeIdentityBindingId },
      }),
      dependencies.prisma.governanceBootstrapCeremonyEvent.findUnique({
        where: { ceremonyId_sequence: { ceremonyId: ceremony.id, sequence: 4 } },
      }),
      dependencies.prisma.governanceProfileBinding.findUnique({
        where: { id: governanceBootstrapProfileBindingId(ceremony.homeIdentityBindingId) },
        include: { definitionVersion: true },
      }),
      dependencies.prisma.circleGovernanceBinding.findUnique({
        where: { id: authorityBindingId },
      }),
      dependencies.prisma.governancePolicy.findUnique({
        where: { id: `${authorityBindingId}:policy` },
      }),
      dependencies.prisma.governancePolicyVersion.findUnique({
        where: { id: `${authorityBindingId}:policy:v1` },
      }),
    ]);
    if (!activation || activation.state !== 'active' || !event || event.status !== 'confirmed'
      || profileBinding?.state !== 'active'
      || profileBinding.definitionVersion?.versionRef !== CIRCLE_GOVERNANCE_PROFILE_V1.versionRef
      || !isActiveBootstrapSelfGovernedBinding({
        authorityBinding,
        authorityPolicy,
        authorityPolicyVersion,
        circleId,
        ceremony,
      })) {
      throw new Error('governance_bootstrap_runtime_active_receipt_missing');
    }
    return Object.freeze({ activated: true, ceremony, delivery, activation, event, readback: null });
  }
  if (!['executing', 'verifying', 'recovery_required'].includes(ceremony.state)
    || !['claimed', 'submitted', 'ambiguous'].includes(delivery.status)) {
    throw new Error('governance_bootstrap_runtime_readback_not_available');
  }
  const readback = await dependencies.adapter.readback({
    ceremonyId: ceremony.id, homeIdentityBindingId: ceremony.homeIdentityBindingId,
    operationKey: delivery.operationKey, idempotencyKey: delivery.idempotencyKey,
    payloadDigest: delivery.payloadDigest, externalRef: delivery.externalRef,
    transactionSignature: delivery.transactionSignature,
  });
  validateReadback(readback);
  const readbackFacts = {
    schemaVersion: 1, ceremonyId: ceremony.id,
    homeIdentityBindingId: ceremony.homeIdentityBindingId,
    operationKey: delivery.operationKey, payloadDigest: delivery.payloadDigest,
    ...readback,
  };
  const readbackDigest = hashCanonicalGovernanceValue(ACTIVATION_READBACK_DOMAIN, readbackFacts);
  const safe = readback.status === 'confirmed' && readback.policyReadyForActivation
    && readback.bootstrapAuthorityRevoked && readback.emergencyAuthorityIndependent
    && readback.recoveryAuthorityIndependent && readback.supportAuthorityIndependent
    && readback.effectiveAt !== null;
  const effectiveAt = safe ? new Date(readback.effectiveAt!) : null;
  if (effectiveAt && !Number.isFinite(effectiveAt.getTime())) throw new Error('governance_bootstrap_runtime_effective_at_invalid');
  const eventFacts = {
    schemaVersion: 1, ceremonyId: ceremony.id, homeIdentityBindingId: ceremony.homeIdentityBindingId,
    sequence: 4, eventType: safe ? 'activation_verified' : 'activation_readback_blocked',
    status: safe ? 'confirmed' : readback.status, operationKey: delivery.operationKey,
    attempt: delivery.attempt, readbackDigest, occurredAt: now.toISOString(),
  };
  const eventDigest = hashCanonicalGovernanceValue(EXECUTION_EVENT_DOMAIN, eventFacts);
  return dependencies.prisma.$transaction(async (tx: any) => {
    if (typeof tx.$executeRawUnsafe !== 'function') {
      throw new Error('governance_bootstrap_runtime_stage_lock_required');
    }
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `governance-home-stage:${ceremony.homeIdentityBindingId}`,
    );
    const [activation, currentCeremony, currentDelivery, profileBinding,
      activeProfileBinding, identity, configurationBundle] = await Promise.all([
      tx.governanceActivationState.findUnique({
        where: { homeIdentityBindingId: ceremony.homeIdentityBindingId },
      }),
      tx.governanceBootstrapCeremony.findUnique({ where: { id: ceremony.id } }),
      tx.governanceBootstrapDelivery.findUnique({ where: { id: delivery.id } }),
      tx.governanceProfileBinding.findUnique({
        where: { id: governanceBootstrapProfileBindingId(ceremony.homeIdentityBindingId) },
        include: { definitionVersion: true },
      }),
      tx.governanceProfileBinding.findFirst({
        where: { homeIdentityBindingId: ceremony.homeIdentityBindingId, state: 'active' },
      }),
      tx.governanceHomeIdentityBinding.findUnique({
        where: { id: ceremony.homeIdentityBindingId },
      }),
      tx.governanceConfigurationBundle.findUnique({
        where: { id: ceremony.configurationBundleId },
      }),
    ]);
    if (!activation || !currentCeremony || !currentDelivery || !identity || !configurationBundle) {
      throw new Error('governance_bootstrap_runtime_activation_state_missing');
    }
    const circleId = requireCircleHomeRef(identity);
    const canonicalBundle = canonicalStoredBootstrapBundle(configurationBundle);
    if (canonicalBundle.digest !== ceremony.configurationBundleDigest
      || configurationBundle.homeIdentityBindingId !== ceremony.homeIdentityBindingId) {
      throw new Error('governance_bootstrap_runtime_configuration_bundle_mismatch');
    }
    if (safe && (!profileBinding || profileBinding.state !== 'draft'
      || profileBinding.compatibilityStatus !== 'ready'
      || profileBinding.definitionVersion?.versionRef !== CIRCLE_GOVERNANCE_PROFILE_V1.versionRef
      || activeProfileBinding)) {
      throw new Error('governance_bootstrap_runtime_profile_binding_not_activatable');
    }
    const nextState = safe ? 'active' : 'recovery_required';
    const failureCode = safe ? null : readback.errorCode ?? `bootstrap_readback_${readback.status}`;
    const ceremonyUpdate = await tx.governanceBootstrapCeremony.updateMany({
      where: { id: ceremony.id, state: currentCeremony.state, stateVersion: currentCeremony.stateVersion },
      data: {
        state: nextState, stateVersion: currentCeremony.stateVersion + 1,
        effectiveAt, failureCode, updatedAt: now,
      },
    });
    const deliveryUpdate = await tx.governanceBootstrapDelivery.updateMany({
      where: { id: delivery.id, status: currentDelivery.status, payloadDigest: delivery.payloadDigest },
      data: {
        status: safe ? 'confirmed' : currentDelivery.status,
        confirmedAt: safe ? now : null, errorCode: failureCode, updatedAt: now,
      },
    });
    const activationUpdate = await tx.governanceActivationState.updateMany({
      where: { id: activation.id, homeIdentityBindingId: ceremony.homeIdentityBindingId, state: activation.state, bootstrapCeremonyId: ceremony.id },
      data: {
        state: nextState, bootstrapBypassStatus: 'disabled', bootstrapBypassExpiresAt: null,
        activationReceiptId: `${ceremony.id}:event:4`,
        lastVerifiedAt: now, activatedAt: safe ? effectiveAt : null,
        failureCode, updatedAt: now,
      },
    });
    const identityUpdate = await tx.governanceHomeIdentityBinding.updateMany({
      where: { id: ceremony.homeIdentityBindingId, status: 'inactive' },
      data: safe ? { status: 'active', effectiveFrom: effectiveAt, updatedAt: now } : { updatedAt: now },
    });
    const profileBindingUpdate = safe
      ? await tx.governanceProfileBinding.updateMany({
        where: { id: profileBinding.id, state: 'draft', stateVersion: profileBinding.stateVersion },
        data: {
          state: 'active', stateVersion: profileBinding.stateVersion + 1,
          activatedAt: effectiveAt, updatedAt: now,
        },
      })
      : { count: 0 };
    const authorityBinding = safe
      ? await createBootstrapSelfGovernedCircleBindingInTransaction(tx, {
        circleId,
        actorPubkey: ceremony.actorPubkey,
        ceremonyId: ceremony.id,
        configurationBundleId: ceremony.configurationBundleId,
        configurationBundleDigest: ceremony.configurationBundleDigest,
        initialAuthorityPolicy: canonicalBundle.bundle.initialAuthorityPolicy,
        activatedAt: effectiveAt!,
        sourceRequestId: ceremony.governanceRequestId,
      })
      : null;
    if (Number(ceremonyUpdate?.count || 0) !== 1 || Number(deliveryUpdate?.count || 0) !== 1
      || Number(activationUpdate?.count || 0) !== 1
      || (safe && (Number(identityUpdate?.count || 0) !== 1
        || Number(profileBindingUpdate?.count || 0) !== 1))) {
      throw new Error('governance_bootstrap_runtime_activation_cas_failed');
    }
    const event = await tx.governanceBootstrapCeremonyEvent.create({ data: {
      id: `${ceremony.id}:event:4`, ceremonyId: ceremony.id,
      homeIdentityBindingId: ceremony.homeIdentityBindingId, sequence: 4,
      eventType: safe ? 'activation_verified' : 'activation_readback_blocked',
      status: safe ? 'confirmed' : readback.status, schemaVersion: 1,
      operationKey: null, attempt: null,
      evidenceRefs: [readback.readbackRef], evidenceDigest: readbackDigest,
      providerRef: delivery.providerRef, providerVersionRef: delivery.providerVersionRef,
      transactionIntentDigest: delivery.payloadDigest, transactionSignature: delivery.transactionSignature,
      readbackRef: readback.readbackRef, readbackDigest,
      observedAuthorityRef: readback.observedAuthorityRef,
      observedAuthorityDigest: readback.stateDigest, eventDigest, occurredAt: now, createdAt: now,
    } });
    const [persistedCeremony, persistedDelivery, persistedActivation, persistedIdentity] = await Promise.all([
      tx.governanceBootstrapCeremony.findUnique({ where: { id: ceremony.id } }),
      tx.governanceBootstrapDelivery.findUnique({ where: { id: delivery.id } }),
      tx.governanceActivationState.findUnique({
        where: { homeIdentityBindingId: ceremony.homeIdentityBindingId },
      }),
      tx.governanceHomeIdentityBinding.findUnique({ where: { id: ceremony.homeIdentityBindingId } }),
    ]);
    return Object.freeze({
      activated: safe,
      readback,
      readbackDigest,
      event,
      ceremony: persistedCeremony,
      delivery: persistedDelivery,
      activation: persistedActivation,
      identity: persistedIdentity,
      authorityBinding,
    });
  });
}

function assertOpenSources(identity: any, activation: any, bundle: any, desired: any) {
  if (!identity || identity.status !== 'inactive') throw new Error('governance_bootstrap_runtime_inactive_home_required');
  if (!activation || !['bootstrap_pending', 'disabled'].includes(String(activation.state))
    || activation.bootstrapCeremonyId !== null) {
    throw new Error('governance_bootstrap_runtime_activation_not_openable');
  }
  if (!bundle || bundle.id !== desired.ceremony.configurationBundleId
    || bundle.homeIdentityBindingId !== desired.ceremony.homeIdentityBindingId
    || bundle.bundleDigest !== desired.ceremony.configurationBundleDigest) {
    throw new Error('governance_bootstrap_runtime_configuration_bundle_mismatch');
  }
}

function canonicalStoredBootstrapBundle(record: any) {
  const stored = record?.bundle;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('governance_bootstrap_runtime_configuration_bundle_mismatch');
  }
  const {
    schemaVersion: _schemaVersion,
    canonicalCodecVersion: _canonicalCodecVersion,
    ...input
  } = stored;
  const canonical = createGovernanceBootstrapBundle(input as GovernanceBootstrapBundleInput);
  if (record.schemaVersion !== canonical.bundle.schemaVersion
    || record.canonicalCodecVersion !== canonical.bundle.canonicalCodecVersion
    || record.bundleDigest !== canonical.digest
    || !isDeepStrictEqual(stored, canonical.bundle)) {
    throw new Error('governance_bootstrap_runtime_configuration_bundle_mismatch');
  }
  return canonical;
}

function requireCircleHomeRef(identity: any): number {
  const circleId = Number(identity?.homeRef);
  if (identity?.homeType !== 'circle'
    || !Number.isSafeInteger(circleId)
    || circleId < 1
    || String(circleId) !== identity.homeRef) {
    throw new Error('governance_bootstrap_runtime_circle_home_mismatch');
  }
  return circleId;
}

function isActiveBootstrapSelfGovernedBinding(input: {
  authorityBinding: any;
  authorityPolicy: any;
  authorityPolicyVersion: any;
  circleId: number;
  ceremony: any;
}): boolean {
  const contract = createBootstrapSelfGovernedPolicyContract();
  const bindingId = bootstrapSelfGovernedCircleBindingId(input.circleId);
  const metadata = input.authorityBinding?.metadata;
  return input.authorityBinding?.id === bindingId
    && input.authorityBinding.bindingType === 'self_governed'
    && input.authorityBinding.targetCircleId === input.circleId
    && input.authorityBinding.committeeCircleId === input.circleId
    && input.authorityBinding.actionType === null
    && input.authorityBinding.actionPrefix === contract.actionPrefix
    && input.authorityBinding.status === 'active'
    && input.authorityBinding.targetAuthorizationStatus === 'accepted'
    && input.authorityBinding.committeeMandateStatus === 'accepted'
    && input.authorityBinding.policyId === `${bindingId}:policy`
    && input.authorityBinding.policyVersionId === `${bindingId}:policy:v1`
    && input.authorityBinding.policyVersion === 1
    && metadata?.bootstrapCeremonyId === input.ceremony.id
    && metadata?.configurationBundleId === input.ceremony.configurationBundleId
    && metadata?.configurationBundleDigest === input.ceremony.configurationBundleDigest
    && metadata?.initialAuthorityPolicyRef === contract.reference.ref
    && metadata?.initialAuthorityPolicyVersion === contract.reference.version
    && metadata?.initialAuthorityPolicyDigest === contract.reference.digest
    && metadata?.ownerOperatorFallback === 'none'
    && input.authorityPolicy?.id === `${bindingId}:policy`
    && input.authorityPolicy.status === 'active'
    && input.authorityPolicy.activeVersion === 1
    && input.authorityPolicy.scopeType === 'circle_governance_committee'
    && input.authorityPolicy.scopeRef === String(input.circleId)
    && input.authorityPolicyVersion?.id === `${bindingId}:policy:v1`
    && input.authorityPolicyVersion.status === 'active'
    && input.authorityPolicyVersion.policyId === input.authorityPolicy.id
    && input.authorityPolicyVersion.version === 1
    && isDeepStrictEqual(input.authorityPolicyVersion.rules, contract.rules);
}

function exactExisting(existing: any, desired: any) {
  if (!existing || existing.events?.length !== 1 || existing.deliveries?.length !== 1) {
    throw new Error('governance_bootstrap_runtime_existing_partial');
  }
  const ceremony = pick(existing, Object.keys(desired.ceremony));
  const event = pick(existing.events[0], Object.keys(desired.event));
  const delivery = pick(existing.deliveries[0], Object.keys(desired.delivery));
  if (!isDeepStrictEqual(ceremony, desired.ceremony)
    || !isDeepStrictEqual(event, desired.event)
    || !isDeepStrictEqual(delivery, desired.delivery)) {
    throw new Error('governance_bootstrap_runtime_immutable_mismatch');
  }
  return { ceremony, event, delivery };
}

function pick(value: any, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function readinessEvidenceRefs(checks: GovernanceBootstrapReadinessChecks) {
  return Object.values(checks).flatMap((fact) => fact.evidenceRef ? [fact.evidenceRef] : []).sort();
}

function assertIndependentAuthorityBoundaries(
  emergencyPolicyRef: string,
  checks: GovernanceBootstrapReadinessChecks,
  bootstrapActorPubkey: string,
) {
  const recoveryPolicyRef = checks.recoveryContact.evidenceRef;
  const supportPolicyRef = checks.publicSafeBoundary.evidenceRef;
  if (!recoveryPolicyRef?.startsWith('recovery-policy:')
    || !supportPolicyRef?.startsWith('platform-support-policy:')) {
    throw new Error('governance_bootstrap_runtime_independent_authority_policy_required');
  }
  const refs = [emergencyPolicyRef, recoveryPolicyRef, supportPolicyRef];
  if (new Set(refs).size !== refs.length || refs.includes(bootstrapActorPubkey)) {
    throw new Error('governance_bootstrap_runtime_authority_policy_not_independent');
  }
}

async function assertFoundingConfirmationRequest(
  prisma: any,
  confirmation: GovernanceBootstrapCeremonyOpeningV2Input['confirmationPolicy'],
  governanceRequestId: string | null,
  actorPubkey: string,
  ceremonyId: string,
) {
  if (confirmation.policy.foundingMemberConfirmation === 'not_required') {
    if (governanceRequestId !== null || confirmation.requestFacts !== null
      || confirmation.snapshotFacts !== null) {
      throw new Error('governance_bootstrap_runtime_unexpected_confirmation_request');
    }
    return;
  }
  if (!governanceRequestId || !confirmation.requestFacts || !confirmation.snapshotFacts) {
    throw new Error('governance_bootstrap_runtime_confirmation_request_required');
  }
  const request = await prisma.governanceRequest.findUnique({
    where: { id: governanceRequestId },
    include: { snapshot: true, policy: true, policyVersionRecord: true },
  });
  const expected = confirmation.requestFacts;
  const foundingPolicy = confirmation.policy.foundingMemberPolicy;
  const policyId = `bootstrap-confirmation-policy:${confirmation.digest.slice(0, 32)}`;
  const policyVersionId = `${policyId}:v1`;
  const idempotencyKey = `bootstrap-founding:${expected.action.targetRef}`;
  const expectedSnapshotDigest = computeGovernanceSnapshotDigest({
    requestId: governanceRequestId,
    eligibleActors: expected.eligibleActors,
    action: { ...expected.action, idempotencyKey },
    scope: expected.scope,
  });
  const expectedRules = foundingPolicy ? {
    rules: [{
      id: 'bootstrap:founding_confirmation',
      strategy: 'committee.member_threshold',
      threshold: foundingPolicy.threshold,
      ballotDisclosure: { mode: 'member' },
    }],
  } : null;
  if (!request || !['active', 'accepted'].includes(request.state)
    || !foundingPolicy
    || request.policyId !== policyId
    || request.policyVersionId !== policyVersionId
    || request.policyVersion !== 1
    || request.ruleId !== 'bootstrap:founding_confirmation'
    || request.proposerPubkey !== actorPubkey
    || request.homeIdentityBindingId !== expected.scope.ref
    || request.scopeType !== expected.scope.type
    || request.scopeRef !== expected.scope.ref
    || request.actionType !== expected.action.type
    || request.targetType !== expected.action.targetType
    || request.targetRef !== expected.action.targetRef
    || !isDeepStrictEqual(request.payload, expected.action.payload)
    || request.idempotencyKey !== idempotencyKey
    || !request.snapshot
    || request.snapshot.sourceDigest !== expectedSnapshotDigest
    || !isDeepStrictEqual(request.snapshot.eligibleActors, confirmation.snapshotFacts.eligibleActors)
    || new Date(request.snapshot.createdAt).toISOString() !== confirmation.snapshotFacts.createdAt
    || request.policy?.scopeType !== 'governance_home'
    || request.policy?.scopeRef !== expected.scope.ref
    || request.policy?.status !== 'draft'
    || request.policy?.activeVersion !== null
    || !isDeepStrictEqual(request.policy?.metadata, {
      bootstrapOnly: true,
      ceremonyId,
      configurationBundleId: expected.action.targetRef,
      configurationBundleDigest: expected.action.payload.configurationBundleDigest,
      confirmationPolicyDigest: confirmation.digest,
      grantsActivePolicyAuthority: false,
    })
    || request.policyVersionRecord?.status !== 'draft'
    || request.policyVersionRecord?.configDigest !== confirmation.digest
    || !isDeepStrictEqual(request.policyVersionRecord?.rules, expectedRules)) {
    throw new Error('governance_bootstrap_runtime_confirmation_request_mismatch');
  }
}

function freezeResult(value: any) {
  return Object.freeze(value);
}

function validDate(value: unknown) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('governance_bootstrap_runtime_time_invalid');
  }
  return value;
}

function canonicalText(value: unknown, code: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized !== value) throw new Error(code);
  return normalized;
}

function validateSubmissionOutcome(outcome: any) {
  if (!outcome || !['submitted', 'ambiguous', 'failed'].includes(outcome.status)
    || !canonicalText(outcome.providerRef, 'governance_bootstrap_runtime_provider_ref_required')
    || !canonicalText(outcome.providerVersionRef, 'governance_bootstrap_runtime_provider_version_required')) {
    throw new Error('governance_bootstrap_runtime_submission_invalid');
  }
  if (outcome.status === 'submitted' && !outcome.externalRef && !outcome.transactionSignature) {
    throw new Error('governance_bootstrap_runtime_submission_evidence_required');
  }
}

function validateReadback(readback: any) {
  if (!readback || !['confirmed', 'pending', 'mismatch', 'unavailable'].includes(readback.status)
    || !canonicalText(readback.readbackRef, 'governance_bootstrap_runtime_readback_ref_required')
    || !canonicalText(readback.observedAuthorityRef, 'governance_bootstrap_runtime_observed_authority_required')
    || !/^[a-f0-9]{64}$/.test(String(readback.stateDigest ?? ''))) {
    throw new Error('governance_bootstrap_runtime_readback_invalid');
  }
}

function isUniqueConflict(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && String((error as any).code) === 'P2002';
}
