import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildNativeDecisionOutputArtifact,
  decisionOutputArtifactMatches,
  type NativeQfAllocationPlanArtifact,
} from './decisionOutputArtifact';
import {
  evaluateGovernanceGrantSettlementReadiness,
  validateGovernanceGrantSettlementReadiness,
} from './governanceResourceReadiness';
import { projectGovernanceProviderExecutionReadback } from './readProjection';

export type GovernanceGrantConflictReason =
  | 'material_relationship'
  | 'financial_interest'
  | 'subject_or_recipient'
  | 'provider_or_operator_role'
  | 'other_public_conflict';

export interface GovernanceGrantMilestoneInput {
  title: string;
  deliverable: string;
  evidenceRequirements: string[];
  deadline: string;
  contractualUnits: number;
  primaryReviewerPubkeys: string[];
  alternateReviewerPubkeys: string[];
  reviewerQuorum: number;
  acceptCriteria: string;
  reworkCriteria: string;
  rejectCriteria: string;
  maxRevisions: number;
}

export interface GovernanceGrantAgreementTerms {
  schemaVersion: 1;
  source: {
    type: 'allocation_plan';
    artifactId: string;
    artifactDigest: string;
    projectRef: string;
    roundRef: string;
  };
  recipient: {
    ref: string;
    applicantPubkeys: string[];
  };
  contractualBudget: {
    unit: string;
    totalUnits: string;
    assetDeclaration: 'contractual_allocation_unit';
    funding: 'unfunded';
    settlement: 'pending_settlement';
    resourceRef: null;
    escrowRef: null;
    payoutRef: null;
    providerFinality: null;
  };
  governingDecision: { requestId: string; digest: string };
  milestones: Array<{
    id: string;
    title: string;
    deliverable: string;
    evidenceRequirements: string[];
    deadline: string;
    contractualUnits: string;
    reviewerAuthority: {
      source: 'frozen_governance_snapshot';
      snapshotDigest: string;
      primaryReviewerPubkeys: string[];
      alternateReviewerPubkeys: string[];
      recusedReviewerPubkeys: string[];
      effectiveReviewerPubkeys: string[];
      quorum: number;
      conflictDisclosureEventIds: string[];
      unreachable: 'block_activation';
    };
    appealAuthority: {
      source: 'frozen_governance_snapshot';
      snapshotDigest: string;
      reviewerPubkeys: string[];
      excludedOriginalReviewerPubkeys: string[];
      excludedRecipientOrApplicantPubkeys: string[];
      quorum: 1;
    };
    criteria: { accept: string; rework: string; reject: string };
    maxRevisions: number;
  }>;
  reviewPolicy: {
    decisionSet: ['accept', 'rework', 'reject'];
    interpretation: 'frozen_milestone_terms_only';
    payerAuthority: 'none';
    aiAuthority: 'none';
    runtimeStatus: 'active';
  };
  conflictOfInterestPolicy: {
    disclosureSource: 'governance_case_timeline';
    disclosure: 'eligible_actor_self_disclosure';
    recusal: 'required_on_disclosure';
    recipientOrApplicantReviewer: 'disclosure_and_recusal_required';
    alternate: 'frozen_alternate_reviewer_pool';
    unreachable: 'block_activation';
  };
  appealPolicy: {
    contractualRoute: 'governance_case';
    authority: 'separate_frozen_electorate_required';
    settlementEffect: 'stay_pending_until_resolved';
    runtimeStatus: 'active';
  };
  terminationPolicy: {
    grounds: ['milestone_rejected', 'schedule_expired', 'governing_decision_revoked'];
    authority: 'accepted_governed_amendment_artifact';
    effect: 'block_future_settlement_authorization';
    alreadySettledFunds: 'not_applicable_unfunded';
    recovery: 'contractual_manual_claim_only';
    runtimeStatus: 'active';
  };
  outcomePolicy: {
    authority: 'frozen_agreement_reviewer';
    reviewerPubkeys: string[];
    excludedRecipientOrApplicantPubkeys: string[];
    quorum: 1;
    evidence: 'required';
    runtimeStatus: 'active';
  };
  terminationDeclaration: null | {
    schemaVersion: 1;
    ground: 'milestone_rejected' | 'schedule_expired' | 'governing_decision_revoked';
    reason: string;
    retainedObligations: string[];
    outstandingObligations: string[];
    requestedAt: string;
  };
  schedule: {
    activatedAt: string;
    milestoneDeadlines: string[];
  };
}

export interface GovernanceGrantLifecycle {
  schemaVersion: 1;
  reviews: Array<Record<string, any>>;
  milestoneResults: Array<Record<string, any>>;
  trancheIntents: Array<Record<string, any>>;
  appeals: Array<Record<string, any>>;
  terminationRequest: Record<string, any> | null;
  termination: Record<string, any> | null;
  outcome: Record<string, any> | null;
}

export function emptyGovernanceGrantLifecycle(): GovernanceGrantLifecycle {
  return {
    schemaVersion: 1,
    reviews: [],
    milestoneResults: [],
    trancheIntents: [],
    appeals: [],
    terminationRequest: null,
    termination: null,
    outcome: null,
  };
}

export function governanceGrantLifecycleDigest(value: GovernanceGrantLifecycle): string {
  return hashCanonicalGovernanceValue('alcheme.governance.grant-lifecycle-v1', value);
}

export class GovernanceGrantAgreementError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string) {
    super(code);
  }
}

