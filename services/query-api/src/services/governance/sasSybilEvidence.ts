import { createHash } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import {
  getSasProviderTrustProfile,
  getSasProviderTrustProfileDigest,
  resolveSasProviderTrustReadiness,
} from './sasProviderTrustProfile';

export type SybilDimension = 'admission' | 'proposal_creation' | 'voter_eligibility';
export type ClaimClass = 'risk_score' | 'reputation' | 'uniqueness' | 'liveness' | 'kyc' | 'attribute';
export type CompositionMode = 'any' | 'all' | 'threshold';
export type CompositionDisposition = 'deny' | 'manual_review' | 'allow';
export type GuardMode = 'alcheme_native' | 'provider_onchain' | 'advisory_only';
export type GuardMapping = 'exact' | 'stricter' | 'weaker' | 'not_representable';
export type ProviderLifecycle = 'candidate' | 'active' | 'deprecated';

export type SasAttestationObservation = {
  subjectPubkey: string;
  attestationRef: string;
  credentialRef: string;
  schemaRef: string;
  schemaVersion: number;
  authorizedSignerRef: string;
  claimClass: ClaimClass;
  issuedAt: string;
  expiresAt: string | null;
  invalidated: boolean;
  programId: string;
  chainId: 'solana:devnet';
  observedSlot: number;
  commitment: 'finalized';
  authoritative: true;
  selfProvesAttestation: false;
};

export type SasAttestationReader = {
  readAttestation(input: {
    subjectPubkey: string;
    schemaRef: string;
    programId: string;
  }): Promise<SasAttestationObservation | null>;
};

let sasAttestationReader: SasAttestationReader | null = null;

export function setSasAttestationReader(reader: SasAttestationReader | null): void {
  sasAttestationReader = reader;
}

export function getSasAttestationReader(): SasAttestationReader | null {
  return sasAttestationReader;
}

function assertPubkey(value: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error('sas_subject_must_be_pubkey');
  }
}

export type SybilEvidencePolicy = {
  schemaVersion: 1;
  policyId: string;
  policyVersion: number;
  profileRef: string;
  profileDigest: string;
  cluster: 'devnet';
  genesisHash: string;
  programId: string;
  credentialAccountRef: string;
  schemaAccountRef: string;
  attestationSchemaVersion: number;
  authorizedSignerRef: string;
  claimClass: ClaimClass;
  effectiveFrom: string;
  dimensions: Record<SybilDimension, boolean>;
  composition: {
    mode: CompositionMode;
    threshold: number | null;
    dispositionOnFail: CompositionDisposition;
    requirementIds: string[];
    issuerDiversityRequired: boolean;
  };
  votingPowerAfterEligible: 'selected_voting_power_policy' | 'native_one_person_one_vote';
  revocation: {
    validAtSnapshot: boolean;
    validThroughVoteEnd: boolean;
    revalidateBeforeExecution: boolean;
    onRevokedDuringVote: 'keep_snapshot_freeze_new_policy';
    onRevokedBeforeExecution: 'block_execution_require_resolution';
    onFraudConfirmed: 'manual_review_only';
  };
};

