import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildNativeDecisionOutputArtifact,
  decisionOutputArtifactMatches,
} from './decisionOutputArtifact';
import { createGovernanceCaseIntake } from './governanceCase';
import { GOVERNANCE_GRANT_AGREEMENT_AMEND_ACTION_TYPE } from './actionRegistry';
import {
  governanceGrantLifecycleDigest,
  GovernanceGrantAgreementError,
  projectGovernanceGrantAgreement,
  refreshGovernanceGrantSettlementReadiness,
  type GovernanceGrantLifecycle,
} from './governanceGrantAgreement';

export type GovernanceGrantMilestoneReviewOutcome = 'accept' | 'rework' | 'reject';
export type GovernanceGrantAppealVote = 'uphold' | 'overturn_accept';
export type GovernanceGrantTerminationGround =
  | 'milestone_rejected'
  | 'schedule_expired'
  | 'governing_decision_revoked';
export type GovernanceGrantOutcomeStatus =
  | 'fulfilled'
  | 'partially_fulfilled'
  | 'not_fulfilled'
  | 'terminated';

export async function recordGovernanceGrantPayoutFinality(
  prisma: any,
  input: {
    agreementId: string;
    trancheIntentId: string;
    milestoneResultDigest: string;
    amountUnits: string;
    budgetUnit: string;
    recipientRef: string;
    resourceRef: string;
    payoutRef: string;
    providerStateDigest: string;
    sourceRequestId: string;
    sourceDecisionDigest: string;
    finalizedAt: Date;
  },
  options: { transaction?: any } = {},
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const trancheIntentId = requiredText(
    input.trancheIntentId, 96, 'governance_grant_tranche_intent_required',
  );
  const milestoneResultDigest = requiredDigest(
    input.milestoneResultDigest, 'governance_grant_result_digest_invalid',
  );
  const providerStateDigest = requiredDigest(
    input.providerStateDigest, 'governance_grant_provider_state_digest_invalid',
  );
  const sourceDecisionDigest = requiredDigest(
    input.sourceDecisionDigest, 'governance_grant_payout_decision_digest_invalid',
  );
  const amountUnits = requiredText(input.amountUnits, 32, 'governance_grant_payout_amount_invalid');
  if (!/^[1-9][0-9]*$/.test(amountUnits) || !Number.isFinite(input.finalizedAt.getTime())) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_payout_finality_invalid');
  }
  const expected = {
    milestoneResultDigest,
    amountUnits,
    budgetUnit: requiredText(input.budgetUnit, 32, 'governance_grant_payout_unit_invalid'),
    recipientRef: requiredText(input.recipientRef, 128, 'governance_grant_payout_recipient_invalid'),
    resourceRef: requiredText(input.resourceRef, 160, 'governance_grant_payout_resource_invalid'),
    payoutRef: requiredText(input.payoutRef, 128, 'governance_grant_payout_ref_invalid'),
    providerStateDigest,
    sourceRequestId: requiredText(input.sourceRequestId, 96, 'governance_grant_payout_request_invalid'),
    sourceDecisionDigest,
    providerFinality: 'finalized' as const,
  };
  const persist = async (tx: any) => {
    const agreement = await loadCurrentAgreement(tx, agreementId);
    assertAgreementActive(agreement);
    const lifecycle = cloneLifecycle(agreement.lifecycle);
    const intent = lifecycle.trancheIntents.find((item: any) => item?.id === trancheIntentId);
    if (!intent) throw new GovernanceGrantAgreementError(404, 'governance_grant_tranche_intent_not_found');
    if (intent.status === 'paid') {
      if (Object.entries(expected).some(([key, value]) => intent[key] !== value)) {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_payout_idempotency_conflict');
      }
      return { replayed: true, agreement: projectGovernanceGrantAgreement(agreement) };
    }
    if (
      intent.status !== 'contractual_pending_settlement'
      || intent.milestoneResultDigest !== milestoneResultDigest
      || intent.amountUnits !== amountUnits
      || intent.budgetUnit !== expected.budgetUnit
      || intent.recipientRef !== expected.recipientRef
      || intent.resourceRef !== null
      || intent.payoutRef !== null
      || intent.providerFinality !== null
      || lifecycle.termination !== null
      || openAppealForMilestone(lifecycle, String(intent.milestoneId ?? ''))
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_payout_intent_not_executable');
    const { digest: _previousIntentDigest, ...intentWithoutDigest } = intent;
    const paidFacts = {
      ...intentWithoutDigest,
      ...expected,
      status: 'paid',
      finalizedAt: input.finalizedAt.toISOString(),
    };
    Object.assign(intent, paidFacts, {
      digest: hashCanonicalGovernanceValue(
        'alcheme.governance.grant-tranche-intent-v1',
        paidFacts,
      ),
    });
    const paidUnits = lifecycle.trancheIntents.reduce((sum: bigint, item: any) => (
      item?.status === 'paid' ? sum + BigInt(String(item.amountUnits)) : sum
    ), 0n);
    const totalUnits = BigInt(String(agreement.contractualBudgetUnits));
    const fundingStatus = paidUnits === totalUnits ? 'paid' : 'partially_paid';
    const lifecycleDigest = governanceGrantLifecycleDigest(lifecycle);
    const updated = await tx.governanceGrantAgreement.updateMany({
      where: {
        id: agreement.id,
        lifecycleVersion: agreement.lifecycleVersion,
        lifecycleDigest: agreement.lifecycleDigest,
        fundingStatus: agreement.fundingStatus,
      },
      data: {
        lifecycle,
        lifecycleDigest,
        lifecycleVersion: agreement.lifecycleVersion + 1,
        fundingStatus,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_lifecycle_version_conflict');
    }
    return {
      replayed: false,
      agreement: projectGovernanceGrantAgreement({
        ...agreement,
        lifecycle,
        lifecycleDigest,
        lifecycleVersion: agreement.lifecycleVersion + 1,
        fundingStatus,
      }),
    };
  };
  return options.transaction
    ? persist(options.transaction)
    : prisma.$transaction(persist);
}

export async function recordGovernanceGrantMilestoneReview(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    milestoneId: string;
    outcome: GovernanceGrantMilestoneReviewOutcome;
    evidenceRefs: string[];
    summary: string;
    actorPubkey: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const milestoneId = requiredText(input.milestoneId, 64, 'governance_grant_milestone_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  const summary = requiredText(input.summary, 2000, 'governance_grant_review_summary_required');
  const evidenceRefs = uniqueTexts(input.evidenceRefs, 1, 12, 240, 'governance_grant_review_evidence_invalid');
  if (!isReviewOutcome(input.outcome) || idempotencyKey.length < 8) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_milestone_review_invalid');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const agreement = await loadCurrentAgreement(tx, agreementId);
    assertAgreementCase(agreement, caseId);
    assertAgreementActive(agreement);
    const terms = agreement.terms as any;
    const lifecycle = cloneLifecycle(agreement.lifecycle);
    const replay = lifecycle.reviews.find((item: any) => item.idempotencyKey === idempotencyKey);
    if (replay) {
      if (
        replay.milestoneId !== milestoneId
        || replay.actorPubkey !== actorPubkey
        || replay.outcome !== input.outcome
        || replay.summary !== summary
        || hashCanonicalGovernanceValue('alcheme.governance.grant-review-evidence-v1', replay.evidenceRefs)
          !== hashCanonicalGovernanceValue('alcheme.governance.grant-review-evidence-v1', evidenceRefs)
      ) throw new GovernanceGrantAgreementError(409, 'governance_grant_idempotency_conflict');
      return { replayed: true, agreement: projectGovernanceGrantAgreement(agreement) };
    }
    const milestone = grantMilestone(terms, milestoneId);
    if (!milestone.reviewerAuthority.effectiveReviewerPubkeys.includes(actorPubkey)) {
      throw new GovernanceGrantAgreementError(403, 'governance_grant_reviewer_not_authorized');
    }
    if (openAppealForMilestone(lifecycle, milestoneId)) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_milestone_disputed');
    }
    const revision = nextReviewRevision(lifecycle, milestoneId);
    if (revision > Number(milestone.maxRevisions) + 1) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_milestone_revision_limit_reached');
    }
    if (
      input.outcome === 'rework'
      && revision > Number(milestone.maxRevisions)
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_milestone_revision_limit_reached');
    if (lifecycle.milestoneResults.some((item: any) => (
      item.milestoneId === milestoneId && item.revision === revision
    ))) throw new GovernanceGrantAgreementError(409, 'governance_grant_milestone_already_decided');
    if (lifecycle.reviews.some((item: any) => (
      item.milestoneId === milestoneId
      && item.revision === revision
      && item.actorPubkey === actorPubkey
    ))) throw new GovernanceGrantAgreementError(409, 'governance_grant_reviewer_already_recorded');

    const reviewFacts = {
      id: lifecycleId('review', agreementId, idempotencyKey),
      idempotencyKey,
      milestoneId,
      revision,
      actorPubkey,
      outcome: input.outcome,
      evidenceRefs,
      summary,
      recordedAt: now.toISOString(),
    };
    const review = {
      ...reviewFacts,
      digest: hashCanonicalGovernanceValue('alcheme.governance.grant-milestone-review-v1', reviewFacts),
    };
    lifecycle.reviews.push(review);

    const sameOutcome = lifecycle.reviews.filter((item: any) => (
      item.milestoneId === milestoneId
      && item.revision === revision
      && item.outcome === input.outcome
    ));
    if (sameOutcome.length >= Number(milestone.reviewerAuthority.quorum)) {
      const resultFacts = {
        id: lifecycleId('result', agreementId, `${milestoneId}:${revision}`),
        milestoneId,
        revision,
        outcome: input.outcome,
        reviewIds: sameOutcome.map((item: any) => item.id).sort(),
        reviewerPubkeys: sameOutcome.map((item: any) => item.actorPubkey).sort(),
        decidedAt: now.toISOString(),
      };
      const result = {
        ...resultFacts,
        digest: hashCanonicalGovernanceValue('alcheme.governance.grant-milestone-result-v1', resultFacts),
      };
      lifecycle.milestoneResults.push(result);
      if (input.outcome === 'accept') {
        appendTrancheIntent(lifecycle, agreement, milestone, result, now);
      }
    }
    const updated = await saveLifecycle(tx, agreement, lifecycle);
    return { replayed: false, agreement: projectGovernanceGrantAgreement(updated) };
  });
}