export async function discloseGovernanceGrantReviewerConflict(
  prisma: any,
  input: {
    caseId: string;
    artifactId: string;
    projectRef: string;
    actorPubkey: string;
    publicReason: GovernanceGrantConflictReason;
    idempotencyKey: string;
    expectedCaseVersion: number;
    now?: Date;
  },
): Promise<{ replayed: boolean; caseVersion: number; event: any }> {
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const artifactId = requiredText(input.artifactId, 96, 'governance_grant_artifact_required');
  const projectRef = requiredText(input.projectRef, 128, 'governance_grant_project_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_conflict_actor_required');
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    128,
    'governance_grant_idempotency_key_required',
  );
  if (idempotencyKey.length < 8 || !isConflictReason(input.publicReason)) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_conflict_disclosure_invalid');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const governanceCase = await loadGrantSourceCase(tx, caseId, artifactId);
    const allocation = assertCurrentAllocationPlan(governanceCase, artifactId);
    assertAllocationProject(allocation, projectRef);
    const replay = governanceCase.timelineEvents.find(
      (event: any) => event.idempotencyKey === idempotencyKey,
    );
    if (replay) {
      if (
        replay.eventType !== 'grant_reviewer_conflict_disclosed'
        || replay.actorPubkey !== actorPubkey
        || replay.subjectPubkey !== actorPubkey
        || replay.reason !== input.publicReason
        || replay.reviewPublicBasis !== grantProjectDisclosureRef(projectRef)
      ) throw new GovernanceGrantAgreementError(409, 'governance_grant_idempotency_conflict');
      return { replayed: true, caseVersion: governanceCase.caseVersion, event: replay };
    }
    if (governanceCase.caseVersion !== input.expectedCaseVersion) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_case_version_conflict');
    }
    const electorate = frozenElectorate(governanceCase);
    if (!electorate.has(actorPubkey)) {
      throw new GovernanceGrantAgreementError(403, 'governance_grant_reviewer_not_eligible');
    }
    const existingAgreement = await tx.governanceGrantAgreement.findFirst({
      where: { allocationArtifactId: artifactId, projectRef },
      select: { id: true },
    });
    if (existingAgreement) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_agreement_already_active');
    }
    const nextCaseVersion = governanceCase.caseVersion + 1;
    const updated = await tx.governanceCase.updateMany({
      where: { id: caseId, caseVersion: input.expectedCaseVersion },
      data: { caseVersion: nextCaseVersion },
    });
    if (updated.count !== 1) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_case_version_conflict');
    }
    const event = await tx.governanceCaseTimelineEvent.create({ data: {
      id: grantTimelineEventId(caseId, idempotencyKey),
      caseId,
      eventType: 'grant_reviewer_conflict_disclosed',
      responsibilityKind: null,
      actorPubkey,
      subjectPubkey: actorPubkey,
      fromState: governanceCase.casePhase,
      toState: governanceCase.casePhase,
      reason: input.publicReason,
      idempotencyKey,
      caseVersion: nextCaseVersion,
      responsibilityVersion: null,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      reviewPublicBasis: grantProjectDisclosureRef(projectRef),
      createdAt: now,
    } });
    return { replayed: false, caseVersion: nextCaseVersion, event };
  });
}