export function createSybilEvidencePolicy(input: {
  policyId: string;
  policyVersion: number;
  claimClass: ClaimClass;
  dimensions: Partial<Record<SybilDimension, boolean>>;
  composition: SybilEvidencePolicy['composition'];
  effectiveFrom?: string;
}): SybilEvidencePolicy {
  const profile = getSasProviderTrustProfile();
  const dimensions: Record<SybilDimension, boolean> = {
    admission: false,
    proposal_creation: false,
    voter_eligibility: false,
    ...input.dimensions,
  };
  if (!Object.values(dimensions).some(Boolean)) {
    throw new Error('sybil_policy_requires_at_least_one_dimension');
  }
  if (input.composition.mode === 'threshold') {
    if (!Number.isSafeInteger(input.composition.threshold) || Number(input.composition.threshold) < 1) {
      throw new Error('sybil_policy_threshold_invalid');
    }
  }
  const ids = new Set(input.composition.requirementIds);
  if (ids.size !== input.composition.requirementIds.length) {
    throw new Error('sybil_policy_requirement_ids_must_be_unique');
  }
  return {
    schemaVersion: 1,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    profileRef: profile.profileRef,
    profileDigest: getSasProviderTrustProfileDigest(),
    cluster: 'devnet',
    genesisHash: profile.chain.genesisHash,
    programId: profile.deployment.programId,
    credentialAccountRef: profile.deployment.credentialAccountRef,
    schemaAccountRef: profile.deployment.schemaAccountRef,
    attestationSchemaVersion: profile.deployment.schemaVersion,
    authorizedSignerRef: profile.deployment.authorizedSignerRef,
    claimClass: input.claimClass,
    effectiveFrom: input.effectiveFrom ?? new Date().toISOString(),
    dimensions,
    composition: input.composition,
    votingPowerAfterEligible: 'native_one_person_one_vote',
    revocation: {
      validAtSnapshot: true,
      validThroughVoteEnd: true,
      revalidateBeforeExecution: true,
      onRevokedDuringVote: 'keep_snapshot_freeze_new_policy',
      onRevokedBeforeExecution: 'block_execution_require_resolution',
      onFraudConfirmed: 'manual_review_only',
    },
  };
}

export function rejectArbitraryAttestation(input: {
  policy: SybilEvidencePolicy;
  observation: SasAttestationObservation;
}): void {
  const profile = getSasProviderTrustProfile();
  if (
    input.observation.programId !== input.policy.programId
    || input.observation.programId !== profile.deployment.programId
    || input.observation.schemaRef !== input.policy.schemaAccountRef
    || input.observation.schemaVersion !== input.policy.attestationSchemaVersion
    || input.observation.authorizedSignerRef !== input.policy.authorizedSignerRef
    || input.observation.credentialRef !== input.policy.credentialAccountRef
    || input.observation.claimClass !== input.policy.claimClass
    || input.observation.chainId !== 'solana:devnet'
    || input.observation.selfProvesAttestation !== false
  ) {
    throw new Error('sas_attestation_not_accepted_by_policy');
  }
}

export type SubjectBindingResolver = (observation: SasAttestationObservation) => string;
export type IssuedAtResolver = (observation: SasAttestationObservation) => string;
export type InvalidationStrategy = (observation: SasAttestationObservation) => boolean;

export function defaultSubjectBindingResolver(observation: SasAttestationObservation): string {
  return assertPubkey(observation.subjectPubkey);
}

export function defaultIssuedAtResolver(observation: SasAttestationObservation): string {
  if (!observation.issuedAt || Number.isNaN(Date.parse(observation.issuedAt))) {
    throw new Error('sas_issued_at_invalid');
  }
  return observation.issuedAt;
}

export function defaultInvalidationStrategy(observation: SasAttestationObservation): boolean {
  if (observation.invalidated) return true;
  if (observation.expiresAt && Date.parse(observation.expiresAt) <= Date.now()) return true;
  return false;
}

export function projectLayeredSybilDisplay(input: {
  providerNativeClaim: string;
  sasAttestationPresent: boolean;
  policyId: string;
  policyVersion: number;
  enforcement: CompositionDisposition | 'eligible';
}): {
  providerNativeClaim: string;
  sasAttestationCarrier: boolean;
  alchemePolicyRef: string;
  alchemeEnforcement: CompositionDisposition | 'eligible';
} {
  return {
    providerNativeClaim: input.providerNativeClaim,
    sasAttestationCarrier: input.sasAttestationPresent,
    alchemePolicyRef: `${input.policyId}@${input.policyVersion}`,
    alchemeEnforcement: input.enforcement,
  };
}

