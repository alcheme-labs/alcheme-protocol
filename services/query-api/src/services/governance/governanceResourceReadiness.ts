import {
  getRealmsProviderTrustProfile,
  RealmsProviderTrustReadiness,
  resolveRealmsProviderTrustReadiness,
} from './realmsProviderTrustProfile';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  isCurrentRealmsVotingPowerSecurityProfile,
  type RealmsVotingPowerSecurityProfile,
} from './realmsDevnetProvider';
import { validRealmsProviderFinalityTransitions } from './realmsProviderFinality';
import { normalizeEmergencyOnchainPauseRecord } from './governanceEmergencyOnchainPause';
import { normalizeProgramUpgradeRecord } from './governanceProgramUpgrade';

const GRANT_SETTLEMENT_READINESS_DOMAIN = 'alcheme.governance.grant-settlement-readiness-v1';
const QF_ACTIVATION_READINESS_DOMAIN = 'alcheme.governance.qf-activation-readiness-v1';
const QV_ACTIVATION_READINESS_DOMAIN = 'alcheme.governance.qv-activation-readiness-v1';

export interface GovernanceQuadraticVoiceActivationReadiness {
  schemaVersion: 1;
  evaluator: { ref: 'p06.qv_resource_activation_readiness'; version: 1 };
  nativeMode: {
    state: 'available';
    budgetSource: 'frozen_policy_rule';
    creditBudgetPerActor: number;
    tokenOrAssetBalanceUsed: false;
  };
  externalResourceMode: {
    state: 'setup_required' | 'ready';
    activation: 'blocked' | 'ready';
    resource: {
      state: 'not_bound' | 'invalid' | 'verified';
      bindingId: string | null;
      chainId: string | null;
      provider: string | null;
      contractVersion: number | null;
      profileRef: string | null;
      profileVersion: number | null;
      resourceRef: string | null;
      verifiedSlot: string | null;
      stateDigest: string | null;
    };
    activationAuthority: {
      state: 'not_bound' | 'invalid' | 'verified';
      bindingRefs: string[];
    };
    budgetReadback: {
      state: 'missing' | 'invalid' | 'verified';
      creditBudgetPerActor: number | null;
      snapshotDigest: string | null;
      slot: string | null;
      stateDigest: string | null;
      finality: 'finalized' | null;
    };
    enforcement: {
      state: 'not_configured' | 'invalid' | 'verified';
      location: 'provider_native' | 'alcheme_gateway_before_signal' | null;
      policyDigest: string | null;
      replayProtection: 'single_active_signal_per_request_actor' | null;
      slot: string | null;
      stateDigest: string | null;
    };
    blockerCodes: string[];
  };
  evaluatedAt: string;
  sourceDigest: string;
  evaluationDigest: string;
}

export async function evaluateGovernanceQuadraticVoiceActivationReadiness(
  prisma: any,
  input: {
    homeIdentityBindingId: string;
    creditBudgetPerActor: number;
    now?: Date;
  },
): Promise<GovernanceQuadraticVoiceActivationReadiness> {
  const now = input.now ?? new Date();
  if (
    typeof input.homeIdentityBindingId !== 'string'
    || input.homeIdentityBindingId.length === 0
    || !Number.isSafeInteger(input.creditBudgetPerActor)
    || input.creditBudgetPerActor < 1
    || !Number.isFinite(now.getTime())
  ) throw new Error('governance_qv_activation_readiness_scope_invalid');
  const candidate = typeof prisma?.governedResourceBinding?.findFirst === 'function'
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: input.homeIdentityBindingId,
        capability: 'quadratic_voice_credits',
        status: 'active',
      },
      include: { authorityBindings: true },
      orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
    })
    : null;
  const resource = candidate
    && candidate.homeIdentityBindingId === input.homeIdentityBindingId
    && candidate.capability === 'quadratic_voice_credits'
    && candidate.status === 'active'
    ? candidate
    : null;
  const qv = asRecord(asRecord(resource?.verification).quadraticVoiceCredits);
  const budget = asRecord(qv.budgetReadback);
  const enforcement = asRecord(qv.enforcement);
  const resourceSlot = positiveIntegerText(resource?.verifiedSlot);
  const resourceStateDigest = digestText(resource?.stateDigest);
  const budgetSlot = positiveIntegerText(budget.slot);
  const budgetStateDigest = digestText(budget.stateDigest);
  const budgetSnapshotDigest = digestText(budget.snapshotDigest);
  const enforcementSlot = positiveIntegerText(enforcement.slot);
  const enforcementStateDigest = digestText(enforcement.stateDigest);
  const enforcementPolicyDigest = digestText(enforcement.policyDigest);
  const resourceVerified = Boolean(
    resource
    && typeof resource.resourceRef === 'string'
    && resource.resourceRef.length > 0
    && Number.isSafeInteger(resource.contractVersion)
    && resource.contractVersion > 0
    && typeof resource.profileRef === 'string'
    && resource.profileRef.length > 0
    && Number.isSafeInteger(resource.profileVersion)
    && resource.profileVersion > 0
    && resourceSlot
    && resourceStateDigest
    && qv.schemaVersion === 1,
  );
  const authorityBindings = resource && Array.isArray(resource.authorityBindings)
    ? resource.authorityBindings
    : [];
  const verifiedAuthorities = resourceVerified
    ? authorityBindings.filter((binding: any) => (
      binding?.homeIdentityBindingId === input.homeIdentityBindingId
      && binding?.network === resource.network
      && binding?.provider === resource.provider
      && binding?.profileRef === resource.profileRef
      && binding?.profileVersion === resource.profileVersion
      && binding?.status === 'active'
      && typeof binding?.currentAuthority === 'string'
      && binding.currentAuthority.length > 0
      && Array.isArray(binding?.allowedOperations)
      && binding.allowedOperations.includes('qv_round_activate')
      && positiveIntegerText(binding?.verifiedSlot) === resourceSlot
      && digestText(binding?.stateDigest) === resourceStateDigest
    ))
    : [];
  const authorityVerified = verifiedAuthorities.length > 0;
  const budgetVerified = Boolean(
    resourceVerified
    && budget.authority === 'independent_provider_readback'
    && budget.finality === 'finalized'
    && Number(budget.creditBudgetPerActor) === input.creditBudgetPerActor
    && budgetSnapshotDigest
    && budgetSlot === resourceSlot
    && budgetStateDigest === resourceStateDigest,
  );
  const location: GovernanceQuadraticVoiceActivationReadiness['externalResourceMode']['enforcement']['location'] =
    enforcement.location === 'provider_native'
      || enforcement.location === 'alcheme_gateway_before_signal'
      ? enforcement.location
      : null;
  const enforcementVerified = Boolean(
    resourceVerified
    && enforcement.state === 'verified'
    && location
    && enforcementPolicyDigest
    && enforcement.replayProtection === 'single_active_signal_per_request_actor'
    && enforcementSlot === resourceSlot
    && enforcementStateDigest === resourceStateDigest,
  );
  const ready = Boolean(resourceVerified && authorityVerified && budgetVerified && enforcementVerified);
  const blockerCodes = ready ? [] : [
    ...(!resource ? ['qv_resource_binding_not_configured'] : resourceVerified ? [] : ['qv_resource_binding_invalid']),
    ...(authorityVerified ? [] : authorityBindings.length > 0 ? ['qv_activation_authority_invalid'] : ['qv_activation_authority_not_configured']),
    ...(budgetVerified ? [] : budget.snapshotDigest || budget.stateDigest ? ['qv_budget_readback_invalid'] : ['qv_budget_readback_missing']),
    ...(enforcementVerified ? [] : enforcement.policyDigest || enforcement.location ? ['qv_external_enforcement_invalid'] : ['qv_external_enforcement_not_configured']),
  ];
  const facts = {
    schemaVersion: 1 as const,
    evaluator: { ref: 'p06.qv_resource_activation_readiness' as const, version: 1 as const },
    nativeMode: {
      state: 'available' as const,
      budgetSource: 'frozen_policy_rule' as const,
      creditBudgetPerActor: input.creditBudgetPerActor,
      tokenOrAssetBalanceUsed: false as const,
    },
    externalResourceMode: {
      state: ready ? 'ready' as const : 'setup_required' as const,
      activation: ready ? 'ready' as const : 'blocked' as const,
      resource: {
        state: resourceVerified ? 'verified' as const : resource ? 'invalid' as const : 'not_bound' as const,
        bindingId: resource?.id ?? null,
        chainId: resource?.network ?? null,
        provider: resource?.provider ?? null,
        contractVersion: resource?.contractVersion ?? null,
        profileRef: resource?.profileRef ?? null,
        profileVersion: resource?.profileVersion ?? null,
        resourceRef: resource?.resourceRef ?? null,
        verifiedSlot: resourceSlot,
        stateDigest: resourceStateDigest,
      },
      activationAuthority: {
        state: authorityVerified ? 'verified' as const : authorityBindings.length > 0 ? 'invalid' as const : 'not_bound' as const,
        bindingRefs: verifiedAuthorities.map((binding: any) => String(binding.id)).sort(),
      },
      budgetReadback: {
        state: budgetVerified ? 'verified' as const : budget.snapshotDigest || budget.stateDigest ? 'invalid' as const : 'missing' as const,
        creditBudgetPerActor: Number.isSafeInteger(Number(budget.creditBudgetPerActor)) ? Number(budget.creditBudgetPerActor) : null,
        snapshotDigest: budgetSnapshotDigest,
        slot: budgetSlot,
        stateDigest: budgetStateDigest,
        finality: budgetVerified ? 'finalized' as const : null,
      },
      enforcement: {
        state: enforcementVerified ? 'verified' as const : enforcement.policyDigest || enforcement.location ? 'invalid' as const : 'not_configured' as const,
        location,
        policyDigest: enforcementPolicyDigest,
        replayProtection: enforcement.replayProtection === 'single_active_signal_per_request_actor'
          ? 'single_active_signal_per_request_actor' as const
          : null,
        slot: enforcementSlot,
        stateDigest: enforcementStateDigest,
      },
      blockerCodes,
    },
    evaluatedAt: now.toISOString(),
  };
  const { evaluatedAt: _evaluatedAt, ...sourceFacts } = facts;
  const sourceDigest = hashCanonicalGovernanceValue('alcheme.governance.qv-activation-readiness-source-v1', sourceFacts);
  return {
    ...facts,
    sourceDigest,
    evaluationDigest: hashCanonicalGovernanceValue(QV_ACTIVATION_READINESS_DOMAIN, { ...facts, sourceDigest }),
  };
}