export async function activateGovernanceGrantAgreement(
  prisma: any,
  input: {
    caseId: string;
    artifactId: string;
    projectRef: string;
    milestones: GovernanceGrantMilestoneInput[];
    actorPubkey: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const artifactId = requiredText(input.artifactId, 96, 'governance_grant_artifact_required');
  const projectRef = requiredText(input.projectRef, 128, 'governance_grant_project_required');
  const actorPubkey = requiredText(input.actorPubkey, 44, 'governance_grant_actor_required');
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    128,
    'governance_grant_idempotency_key_required',
  );
  if (idempotencyKey.length < 8) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_idempotency_key_required');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const governanceCase = await loadGrantSourceCase(tx, caseId, artifactId);
    const allocation = assertCurrentAllocationPlan(governanceCase, artifactId);
    const project = assertAllocationProject(allocation, projectRef);
    const existingByKey = await tx.governanceGrantAgreement.findFirst({
      where: {
        OR: [
          { allocationArtifactId: artifactId, projectRef },
          { caseId, activationIdempotencyKey: idempotencyKey },
        ],
      },
    });
    const activatedAt = existingByKey?.activationIdempotencyKey === idempotencyKey
      ? new Date(existingByKey.activatedAt)
      : now;
    const contractualBudgetUnits = positiveSafeInteger(
      project.totalPlannedUnits,
      'governance_grant_budget_invalid',
    );
    const applicantPubkeys = await resolveApplicantPubkeys(tx, projectRef);
    const electorate = frozenElectorate(governanceCase);
    const disclosureEvents = grantConflictEvents(governanceCase, projectRef);
    const disclosedActors = new Set(disclosureEvents.map((event: any) => event.actorPubkey));
    const recipientOrApplicant = new Set([
      ...applicantPubkeys,
      ...recipientPubkeys(String(project.recipientRef ?? '')),
    ]);
    const milestones = normalizeMilestones({
      input: input.milestones,
      now: activatedAt,
      contractualBudgetUnits,
      electorate,
      disclosedActors,
      disclosureEvents,
      recipientOrApplicant,
      snapshotDigest: String(governanceCase.primaryRequest.decision.snapshotDigest ?? ''),
    });
    const terms: GovernanceGrantAgreementTerms = {
      schemaVersion: 1,
      source: {
        type: 'allocation_plan',
        artifactId,
        artifactDigest: allocation.artifactDigest,
        projectRef,
        roundRef: String(allocation.constraints.allocationPlan.roundRef),
      },
      recipient: {
        ref: String(project.recipientRef),
        applicantPubkeys,
      },
      contractualBudget: {
        unit: String(allocation.constraints.allocationPlan.budgetUnit),
        totalUnits: String(contractualBudgetUnits),
        assetDeclaration: 'contractual_allocation_unit',
        funding: 'unfunded',
        settlement: 'pending_settlement',
        resourceRef: null,
        escrowRef: null,
        payoutRef: null,
        providerFinality: null,
      },
      governingDecision: {
        requestId: allocation.decisionRequestId,
        digest: allocation.decisionDigest,
      },
      milestones,
      reviewPolicy: {
        decisionSet: ['accept', 'rework', 'reject'],
        interpretation: 'frozen_milestone_terms_only',
        payerAuthority: 'none',
        aiAuthority: 'none',
        runtimeStatus: 'active',
      },
      conflictOfInterestPolicy: {
        disclosureSource: 'governance_case_timeline',
        disclosure: 'eligible_actor_self_disclosure',
        recusal: 'required_on_disclosure',
        recipientOrApplicantReviewer: 'disclosure_and_recusal_required',
        alternate: 'frozen_alternate_reviewer_pool',
        unreachable: 'block_activation',
      },
      appealPolicy: {
        contractualRoute: 'governance_case',
        authority: 'separate_frozen_electorate_required',
        settlementEffect: 'stay_pending_until_resolved',
        runtimeStatus: 'active',
      },
      terminationPolicy: {
        grounds: ['milestone_rejected', 'schedule_expired', 'governing_decision_revoked'],
        authority: 'accepted_governed_amendment_artifact',
        effect: 'block_future_settlement_authorization',
        alreadySettledFunds: 'not_applicable_unfunded',
        recovery: 'contractual_manual_claim_only',
        runtimeStatus: 'active',
      },
      outcomePolicy: {
        authority: 'frozen_agreement_reviewer',
        reviewerPubkeys: [...new Set(milestones.flatMap((milestone) => [
          ...milestone.reviewerAuthority.effectiveReviewerPubkeys,
          ...milestone.appealAuthority.reviewerPubkeys,
        ]))].sort(),
        excludedRecipientOrApplicantPubkeys: [...new Set([
          ...applicantPubkeys,
          ...recipientPubkeys(String(project.recipientRef ?? '')),
        ])].sort(),
        quorum: 1,
        evidence: 'required',
        runtimeStatus: 'active',
      },
      terminationDeclaration: null,
      schedule: {
        activatedAt: activatedAt.toISOString(),
        milestoneDeadlines: milestones.map((milestone) => milestone.deadline),
      },
    };
    const termsDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.grant-agreement-terms-v1',
      terms,
    );
    const lifecycle = emptyGovernanceGrantLifecycle();
    const expectedWithoutReadiness = {
      id: grantAgreementId(artifactId, projectRef),
      caseId,
      allocationArtifactId: artifactId,
      projectRef,
      recipientRef: String(project.recipientRef),
      budgetUnit: String(allocation.constraints.allocationPlan.budgetUnit),
      contractualBudgetUnits: String(contractualBudgetUnits),
      governingDecisionRequestId: allocation.decisionRequestId,
      governingDecisionDigest: allocation.decisionDigest,
      status: 'active',
      fundingStatus: 'unfunded_pending_settlement',
      terms,
      termsDigest,
      lifecycle,
      lifecycleDigest: governanceGrantLifecycleDigest(lifecycle),
      lifecycleVersion: 1,
      activationIdempotencyKey: idempotencyKey,
      activatedByPubkey: actorPubkey,
      activatedAt,
    };
    const settlementReadiness = await evaluateGovernanceGrantSettlementReadiness(tx, {
      agreement: expectedWithoutReadiness,
      homeIdentityBinding: governanceCase.homeIdentityBinding,
      evaluationVersion: 1,
      now: activatedAt,
    });
    const expected = {
      ...expectedWithoutReadiness,
      settlementReadiness,
      settlementReadinessDigest: settlementReadiness.evaluationDigest,
      settlementReadinessVersion: 1,
      settlementReadinessEvaluatedAt: activatedAt,
    };
    if (existingByKey) {
      if (!grantAgreementMatches(existingByKey, expected)) {
        throw new GovernanceGrantAgreementError(409, 'governance_grant_agreement_conflict');
      }
      return { replayed: true, agreement: projectGovernanceGrantAgreement(existingByKey) };
    }
    const agreement = await tx.governanceGrantAgreement.create({ data: expected });
    return { replayed: false, agreement: projectGovernanceGrantAgreement(agreement) };
  });
}

export async function refreshGovernanceGrantSettlementReadiness(
  prisma: any,
  input: {
    caseId: string;
    agreementId: string;
    expectedEvaluationVersion: number;
    now?: Date;
  },
  options: { transaction?: any } = {},
): Promise<{ replayed: boolean; agreement: Record<string, unknown> }> {
  const caseId = requiredText(input.caseId, 128, 'governance_grant_case_required');
  const agreementId = requiredText(
    input.agreementId,
    96,
    'governance_grant_agreement_required',
  );
  if (
    !Number.isSafeInteger(input.expectedEvaluationVersion)
    || input.expectedEvaluationVersion < 0
  ) throw new GovernanceGrantAgreementError(
    400,
    'governance_grant_settlement_readiness_version_invalid',
  );
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_settlement_readiness_time_invalid');
  }

  const persist = async (tx: any) => {
    const agreement = await tx.governanceGrantAgreement.findUnique({
      where: { id: agreementId },
    });
    if (!agreement || agreement.caseId !== caseId) {
      throw new GovernanceGrantAgreementError(404, 'governance_grant_agreement_not_found');
    }
    const currentVersion = Number(agreement.settlementReadinessVersion ?? 0);
    if (
      !Number.isSafeInteger(currentVersion)
      || currentVersion < 0
      || currentVersion !== input.expectedEvaluationVersion
    ) throw new GovernanceGrantAgreementError(
      409,
      'governance_grant_settlement_readiness_version_conflict',
    );
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: {
        homeIdentityBinding: {
          select: { id: true, homeType: true, homeRef: true },
        },
      },
    });
    if (!governanceCase?.homeIdentityBinding) {
      throw new GovernanceGrantAgreementError(
        409,
        'governance_grant_settlement_readiness_home_invalid',
      );
    }
    const nextReadiness = await evaluateGovernanceGrantSettlementReadiness(tx, {
      agreement,
      homeIdentityBinding: governanceCase.homeIdentityBinding,
      evaluationVersion: currentVersion + 1,
      now,
    });
    const currentReadiness = agreement.settlementReadiness;
    if (
      currentVersion > 0
      && currentReadiness
      && typeof currentReadiness === 'object'
      && !Array.isArray(currentReadiness)
      && currentReadiness.evaluationVersion === currentVersion
      && currentReadiness.evaluationDigest === agreement.settlementReadinessDigest
      && currentReadiness.sourceDigest === nextReadiness.sourceDigest
    ) {
      return { replayed: true, agreement: projectGovernanceGrantAgreement(agreement) };
    }
    const updated = await tx.governanceGrantAgreement.updateMany({
      where: {
        id: agreementId,
        caseId,
        settlementReadinessVersion: currentVersion,
        settlementReadinessDigest: currentVersion === 0
          ? null
          : agreement.settlementReadinessDigest,
      },
      data: {
        settlementReadiness: nextReadiness,
        settlementReadinessDigest: nextReadiness.evaluationDigest,
        settlementReadinessVersion: nextReadiness.evaluationVersion,
        settlementReadinessEvaluatedAt: now,
      },
    });
    if (updated.count !== 1) {
      throw new GovernanceGrantAgreementError(
        409,
        'governance_grant_settlement_readiness_version_conflict',
      );
    }
    return {
      replayed: false,
      agreement: projectGovernanceGrantAgreement({
        ...agreement,
        settlementReadiness: nextReadiness,
        settlementReadinessDigest: nextReadiness.evaluationDigest,
        settlementReadinessVersion: nextReadiness.evaluationVersion,
        settlementReadinessEvaluatedAt: now,
      }),
    };
  };
  return options.transaction
    ? persist(options.transaction)
    : prisma.$transaction(persist);
}