export async function openGovernanceGrantMilestoneAppeal(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    milestoneId: string;
    originalResultDigest: string;
    reason: string;
    evidenceRefs: string[];
    actorPubkey: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const milestoneId = requiredText(input.milestoneId, 64, 'governance_grant_milestone_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  const reason = requiredText(input.reason, 2000, 'governance_grant_appeal_reason_required');
  const evidenceRefs = uniqueTexts(input.evidenceRefs, 0, 12, 240, 'governance_grant_appeal_evidence_invalid');
  const originalResultDigest = requiredDigest(input.originalResultDigest, 'governance_grant_result_digest_invalid');
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const agreement = await loadCurrentAgreement(tx, agreementId);
    assertAgreementCase(agreement, caseId);
    const terms = agreement.terms as any;
    const lifecycle = cloneLifecycle(agreement.lifecycle);
    const replay = lifecycle.appeals.find((item: any) => item.idempotencyKey === idempotencyKey);
    if (replay) {
      if (
        replay.milestoneId !== milestoneId
        || replay.appellantPubkey !== actorPubkey
        || replay.originalResultDigest !== originalResultDigest
        || replay.reason !== reason
        || hashCanonicalGovernanceValue('alcheme.governance.grant-appeal-evidence-v1', replay.evidenceRefs)
          !== hashCanonicalGovernanceValue('alcheme.governance.grant-appeal-evidence-v1', evidenceRefs)
      ) throw new GovernanceGrantAgreementError(409, 'governance_grant_idempotency_conflict');
      return { replayed: true, agreement: projectGovernanceGrantAgreement(agreement) };
    }
    if (!grantRecipientPubkeys(terms, agreement.recipientRef).includes(actorPubkey)) {
      throw new GovernanceGrantAgreementError(403, 'governance_grant_appeal_recipient_required');
    }
    const milestone = grantMilestone(terms, milestoneId);
    const result = lifecycle.milestoneResults.find((item: any) => (
      item.milestoneId === milestoneId && item.digest === originalResultDigest
    ));
    if (!result || !['rework', 'reject'].includes(result.outcome)) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_appealable_result_required');
    }
    if (lifecycle.appeals.some((item: any) => (
      item.milestoneId === milestoneId && item.originalResultDigest === originalResultDigest
    ))) throw new GovernanceGrantAgreementError(409, 'governance_grant_appeal_already_opened');
    const appealDeadline = new Date(new Date(result.decidedAt).getTime() + 72 * 60 * 60 * 1000);
    if (!Number.isFinite(appealDeadline.getTime()) || now.getTime() > appealDeadline.getTime()) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_appeal_deadline_elapsed');
    }
    const reviewerPubkeys = milestone.appealAuthority.reviewerPubkeys as string[];
    if (
      reviewerPubkeys.length < milestone.appealAuthority.quorum
      || reviewerPubkeys.includes(actorPubkey)
      || reviewerPubkeys.some((pubkey) => result.reviewerPubkeys.includes(pubkey))
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_appeal_authority_invalid');
    const appealFacts = {
      id: lifecycleId('appeal', agreementId, idempotencyKey),
      idempotencyKey,
      milestoneId,
      originalResultDigest,
      originalOutcome: result.outcome,
      originalReviewerPubkeys: result.reviewerPubkeys,
      appellantPubkey: actorPubkey,
      reason,
      evidenceRefs,
      openedAt: now.toISOString(),
      deadline: appealDeadline.toISOString(),
      reviewerPubkeys,
      quorum: milestone.appealAuthority.quorum,
      status: 'open',
      votes: [],
      resolution: null,
      settlementAuthorization: 'blocked_disputed',
    };
    lifecycle.appeals.push({
      ...appealFacts,
      digest: hashCanonicalGovernanceValue('alcheme.governance.grant-milestone-appeal-v1', appealFacts),
    });
    const updated = await saveLifecycle(tx, agreement, lifecycle);
    return { replayed: false, agreement: projectGovernanceGrantAgreement(updated) };
  });
}