export interface GovernanceQuadraticFundingActivationReadiness {
  schemaVersion: 1;
  evaluator: {
    ref: 'p06.qf_resource_activation_readiness';
    version: 1;
  };
  nativeMode: {
    state: 'available';
    input: 'signed_unsettled_commitments';
    donationFinality: 'not_applicable_commitment_is_not_funding';
    matchingBudget: 'contractual_allocation_unit_only';
    payoutIntent: 'forbidden';
  };
  resourceFundedMode: {
    state: 'setup_required' | 'ready';
    activation: 'blocked' | 'ready';
    resource: {
      state: 'not_bound' | 'invalid' | 'verified';
      bindingId: string | null;
      chainId: string | null;
      provider: string | null;
      contractVersion: number | null;
      profileRef: string | null;
      profileVersion: number | null;
      resourceRef: string | null;
      verifiedSlot: string | null;
      stateDigest: string | null;
    };
    activationAuthority: {
      state: 'not_bound' | 'invalid' | 'verified';
      bindingRefs: string[];
    };
    donationFinality: {
      state: 'missing' | 'invalid' | 'verified';
      finality: 'finalized' | null;
      slot: string | null;
      stateDigest: string | null;
      snapshotDigest: string | null;
    };
    matchingPool: {
      state: 'not_bound' | 'invalid' | 'verified';
      resourceRef: string | null;
      assetClass: string | null;
      assetRef: string | null;
      availableUnits: string | null;
      slot: string | null;
      stateDigest: string | null;
      finality: 'finalized' | null;
    };
    antiSybil: {
      state: 'not_configured' | 'invalid' | 'verified';
      claimClass: string | null;
      policyDigest: string | null;
      enforcementLocation: 'provider_native' | 'alcheme_gateway_before_signal' | null;
      eligibilitySnapshotDigest: string | null;
      slot: string | null;
      stateDigest: string | null;
    };
    payoutIntent: 'not_created';
    blockerCodes: string[];
  };
  evaluatedAt: string;
  sourceDigest: string;
  evaluationDigest: string;
}

export async function evaluateGovernanceQuadraticFundingActivationReadiness(
  prisma: any,
  input: {
    homeIdentityBindingId: string;
    round: {
      roundRef: string;
      budgetUnit: string;
      matchingBudget: number;
    };
    now?: Date;
  },
): Promise<GovernanceQuadraticFundingActivationReadiness> {
  const now = input.now ?? new Date();
  if (
    typeof input.homeIdentityBindingId !== 'string'
    || input.homeIdentityBindingId.length === 0
    || typeof input.round?.roundRef !== 'string'
    || input.round.roundRef.length === 0
    || typeof input.round?.budgetUnit !== 'string'
    || input.round.budgetUnit.length === 0
    || !Number.isSafeInteger(input.round?.matchingBudget)
    || input.round.matchingBudget <= 0
    || !Number.isFinite(now.getTime())
  ) throw new Error('governance_qf_activation_readiness_scope_invalid');

  const candidate = typeof prisma?.governedResourceBinding?.findFirst === 'function'
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: input.homeIdentityBindingId,
        capability: 'quadratic_funding',
        status: 'active',
      },
      include: { authorityBindings: true },
      orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
    })
    : null;
  const resource = candidate
    && candidate.homeIdentityBindingId === input.homeIdentityBindingId
    && candidate.capability === 'quadratic_funding'
    && candidate.status === 'active'
    ? candidate
    : null;
  const verification = asRecord(resource?.verification);
  const qf = asRecord(verification.quadraticFunding);
  const donation = asRecord(qf.donationSnapshot);
  const matching = asRecord(qf.matchingPool);
  const antiSybil = asRecord(qf.antiSybil);
  const resourceSlot = positiveIntegerText(resource?.verifiedSlot);
  const resourceStateDigest = digestText(resource?.stateDigest);
  const donationSlot = positiveIntegerText(donation.slot);
  const donationStateDigest = digestText(donation.stateDigest);
  const donationSnapshotDigest = digestText(donation.snapshotDigest);
  const matchingSlot = positiveIntegerText(matching.slot);
  const matchingStateDigest = digestText(matching.stateDigest);
  const matchingAvailableUnits = positiveIntegerText(matching.availableUnits);
  const antiSybilSlot = positiveIntegerText(antiSybil.slot);
  const antiSybilStateDigest = digestText(antiSybil.stateDigest);
  const antiSybilPolicyDigest = digestText(antiSybil.policyDigest);
  const eligibilitySnapshotDigest = digestText(antiSybil.eligibilitySnapshotDigest);
  const resourceVerified = Boolean(
    resource
    && typeof resource.resourceRef === 'string'
    && resource.resourceRef.length > 0
    && Number.isSafeInteger(resource.contractVersion)
    && resource.contractVersion > 0
    && typeof resource.profileRef === 'string'
    && resource.profileRef.length > 0
    && Number.isSafeInteger(resource.profileVersion)
    && resource.profileVersion > 0
    && resourceSlot
    && resourceStateDigest
    && qf.schemaVersion === 1
    && qf.roundRef === input.round.roundRef
    && qf.budgetUnit === input.round.budgetUnit,
  );
  const authorityBindings = resource && Array.isArray(resource.authorityBindings)
    ? resource.authorityBindings
    : [];
  const verifiedAuthorities = resourceVerified
    ? authorityBindings.filter((binding: any) => (
      binding?.homeIdentityBindingId === input.homeIdentityBindingId
      && binding?.network === resource.network
      && binding?.provider === resource.provider
      && binding?.profileRef === resource.profileRef
      && binding?.profileVersion === resource.profileVersion
      && binding?.status === 'active'
      && typeof binding?.currentAuthority === 'string'
      && binding.currentAuthority.length > 0
      && Array.isArray(binding?.allowedOperations)
      && binding.allowedOperations.includes('qf_round_activate')
      && positiveIntegerText(binding?.verifiedSlot) === resourceSlot
      && digestText(binding?.stateDigest) === resourceStateDigest
    ))
    : [];
  const authorityVerified = verifiedAuthorities.length > 0;
  const donationVerified = Boolean(
    resourceVerified
    && donation.authority === 'independent_provider_readback'
    && donation.finality === 'finalized'
    && donationSlot === resourceSlot
    && donationStateDigest === resourceStateDigest
    && donationSnapshotDigest,
  );
  const matchingVerified = Boolean(
    resourceVerified
    && matching.finality === 'finalized'
    && typeof matching.resourceRef === 'string'
    && matching.resourceRef.length > 0
    && typeof matching.assetClass === 'string'
    && matching.assetClass.length > 0
    && typeof matching.assetRef === 'string'
    && matching.assetRef.length > 0
    && matchingAvailableUnits
    && BigInt(matchingAvailableUnits) >= BigInt(input.round.matchingBudget)
    && matchingSlot === resourceSlot
    && matchingStateDigest === resourceStateDigest,
  );
  const enforcementLocation: GovernanceQuadraticFundingActivationReadiness['resourceFundedMode']['antiSybil']['enforcementLocation'] = antiSybil.enforcementLocation === 'provider_native'
    || antiSybil.enforcementLocation === 'alcheme_gateway_before_signal'
    ? antiSybil.enforcementLocation
    : null;
  const antiSybilVerified = Boolean(
    resourceVerified
    && antiSybil.state === 'verified'
    && typeof antiSybil.claimClass === 'string'
    && antiSybil.claimClass.length > 0
    && antiSybilPolicyDigest
    && enforcementLocation
    && eligibilitySnapshotDigest
    && antiSybilSlot === resourceSlot
    && antiSybilStateDigest === resourceStateDigest,
  );
  const ready = Boolean(
    resourceVerified
    && authorityVerified
    && donationVerified
    && matchingVerified
    && antiSybilVerified,
  );
  const blockerCodes = ready ? [] : [
    ...(!resource
      ? ['qf_resource_binding_not_configured']
      : resourceVerified ? [] : ['qf_resource_binding_invalid']),
    ...(authorityVerified
      ? []
      : authorityBindings.length > 0
        ? ['qf_activation_authority_invalid']
        : ['qf_activation_authority_not_configured']),
    ...(donationVerified
      ? []
      : donation.slot || donation.stateDigest || donation.snapshotDigest
        ? ['qf_donation_finality_invalid']
        : ['qf_donation_finality_missing']),
    ...(matchingVerified
      ? []
      : matching.resourceRef || matching.assetRef || matching.availableUnits
        ? ['qf_matching_pool_invalid']
        : ['qf_matching_pool_not_bound']),
    ...(antiSybilVerified
      ? []
      : antiSybil.claimClass || antiSybil.policyDigest || antiSybil.eligibilitySnapshotDigest
        ? ['qf_anti_sybil_enforcement_invalid']
        : ['qf_anti_sybil_enforcement_not_configured']),
  ];
  const facts = {
    schemaVersion: 1 as const,
    evaluator: {
      ref: 'p06.qf_resource_activation_readiness' as const,
      version: 1 as const,
    },
    nativeMode: {
      state: 'available' as const,
      input: 'signed_unsettled_commitments' as const,
      donationFinality: 'not_applicable_commitment_is_not_funding' as const,
      matchingBudget: 'contractual_allocation_unit_only' as const,
      payoutIntent: 'forbidden' as const,
    },
    resourceFundedMode: {
      state: ready ? 'ready' as const : 'setup_required' as const,
      activation: ready ? 'ready' as const : 'blocked' as const,
      resource: {
        state: resourceVerified ? 'verified' as const : resource ? 'invalid' as const : 'not_bound' as const,
        bindingId: resource?.id ?? null,
        chainId: resource?.network ?? null,
        provider: resource?.provider ?? null,
        contractVersion: resource?.contractVersion ?? null,
        profileRef: resource?.profileRef ?? null,
        profileVersion: resource?.profileVersion ?? null,
        resourceRef: resource?.resourceRef ?? null,
        verifiedSlot: resourceSlot,
        stateDigest: resourceStateDigest,
      },
      activationAuthority: {
        state: authorityVerified ? 'verified' as const : authorityBindings.length > 0 ? 'invalid' as const : 'not_bound' as const,
        bindingRefs: verifiedAuthorities.map((binding: any) => String(binding.id)).sort(),
      },
      donationFinality: {
        state: donationVerified ? 'verified' as const : donation.slot || donation.stateDigest || donation.snapshotDigest ? 'invalid' as const : 'missing' as const,
        finality: donationVerified ? 'finalized' as const : null,
        slot: donationSlot,
        stateDigest: donationStateDigest,
        snapshotDigest: donationSnapshotDigest,
      },
      matchingPool: {
        state: matchingVerified ? 'verified' as const : matching.resourceRef || matching.assetRef || matching.availableUnits ? 'invalid' as const : 'not_bound' as const,
        resourceRef: typeof matching.resourceRef === 'string' ? matching.resourceRef : null,
        assetClass: typeof matching.assetClass === 'string' ? matching.assetClass : null,
        assetRef: typeof matching.assetRef === 'string' ? matching.assetRef : null,
        availableUnits: matchingAvailableUnits,
        slot: matchingSlot,
        stateDigest: matchingStateDigest,
        finality: matchingVerified ? 'finalized' as const : null,
      },
      antiSybil: {
        state: antiSybilVerified ? 'verified' as const : antiSybil.claimClass || antiSybil.policyDigest || antiSybil.eligibilitySnapshotDigest ? 'invalid' as const : 'not_configured' as const,
        claimClass: typeof antiSybil.claimClass === 'string' ? antiSybil.claimClass : null,
        policyDigest: antiSybilPolicyDigest,
        enforcementLocation,
        eligibilitySnapshotDigest,
        slot: antiSybilSlot,
        stateDigest: antiSybilStateDigest,
      },
      payoutIntent: 'not_created' as const,
      blockerCodes,
    },
    evaluatedAt: now.toISOString(),
  };
  const { evaluatedAt: _evaluatedAt, ...sourceFacts } = facts;
  const sourceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.qf-activation-readiness-source-v1',
    sourceFacts,
  );
  return {
    ...facts,
    sourceDigest,
    evaluationDigest: hashCanonicalGovernanceValue(
      QF_ACTIVATION_READINESS_DOMAIN,
      { ...facts, sourceDigest },
    ),
  };
}