export function projectGovernanceGrantAgreement(value: any): Record<string, unknown> {
  const activatedAt = dateTime(value?.activatedAt);
  const terms = value?.terms;
  const lifecycle = value?.lifecycle;
  const committedContractualUnits = Array.isArray(lifecycle?.trancheIntents)
    ? lifecycle.trancheIntents.reduce(
      (sum: number, intent: any) => sum + Number(intent?.amountUnits ?? 0),
      0,
    )
    : 0;
  const paidContractualUnits = Array.isArray(lifecycle?.trancheIntents)
    ? lifecycle.trancheIntents.reduce(
      (sum: number, intent: any) => sum + (
        intent?.status === 'paid' ? Number(intent?.amountUnits ?? 0) : 0
      ),
      0,
    )
    : 0;
  const blockedIntentIds = new Set(
    Array.isArray(lifecycle?.termination?.blockedContractualIntentIds)
      ? lifecycle.termination.blockedContractualIntentIds.map(String)
      : [],
  );
  const blockedContractualUnits = Array.isArray(lifecycle?.trancheIntents)
    ? lifecycle.trancheIntents.reduce(
      (sum: number, intent: any) => sum + (
        blockedIntentIds.has(String(intent?.id ?? '')) ? Number(intent?.amountUnits ?? 0) : 0
      ),
      0,
    )
    : 0;
  const projectedLifecycle = lifecycle && typeof lifecycle === 'object'
    ? {
        ...lifecycle,
        trancheIntents: Array.isArray(lifecycle.trancheIntents)
          ? lifecycle.trancheIntents.map((intent: any) => ({
              ...intent,
              effectiveStatus: blockedIntentIds.has(String(intent?.id ?? ''))
                ? 'blocked_terminated'
                : intent?.status,
            }))
          : [],
      }
    : null;
  const totalContractualUnits = Number(value?.contractualBudgetUnits ?? 0);
  const settlementReadinessVersion = Number(value?.settlementReadinessVersion ?? 0);
  const validatedSettlementReadiness = settlementReadinessVersion > 0
    ? validateGovernanceGrantSettlementReadiness(value?.settlementReadiness, {
      digest: value?.settlementReadinessDigest,
      version: settlementReadinessVersion,
      evaluatedAt: value?.settlementReadinessEvaluatedAt,
    })
    : null;
  const readinessScope = validatedSettlementReadiness?.scope;
  const settlementReadinessIntegrity = settlementReadinessVersion === 0
    && value?.settlementReadiness == null
    && value?.settlementReadinessDigest == null
    && value?.settlementReadinessEvaluatedAt == null
    ? 'not_evaluated'
    : !validatedSettlementReadiness
      ? 'invalid'
      : readinessScope?.agreementId === value?.id
      && readinessScope?.allocationArtifactId === value?.allocationArtifactId
      && readinessScope?.projectRef === value?.projectRef
      && readinessScope?.recipientRef === value?.recipientRef
      && readinessScope?.budgetUnit === value?.budgetUnit
      && readinessScope?.contractualUnits === String(value?.contractualBudgetUnits ?? '')
      && readinessScope?.termsDigest === value?.termsDigest
      && readinessScope?.lifecycleDigest === value?.lifecycleDigest
      && readinessScope?.lifecycleVersion === Number(value?.lifecycleVersion ?? 0)
      && readinessScope?.governingDecisionRequestId === value?.governingDecisionRequestId
      && readinessScope?.governingDecisionDigest === value?.governingDecisionDigest
      ? 'verified'
      : 'stale';
  const integrity = value?.termsDigest === hashCanonicalGovernanceValue(
    'alcheme.governance.grant-agreement-terms-v1',
    terms,
  )
    && terms?.schemaVersion === 1
    && terms?.source?.type === 'allocation_plan'
    && terms?.source?.artifactId === value?.allocationArtifactId
    && terms?.source?.projectRef === value?.projectRef
    && terms?.recipient?.ref === value?.recipientRef
    && terms?.contractualBudget?.unit === value?.budgetUnit
    && terms?.contractualBudget?.totalUnits === String(value?.contractualBudgetUnits ?? '')
    && terms?.contractualBudget?.funding === 'unfunded'
    && terms?.contractualBudget?.settlement === 'pending_settlement'
    && terms?.governingDecision?.requestId === value?.governingDecisionRequestId
    && terms?.governingDecision?.digest === value?.governingDecisionDigest
    && terms?.schedule?.activatedAt === activatedAt
    && value?.lifecycleDigest === governanceGrantLifecycleDigest(lifecycle)
    && grantLifecycleMatchesAgreement(lifecycle, terms, value)
    && (
      (value?.status === 'active' && lifecycle?.termination === null)
      || (value?.status === 'terminated' && lifecycle?.termination != null)
    )
    && value?.fundingStatus === expectedGrantFundingStatus(
      paidContractualUnits,
      totalContractualUnits,
    )
    ? 'verified'
    : 'invalid';
  const payoutRequests = Array.isArray(value?.payoutRequests)
    ? value.payoutRequests.map((request: any) => {
        const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
        const receipt = receipts.at(-1) ?? null;
        return {
          id: String(request?.id ?? ''),
          state: String(request?.state ?? ''),
          openedAt: request?.openedAt ? dateTime(request.openedAt) : null,
          resolvedAt: request?.resolvedAt ? dateTime(request.resolvedAt) : null,
          decision: request?.decision
            ? {
                decision: String(request.decision.decision ?? ''),
                decisionDigest: String(request.decision.decisionDigest ?? ''),
                decidedAt: request.decision.decidedAt
                  ? dateTime(request.decision.decidedAt)
                  : null,
              }
            : null,
          execution: receipt
            ? {
                status: String(receipt.executionStatus ?? ''),
                ref: receipt.executionRef == null ? null : String(receipt.executionRef),
                errorCode: receipt.errorCode == null ? null : String(receipt.errorCode),
                executedAt: receipt.executedAt ? dateTime(receipt.executedAt) : null,
              }
            : null,
          providerExecution: projectGovernanceProviderExecutionReadback(request),
        };
      }).filter((request: any) => request.id)
    : [];
  return {
    id: String(value?.id ?? ''),
    integrity,
    caseId: String(value?.caseId ?? ''),
    allocationArtifactId: String(value?.allocationArtifactId ?? ''),
    projectRef: String(value?.projectRef ?? ''),
    recipientRef: String(value?.recipientRef ?? ''),
    status: String(value?.status ?? ''),
    fundingStatus: String(value?.fundingStatus ?? ''),
    settlementReadiness: settlementReadinessIntegrity === 'verified'
      || settlementReadinessIntegrity === 'stale'
      ? validatedSettlementReadiness
      : null,
    settlementReadinessIntegrity,
    settlementReadinessDigest: value?.settlementReadinessDigest
      ? String(value.settlementReadinessDigest)
      : null,
    settlementReadinessVersion: Number(value?.settlementReadinessVersion ?? 0),
    settlementReadinessEvaluatedAt: value?.settlementReadinessEvaluatedAt
      ? dateTime(value.settlementReadinessEvaluatedAt)
      : null,
    budget: {
      unit: String(value?.budgetUnit ?? ''),
      contractualUnits: String(value?.contractualBudgetUnits ?? ''),
      committedContractualUnits: String(committedContractualUnits),
      paidContractualUnits: String(paidContractualUnits),
      blockedContractualUnits: String(blockedContractualUnits),
      remainingContractualUnits: String(totalContractualUnits - committedContractualUnits),
    },
    governingDecision: {
      requestId: String(value?.governingDecisionRequestId ?? ''),
      digest: String(value?.governingDecisionDigest ?? ''),
    },
    payoutRequests,
    terms: terms ?? null,
    termsDigest: String(value?.termsDigest ?? ''),
    lifecycle: projectedLifecycle,
    lifecycleDigest: String(value?.lifecycleDigest ?? ''),
    lifecycleVersion: Number(value?.lifecycleVersion ?? 0),
    activatedByPubkey: String(value?.activatedByPubkey ?? ''),
    activatedAt,
  };
}