export async function recordGovernanceGrantMilestoneAppealVote(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    appealId: string;
    vote: GovernanceGrantAppealVote;
    reason: string;
    actorPubkey: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const appealId = requiredText(input.appealId, 96, 'governance_grant_appeal_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  const reason = requiredText(input.reason, 2000, 'governance_grant_appeal_vote_reason_required');
  if (!isAppealVote(input.vote) || idempotencyKey.length < 8) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_appeal_vote_invalid');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const agreement = await loadCurrentAgreement(tx, agreementId);
    assertAgreementCase(agreement, caseId);
    const lifecycle = cloneLifecycle(agreement.lifecycle);
    const appeal = lifecycle.appeals.find((item: any) => item.id === appealId) as any;
    if (!appeal) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_open_appeal_required');
    }
    const replay = appeal.votes.find((item: any) => item.idempotencyKey === idempotencyKey);
    if (replay) {
      if (replay.actorPubkey !== actorPubkey || replay.vote !== input.vote || replay.reason !== reason) {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_idempotency_conflict');
      }
      return { replayed: true, agreement: projectGovernanceGrantAgreement(agreement) };
    }
    if (appeal.status !== 'open') {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_open_appeal_required');
    }
    if (
      !appeal.reviewerPubkeys.includes(actorPubkey)
      || appeal.originalReviewerPubkeys.includes(actorPubkey)
      || appeal.votes.some((item: any) => item.actorPubkey === actorPubkey)
    ) throw new GovernanceGrantAgreementError(403, 'governance_grant_appeal_reviewer_not_authorized');
    const voteFacts = {
      id: lifecycleId('appeal-vote', agreementId, idempotencyKey),
      idempotencyKey,
      actorPubkey,
      vote: input.vote,
      reason,
      recordedAt: now.toISOString(),
    };
    appeal.votes.push({
      ...voteFacts,
      digest: hashCanonicalGovernanceValue('alcheme.governance.grant-appeal-vote-v1', voteFacts),
    });
    const matching = appeal.votes.filter((item: any) => item.vote === input.vote);
    if (matching.length >= appeal.quorum) {
      const resolutionFacts = {
        outcome: input.vote,
        voteIds: matching.map((item: any) => item.id).sort(),
        reviewerPubkeys: matching.map((item: any) => item.actorPubkey).sort(),
        decidedAt: now.toISOString(),
      };
      appeal.status = 'resolved';
      appeal.settlementAuthorization = input.vote === 'overturn_accept'
        ? agreement.status === 'terminated'
          ? 'blocked_terminated'
          : 'contractual_intent_allowed'
        : 'blocked_original_result_upheld';
      appeal.resolution = {
        ...resolutionFacts,
        digest: hashCanonicalGovernanceValue('alcheme.governance.grant-appeal-resolution-v1', resolutionFacts),
      };
      const { digest: _previousDigest, ...resolvedAppealFacts } = appeal;
      appeal.digest = hashCanonicalGovernanceValue(
        'alcheme.governance.grant-milestone-appeal-v1',
        resolvedAppealFacts,
      );
      if (input.vote === 'overturn_accept') {
        if (agreement.status !== 'terminated') {
          const milestone = grantMilestone(agreement.terms, appeal.milestoneId);
          const originalResult = lifecycle.milestoneResults.find((item: any) => (
            item.digest === appeal.originalResultDigest
          ));
          appendTrancheIntent(lifecycle, agreement, milestone, {
            ...originalResult,
            digest: appeal.resolution.digest,
          }, now);
        }
      }
    }
    const updated = await saveLifecycle(tx, agreement, lifecycle);
    return { replayed: false, agreement: projectGovernanceGrantAgreement(updated) };
  });
}