export interface GovernanceGrantSettlementReadiness {
  schemaVersion: 1;
  evaluator: {
    ref: 'p06.grant_settlement_readiness';
    version: 1;
  };
  evaluationVersion: number;
  state: 'setup_required' | 'ready';
  scope: {
    circleId: number;
    homeIdentityBindingId: string;
    agreementId: string;
    allocationArtifactId: string;
    projectRef: string;
    recipientRef: string;
    budgetUnit: string;
    contractualUnits: string;
    termsDigest: string;
    lifecycleDigest: string;
    lifecycleVersion: number;
    governingDecisionRequestId: string;
    governingDecisionDigest: string;
  };
  resource: {
    state: 'not_bound' | 'invalid' | 'verified';
    bindingId: string | null;
    chainId: string | null;
    provider: string | null;
    contractVersion: number | null;
    profileRef: string | null;
    profileVersion: number | null;
    resourceRef: string | null;
    stateDigest: string | null;
    verifiedSlot: string | null;
  };
  authority: {
    state: 'not_bound' | 'invalid' | 'verified';
    operation: 'grant_payout';
    bindingRefs: string[];
  };
  assetAuthority: {
    state: 'not_configured' | 'invalid' | 'verified';
    policyRef: string | null;
    policyDigest: string | null;
  };
  payer: {
    state: 'not_configured' | 'invalid' | 'verified';
    policyRef: string | null;
    policyDigest: string | null;
    fundingBlockerCode: string | null;
  };
  fundingReadback: {
    state: 'missing' | 'invalid' | 'verified';
    availableUnits: string | null;
    slot: string | null;
    stateDigest: string | null;
    finality: 'finalized' | null;
  };
  payout: {
    intent: 'not_created' | 'contractual_pending_settlement' | 'blocked_terminated' | 'paid';
    intentRef: string | null;
    payoutRef: string | null;
    paid: boolean;
    providerFinality: 'finalized' | null;
  };
  blockerCodes: string[];
  evaluatedAt: string;
  sourceDigest: string;
  evaluationDigest: string;
}

export async function evaluateGovernanceGrantSettlementReadiness(
  prisma: any,
  input: {
    agreement: {
      id: string;
      allocationArtifactId: string;
      projectRef: string;
      recipientRef: string;
      budgetUnit: string;
      contractualBudgetUnits: string;
      termsDigest: string;
      lifecycleDigest: string;
      lifecycleVersion: number;
      governingDecisionRequestId: string;
      governingDecisionDigest: string;
      status?: string;
      lifecycle?: unknown;
    };
    homeIdentityBinding: {
      id: string;
      homeType: string;
      homeRef: string;
    };
    evaluationVersion: number;
    now?: Date;
  },
): Promise<GovernanceGrantSettlementReadiness> {
  const now = input.now ?? new Date();
  const circleId = Number(input.homeIdentityBinding?.homeRef);
  if (
    input.homeIdentityBinding?.homeType !== 'circle'
    || !Number.isSafeInteger(circleId)
    || circleId <= 0
    || !Number.isSafeInteger(input.evaluationVersion)
    || input.evaluationVersion <= 0
    || !Number.isFinite(now.getTime())
  ) throw new Error('governance_grant_settlement_readiness_scope_invalid');

  const resourceCandidate = typeof prisma?.governedResourceBinding?.findFirst === 'function'
    ? await prisma.governedResourceBinding.findFirst({
      where: {
        homeIdentityBindingId: input.homeIdentityBinding.id,
        capability: 'grant_settlement',
        status: { in: ['active', 'hold', 'disabled'] },
      },
      include: { authorityBindings: true },
      orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
    })
    : null;
  const resource = resourceCandidate
    && resourceCandidate.homeIdentityBindingId === input.homeIdentityBinding.id
    && resourceCandidate.capability === 'grant_settlement'
    && ['active', 'hold', 'disabled'].includes(resourceCandidate.status)
    ? resourceCandidate
    : null;
  const resourceVerification = asRecord(resource?.verification);
  const attemptRetirement = asRecord(resourceVerification.attemptRetirement);
  const retiredNoEffect = Boolean(
    resource?.status === 'disabled'
    && attemptRetirement.state === 'expired_no_provider_effect'
    && digestText(attemptRetirement.retirementDigest)
    && typeof attemptRetirement.requestId === 'string'
    && typeof attemptRetirement.retiredAt === 'string'
    && Number.isFinite(Date.parse(attemptRetirement.retiredAt)),
  );
  const grantSettlement = asRecord(resourceVerification.grantSettlement);
  const fundingReadback = asRecord(grantSettlement.fundingReadback);
  const resourceSlot = positiveIntegerText(resource?.verifiedSlot);
  const resourceStateDigest = digestText(resource?.stateDigest);
  const fundingSlot = positiveIntegerText(fundingReadback.slot);
  const fundingStateDigest = digestText(fundingReadback.stateDigest);
  const availableUnits = positiveIntegerText(fundingReadback.availableUnits);
  const contractualUnits = positiveIntegerText(input.agreement.contractualBudgetUnits);
  const resourceReadbackVerified = Boolean(
    resource
    && resource.status === 'active'
    && resource.resourceRef
    && Number.isSafeInteger(resource.contractVersion)
    && resource.contractVersion > 0
    && typeof resource.profileRef === 'string'
    && resource.profileRef.length > 0
    && Number.isSafeInteger(resource.profileVersion)
    && resource.profileVersion > 0
    && resourceSlot
    && resourceStateDigest
    && grantSettlement.schemaVersion === 1
    && grantSettlement.budgetUnit === input.agreement.budgetUnit
    && typeof grantSettlement.assetClass === 'string'
    && grantSettlement.assetClass.length > 0
    && typeof grantSettlement.assetRef === 'string'
    && grantSettlement.assetRef.length > 0
  );
  const providerFinalityVerified = resourceReadbackVerified
    && grantSettlement.providerFinality === 'finalized'
    && fundingReadback.finality === 'finalized';
  const fundingVerified = Boolean(
    resourceReadbackVerified
    && providerFinalityVerified
    && fundingReadback.authority === 'independent_provider_readback'
    && availableUnits
    && contractualUnits
    && BigInt(availableUnits) >= BigInt(contractualUnits)
    && fundingSlot === resourceSlot
    && fundingStateDigest === resourceStateDigest
    && typeof fundingReadback.observedAt === 'string'
    && Number.isFinite(Date.parse(fundingReadback.observedAt)),
  );
  const authorityBindings = resource && Array.isArray(resource.authorityBindings)
    ? resource.authorityBindings
    : [];
  const matchingAuthorities = resource
    ? authorityBindings.filter((binding: any) => (
      binding?.homeIdentityBindingId === input.homeIdentityBinding.id
      && binding?.network === resource.network
      && binding?.provider === resource.provider
      && binding?.profileRef === resource.profileRef
      && binding?.profileVersion === resource.profileVersion
      && binding?.status === 'active'
      && typeof binding?.currentAuthority === 'string'
      && binding.currentAuthority.length > 0
      && Array.isArray(binding?.allowedOperations)
      && binding.allowedOperations.includes('grant_payout')
      && positiveIntegerText(binding?.verifiedSlot) === resourceSlot
      && digestText(binding?.stateDigest) === resourceStateDigest
    ))
    : [];
  const authorityVerified = matchingAuthorities.length > 0;
  const [payerCandidate, assetAuthorityCandidate] = resource
    ? await Promise.all([
      retiredNoEffect && typeof prisma?.payerPolicy?.findUnique === 'function'
        ? prisma.payerPolicy.findUnique({
          where: { id: String(attemptRetirement.payerPolicyId ?? '') },
        })
        : typeof prisma?.payerPolicy?.findFirst === 'function'
          ? prisma.payerPolicy.findFirst({
          where: {
            homeIdentityBindingId: input.homeIdentityBinding.id,
            network: resource.network,
            status: 'active',
            fundingBlockerCode: null,
          },
          orderBy: [{ version: 'desc' }],
          })
          : Promise.resolve(null),
      retiredNoEffect && typeof prisma?.assetAuthorityPolicy?.findUnique === 'function'
        ? prisma.assetAuthorityPolicy.findUnique({
          where: { id: String(attemptRetirement.assetAuthorityPolicyId ?? '') },
        })
        : typeof prisma?.assetAuthorityPolicy?.findFirst === 'function'
          ? prisma.assetAuthorityPolicy.findFirst({
          where: {
            homeIdentityBindingId: input.homeIdentityBinding.id,
            network: resource.network,
            assetClass: grantSettlement.assetClass,
            assetRef: grantSettlement.assetRef,
            status: 'active',
          },
          orderBy: [{ version: 'desc' }],
          })
          : Promise.resolve(null),
    ])
    : [null, null];
  const payerScope = asRecord(payerCandidate?.actionScope);
  const payerVerified = Boolean(
    payerCandidate
    && payerCandidate.homeIdentityBindingId === input.homeIdentityBinding.id
    && payerCandidate.network === resource?.network
    && payerCandidate.status === 'active'
    && payerCandidate.fundingBlockerCode === null
    && typeof payerCandidate.feePayerSignerRef === 'string'
    && payerCandidate.feePayerSignerRef.length > 0
    && digestText(payerCandidate.policyDigest)
    && payerScope.schemaVersion === 1
    && payerScope.capability === 'grant_settlement'
    && payerScope.chainId === resource?.network
    && payerScope.profileRef === resource?.profileRef
    && payerScope.profileVersion === resource?.profileVersion
    && Array.isArray(payerScope.allowedOperations)
    && payerScope.allowedOperations.includes('grant_payout'),
  );
  const assetAuthorityVerified = Boolean(
    assetAuthorityCandidate
    && assetAuthorityCandidate.homeIdentityBindingId === input.homeIdentityBinding.id
    && assetAuthorityCandidate.network === resource?.network
    && assetAuthorityCandidate.status === 'active'
    && assetAuthorityCandidate.assetClass === grantSettlement.assetClass
    && assetAuthorityCandidate.assetRef === grantSettlement.assetRef
    && digestText(assetAuthorityCandidate.policyDigest),
  );
  const lifecycle = asRecord(input.agreement.lifecycle);
  const termination = asRecord(lifecycle.termination);
  const terminationRecovery = asRecord(termination.recovery);
  const terminatedManualClaimOnly = Boolean(
    input.agreement.status === 'terminated'
    && terminationRecovery.mode === 'contractual_manual_claim_only'
    && terminationRecovery.refundExecutable === false
    && terminationRecovery.clawbackExecutable === false
    && terminationRecovery.resourceRef === null
    && terminationRecovery.providerFinality === null,
  );
  const ready = Boolean(
    resourceReadbackVerified
    && providerFinalityVerified
    && fundingVerified
    && authorityVerified
    && payerVerified
    && assetAuthorityVerified
    && !terminatedManualClaimOnly,
  );
  const providerFailureBlocker = resourceVerification.failureCode === 'squads_grant_payout_funding_rate_limited'
    ? 'grant_settlement_provider_rate_limited'
    : resourceVerification.failureCode === 'squads_grant_payout_funding_unavailable'
      ? 'grant_settlement_funding_unavailable'
      : null;
  const blockerCodes = ready ? [] : retiredNoEffect ? [
    'grant_settlement_activation_expired_no_effect',
    'grant_settlement_new_request_required',
  ] : [
    ...(!resource
      ? ['grant_settlement_resource_not_bound']
      : resourceReadbackVerified
        ? []
        : ['grant_settlement_resource_readback_invalid']),
    ...(authorityVerified
      ? []
      : authorityBindings.length > 0
        ? ['grant_settlement_resource_authority_invalid']
        : ['grant_settlement_resource_authority_not_bound']),
    ...(assetAuthorityVerified
      ? []
      : assetAuthorityCandidate
        ? ['grant_settlement_asset_authority_invalid']
        : ['grant_settlement_asset_authority_not_configured']),
    ...(payerVerified
      ? []
      : payerCandidate
        ? ['grant_settlement_payer_policy_invalid']
        : ['grant_settlement_payer_policy_not_configured']),
    ...(fundingVerified
      ? []
      : fundingReadback.stateDigest || fundingReadback.availableUnits
        ? ['grant_settlement_funding_readback_invalid']
        : ['grant_settlement_funding_readback_missing']),
    ...(providerFinalityVerified ? [] : ['grant_settlement_provider_finality_missing']),
    ...(resource?.status === 'hold' ? ['grant_settlement_provider_execution_held'] : []),
    ...(providerFailureBlocker ? [providerFailureBlocker] : []),
    ...(terminatedManualClaimOnly ? ['grant_settlement_terminated_manual_claim_only'] : []),
  ];
  const trancheIntents = Array.isArray(lifecycle.trancheIntents) ? lifecycle.trancheIntents : [];
  const latestIntent = trancheIntents.length > 0
    ? asRecord(trancheIntents[trancheIntents.length - 1])
    : null;
  const payoutPaid = latestIntent?.status === 'paid'
    && latestIntent.providerFinality === 'finalized'
    && typeof latestIntent.payoutRef === 'string'
    && latestIntent.payoutRef.length > 0;
  const payoutIntent = payoutPaid
    ? 'paid' as const
    : terminatedManualClaimOnly && latestIntent?.status === 'contractual_pending_settlement'
      ? 'blocked_terminated' as const
    : latestIntent?.status === 'contractual_pending_settlement'
      ? 'contractual_pending_settlement' as const
      : 'not_created' as const;
  const facts = {
    schemaVersion: 1 as const,
    evaluator: {
      ref: 'p06.grant_settlement_readiness' as const,
      version: 1 as const,
    },
    evaluationVersion: input.evaluationVersion,
    state: ready ? 'ready' as const : 'setup_required' as const,
    scope: {
      circleId,
      homeIdentityBindingId: input.homeIdentityBinding.id,
      agreementId: input.agreement.id,
      allocationArtifactId: input.agreement.allocationArtifactId,
      projectRef: input.agreement.projectRef,
      recipientRef: input.agreement.recipientRef,
      budgetUnit: input.agreement.budgetUnit,
      contractualUnits: String(input.agreement.contractualBudgetUnits),
      termsDigest: input.agreement.termsDigest,
      lifecycleDigest: input.agreement.lifecycleDigest,
      lifecycleVersion: input.agreement.lifecycleVersion,
      governingDecisionRequestId: input.agreement.governingDecisionRequestId,
      governingDecisionDigest: input.agreement.governingDecisionDigest,
    },
    resource: {
      state: resourceReadbackVerified ? 'verified' as const : resource ? 'invalid' as const : 'not_bound' as const,
      bindingId: resource?.id ?? null,
      chainId: resource?.network ?? null,
      provider: resource?.provider ?? null,
      contractVersion: resource?.contractVersion ?? null,
      profileRef: resource?.profileRef ?? null,
      profileVersion: resource?.profileVersion ?? null,
      resourceRef: resource?.resourceRef ?? null,
      stateDigest: resourceStateDigest,
      verifiedSlot: resourceSlot,
    },
    authority: {
      state: authorityVerified ? 'verified' as const : authorityBindings.length > 0 ? 'invalid' as const : 'not_bound' as const,
      operation: 'grant_payout' as const,
      bindingRefs: (authorityVerified ? matchingAuthorities : authorityBindings)
        .map((binding: any) => String(binding.id)).sort(),
    },
    assetAuthority: {
      state: assetAuthorityVerified ? 'verified' as const : assetAuthorityCandidate ? 'invalid' as const : 'not_configured' as const,
      policyRef: assetAuthorityCandidate?.id ?? null,
      policyDigest: digestText(assetAuthorityCandidate?.policyDigest),
    },
    payer: {
      state: payerVerified ? 'verified' as const : payerCandidate ? 'invalid' as const : 'not_configured' as const,
      policyRef: payerCandidate?.id ?? null,
      policyDigest: digestText(payerCandidate?.policyDigest),
      fundingBlockerCode: typeof payerCandidate?.fundingBlockerCode === 'string'
        ? payerCandidate.fundingBlockerCode
        : null,
    },
    fundingReadback: {
      state: fundingVerified ? 'verified' as const : fundingReadback.stateDigest || fundingReadback.availableUnits ? 'invalid' as const : 'missing' as const,
      availableUnits,
      slot: fundingSlot,
      stateDigest: fundingStateDigest,
      finality: providerFinalityVerified ? 'finalized' as const : null,
    },
    payout: {
      intent: payoutIntent,
      intentRef: typeof latestIntent?.id === 'string' ? latestIntent.id : null,
      payoutRef: payoutPaid ? String(latestIntent?.payoutRef) : null,
      paid: payoutPaid,
      providerFinality: payoutPaid ? 'finalized' as const : null,
    },
    blockerCodes,
    evaluatedAt: now.toISOString(),
  };
  const {
    evaluationVersion: _evaluationVersion,
    evaluatedAt: _evaluatedAt,
    ...sourceFacts
  } = facts;
  const sourceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.grant-settlement-readiness-source-v1',
    sourceFacts,
  );
  return {
    ...facts,
    sourceDigest,
    evaluationDigest: hashCanonicalGovernanceValue(
      GRANT_SETTLEMENT_READINESS_DOMAIN,
      { ...facts, sourceDigest },
    ),
  };
}

