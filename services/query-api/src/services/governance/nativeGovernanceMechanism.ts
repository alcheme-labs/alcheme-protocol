import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  evaluateCommitteeMemberThreshold,
  resolveCommitteeMemberThresholdConfig,
  type CommitteeMemberThresholdConfig,
} from './strategies/committeeMemberThreshold';
import type { GovernanceSignalInput, GovernanceStrategyResult } from './strategies/types';
import type {
  GovernanceQuadraticFundingActivationReadiness,
  GovernanceQuadraticVoiceActivationReadiness,
} from './governanceResourceReadiness';

export interface EqualWeightGovernanceMechanismContract {
  schemaVersion: 1;
  kind: 'equal_weight_threshold';
  algorithm: {
    id: 'committee.member_threshold';
    version: '1';
  };
  policy: {
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    configDigest: string;
  };
  parameters: {
    threshold: {
      mode: 'default_majority' | 'fixed_count' | 'unanimity';
      value: number | null;
    };
    voteReplacement: {
      mode: 'not_allowed';
      deadline: 'request_expires_at';
    };
    abstention: {
      participation: 'counts';
      decisionThreshold: 'does_not_count';
    };
    tie: {
      resolution: 'pending_until_request_expires';
      terminalAtDeadline: 'expired';
    };
    earlyFinalization: { mode: 'threshold_reached' };
    voteHistory: {
      mode: 'append_only_first_accepted_signal';
      replacement: 'not_allowed';
    };
    deadline: {
      source: 'request_expires_at';
      instant: string;
    };
    ballotDisclosure: {
      mode: 'public' | 'member' | 'eligible_only' | 'aggregate_until_close' | 'provider_defined';
    };
  };
  inputs: {
    requestId: string;
    electorate: {
      source: 'governance_snapshot';
      snapshotDigest: string;
      weightMode: 'equal_one';
    };
    signals: {
      source: 'governance_signals';
      signalType: 'committee_vote';
      choices: ['approve', 'reject', 'abstain'];
    };
  };
  result: {
    type: 'native_ballot_tally';
    digestDomain: 'alcheme.governance.mechanism-result-v1';
  };
  finality: {
    source: 'governance_decision';
    terminalStates: ['accepted', 'rejected', 'expired', 'cancelled'];
  };
  provider: {
    type: 'alcheme_internal';
    version: 'committee-member-threshold-v1';
    status: 'available';
    mapping: {
      signalType: 'committee_vote';
      choices: {
        approve: 'approve';
        reject: 'reject';
        abstain: 'abstain';
      };
      resultSource: 'governance_decision';
    };
  };
  contractDigest: string;
}

export interface QuadraticVoiceGovernanceMechanismContract {
  schemaVersion: 1;
  kind: 'quadratic_voice_credits';
  algorithm: { id: 'native.quadratic_voice_credits'; version: '1' };
  policy: {
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    configDigest: string;
  };
  parameters: {
    creditBudgetPerActor: number;
    costFormula: 'sum_squared_votes';
    completion: 'all_frozen_electorate_submitted';
    voteReplacement: { mode: 'not_allowed'; deadline: 'request_expires_at' };
    deadline: { source: 'request_expires_at'; instant: string };
    ballotDisclosure: {
      mode: 'public' | 'member' | 'eligible_only' | 'aggregate_until_close' | 'provider_defined';
    };
  };
  inputs: {
    requestId: string;
    electorate: {
      source: 'governance_snapshot';
      snapshotDigest: string;
      creditBudgetSource: 'frozen_policy_rule';
    };
    signals: {
      source: 'governance_signals';
      signalType: 'quadratic_voice_credits';
      choiceSet: Array<{ id: string; label: string }>;
    };
  };
  result: {
    type: 'multi_choice_voice_credit_tally';
    digestDomain: 'alcheme.governance.mechanism-result-v1';
  };
  finality: {
    source: 'governance_decision';
    terminalStates: ['accepted', 'expired', 'cancelled'];
  };
  provider: {
    type: 'alcheme_internal';
    version: 'quadratic-voice-credits-v1';
    status: 'available';
    resource: 'fixed_policy_voice_credit_budget';
    identityBoundary: 'frozen_active_committee_membership';
    globalIdentityUniqueness: 'not_claimed';
    resultSource: 'governance_decision';
    activationReadiness: GovernanceQuadraticVoiceActivationReadiness;
  };
  contractDigest: string;
}