export async function openGovernanceGrantAgreementAmendmentCase(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    proposedTerms: Record<string, unknown>;
    reason: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; governanceCase: any }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const reason = requiredText(input.reason, 2000, 'governance_grant_amendment_reason_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  const agreement = await loadCurrentAgreement(prisma, agreementId);
  assertAgreementCase(agreement, caseId);
  assertAgreementActive(agreement);
  const currentTerms = agreement.terms as any;
  const proposedTerms = record(input.proposedTerms);
  if (
    proposedTerms.schemaVersion !== 1
    || proposedTerms?.source?.artifactId !== currentTerms?.source?.artifactId
    || proposedTerms?.source?.projectRef !== currentTerms?.source?.projectRef
    || proposedTerms?.governingDecision?.requestId !== currentTerms?.governingDecision?.requestId
    || proposedTerms?.governingDecision?.digest !== currentTerms?.governingDecision?.digest
  ) throw new GovernanceGrantAgreementError(400, 'governance_grant_amendment_terms_invalid');
  const proposedTermsDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.grant-agreement-terms-v1', proposedTerms,
  );
  if (proposedTermsDigest === agreement.termsDigest) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_amendment_material_change_required');
  }
  const sourceCase = await prisma.governanceCase.findUnique({
    where: { id: agreement.caseId },
    select: { subjectType: true, subjectRef: true },
  });
  const circleId = sourceCase?.subjectType === 'circle' ? Number(sourceCase.subjectRef) : NaN;
  if (!Number.isSafeInteger(circleId) || circleId <= 0) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_amendment_home_invalid');
  }
  return createGovernanceCaseIntake(prisma, {
    circleId,
    title: `Amend Grant Agreement ${agreementId}`,
    requestedDecision: `Should the Circle approve this governed Grant Agreement amendment? ${reason}`,
    requestedActionPayload: {
      kind: 'grant_agreement_amendment',
      agreementId,
      baselineTermsDigest: agreement.termsDigest,
      proposedTerms,
      proposedTermsDigest,
      reason,
    },
    caseType: 'policy',
    templateId: 'basic-community',
    actionType: GOVERNANCE_GRANT_AGREEMENT_AMEND_ACTION_TYPE,
    subjectType: 'circle',
    subjectRef: String(circleId),
    originKind: 'manual_item',
    idempotencyKey,
    openedByPubkey: actorPubkey,
    actorRole: input.actorRole,
    openedAt: input.now,
  });
}

export async function openGovernanceGrantAgreementTerminationCase(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    ground: GovernanceGrantTerminationGround;
    reason: string;
    retainedObligations: string[];
    outstandingObligations: string[];
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; governanceCase: any; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const reason = requiredText(input.reason, 2000, 'governance_grant_termination_reason_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  const retainedObligations = uniqueTexts(
    input.retainedObligations, 1, 20, 500, 'governance_grant_retained_obligations_invalid',
  );
  const outstandingObligations = uniqueTexts(
    input.outstandingObligations, 0, 20, 500, 'governance_grant_outstanding_obligations_invalid',
  );
  if (!isTerminationGround(input.ground) || idempotencyKey.length < 8) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_termination_invalid');
  }
  const now = input.now ?? new Date();
  const agreement = await loadCurrentAgreement(prisma, agreementId);
  assertAgreementCase(agreement, caseId);
  assertAgreementActive(agreement);
  const currentLifecycle = cloneLifecycle(agreement.lifecycle);
  const existingRequest = currentLifecycle.terminationRequest as any;
  if (existingRequest) {
    if (
      existingRequest.idempotencyKey !== idempotencyKey
      || existingRequest.ground !== input.ground
      || existingRequest.reason !== reason
      || hashCanonicalGovernanceValue(
        'alcheme.governance.grant-termination-obligations-v1',
        existingRequest.retainedObligations,
      ) !== hashCanonicalGovernanceValue(
        'alcheme.governance.grant-termination-obligations-v1', retainedObligations,
      )
      || hashCanonicalGovernanceValue(
        'alcheme.governance.grant-termination-obligations-v1',
        existingRequest.outstandingObligations,
      ) !== hashCanonicalGovernanceValue(
        'alcheme.governance.grant-termination-obligations-v1', outstandingObligations,
      )
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_request_exists');
    const governanceCase = await prisma.governanceCase.findUnique({
      where: { id: existingRequest.caseId },
    });
    if (!governanceCase) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_case_missing');
    }
    return {
      replayed: true,
      governanceCase,
      agreement: projectGovernanceGrantAgreement(agreement),
    };
  }
  const proposedTerms = JSON.parse(JSON.stringify(agreement.terms));
  proposedTerms.terminationDeclaration = {
    schemaVersion: 1,
    ground: input.ground,
    reason,
    retainedObligations,
    outstandingObligations,
    requestedAt: now.toISOString(),
  };
  const proposedTermsDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.grant-agreement-terms-v1', proposedTerms,
  );
  const opened = await openGovernanceGrantAgreementAmendmentCase(prisma, {
    caseId,
    agreementId,
    proposedTerms,
    reason: `Terminate Grant Agreement: ${reason}`,
    actorPubkey,
    actorRole: input.actorRole,
    idempotencyKey,
    now,
  });
  const updated = await prisma.$transaction(async (tx: any) => {
    const current = await loadCurrentAgreement(tx, agreementId);
    const lifecycle = cloneLifecycle(current.lifecycle);
    if (lifecycle.terminationRequest) {
      if ((lifecycle.terminationRequest as any).caseId !== opened.governanceCase.id) {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_request_exists');
      }
      return current;
    }
    lifecycle.terminationRequest = {
      idempotencyKey,
      caseId: opened.governanceCase.id,
      proposedTermsDigest,
      ground: input.ground,
      reason,
      retainedObligations,
      outstandingObligations,
      status: 'governance_pending',
      openedAt: now.toISOString(),
    };
    return saveLifecycle(tx, current, lifecycle);
  });
  return {
    replayed: opened.replayed,
    governanceCase: opened.governanceCase,
    agreement: projectGovernanceGrantAgreement(updated),
  };
}