export function validateGovernanceGrantSettlementReadiness(
  value: unknown,
  persisted: {
    digest: unknown;
    version: unknown;
    evaluatedAt: unknown;
  },
): GovernanceGrantSettlementReadiness | null {
  const readiness = asRecord(value);
  const evaluationVersion = Number(persisted.version);
  const evaluatedAt = persisted.evaluatedAt instanceof Date
    ? safeIsoInstant(persisted.evaluatedAt)
    : typeof persisted.evaluatedAt === 'string'
      ? safeIsoInstant(persisted.evaluatedAt)
      : null;
  if (
    readiness.schemaVersion !== 1
    || asRecord(readiness.evaluator).ref !== 'p06.grant_settlement_readiness'
    || asRecord(readiness.evaluator).version !== 1
    || !Number.isSafeInteger(evaluationVersion)
    || evaluationVersion < 1
    || readiness.evaluationVersion !== evaluationVersion
    || readiness.evaluatedAt !== evaluatedAt
    || !['setup_required', 'ready'].includes(String(readiness.state))
    || !Array.isArray(readiness.blockerCodes)
    || readiness.blockerCodes.some((code) => typeof code !== 'string' || code.length === 0)
    || !['not_created', 'contractual_pending_settlement', 'blocked_terminated', 'paid'].includes(
      String(asRecord(readiness.payout).intent),
    )
    || typeof asRecord(readiness.payout).paid !== 'boolean'
    || (asRecord(readiness.payout).providerFinality !== null
      && asRecord(readiness.payout).providerFinality !== 'finalized')
    || (asRecord(readiness.payout).intentRef !== null
      && typeof asRecord(readiness.payout).intentRef !== 'string')
    || (asRecord(readiness.payout).payoutRef !== null
      && typeof asRecord(readiness.payout).payoutRef !== 'string')
    || (asRecord(readiness.payout).intent === 'paid' && (
      asRecord(readiness.payout).paid !== true
      || asRecord(readiness.payout).providerFinality !== 'finalized'
      || typeof asRecord(readiness.payout).payoutRef !== 'string'
    ))
    || (asRecord(readiness.payout).intent !== 'paid' && (
      asRecord(readiness.payout).paid !== false
      || asRecord(readiness.payout).providerFinality !== null
      || asRecord(readiness.payout).payoutRef !== null
    ))
    || !digestText(readiness.sourceDigest)
    || !digestText(readiness.evaluationDigest)
    || readiness.evaluationDigest !== persisted.digest
  ) return null;
  const {
    evaluationDigest,
    sourceDigest,
    evaluationVersion: _evaluationVersion,
    evaluatedAt: _evaluatedAt,
    ...sourceFacts
  } = readiness;
  if (hashCanonicalGovernanceValue(
    'alcheme.governance.grant-settlement-readiness-source-v1',
    sourceFacts,
  ) !== sourceDigest) return null;
  const { evaluationDigest: _digest, ...evaluationFacts } = readiness;
  return hashCanonicalGovernanceValue(
    GRANT_SETTLEMENT_READINESS_DOMAIN,
    evaluationFacts,
  ) === evaluationDigest
    ? readiness as unknown as GovernanceGrantSettlementReadiness
    : null;
}