export interface QuadraticFundingGovernanceMechanismContract {
  schemaVersion: 1;
  kind: 'quadratic_funding';
  algorithm: { id: 'native.quadratic_funding'; version: '1' };
  policy: QuadraticVoiceGovernanceMechanismContract['policy'];
  parameters: {
    roundRef: string;
    budgetUnit: string;
    matchingBudget: number;
    commitmentCapPerActorPerProject: number;
    formula: 'integer_sqrt_quadratic_matching';
    rounding: 'largest_remainder_then_project_ref';
    completion: 'all_frozen_electorate_submitted';
    voteReplacement: { mode: 'not_allowed'; deadline: 'request_expires_at' };
    deadline: { source: 'request_expires_at'; instant: string };
    ballotDisclosure: QuadraticVoiceGovernanceMechanismContract['parameters']['ballotDisclosure'];
  };
  inputs: {
    requestId: string;
    electorate: {
      source: 'governance_snapshot';
      snapshotDigest: string;
      identityBoundary: 'frozen_active_committee_membership';
    };
    signals: {
      source: 'governance_signals';
      signalType: 'quadratic_funding';
      projects: Array<{
        id: string; label: string; projectRef: string; recipientRef: string; allocationCap: number;
      }>;
      excludedProjects: Array<{ projectRef: string; reason: string }>;
    };
  };
  result: { type: 'allocation_plan'; digestDomain: 'alcheme.governance.mechanism-result-v1' };
  finality: { source: 'governance_decision'; terminalStates: ['accepted', 'expired', 'cancelled'] };
  provider: {
    type: 'alcheme_internal'; version: 'quadratic-funding-v1'; status: 'available';
    resource: 'signed_unsettled_commitments'; settlement: 'unfunded_pending_settlement';
    resultSource: 'governance_decision';
    activationReadiness: GovernanceQuadraticFundingActivationReadiness;
  };
  contractDigest: string;
}

export type NativeGovernanceMechanismContract =
  | EqualWeightGovernanceMechanismContract
  | QuadraticVoiceGovernanceMechanismContract
  | QuadraticFundingGovernanceMechanismContract;

export interface QuadraticVoiceSignalEvidence {
  schemaVersion: 1;
  mechanism: 'quadratic_voice_credits';
  choiceVector: Array<{ choiceId: string; votes: number }>;
  creditBudget: number;
  cost: number;
  mechanismContractDigest: string;
}

export interface QuadraticFundingSignalEvidence {
  schemaVersion: 1;
  mechanism: 'quadratic_funding';
  commitments: Array<{ projectId: string; amount: number }>;
  budgetUnit: string;
  totalCommitment: number;
  mechanismContractDigest: string;
}

export interface NotApplicableGovernanceMechanism {
  status: 'not_applicable';
  reason: 'snapshot_bound_human_review';
}

interface FrozenMechanismRequest {
  id: string;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  policyVersionRecord?: {
    rules?: unknown;
    configDigest?: string | null;
  } | null;
  snapshot?: { sourceDigest?: string | null } | null;
  expiresAt?: Date | string | null;
  stageRef?: string | null;
  governanceCase?: {
    decisionStagePlan?: unknown;
  } | null;
}

interface EligibleActor {
  pubkey: string;
  role?: string | null;
  weight: string;
  source: string;
  creditBudget?: number | null;
}

export function buildNativeGovernanceMechanismContract(input: {
  requestId: string;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  policyConfigDigest: string;
  policyRules: unknown;
  snapshotDigest: string;
  expiresAt: Date | string | null | undefined;
  mechanism?: {
    kind: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding';
    choiceSet?: Array<{ id: string; label: string }>;
    round?: {
      roundRef: string;
      budgetUnit: string;
      matchingBudget: number;
      commitmentCapPerActorPerProject: number;
      formula: 'integer_sqrt_quadratic_matching';
      rounding: 'largest_remainder_then_project_ref';
      projects: QuadraticFundingGovernanceMechanismContract['inputs']['signals']['projects'];
      excludedProjects: QuadraticFundingGovernanceMechanismContract['inputs']['signals']['excludedProjects'];
    };
  } | null;
  quadraticFundingReadiness?: GovernanceQuadraticFundingActivationReadiness | null;
  quadraticVoiceReadiness?: GovernanceQuadraticVoiceActivationReadiness | null;
}): NativeGovernanceMechanismContract {
  const config = resolveCommitteeMemberThresholdConfig(input.policyRules, input.ruleId);
  if (input.mechanism?.kind === 'quadratic_funding') {
    return buildQuadraticFundingGovernanceMechanismContract(input, config);
  }
  if (input.mechanism?.kind === 'quadratic_voice_credits') {
    return buildQuadraticVoiceGovernanceMechanismContract(input, config);
  }
  const withoutDigest = {
    schemaVersion: 1 as const,
    kind: 'equal_weight_threshold' as const,
    algorithm: {
      id: 'committee.member_threshold' as const,
      version: '1' as const,
    },
    policy: {
      policyId: required(input.policyId, 'governance_mechanism_policy_required'),
      policyVersionId: required(
        input.policyVersionId,
        'governance_mechanism_policy_version_required',
      ),
      policyVersion: positiveInteger(
        input.policyVersion,
        'governance_mechanism_policy_version_invalid',
      ),
      ruleId: required(input.ruleId, 'governance_mechanism_rule_required'),
      configDigest: digest(
        input.policyConfigDigest,
        'governance_mechanism_policy_digest_required',
      ),
    },
    parameters: {
      ...normalizeParameters(config),
      abstention: {
        participation: 'counts' as const,
        decisionThreshold: 'does_not_count' as const,
      },
      tie: {
        resolution: 'pending_until_request_expires' as const,
        terminalAtDeadline: 'expired' as const,
      },
      earlyFinalization: { mode: 'threshold_reached' as const },
      voteHistory: {
        mode: 'append_only_first_accepted_signal' as const,
        replacement: 'not_allowed' as const,
      },
      deadline: {
        source: 'request_expires_at' as const,
        instant: deadlineInstant(input.expiresAt),
      },
      ballotDisclosure: requiredBallotDisclosure(config),
    },
    inputs: {
      requestId: required(input.requestId, 'governance_mechanism_request_required'),
      electorate: {
        source: 'governance_snapshot' as const,
        snapshotDigest: digest(
          input.snapshotDigest,
          'governance_mechanism_snapshot_digest_required',
        ),
        weightMode: 'equal_one' as const,
      },
      signals: {
        source: 'governance_signals' as const,
        signalType: 'committee_vote' as const,
        choices: ['approve', 'reject', 'abstain'] as ['approve', 'reject', 'abstain'],
      },
    },
    result: {
      type: 'native_ballot_tally' as const,
      digestDomain: 'alcheme.governance.mechanism-result-v1' as const,
    },
    finality: {
      source: 'governance_decision' as const,
      terminalStates: [
        'accepted',
        'rejected',
        'expired',
        'cancelled',
      ] as ['accepted', 'rejected', 'expired', 'cancelled'],
    },
    provider: {
      type: 'alcheme_internal' as const,
      version: 'committee-member-threshold-v1' as const,
      status: 'available' as const,
      mapping: {
        signalType: 'committee_vote' as const,
        choices: {
          approve: 'approve' as const,
          reject: 'reject' as const,
          abstain: 'abstain' as const,
        },
        resultSource: 'governance_decision' as const,
      },
    },
  };
  return {
    ...withoutDigest,
    contractDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.mechanism-contract-v1',
      withoutDigest,
    ),
  };
}