export async function applyAcceptedGovernanceGrantAgreementTermination(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    actorPubkey: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  if (idempotencyKey.length < 8) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_idempotency_key_required');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const agreement = await loadCurrentAgreement(tx, agreementId);
    assertAgreementCase(agreement, caseId);
    const lifecycle = cloneLifecycle(agreement.lifecycle);
    if (lifecycle.termination) {
      if ((lifecycle.termination as any).idempotencyKey !== idempotencyKey) {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_already_terminated');
      }
      const refreshed = await refreshGovernanceGrantSettlementReadiness(prisma, {
        caseId,
        agreementId,
        expectedEvaluationVersion: Number(agreement.settlementReadinessVersion ?? 0),
        now,
      }, { transaction: tx });
      return { replayed: true, agreement: refreshed.agreement };
    }
    assertAgreementActive(agreement);
    const terminationRequest = lifecycle.terminationRequest as any;
    if (!terminationRequest || terminationRequest.status !== 'governance_pending') {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_request_required');
    }
    const terminationCase = await tx.governanceCase.findUnique({
      where: { id: terminationRequest.caseId },
      include: {
        primaryRequest: { include: { decision: true } },
        decisionOutputArtifacts: { orderBy: { ordinal: 'asc' } },
      },
    });
    const request = terminationCase?.primaryRequest;
    const decision = request?.decision;
    const artifact = Array.isArray(terminationCase?.decisionOutputArtifacts)
      ? terminationCase.decisionOutputArtifacts[0]
      : null;
    if (
      terminationCase?.caseType !== 'policy'
      || request?.state !== 'accepted'
      || decision?.decision !== 'accepted'
      || !artifact
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_decision_not_accepted');
    let expectedArtifact;
    try {
      expectedArtifact = buildNativeDecisionOutputArtifact({
        caseId: terminationCase.id,
        caseType: terminationCase.caseType,
        subjectType: terminationCase.subjectType,
        subjectRef: terminationCase.subjectRef,
        decisionRequestId: request.id,
        decision: decision.decision,
        decisionDigest: decision.decisionDigest,
        briefDraftPostId: terminationCase.briefDraftPostId,
        briefDraftVersion: terminationCase.briefDraftVersion,
        briefSnapshotDigest: terminationCase.briefSnapshotDigest,
        mechanismKind: terminationCase.templateSelection?.decisionMechanism?.kind,
        decisionTally: decision.tally,
        selectionRanking: terminationCase.templateSelection?.selectionRanking,
        requestedActionPayload: terminationCase.requestedActionPayload,
        createdAt: artifact.createdAt,
      });
    } catch {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_artifact_invalid');
    }
    if (
      expectedArtifact.kind !== 'grant_agreement_amendment'
      || !decisionOutputArtifactMatches(artifact, expectedArtifact)
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_artifact_invalid');
    const amendment = expectedArtifact.constraints.grantAgreementAmendment;
    const proposedTerms = amendment.proposedTerms as any;
    const declaration = proposedTerms?.terminationDeclaration;
    if (
      amendment.agreementId !== agreementId
      || amendment.baselineTermsDigest !== agreement.termsDigest
      || amendment.proposedTermsDigest !== terminationRequest.proposedTermsDigest
      || proposedTerms?.source?.artifactId !== (agreement.terms as any)?.source?.artifactId
      || proposedTerms?.source?.projectRef !== (agreement.terms as any)?.source?.projectRef
      || proposedTerms?.governingDecision?.requestId !== (agreement.terms as any)?.governingDecision?.requestId
      || proposedTerms?.governingDecision?.digest !== (agreement.terms as any)?.governingDecision?.digest
      || !isTerminationDeclaration(declaration)
    ) throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_artifact_invalid');
    const expectedTerminationTerms = JSON.parse(JSON.stringify(agreement.terms));
    expectedTerminationTerms.terminationDeclaration = declaration;
    if (amendment.proposedTermsDigest !== hashCanonicalGovernanceValue(
      'alcheme.governance.grant-agreement-terms-v1', expectedTerminationTerms,
    )) throw new GovernanceGrantAgreementError(409, 'governance_grant_termination_artifact_invalid');
    const blockedContractualIntentIds: string[] = [];
    for (const intent of lifecycle.trancheIntents as any[]) {
      if (intent.status === 'contractual_pending_settlement') {
        blockedContractualIntentIds.push(String(intent.id));
      }
    }
    const intentMilestoneIds = new Set(
      (lifecycle.trancheIntents as any[]).map((intent) => String(intent.milestoneId)),
    );
    const stoppedFutureMilestoneIds = (proposedTerms.milestones as any[])
      .map((milestone) => String(milestone.id))
      .filter((milestoneId) => !intentMilestoneIds.has(milestoneId));
    const openDisputeIds = (lifecycle.appeals as any[])
      .filter((appeal) => appeal.status === 'open')
      .map((appeal) => String(appeal.id));
    const terminationFacts = {
      id: lifecycleId('termination', agreementId, expectedArtifact.artifactDigest),
      idempotencyKey,
      ground: declaration.ground,
      reason: declaration.reason,
      governedCaseId: terminationCase.id,
      amendmentArtifactId: expectedArtifact.id,
      amendmentArtifactDigest: expectedArtifact.artifactDigest,
      governingDecisionDigest: expectedArtifact.decisionDigest,
      stoppedFutureMilestoneIds,
      blockedContractualIntentIds,
      retainedObligations: declaration.retainedObligations,
      outstandingObligations: declaration.outstandingObligations,
      openDisputeIds,
      outcomeStatus: 'required',
      recovery: {
        mode: 'contractual_manual_claim_only',
        refundExecutable: false,
        clawbackExecutable: false,
        resourceRef: null,
        providerFinality: null,
      },
      appliedByPubkey: actorPubkey,
      appliedAt: now.toISOString(),
    };
    lifecycle.termination = {
      ...terminationFacts,
      digest: hashCanonicalGovernanceValue(
        'alcheme.governance.grant-termination-v1', terminationFacts,
      ),
    };
    lifecycle.terminationRequest = {
      ...terminationRequest,
      status: 'applied',
      artifactId: expectedArtifact.id,
      artifactDigest: expectedArtifact.artifactDigest,
      appliedAt: now.toISOString(),
    };
    const lifecycleDigest = governanceGrantLifecycleDigest(lifecycle);
    const updated = await tx.governanceGrantAgreement.updateMany({
      where: {
        id: agreement.id,
        status: 'active',
        termsDigest: agreement.termsDigest,
        lifecycleVersion: agreement.lifecycleVersion,
        lifecycleDigest: agreement.lifecycleDigest,
      },
      data: {
        status: 'terminated',
        terms: proposedTerms,
        termsDigest: amendment.proposedTermsDigest,
        lifecycle,
        lifecycleDigest,
        lifecycleVersion: agreement.lifecycleVersion + 1,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_lifecycle_version_conflict');
    }
    const refreshed = await refreshGovernanceGrantSettlementReadiness(prisma, {
      caseId,
      agreementId,
      expectedEvaluationVersion: Number(agreement.settlementReadinessVersion ?? 0),
      now,
    }, { transaction: tx });
    return { replayed: false, agreement: refreshed.agreement };
  });
}

export async function recordGovernanceGrantOutcome(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    status: GovernanceGrantOutcomeStatus;
    summary: string;
    actualImpact: string[];
    outstandingObligations: string[];
    evidenceRefs: string[];
    observationStartedAt: string;
    observationEndedAt: string;
    actorPubkey: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const agreementId = requiredText(input.agreementId, 96, 'governance_grant_agreement_required');
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(input.idempotencyKey, 128, 'governance_grant_idempotency_key_required');
  const summary = requiredText(input.summary, 2000, 'governance_grant_outcome_summary_required');
  const actualImpact = uniqueTexts(
    input.actualImpact, 1, 20, 500, 'governance_grant_actual_impact_invalid',
  );
  const outstandingObligations = uniqueTexts(
    input.outstandingObligations, 0, 20, 500, 'governance_grant_outstanding_obligations_invalid',
  );
  const evidenceRefs = uniqueTexts(
    input.evidenceRefs, 1, 20, 240, 'governance_grant_outcome_evidence_invalid',
  );
  const observationStartedAt = requiredDateTime(
    input.observationStartedAt, 'governance_grant_outcome_observation_invalid',
  );
  const observationEndedAt = requiredDateTime(
    input.observationEndedAt, 'governance_grant_outcome_observation_invalid',
  );
  if (
    !isOutcomeStatus(input.status)
    || idempotencyKey.length < 8
    || observationEndedAt.getTime() < observationStartedAt.getTime()
  ) throw new GovernanceGrantAgreementError(400, 'governance_grant_outcome_invalid');
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const agreement = await loadCurrentAgreement(tx, agreementId);
    assertAgreementCase(agreement, caseId);
    const lifecycle = cloneLifecycle(agreement.lifecycle);
    if (lifecycle.outcome) {
      const existing = lifecycle.outcome as any;
      if (existing.idempotencyKey !== idempotencyKey) {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_outcome_already_recorded');
      }
      if (
        existing.status !== input.status
        || existing.summary !== summary
        || existing.recordedByPubkey !== actorPubkey
        || existing.observationPeriod?.startedAt !== observationStartedAt.toISOString()
        || existing.observationPeriod?.endedAt !== observationEndedAt.toISOString()
        || !sameTextList(existing.actualImpact, actualImpact)
        || !sameTextList(existing.outstandingObligations, outstandingObligations)
        || !sameTextList(existing.evidenceRefs, evidenceRefs)
      ) throw new GovernanceGrantAgreementError(409, 'governance_grant_idempotency_conflict');
      return { replayed: true, agreement: projectGovernanceGrantAgreement(agreement) };
    }
    const terms = agreement.terms as any;
    if (
      !Array.isArray(terms?.outcomePolicy?.reviewerPubkeys)
      || !terms.outcomePolicy.reviewerPubkeys.includes(actorPubkey)
      || terms.outcomePolicy.excludedRecipientOrApplicantPubkeys?.includes(actorPubkey)
    ) throw new GovernanceGrantAgreementError(403, 'governance_grant_outcome_reviewer_not_authorized');
    if (agreement.status === 'terminated') {
      if (input.status !== 'terminated') {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_terminated_outcome_required');
      }
    } else if (!allGrantMilestonesAccepted(terms, lifecycle)) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_outcome_not_ready');
    }
    const deliverableAcceptance = (terms.milestones as any[]).map((milestone) => {
      const result = [...(lifecycle.milestoneResults as any[])]
        .reverse()
        .find((item) => item.milestoneId === milestone.id);
      const intent = (lifecycle.trancheIntents as any[])
        .find((item) => item.milestoneId === milestone.id);
      const blocked = lifecycle.termination
        && Array.isArray((lifecycle.termination as any).blockedContractualIntentIds)
        && (lifecycle.termination as any).blockedContractualIntentIds.includes(intent?.id);
      return {
        milestoneId: milestone.id,
        resultDigest: result?.digest ?? null,
        result: intent ? 'accepted' : result?.outcome ?? 'pending',
        contractualSettlementStatus: blocked ? 'blocked_terminated' : intent?.status ?? 'not_authorized',
      };
    });
    const disputeEvidence = (lifecycle.appeals as any[]).map((appeal) => ({
      appealId: appeal.id,
      milestoneId: appeal.milestoneId,
      status: appeal.status,
      resolutionDigest: appeal.resolution?.digest ?? null,
    }));
    const outcomeFacts = {
      id: lifecycleId('outcome', agreementId, idempotencyKey),
      idempotencyKey,
      status: input.status,
      summary,
      actualImpact,
      outstandingObligations,
      evidenceRefs,
      observationPeriod: {
        startedAt: observationStartedAt.toISOString(),
        endedAt: observationEndedAt.toISOString(),
      },
      deliverableAcceptance,
      termination: lifecycle.termination
        ? {
            status: 'terminated',
            digest: (lifecycle.termination as any).digest,
            openDisputeIds: (lifecycle.termination as any).openDisputeIds,
          }
        : { status: 'not_terminated', digest: null, openDisputeIds: [] },
      disputes: disputeEvidence,
      funding: {
        status: 'unfunded_pending_settlement',
        payoutEvidence: 'none',
        providerFinality: null,
      },
      contractualRecovery: lifecycle.termination
        ? {
            status: 'contractual_manual_claim_only',
            refundExecuted: false,
            clawbackExecuted: false,
            providerFinality: null,
          }
        : { status: 'not_applicable', refundExecuted: false, clawbackExecuted: false, providerFinality: null },
      recordedByPubkey: actorPubkey,
      recordedAt: now.toISOString(),
    };
    lifecycle.outcome = {
      ...outcomeFacts,
      digest: hashCanonicalGovernanceValue('alcheme.governance.grant-outcome-v1', outcomeFacts),
    };
    const updated = await saveLifecycle(tx, agreement, lifecycle);
    return { replayed: false, agreement: projectGovernanceGrantAgreement(updated) };
  });
}