export interface GovernanceResourceReadiness {
  schemaVersion: 1;
  network: 'solana:localnet';
  state: 'setup_required' | 'ready';
  ordinaryCapabilities: {
    circleCreation: 'resource_not_required';
    nativeGovernance: 'resource_not_required';
  };
  governanceHomeIdentity: 'active' | 'not_configured';
  governedResourceBinding: {
    state: 'not_configured' | 'pending_custody' | 'active' | 'degraded' | 'disabled';
    currentOwner: 'unavailable' | 'governed_resource_binding';
  };
  realmsRuntimeBinding: {
    state: 'not_configured' | 'pending_custody' | 'active' | 'degraded' | 'disabled';
    resourceBindingId: string | null;
    profileRef: string;
    profileVersion: number;
    authorityBindings: Array<{
      role: string;
      keyRef: string;
      publicKey: string | null;
      custodyStatus: string;
      status: string;
    }>;
    payerPolicy: {
      id: string;
      state: string;
      feePayerSignerRef: string | null;
      fundingBlockerCode: string | null;
    } | null;
    applicationIdentity: {
      authMethod: 'openbao_periodic_token';
      credentialRef: string;
      policyName: 'alcheme-realms-devnet-runtime-current';
      tokenPeriodSeconds: 86400;
      lastVerifiedAt: string;
      status: 'verified';
    } | null;
    providerFinality: {
      state: 'finalized';
      transactions: Array<{
        stepId: string;
        signature: string;
        slot: number;
        finalityTransitions: Array<{
          state: 'submitted' | 'confirmed' | 'finalized';
          authority:
            | 'provider_signature_readback'
            | 'solana_rpc_signature_status'
            | 'solana_rpc_finalized_transaction';
          slot?: number;
        }>;
      }>;
    } | null;
    reconciliation: {
      schemaVersion: 1;
      state: 'verified' | 'hold';
      blocker: 'provider_readback_outage' | 'provider_readback_conflict' | null;
      authority: 'independent_provider_readback';
      resourceBindingId: string;
      receiptId: string;
      receiptEvidenceDigest: string;
      expectedStateDigest: string;
      observedStateDigest: string | null;
      observedSlot: number | null;
      observedAt: string;
    } | null;
    votingPowerSecurity: RealmsVotingPowerSecurityProfile | null;
    delegationConformance: {
      schemaVersion: 1;
      state: 'authorized' | 'revoke_pending' | 'completed';
      requestId: string;
      decisionDigest: string;
      delegate: string;
      finalDelegate: null;
      setObservedSlot: number | null;
      revokeObservedSlot: number | null;
      historicalVoteInvariant: 'pending' | 'unchanged';
      providerMapping: 'weaker_provider_delegate_broader_than_vote_only_template_blocked';
      blocker: string | null;
    } | null;
    votingPowerChallenge: {
      schemaVersion: 1;
      state: 'suspended' | 'reopened';
      requestId: string;
      decisionDigest: string;
      suspendedAt: string;
      reopenedAt: string | null;
      preObservedSlot: number;
      postObservedSlot: number | null;
      historicalTallyInvariant: 'pending' | 'unchanged' | 'conflict';
      blocker: 'challenge_resolution_pending' | 'challenge_superseding_snapshot_required' | null;
    } | null;
    providerDisable: {
      schemaVersion: 1;
      state: 'disabled';
      requestId: string;
      decisionDigest: string;
      disabledAt: string;
      reason: 'governed_provider_disable';
      inFlightDispositionDigest: string;
      rollbackPolicy: {
        preSubmit: 'new_governed_restore_requires_independent_readback';
        postSubmit: 'forward_recovery_or_independent_reconciliation_only';
        chainFacts: 'never_rewritten';
        fallback: 'prohibited';
      };
      pauseBoundary: {
        authority: 'resource_pause_separate_from_workflow_freeze';
        workflowFreezeClaimsChainPaused: false;
        effect: 'provider_dispatch_disabled_no_chain_pause_claim';
        providerTransaction: 'not_submitted';
        providerStateReadback: 'canonical_resource_binding_disabled';
        onchainPauseInstruction: 'not_claimed';
        restoreAuthority: 'new_governed_restore_requires_independent_readback';
        rollback: 'forward_recovery_only_chain_facts_never_rewritten';
        fallbackAuthority: 'none';
      };
    } | null;
    emergencyOnchainPause: {
      schemaVersion: 1;
      state:
        | 'paused'
        | 'unpause_due'
        | 'unpause_blocked'
        | 'rollback_failed'
        | 'resumed_via_explicit_unpause'
        | 'resumed_via_onchain_timebound';
      requestId: string;
      decisionDigest: string;
      activatedAt: string;
      maxDurationSeconds: number;
      pauseEndsAt: string;
      pauseEnforcement: 'onchain_timebound' | 'explicit_unpause_required';
      trigger: string;
      scope: string;
      pauseAuthorityRef: string;
      unpauseAuthorityRef: string;
      memberNotificationDigest: string;
      ratificationRequestId: string;
      ratificationDecisionDigest: string;
      recoveryConditionsDigest: string;
      onchainPauseInstruction: 'hosted_app_trust_root.pause_app_trust_root';
      residualRisk: {
        permanentPausePossible: boolean;
        fallbackAuthority: 'none';
        workflowFreezeClaimsChainPaused: false;
        expiredAliasForbidden: true;
        resumedAliasForbidden: true;
      };
    } | null;
    programUpgrade: {
      schemaVersion: 1;
      state: 'verified' | 'finalized' | 'compromised' | 'verification_blocked';
      requestId: string;
      decisionDigest: string;
      upgradePayloadDigest: string;
      codeRelease: {
        repository: string;
        commit: string;
        buildArtifactSha256: string;
        auditStatus: 'passed' | 'waived_with_digest';
      };
      disposition: {
        upgradeAuthorityDisposition: string;
        tempBufferAuthorityRetireExpected: true;
      };
      residualRisk: {
        executedShown: false;
        mismatchOpensIncident: true;
        fallbackAuthority: 'none';
      };
    } | null;
  };
  grantSettlementReadiness: {
    schemaVersion: 1;
    evaluatorRef: 'p06.grant_settlement_readiness';
    evaluatorVersion: 1;
    state: 'not_applicable' | 'setup_required' | 'ready';
    activeAgreementCount: number;
    readyAgreementCount: number;
    setupRequiredAgreementCount: number;
    evaluations: Array<{
      agreementId: string;
      caseId: string;
      trancheIntentId: string | null;
      projectRef: string;
      recipientRef: string;
      budgetUnit: string;
      contractualUnits: string;
      integrity: 'verified' | 'stale' | 'invalid' | 'not_evaluated';
      state: 'setup_required' | 'ready';
      evaluationVersion: number;
      evaluationDigest: string | null;
      evaluatedAt: string | null;
      resource: GovernanceGrantSettlementReadiness['resource'] | null;
      authority: GovernanceGrantSettlementReadiness['authority'] | null;
      assetAuthority: GovernanceGrantSettlementReadiness['assetAuthority'] | null;
      payer: GovernanceGrantSettlementReadiness['payer'] | null;
      fundingReadback: GovernanceGrantSettlementReadiness['fundingReadback'] | null;
      payout: GovernanceGrantSettlementReadiness['payout'] | null;
      activePayoutRequest: {
        id: string;
        state: 'active' | 'accepted';
        openedAt: string;
      } | null;
      blockerCodes: string[];
    }>;
    blockerCodes: string[];
  };
  payerPolicy: {
    state: 'not_configured' | 'present_unverified';
    activeCount: number;
  };
  assetAuthorityPolicy: {
    state: 'not_configured' | 'present_unverified';
    activeCount: number;
  };
  externalResourceActions: 'blocked_setup_required' | 'provider_bound';
  providerExecution: 'unavailable' | 'available';
  authorityVerification: 'not_authorized' | 'authorized';
  realmsProviderTrust: RealmsProviderTrustReadiness;
  blockerCodes: string[];
}

interface GovernanceResourceReadinessPrisma {
  governanceHomeIdentityBinding: {
    findFirst(input: unknown): Promise<{ id: string } | null>;
  };
  payerPolicy: {
    count(input: unknown): Promise<number>;
    findFirst?(input: unknown): Promise<{
      id: string;
      status: string;
      network: string;
      economicBearer: string;
      feePayerSignerRef: string | null;
      rentFundingSourceRef: string | null;
      refundRecipientRef: string | null;
      fundingBlockerCode: string | null;
    } | null>;
  };
  assetAuthorityPolicy: {
    count(input: unknown): Promise<number>;
  };
  governedResourceBinding?: {
    findFirst(input: unknown): Promise<{
      id: string;
      status: string;
      network: string;
      provider: string;
      capability: string;
      contractVersion: number;
      profileRef: string;
      profileVersion: number;
      verification: unknown;
      resourceRef?: string | null;
      stateDigest?: string | null;
      authorityBindings: Array<{
        authorityRole: string;
        keyRef: string;
        currentAuthority: string | null;
        allowedOperations: unknown;
        custodyProvider: string;
        custodyStatus: string;
        custodyVerification: unknown;
        profileRef: string;
        profileVersion: number;
        status: string;
        providerResourceRef?: string | null;
        stateDigest?: string | null;
      }>;
    } | null>;
  };
  governanceGrantAgreement?: {
    findMany(input: unknown): Promise<any[]>;
  };
  governanceRequest?: {
    findMany(input: unknown): Promise<any[]>;
  };
}