async function loadGrantSourceCase(tx: any, caseId: string, artifactId: string): Promise<any> {
  const governanceCase = await tx.governanceCase.findUnique({
    where: { id: caseId },
    include: {
      homeIdentityBinding: {
        select: { id: true, homeType: true, homeRef: true },
      },
      primaryRequest: { include: { snapshot: true, decision: true } },
      timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      decisionOutputArtifacts: { where: { id: artifactId } },
    },
  });
  if (!governanceCase) {
    throw new GovernanceGrantAgreementError(404, 'governance_grant_case_not_found');
  }
  return governanceCase;
}

function assertCurrentAllocationPlan(
  governanceCase: any,
  artifactId: string,
): NativeQfAllocationPlanArtifact {
  const request = governanceCase?.primaryRequest;
  const decision = request?.decision;
  const artifact = Array.isArray(governanceCase?.decisionOutputArtifacts)
    ? governanceCase.decisionOutputArtifacts.find((item: any) => item.id === artifactId)
    : null;
  if (
    governanceCase?.caseType !== 'policy'
    || request?.state !== 'accepted'
    || decision?.decision !== 'accepted'
    || governanceCase?.templateSelection?.decisionMechanism?.kind !== 'quadratic_funding'
    || !request?.snapshot
    || !artifact
  ) throw new GovernanceGrantAgreementError(409, 'governance_grant_allocation_plan_required');
  let expected;
  try {
    expected = buildNativeDecisionOutputArtifact({
      caseId: governanceCase.id,
      caseType: governanceCase.caseType,
      subjectType: governanceCase.subjectType,
      subjectRef: governanceCase.subjectRef,
      decisionRequestId: request.id,
      decision: decision.decision,
      decisionDigest: decision.decisionDigest,
      briefDraftPostId: governanceCase.briefDraftPostId,
      briefDraftVersion: governanceCase.briefDraftVersion,
      briefSnapshotDigest: governanceCase.briefSnapshotDigest,
      mechanismKind: 'quadratic_funding',
      decisionTally: decision.tally,
      createdAt: artifact.createdAt,
    });
  } catch {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_allocation_plan_invalid');
  }
  if (expected.kind !== 'allocation_plan' || !decisionOutputArtifactMatches(artifact, expected)) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_allocation_plan_invalid');
  }
  return expected;
}