function buildQuadraticFundingGovernanceMechanismContract(
  input: Parameters<typeof buildNativeGovernanceMechanismContract>[0],
  config: CommitteeMemberThresholdConfig,
): QuadraticFundingGovernanceMechanismContract {
  const round = input.mechanism?.round;
  const activationReadiness = input.quadraticFundingReadiness;
  if (
    !round
    || !required(round.roundRef, 'governance_qf_round_invalid')
    || !required(round.budgetUnit, 'governance_qf_round_invalid')
    || !Number.isSafeInteger(round.matchingBudget) || round.matchingBudget < 1
    || !Number.isSafeInteger(round.commitmentCapPerActorPerProject)
    || round.commitmentCapPerActorPerProject < 1
    || round.formula !== 'integer_sqrt_quadratic_matching'
    || round.rounding !== 'largest_remainder_then_project_ref'
    || !Array.isArray(round.projects) || round.projects.length < 2
  ) throw new Error('governance_qf_round_invalid');
  if (
    !activationReadiness
    || activationReadiness.schemaVersion !== 1
    || activationReadiness.evaluator?.ref !== 'p06.qf_resource_activation_readiness'
    || activationReadiness.evaluator.version !== 1
    || activationReadiness.nativeMode?.state !== 'available'
    || activationReadiness.nativeMode.input !== 'signed_unsettled_commitments'
    || activationReadiness.nativeMode.donationFinality !== 'not_applicable_commitment_is_not_funding'
    || activationReadiness.nativeMode.matchingBudget !== 'contractual_allocation_unit_only'
    || activationReadiness.nativeMode.payoutIntent !== 'forbidden'
    || !['setup_required', 'ready'].includes(activationReadiness.resourceFundedMode?.state)
    || !['blocked', 'ready'].includes(activationReadiness.resourceFundedMode?.activation)
    || activationReadiness.resourceFundedMode.payoutIntent !== 'not_created'
    || !Array.isArray(activationReadiness.resourceFundedMode.blockerCodes)
    || !digest(activationReadiness.sourceDigest, 'governance_qf_activation_readiness_invalid')
    || !digest(activationReadiness.evaluationDigest, 'governance_qf_activation_readiness_invalid')
  ) throw new Error('governance_qf_activation_readiness_invalid');
  const withoutDigest = {
    schemaVersion: 1 as const,
    kind: 'quadratic_funding' as const,
    algorithm: { id: 'native.quadratic_funding' as const, version: '1' as const },
    policy: {
      policyId: required(input.policyId, 'governance_mechanism_policy_required'),
      policyVersionId: required(input.policyVersionId, 'governance_mechanism_policy_version_required'),
      policyVersion: positiveInteger(input.policyVersion, 'governance_mechanism_policy_version_invalid'),
      ruleId: required(input.ruleId, 'governance_mechanism_rule_required'),
      configDigest: digest(input.policyConfigDigest, 'governance_mechanism_policy_digest_required'),
    },
    parameters: {
      roundRef: round.roundRef,
      budgetUnit: round.budgetUnit,
      matchingBudget: round.matchingBudget,
      commitmentCapPerActorPerProject: round.commitmentCapPerActorPerProject,
      formula: round.formula,
      rounding: round.rounding,
      completion: 'all_frozen_electorate_submitted' as const,
      voteReplacement: { mode: 'not_allowed' as const, deadline: 'request_expires_at' as const },
      deadline: { source: 'request_expires_at' as const, instant: deadlineInstant(input.expiresAt) },
      ballotDisclosure: requiredBallotDisclosure(config),
    },
    inputs: {
      requestId: required(input.requestId, 'governance_mechanism_request_required'),
      electorate: {
        source: 'governance_snapshot' as const,
        snapshotDigest: digest(input.snapshotDigest, 'governance_mechanism_snapshot_digest_required'),
        identityBoundary: 'frozen_active_committee_membership' as const,
      },
      signals: {
        source: 'governance_signals' as const,
        signalType: 'quadratic_funding' as const,
        projects: round.projects.map((project) => ({ ...project })),
        excludedProjects: Array.isArray(round.excludedProjects)
          ? round.excludedProjects.map((project) => ({ ...project }))
          : [],
      },
    },
    result: { type: 'allocation_plan' as const, digestDomain: 'alcheme.governance.mechanism-result-v1' as const },
    finality: {
      source: 'governance_decision' as const,
      terminalStates: ['accepted', 'expired', 'cancelled'] as ['accepted', 'expired', 'cancelled'],
    },
    provider: {
      type: 'alcheme_internal' as const,
      version: 'quadratic-funding-v1' as const,
      status: 'available' as const,
      resource: 'signed_unsettled_commitments' as const,
      settlement: 'unfunded_pending_settlement' as const,
      resultSource: 'governance_decision' as const,
      activationReadiness,
    },
  };
  return {
    ...withoutDigest,
    contractDigest: hashCanonicalGovernanceValue('alcheme.governance.mechanism-contract-v1', withoutDigest),
  };
}