export async function resolveGovernanceResourceReadiness(
  prisma: GovernanceResourceReadinessPrisma,
  input: { circleId: number; now?: Date },
): Promise<GovernanceResourceReadiness> {
  if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('governance_resource_readiness_circle_invalid');
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error('governance_resource_readiness_time_invalid');
  }
  const home = await prisma.governanceHomeIdentityBinding.findFirst({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      status: 'active',
      supersededAt: null,
      OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
    },
    orderBy: [{ identityVersion: 'desc' }],
    select: { id: true },
  });
  const [activePayerPolicyCount, activeAssetAuthorityPolicyCount] = home
    ? await Promise.all([
      prisma.payerPolicy.count({
        where: {
          homeIdentityBindingId: home.id,
          network: 'solana:localnet',
          status: 'active',
          supersededAt: null,
          AND: [
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
            { OR: [{ expiry: null }, { expiry: { gt: now } }] },
          ],
        },
      }),
      prisma.assetAuthorityPolicy.count({
        where: {
          homeIdentityBindingId: home.id,
          network: 'solana:localnet',
          status: 'active',
          supersededAt: null,
          OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
        },
      }),
    ])
    : [0, 0];
  const realmsProviderTrust = resolveRealmsProviderTrustReadiness();
  const [realmsBinding, realmsPayerPolicy] = home
    ? await Promise.all([
      prisma.governedResourceBinding?.findFirst({
        where: {
          homeIdentityBindingId: home.id,
          network: 'solana:devnet',
          provider: 'realms',
          capability: 'realms_governance',
          status: { in: ['pending_custody', 'active', 'degraded', 'disabled'] },
        },
        include: {
          authorityBindings: {
            orderBy: { authorityRole: 'asc' },
          },
        },
        orderBy: [{ contractVersion: 'desc' }, { profileVersion: 'desc' }],
      }) ?? Promise.resolve(null),
      prisma.payerPolicy.findFirst?.({
        where: {
          homeIdentityBindingId: home.id,
          network: 'solana:devnet',
          sourceRequestId: { not: null },
          status: 'active',
          supersededAt: null,
        },
        orderBy: [{ version: 'desc' }],
        select: {
          id: true,
          status: true,
          network: true,
          economicBearer: true,
          feePayerSignerRef: true,
          rentFundingSourceRef: true,
          refundRecipientRef: true,
          fundingBlockerCode: true,
        },
      }) ?? Promise.resolve(null),
    ])
    : [null, null];
  const realmsBindingState = realmsBinding?.status === 'active'
    ? 'active'
    : realmsBinding?.status === 'degraded'
      ? 'degraded'
      : realmsBinding?.status === 'disabled'
        ? 'disabled'
      : realmsBinding
        ? 'pending_custody'
        : 'not_configured';
  const authorityBindings = realmsBinding?.authorityBindings ?? [];
  const runtimeOwnerPhase = resolveRealmsRuntimeOwnerPhase(
    realmsBinding,
    realmsPayerPolicy,
    realmsProviderTrust,
  );
  const runtimeOwnerReadbackVerified = runtimeOwnerPhase !== null;
  const providerActive = runtimeOwnerPhase === 'provider_active';
  const realmsVerification = asRecord(realmsBinding?.verification);
  const applicationIdentity = asRecord(realmsVerification.applicationIdentity);
  const reconciliation = resolveRealmsBindingReconciliation(
    realmsVerification.reconciliation,
    realmsBinding?.id ?? null,
  );
  const persistedVotingPowerSecurity = asRecord(realmsVerification.reconciliation)
    .votingPowerSecurity;
  const votingPowerSecurity = (
    providerActive
    && reconciliation?.state === 'verified'
    && isCurrentRealmsVotingPowerSecurityProfile(persistedVotingPowerSecurity)
    && persistedVotingPowerSecurity.source.chainId === realmsBinding?.network
    && persistedVotingPowerSecurity.source.profileRef === realmsBinding?.profileRef
    && persistedVotingPowerSecurity.source.profileVersion === realmsBinding?.profileVersion
    && persistedVotingPowerSecurity.source.realm === realmsBinding?.resourceRef
    && persistedVotingPowerSecurity.source.snapshotSlot === reconciliation.observedSlot
  ) ? persistedVotingPowerSecurity : null;
  const providerDisable = resolveRealmsProviderDisable(
    realmsVerification.providerDisable,
  );
  const lastObservation = asRecord(realmsVerification.emergencyOnchainPauseLastObservation);
  const observedChainPaused = lastObservation.commitment === 'finalized'
    && lastObservation.authoritative === true
    && lastObservation.selfProvesPause === false
    && typeof lastObservation.paused === 'boolean'
    ? Boolean(lastObservation.paused)
    : null;
  const emergencyOnchainPause = normalizeEmergencyOnchainPauseRecord(
    realmsVerification.emergencyOnchainPause,
    { now, chainPaused: observedChainPaused },
  );
  const programUpgrade = normalizeProgramUpgradeRecord(
    realmsVerification.programUpgrade,
  );
  const providerFinality = resolveRealmsProviderFinality(
    realmsVerification.providerReceipt,
  );
  const delegationConformance = resolveRealmsDelegationConformance(
    realmsVerification.delegationConformance,
  );
  const votingPowerChallenge = resolveRealmsVotingPowerChallenge(
    realmsVerification.votingPowerChallenge,
  );
  const providerReady = providerActive && providerFinality !== null;
  const projectedRealmsProviderTrust: RealmsProviderTrustReadiness = runtimeOwnerPhase
    ? {
      ...realmsProviderTrust,
      activation: providerActive ? 'active' : 'not_activated',
      walletCustody: providerActive
        ? 'verified_wallet_keys_provider_active'
        : runtimeOwnerPhase === 'keys_verified'
          ? 'verified_wallet_keys_pending_provider'
          : 'verified_pre_wallet_no_keys',
      keyCustodyRecord: {
        ...realmsProviderTrust.keyCustodyRecord,
        keyContracts: runtimeOwnerPhase === 'keys_verified' || providerActive
          ? authorityBindings.map((binding) => ({
            keyRef: binding.keyRef,
            role: binding.authorityRole as RealmsProviderTrustReadiness['keyCustodyRecord']['keyContracts'][number]['role'],
            allowedOperations: Array.isArray(binding.allowedOperations)
              ? binding.allowedOperations.map(String)
              : [],
            publicKey: binding.currentAuthority,
            status: 'verified' as const,
          }))
          : realmsProviderTrust.keyCustodyRecord.keyContracts,
        status: providerActive
          ? 'verified_wallet_keys_provider_active'
          : runtimeOwnerPhase === 'keys_verified'
            ? 'verified_wallet_keys_pending_provider'
            : 'verified_pre_wallet_no_keys',
        verification: {
          ...realmsProviderTrust.keyCustodyRecord.verification,
          runtimeOwnerReadback: 'verified',
        },
      },
    }
    : realmsProviderTrust;
  const trustBlockers = providerActive ? [] : realmsProviderTrust.blockerCodes.filter((code) => {
    if (
      code === 'realms_key_custody_runtime_owner_readback_required'
      && runtimeOwnerReadbackVerified
    ) return false;
    if (code === 'realms_resource_binding_not_configured' && realmsBinding) return false;
    if (code === 'realms_authority_binding_not_configured' && authorityBindings.length === 5) return false;
    if (code === 'realms_payer_policy_not_configured' && realmsPayerPolicy) return false;
    return true;
  });
  const grantAgreements = home && typeof prisma.governanceGrantAgreement?.findMany === 'function'
    ? await prisma.governanceGrantAgreement.findMany({
      where: {
        governanceCase: { homeIdentityBindingId: home.id },
        status: 'active',
      },
      orderBy: [{ activatedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        caseId: true,
        allocationArtifactId: true,
        projectRef: true,
        recipientRef: true,
        budgetUnit: true,
        contractualBudgetUnits: true,
        termsDigest: true,
        lifecycleDigest: true,
        lifecycleVersion: true,
        lifecycle: true,
        governingDecisionRequestId: true,
        governingDecisionDigest: true,
        settlementReadiness: true,
        settlementReadinessDigest: true,
        settlementReadinessVersion: true,
        settlementReadinessEvaluatedAt: true,
      },
    })
    : [];
  const activeGrantPayoutRequests = home && typeof prisma.governanceRequest?.findMany === 'function'
    ? await prisma.governanceRequest.findMany({
      where: {
        targetType: 'circle',
        targetRef: String(input.circleId),
        actionType: 'circle.grant.payout.execute',
        state: { in: ['active', 'accepted'] },
      },
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        state: true,
        openedAt: true,
        payload: true,
      },
    })
    : [];
  const grantSettlementReadiness = projectCircleGrantSettlementReadiness(
    grantAgreements,
    home?.id ?? null,
    activeGrantPayoutRequests,
  );

  return {
    schemaVersion: 1,
    network: 'solana:localnet',
    state: providerReady ? 'ready' : 'setup_required',
    ordinaryCapabilities: {
      circleCreation: 'resource_not_required',
      nativeGovernance: 'resource_not_required',
    },
    governanceHomeIdentity: home ? 'active' : 'not_configured',
    governedResourceBinding: {
      state: realmsBindingState,
      currentOwner: realmsBinding ? 'governed_resource_binding' : 'unavailable',
    },
    realmsRuntimeBinding: {
      state: realmsBindingState,
      resourceBindingId: realmsBinding?.id ?? null,
      profileRef: realmsBinding?.profileRef ?? realmsProviderTrust.profileRef,
      profileVersion: realmsBinding?.profileVersion ?? realmsProviderTrust.profileVersion,
      authorityBindings: authorityBindings.map((binding) => ({
        role: binding.authorityRole,
        keyRef: binding.keyRef,
        publicKey: binding.currentAuthority,
        custodyStatus: binding.custodyStatus,
        status: binding.status,
      })),
      payerPolicy: realmsPayerPolicy
        ? {
          id: realmsPayerPolicy.id,
          state: realmsPayerPolicy.status,
          feePayerSignerRef: realmsPayerPolicy.feePayerSignerRef,
          fundingBlockerCode: realmsPayerPolicy.fundingBlockerCode,
        }
        : null,
      applicationIdentity: runtimeOwnerPhase === 'keys_verified' || providerActive
        ? {
          authMethod: 'openbao_periodic_token',
          credentialRef: String(applicationIdentity.credentialRef),
          policyName: 'alcheme-realms-devnet-runtime-current',
          tokenPeriodSeconds: 86400,
          lastVerifiedAt: String(applicationIdentity.lastVerifiedAt),
          status: 'verified',
        }
        : null,
      providerFinality,
      reconciliation,
      votingPowerSecurity,
      delegationConformance,
      votingPowerChallenge,
      providerDisable,
      emergencyOnchainPause: emergencyOnchainPause
        ? {
          schemaVersion: 1 as const,
          state: emergencyOnchainPause.state,
          requestId: emergencyOnchainPause.requestId,
          decisionDigest: emergencyOnchainPause.decisionDigest,
          activatedAt: emergencyOnchainPause.activatedAt,
          maxDurationSeconds: emergencyOnchainPause.maxDurationSeconds,
          pauseEndsAt: emergencyOnchainPause.pauseEndsAt,
          pauseEnforcement: emergencyOnchainPause.pauseEnforcement,
          trigger: emergencyOnchainPause.trigger,
          scope: emergencyOnchainPause.scope,
          pauseAuthorityRef: emergencyOnchainPause.pauseAuthorityRef,
          unpauseAuthorityRef: emergencyOnchainPause.unpauseAuthorityRef,
          memberNotificationDigest: emergencyOnchainPause.memberNotificationDigest,
          ratificationRequestId: emergencyOnchainPause.ratificationRequestId,
          ratificationDecisionDigest: emergencyOnchainPause.ratificationDecisionDigest,
          recoveryConditionsDigest: emergencyOnchainPause.recoveryConditionsDigest,
          onchainPauseInstruction: emergencyOnchainPause.onchainPauseInstruction,
          residualRisk: emergencyOnchainPause.residualRisk,
        }
        : null,
      programUpgrade: programUpgrade
        ? {
          schemaVersion: 1 as const,
          state: programUpgrade.state,
          requestId: programUpgrade.requestId,
          decisionDigest: programUpgrade.decisionDigest,
          upgradePayloadDigest: programUpgrade.contract.upgradePayloadDigest,
          codeRelease: {
            repository: programUpgrade.contract.codeRelease.repository,
            commit: programUpgrade.contract.codeRelease.commit,
            buildArtifactSha256: programUpgrade.contract.codeRelease.buildArtifactSha256,
            auditStatus: programUpgrade.contract.codeRelease.auditStatus,
          },
          disposition: programUpgrade.contract.disposition,
          residualRisk: programUpgrade.residualRisk,
        }
        : null,
    },
    grantSettlementReadiness,
    payerPolicy: {
      state: activePayerPolicyCount > 0 ? 'present_unverified' : 'not_configured',
      activeCount: activePayerPolicyCount,
    },
    assetAuthorityPolicy: {
      state: activeAssetAuthorityPolicyCount > 0 ? 'present_unverified' : 'not_configured',
      activeCount: activeAssetAuthorityPolicyCount,
    },
    externalResourceActions: providerReady ? 'provider_bound' : 'blocked_setup_required',
    providerExecution: providerReady ? 'available' : 'unavailable',
    authorityVerification: providerActive ? 'authorized' : 'not_authorized',
    realmsProviderTrust: {
      ...projectedRealmsProviderTrust,
      blockerCodes: trustBlockers,
    },
    blockerCodes: providerReady ? [] : [
      ...(home ? [] : ['governance_home_identity_not_configured']),
      ...(realmsBinding ? [] : ['governed_resource_binding_owner_unavailable']),
      activePayerPolicyCount > 0
        ? 'payer_policy_present_unverified'
        : 'payer_policy_not_configured',
      'fee_payer_preflight_missing',
      activeAssetAuthorityPolicyCount > 0
        ? 'asset_authority_policy_present_unverified'
        : 'asset_authority_policy_not_configured',
      'asset_authority_not_authorized',
      'provider_execution_unavailable',
      ...(realmsBinding && realmsBindingState === 'pending_custody'
        ? ['realms_resource_binding_pending_custody']
        : []),
      ...(realmsBinding && realmsBindingState === 'degraded'
        ? [
          'realms_resource_binding_degraded',
          reconciliation?.blocker ?? 'realms_provider_reconciliation_invalid',
        ]
        : []),
      ...(providerActive && !providerFinality
        ? ['realms_provider_finality_history_invalid']
        : []),
      ...(realmsBinding && realmsBindingState === 'disabled'
        ? [
          'realms_resource_binding_disabled',
          ...(providerDisable ? [] : ['realms_provider_disable_readback_invalid']),
        ]
        : []),
      ...(realmsPayerPolicy
        ? ['realms_payer_policy_pending_wallet']
        : []),
      ...trustBlockers,
    ],
  };
}