function assertAllocationProject(
  allocation: NativeQfAllocationPlanArtifact,
  projectRef: string,
): Record<string, any> {
  const plan = allocation.constraints.allocationPlan as Record<string, any>;
  const settlement = plan.settlement as Record<string, unknown> | null;
  if (
    settlement?.funding !== 'unfunded'
    || settlement?.state !== 'pending_settlement'
    || settlement?.resourceRef !== null
    || settlement?.escrowRef !== null
    || settlement?.payoutRef !== null
    || settlement?.providerFinality !== null
  ) throw new GovernanceGrantAgreementError(409, 'governance_grant_settlement_boundary_invalid');
  const projects = Array.isArray(plan.projects) ? plan.projects : [];
  const project = projects.find((item: any) => item?.projectRef === projectRef);
  if (!project) {
    throw new GovernanceGrantAgreementError(404, 'governance_grant_allocation_project_not_found');
  }
  return project;
}

function normalizeMilestones(input: {
  input: GovernanceGrantMilestoneInput[];
  now: Date;
  contractualBudgetUnits: number;
  electorate: Set<string>;
  disclosedActors: Set<string>;
  disclosureEvents: any[];
  recipientOrApplicant: Set<string>;
  snapshotDigest: string;
}): GovernanceGrantAgreementTerms['milestones'] {
  if (!Array.isArray(input.input) || input.input.length < 1 || input.input.length > 20) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_milestones_invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(input.snapshotDigest)) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_snapshot_invalid');
  }
  let previousDeadline = input.now.getTime();
  const milestones = input.input.map((value, index) => {
    const title = requiredText(value?.title, 120, 'governance_grant_milestone_invalid');
    const deliverable = requiredText(
      value?.deliverable,
      2000,
      'governance_grant_milestone_invalid',
    );
    const evidenceRequirements = uniqueTexts(
      value?.evidenceRequirements,
      1,
      12,
      240,
      'governance_grant_milestone_invalid',
    );
    const deadline = new Date(String(value?.deadline ?? ''));
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= previousDeadline) {
      throw new GovernanceGrantAgreementError(400, 'governance_grant_milestone_deadline_invalid');
    }
    previousDeadline = deadline.getTime();
    const contractualUnits = positiveSafeInteger(
      value?.contractualUnits,
      'governance_grant_milestone_budget_invalid',
    );
    const primary = uniqueTexts(
      value?.primaryReviewerPubkeys,
      1,
      20,
      44,
      'governance_grant_reviewer_authority_invalid',
    ).sort();
    const alternates = uniqueTexts(
      value?.alternateReviewerPubkeys,
      0,
      20,
      44,
      'governance_grant_reviewer_authority_invalid',
    ).sort();
    const allReviewers = [...primary, ...alternates];
    if (
      new Set(allReviewers).size !== allReviewers.length
      || allReviewers.some((pubkey) => !input.electorate.has(pubkey))
    ) throw new GovernanceGrantAgreementError(400, 'governance_grant_reviewer_authority_invalid');
    const associated = allReviewers.filter((pubkey) => input.recipientOrApplicant.has(pubkey));
    if (associated.some((pubkey) => !input.disclosedActors.has(pubkey))) {
      throw new GovernanceGrantAgreementError(
        409,
        'governance_grant_reviewer_conflict_disclosure_required',
      );
    }
    const recused = allReviewers.filter((pubkey) => input.disclosedActors.has(pubkey)).sort();
    const effective = allReviewers.filter((pubkey) => !input.disclosedActors.has(pubkey));
    const quorum = positiveSafeInteger(
      value?.reviewerQuorum,
      'governance_grant_reviewer_quorum_invalid',
    );
    if (quorum > primary.length || effective.length < quorum) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_reviewer_quorum_unreachable');
    }
    const appealReviewers = [...input.electorate]
      .filter((pubkey) => !allReviewers.includes(pubkey) && !input.recipientOrApplicant.has(pubkey))
      .sort();
    if (appealReviewers.length < 1) {
      throw new GovernanceGrantAgreementError(409, 'governance_grant_appeal_quorum_unreachable');
    }
    const criteria = {
      accept: requiredText(value?.acceptCriteria, 1000, 'governance_grant_milestone_invalid'),
      rework: requiredText(value?.reworkCriteria, 1000, 'governance_grant_milestone_invalid'),
      reject: requiredText(value?.rejectCriteria, 1000, 'governance_grant_milestone_invalid'),
    };
    const maxRevisions = Number(value?.maxRevisions);
    if (!Number.isSafeInteger(maxRevisions) || maxRevisions < 0 || maxRevisions > 10) {
      throw new GovernanceGrantAgreementError(400, 'governance_grant_max_revisions_invalid');
    }
    return {
      id: `milestone-${index + 1}`,
      title,
      deliverable,
      evidenceRequirements,
      deadline: deadline.toISOString(),
      contractualUnits: String(contractualUnits),
      reviewerAuthority: {
        source: 'frozen_governance_snapshot' as const,
        snapshotDigest: input.snapshotDigest,
        primaryReviewerPubkeys: primary,
        alternateReviewerPubkeys: alternates,
        recusedReviewerPubkeys: recused,
        effectiveReviewerPubkeys: effective,
        quorum,
        conflictDisclosureEventIds: input.disclosureEvents
          .filter((event: any) => recused.includes(event.actorPubkey))
          .map((event: any) => String(event.id))
          .sort(),
        unreachable: 'block_activation' as const,
      },
      appealAuthority: {
        source: 'frozen_governance_snapshot' as const,
        snapshotDigest: input.snapshotDigest,
        reviewerPubkeys: appealReviewers,
        excludedOriginalReviewerPubkeys: allReviewers.sort(),
        excludedRecipientOrApplicantPubkeys: [...input.recipientOrApplicant].sort(),
        quorum: 1 as const,
      },
      criteria,
      maxRevisions,
    };
  });
  const allocated = milestones.reduce((sum, milestone) => sum + Number(milestone.contractualUnits), 0);
  if (allocated !== input.contractualBudgetUnits) {
    throw new GovernanceGrantAgreementError(400, 'governance_grant_milestone_budget_conservation_invalid');
  }
  return milestones;
}