async function loadCurrentAgreement(tx: any, agreementId: string): Promise<any> {
  const agreement = await tx.governanceGrantAgreement.findUnique({ where: { id: agreementId } });
  if (!agreement) throw new GovernanceGrantAgreementError(404, 'governance_grant_agreement_not_found');
  if ((projectGovernanceGrantAgreement(agreement) as any).integrity !== 'verified') {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_agreement_integrity_invalid');
  }
  return agreement;
}

async function saveLifecycle(tx: any, agreement: any, lifecycle: GovernanceGrantLifecycle): Promise<any> {
  const lifecycleDigest = governanceGrantLifecycleDigest(lifecycle);
  const updated = await tx.governanceGrantAgreement.updateMany({
    where: {
      id: agreement.id,
      lifecycleVersion: agreement.lifecycleVersion,
      lifecycleDigest: agreement.lifecycleDigest,
    },
    data: {
      lifecycle,
      lifecycleDigest,
      lifecycleVersion: agreement.lifecycleVersion + 1,
    },
  });
  if (updated.count !== 1) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_lifecycle_version_conflict');
  }
  return { ...agreement, lifecycle, lifecycleDigest, lifecycleVersion: agreement.lifecycleVersion + 1 };
}

function appendTrancheIntent(
  lifecycle: GovernanceGrantLifecycle,
  agreement: any,
  milestone: any,
  result: any,
  now: Date,
): void {
  if (lifecycle.trancheIntents.some((item: any) => item.milestoneId === milestone.id)) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_tranche_intent_already_exists');
  }
  const committed = lifecycle.trancheIntents.reduce(
    (sum: number, item: any) => sum + Number(item.amountUnits), 0,
  );
  const amountUnits = Number(milestone.contractualUnits);
  const total = Number(agreement.contractualBudgetUnits);
  if (!Number.isSafeInteger(amountUnits) || amountUnits <= 0 || committed + amountUnits > total) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_budget_conservation_invalid');
  }
  const facts = {
    id: lifecycleId('tranche-intent', agreement.id, milestone.id),
    milestoneId: milestone.id,
    milestoneResultDigest: result.digest,
    amountUnits: String(amountUnits),
    recipientRef: agreement.recipientRef,
    budgetUnit: agreement.budgetUnit,
    status: 'contractual_pending_settlement',
    resourceRef: null,
    payoutRef: null,
    providerFinality: null,
    createdAt: now.toISOString(),
  };
  lifecycle.trancheIntents.push({
    ...facts,
    digest: hashCanonicalGovernanceValue('alcheme.governance.grant-tranche-intent-v1', facts),
  });
}