function projectCircleGrantSettlementReadiness(
  agreements: any[],
  homeIdentityBindingId: string | null,
  activeGrantPayoutRequests: any[],
): GovernanceResourceReadiness['grantSettlementReadiness'] {
  const evaluations = agreements.map((agreement) => {
    const lifecycle = asRecord(agreement?.lifecycle);
    const trancheIntents = Array.isArray(lifecycle.trancheIntents) ? lifecycle.trancheIntents : [];
    const pendingTrancheIntents = trancheIntents.filter((intent: any) => (
      intent?.status === 'contractual_pending_settlement'
      && typeof intent?.id === 'string'
      && intent.id.trim()
    ));
    const evaluationVersion = Number(agreement?.settlementReadinessVersion ?? 0);
    const readiness = evaluationVersion > 0
      ? validateGovernanceGrantSettlementReadiness(agreement?.settlementReadiness, {
        digest: agreement?.settlementReadinessDigest,
        version: evaluationVersion,
        evaluatedAt: agreement?.settlementReadinessEvaluatedAt,
      })
      : null;
    const scope = readiness?.scope;
    const scopeMatches = Boolean(
      readiness
      && homeIdentityBindingId
      && scope?.homeIdentityBindingId === homeIdentityBindingId
      && scope?.agreementId === agreement?.id
      && scope?.allocationArtifactId === agreement?.allocationArtifactId
      && scope?.projectRef === agreement?.projectRef
      && scope?.recipientRef === agreement?.recipientRef
      && scope?.budgetUnit === agreement?.budgetUnit
      && scope?.contractualUnits === String(agreement?.contractualBudgetUnits ?? '')
      && scope?.termsDigest === agreement?.termsDigest
      && scope?.lifecycleDigest === agreement?.lifecycleDigest
      && scope?.lifecycleVersion === Number(agreement?.lifecycleVersion ?? 0)
      && scope?.governingDecisionRequestId === agreement?.governingDecisionRequestId
      && scope?.governingDecisionDigest === agreement?.governingDecisionDigest,
    );
    const integrity = evaluationVersion === 0
      && agreement?.settlementReadiness == null
      && agreement?.settlementReadinessDigest == null
      && agreement?.settlementReadinessEvaluatedAt == null
      ? 'not_evaluated' as const
      : !readiness
        ? 'invalid' as const
        : scopeMatches
          ? 'verified' as const
          : 'stale' as const;
    const state = integrity === 'verified' && readiness?.state === 'ready'
      ? 'ready' as const
      : 'setup_required' as const;
    const blockerCodes = integrity === 'verified'
      ? readiness?.blockerCodes ?? []
      : [integrity === 'stale'
        ? 'grant_settlement_readiness_stale'
        : integrity === 'invalid'
          ? 'grant_settlement_readiness_invalid'
          : 'grant_settlement_readiness_not_evaluated'];
    const activePayoutRequest = activeGrantPayoutRequests.find((request) => {
      const payload = asRecord(request?.payload);
      const requestAgreement = asRecord(payload.agreement);
      return requestAgreement.id === agreement?.id
        && pendingTrancheIntents.some((intent: any) => (
          intent.id === requestAgreement.trancheIntentId
        ));
    });
    const activePayoutRequestOpenedAt = activePayoutRequest?.openedAt instanceof Date
      ? activePayoutRequest.openedAt
      : new Date(String(activePayoutRequest?.openedAt ?? ''));
    return {
      agreementId: String(agreement?.id ?? ''),
      caseId: String(agreement?.caseId ?? ''),
      trancheIntentId: pendingTrancheIntents.length === 1
        && readiness?.payout.intent === 'contractual_pending_settlement'
        ? String(pendingTrancheIntents[0].id)
        : null,
      projectRef: String(agreement?.projectRef ?? ''),
      recipientRef: String(agreement?.recipientRef ?? ''),
      budgetUnit: String(agreement?.budgetUnit ?? ''),
      contractualUnits: String(agreement?.contractualBudgetUnits ?? ''),
      integrity,
      state,
      evaluationVersion,
      evaluationDigest: readiness?.evaluationDigest ?? null,
      evaluatedAt: readiness?.evaluatedAt ?? null,
      resource: readiness?.resource ?? null,
      authority: readiness?.authority ?? null,
      assetAuthority: readiness?.assetAuthority ?? null,
      payer: readiness?.payer ?? null,
      fundingReadback: readiness?.fundingReadback ?? null,
      payout: readiness?.payout ?? null,
      activePayoutRequest: activePayoutRequest
        && /^gov_req_[a-f0-9]{56}$/.test(String(activePayoutRequest.id ?? ''))
        && ['active', 'accepted'].includes(String(activePayoutRequest.state ?? ''))
        && Number.isFinite(activePayoutRequestOpenedAt.getTime())
        ? {
          id: String(activePayoutRequest.id),
          state: activePayoutRequest.state as 'active' | 'accepted',
          openedAt: activePayoutRequestOpenedAt.toISOString(),
        }
        : null,
      blockerCodes,
    };
  });
  const readyAgreementCount = evaluations.filter((item) => item.state === 'ready').length;
  const setupRequiredAgreementCount = evaluations.length - readyAgreementCount;
  return {
    schemaVersion: 1,
    evaluatorRef: 'p06.grant_settlement_readiness',
    evaluatorVersion: 1,
    state: evaluations.length === 0
      ? 'not_applicable'
      : setupRequiredAgreementCount === 0
        ? 'ready'
        : 'setup_required',
    activeAgreementCount: evaluations.length,
    readyAgreementCount,
    setupRequiredAgreementCount,
    evaluations,
    blockerCodes: [...new Set(evaluations.flatMap((item) => item.blockerCodes))].sort(),
  };
}

function resolveRealmsDelegationConformance(
  value: unknown,
): GovernanceResourceReadiness['realmsRuntimeBinding']['delegationConformance'] {
  const lifecycle = asRecord(value);
  if (Object.keys(lifecycle).length === 0) return null;
  const authorityTransition = asRecord(lifecycle.authorityTransition);
  const providerReceipt = asRecord(lifecycle.providerReceipt);
  const setReadback = asRecord(providerReceipt.setReadback);
  const revokeReadback = asRecord(providerReceipt.revokeReadback);
  const completed = lifecycle.state === 'completed';
  if (
    lifecycle.schemaVersion !== 1
    || !['authorized', 'revoke_pending', 'completed'].includes(String(lifecycle.state))
    || typeof lifecycle.requestId !== 'string'
    || lifecycle.requestId.length === 0
    || typeof lifecycle.decisionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(lifecycle.decisionDigest)
    || typeof authorityTransition.delegate !== 'string'
    || authorityTransition.delegate.length === 0
    || (completed && (
      providerReceipt.finalDelegate !== null
      || providerReceipt.historicalVoteInvariant !== 'unchanged'
      || !Number.isSafeInteger(setReadback.observedSlot)
      || Number(setReadback.observedSlot) <= 0
      || !Number.isSafeInteger(revokeReadback.observedSlot)
      || Number(revokeReadback.observedSlot) <= 0
      || lifecycle.providerMapping !== 'weaker_provider_delegate_broader_than_vote_only_template_blocked'
      || lifecycle.blocker !== null
    ))
  ) return null;
  return {
    schemaVersion: 1,
    state: lifecycle.state as 'authorized' | 'revoke_pending' | 'completed',
    requestId: lifecycle.requestId,
    decisionDigest: lifecycle.decisionDigest,
    delegate: authorityTransition.delegate,
    finalDelegate: null,
    setObservedSlot: completed ? Number(setReadback.observedSlot) : null,
    revokeObservedSlot: completed ? Number(revokeReadback.observedSlot) : null,
    historicalVoteInvariant: completed ? 'unchanged' : 'pending',
    providerMapping: 'weaker_provider_delegate_broader_than_vote_only_template_blocked',
    blocker: typeof lifecycle.blocker === 'string' ? lifecycle.blocker : null,
  };
}

function resolveRealmsVotingPowerChallenge(
  value: unknown,
): GovernanceResourceReadiness['realmsRuntimeBinding']['votingPowerChallenge'] {
  const lifecycle = asRecord(value);
  if (Object.keys(lifecycle).length === 0) return null;
  const preReadback = asRecord(lifecycle.preReadback);
  const postReadback = asRecord(lifecycle.postReadback);
  const reopened = lifecycle.state === 'reopened';
  if (
    lifecycle.schemaVersion !== 1
    || !['suspended', 'reopened'].includes(String(lifecycle.state))
    || typeof lifecycle.requestId !== 'string'
    || lifecycle.requestId.length === 0
    || typeof lifecycle.decisionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(lifecycle.decisionDigest)
    || !Number.isFinite(Date.parse(String(lifecycle.suspendedAt ?? '')))
    || !Number.isSafeInteger(preReadback.observedSlot)
    || Number(preReadback.observedSlot) <= 0
    || (reopened && (
      !Number.isFinite(Date.parse(String(lifecycle.reopenedAt ?? '')))
      || !Number.isSafeInteger(postReadback.observedSlot)
      || Number(postReadback.observedSlot) <= 0
      || lifecycle.historicalTallyInvariant !== 'unchanged'
      || lifecycle.blocker !== null
      || lifecycle.resolution !== 'authoritative_readback_matched_frozen_historical_tally'
    ))
    || (!reopened && !(
      (lifecycle.historicalTallyInvariant === 'pending'
        && lifecycle.blocker === 'challenge_resolution_pending')
      || (lifecycle.historicalTallyInvariant === 'conflict'
        && lifecycle.blocker === 'challenge_superseding_snapshot_required')
    ))
    || (!reopened && (
      lifecycle.reopenedAt != null
      || postReadback.observedSlot != null
    ))
  ) return null;
  return {
    schemaVersion: 1,
    state: lifecycle.state as 'suspended' | 'reopened',
    requestId: lifecycle.requestId,
    decisionDigest: lifecycle.decisionDigest,
    suspendedAt: String(lifecycle.suspendedAt),
    reopenedAt: reopened ? String(lifecycle.reopenedAt) : null,
    preObservedSlot: Number(preReadback.observedSlot),
    postObservedSlot: reopened ? Number(postReadback.observedSlot) : null,
    historicalTallyInvariant: reopened
      ? 'unchanged'
      : lifecycle.historicalTallyInvariant as 'pending' | 'conflict',
    blocker: reopened
      ? null
      : lifecycle.blocker as 'challenge_resolution_pending' | 'challenge_superseding_snapshot_required',
  };
}

function resolveRealmsProviderFinality(
  value: unknown,
): GovernanceResourceReadiness['realmsRuntimeBinding']['providerFinality'] {
  const providerReceipt = asRecord(value);
  if (providerReceipt.providerFinality !== 'finalized' || !Array.isArray(providerReceipt.transactions)) {
    return null;
  }
  const transactions = providerReceipt.transactions.map((raw) => {
    const transaction = asRecord(raw);
    if (
      typeof transaction.stepId !== 'string'
      || transaction.stepId.length === 0
      || typeof transaction.signature !== 'string'
      || transaction.signature.length < 64
      || !Number.isSafeInteger(transaction.slot)
      || Number(transaction.slot) <= 0
      || !validRealmsProviderFinalityTransitions(
        transaction.finalityTransitions,
        Number(transaction.slot),
      )
      || transaction.finalityTransitions.at(-1)?.state !== 'finalized'
    ) return null;
    return {
      stepId: transaction.stepId,
      signature: transaction.signature,
      slot: Number(transaction.slot),
      finalityTransitions: transaction.finalityTransitions.map((transition) => ({
          state: transition.state as 'submitted' | 'confirmed' | 'finalized',
          authority: transition.authority as
            | 'provider_signature_readback'
            | 'solana_rpc_signature_status'
            | 'solana_rpc_finalized_transaction',
          ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
        })),
    };
  });
  if (transactions.length === 0 || transactions.some((transaction) => transaction === null)) return null;
  return {
    state: 'finalized',
    transactions: transactions as NonNullable<
      GovernanceResourceReadiness['realmsRuntimeBinding']['providerFinality']
    >['transactions'],
  };
}