function buildQuadraticVoiceGovernanceMechanismContract(
  input: Parameters<typeof buildNativeGovernanceMechanismContract>[0],
  config: CommitteeMemberThresholdConfig,
): QuadraticVoiceGovernanceMechanismContract {
  const creditBudgetPerActor = config.quadraticVoiceCredits?.budgetPerActor;
  const activationReadiness = input.quadraticVoiceReadiness;
  if (!Number.isSafeInteger(creditBudgetPerActor) || Number(creditBudgetPerActor) < 1) {
    throw new Error('governance_qv_credit_budget_required');
  }
  if (
    !activationReadiness
    || activationReadiness.schemaVersion !== 1
    || activationReadiness.evaluator?.ref !== 'p06.qv_resource_activation_readiness'
    || activationReadiness.evaluator.version !== 1
    || activationReadiness.nativeMode?.state !== 'available'
    || activationReadiness.nativeMode.budgetSource !== 'frozen_policy_rule'
    || activationReadiness.nativeMode.creditBudgetPerActor !== Number(creditBudgetPerActor)
    || activationReadiness.nativeMode.tokenOrAssetBalanceUsed !== false
    || !['setup_required', 'ready'].includes(activationReadiness.externalResourceMode?.state)
    || !['blocked', 'ready'].includes(activationReadiness.externalResourceMode?.activation)
    || !Array.isArray(activationReadiness.externalResourceMode.blockerCodes)
    || !digest(activationReadiness.sourceDigest, 'governance_qv_activation_readiness_invalid')
    || !digest(activationReadiness.evaluationDigest, 'governance_qv_activation_readiness_invalid')
  ) throw new Error('governance_qv_activation_readiness_invalid');
  const choiceSet = input.mechanism?.choiceSet;
  if (
    !Array.isArray(choiceSet)
    || choiceSet.length < 2
    || new Set(choiceSet.map((choice) => choice.id)).size !== choiceSet.length
    || choiceSet.some((choice) => !required(choice.id, 'governance_qv_choice_set_invalid')
      || !required(choice.label, 'governance_qv_choice_set_invalid'))
  ) {
    throw new Error('governance_qv_choice_set_invalid');
  }
  const withoutDigest = {
    schemaVersion: 1 as const,
    kind: 'quadratic_voice_credits' as const,
    algorithm: { id: 'native.quadratic_voice_credits' as const, version: '1' as const },
    policy: {
      policyId: required(input.policyId, 'governance_mechanism_policy_required'),
      policyVersionId: required(input.policyVersionId, 'governance_mechanism_policy_version_required'),
      policyVersion: positiveInteger(input.policyVersion, 'governance_mechanism_policy_version_invalid'),
      ruleId: required(input.ruleId, 'governance_mechanism_rule_required'),
      configDigest: digest(input.policyConfigDigest, 'governance_mechanism_policy_digest_required'),
    },
    parameters: {
      creditBudgetPerActor: Number(creditBudgetPerActor),
      costFormula: 'sum_squared_votes' as const,
      completion: 'all_frozen_electorate_submitted' as const,
      voteReplacement: {
        mode: 'not_allowed' as const,
        deadline: 'request_expires_at' as const,
      },
      deadline: {
        source: 'request_expires_at' as const,
        instant: deadlineInstant(input.expiresAt),
      },
      ballotDisclosure: requiredBallotDisclosure(config),
    },
    inputs: {
      requestId: required(input.requestId, 'governance_mechanism_request_required'),
      electorate: {
        source: 'governance_snapshot' as const,
        snapshotDigest: digest(input.snapshotDigest, 'governance_mechanism_snapshot_digest_required'),
        creditBudgetSource: 'frozen_policy_rule' as const,
      },
      signals: {
        source: 'governance_signals' as const,
        signalType: 'quadratic_voice_credits' as const,
        choiceSet: choiceSet.map((choice) => ({ id: choice.id, label: choice.label })),
      },
    },
    result: {
      type: 'multi_choice_voice_credit_tally' as const,
      digestDomain: 'alcheme.governance.mechanism-result-v1' as const,
    },
    finality: {
      source: 'governance_decision' as const,
      terminalStates: ['accepted', 'expired', 'cancelled'] as ['accepted', 'expired', 'cancelled'],
    },
    provider: {
      type: 'alcheme_internal' as const,
      version: 'quadratic-voice-credits-v1' as const,
      status: 'available' as const,
      resource: 'fixed_policy_voice_credit_budget' as const,
      identityBoundary: 'frozen_active_committee_membership' as const,
      globalIdentityUniqueness: 'not_claimed' as const,
      resultSource: 'governance_decision' as const,
      activationReadiness,
    },
  };
  return {
    ...withoutDigest,
    contractDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.mechanism-contract-v1',
      withoutDigest,
    ),
  };
}