export function composeSybilRequirements(input: {
  policy: SybilEvidencePolicy;
  hits: Array<{ requirementId: string; issuerRef: string }>;
}): {
  disposition: CompositionDisposition | 'allow';
  reasonCodes: string[];
  hitRequirementIds: string[];
  missingRequirementIds: string[];
  alternativeVerificationPaths: string[];
} {
  const required = input.policy.composition.requirementIds;
  const hitIds = [...new Set(input.hits.map((hit) => hit.requirementId))]
    .filter((id) => required.includes(id));
  const missing = required.filter((id) => !hitIds.includes(id));
  const issuers = new Set(input.hits.map((hit) => hit.issuerRef));
  if (input.policy.composition.issuerDiversityRequired && issuers.size < Math.min(2, hitIds.length || 2)) {
    return {
      disposition: input.policy.composition.dispositionOnFail,
      reasonCodes: ['issuer_diversity_insufficient'],
      hitRequirementIds: hitIds,
      missingRequirementIds: missing,
      alternativeVerificationPaths: ['manual_review', 'alternate_issuer'],
    };
  }
  let ok = false;
  if (input.policy.composition.mode === 'all') ok = missing.length === 0;
  if (input.policy.composition.mode === 'any') ok = hitIds.length > 0;
  if (input.policy.composition.mode === 'threshold') {
    ok = hitIds.length >= Number(input.policy.composition.threshold);
  }
  return {
    disposition: ok ? 'allow' : input.policy.composition.dispositionOnFail,
    reasonCodes: ok ? ['sybil_requirements_satisfied'] : ['sybil_requirements_unmet'],
    hitRequirementIds: hitIds,
    missingRequirementIds: missing,
    alternativeVerificationPaths: ok ? [] : ['manual_review', 'alternate_issuer', 'acquisition_journey'],
  };
}

export function separateContributionAndSybil(input: {
  contributionSatisfied: boolean;
  sybilEligible: boolean;
}): {
  contributionGrantsSybilBypass: false;
  sybilGrantsContributionRoleOrProposal: false;
  contributionSatisfied: boolean;
  sybilEligible: boolean;
} {
  return {
    contributionGrantsSybilBypass: false,
    sybilGrantsContributionRoleOrProposal: false,
    contributionSatisfied: input.contributionSatisfied,
    sybilEligible: input.sybilEligible,
  };
}

export type EligibilityEvidenceReceipt = {
  schemaVersion: 1;
  visibility: 'reviewer_auditor_only';
  provider: 'solana_attestation_service';
  attestationRef: string;
  credentialRef: string;
  schemaRef: string;
  signerRef: string;
  subjectPubkey: string;
  issuedAt: string;
  invalidationEvidence: string;
  policyId: string;
  policyVersion: number;
  observedSlot: number;
};

export function buildEligibilityEvidenceReceipt(input: {
  policy: SybilEvidencePolicy;
  observation: SasAttestationObservation;
  invalidationEvidence: string;
}): {
  privateReceipt: EligibilityEvidenceReceipt;
  publicDigest: string;
  publicSafe: {
    eligibilityStatus: 'eligible' | 'ineligible' | 'manual_review';
    reasonCode: string;
  };
} {
  rejectArbitraryAttestation({ policy: input.policy, observation: input.observation });
  const subjectPubkey = defaultSubjectBindingResolver(input.observation);
  const issuedAt = defaultIssuedAtResolver(input.observation);
  const invalidated = defaultInvalidationStrategy(input.observation);
  const privateReceipt: EligibilityEvidenceReceipt = {
    schemaVersion: 1,
    visibility: 'reviewer_auditor_only',
    provider: 'solana_attestation_service',
    attestationRef: input.observation.attestationRef,
    credentialRef: input.observation.credentialRef,
    schemaRef: input.observation.schemaRef,
    signerRef: input.observation.authorizedSignerRef,
    subjectPubkey,
    issuedAt,
    invalidationEvidence: input.invalidationEvidence,
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    observedSlot: input.observation.observedSlot,
  };
  const publicDigest = createHash('sha256')
    .update(JSON.stringify({
      policyId: input.policy.policyId,
      policyVersion: input.policy.policyVersion,
      receipt: privateReceipt,
    }))
    .digest('hex');
  return {
    privateReceipt,
    publicDigest,
    publicSafe: {
      eligibilityStatus: invalidated ? 'ineligible' : 'eligible',
      reasonCode: invalidated ? 'attestation_invalidated_or_expired' : 'policy_attestation_satisfied',
    },
  };
}

export function eligibilityDoesNotSetVotingPower(input: {
  policy: SybilEvidencePolicy;
  eligible: boolean;
}): {
  eligible: boolean;
  votingPowerPolicy: SybilEvidencePolicy['votingPowerAfterEligible'];
} {
  return {
    eligible: input.eligible,
    votingPowerPolicy: input.policy.votingPowerAfterEligible,
  };
}