function grantMilestone(terms: any, milestoneId: string): any {
  const milestone = Array.isArray(terms?.milestones)
    ? terms.milestones.find((item: any) => item?.id === milestoneId)
    : null;
  if (!milestone) throw new GovernanceGrantAgreementError(404, 'governance_grant_milestone_not_found');
  return milestone;
}

function assertAgreementCase(agreement: any, caseId: string): void {
  if (agreement.caseId !== caseId) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_agreement_case_mismatch');
  }
}

function assertAgreementActive(agreement: any): void {
  if (agreement.status !== 'active') {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_agreement_not_active');
  }
}

function nextReviewRevision(lifecycle: GovernanceGrantLifecycle, milestoneId: string): number {
  return 1 + lifecycle.milestoneResults.filter((item: any) => (
    item.milestoneId === milestoneId && item.outcome === 'rework'
  )).length;
}

function openAppealForMilestone(lifecycle: GovernanceGrantLifecycle, milestoneId: string): boolean {
  return lifecycle.appeals.some((item: any) => item.milestoneId === milestoneId && item.status === 'open');
}

function grantRecipientPubkeys(terms: any, recipientRef: string): string[] {
  const values: string[] = Array.isArray(terms?.recipient?.applicantPubkeys)
    ? terms.recipient.applicantPubkeys.map(String)
    : [];
  const wallet = recipientRef.startsWith('wallet:') ? recipientRef.slice(7) : recipientRef;
  if (wallet) values.push(wallet);
  return [...new Set(values)];
}