export function notApplicableReviewMechanism(): NotApplicableGovernanceMechanism {
  return {
    status: 'not_applicable',
    reason: 'snapshot_bound_human_review',
  };
}

export function evaluateFrozenNativeGovernanceMechanism(input: {
  request: FrozenMechanismRequest;
  eligibleActors: EligibleActor[];
  signals: GovernanceSignalInput[];
}): GovernanceStrategyResult {
  const contract = resolveFrozenNativeGovernanceMechanism(input.request);
  const evaluated = contract.kind === 'quadratic_voice_credits'
    ? evaluateQuadraticVoiceCredits(contract, input.eligibleActors, input.signals)
    : contract.kind === 'quadratic_funding'
      ? evaluateQuadraticFunding(contract, input.eligibleActors, input.signals)
      : evaluateCommitteeMemberThreshold({
      config: resolveCommitteeMemberThresholdConfig(
        input.request.policyVersionRecord?.rules,
        input.request.ruleId,
      ),
      eligibleActors: input.eligibleActors,
      signals: input.signals,
    });
  const tally = evaluated.tally ?? {};
  const resultDigest = hashCanonicalGovernanceValue(
    contract.result.digestDomain,
    {
      contractDigest: contract.contractDigest,
      evaluatorState: evaluated.state,
      evaluatorReason: evaluated.reason,
      tally,
    },
  );
  return {
    ...evaluated,
    tally: {
      ...tally,
      mechanism: {
        schemaVersion: contract.schemaVersion,
        kind: contract.kind,
        algorithm: contract.algorithm,
        contractDigest: contract.contractDigest,
        resultDigest,
        evaluatorState: evaluated.state,
        evaluatorReason: evaluated.reason,
      },
    },
  };
}

function evaluateQuadraticFunding(
  contract: QuadraticFundingGovernanceMechanismContract,
  eligibleActors: EligibleActor[],
  signals: GovernanceSignalInput[],
): GovernanceStrategyResult {
  const eligible = [...new Map(eligibleActors.map((actor) => [actor.pubkey, actor])).values()]
    .sort((left, right) => left.pubkey.localeCompare(right.pubkey));
  const submissions = new Map<string, QuadraticFundingSignalEvidence & { actorPubkey: string; signalId: string | null }>();
  const invalidSignalIds: string[] = [];
  for (const signal of signals) {
    const actor = eligible.find((candidate) => candidate.pubkey === signal.actorPubkey);
    if (!actor || submissions.has(actor.pubkey)) continue;
    try {
      if (signal.signalType !== 'quadratic_funding' || signal.value !== 'quadratic_funding') {
        throw new Error('governance_qf_signal_type_invalid');
      }
      submissions.set(actor.pubkey, {
        ...normalizeQuadraticFundingSignalEvidence(contract, signal.evidence),
        actorPubkey: actor.pubkey,
        signalId: signal.id ?? null,
      });
    } catch {
      invalidSignalIds.push(String(signal.id ?? ''));
    }
  }
  const projects = contract.inputs.signals.projects.map((project) => {
    const amounts = [...submissions.values()].map((submission) =>
      submission.commitments.find((item) => item.projectId === project.id)?.amount ?? 0);
    const contributionUnits = amounts.reduce((sum, amount) => sum + amount, 0);
    const sqrtSum = amounts.reduce((sum, amount) => sum + integerSqrt(amount), 0);
    return {
      ...project,
      donorCount: amounts.filter((amount) => amount > 0).length,
      contributionUnits,
      matchingScore: Math.max(0, sqrtSum * sqrtSum - contributionUnits),
    };
  });
  const allocations = allocateMatchingBudget(projects, contract.parameters.matchingBudget);
  const allocationById = new Map(allocations.map((item) => [item.projectId, item.matchingAllocationUnits]));
  const allocationProjects = projects.map((project) => ({
    ...project,
    matchingAllocationUnits: allocationById.get(project.id) ?? 0,
    totalPlannedUnits: project.contributionUnits + (allocationById.get(project.id) ?? 0),
  }));
  const allocatedMatchingUnits = allocationProjects.reduce((sum, project) => sum + project.matchingAllocationUnits, 0);
  const complete = eligible.length > 0 && submissions.size === eligible.length;
  const contributionSnapshot = eligible.flatMap((actor) => {
    const submission = submissions.get(actor.pubkey);
    return submission ? [{
      actorPubkey: actor.pubkey,
      signalId: submission.signalId,
      commitments: submission.commitments,
      totalCommitment: submission.totalCommitment,
    }] : [];
  });
  return {
    state: complete ? 'accepted' : 'active',
    reason: complete ? 'all_eligible_qf_commitments_recorded' : 'awaiting_eligible_qf_commitments',
    tally: {
      resultType: 'allocation_plan',
      roundRef: contract.parameters.roundRef,
      budgetUnit: contract.parameters.budgetUnit,
      matchingBudget: contract.parameters.matchingBudget,
      formula: contract.parameters.formula,
      rounding: contract.parameters.rounding,
      eligible: eligible.length,
      submitted: submissions.size,
      pending: eligible.length - submissions.size,
      candidateSnapshot: {
        source: 'human_case_intake',
        eligibleProjects: contract.inputs.signals.projects,
        excludedProjects: contract.inputs.signals.excludedProjects,
        aiAuthority: 'none',
      },
      contributionSnapshot,
      contributionSnapshotDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.qf-contribution-snapshot-v1', contributionSnapshot,
      ),
      projects: allocationProjects,
      allocatedMatchingUnits,
      unallocatedMatchingUnits: contract.parameters.matchingBudget - allocatedMatchingUnits,
      settlement: {
        funding: 'unfunded',
        state: 'pending_settlement',
        resourceRef: null,
        escrowRef: null,
        payoutRef: null,
        providerFinality: null,
      },
      invalidSignalIds: invalidSignalIds.filter(Boolean).sort(),
    },
  };
}