export function replaceProviderRequiresNewPolicyVersion(input: {
  current: SybilEvidencePolicy;
  nextVersion: number;
}): SybilEvidencePolicy {
  if (input.nextVersion <= input.current.policyVersion) {
    throw new Error('sybil_provider_replace_requires_new_policy_version');
  }
  return { ...input.current, policyVersion: input.nextVersion };
}

export type SybilReviewResolution = {
  schemaVersion: 1;
  kind: 'verification_correction' | 'issuer_dispute' | 'policy_exception';
  reviewerAuthorityRef: string;
  separationOfDuties: true;
  rationale: string;
  evidenceDigest: string;
  policyId: string;
  policyVersion: number;
  subjectPubkey: string;
  circleId: number;
  useCase: string;
  actionType: string;
  caseId: string;
  expiresAt: string;
  appealState: 'open' | 'closed';
  selfReviewForbidden: true;
  platformOperatorMayOverride: false;
};

export function createSybilReviewResolution(input: Omit<SybilReviewResolution, 'schemaVersion' | 'separationOfDuties' | 'selfReviewForbidden' | 'platformOperatorMayOverride'>): SybilReviewResolution {
  if (!/^[a-f0-9]{64}$/.test(input.evidenceDigest)) {
    throw new Error('sybil_review_evidence_digest_invalid');
  }
  return {
    schemaVersion: 1,
    separationOfDuties: true,
    selfReviewForbidden: true,
    platformOperatorMayOverride: false,
    ...input,
  };
}

export function projectSybilUnavailableDisposition(input: {
  dimension: SybilDimension;
}): {
  admission: 'wait_or_alternate_issuer_or_manual_review' | 'not_applicable';
  proposal: 'draft_allowed_submit_blocked' | 'not_applicable';
  voter: 'recover_before_schedule_or_defer' | 'not_applicable';
  historicalSnapshotPreserved: true;
  cannotPurgeAfterVotingOpened: true;
} {
  return {
    admission: input.dimension === 'admission' ? 'wait_or_alternate_issuer_or_manual_review' : 'not_applicable',
    proposal: input.dimension === 'proposal_creation' ? 'draft_allowed_submit_blocked' : 'not_applicable',
    voter: input.dimension === 'voter_eligibility' ? 'recover_before_schedule_or_defer' : 'not_applicable',
    historicalSnapshotPreserved: true,
    cannotPurgeAfterVotingOpened: true,
  };
}

export function projectProviderRegistryLifecycle(): Array<{
  providerId: string;
  lifecycle: ProviderLifecycle;
  readinessState: 'ready' | 'setup_required' | 'unavailable';
  riskMaturity: 'stable' | 'experimental';
}> {
  const readiness = resolveSasProviderTrustReadiness();
  return [
    {
      providerId: 'solana_attestation_service',
      lifecycle: 'active',
      readinessState: readiness.readinessState,
      riskMaturity: readiness.riskMaturity,
    },
    {
      providerId: 'civic_pass_legacy',
      lifecycle: 'deprecated',
      readinessState: 'unavailable',
      riskMaturity: 'experimental',
    },
  ];
}

export type SybilPolicyActivationReadiness = {
  schemaVersion: 1;
  coverageSimulation: {
    existingCoverageRatio: number;
    zeroEligible: boolean;
  };
  credentialAcquisitionReachable: boolean;
  issuerCoverage: {
    geography: string;
    population: string;
  };
  manualQueueCapacity: number;
  gracePeriodHours: number;
  rollbackEmergencyRecovery: 'versioned_policy_rollback_only';
  activationAllowed: boolean;
  blockers: string[];
};