function cloneLifecycle(value: unknown): GovernanceGrantLifecycle {
  return JSON.parse(JSON.stringify(value)) as GovernanceGrantLifecycle;
}

function lifecycleId(kind: string, agreementId: string, key: string): string {
  return `grant_${kind}:${hashCanonicalGovernanceValue(
    `alcheme.governance.grant-${kind}-id-v1`, { agreementId, key },
  ).slice(0, 56)}`;
}

function requiredText(value: unknown, max: number, code: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw new GovernanceGrantAgreementError(400, code);
  return text;
}

function requiredDigest(value: unknown, code: string): string {
  const digest = requiredText(value, 64, code);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new GovernanceGrantAgreementError(400, code);
  return digest;
}

function requiredDateTime(value: unknown, code: string): Date {
  const date = new Date(requiredText(value, 40, code));
  if (!Number.isFinite(date.getTime())) throw new GovernanceGrantAgreementError(400, code);
  return date;
}

function uniqueTexts(value: unknown, min: number, max: number, maxLength: number, code: string): string[] {
  if (!Array.isArray(value)) throw new GovernanceGrantAgreementError(400, code);
  const items = value.map((item) => requiredText(item, maxLength, code));
  if (items.length < min || items.length > max || new Set(items).size !== items.length) {
    throw new GovernanceGrantAgreementError(400, code);
  }
  return items;
}

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_amendment_terms_invalid');
  }
  return value as Record<string, any>;
}

function isReviewOutcome(value: unknown): value is GovernanceGrantMilestoneReviewOutcome {
  return value === 'accept' || value === 'rework' || value === 'reject';
}

function isTerminationGround(value: unknown): value is GovernanceGrantTerminationGround {
  return value === 'milestone_rejected'
    || value === 'schedule_expired'
    || value === 'governing_decision_revoked';
}

function isTerminationDeclaration(value: unknown): value is {
  schemaVersion: 1;
  ground: GovernanceGrantTerminationGround;
  reason: string;
  retainedObligations: string[];
  outstandingObligations: string[];
  requestedAt: string;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const declaration = value as Record<string, unknown>;
  return declaration.schemaVersion === 1
    && isTerminationGround(declaration.ground)
    && typeof declaration.reason === 'string'
    && declaration.reason.trim().length > 0
    && Array.isArray(declaration.retainedObligations)
    && declaration.retainedObligations.length > 0
    && declaration.retainedObligations.every((item) => typeof item === 'string' && item.trim())
    && Array.isArray(declaration.outstandingObligations)
    && declaration.outstandingObligations.every((item) => typeof item === 'string' && item.trim())
    && Number.isFinite(new Date(String(declaration.requestedAt ?? '')).getTime());
}

function isOutcomeStatus(value: unknown): value is GovernanceGrantOutcomeStatus {
  return value === 'fulfilled'
    || value === 'partially_fulfilled'
    || value === 'not_fulfilled'
    || value === 'terminated';
}

function allGrantMilestonesAccepted(terms: any, lifecycle: GovernanceGrantLifecycle): boolean {
  const milestones = Array.isArray(terms?.milestones) ? terms.milestones : [];
  const accepted = new Set(
    lifecycle.trancheIntents
      .filter((intent: any) => intent?.status === 'contractual_pending_settlement')
      .map((intent: any) => String(intent.milestoneId)),
  );
  return milestones.length > 0 && milestones.every((milestone: any) => accepted.has(String(milestone.id)));
}

function sameTextList(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && hashCanonicalGovernanceValue('alcheme.governance.grant-text-list-v1', left)
      === hashCanonicalGovernanceValue('alcheme.governance.grant-text-list-v1', right);
}

function isAppealVote(value: unknown): value is GovernanceGrantAppealVote {
  return value === 'uphold' || value === 'overturn_accept';
}