export function normalizeQuadraticFundingSignalEvidence(
  contract: QuadraticFundingGovernanceMechanismContract,
  value: unknown,
): QuadraticFundingSignalEvidence {
  const evidence = asRecord(value);
  const raw = Array.isArray(evidence.commitments) ? evidence.commitments : [];
  const commitments = raw.map((item) => ({
    projectId: String(asRecord(item).projectId ?? ''),
    amount: Number(asRecord(item).amount),
  }));
  const projectIds = contract.inputs.signals.projects.map((project) => project.id);
  const totalCommitment = commitments.reduce((sum, item) => sum + item.amount, 0);
  if (
    evidence.schemaVersion !== 1
    || evidence.mechanism !== 'quadratic_funding'
    || evidence.mechanismContractDigest !== contract.contractDigest
    || evidence.budgetUnit !== contract.parameters.budgetUnit
    || Number(evidence.totalCommitment) !== totalCommitment
    || commitments.length !== projectIds.length
    || commitments.some((item, index) => item.projectId !== projectIds[index]
      || !Number.isSafeInteger(item.amount) || item.amount < 0
      || item.amount > contract.parameters.commitmentCapPerActorPerProject)
    || !commitments.some((item) => item.amount > 0)
  ) throw new Error('governance_qf_signal_invalid');
  return {
    schemaVersion: 1,
    mechanism: 'quadratic_funding',
    commitments,
    budgetUnit: contract.parameters.budgetUnit,
    totalCommitment,
    mechanismContractDigest: contract.contractDigest,
  };
}

function integerSqrt(value: number): number {
  return Math.floor(Math.sqrt(value));
}

function allocateMatchingBudget(
  projects: Array<{ id: string; projectRef: string; allocationCap: number; matchingScore: number }>,
  budget: number,
): Array<{ projectId: string; matchingAllocationUnits: number }> {
  const allocated = new Map(projects.map((project) => [project.id, 0]));
  let remaining = budget;
  while (remaining > 0) {
    const active = projects.filter((project) => project.matchingScore > 0
      && (allocated.get(project.id) ?? 0) < project.allocationCap);
    const totalScore = active.reduce((sum, project) => sum + project.matchingScore, 0);
    if (active.length === 0 || totalScore <= 0) break;
    const ranked = active.map((project) => {
      const current = allocated.get(project.id) ?? 0;
      const numerator = remaining * project.matchingScore;
      const floorShare = Math.min(project.allocationCap - current, Math.floor(numerator / totalScore));
      return { project, floorShare, remainder: numerator % totalScore };
    });
    const floorTotal = ranked.reduce((sum, item) => sum + item.floorShare, 0);
    for (const item of ranked) {
      allocated.set(item.project.id, (allocated.get(item.project.id) ?? 0) + item.floorShare);
    }
    remaining -= floorTotal;
    if (remaining <= 0) break;
    const remainderRank = ranked
      .filter((item) => (allocated.get(item.project.id) ?? 0) < item.project.allocationCap)
      .sort((left, right) => right.remainder - left.remainder
        || left.project.projectRef.localeCompare(right.project.projectRef));
    if (remainderRank.length === 0) break;
    for (const item of remainderRank) {
      if (remaining <= 0) break;
      allocated.set(item.project.id, (allocated.get(item.project.id) ?? 0) + 1);
      remaining -= 1;
    }
  }
  return projects.map((project) => ({
    projectId: project.id,
    matchingAllocationUnits: allocated.get(project.id) ?? 0,
  }));
}