function resolveRealmsProviderDisable(
  value: unknown,
): GovernanceResourceReadiness['realmsRuntimeBinding']['providerDisable'] {
  const providerDisable = asRecord(value);
  const rollbackPolicy = asRecord(providerDisable.rollbackPolicy);
  const pauseBoundary = asRecord(providerDisable.pauseBoundary);
  if (
    providerDisable.schemaVersion !== 1
    || providerDisable.state !== 'disabled'
    || typeof providerDisable.requestId !== 'string'
    || providerDisable.requestId.length === 0
    || typeof providerDisable.decisionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(providerDisable.decisionDigest)
    || typeof providerDisable.disabledAt !== 'string'
    || !Number.isFinite(Date.parse(providerDisable.disabledAt))
    || providerDisable.reason !== 'governed_provider_disable'
    || typeof providerDisable.inFlightDispositionDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(providerDisable.inFlightDispositionDigest)
    || rollbackPolicy.preSubmit !== 'new_governed_restore_requires_independent_readback'
    || rollbackPolicy.postSubmit !== 'forward_recovery_or_independent_reconciliation_only'
    || rollbackPolicy.chainFacts !== 'never_rewritten'
    || rollbackPolicy.fallback !== 'prohibited'
    || pauseBoundary.authority !== 'resource_pause_separate_from_workflow_freeze'
    || pauseBoundary.workflowFreezeClaimsChainPaused !== false
    || pauseBoundary.effect !== 'provider_dispatch_disabled_no_chain_pause_claim'
    || pauseBoundary.providerTransaction !== 'not_submitted'
    || pauseBoundary.providerStateReadback !== 'canonical_resource_binding_disabled'
    || pauseBoundary.onchainPauseInstruction !== 'not_claimed'
    || pauseBoundary.restoreAuthority !== 'new_governed_restore_requires_independent_readback'
    || pauseBoundary.rollback !== 'forward_recovery_only_chain_facts_never_rewritten'
    || pauseBoundary.fallbackAuthority !== 'none'
  ) return null;
  return {
    schemaVersion: 1,
    state: 'disabled',
    requestId: providerDisable.requestId,
    decisionDigest: providerDisable.decisionDigest,
    disabledAt: providerDisable.disabledAt,
    reason: 'governed_provider_disable',
    inFlightDispositionDigest: providerDisable.inFlightDispositionDigest,
    rollbackPolicy: {
      preSubmit: 'new_governed_restore_requires_independent_readback',
      postSubmit: 'forward_recovery_or_independent_reconciliation_only',
      chainFacts: 'never_rewritten',
      fallback: 'prohibited',
    },
    pauseBoundary: {
      authority: 'resource_pause_separate_from_workflow_freeze',
      workflowFreezeClaimsChainPaused: false,
      effect: 'provider_dispatch_disabled_no_chain_pause_claim',
      providerTransaction: 'not_submitted',
      providerStateReadback: 'canonical_resource_binding_disabled',
      onchainPauseInstruction: 'not_claimed',
      restoreAuthority: 'new_governed_restore_requires_independent_readback',
      rollback: 'forward_recovery_only_chain_facts_never_rewritten',
      fallbackAuthority: 'none',
    },
  };
}

function resolveRealmsBindingReconciliation(
  value: unknown,
  resourceBindingId: string | null,
): GovernanceResourceReadiness['realmsRuntimeBinding']['reconciliation'] {
  const reconciliation = asRecord(value);
  const state = reconciliation.state;
  const blocker = reconciliation.blocker;
  const observedStateDigest = reconciliation.observedStateDigest;
  const observedSlot = reconciliation.observedSlot;
  if (
    reconciliation.schemaVersion !== 1
    || !resourceBindingId
    || reconciliation.resourceBindingId !== resourceBindingId
    || !['verified', 'hold'].includes(String(state))
    || reconciliation.authority !== 'independent_provider_readback'
    || typeof reconciliation.receiptId !== 'string'
    || reconciliation.receiptId.length === 0
    || typeof reconciliation.receiptEvidenceDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(reconciliation.receiptEvidenceDigest)
    || typeof reconciliation.expectedStateDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(reconciliation.expectedStateDigest)
    || typeof reconciliation.observedAt !== 'string'
    || !Number.isFinite(Date.parse(reconciliation.observedAt))
    || (state === 'verified' && (
      blocker !== null
      || typeof observedStateDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(observedStateDigest)
      || !Number.isSafeInteger(observedSlot)
      || Number(observedSlot) <= 0
    ))
    || (state === 'hold' && (
      !['provider_readback_outage', 'provider_readback_conflict'].includes(String(blocker))
      || observedStateDigest !== null
      || observedSlot !== null
    ))
  ) return null;
  return {
    schemaVersion: 1,
    state: state as 'verified' | 'hold',
    blocker: blocker as 'provider_readback_outage' | 'provider_readback_conflict' | null,
    authority: 'independent_provider_readback',
    resourceBindingId,
    receiptId: reconciliation.receiptId,
    receiptEvidenceDigest: reconciliation.receiptEvidenceDigest,
    expectedStateDigest: reconciliation.expectedStateDigest,
    observedStateDigest: observedStateDigest as string | null,
    observedSlot: observedSlot as number | null,
    observedAt: reconciliation.observedAt,
  };
}

function resolveRealmsRuntimeOwnerPhase(
  resource: Awaited<ReturnType<NonNullable<GovernanceResourceReadinessPrisma['governedResourceBinding']>['findFirst']>>,
  payer: Awaited<ReturnType<NonNullable<GovernanceResourceReadinessPrisma['payerPolicy']['findFirst']>>>,
  readiness: RealmsProviderTrustReadiness,
): 'pre_wallet' | 'keys_verified' | 'provider_active' | null {
  if (!resource || !payer) return null;
  const profile = getRealmsProviderTrustProfile();
  if (
    resource.network !== profile.chain.chainId
    || resource.provider !== profile.provider
    || resource.capability !== 'realms_governance'
    || resource.contractVersion !== 1
    || resource.profileRef !== profile.profileRef
    || resource.profileVersion !== profile.version
    || !['pending_custody', 'active'].includes(resource.status)
  ) return null;

  const verification = asRecord(resource.verification);
  const applicationIdentity = asRecord(verification.applicationIdentity);
  const applicationIdentityVerified = (
    applicationIdentity.authMethod === 'openbao_periodic_token'
    && applicationIdentity.credentialRef
      === 'macos-keychain:Alcheme Governance OS OpenBao Devnet/realms-runtime-application-token'
    && applicationIdentity.policyName === 'alcheme-realms-devnet-runtime-current'
    && applicationIdentity.tokenPeriodSeconds === 86400
    && typeof applicationIdentity.tokenAccessor === 'string'
    && /^[A-Za-z0-9._-]{8,160}$/.test(applicationIdentity.tokenAccessor)
    && typeof applicationIdentity.lastVerifiedAt === 'string'
    && Number.isFinite(Date.parse(applicationIdentity.lastVerifiedAt))
  );
  const providerActive = resource.status === 'active';
  const preWallet = !providerActive
    && verification.custodyStatus === profile.keyCustodyRecord.status;
  const keysVerified = verification.custodyStatus === 'verified_wallet_keys_pending_provider'
    && typeof verification.keyReadbackDigest === 'string'
    && /^[a-f0-9]{64}$/.test(verification.keyReadbackDigest)
    && applicationIdentityVerified;
  if (
    verification.profileDigest !== readiness.profileDigest
    || verification.deploymentVerification !== 'snapshot_verified_read_only'
    || verification.resourceReadback !== (providerActive
      ? 'verified_finalized'
      : 'pending_provider_bootstrap')
    || verification.custodyRecordRef !== profile.keyCustodyRecord.recordRef
    || (!preWallet && !keysVerified && !(
      providerActive
      && verification.custodyStatus === 'verified_wallet_keys_provider_active'
      && applicationIdentityVerified
      && typeof resource.resourceRef === 'string'
      && typeof resource.stateDigest === 'string'
    ))
    || verification.custodyEndpoint !== profile.keyCustodyRecord.endpoint
    || verification.activation !== (providerActive ? 'active' : 'not_activated')
    || !sameCanonical(verification.custodyTls, profile.keyCustodyRecord.tls)
    || !sameCanonical(
      verification.custodyVerification,
      profile.keyCustodyRecord.verification,
    )
  ) return null;

  if (resource.authorityBindings.length !== profile.keyCustodyRecord.keyContracts.length) {
    return null;
  }
  const authorities = new Map(
    resource.authorityBindings.map((binding) => [binding.authorityRole, binding]),
  );
  for (const contract of profile.keyCustodyRecord.keyContracts) {
    const binding = authorities.get(contract.role);
    const expectedAllowedOperations = contract.role === 'voter' && providerActive
      ? ['cast_vote']
      : contract.allowedOperations;
    if (
      !binding
      || binding.keyRef !== contract.keyRef
      || (preWallet
        ? binding.currentAuthority !== null
        : typeof binding.currentAuthority !== 'string')
      || binding.custodyProvider !== profile.keyCustodyRecord.signerProvider
      || binding.custodyStatus !== (preWallet ? contract.status : 'verified')
      || binding.profileRef !== profile.profileRef
      || binding.profileVersion !== profile.version
      || binding.status !== (providerActive
        ? 'active'
        : preWallet
          ? 'pending_custody'
          : 'pending_provider_bootstrap')
      || (providerActive && (
        binding.providerResourceRef !== resource.resourceRef
        || binding.stateDigest !== resource.stateDigest
      ))
      || !sameStringSet(binding.allowedOperations, expectedAllowedOperations)
      || !sameCanonical(
        binding.custodyVerification,
        profile.keyCustodyRecord.verification,
      )
    ) return null;
  }

  const feePayer = profile.keyCustodyRecord.keyContracts.find(
    (contract) => contract.role === 'fee_payer',
  );
  const payerMatches = Boolean(
    feePayer
    && payer.network === profile.chain.chainId
    && payer.economicBearer === 'solana_devnet_faucet_only'
    && payer.feePayerSignerRef === feePayer.keyRef
    && payer.rentFundingSourceRef === feePayer.keyRef
    && payer.refundRecipientRef === feePayer.keyRef
    && payer.fundingBlockerCode === (providerActive
      ? null
      : preWallet
        ? 'openbao_wallet_not_generated'
        : 'devnet_fee_cap_required')
    && payer.status === (providerActive ? 'active' : 'inactive'),
  );
  return payerMatches
    ? providerActive
      ? 'provider_active'
      : preWallet
        ? 'pre_wallet'
        : 'keys_verified'
    : null;
}

function positiveIntegerText(value: unknown): string | null {
  if (typeof value === 'bigint') return value > 0n ? value.toString() : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  return null;
}

function digestText(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function safeIsoInstant(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return hashCanonicalGovernanceValue(
    'alcheme.governance.realms-runtime-owner-readback',
    left,
  ) === hashCanonicalGovernanceValue(
    'alcheme.governance.realms-runtime-owner-readback',
    right,
  );
}

function sameStringSet(left: unknown, right: readonly string[]): boolean {
  if (!Array.isArray(left) || left.some((value) => typeof value !== 'string')) {
    return false;
  }
  const normalizedLeft = [...new Set(left as string[])].sort();
  const normalizedRight = [...new Set(right)].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