export function evaluateSybilPolicyActivationReadiness(input: {
  existingCoverageRatio: number;
  credentialAcquisitionReachable: boolean;
  manualQueueCapacity: number;
  gracePeriodHours: number;
}): SybilPolicyActivationReadiness {
  const zeroEligible = input.existingCoverageRatio <= 0;
  const blockers: string[] = [];
  if (zeroEligible) blockers.push('zero_eligible_fail_closed');
  if (!input.credentialAcquisitionReachable) blockers.push('credential_acquisition_unreachable');
  if (input.manualQueueCapacity < 1) blockers.push('manual_queue_capacity_insufficient');
  return {
    schemaVersion: 1,
    coverageSimulation: {
      existingCoverageRatio: input.existingCoverageRatio,
      zeroEligible,
    },
    credentialAcquisitionReachable: input.credentialAcquisitionReachable,
    issuerCoverage: {
      geography: 'policy_declared',
      population: 'policy_declared',
    },
    manualQueueCapacity: input.manualQueueCapacity,
    gracePeriodHours: input.gracePeriodHours,
    rollbackEmergencyRecovery: 'versioned_policy_rollback_only',
    activationAllowed: blockers.length === 0,
    blockers,
  };
}

export function projectCredentialAcquisitionJourney(input: {
  mode: 'verify_existing' | 'request_new_issuance';
  acceptedClaim: ClaimClass;
  issuerRef: string;
  estimatedMinutes: number;
  feeDisclosure: string;
  privacyRisk: string;
  status: 'acquisition_pending' | 'renewal_required' | 'issuer_review_pending' | 'ready';
}): typeof input & { separatesVerifyFromIssuance: true } {
  return { ...input, separatesVerifyFromIssuance: true };
}

export function projectPublicSafeEligibility(input: {
  status: 'eligible' | 'ineligible' | 'manual_review';
  reasonCode: string;
}): {
  public: { status: string; reasonCode: string };
  sensitiveFieldsPublic: false;
} {
  return {
    public: { status: input.status, reasonCode: input.reasonCode },
    sensitiveFieldsPublic: false,
  };
}

export function declareClaimClassRequirements(input: {
  claimClass: ClaimClass;
  score?: number;
  model?: string;
  evaluatedAt?: string;
  uniquenessScope?: string;
  nullifier?: string;
  allowedPurposes: string[];
}): {
  claimClass: ClaimClass;
  reputationSatisfiesUniqueness: false;
  fields: Record<string, unknown>;
} {
  if (input.claimClass === 'reputation' && input.allowedPurposes.includes('uniqueness')) {
    throw new Error('reputation_cannot_satisfy_uniqueness');
  }
  return {
    claimClass: input.claimClass,
    reputationSatisfiesUniqueness: false,
    fields: {
      score: input.score ?? null,
      model: input.model ?? null,
      evaluatedAt: input.evaluatedAt ?? null,
      uniquenessScope: input.uniquenessScope ?? null,
      nullifier: input.nullifier ?? null,
      allowedPurposes: input.allowedPurposes,
    },
  };
}

export type SybilGuardBinding = {
  schemaVersion: 1;
  mode: GuardMode;
  mapping: GuardMapping;
  required: boolean;
  activationGate: 'ready' | 'blocked';
  sharedCommitteeOwnsVoterGuard: true;
  targetMayNotAppointCommitteeMembers: true;
};

export function createSybilGuardBinding(input: {
  mode: GuardMode;
  mapping: GuardMapping;
  required: boolean;
}): SybilGuardBinding {
  const blocked = input.required && (input.mapping === 'weaker' || input.mapping === 'not_representable' || input.mode === 'advisory_only');
  return {
    schemaVersion: 1,
    mode: input.mode,
    mapping: input.mapping,
    required: input.required,
    activationGate: blocked ? 'blocked' : 'ready',
    sharedCommitteeOwnsVoterGuard: true,
    targetMayNotAppointCommitteeMembers: true,
  };
}

export async function readPolicyBoundAttestation(input: {
  policy: SybilEvidencePolicy;
  subjectPubkey: string;
}): Promise<SasAttestationObservation> {
  const reader = sasAttestationReader;
  if (!reader) throw new Error('sas_attestation_reader_unavailable');
  const subjectPubkey = assertPubkey(input.subjectPubkey);
  const observation = await reader.readAttestation({
    subjectPubkey,
    schemaRef: input.policy.schemaAccountRef,
    programId: input.policy.programId,
  });
  if (!observation) throw new Error('sas_attestation_not_found');
  rejectArbitraryAttestation({ policy: input.policy, observation });
  return observation;
}