function evaluateQuadraticVoiceCredits(
  contract: QuadraticVoiceGovernanceMechanismContract,
  eligibleActors: EligibleActor[],
  signals: GovernanceSignalInput[],
): GovernanceStrategyResult {
  const eligible = [...new Map(eligibleActors.map((actor) => [actor.pubkey, actor])).values()]
    .sort((left, right) => left.pubkey.localeCompare(right.pubkey));
  const submissions = new Map<string, {
    signalId: string | null;
    actorPubkey: string;
    creditBudget: number;
    cost: number;
    choiceVector: Array<{ choiceId: string; votes: number }>;
  }>();
  const invalidSignalIds: string[] = [];
  for (const signal of signals) {
    const actor = eligible.find((candidate) => candidate.pubkey === signal.actorPubkey);
    if (!actor || submissions.has(actor.pubkey)) continue;
    let evidence: QuadraticVoiceSignalEvidence;
    try {
      if (signal.signalType !== 'quadratic_voice_credits' || signal.value !== 'quadratic_voice_credits') {
        throw new Error('governance_qv_signal_type_invalid');
      }
      evidence = normalizeQuadraticVoiceSignalEvidence(contract, signal.evidence);
    } catch {
      invalidSignalIds.push(String(signal.id ?? ''));
      continue;
    }
    submissions.set(actor.pubkey, {
      signalId: signal.id ?? null,
      actorPubkey: actor.pubkey,
      creditBudget: evidence.creditBudget,
      cost: evidence.cost,
      choiceVector: evidence.choiceVector,
    });
  }
  const choices = contract.inputs.signals.choiceSet.map((choice) => ({
    ...choice,
    votes: [...submissions.values()].reduce(
      (sum, submission) => sum + (submission.choiceVector.find((item) => item.choiceId === choice.id)?.votes ?? 0),
      0,
    ),
  }));
  const complete = eligible.length > 0 && submissions.size === eligible.length;
  return {
    state: complete ? 'accepted' : 'active',
    reason: complete ? 'all_eligible_qv_signals_recorded' : 'awaiting_eligible_qv_signals',
    tally: {
      resultType: 'multi_choice_voice_credit_tally',
      eligible: eligible.length,
      submitted: submissions.size,
      pending: eligible.length - submissions.size,
      creditBudgetPerActor: contract.parameters.creditBudgetPerActor,
      costFormula: contract.parameters.costFormula,
      choices,
      submissions: eligible.flatMap((actor) => {
        const submission = submissions.get(actor.pubkey);
        return submission ? [submission] : [];
      }),
      invalidSignalIds: invalidSignalIds.filter(Boolean).sort(),
    },
  };
}

export function normalizeQuadraticVoiceSignalEvidence(
  contract: QuadraticVoiceGovernanceMechanismContract,
  value: unknown,
): QuadraticVoiceSignalEvidence {
  const evidence = asRecord(value);
  const rawVector = Array.isArray(evidence.choiceVector) ? evidence.choiceVector : [];
  const choiceVector = rawVector.map((item) => ({
    choiceId: String(asRecord(item).choiceId ?? ''),
    votes: Number(asRecord(item).votes),
  }));
  const choiceIds = contract.inputs.signals.choiceSet.map((choice) => choice.id);
  const creditBudget = Number(evidence.creditBudget);
  const cost = choiceVector.reduce((sum, item) => sum + item.votes * item.votes, 0);
  if (
    evidence.schemaVersion !== 1
    || evidence.mechanism !== 'quadratic_voice_credits'
    || evidence.mechanismContractDigest !== contract.contractDigest
    || creditBudget !== contract.parameters.creditBudgetPerActor
    || Number(evidence.cost) !== cost
    || choiceVector.length !== choiceIds.length
    || choiceVector.some((item, index) => (
      item.choiceId !== choiceIds[index]
      || !Number.isSafeInteger(item.votes)
      || item.votes < 0
    ))
    || !choiceVector.some((item) => item.votes > 0)
    || cost > creditBudget
  ) {
    throw new Error('governance_qv_signal_invalid');
  }
  return {
    schemaVersion: 1,
    mechanism: 'quadratic_voice_credits',
    choiceVector,
    creditBudget,
    cost,
    mechanismContractDigest: contract.contractDigest,
  };
}

export function verifyFrozenNativeGovernanceMechanismResult(input: {
  request: FrozenMechanismRequest & {
    signals?: GovernanceSignalInput[] | null;
    snapshot?: ({
      sourceDigest?: string | null;
      eligibleActors?: EligibleActor[] | null;
    }) | null;
    decision?: {
      tally?: unknown;
    } | null;
  };
}): {
  status: 'pending' | 'verified' | 'invalid';
  contractDigest: string;
  resultDigest: string | null;
} {
  const contract = resolveFrozenNativeGovernanceMechanism(input.request);
  if (!input.request.decision) {
    return {
      status: 'pending',
      contractDigest: contract.contractDigest,
      resultDigest: null,
    };
  }
  const evaluated = evaluateFrozenNativeGovernanceMechanism({
    request: input.request,
    eligibleActors: Array.isArray(input.request.snapshot?.eligibleActors)
      ? input.request.snapshot.eligibleActors
      : [],
    signals: Array.isArray(input.request.signals) ? input.request.signals : [],
  });
  const expectedTally = evaluated.tally ?? {};
  const storedTally = asRecord(input.request.decision.tally);
  const resultDigest = String(asRecord(expectedTally.mechanism).resultDigest ?? '');
  const verified = /^[a-f0-9]{64}$/.test(resultDigest)
    && hashCanonicalGovernanceValue(
      'alcheme.governance.mechanism-result-readback-v1',
      expectedTally,
    ) === hashCanonicalGovernanceValue(
      'alcheme.governance.mechanism-result-readback-v1',
      storedTally,
    );
  return {
    status: verified ? 'verified' : 'invalid',
    contractDigest: contract.contractDigest,
    resultDigest: resultDigest || null,
  };
}