function grantLifecycleMatchesAgreement(lifecycle: any, terms: any, value: any): boolean {
  if (
    lifecycle?.schemaVersion !== 1
    || !Array.isArray(lifecycle?.reviews)
    || !Array.isArray(lifecycle?.milestoneResults)
    || !Array.isArray(lifecycle?.trancheIntents)
    || !Array.isArray(lifecycle?.appeals)
    || !Object.prototype.hasOwnProperty.call(lifecycle, 'terminationRequest')
    || !Object.prototype.hasOwnProperty.call(lifecycle, 'termination')
    || !Object.prototype.hasOwnProperty.call(lifecycle, 'outcome')
    || !Number.isSafeInteger(Number(value?.lifecycleVersion))
    || Number(value?.lifecycleVersion) < 1
  ) return false;
  const milestoneIds = new Set(
    Array.isArray(terms?.milestones) ? terms.milestones.map((item: any) => item?.id) : [],
  );
  const seen = new Set<string>();
  let committed = 0;
  for (const intent of lifecycle.trancheIntents) {
    const milestoneId = String(intent?.milestoneId ?? '');
    const units = Number(intent?.amountUnits);
    if (
      !milestoneIds.has(milestoneId)
      || seen.has(milestoneId)
      || !Number.isSafeInteger(units)
      || units <= 0
      || intent?.recipientRef !== value?.recipientRef
      || intent?.budgetUnit !== value?.budgetUnit
      || !['contractual_pending_settlement', 'paid'].includes(String(intent?.status ?? ''))
      || !canonicalRecordDigestMatches(
        intent,
        'alcheme.governance.grant-tranche-intent-v1',
      )
    ) return false;
    if (
      intent.status === 'contractual_pending_settlement'
      && (intent.resourceRef !== null || intent.payoutRef !== null || intent.providerFinality !== null)
    ) return false;
    if (
      intent.status === 'paid'
      && (
        typeof intent.resourceRef !== 'string'
        || !intent.resourceRef
        || typeof intent.payoutRef !== 'string'
        || !intent.payoutRef
        || intent.providerFinality !== 'finalized'
        || !/^[a-f0-9]{64}$/.test(String(intent.providerStateDigest ?? ''))
        || !/^gov_req_[a-f0-9]{56}$/.test(String(intent.sourceRequestId ?? ''))
        || !/^[a-f0-9]{64}$/.test(String(intent.sourceDecisionDigest ?? ''))
        || !Number.isFinite(Date.parse(String(intent.finalizedAt ?? '')))
      )
    ) return false;
    seen.add(milestoneId);
    committed += units;
  }
  if (committed > Number(value?.contractualBudgetUnits)) return false;
  if (
    lifecycle.terminationRequest !== null
    && (
      typeof lifecycle.terminationRequest !== 'object'
      || !String(lifecycle.terminationRequest.caseId ?? '')
      || !/^[a-f0-9]{64}$/.test(String(lifecycle.terminationRequest.proposedTermsDigest ?? ''))
    )
  ) return false;
  if (
    lifecycle.termination !== null
    && (
      typeof lifecycle.termination !== 'object'
      || !canonicalRecordDigestMatches(
        lifecycle.termination,
        'alcheme.governance.grant-termination-v1',
      )
      || lifecycle.termination.recovery?.mode !== 'contractual_manual_claim_only'
      || lifecycle.termination.recovery?.refundExecutable !== false
      || lifecycle.termination.recovery?.clawbackExecutable !== false
      || lifecycle.termination.recovery?.resourceRef !== null
      || lifecycle.termination.recovery?.providerFinality !== null
      || terms?.terminationDeclaration?.ground !== lifecycle.termination.ground
      || terms?.terminationDeclaration?.reason !== lifecycle.termination.reason
      || !Array.isArray(lifecycle.termination.blockedContractualIntentIds)
      || lifecycle.termination.blockedContractualIntentIds.some((id: unknown) => (
        !lifecycle.trancheIntents.some((intent: any) => intent?.id === id)
      ))
      || !Array.isArray(lifecycle.termination.stoppedFutureMilestoneIds)
      || lifecycle.termination.stoppedFutureMilestoneIds.some((id: unknown) => !milestoneIds.has(id))
    )
  ) return false;
  if (
    lifecycle.outcome !== null
    && (
      typeof lifecycle.outcome !== 'object'
      || !/^[a-f0-9]{64}$/.test(String(lifecycle.outcome.digest ?? ''))
      || !canonicalRecordDigestMatches(lifecycle.outcome, 'alcheme.governance.grant-outcome-v1')
      || !Array.isArray(lifecycle.outcome.actualImpact)
      || !Array.isArray(lifecycle.outcome.outstandingObligations)
    )
  ) return false;
  return true;
}

function canonicalRecordDigestMatches(value: any, domain: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { digest, ...facts } = value;
  return typeof digest === 'string'
    && digest === hashCanonicalGovernanceValue(domain, facts);
}