export function resolveFrozenNativeGovernanceMechanism(
  request: FrozenMechanismRequest,
): NativeGovernanceMechanismContract {
  const plan = asRecord(request.governanceCase?.decisionStagePlan);
  const stages = Array.isArray(plan.stages) ? plan.stages : [];
  const approval = stages.find((stage) => (
    asRecord(stage).purpose === 'approval'
    && asRecord(stage).stageRef === request.stageRef
  ));
  const stored = asRecord(asRecord(approval).mechanism);
  if (
    stored.schemaVersion !== 1
    || (stored.kind !== 'equal_weight_threshold'
      && stored.kind !== 'quadratic_voice_credits'
      && stored.kind !== 'quadratic_funding')
  ) {
    throw new Error('governance_request_mechanism_contract_required');
  }
  const expected = buildNativeGovernanceMechanismContract({
    requestId: request.id,
    policyId: request.policyId,
    policyVersionId: request.policyVersionId,
    policyVersion: request.policyVersion,
    ruleId: request.ruleId,
    policyConfigDigest: String(request.policyVersionRecord?.configDigest ?? ''),
    policyRules: request.policyVersionRecord?.rules,
    snapshotDigest: String(request.snapshot?.sourceDigest ?? ''),
    expiresAt: request.expiresAt,
    quadraticFundingReadiness: stored.kind === 'quadratic_funding'
      ? asRecord(stored.provider).activationReadiness as GovernanceQuadraticFundingActivationReadiness
      : null,
    quadraticVoiceReadiness: stored.kind === 'quadratic_voice_credits'
      ? asRecord(stored.provider).activationReadiness as GovernanceQuadraticVoiceActivationReadiness
      : null,
    mechanism: stored.kind === 'quadratic_voice_credits'
      ? {
        kind: 'quadratic_voice_credits',
        choiceSet: Array.isArray(asRecord(asRecord(stored.inputs).signals).choiceSet)
          ? asRecord(asRecord(stored.inputs).signals).choiceSet
          : [],
      }
      : stored.kind === 'quadratic_funding'
        ? {
          kind: 'quadratic_funding',
          round: {
            roundRef: String(asRecord(stored.parameters).roundRef ?? ''),
            budgetUnit: String(asRecord(stored.parameters).budgetUnit ?? ''),
            matchingBudget: Number(asRecord(stored.parameters).matchingBudget),
            commitmentCapPerActorPerProject: Number(
              asRecord(stored.parameters).commitmentCapPerActorPerProject,
            ),
            formula: asRecord(stored.parameters).formula as 'integer_sqrt_quadratic_matching',
            rounding: asRecord(stored.parameters).rounding as 'largest_remainder_then_project_ref',
            projects: Array.isArray(asRecord(asRecord(stored.inputs).signals).projects)
              ? asRecord(asRecord(stored.inputs).signals).projects as any
              : [],
            excludedProjects: Array.isArray(asRecord(asRecord(stored.inputs).signals).excludedProjects)
              ? asRecord(asRecord(stored.inputs).signals).excludedProjects as any
              : [],
          },
        }
        : { kind: 'equal_weight_threshold' },
  });
  if (
    stored.contractDigest !== expected.contractDigest
    || hashCanonicalGovernanceValue(
      'alcheme.governance.mechanism-contract-v1',
      omitContractDigest(stored),
    ) !== stored.contractDigest
  ) {
    throw new Error('governance_request_mechanism_contract_mismatch');
  }
  return stored as unknown as NativeGovernanceMechanismContract;
}

function deadlineInstant(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : new Date(String(value ?? ''));
  if (!Number.isFinite(date.getTime())) {
    throw new Error('governance_mechanism_deadline_required');
  }
  return date.toISOString();
}

function normalizeParameters(config: CommitteeMemberThresholdConfig) {
  const mode = config.threshold?.mode ?? 'default_majority';
  return {
    threshold: {
      mode,
      value: mode === 'fixed_count' ? config.threshold?.value ?? null : null,
    },
    voteReplacement: {
      mode: 'not_allowed' as const,
      deadline: 'request_expires_at' as const,
    },
  };
}

function requiredBallotDisclosure(
  config: CommitteeMemberThresholdConfig,
): NonNullable<EqualWeightGovernanceMechanismContract['parameters']['ballotDisclosure']> {
  if (!config.ballotDisclosure) {
    throw new Error('governance_ballot_disclosure_policy_required');
  }
  return { mode: config.ballotDisclosure.mode };
}

function omitContractDigest(value: Record<string, unknown>): Record<string, unknown> {
  const { contractDigest: _contractDigest, ...rest } = value;
  return rest;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function required(value: unknown, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(code);
  return normalized;
}

function digest(value: unknown, code: string): string {
  const normalized = required(value, code);
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function positiveInteger(value: unknown, code: string): number {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) throw new Error(code);
  return normalized;
}