function expectedGrantFundingStatus(paidUnits: number, totalUnits: number): string {
  if (!Number.isSafeInteger(paidUnits) || !Number.isSafeInteger(totalUnits) || totalUnits <= 0) {
    return 'invalid';
  }
  if (paidUnits === 0) return 'unfunded_pending_settlement';
  if (paidUnits < totalUnits) return 'partially_paid';
  if (paidUnits === totalUnits) return 'paid';
  return 'invalid';
}

function frozenElectorate(governanceCase: any): Set<string> {
  const actors = Array.isArray(governanceCase?.primaryRequest?.snapshot?.eligibleActors)
    ? governanceCase.primaryRequest.snapshot.eligibleActors
    : [];
  const pubkeys = actors.flatMap((actor: any) => (
    typeof actor?.pubkey === 'string' && actor.pubkey.trim() ? [actor.pubkey.trim()] : []
  ));
  if (pubkeys.length === 0 || new Set(pubkeys).size !== pubkeys.length) {
    throw new GovernanceGrantAgreementError(409, 'governance_grant_snapshot_invalid');
  }
  return new Set(pubkeys);
}

function grantConflictEvents(governanceCase: any, projectRef: string): any[] {
  const events = Array.isArray(governanceCase?.timelineEvents)
    ? governanceCase.timelineEvents
    : [];
  const byActor = new Map<string, any>();
  for (const event of events) {
    const applies = event?.eventType === 'approval_conflict_disclosed'
      || (event?.eventType === 'grant_reviewer_conflict_disclosed'
        && event?.reviewPublicBasis === grantProjectDisclosureRef(projectRef));
    if (
      !applies
      || event.actorPubkey !== event.subjectPubkey
      || !isConflictReason(event.reason)
      || byActor.has(event.actorPubkey)
    ) continue;
    byActor.set(event.actorPubkey, event);
  }
  return [...byActor.values()].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

async function resolveApplicantPubkeys(tx: any, projectRef: string): Promise<string[]> {
  if (projectRef.startsWith('case:')) {
    const row = await tx.governanceCase.findUnique({
      where: { id: projectRef.slice(5) },
      select: { openedByPubkey: true },
    });
    return row?.openedByPubkey ? [String(row.openedByPubkey)] : [];
  }
  if (projectRef.startsWith('artifact:')) {
    const row = await tx.decisionOutputArtifact.findUnique({
      where: { id: projectRef.slice(9) },
      select: { governanceCase: { select: { openedByPubkey: true } } },
    });
    return row?.governanceCase?.openedByPubkey
      ? [String(row.governanceCase.openedByPubkey)]
      : [];
  }
  const draft = /^draft:(\d+):(\d+)$/.exec(projectRef);
  if (draft) {
    const row = await tx.post.findUnique({
      where: { id: Number(draft[1]) },
      select: { author: { select: { pubkey: true } } },
    });
    return row?.author?.pubkey ? [String(row.author.pubkey)] : [];
  }
  throw new GovernanceGrantAgreementError(409, 'governance_grant_project_source_invalid');
}

function recipientPubkeys(recipientRef: string): string[] {
  const wallet = recipientRef.startsWith('wallet:') ? recipientRef.slice(7) : recipientRef;
  return wallet && wallet.length <= 44 ? [wallet] : [];
}

function grantAgreementMatches(existing: any, expected: any): boolean {
  return existing?.id === expected.id
    && existing?.caseId === expected.caseId
    && existing?.allocationArtifactId === expected.allocationArtifactId
    && existing?.projectRef === expected.projectRef
    && existing?.recipientRef === expected.recipientRef
    && existing?.budgetUnit === expected.budgetUnit
    && String(existing?.contractualBudgetUnits) === expected.contractualBudgetUnits
    && existing?.governingDecisionRequestId === expected.governingDecisionRequestId
    && existing?.governingDecisionDigest === expected.governingDecisionDigest
    && existing?.status === expected.status
    && existing?.fundingStatus === expected.fundingStatus
    && existing?.termsDigest === expected.termsDigest
    && existing?.activationIdempotencyKey === expected.activationIdempotencyKey
    && existing?.activatedByPubkey === expected.activatedByPubkey;
}

function grantAgreementId(artifactId: string, projectRef: string): string {
  const digest = hashCanonicalGovernanceValue('alcheme.governance.grant-agreement-id', {
    artifactId,
    projectRef,
  });
  return `grant_agreement:${digest.slice(0, 56)}`;
}

function grantTimelineEventId(caseId: string, idempotencyKey: string): string {
  return `governance_case_event:${hashCanonicalGovernanceValue(
    'alcheme.governance.grant-conflict-event-id',
    { caseId, idempotencyKey },
  ).slice(0, 56)}`;
}

function grantProjectDisclosureRef(projectRef: string): string {
  return `grant_project:${hashCanonicalGovernanceValue(
    'alcheme.governance.grant-reviewer-conflict-project-v1',
    { projectRef },
  )}`;
}

function positiveSafeInteger(value: unknown, code: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new GovernanceGrantAgreementError(400, code);
  }
  return number;
}

function requiredText(value: unknown, max: number, code: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw new GovernanceGrantAgreementError(400, code);
  return text;
}

function uniqueTexts(
  value: unknown,
  minimum: number,
  maximum: number,
  maxLength: number,
  code: string,
): string[] {
  if (!Array.isArray(value)) throw new GovernanceGrantAgreementError(400, code);
  const values = value.map((item) => requiredText(item, maxLength, code));
  if (values.length < minimum || values.length > maximum || new Set(values).size !== values.length) {
    throw new GovernanceGrantAgreementError(400, code);
  }
  return values;
}

function isConflictReason(value: unknown): value is GovernanceGrantConflictReason {
  return value === 'material_relationship'
    || value === 'financial_interest'
    || value === 'subject_or_recipient'
    || value === 'provider_or_operator_role'
    || value === 'other_public_conflict';
}

function dateTime(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
